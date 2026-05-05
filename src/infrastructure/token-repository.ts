/**
 * Token repository — infrastructure-layer token persistence and refresh.
 *
 * Manages OAuth token lifecycle: read from disk, proactive refresh,
 * save to disk, and failure-metadata persistence.  All credential values
 * (CLIENT_ID, CLIENT_SECRET, TENANT_ID) are read exclusively from
 * process.env at runtime (env-only model per MEM016).
 *
 * This module is the canonical implementation; `src/token-manager.ts`
 * re-exports it as a backward-compatible wrapper.
 */
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { getTokenFilePath } from "../paths.js"
import { logger } from "./logger.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenData {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface StoredTokenData extends TokenData {
  isPersonalAccount?: boolean
  lastRefreshError?: string
  lastRefreshAttempt?: number
}

// ---------------------------------------------------------------------------
// TokenRepository
// ---------------------------------------------------------------------------

export class TokenRepository {
  private tokenFilePath: string
  private currentTokens: StoredTokenData | null = null

  constructor() {
    // Use shared platform-specific path utilities
    this.tokenFilePath = getTokenFilePath()
    logger.debug(`Token file path: ${this.tokenFilePath}`, { source: "token-repository" })
  }

  /**
   * Read and parse tokens from the configured token file path.
   *
   * Returns parsed tokens or null if the file doesn't exist or can't be parsed.
   */
  private readTokensFromFile(): StoredTokenData | null {
    if (!existsSync(this.tokenFilePath)) return null

    try {
      const data = readFileSync(this.tokenFilePath, "utf8")
      this.currentTokens = JSON.parse(data)
      return this.currentTokens
    } catch (error) {
      logger.error("Error reading token file:", {
        source: "token-repository",
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Attempt one-time migration from the legacy tokens.json location.
   *
   * Reads from `process.cwd()/tokens.json`, saves to the new platform-specific
   * path, and returns the migrated tokens.  Returns null if the legacy file
   * doesn't exist or can't be parsed.
   */
  private migrateLegacyTokens(): StoredTokenData | null {
    const legacyPath = join(process.cwd(), "tokens.json")
    if (!existsSync(legacyPath)) return null

    try {
      const data = readFileSync(legacyPath, "utf8")
      const tokens: StoredTokenData = JSON.parse(data)
      this.saveTokens(tokens)
      return tokens
    } catch (error) {
      logger.error("Error reading legacy token file:", {
        source: "token-repository",
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async getTokens(): Promise<StoredTokenData | null> {
    const tokens = this.readTokensFromFile()

    if (tokens) {
      // Check if expired
      if (Date.now() > tokens.expiresAt) {
        const refreshed = await this.refreshToken(tokens.refreshToken)
        if (refreshed) return refreshed
      }
      return tokens
    }

    // One-time migration from legacy token file location
    return this.migrateLegacyTokens()
  }

  async refreshToken(refreshToken: string): Promise<TokenData | null> {
    // Client credentials come exclusively from process.env (env-only model)
    const clientId = process.env.CLIENT_ID
    const clientSecret = process.env.CLIENT_SECRET
    const tenantId = process.env.TENANT_ID || "organizations"

    if (!clientId || !clientSecret) {
      logger.warn("Missing client credentials for token refresh", { source: "token-repository" })
      return null
    }

    const now = Date.now()
    const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`

    try {
      const formData = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "offline_access Tasks.Read Tasks.ReadWrite Tasks.Read.Shared Tasks.ReadWrite.Shared User.Read",
      })

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`Token refresh failed: ${errorText}`, { source: "token-repository", status: response.status })

        // Persist failure metadata to token file
        this.persistRefreshError(`HTTP ${response.status}: ${errorText}`, now)

        this.promptForReauth()
        return null
      }

      const data = await response.json()

      const newTokens: StoredTokenData = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000, // 5 min buffer
        isPersonalAccount: this.currentTokens?.isPersonalAccount,
      }

      // Clear any previous error on success
      if (this.currentTokens) {
        delete this.currentTokens.lastRefreshError
        delete this.currentTokens.lastRefreshAttempt
      }

      // Save the refreshed tokens
      this.saveTokens(newTokens)

      return newTokens
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error("Error refreshing token:", { source: "token-repository", error: message })

      // Persist failure metadata to token file
      this.persistRefreshError(message, now)

      this.promptForReauth()
      return null
    }
  }

  /**
   * Persist refresh failure metadata alongside existing tokens so that
   * auth-status can surface the last failure to the user.
   */
  private persistRefreshError(errorMessage: string, timestamp: number): void {
    if (this.currentTokens) {
      this.currentTokens.lastRefreshError = errorMessage
      this.currentTokens.lastRefreshAttempt = timestamp
      try {
        writeFileSync(this.tokenFilePath, JSON.stringify(this.currentTokens, null, 2), "utf8")
      } catch (writeError) {
        logger.error("Failed to persist refresh error:", {
          source: "token-repository",
          error: writeError instanceof Error ? writeError.message : String(writeError),
        })
      }
    }
  }

  saveTokens(tokens: StoredTokenData): void {
    this.currentTokens = tokens
    writeFileSync(this.tokenFilePath, JSON.stringify(tokens, null, 2), "utf8")
  }

  promptForReauth(): void {
    logger.info(
      "TOKEN REFRESH FAILED - REAUTHENTICATION REQUIRED. " +
        "Your Microsoft To Do tokens have expired and could not be refreshed. " +
        "Use the 'start-auth' MCP tool to re-authenticate, complete the authentication in your browser, " +
        "and your tokens will be refreshed automatically. " +
        `Token file: ${this.tokenFilePath}`,
      { source: "token-repository" },
    )
  }
}

/** Singleton instance used across the application. */
export const tokenRepository = new TokenRepository()
