import type { ActionFunctionArgs } from "react-router";
import { apiVersion } from "../shopify.server";
import { verifyShopSession } from "../session.server";

interface ThemeFileInput {
  filename: string;
  content: string;
  encoding?: "base64";
}

interface ThemeUpdateRequest {
  shop: string;
  themeId: string; // Theme ID (numeric, will be converted to GID)
  files: ThemeFileInput[]; // Array of files to create or update
}

interface ThemeUpdateResponse {
  upsertedFiles?: Array<{
    filename: string;
  }>;
  userErrors?: Array<{
    field: string[];
    message: string;
  }>;
  error?: string;
}

interface ThemeFilesUpsertGraphQLResponse {
  data?: {
    themeFilesUpsert?: {
      upsertedThemeFiles?: Array<{
        filename: string;
      }>;
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

// Public endpoint to update theme files using themeFilesUpsert
// POST: /api/theme/update with JSON body:
// {
//   "shop": "example.myshopify.com",
//   "themeId": "123",
//   "files": [
//     { "filename": "templates/index.liquid", "content": "<div>...</div>" }
//   ]
// }
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

    const { shop, themeId, files } = body;

    if (!shop || !themeId || !files) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: shop, themeId, and files",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({
          error: "files must be a non-empty array",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate each file has required fields
    for (const file of files) {
      if (!file.filename || file.content === undefined) {
        return new Response(
          JSON.stringify({
            error: "Each file must have 'filename' and 'content' fields",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    return await updateThemeFiles({ shop, themeId, files });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Failed to update theme files" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function updateThemeFiles({
  shop,
  themeId,
  files,
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

  // Transform files to GraphQL input format
  const filesInput = files.map((file) => ({
    filename: file.filename,
    body: {
      type: file.encoding === "base64" ? "BASE64" as const : "TEXT" as const,
      value: file.content,
    },
  }));

  // Make GraphQL mutation using themeFilesUpsert
  try {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation themeFilesUpsert($files: [OnlineStoreThemeFilesUpsertFileInput!]!, $themeId: ID!) {
            themeFilesUpsert(files: $files, themeId: $themeId) {
              upsertedThemeFiles {
                filename
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          themeId: `gid://shopify/OnlineStoreTheme/${themeId}`,
          files: filesInput,
        },
      }),
    });

    const data = (await response.json()) as ThemeFilesUpsertGraphQLResponse;

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

    const themeFilesUpsert = data.data?.themeFilesUpsert;
    if (!themeFilesUpsert) {
      return new Response(
        JSON.stringify({
          error: "themeFilesUpsert missing in response",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check for user errors
    if (themeFilesUpsert.userErrors.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Failed to update theme files: ${JSON.stringify(
            themeFilesUpsert.userErrors
          )}`,
          userErrors: themeFilesUpsert.userErrors,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result: ThemeUpdateResponse = {
      upsertedFiles: themeFilesUpsert.upsertedThemeFiles?.map((file) => ({
        filename: file.filename,
      })),
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
