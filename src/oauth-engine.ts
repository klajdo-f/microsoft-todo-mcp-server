/**
 * OAuth engine — reusable MSAL wrapper for Microsoft Graph delegated-permission flow.
 *
 * Encapsulates ConfidentialClientApplication creation, authorization URL
 * generation, and authorization-code exchange.  All credential values are
 * read exclusively from process.env (env-only model per MEM016 / D006).
 *
 * Consumers (start-auth tool, tests) call `createOAuthEngine()` to obtain a
 * stateful engine instance whose `exchangeAuthCode()` returns a token payload
 * directly compatible with `TokenManager.saveTokens()`.
 */
import { ConfidentialClientApplication, Configuration, LogLevel, AuthenticationResult } from "@azure/msal-node"
import { logger } from "./infrastructure/logger.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scopes requested during the delegated-permission OAuth flow. */
export const DELEGATED_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "Tasks.Read",
  "Tasks.Read.Shared",
  "Tasks.ReadWrite",
  "Tasks.ReadWrite.Shared",
  "User.Read",
] as const

/** Shape returned by `exchangeAuthCode()` — compatible with TokenManager.saveTokens(). */
export interface OAuthTokenResult {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/** Error thrown when required environment variables are missing. */
export class OAuthConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing required OAuth environment variable(s): ${missing.join(", ")}`)
    this.name = "OAuthConfigError"
  }
}

/** Error thrown when the authorization-code exchange fails. */
export class OAuthExchangeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "OAuthExchangeError"
  }
}

// ---------------------------------------------------------------------------
// Engine factory
// ---------------------------------------------------------------------------

/**
 * Create an OAuth engine instance bound to the current process.env credentials.
 *
 * @throws {OAuthConfigError} if CLIENT_ID or CLIENT_SECRET is missing.
 */
export function createOAuthEngine(options?: {
  /** Override redirect URI (defaults to `REDIRECT_URI` env or `http://localhost:4040/callback`). */
  redirectUri?: string
}) {
  // --- Validate required env vars ---
  const clientId = process.env.CLIENT_ID
  const clientSecret = process.env.CLIENT_SECRET
  const tenantId = process.env.TENANT_ID || "organizations"
  const redirectUri = options?.redirectUri || process.env.REDIRECT_URI || "http://localhost:4040/callback"

  const missing: string[] = []
  if (!clientId) missing.push("CLIENT_ID")
  if (!clientSecret) missing.push("CLIENT_SECRET")
  if (missing.length > 0) {
    throw new OAuthConfigError(missing)
  }

  // --- Build MSAL configuration ---
  const msalConfig: Configuration = {
    auth: {
      clientId: clientId!,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret: clientSecret!,
    },
    system: {
      loggerOptions: {
        loggerCallback(_logLevel: LogLevel, message: string, _containsPii: boolean) {
          logger.debug(`[MSAL] ${message}`, { source: "msal" })
        },
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  }

  const cca = new ConfidentialClientApplication(msalConfig)

  // --- Returned engine object ---

  return {
    /** The redirect URI this engine is configured with. */
    redirectUri,

    /** The tenant ID used for authority resolution. */
    tenantId,

    /**
     * Generate the Microsoft OAuth 2.0 authorization URL that the user must
     * visit in a browser to grant delegated permissions.
     */
    async getAuthUrl(): Promise<string> {
      const params = {
        scopes: [...DELEGATED_SCOPES],
        redirectUri,
        prompt: "consent" as const,
      }

      return cca.getAuthCodeUrl(params)
    },

    /**
     * Exchange an authorization code (received at the callback) for tokens.
     *
     * Returns a payload shaped for `TokenManager.saveTokens()`.
     * Extracts the refresh token from the MSAL token cache because
     * `acquireTokenByCode` does not expose it directly.
     *
     * @throws {OAuthExchangeError} on any failure during code exchange.
     */
    async exchangeAuthCode(code: string): Promise<OAuthTokenResult> {
      try {
        const response: AuthenticationResult = await cca.acquireTokenByCode({
          code,
          scopes: [...DELEGATED_SCOPES],
          redirectUri,
        })

        // Extract refresh token from the MSAL token cache.
        // acquireTokenByCode doesn't return the refresh token in the
        // AuthenticationResult directly — it is stored in the internal cache.
        const tokenCache = cca.getTokenCache()
        const serializedCache = JSON.parse(await tokenCache.serialize())

        let refreshToken: string | null = null

        // Try standard MSAL cache locations
        if (serializedCache.RefreshToken && Object.keys(serializedCache.RefreshToken).length > 0) {
          const key = Object.keys(serializedCache.RefreshToken)[0]
          refreshToken = serializedCache.RefreshToken[key].secret
        } else if (serializedCache.RefreshTokens && Object.keys(serializedCache.RefreshTokens).length > 0) {
          const key = Object.keys(serializedCache.RefreshTokens)[0]
          refreshToken = serializedCache.RefreshTokens[key].secret
        } else {
          // Fallback: scan for any section containing "refresh"
          for (const section of Object.keys(serializedCache)) {
            if (section.toLowerCase().includes("refresh") && typeof serializedCache[section] === "object") {
              for (const key of Object.keys(serializedCache[section])) {
                const entry = serializedCache[section][key]
                if (entry?.secret) {
                  refreshToken = entry.secret
                  break
                }
              }
              if (refreshToken) break
            }
          }
        }

        const expiresInSeconds = (response as any).expiresIn || 3600
        const expiresAt = Date.now() + expiresInSeconds * 1000 - 5 * 60 * 1000

        return {
          accessToken: response.accessToken,
          refreshToken: refreshToken || "",
          expiresAt,
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new OAuthExchangeError(`Authorization code exchange failed: ${message}`, error)
      }
    },
  }
}

export type OAuthEngine = ReturnType<typeof createOAuthEngine>
