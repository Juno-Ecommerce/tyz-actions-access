import type { ActionFunctionArgs } from "react-router";
import { apiVersion } from "../shopify.server";
import { verifyShopSession } from "../session.server";

interface ThemeDeleteRequest {
  shop: string;
  themeId: string; // Theme ID (numeric, will be converted to GID)
}

interface ThemeDeleteResponse {
  deletedThemeId?: string;
  userErrors?: Array<{
    field: string[];
    message: string;
  }>;
  error?: string;
}

interface ThemeDeleteGraphQLResponse {
  data?: {
    themeDelete?: {
      deletedThemeId?: string;
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

// Public endpoint to delete a theme
// POST: /api/theme/delete with JSON body { shop: "example.myshopify.com", themeId: "123" }
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
    let body: ThemeDeleteRequest;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { shop, themeId } = body;

    if (!shop || !themeId) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: shop and themeId",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return await deleteTheme({ shop, themeId });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Failed to delete theme" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function deleteTheme({
  shop,
  themeId,
}: ThemeDeleteRequest): Promise<Response> {
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
          mutation themeDelete($id: ID!) {
            themeDelete(id: $id) {
              deletedThemeId
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          id: `gid://shopify/OnlineStoreTheme/${themeId}`,
        },
      }),
    });

    const data = (await response.json()) as ThemeDeleteGraphQLResponse;

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

    const themeDelete = data.data?.themeDelete;
    if (!themeDelete) {
      return new Response(
        JSON.stringify({
          error: "themeDelete missing in response",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check for user errors
    if (themeDelete.userErrors.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Failed to delete theme: ${JSON.stringify(
            themeDelete.userErrors
          )}`,
          userErrors: themeDelete.userErrors,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result: ThemeDeleteResponse = {
      deletedThemeId: themeDelete.deletedThemeId,
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
