import type { ActionFunctionArgs } from "react-router";
import { apiVersion } from "../shopify.server";
import { verifyShopSession } from "../session.server";

interface FileUploadRequest {
  shop: string;
  fileData: string; // Base64 encoded file data
  filename?: string; // Optional filename, defaults to "theme-{timestamp}.zip"
  mimeType?: string; // Optional MIME type, defaults to "application/zip"
}

interface FileUploadResponse {
  resourceUrl: string | null;
  error?: string;
}

interface StagedUploadResponse {
  data?: {
    stagedUploadsCreate?: {
      stagedTargets: Array<{
        resourceUrl: string;
        url: string;
        parameters: Array<{
          name: string;
          value: string;
        }>;
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

// Public endpoint to upload files via Shopify staged uploads
// POST: /api/file/upload with JSON body { shop: "example.myshopify.com", fileData: "base64..." }
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
    let body: FileUploadRequest;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { shop, fileData, filename, mimeType } = body;

    if (!shop || !fileData) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: shop and fileData" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return await uploadFile({ shop, fileData, filename, mimeType });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Failed to upload file" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function uploadFile({
  shop,
  fileData,
  filename,
  mimeType = "application/zip",
}: Omit<FileUploadRequest, "shop"> & { shop: string }): Promise<Response> {
  // Verify shop session
  const sessionResult = await verifyShopSession(shop);
  if (!sessionResult.success) {
    return new Response(
      JSON.stringify({
        error: sessionResult.error.error,
        resourceUrl: null,
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

  // Convert base64 to buffer
  let archiveBuffer: Buffer;
  try {
    const base64Data = fileData.replace(/^data:.*,/, ""); // Remove data URL prefix if present
    archiveBuffer = Buffer.from(base64Data, "base64");
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Invalid file data. Expected base64 encoded string.",
        resourceUrl: null,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Generate filename if not provided
  const finalFilename = filename || `theme-${Date.now()}.zip`;

  try {
    // Step 1: Create staged upload
    console.log(`[${shop}] Creating staged upload...`);
    const stagedUploadResponse = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                resourceUrl
                url
                parameters {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          input: [
            {
              filename: finalFilename,
              mimeType,
              fileSize: archiveBuffer.length.toString(),
              resource: "FILE",
              httpMethod: "POST",
            },
          ],
        },
      }),
    });

    if (!stagedUploadResponse.ok) {
      const text = await stagedUploadResponse.text().catch(() => "");
      throw new Error(
        `stagedUploadsCreate failed: ${stagedUploadResponse.status} ${stagedUploadResponse.statusText} ${text}`
      );
    }

    const stagedUploadResult =
      (await stagedUploadResponse.json()) as StagedUploadResponse;

    console.log(
      `[${shop}] Staged upload result:`,
      JSON.stringify(stagedUploadResult, null, 2)
    );

    if (stagedUploadResult.errors?.length) {
      throw new Error(
        `Failed to create staged upload (top-level errors): ${JSON.stringify(
          stagedUploadResult.errors
        )}`
      );
    }

    const stagedCreate = stagedUploadResult.data?.stagedUploadsCreate;
    if (!stagedCreate) {
      throw new Error("stagedUploadsCreate missing in response");
    }

    if (stagedCreate.userErrors.length > 0) {
      throw new Error(
        `Failed to create staged upload: ${JSON.stringify(
          stagedCreate.userErrors
        )}`
      );
    }

    const stagedTarget = stagedCreate.stagedTargets[0];
    if (!stagedTarget) {
      console.error(`[${shop}] Failed to get staged upload target`);
      return new Response(
        JSON.stringify({
          error: "Failed to get staged upload target",
          resourceUrl: null,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Step 2: Upload file to staged upload URL
    console.log(`[${shop}] Uploading file to staged upload URL...`);

    // Use FormData so we don't have to hand-roll multipart
    const formData = new FormData();
    for (const param of stagedTarget.parameters || []) {
      formData.append(param.name, param.value);
    }

    // File MUST be the last field
    // Convert Buffer to Uint8Array for Blob constructor
    const zipBlob = new Blob([new Uint8Array(archiveBuffer)], { type: mimeType });
    formData.append("file", zipBlob, finalFilename);

    const uploadResponse = await fetch(stagedTarget.url, {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text().catch(() => "");
      throw new Error(
        `Failed to upload file to staged upload URL: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`
      );
    }

    console.log(
      `[${shop}] Successfully uploaded file to staged upload URL`
    );

    // Return the resourceUrl (this is what gets passed as originalSource to themeCreate)
    const result: FileUploadResponse = {
      resourceUrl: stagedTarget.resourceUrl,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[${shop}] File upload error:`, err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        resourceUrl: null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
