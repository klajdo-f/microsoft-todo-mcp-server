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
// Refresh token extraction
// ---------------------------------------------------------------------------

/**
 * Extract the refresh token from the serialised MSAL token cache.
 *
 * `acquireTokenByCode` stores the refresh token internally rather than
 * returning it directly. This function probes several known cache section
 * names used across MSAL versions.
 */
function extractRefreshTokenFromCache(serializedCache: Record<string, unknown>): string {
  // Try standard MSAL cache locations
  const sections = [
    serializedCache["RefreshToken"] as Record<string, Record<string, unknown>> | undefined,
    serializedCache["RefreshTokens"] as Record<string, Record<string, unknown>> | undefined,
  ]

  for (const section of sections) {
    if (section && typeof section === "object" && Object.keys(section).length > 0) {
      const key = Object.keys(section)[0]
      const entry = section[key]
      if (entry?.secret && typeof entry.secret === "string") {
        return entry.secret
      }
    }
  }

  // Fallback: scan for any section containing "refresh"
  for (const sectionName of Object.keys(serializedCache)) {
    if (sectionName.toLowerCase().includes("refresh") && typeof serializedCache[sectionName] === "object") {
      const section = serializedCache[sectionName] as Record<string, Record<string, unknown>>
      for (const key of Object.keys(section)) {
        const entry = section[key]
        if (entry?.secret && typeof entry.secret === "string") {
          return entry.secret
        }
      }
    }
  }

  return ""
}

/**
 * Safely extract `expiresIn` from an MSAL AuthenticationResult.
 * The property is not typed in the official interface but is present at runtime.
 */
function safeExpiresInSeconds(response: AuthenticationResult): number {
  const candidate = (response as Record<string, unknown>).expiresIn
  return typeof candidate === "number" ? candidate : 3600
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

        const tokenCache = cca.getTokenCache()
        const serializedCache = JSON.parse(await tokenCache.serialize()) as Record<string, unknown>
        const refreshToken = extractRefreshTokenFromCache(serializedCache)

        const expiresInSeconds = safeExpiresInSeconds(response)
        const expiresAt = Date.now() + expiresInSeconds * 1000 - 5 * 60 * 1000

        return {
          accessToken: response.accessToken,
          refreshToken,
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
