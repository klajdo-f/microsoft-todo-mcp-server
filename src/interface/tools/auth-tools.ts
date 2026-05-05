/**
 * MCP tool handlers for authentication operations.
 *
 * Registers the `auth-status` and `start-auth` tools on an McpServer instance.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { tokenManager } from "../../token-manager.js"
import { startAuthFlow } from "../../auth-callback-server.js"
import { OAuthConfigError } from "../../oauth-engine.js"
import { openBrowser } from "../../open-browser.js"
import { handleToolError } from "../error-handler.js"
import { logger } from "../../infrastructure/logger.js"
import { formatAuthStatusText } from "./auth-helpers.js"

// ---------------------------------------------------------------------------
// Named handlers
// ---------------------------------------------------------------------------

async function handleAuthStatus() {
  const tokens = await tokenManager.getTokens()

  if (!tokens) {
    return {
      content: [
        {
          type: "text" as const,
          text: 'Not authenticated. Provide CLIENT_ID and CLIENT_SECRET via the MCP client\'s "env" field, then use the start-auth tool to authenticate with Microsoft.',
        },
      ],
    }
  }

  const isPersonal = tokens?.isPersonalAccount === true
  const text = formatAuthStatusText(tokens, isPersonal)
  return { content: [{ type: "text" as const, text }] }
}

async function handleStartAuth() {
  try {
    const { authUrl, result } = await startAuthFlow({ timeoutMs: 600_000 })

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

    await openBrowser(authUrl)

    const osc8Open = "\u001b]8;;"
    const osc8Close = "\u0007"
    logger.info(`[start-auth] ${osc8Open}${authUrl}${osc8Close}🔗 Click here to authenticate${osc8Open}${osc8Close}`, {
      source: "auth-tools",
    })

    return {
      content: [
        {
          type: "text" as const,
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
            "",
            "Note: If you authenticate with a personal Microsoft account (Outlook.com, Hotmail.com, Live.com, etc.), Microsoft To Do API access may be unavailable through the Microsoft Graph API. This is a Microsoft platform restriction, not an authentication issue.",
          ].join("\n"),
        },
      ],
    }
  } catch (err: unknown) {
    if (err instanceof OAuthConfigError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Authentication configuration error: ${err.message}. Please ensure CLIENT_ID and CLIENT_SECRET are set in your MCP client's "env" field.`,
          },
        ],
      }
    }
    return handleToolError(err)
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerAuthTools(server: McpServer): void {
  server.tool(
    "auth-status",
    "Check if you're authenticated with Microsoft Graph API. Shows current token status and expiration time, and indicates if the token needs to be refreshed.",
    {},
    handleAuthStatus,
  )

  server.tool(
    "start-auth",
    "Start the Microsoft OAuth authentication flow. Automatically opens your default browser to the authentication page. After you complete authentication, tokens are saved automatically. Use this when you need to authenticate for the first time or when your tokens have expired.",
    {},
    handleStartAuth,
  )
}
