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
  PublicClientApplication: vi.fn(),
  LogLevel: { Warning: 2, Verbose: 3 },
}))

vi.mock("../../src/infrastructure/cache-persistence.js", () => ({
  MsalCachePersistence: vi.fn(function (this: any) {
    this.save = vi.fn()
    this.load = vi.fn(() => null)
  }),
}))

// Import after mocks are in place
import {
  createOAuthEngine,
  OAuthConfigError,
  OAuthExchangeError,
  DELEGATED_SCOPES,
  type OAuthEngine,
} from "../../src/interface/auth/oauth-engine.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(env?: Record<string, string | undefined>) {
  delete process.env.CLIENT_ID
  delete process.env.CLIENT_SECRET
  delete process.env.TENANT_ID
  delete process.env.REDIRECT_URI
  delete process.env.AUTH_FLOW

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
    ...overrides,
  }
}

function mockPersistence() {
  return {
    save: vi.fn(),
    load: vi.fn(() => null),
  } as unknown as import("../../src/infrastructure/cache-persistence.js").MsalCachePersistence
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

    it("throws OAuthConfigError when AUTH_FLOW is device_code", () => {
      setEnv({ ...VALID_ENV, AUTH_FLOW: "device_code" })
      expect(() => createOAuthEngine()).toThrow(OAuthConfigError)
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
    it("returns AuthenticationResult with accessToken", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockReturnValue("serialized-cache")

      const persistence = mockPersistence()
      const engine = createOAuthEngine({ cachePersistence: persistence })
      const result = await engine.exchangeAuthCode("auth-code-123")

      expect(result).toHaveProperty("accessToken", "at-mocked")
    })

    it("calls acquireTokenByCode with correct parameters", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockReturnValue("cache")

      const persistence = mockPersistence()
      const engine = createOAuthEngine({ cachePersistence: persistence })
      await engine.exchangeAuthCode("my-code")

      expect(mockAcquireTokenByCode).toHaveBeenCalledWith({
        code: "my-code",
        scopes: expect.arrayContaining(["Tasks.Read"]),
        redirectUri: VALID_ENV.REDIRECT_URI,
      })
    })

    it("saves serialized cache via persistence.save()", async () => {
      mockAcquireTokenByCode.mockResolvedValue(makeAuthResult())
      mockSerialize.mockReturnValue("serialized-msal-cache")

      const persistence = mockPersistence()
      const engine = createOAuthEngine({ cachePersistence: persistence })
      await engine.exchangeAuthCode("code")

      expect(persistence.save).toHaveBeenCalledWith("serialized-msal-cache")
    })

    it("does not call persistence.save() when acquireTokenByCode fails", async () => {
      mockAcquireTokenByCode.mockRejectedValue(new Error("AADSTS70000"))

      const persistence = mockPersistence()
      const engine = createOAuthEngine({ cachePersistence: persistence })
      await expect(engine.exchangeAuthCode("bad-code")).rejects.toThrow(OAuthExchangeError)

      expect(persistence.save).not.toHaveBeenCalled()
    })

    it("throws OAuthExchangeError when acquireTokenByCode fails", async () => {
      mockAcquireTokenByCode.mockRejectedValue(new Error("AADSTS70000: invalid code"))

      const persistence = mockPersistence()
      const engine = createOAuthEngine({ cachePersistence: persistence })
      await expect(engine.exchangeAuthCode("bad-code")).rejects.toThrow(OAuthExchangeError)
      await expect(engine.exchangeAuthCode("bad-code")).rejects.toThrow("invalid code")
    })

    it("includes original cause in OAuthExchangeError", async () => {
      const originalError = new Error("AADSTS70000")
      mockAcquireTokenByCode.mockRejectedValue(originalError)

      const persistence = mockPersistence()
      const engine = createOAuthEngine({ cachePersistence: persistence })
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
