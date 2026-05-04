import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { getTokenFilePath } from "./paths.js"

interface TokenData {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface StoredTokenData extends TokenData {
  clientId?: string
  clientSecret?: string
  tenantId?: string
  lastRefreshError?: string
  lastRefreshAttempt?: number
}

export class TokenManager {
  private tokenFilePath: string
  private currentTokens: StoredTokenData | null = null

  constructor() {
    // Use shared platform-specific path utilities
    this.tokenFilePath = getTokenFilePath()
    console.error(`Token file path: ${this.tokenFilePath}`)
  }

  async getTokens(): Promise<StoredTokenData | null> {
    // Check stored token file
    if (existsSync(this.tokenFilePath)) {
      try {
        const data = readFileSync(this.tokenFilePath, "utf8")
        this.currentTokens = JSON.parse(data)

        if (this.currentTokens) {
          // Check if expired
          if (Date.now() > this.currentTokens.expiresAt) {
            // Try to refresh
            const refreshed = await this.refreshToken(this.currentTokens.refreshToken)
            if (refreshed) {
              return refreshed
            }
          }
          return this.currentTokens
        }
      } catch (error) {
        console.error("Error reading token file:", error)
      }
    }

    // Check legacy token file location (one-time migration)
    const legacyPath = join(process.cwd(), "tokens.json")
    if (existsSync(legacyPath)) {
      try {
        const data = readFileSync(legacyPath, "utf8")
        const tokens = JSON.parse(data)

        // Migrate to new location
        this.saveTokens(tokens)

        return tokens
      } catch (error) {
        console.error("Error reading legacy token file:", error)
      }
    }

    return null
  }

  async refreshToken(refreshToken: string): Promise<TokenData | null> {
    // Get client credentials from stored tokens or environment
    const clientId = this.currentTokens?.clientId || process.env.CLIENT_ID
    const clientSecret = this.currentTokens?.clientSecret || process.env.CLIENT_SECRET
    const tenantId = this.currentTokens?.tenantId || process.env.TENANT_ID || "organizations"

    if (!clientId || !clientSecret) {
      console.error("Missing client credentials for token refresh")
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
        console.error(`Token refresh failed: ${errorText}`)

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
        clientId,
        clientSecret,
        tenantId,
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
      console.error("Error refreshing token:", error)

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
        console.error("Failed to persist refresh error:", writeError)
      }
    }
  }

  saveTokens(tokens: StoredTokenData): void {
    this.currentTokens = tokens
    writeFileSync(this.tokenFilePath, JSON.stringify(tokens, null, 2), "utf8")
  }

  promptForReauth(): void {
    console.error(`
=================================================================
TOKEN REFRESH FAILED - REAUTHENTICATION REQUIRED

Your Microsoft To Do tokens have expired and could not be refreshed.

To fix this:
1. Open a new terminal
2. Navigate to the microsoft-todo-mcp-server directory
3. Run: pnpm run auth
4. Complete the authentication in your browser
5. Restart Claude Desktop to use the new tokens

Your tokens are stored in: ${this.tokenFilePath}
=================================================================
    `)
  }

  // Store client credentials with tokens for future refreshes
  async storeCredentials(clientId: string, clientSecret: string, tenantId: string): Promise<void> {
    if (this.currentTokens) {
      this.currentTokens.clientId = clientId
      this.currentTokens.clientSecret = clientSecret
      this.currentTokens.tenantId = tenantId
      this.saveTokens(this.currentTokens)
    }
  }
}

export const tokenManager = new TokenManager()
