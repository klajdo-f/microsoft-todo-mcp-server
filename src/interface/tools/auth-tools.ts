/**
 * MCP tool handlers for authentication operations.
 *
 * Registers the `auth-status` and `start-auth` (authorization code) or
 * `start-device-auth` (device code) tools on an McpServer instance,
 * depending on the AUTH_FLOW environment variable.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { tokenRepository } from "../../infrastructure/token-repository.js"
import { startAuthFlow } from "../auth/auth-callback-server.js"
import { OAuthConfigError } from "../auth/oauth-engine.js"
import { createDeviceCodeEngine, DeviceCodeConfigError, DeviceCodeFlowHandle } from "../auth/device-code-engine.js"
import { openBrowser } from "../../infrastructure/open-browser.js"
import { handleToolError } from "../error-handler.js"
import { logger } from "../../infrastructure/logger.js"
import { formatAuthStatusText } from "./auth-helpers.js"
import { isDeviceCodeFlow } from "../auth/auth-flow-config.js"

// ---------------------------------------------------------------------------
// Module-level state — concurrent device code flow guard
// ---------------------------------------------------------------------------

let activeDeviceCodeHandle: DeviceCodeFlowHandle | null = null

// ---------------------------------------------------------------------------
// Named handlers
// ---------------------------------------------------------------------------

async function handleAuthStatus() {
  const tokens = await tokenRepository.getTokens()

  if (!tokens) {
    const flowMessage = isDeviceCodeFlow()
      ? 'Not authenticated. Provide CLIENT_ID via the MCP client\'s "env" field, then use the start-device-auth tool to authenticate with Microsoft.'
      : 'Not authenticated. Provide CLIENT_ID and CLIENT_SECRET via the MCP client\'s "env" field, then use the start-auth tool to authenticate with Microsoft.'
    return {
      content: [{ type: "text" as const, text: flowMessage }],
    }
  }

  const text = formatAuthStatusText(tokens)
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
// Device code flow handler
// ---------------------------------------------------------------------------

async function handleStartDeviceAuth() {
  // Concurrent guard: if a flow is already active, return the existing info.
  if (activeDeviceCodeHandle) {
    return {
      content: [
        {
          type: "text" as const,
          text: [
            "A device code authentication flow is already in progress.",
            "",
            `User code: ${activeDeviceCodeHandle.userCode}`,
            "",
            "Visit the URL below and enter the code:",
            `[Verify](${activeDeviceCodeHandle.verificationUri})`,
            "",
            "Or copy and paste the URL:",
            "```",
            activeDeviceCodeHandle.verificationUri,
            "```",
            "",
            "Tokens will be saved automatically once you complete authentication.",
          ].join("\n"),
        },
      ],
    }
  }

  try {
    const engine = createDeviceCodeEngine()
    const handle = engine.initiateDeviceCodeFlow()
    activeDeviceCodeHandle = handle

    // Background promise: log on success/failure, clear handle.
    // Token persistence is handled by the engine's MSAL cache layer.
    handle.result
      .then(() => {
        logger.info("[start-device-auth] Device code authentication completed successfully.", {
          source: "auth-tools",
        })
      })
      .catch((err: unknown) => {
        logger.error("[start-device-auth] Device code exchange failed.", {
          source: "auth-tools",
          error: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        activeDeviceCodeHandle = null
      })

    logger.info("[start-device-auth] Device code flow initiated.", {
      source: "auth-tools",
      verificationUri: handle.verificationUri,
    })

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Microsoft Device Code Authentication",
            "====================================",
            "",
            "To sign in, visit the URL below and enter the code when prompted.",
            "",
            `**Code:** \`${handle.userCode}\``,
            "",
            `[Click here to verify: ${handle.verificationUri}](${handle.verificationUri})`,
            "",
            "Or copy and paste the verification URL:",
            "```",
            handle.verificationUri,
            "```",
            "",
            "After you complete authentication, your tokens will be saved automatically.",
            "You can verify your status with the auth-status tool.",
          ].join("\n"),
        },
      ],
    }
  } catch (err: unknown) {
    // Config error — actionable message referencing only CLIENT_ID.
    if (err instanceof DeviceCodeConfigError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Device code configuration error: ${err.message}. Please ensure CLIENT_ID is set in your MCP client's "env" field.`,
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
  server.registerTool(
    "auth-status",
    {
      description:
        "Check if you're authenticated with Microsoft Graph API. Shows current token status and expiration time, and indicates if the token needs to be refreshed.",
      inputSchema: {},
    },
    handleAuthStatus,
  )

  if (isDeviceCodeFlow()) {
    server.registerTool(
      "start-device-auth",
      {
        description:
          "Start device code authentication with Microsoft. Displays a user code and verification URL — visit the URL on any device, enter the code, and complete sign-in. Tokens are saved automatically. Use this when you need to authenticate for the first time or when your tokens have expired.",
        inputSchema: {},
      },
      handleStartDeviceAuth,
    )
  } else {
    server.registerTool(
      "start-auth",
      {
        description:
          "Start the Microsoft OAuth authentication flow. Automatically opens your default browser to the authentication page. After you complete authentication, tokens are saved automatically. Use this when you need to authenticate for the first time or when your tokens have expired.",
        inputSchema: {},
      },
      handleStartAuth,
    )
  }
}
