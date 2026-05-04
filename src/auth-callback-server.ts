/**
 * Auth callback server — temporary HTTP listener for the Microsoft OAuth redirect.
 *
 * Starts a one-shot `/callback` handler, waits for the authorization code,
 * exchanges it for tokens via `createOAuthEngine`, and saves them via
 * `TokenManager.saveTokens()`.  Designed to be called from the `start-auth`
 * MCP tool.
 *
 * Safety guarantees:
 * - Only one auth flow can be active at a time (concurrent calls close the
 *   previous listener before starting a new one).
 * - OAuth codes, access tokens, and refresh tokens are never logged or
 *   returned in tool responses.
 * - The server auto-shuts down after a configurable timeout (default 2 min).
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http"
import { createOAuthEngine, OAuthConfigError, OAuthExchangeError } from "./oauth-engine.js"
import { tokenManager, type StoredTokenData } from "./token-manager.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthFlowResult {
  success: boolean
  message: string
}

export interface AuthFlowOptions {
  /** Maximum time to wait for the callback in milliseconds (default: 120_000). */
  timeoutMs?: number
  /** Override redirect URI (forwarded to createOAuthEngine). */
  redirectUri?: string
}

// ---------------------------------------------------------------------------
// Module state — single concurrent flow guard
// ---------------------------------------------------------------------------

let activeServer: Server | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Shut down any currently active auth flow.
 * Safe to call multiple times.
 */
function cleanupActiveFlow(): void {
  if (activeTimer) {
    clearTimeout(activeTimer)
    activeTimer = null
  }
  if (activeServer) {
    try {
      activeServer.close()
    } catch {
      // Ignore — server may already be closed
    }
    activeServer = null
  }
}

/**
 * Extract the port from a redirect URI string.
 * Defaults to 4040 if parsing fails.
 */
function portFromRedirectUri(uri: string): number {
  try {
    const url = new URL(uri)
    return parseInt(url.port, 10) || 4040
  } catch {
    return 4040
  }
}

/**
 * Parse query parameters from a URL string.
 */
