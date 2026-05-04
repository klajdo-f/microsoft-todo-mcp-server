import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockGetAuthCodeUrl = vi.fn()
const mockAcquireTokenByCode = vi.fn()
const mockSerialize = vi.fn()
const mockGetTokenCache = vi.fn(() => ({
  serialize: mockSerialize,
}))

vi.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: vi.fn(function (this: any) {
    this.getAuthCodeUrl = mockGetAuthCodeUrl
    this.acquireTokenByCode = mockAcquireTokenByCode
    this.getTokenCache = mockGetTokenCache
  }),
  LogLevel: { Warning: 2, Verbose: 3 },
}))

// Import after mocks are in place
import {
  createOAuthEngine,
  OAuthConfigError,
  OAuthExchangeError,
  DELEGATED_SCOPES,
  type OAuthEngine,
} from "../../src/oauth-engine.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(env?: Record<string, string | undefined>) {
  // Clear first
  delete process.env.CLIENT_ID
  delete process.env.CLIENT_SECRET
  delete process.env.TENANT_ID
  delete process.env.REDIRECT_URI

  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) {
        process.env[k] = v
      }
    }
  }
}

const VALID_ENV = {
  CLIENT_ID: "test-client-id",
  CLIENT_SECRET: "test-client-secret",
  TENANT_ID: "test-tenant",
  REDIRECT_URI: "http://localhost:9999/callback",
}

function makeAuthResult(overrides?: Partial<Record<string, unknown>>) {
  return {
    accessToken: "at-mocked",
    tokenType: "Bearer",
    scopes: ["offline_access", "Tasks.Read"],
    account: { username: "user@example.com", localAccountId: "abc", tenantId: "test-tenant" },
    idToken: "id-token",
    expiresIn: 3600,
    ...overrides,
  }
}

// Simulate an MSAL cache that contains a refresh token under "RefreshToken"
function cacheWithRefreshToken(secret = "rt-mocked") {
  return JSON.stringify({
    RefreshToken: {
      "some-cache-key": { secret },
    },
  })
}

