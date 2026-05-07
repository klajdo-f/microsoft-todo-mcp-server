/**
 * Unified MSAL client factory — single source of truth for MSAL app creation.
 *
 * Reads AUTH_FLOW and process.env credentials to build a shared MSAL
 * Configuration (authority, logger options, scopes), then returns a
 * discriminated-union MsalClient wrapping either a ConfidentialClientApplication
 * (authorization_code flow) or PublicClientApplication (device_code flow).
 *
 * The module is stateless at import time — env validation happens inside the
 * factory call, not at module load. Downstream consumers (oauth-engine,
 * device-code-engine) should use this factory instead of constructing MSAL
 * apps directly.
 */
import { ConfidentialClientApplication, PublicClientApplication, Configuration, LogLevel } from "@azure/msal-node"
import { logger } from "./logger.js"
import { getAuthFlow, type AuthFlow } from "../auth-flow-config.js"

// ---------------------------------------------------------------------------
// Types & constants
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

/** Discriminated-union wrapper for MSAL application instances. */
export type MsalClient =
  | { type: "confidential"; app: ConfidentialClientApplication }
  | { type: "public"; app: PublicClientApplication }

/** Error thrown when required environment variables are missing. */
export class MsalConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing required MSAL environment variable(s): ${missing.join(", ")}`)
    this.name = "MsalConfigError"
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the common MSAL Configuration shared by both app types.
 * Includes authority resolution and structured logger callback.
 */
function buildMsalConfig(opts: { clientId: string; tenantId: string; clientSecret?: string }): Configuration {
  const authority = `https://login.microsoftonline.com/${opts.tenantId}`

  return {
    auth: {
      clientId: opts.clientId,
      authority,
      ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a unified MSAL client based on AUTH_FLOW and process.env credentials.
 *
 * - AUTH_FLOW=authorization_code (default): requires CLIENT_ID + CLIENT_SECRET,
 *   returns `{ type: 'confidential', app: ConfidentialClientApplication }`.
 * - AUTH_FLOW=device_code: requires CLIENT_ID only,
 *   returns `{ type: 'public', app: PublicClientApplication }`.
 *
 * @throws {MsalConfigError} if required environment variables are missing.
 */
export function createMsalClient(): MsalClient {
  const authFlow: AuthFlow = getAuthFlow()
  const clientId = process.env.CLIENT_ID
  const clientSecret = process.env.CLIENT_SECRET
  const tenantId = process.env.TENANT_ID || "organizations"

  // --- Validate required env vars ---
  const missing: string[] = []
  if (!clientId) missing.push("CLIENT_ID")
  if (authFlow === "authorization_code" && !clientSecret) missing.push("CLIENT_SECRET")
  if (missing.length > 0) {
    throw new MsalConfigError(missing)
  }

  // --- Build config and create the correct MSAL app type ---
  if (authFlow === "authorization_code") {
    const config = buildMsalConfig({ clientId: clientId!, tenantId, clientSecret: clientSecret! })
    const app = new ConfidentialClientApplication(config)
    return { type: "confidential", app }
  }

  // device_code flow — public client, no secret
  const config = buildMsalConfig({ clientId: clientId!, tenantId })
  const app = new PublicClientApplication(config)
  return { type: "public", app }
}
