import type { ActionFunctionArgs } from "react-router";
import { apiVersion } from "../shopify.server";
import { verifyShopSession } from "../session.server";

interface ThemeStatusRequest {
  themeId: string;
  shop: string;
}

interface ThemeStatusResponse {
  processing: boolean | null;
  error?: string;
}

// Public endpoint to check theme processing status
// POST: /api/theme/status with JSON body { themeId: "123", shop: "example.myshopify.com" }
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
  // Verify shop session
  const sessionResult = await verifyShopSession(shop);
  if (!sessionResult.success) {
    // Return error response with processing field for this specific endpoint
    return new Response(
      JSON.stringify({
        error: sessionResult.error.error,
        processing: null,
      }),
      {
        status: sessionResult.error.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { session } = sessionResult;

  // Construct GraphQL URL
  const graphqlUrl = `https://${session.normalizedShop}/admin/api/${apiVersion}/graphql.json`;

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
