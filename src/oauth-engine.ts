/**
 * OAuth engine — thin MSAL wrapper for authorization-code flow.
 *
 * Uses the unified createMsalClient() factory and MsalCachePersistence.
 * Returns MSAL AuthenticationResult directly; no manual token extraction.
 */
import { AuthenticationResult } from "@azure/msal-node"
import { createMsalClient, DELEGATED_SCOPES } from "./infrastructure/msal-client.js"
import { MsalCachePersistence } from "./infrastructure/cache-persistence.js"

export { DELEGATED_SCOPES }

export class OAuthConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing required OAuth environment variable(s): ${missing.join(", ")}`)
    this.name = "OAuthConfigError"
  }
}

export class OAuthExchangeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "OAuthExchangeError"
  }
}

export function createOAuthEngine(options?: { redirectUri?: string; cachePersistence?: MsalCachePersistence }) {
  const missing: string[] = []
  if (!process.env.CLIENT_ID) missing.push("CLIENT_ID")
  if (!process.env.CLIENT_SECRET) missing.push("CLIENT_SECRET")
  if (missing.length > 0) throw new OAuthConfigError(missing)

  const client = createMsalClient()
  if (client.type !== "confidential") {
    throw new OAuthConfigError(["AUTH_FLOW must be 'authorization_code' for OAuth engine"])
  }

  const redirectUri = options?.redirectUri || process.env.REDIRECT_URI || "http://localhost:4040/callback"
  const persistence = options?.cachePersistence ?? new MsalCachePersistence()

  return {
    redirectUri,
    tenantId: process.env.TENANT_ID || "organizations",
    async getAuthUrl(): Promise<string> {
      return client.app.getAuthCodeUrl({ scopes: [...DELEGATED_SCOPES], redirectUri, prompt: "consent" as const })
    },
    async exchangeAuthCode(code: string): Promise<AuthenticationResult> {
      try {
        const result = await client.app.acquireTokenByCode({ code, scopes: [...DELEGATED_SCOPES], redirectUri })
        if (!result) throw new OAuthExchangeError("Authorization code exchange returned no result")
        persistence.save(client.app.getTokenCache().serialize() as string)
        return result
      } catch (error: unknown) {
        if (error instanceof OAuthExchangeError) throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new OAuthExchangeError(`Authorization code exchange failed: ${message}`, error)
      }
    },
  }
}

export type OAuthEngine = ReturnType<typeof createOAuthEngine>