function cacheEmpty() {
  return JSON.stringify({})
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("oauth-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv(VALID_ENV)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // createOAuthEngine — validation
  // -------------------------------------------------------------------------
  describe("createOAuthEngine", () => {
    it("throws OAuthConfigError when CLIENT_ID is missing", () => {
      setEnv({ ...VALID_ENV, CLIENT_ID: undefined })
      expect(() => createOAuthEngine()).toThrow(OAuthConfigError)
      expect(() => createOAuthEngine()).toThrow("CLIENT_ID")
    })

    it("throws OAuthConfigError when CLIENT_SECRET is missing", () => {
      setEnv({ ...VALID_ENV, CLIENT_SECRET: undefined })
      expect(() => createOAuthEngine()).toThrow(OAuthConfigError)
      expect(() => createOAuthEngine()).toThrow("CLIENT_SECRET")
    })

    it("throws OAuthConfigError when both CLIENT_ID and CLIENT_SECRET are missing", () => {
      setEnv({ ...VALID_ENV, CLIENT_ID: undefined, CLIENT_SECRET: undefined })
      expect(() => createOAuthEngine()).toThrow(OAuthConfigError)
    })

    it("defaults tenant to 'organizations' when TENANT_ID is not set", () => {
      setEnv({ CLIENT_ID: "c", CLIENT_SECRET: "s" })
      const engine = createOAuthEngine()
      expect(engine.tenantId).toBe("organizations")
    })

    it("uses REDIRECT_URI env when no option override is provided", () => {
      const engine = createOAuthEngine()
      expect(engine.redirectUri).toBe("http://localhost:9999/callback")
    })

    it("allows redirect URI override via options", () => {
      const engine = createOAuthEngine({ redirectUri: "http://custom:8080/cb" })
      expect(engine.redirectUri).toBe("http://custom:8080/cb")
    })

    it("defaults redirect URI to http://localhost:4040/callback when env is unset", () => {
      setEnv({ CLIENT_ID: "c", CLIENT_SECRET: "s" })
      const engine = createOAuthEngine()
      expect(engine.redirectUri).toBe("http://localhost:4040/callback")
    })
  })

  // -------------------------------------------------------------------------
  // getAuthUrl
  // -------------------------------------------------------------------------
  describe("getAuthUrl", () => {
    it("returns the authorization URL from MSAL", async () => {
      mockGetAuthCodeUrl.mockResolvedValue("https://login.microsoftonline.com/test-tenant/oauth2?code=abc")

      const engine = createOAuthEngine()
      const url = await engine.getAuthUrl()

      expect(url).toBe("https://login.microsoftonline.com/test-tenant/oauth2?code=abc")
      expect(mockGetAuthCodeUrl).toHaveBeenCalledWith({
        scopes: expect.arrayContaining(["offline_access", "Tasks.Read"]),
        redirectUri: VALID_ENV.REDIRECT_URI,
        prompt: "consent",
      })
    })

    it("passes all DELEGATED_SCOPES to getAuthCodeUrl", async () => {
      mockGetAuthCodeUrl.mockResolvedValue("https://example.com")

      const engine = createOAuthEngine()
      await engine.getAuthUrl()

      const callScopes = mockGetAuthCodeUrl.mock.calls[0][0].scopes as string[]
      for (const scope of DELEGATED_SCOPES) {
        expect(callScopes).toContain(scope)
      }
    })
  })

  // -------------------------------------------------------------------------
  // exchangeAuthCode
  // -------------------------------------------------------------------------
  describe("exchangeAuthCode", () => {
    it("returns token result compatible with TokenManager.saveTokens()", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockResolvedValue(cacheWithRefreshToken())

      const engine = createOAuthEngine()
      const result = await engine.exchangeAuthCode("auth-code-123")

      expect(result).toHaveProperty("accessToken", "at-mocked")
      expect(result).toHaveProperty("refreshToken", "rt-mocked")
      expect(result).toHaveProperty("expiresAt")
      expect(typeof result.expiresAt).toBe("number")
      // Expiry should be in the future (with 5-minute buffer subtracted)
      expect(result.expiresAt).toBeLessThan(Date.now() + 3600 * 1000)
      expect(result.expiresAt).toBeGreaterThan(Date.now() - 60_000)
    })

    it("calls acquireTokenByCode with correct parameters", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockResolvedValue(cacheWithRefreshToken())

      const engine = createOAuthEngine()
      await engine.exchangeAuthCode("my-code")

      expect(mockAcquireTokenByCode).toHaveBeenCalledWith({
        code: "my-code",
        scopes: expect.arrayContaining(["Tasks.Read"]),
        redirectUri: VALID_ENV.REDIRECT_URI,
      })
    })

    it("extracts refresh token from RefreshToken cache section", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockResolvedValue(cacheWithRefreshToken("extracted-rt"))

      const engine = createOAuthEngine()
      const result = await engine.exchangeAuthCode("code")

      expect(result.refreshToken).toBe("extracted-rt")
    })

    it("extracts refresh token from RefreshTokens (plural) cache section", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockResolvedValue(
        JSON.stringify({
          RefreshTokens: { "key-1": { secret: "plural-rt" } },
        }),
      )

      const engine = createOAuthEngine()
      const result = await engine.exchangeAuthCode("code")

      expect(result.refreshToken).toBe("plural-rt")
    })

    it("falls back to scanning cache sections containing 'refresh'", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockResolvedValue(
        JSON.stringify({
          myRefreshCache: { k: { secret: "fallback-rt" } },
        }),
      )

      const engine = createOAuthEngine()
      const result = await engine.exchangeAuthCode("code")

      expect(result.refreshToken).toBe("fallback-rt")
    })

    it("returns empty string for refreshToken when not found in cache", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockResolvedValue(cacheEmpty())

      const engine = createOAuthEngine()
      const result = await engine.exchangeAuthCode("code")

      expect(result.refreshToken).toBe("")
    })

    it("uses custom expiresIn from auth result", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult({ expiresIn: 7200 }))
      mockSerialize.mockResolvedValue(cacheWithRefreshToken())

      const engine = createOAuthEngine()
      const result = await engine.exchangeAuthCode("code")

      // 7200s - 5 min buffer = 6900s
      expect(result.expiresAt).toBeGreaterThan(Date.now() + 6800 * 1000)
    })

    it("defaults to 3600s when expiresIn is not present", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult({ expiresIn: undefined }))
      mockSerialize.mockResolvedValue(cacheWithRefreshToken())

      const engine = createOAuthEngine()
      const before = Date.now()
      const result = await engine.exchangeAuthCode("code")
      const after = Date.now()

      // Default 3600s - 5 min buffer = ~3300s from test start to end
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3300 * 1000 - 100) // 100ms tolerance
      expect(result.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000)
    })

    it("throws OAuthExchangeError when acquireTokenByCode fails", async () => {
      mockAcquireTokenByCode.mockRejectedValue(new Error("AADSTS70000: invalid code"))

      const engine = createOAuthEngine()
      await expect(engine.exchangeAuthCode("bad-code")).rejects.toThrow(OAuthExchangeError)
      await expect(engine.exchangeAuthCode("bad-code")).rejects.toThrow("invalid code")
    })

    it("includes original cause in OAuthExchangeError", async () => {
      const originalError = new Error("AADSTS70000")
      mockAcquireTokenByCode.mockRejectedValue(originalError)

      const engine = createOAuthEngine()
      try {
        await engine.exchangeAuthCode("code")
        expect.unreachable("Should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(OAuthExchangeError)
        expect((err as OAuthExchangeError).cause).toBe(originalError)
      }
    })
  })
})
