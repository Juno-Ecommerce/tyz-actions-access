import type { ActionFunctionArgs } from "react-router";
import { apiVersion } from "../shopify.server";
import { verifyShopSession } from "../session.server";

interface ThemeCreateRequest {
  shop: string;
  source: string; // URL from staged upload (resourceUrl)
  name: string; // Theme name
}

interface ThemeCreateResponse {
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

interface ThemeCreateGraphQLResponse {
  data?: {
    themeCreate?: {
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

// Public endpoint to create a theme from a staged upload
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
    let body: ThemeCreateRequest;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { shop, source, name } = body;

    if (!shop || !source || !name) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: shop, source, and name",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return await createTheme({ shop, source, name });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Failed to create theme" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function createTheme({
  shop,
  source,
  name,
}: ThemeCreateRequest): Promise<Response> {
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
          mutation themeCreate($source: URL!, $name: String!) {
            themeCreate(source: $source, name: $name) {
              theme {
                name
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          name,
          source,
        },
      }),
    });

    const data = (await response.json()) as ThemeCreateGraphQLResponse;

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

    const themeCreate = data.data?.themeCreate;
    if (!themeCreate) {
      return new Response(
        JSON.stringify({
          error: "themeCreate missing in response",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check for user errors
    if (themeCreate.userErrors.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Failed to create theme: ${JSON.stringify(
            themeCreate.userErrors
          )}`,
          userErrors: themeCreate.userErrors,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result: ThemeCreateResponse = {
      theme: themeCreate.theme
        ? {
            id: themeCreate.theme.id,
            name: themeCreate.theme.name,
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
