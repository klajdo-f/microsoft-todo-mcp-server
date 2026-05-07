/**
 * Token repository — thin MSAL bridge for token acquisition and refresh.
 *
 * Loads the MSAL serialized cache via MsalCachePersistence, delegates token
 * refresh to acquireTokenSilent(), and returns a minimal TokenData shape.
 * No manual HTTP refresh, no legacy migration, no personal-account detection.
 *
 * This module is the canonical implementation; consumers import via
 * `./token-repository.js`.
 */
import { createMsalClient, DELEGATED_SCOPES, MsalConfigError } from "./msal-client.js"
import { MsalCachePersistence } from "./cache-persistence.js"
import { logger } from "./logger.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal token data returned to callers. */
export interface TokenData {
  accessToken: string
  expiresAt: number
}

/** On-disk shape — plain alias with no extra fields. */
export type StoredTokenData = TokenData

// ---------------------------------------------------------------------------
// TokenRepository
// ---------------------------------------------------------------------------

export class TokenRepository {
  private cachePersistence: MsalCachePersistence

  constructor(cachePersistence?: MsalCachePersistence) {
    this.cachePersistence = cachePersistence ?? new MsalCachePersistence()
  }

  /**
   * Acquire an access token silently via MSAL.
   *
   * Loads the serialized cache from disk, deserializes it into an MSAL app,
   * and calls acquireTokenSilent(). On success, the updated cache is
   * persisted back to disk. Returns null when no cached account exists
   * or when silent acquisition fails.
   */
  async getTokens(): Promise<TokenData | null> {
    // Step 1: Load serialized cache from disk
    const serialized = this.cachePersistence.load()

    // Step 2: Create MSAL client (catch config errors → null)
    let msalClient
    try {
      msalClient = createMsalClient()
    } catch (error) {
      if (error instanceof MsalConfigError) {
        logger.warn("MSAL client configuration missing, cannot acquire token", {
          source: "token-repository",
          error: error.message,
        })
        return null
      }
      throw error
    }

    // Step 3: Deserialize cache into the MSAL app
    try {
      const tokenCache = msalClient.app.getTokenCache()
      if (serialized) {
        tokenCache.deserialize(serialized)
      }
    } catch (error) {
      logger.warn("Failed to deserialize MSAL cache", {
        source: "token-repository",
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }

    // Step 4: Get accounts from cache
    let accounts
    try {
      accounts = await msalClient.app.getTokenCache().getAllAccounts()
    } catch (error) {
      logger.warn("Failed to read accounts from MSAL cache", {
        source: "token-repository",
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }

    if (!accounts || accounts.length === 0) {
      logger.debug("No accounts found in MSAL cache", { source: "token-repository" })
      return null
    }

    // Step 5: Acquire token silently
    try {
      const result = await msalClient.app.acquireTokenSilent({
        account: accounts[0],
        scopes: [...DELEGATED_SCOPES],
      })

      // Step 6: Serialize and save updated cache
      if (result) {
        try {
          const updatedCache = msalClient.app.getTokenCache().serialize()
          this.cachePersistence.save(updatedCache)
        } catch (cacheError) {
          // Non-fatal — token is still valid, just couldn't persist cache update
          logger.warn("Failed to persist updated MSAL cache", {
            source: "token-repository",
            error: cacheError instanceof Error ? cacheError.message : String(cacheError),
          })
        }
      }

      // Step 7: Return TokenData
      if (!result?.accessToken) {
        return null
      }

      return {
        accessToken: result.accessToken,
        expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600_000,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn("MSAL silent token acquisition failed", {
        source: "token-repository",
        errorMessage,
      })
      return null
    }
  }
}

/** Singleton instance used across the application. */
export const tokenRepository = new TokenRepository()
