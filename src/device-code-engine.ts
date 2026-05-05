/**
 * Device code engine — MSAL wrapper for OAuth 2.0 Device Authorization Grant.
 *
 * Uses `PublicClientApplication` (public client — no client secret required).
 * Consumers call `createDeviceCodeEngine()` to obtain an engine whose
 * `initiateDeviceCodeFlow()` returns a handle with the user code, verification
 * URI, and a deferred promise that resolves to `OAuthTokenResult` when the
 * user completes authentication on a separate device.
 *
 * All credential values are read exclusively from process.env (env-only model).
 */
import { PublicClientApplication, Configuration, LogLevel, AuthenticationResult } from "@azure/msal-node"
import { logger } from "./infrastructure/logger.js"
import { CONSUMER_TENANT } from "./auth-callback-helpers.js"

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

/** Shape returned by device code flow — compatible with TokenManager.saveTokens(). */
export interface OAuthTokenResult {
  accessToken: string
  refreshToken: string
  expiresAt: number
  /** True when the authenticated account is a personal (consumer) Microsoft account. */
  isPersonalAccount?: boolean
}

/** Handle returned by `initiateDeviceCodeFlow()`. */
export interface DeviceCodeFlowHandle {
  /** Short code the user enters at the verification URI. */
  userCode: string
  /** URL the user visits to enter the code. */
  verificationUri: string
  /** Human-readable instructions to display to the user. */
  message: string
  /** Promise that resolves when the user completes authentication. */
  result: Promise<OAuthTokenResult>
}

/** Error thrown when required environment variables are missing. */
export class DeviceCodeConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing required device-code environment variable(s): ${missing.join(", ")}`)
    this.name = "DeviceCodeConfigError"
  }
}

/** Error thrown when the device code exchange fails. */
export class DeviceCodeExchangeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "DeviceCodeExchangeError"
  }
}

// ---------------------------------------------------------------------------
// Refresh token extraction
// ---------------------------------------------------------------------------

/**
 * Extract the refresh token from the serialised MSAL token cache.
 *
 * Probes several known cache section names used across MSAL versions,
 * identical to the pattern in oauth-engine.ts.
 */
function extractRefreshTokenFromCache(serializedCache: Record<string, unknown>): string {
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
 * Create a device code engine instance bound to the current process.env.
 *
 * @throws {DeviceCodeConfigError} if CLIENT_ID is missing.
 */
export function createDeviceCodeEngine() {
  // --- Validate required env vars (public client — only CLIENT_ID needed) ---
  const clientId = process.env.CLIENT_ID
  const tenantId = process.env.TENANT_ID || "organizations"

  const missing: string[] = []
  if (!clientId) missing.push("CLIENT_ID")
  if (missing.length > 0) {
    throw new DeviceCodeConfigError(missing)
  }

  // --- Build MSAL configuration ---
  const msalConfig: Configuration = {
    auth: {
      clientId: clientId!,
      authority: `https://login.microsoftonline.com/${tenantId}`,
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

  const pca = new PublicClientApplication(msalConfig)

  // --- Returned engine object ---

  return {
    /** The tenant ID used for authority resolution. */
    tenantId,

    /**
     * Initiate a device code flow. Returns a handle containing the user code,
     * verification URI, human-readable message, and a deferred promise that
     * resolves to OAuthTokenResult when authentication completes.
     *
     * Uses a deferred promise pattern: the MSAL deviceCodeCallback fires
     * immediately with the user code info, while acquireTokenByDeviceCode
     * polls internally until the user authenticates.
     *
     * @throws {DeviceCodeExchangeError} on any failure during the flow.
     */
    initiateDeviceCodeFlow(): DeviceCodeFlowHandle {
      let resolveResult: ((value: OAuthTokenResult) => void) | null = null
      let rejectResult: ((reason: unknown) => void) | null = null

      const resultPromise = new Promise<OAuthTokenResult>((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      })

      // Initialise handle before calling MSAL so the deviceCodeCallback
      // can populate fields even when invoked synchronously (as MSAL does).
      const handle: DeviceCodeFlowHandle = {
        userCode: "",
        verificationUri: "",
        message: "",
        result: resultPromise,
      }

      pca
        .acquireTokenByDeviceCode({
          scopes: [...DELEGATED_SCOPES],
          deviceCodeCallback(response) {
            // This callback fires once with the device code response.
            // Populate the handle fields and log for observability.
            logger.info("Device code flow initiated", {
              source: "device-code-engine",
              userCodeLength: response.userCode.length,
              verificationUri: response.verificationUri,
            })

            handle.userCode = response.userCode
            handle.verificationUri = response.verificationUri
            handle.message = response.message
          },
        })
        .then((authResult) => {
          if (!authResult) {
            throw new DeviceCodeExchangeError("Device code flow returned null — user may have cancelled")
          }

          const raw = pca.getTokenCache().serialize()
          const serializedCache = JSON.parse(raw) as Record<string, unknown>
          const refreshToken = extractRefreshTokenFromCache(serializedCache)

          const expiresInSeconds = safeExpiresInSeconds(authResult)
          const expiresAt = Date.now() + expiresInSeconds * 1000 - 5 * 60 * 1000

          logger.info("Device code exchange succeeded", {
            source: "device-code-engine",
            expiresInSeconds,
          })

          // Detect personal (consumer) accounts by comparing tenant ID
          // against the well-known consumer tenant GUID, consistent with
          // the auth-code callback handler in auth-callback-helpers.ts.
          const effectiveTenantId = authResult.tenantId ?? authResult.account?.tenantId
          const isPersonalAccount = effectiveTenantId === CONSUMER_TENANT

          const tokenResult: OAuthTokenResult = {
            accessToken: authResult.accessToken,
            refreshToken,
            expiresAt,
            ...(isPersonalAccount ? { isPersonalAccount: true } : {}),
          }

          resolveResult!(tokenResult)
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          const wrapped = new DeviceCodeExchangeError(`Device code exchange failed: ${message}`, error)
          logger.error("Device code exchange failed", {
            source: "device-code-engine",
            errorMessage: message,
          })
          rejectResult!(wrapped)
        })

      return handle
    },
  }
}

export type DeviceCodeEngine = ReturnType<typeof createDeviceCodeEngine>
