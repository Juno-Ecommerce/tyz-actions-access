import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { apiVersion } from "../shopify.server";

interface ThemeStatusRequest {
  themeId: string;
  shop: string;
}

interface ThemeStatusResponse {
  processing: boolean | null;
  error?: string;
}

// Public endpoint to check theme processing status
// GET: /api/theme/status?themeId=123&shop=example.myshopify.com
// POST: /api/theme/status with JSON body { themeId: "123", shop: "example.myshopify.com" }
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const themeId = url.searchParams.get("themeId");
    const shop = url.searchParams.get("shop");

    if (!themeId || !shop) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: themeId and shop" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return await getThemeStatus({ themeId, shop });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Failed to get theme status" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Only allow POST requests
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse request body
    let body: ThemeStatusRequest;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { themeId, shop } = body;

    if (!themeId || !shop) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: themeId and shop" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return await getThemeStatus({ themeId, shop });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Failed to get theme status" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function getThemeStatus({
  themeId,
  shop,
}: ThemeStatusRequest): Promise<Response> {
  // Normalize shop domain (remove protocol, ensure .myshopify.com)
  const normalizedShop = shop
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();

  // Get session from database to retrieve access token
  const session = await db.session.findFirst({
    where: {
      shop: normalizedShop,
      isOnline: false, // Use offline sessions for API access
    },
    orderBy: {
      expires: "desc",
    },
  });

  if (!session) {
    return new Response(
      JSON.stringify({
        error: "No session found for shop. Please install the app first.",
        processing: null,
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Check if session is expired
  if (session.expires && session.expires < new Date()) {
    return new Response(
      JSON.stringify({
        error: "Session expired. Please reinstall the app.",
        processing: null,
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Construct GraphQL URL
  const graphqlUrl = `https://${normalizedShop}/admin/api/${apiVersion}/graphql.json`;

  // Make GraphQL query
  try {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query getThemeStatus($id: ID!) {
            theme(id: $id) {
              processing
            }
          }
        `,
        variables: {
          id: `gid://shopify/OnlineStoreTheme/${themeId}`,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: data.errors?.[0]?.message || "GraphQL request failed",
          processing: null,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result: ThemeStatusResponse = {
      processing: data.data?.theme?.processing ?? null,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("GraphQL request error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        processing: null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
