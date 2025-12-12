import db from "./db.server";

export interface SessionData {
  shop: string;
  accessToken: string;
  normalizedShop: string;
}

export interface SessionError {
  error: string;
  status: number;
}

export type SessionVerificationResult =
  | { success: true; session: SessionData }
  | { success: false; error: SessionError };

/**
 * Normalizes a shop domain by removing protocol and trailing slashes
 */
export function normalizeShopDomain(shop: string): string {
  return shop
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * Verifies and retrieves a shop session from the database.
 * Returns either the session data or error information.
 *
 * @param shop - The shop domain (e.g., "example.myshopify.com" or "https://example.myshopify.com")
 * @returns Either a success result with session data or a failure result with error details
 *
 * @example
 * ```ts
 * const result = await verifyShopSession(shop);
 * if (!result.success) {
 *   return new Response(
 *     JSON.stringify({ error: result.error.error }),
 *     { status: result.error.status, headers: { "Content-Type": "application/json" } }
 *   );
 * }
 * // Use result.session.accessToken, result.session.shop, etc.
 * const graphqlUrl = `https://${result.session.normalizedShop}/admin/api/...`;
 * ```
 */
export async function verifyShopSession(
  shop: string
): Promise<SessionVerificationResult> {
  const normalizedShop = normalizeShopDomain(shop);

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
    return {
      success: false,
      error: {
        error: "No session found for shop. Please install the app first.",
        status: 404,
      },
    };
  }

  // Check if session is expired
  if (session.expires && session.expires < new Date()) {
    return {
      success: false,
      error: {
        error: "Session expired. Please reinstall the app.",
        status: 401,
      },
    };
  }

  return {
    success: true,
    session: {
      shop: session.shop,
      accessToken: session.accessToken,
      normalizedShop,
    },
  };
}

