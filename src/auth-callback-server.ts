/**
 * Auth callback server — temporary HTTP listener for the Microsoft OAuth redirect.
 *
 * Starts a one-shot `/callback` handler, waits for the authorization code,
 * exchanges it for tokens via `createOAuthEngine`, and saves them via
 * `TokenManager.saveTokens()`.  Designed to be called from the `start-auth`
 * MCP tool.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http"
import { createOAuthEngine, type OAuthEngine } from "./oauth-engine.js"
import { tokenRepository as tokenManager } from "./infrastructure/token-repository.js"
import { logger } from "./infrastructure/logger.js"
import {
  portFromRedirectUri,
  parseQuery,
  parseClientInfo,
  CONSUMER_TENANT,
  sendHtmlResponse,
  buildSuccessHtml,
  buildFailureHtml,
} from "./auth-callback-helpers.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthFlowResult {
  success: boolean
  message: string
}
export interface AuthFlowOptions {
  timeoutMs?: number
  redirectUri?: string
}

// ---------------------------------------------------------------------------
// Module state — single concurrent flow guard
// ---------------------------------------------------------------------------

let activeServer: Server | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null

function cleanupActiveFlow(): void {
  if (activeTimer) {
    clearTimeout(activeTimer)
    activeTimer = null
  }
  if (activeServer) {
    try {
      activeServer.close()
    } catch {
      /* already closed */
    }
    activeServer = null
  }
}

// ---------------------------------------------------------------------------
// Callback handler builder
// ---------------------------------------------------------------------------

function failFlow(
  res: ServerResponse,
  resolve: (r: AuthFlowResult) => void,
  status: number,
  htmlMsg: string,
  resultMsg: string,
  logLevel: "warn" | "error",
  logMsg: string,
): void {
  logger[logLevel](logMsg, { source: "start-auth" })
  sendHtmlResponse(res, status, buildFailureHtml(htmlMsg))
  cleanupActiveFlow()
  resolve({ success: false, message: resultMsg })
}

const PERSONAL_ACCOUNT_HELP =
  'Personal Microsoft account detected, but TENANT_ID is set to "organizations" (the default). ' +
  "The Microsoft identity platform does not allow personal accounts (Outlook.com, Hotmail.com, Live.com, etc.) " +
  'with the "organizations" endpoint for confidential-client OAuth flows. ' +
  "To fix this:\n\n" +
  "1. Set the environment variable TENANT_ID=consumers and restart the server, then run start-auth again.\n" +
  "2. Sign up for a free Microsoft 365 developer tenant at https://developer.microsoft.com/microsoft-365/dev-program " +
  "and use that tenant ID instead (provides full API access)."

function buildCallbackHandler(
  engine: OAuthEngine,
  resolve: (r: AuthFlowResult) => void,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (!req.url?.startsWith("/callback")) {
      res.writeHead(404)
      res.end("Not found")
      return
    }
    const params = parseQuery(req.url)
    const { code, error, error_description: errorDesc } = params as Record<string, string>

    if (error) {
      failFlow(
        res,
        resolve,
        400,
        errorDesc || error,
        `Authentication failed: ${errorDesc || error}. Please try start-auth again.`,
        "error",
        `[start-auth] OAuth error in callback: ${error}`,
      )
      return
    }
    if (!code) {
      failFlow(
        res,
        resolve,
        400,
        "No authorization code received.",
        "No authorization code received in callback. Please try start-auth again.",
        "warn",
        "[start-auth] Callback received without authorization code.",
      )
      return
    }
    const clientInfo = parseClientInfo(params["client_info"])
    if (clientInfo?.utid === CONSUMER_TENANT && engine.tenantId === "organizations") {
      failFlow(
        res,
        resolve,
        400,
        PERSONAL_ACCOUNT_HELP,
        PERSONAL_ACCOUNT_HELP,
        "warn",
        `[start-auth] ${PERSONAL_ACCOUNT_HELP}`,
      )
      return
    }

    logger.info("[start-auth] Authorization code received. Exchanging for tokens…", { source: "start-auth" })
    engine
      .exchangeAuthCode(code)
      .then((tokenResult) => {
        const isPersonal = clientInfo?.utid === CONSUMER_TENANT
        const warning = isPersonal
          ? "Personal Microsoft account detected. Some Microsoft Graph features (e.g. shared task lists) may be unavailable for personal accounts. " +
            "To get full API access, consider: (1) using a work/school account, or (2) signing up for a free Microsoft 365 developer tenant at https://developer.microsoft.com/microsoft-365/dev-program."
          : undefined

        tokenManager.saveTokens({
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          expiresAt: tokenResult.expiresAt,
          isPersonalAccount: isPersonal || undefined,
        })
        logger.info("[start-auth] Tokens saved successfully." + (isPersonal ? " (personal account)" : ""), {
          source: "start-auth",
          isPersonalAccount: isPersonal,
        })
        sendHtmlResponse(res, 200, buildSuccessHtml(warning))
        cleanupActiveFlow()
        resolve({
          success: true,
          message: warning ? `Authentication successful. ${warning}` : "Authentication successful. Tokens saved.",
        })
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        failFlow(
          res,
          resolve,
          500,
          `Token exchange failed: ${msg}`,
          `Token exchange failed: ${msg}. Please try start-auth again.`,
          "error",
          `[start-auth] Token exchange failed: ${msg}`,
        )
      })
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startAuthFlow(
  options?: AuthFlowOptions,
): Promise<{ authUrl: string; result: Promise<AuthFlowResult> }> {
  const timeoutMs = options?.timeoutMs ?? 120_000
  cleanupActiveFlow()
  const engine = createOAuthEngine({ redirectUri: options?.redirectUri })
  const authUrl = await engine.getAuthUrl()
  logger.info("[start-auth] Authorization URL generated. Waiting for callback…", { source: "start-auth" })

  const result = new Promise<AuthFlowResult>((resolve) => {
    const port = portFromRedirectUri(engine.redirectUri)
    const server = createServer(buildCallbackHandler(engine, resolve))
    activeServer = server
    activeTimer = setTimeout(() => {
      logger.warn("[start-auth] Timed out waiting for callback.", { source: "start-auth", timeoutMs })
      cleanupActiveFlow()
      resolve({
        success: false,
        message:
          "Authentication timed out after 2 minutes. The authorization URL may have expired. Please try start-auth again.",
      })
    }, timeoutMs)
    server.listen(port, () =>
      logger.info(`[start-auth] Callback server listening on port ${port}`, { source: "start-auth", port }),
    )
    server.on("error", (err: Error) => {
      logger.error("[start-auth] Server error", { source: "start-auth", error: err.message })
      cleanupActiveFlow()
      resolve({
        success: false,
        message: `Could not start callback server: ${err.message}. Check if port ${port} is available.`,
      })
    })
  })

  return { authUrl, result }
}
