/**
 * Pure helper functions for the auth callback server.
 *
 * All functions are side-effect-free and can be tested in isolation.
 * Extracted from auth-callback-server.ts to keep the server file focused
 * on HTTP lifecycle management.
 */

// ---------------------------------------------------------------------------
// Query / URI helpers
// ---------------------------------------------------------------------------

/**
 * Extract the port number from a redirect URI string.
 * Defaults to 4040 if parsing fails.
 */
export function portFromRedirectUri(uri: string): number {
  try {
    const url = new URL(uri)
    return parseInt(url.port, 10) || 4040
  } catch {
    return 4040
  }
}

/**
 * Parse query parameters from a URL string into a simple key-value map.
 */
export function parseQuery(urlStr: string): Record<string, string> {
  const params: Record<string, string> = {}
  try {
    const url = new URL(urlStr, "http://localhost")
    url.searchParams.forEach((value, key) => {
      params[key] = value
    })
  } catch {
    // Fallback: manual parsing
    const search = urlStr.split("?")[1] || ""
    for (const pair of search.split("&")) {
      const [key, value] = pair.split("=")
      if (key) {
        params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : ""
      }
    }
  }
  return params
}

// ---------------------------------------------------------------------------
// Client info parsing
// ---------------------------------------------------------------------------

/** Microsoft Account (consumer / personal) tenant GUID. */
export const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"

/**
 * Parse client_info from the OAuth callback (Base64Url-encoded JSON).
 * Returns null if missing or malformed.
 */
export function parseClientInfo(value?: string): { uid?: string; utid?: string } | null {
  if (!value) return null
  try {
    const json = Buffer.from(value, "base64url").toString("utf8")
    return JSON.parse(json)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// HTML response builders
// ---------------------------------------------------------------------------

/**
 * Send an HTML response via the Node.js ServerResponse object.
 */
export function sendHtmlResponse(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (html: string) => void },
  status: number,
  html: string,
): void {
  res.writeHead(status, { "Content-Type": "text/html" })
  res.end(html)
}

/**
 * Build the success HTML page shown after a successful token exchange.
 */
export function buildSuccessHtml(): string {
  return `<html><body><h2>✅ Authentication Successful</h2><p>You can close this tab and return to your MCP client.</p></body></html>`
}

/**
 * Build a failure HTML page with an escaped message.
 */
export function buildFailureHtml(message: string): string {
  const escaped = message.replace(/</g, "&lt;").replace(/"/g, "&quot;")
  return `<html><body><h2>Authentication Failed</h2><p>${escaped}</p><p>You can close this tab.</p></body></html>`
}
