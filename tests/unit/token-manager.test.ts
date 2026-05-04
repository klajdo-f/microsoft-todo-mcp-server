import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

// Mock modules before importing the class
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}))

vi.mock("path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("path")>()
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join("/")),
  }
})

vi.mock("../../src/paths.js", () => ({
  getConfigDir: vi.fn(() => "/home/testuser/.config/microsoft-todo-mcp"),
  getTokenFilePath: vi.fn(() => "/home/testuser/.config/microsoft-todo-mcp/tokens.json"),
  getClaudeConfigPath: vi.fn(() => "/home/testuser/.config/Claude/claude_desktop_config.json"),
  ensureConfigDir: vi.fn(() => "/home/testuser/.config/microsoft-todo-mcp"),
}))

// Import after mocks are in place
import { TokenManager } from "../../src/token-manager.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TOKENS = {
  accessToken: "at-123",
  refreshToken: "rt-456",
  expiresAt: Date.now() + 3600_000,
  clientId: "cid",
  clientSecret: "csec",
  tenantId: "tenant1",
}

const EXPIRED_TOKENS = {
  ...VALID_TOKENS,
  expiresAt: Date.now() - 60_000, // expired 1 min ago
}

const REFRESH_RESPONSE = {
  access_token: "new-at",
  refresh_token: "new-rt",
  expires_in: 3600,
}

function mockTokenFile(tokens: object | null) {
  if (tokens === null) {
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false)
  } else {
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokens))
  }
}

function mockFetchSuccess(body: object) {
  const mockJson = vi.fn().mockResolvedValue(body)
  const mockText = vi.fn().mockResolvedValue(JSON.stringify(body))
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: mockJson,
      text: mockText,
    }),
  )
}

function mockFetchFailure(status: number, body: string) {
  const mockText = vi.fn().mockResolvedValue(body)
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: mockText,
    }),
  )
}