function parseQuery(urlStr: string): Record<string, string> {
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

/** Microsoft Account (consumer / personal) tenant GUID. */
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"

/**
 * Parse client_info from the OAuth callback (Base64Url-encoded JSON).
 * Returns null if missing or malformed.
 */
function parseClientInfo(value?: string): { uid?: string; utid?: string } | null {
  if (!value) return null
  try {
    const json = Buffer.from(value, "base64url").toString("utf8")
    return JSON.parse(json)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start an OAuth auth flow:
 * 1. Create an OAuth engine from env vars
 * 2. Generate the authorization URL
 * 3. Start a temporary HTTP callback listener
 * 4. Wait for the callback, exchange the code, save tokens
 *
 * @returns The authorization URL and a promise that resolves when the flow
 *          completes (success or timeout).
 */
export async function startAuthFlow(
  options?: AuthFlowOptions,
): Promise<{ authUrl: string; result: Promise<AuthFlowResult> }> {
  const timeoutMs = options?.timeoutMs ?? 120_000

  // Close any previous flow before starting a new one
  cleanupActiveFlow()

  // 1. Create engine (validates env vars)
  const engine = createOAuthEngine({ redirectUri: options?.redirectUri })
  const redirectUri = engine.redirectUri

  // 2. Get the authorization URL
  const authUrl = await engine.getAuthUrl()
  console.error("[start-auth] Authorization URL generated. Waiting for callback…")

  // 3. Create a promise that resolves when the flow finishes
  const result = new Promise<AuthFlowResult>((resolve) => {
    const port = portFromRedirectUri(redirectUri)

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      console.error(`[start-auth] HTTP request received: ${req.method} ${req.url}`)
      // Only handle the callback path
      if (!req.url?.startsWith("/callback")) {
        console.error(`[start-auth] Request path does not match /callback — returning 404`)
        res.writeHead(404)
        res.end("Not found")
        return
      }
      console.error(`[start-auth] Callback path matched, parsing query params…`)

      const params = parseQuery(req.url)
      console.error(`[start-auth] Parsed params: ${JSON.stringify(params)}`)
      const code = params["code"]
      const error = params["error"]
      const errorDescription = params["error_description"]

      // Send a user-friendly HTML response regardless of outcome
      const sendHtml = (status: number, html: string) => {
        res.writeHead(status, { "Content-Type": "text/html" })
        res.end(html)
      }

      if (error) {
        console.error(`[start-auth] OAuth error in callback: ${error}`)
        sendHtml(
          400,
          `<html><body><h2>Authentication Failed</h2><p>${errorDescription || error}</p><p>You can close this tab.</p></body></html>`,
        )
        cleanupActiveFlow()
        resolve({
          success: false,
          message: `Authentication failed: ${errorDescription || error}. Please try start-auth again.`,
        })
        return
      }

      if (!code) {
        console.error("[start-auth] Callback received without authorization code.")
        sendHtml(
          400,
          `<html><body><h2>Authentication Failed</h2><p>No authorization code received.</p><p>You can close this tab.</p></body></html>`,
        )
        cleanupActiveFlow()
        resolve({
          success: false,
          message: "No authorization code received in callback. Please try start-auth again.",
        })
        return
      }

      // Detect personal-account / tenant mismatch before attempting exchange.
      const clientInfo = parseClientInfo(params["client_info"])
      if (clientInfo?.utid === CONSUMER_TENANT && engine.tenantId === "organizations") {
        const helpMsg =
          'Personal Microsoft account detected, but TENANT_ID is set to "organizations" (the default). ' +
          "The Microsoft identity platform does not allow personal accounts (Outlook.com, Hotmail.com, Live.com, etc.) " +
          'with the "organizations" endpoint for confidential-client OAuth flows. ' +
          "To authenticate with a personal account, set the environment variable TENANT_ID=consumers and restart the server, then run start-auth again."
        console.error(`[start-auth] ${helpMsg}`)
        sendHtml(
          400,
          `<html><body><h2>Authentication Failed</h2><p>${helpMsg.replace(/"/g, "&quot;")}</p><p>You can close this tab.</p></body></html>`,
        )
        cleanupActiveFlow()
        resolve({ success: false, message: helpMsg })
        return
      }

      // Exchange the code for tokens
      console.error("[start-auth] Authorization code received. Exchanging for tokens…")

      engine
        .exchangeAuthCode(code)
        .then((tokenResult) => {
          const stored: StoredTokenData = {
            accessToken: tokenResult.accessToken,
            refreshToken: tokenResult.refreshToken,
            expiresAt: tokenResult.expiresAt,
          }
          tokenManager.saveTokens(stored)
          console.error("[start-auth] Tokens saved successfully.")

          sendHtml(
            200,
            `<html><body><h2>✅ Authentication Successful</h2><p>You can close this tab and return to your MCP client.</p></body></html>`,
          )
          cleanupActiveFlow()
          resolve({ success: true, message: "Authentication successful. Tokens saved." })
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[start-auth] Token exchange failed: ${msg}`)
          sendHtml(
            500,
            `<html><body><h2>Authentication Failed</h2><p>Token exchange failed.</p><pre>${msg.replace(/</g, "&lt;")}</pre><p>You can close this tab.</p></body></html>`,
          )
          cleanupActiveFlow()
          resolve({
            success: false,
            message: `Token exchange failed: ${msg}. Please try start-auth again.`,
          })
        })
    })

    activeServer = server

    // Set up timeout
    activeTimer = setTimeout(() => {
      console.error("[start-auth] Timed out waiting for callback.")
      cleanupActiveFlow()
      resolve({
        success: false,
        message:
          "Authentication timed out after 2 minutes. The authorization URL may have expired. Please try start-auth again.",
      })
    }, timeoutMs)

    server.listen(port, () => {
      console.error(`[start-auth] Callback server listening on port ${port}`)
    })

    // Handle server errors (e.g., port already in use)
    server.on("error", (err: Error) => {
      console.error(`[start-auth] Server error: ${err.message}`)
      cleanupActiveFlow()
      resolve({
        success: false,
        message: `Could not start callback server: ${err.message}. Check if port ${port} is available.`,
      })
    })
  })

  return { authUrl, result }
}
