import type { ActionFunctionArgs } from "react-router";
import { apiVersion } from "../shopify.server";
import { verifyShopSession } from "../session.server";

interface ThemeUpdateRequest {
  shop: string;
  themeId: string; // Theme ID (numeric, will be converted to GID)
  name: string; // New theme name
}

interface ThemeUpdateResponse {
  theme?: {
    id: string;
    name: string;
  };
  userErrors?: Array<{
    field: string[];
    message: string;
  }>;
  error?: string;
}

interface ThemeUpdateGraphQLResponse {
  data?: {
    themeUpdate?: {
      theme?: {
        id: string;
        name: string;
      };
      userErrors: Array<{
        field: string[];
        message: string;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

// Public endpoint to update a theme
// POST: /api/theme/update with JSON body { shop: "example.myshopify.com", themeId: "123", name: "New Theme Name" }
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
    let body: ThemeUpdateRequest;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { shop, themeId, name } = body;

    if (!shop || !themeId || !name) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: shop, themeId, and name",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return await updateTheme({ shop, themeId, name });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Failed to update theme" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function updateTheme({
  shop,
  themeId,
  name,
}: ThemeUpdateRequest): Promise<Response> {
  // Verify shop session
  const sessionResult = await verifyShopSession(shop);
  if (!sessionResult.success) {
    return new Response(
      JSON.stringify({
        error: sessionResult.error.error,
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

  // Make GraphQL mutation
  try {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation themeUpdate($id: ID!, $input: OnlineStoreThemeInput!) {
            themeUpdate(id: $id, input: $input) {
              theme {
                id
                name
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          id: `gid://shopify/OnlineStoreTheme/${themeId}`,
          input: {
            name,
          },
        },
      }),
    });

    const data = (await response.json()) as ThemeUpdateGraphQLResponse;

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: data.errors?.[0]?.message || "GraphQL request failed",
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const themeUpdate = data.data?.themeUpdate;
    if (!themeUpdate) {
      return new Response(
        JSON.stringify({
          error: "themeUpdate missing in response",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check for user errors
    if (themeUpdate.userErrors.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Failed to update theme: ${JSON.stringify(
            themeUpdate.userErrors
          )}`,
          userErrors: themeUpdate.userErrors,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result: ThemeUpdateResponse = {
      theme: themeUpdate.theme
        ? {
            id: themeUpdate.theme.id,
            name: themeUpdate.theme.name,
          }
        : undefined,
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
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