function mockFetchNetworkError(error: Error) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TokenManager", () => {
  let tm: TokenManager

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no env vars, no token file
    delete process.env.MS_TODO_ACCESS_TOKEN
    delete process.env.MS_TODO_REFRESH_TOKEN
    delete process.env.CLIENT_ID
    delete process.env.CLIENT_SECRET
    delete process.env.TENANT_ID

    // Default: config dir exists, no token file
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(mkdirSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined)
    ;(writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined)

    tm = new TokenManager()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // getTokens — no tokens
  // -----------------------------------------------------------------------
  describe("getTokens", () => {
    it("returns null when no token file exists and no env vars are set", async () => {
      const result = await tm.getTokens()
      expect(result).toBeNull()
    })

    // -----------------------------------------------------------------------
    // getTokens — valid tokens from file
    // -----------------------------------------------------------------------
    it("returns tokens when the token file contains valid unexpired tokens", async () => {
      mockTokenFile(VALID_TOKENS)

      const result = await tm.getTokens()

      expect(result).not.toBeNull()
      expect(result!.accessToken).toBe("at-123")
      expect(result!.refreshToken).toBe("rt-456")
    })

    // -----------------------------------------------------------------------
    // getTokens — proactive refresh on expiry
    // -----------------------------------------------------------------------
    it("triggers a proactive refresh when tokens are expired", async () => {
      mockTokenFile(EXPIRED_TOKENS)
      mockFetchSuccess(REFRESH_RESPONSE)

      const result = await tm.getTokens()

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(result).not.toBeNull()
      expect(result!.accessToken).toBe("new-at")
    })

    // -----------------------------------------------------------------------
    // getTokens — ignores env var fallbacks (per architecture decision MEM001)
    // -----------------------------------------------------------------------
    it("ignores MS_TODO_ACCESS_TOKEN / MS_TODO_REFRESH_TOKEN env vars", async () => {
      process.env.MS_TODO_ACCESS_TOKEN = "env-at"
      process.env.MS_TODO_REFRESH_TOKEN = "env-rt"

      // No token file → should return null even though env vars are set.
      // The env-var path was removed in T02; the file is the sole source.
      const result = await tm.getTokens()
      expect(result).toBeNull()
    })

    // -----------------------------------------------------------------------
    // getTokens — legacy file migration
    // -----------------------------------------------------------------------
    it("migrates tokens from legacy (cwd) tokens.json to new location", async () => {
      const legacyTokens = { ...VALID_TOKENS }

      // getTokens checks: (1) token file → false, (2) legacy file → true.
      ;(existsSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(false) // getTokens: token file check
        .mockReturnValueOnce(true) // getTokens: legacy file check
      ;(readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(legacyTokens))

      const result = await tm.getTokens()

      // Should have called saveTokens → writeFileSync with the migrated tokens
      expect(writeFileSync).toHaveBeenCalled()
      expect(result).not.toBeNull()
      expect(result!.accessToken).toBe("at-123")
    })

    // -----------------------------------------------------------------------
    // getTokens — corrupt token file
    // -----------------------------------------------------------------------
    it("returns null when token file contains invalid JSON", async () => {
      mockTokenFile({})
      ;(readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("not-json{{{")

      const result = await tm.getTokens()

      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // refreshToken — success path
  // -----------------------------------------------------------------------
  describe("refreshToken", () => {
    it("calls the Microsoft token endpoint with correct form data", async () => {
      mockFetchSuccess(REFRESH_RESPONSE)

      // Prime currentTokens so clientId/clientSecret are available
      mockTokenFile(VALID_TOKENS)
      await tm.getTokens() // loads tokens into this.currentTokens

      await tm.refreshToken("rt-456")

      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toBe("https://login.microsoftonline.com/tenant1/oauth2/v2.0/token")
      expect(options.method).toBe("POST")

      // Verify form body contains required fields
      const body = options.body as URLSearchParams
      expect(body.get("client_id")).toBe("cid")
      expect(body.get("client_secret")).toBe("csec")
      expect(body.get("refresh_token")).toBe("rt-456")
      expect(body.get("grant_type")).toBe("refresh_token")
    })

    it("saves new tokens on successful refresh", async () => {
      mockFetchSuccess(REFRESH_RESPONSE)
      mockTokenFile(VALID_TOKENS)
      await tm.getTokens()

      const result = await tm.refreshToken("rt-456")

      expect(result).not.toBeNull()
      expect(result!.accessToken).toBe("new-at")
      expect(result!.refreshToken).toBe("new-rt")
      expect(writeFileSync).toHaveBeenCalled()
    })

    it("uses env vars as fallback for client credentials when not in token file", async () => {
      const tokensWithoutCreds = {
        accessToken: "at-123",
        refreshToken: "rt-456",
        expiresAt: Date.now() - 60_000,
      }
      mockTokenFile(tokensWithoutCreds)
      process.env.CLIENT_ID = "env-cid"
      process.env.CLIENT_SECRET = "env-csec"
      process.env.TENANT_ID = "env-tenant"
      mockFetchSuccess(REFRESH_RESPONSE)

      await tm.getTokens()

      expect(fetch).toHaveBeenCalledTimes(1)
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = options.body as URLSearchParams
      expect(body.get("client_id")).toBe("env-cid")
      expect(body.get("client_secret")).toBe("env-csec")
    })

    // -----------------------------------------------------------------------
    // refreshToken — failure path
    // -----------------------------------------------------------------------
    it("persists lastRefreshError and lastRefreshAttempt on HTTP failure", async () => {
      mockTokenFile(VALID_TOKENS)
      await tm.getTokens()
      mockFetchFailure(400, '{"error":"invalid_grant"}')

      const result = await tm.refreshToken("rt-456")

      expect(result).toBeNull()

      // Verify failure metadata was persisted via writeFileSync
      const writeCalls = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls
      const lastWrite = writeCalls[writeCalls.length - 1]
      const persisted = JSON.parse(lastWrite[1] as string)
      expect(persisted.lastRefreshError).toContain("HTTP 400")
      expect(persisted.lastRefreshError).toContain("invalid_grant")
      expect(typeof persisted.lastRefreshAttempt).toBe("number")
      expect(persisted.lastRefreshAttempt).toBeGreaterThan(0)
    })

    it("persists lastRefreshError and lastRefreshAttempt on network error", async () => {
      mockTokenFile(VALID_TOKENS)
      await tm.getTokens()
      mockFetchNetworkError(new Error("ECONNREFUSED"))

      const result = await tm.refreshToken("rt-456")

      expect(result).toBeNull()

      // Verify failure metadata was persisted via writeFileSync
      const writeCalls = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls
      const lastWrite = writeCalls[writeCalls.length - 1]
      const persisted = JSON.parse(lastWrite[1] as string)
      expect(persisted.lastRefreshError).toContain("ECONNREFUSED")
      expect(typeof persisted.lastRefreshAttempt).toBe("number")
      expect(persisted.lastRefreshAttempt).toBeGreaterThan(0)
    })

    it("returns null when client credentials are missing", async () => {
      const tokensWithoutCreds = {
        accessToken: "at-123",
        refreshToken: "rt-456",
        expiresAt: Date.now() - 60_000,
      }
      mockTokenFile(tokensWithoutCreds)
      // No CLIENT_ID/CLIENT_SECRET env vars set either

      const result = await tm.refreshToken("rt-456")

      expect(result).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // saveTokens
  // -----------------------------------------------------------------------
  describe("saveTokens", () => {
    it("writes tokens to the token file as JSON", () => {
      tm.saveTokens(VALID_TOKENS)

      expect(writeFileSync).toHaveBeenCalledTimes(1)
      const [, content] = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]
      const parsed = JSON.parse(content as string)
      expect(parsed.accessToken).toBe("at-123")
      expect(parsed.refreshToken).toBe("rt-456")
    })
  })
})
