/**
 * MCP tool handlers for authentication operations.
 *
 * Registers the `auth-status` and `start-auth` tools on an McpServer instance.
 * All Zod schemas, descriptions, and response shapes are preserved from the
 * original todo-index.ts god file.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { tokenManager } from "../../token-manager.js"
import { getAccessToken, MS_GRAPH_BASE } from "../../infrastructure/graph-client.js"
import { startAuthFlow } from "../../auth-callback-server.js"
import { OAuthConfigError } from "../../oauth-engine.js"
import { openBrowser } from "../../open-browser.js"
import { handleToolError } from "../error-handler.js"
import { logger } from "../../infrastructure/logger.js"

// ---------------------------------------------------------------------------
// Helper: personal-account detection
// ---------------------------------------------------------------------------

const PERSONAL_DOMAINS = ["outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com"]

async function isPersonalMicrosoftAccount(): Promise<boolean> {
  try {
    const token = await getAccessToken()
    if (!token) return false

    const url = `${MS_GRAPH_BASE}/me`
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      logger.error("Error getting user info", { source: "auth-tools", status: response.status })
      return false
    }

    const userData = await response.json()
    const email = userData.mail || userData.userPrincipalName || ""
    const domain = email.split("@")[1]?.toLowerCase()

    if (domain && PERSONAL_DOMAINS.some((d) => domain.includes(d))) {
      logger.warn(
        "Personal Microsoft Account Detected: " +
          `Your Microsoft account (${email}) appears to be a personal account. ` +
          "Microsoft To Do API access is typically not available for personal accounts " +
          "through the Microsoft Graph API, only for Microsoft 365 business accounts. " +
          "You may encounter the 'MailboxNotEnabledForRESTAPI' error when trying to " +
          "access To Do lists or tasks. This is a limitation of the Microsoft Graph API, " +
          "not an issue with your authentication or this application. " +
          "You can still use Microsoft To Do through the web interface or mobile apps, " +
          "but API access is restricted for personal accounts.",
        { source: "auth-tools", email },
      )
      return true
    }

    return false
  } catch (error) {
    logger.error("Error checking account type", {
      source: "auth-tools",
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerAuthTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // auth-status
  // -----------------------------------------------------------------------
  server.tool(
    "auth-status",
    "Check if you're authenticated with Microsoft Graph API. Shows current token status and expiration time, and indicates if the token needs to be refreshed.",
    {},
    async () => {
      const tokens = await tokenManager.getTokens()

      if (!tokens) {
        return {
          content: [
            {
              type: "text",
              text: 'Not authenticated. Provide CLIENT_ID and CLIENT_SECRET via the MCP client\'s "env" field, then use the start-auth tool to authenticate with Microsoft.',
            },
          ],
        }
      }

      const isExpired = Date.now() > tokens.expiresAt
      const expiryTime = new Date(tokens.expiresAt).toLocaleString()

      // Check if it's a personal account
      const isPersonal = await isPersonalMicrosoftAccount()
      let accountMessage = ""

      if (isPersonal) {
        accountMessage =
          "\n\n⚠️ WARNING: You are using a personal Microsoft account. " +
          "Microsoft To Do API access is typically not available for personal accounts " +
          "through the Microsoft Graph API. You may encounter 'MailboxNotEnabledForRESTAPI' errors. " +
          "This is a Microsoft limitation, not an authentication issue."
      }

      // Build refresh failure metadata section if present
      let refreshFailureMessage = ""
      if (tokens.lastRefreshError) {
        const attemptTime = tokens.lastRefreshAttempt
          ? new Date(tokens.lastRefreshAttempt).toLocaleString()
          : "unknown time"
        refreshFailureMessage = `\n\n⚠️ Last token refresh failed at ${attemptTime}: ${tokens.lastRefreshError}`
      }

      if (isExpired) {
        return {
          content: [
            {
              type: "text",
              text: `Authentication expired at ${expiryTime}. Will attempt to refresh when you call any API.${accountMessage}${refreshFailureMessage}`,
            },
          ],
        }
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Authenticated. Token expires at ${expiryTime}.${accountMessage}${refreshFailureMessage}`,
            },
          ],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // start-auth
  // -----------------------------------------------------------------------
  server.tool(
    "start-auth",
    "Start the Microsoft OAuth authentication flow. Automatically opens your default browser to the authentication page. After you complete authentication, tokens are saved automatically. Use this when you need to authenticate for the first time or when your tokens have expired.",
    {},
    async () => {
      try {
        const { authUrl, result } = await startAuthFlow({ timeoutMs: 600_000 })

        // Run the auth flow in the background so the user gets the URL
        // immediately instead of blocking for the entire duration.
        result
          .then((flowResult) => {
            if (flowResult.success) {
              logger.info("[start-auth] Authentication completed successfully.", { source: "auth-tools" })
            } else {
              logger.error("[start-auth] Authentication failed", { source: "auth-tools", message: flowResult.message })
            }
          })
          .catch((err: unknown) => {
            logger.error("[start-auth] Auth flow error", {
              source: "auth-tools",
              error: err instanceof Error ? err.message : String(err),
            })
          })

        // Open the default browser automatically
        await openBrowser(authUrl)

        // Emit an OSC 8 hyperlink to stderr for terminal-native clickability
        // (supported by Windows Terminal >= 1.4, iTerm2, GNOME Terminal, etc.)
        const osc8Open = "\u001b]8;;"
        const osc8Close = "\u0007"
        logger.info(
          `[start-auth] ${osc8Open}${authUrl}${osc8Close}🔗 Click here to authenticate${osc8Open}${osc8Close}`,
          { source: "auth-tools" },
        )

        return {
          content: [
            {
              type: "text",
              text: [
                "Opening your default browser for Microsoft authentication…",
                "",
                "If it didn't open automatically, use one of the options below:",
                "",
                `[Click to authenticate](${authUrl})`,
                "",
                "Or copy and paste the full URL:",
                "```",
                authUrl,
                "```",
                "",
                "After you complete authentication, your tokens will be saved automatically.",
                "You can verify your status with the auth-status tool.",
              ].join("\n"),
            },
          ],
        }
      } catch (err: unknown) {
        if (err instanceof OAuthConfigError) {
          return {
            content: [
              {
                type: "text",
                text: `Authentication configuration error: ${err.message}. Please ensure CLIENT_ID and CLIENT_SECRET are set in your MCP client's "env" field.`,
              },
            ],
          }
        }
        return handleToolError(err)
      }
    },
  )
}
