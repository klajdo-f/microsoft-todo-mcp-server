import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockAcquireTokenByDeviceCode = vi.fn()
const mockSerialize = vi.fn()
const mockGetTokenCache = vi.fn(() => ({
  serialize: mockSerialize,
}))

vi.mock("@azure/msal-node", () => ({
  PublicClientApplication: vi.fn(function (this: any) {
    this.acquireTokenByDeviceCode = mockAcquireTokenByDeviceCode
    this.getTokenCache = mockGetTokenCache
  }),
  LogLevel: { Warning: 2, Verbose: 3 },
}))

// Import after mocks are in place
import {
  createDeviceCodeEngine,
  DeviceCodeConfigError,
  DeviceCodeExchangeError,
  DELEGATED_SCOPES,
  type DeviceCodeEngine,
  type DeviceCodeFlowHandle,
} from "../../src/device-code-engine.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(env?: Record<string, string | undefined>) {
  delete process.env.CLIENT_ID
  delete process.env.CLIENT_SECRET
  delete process.env.TENANT_ID

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
  TENANT_ID: "test-tenant",
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

/**
 * Simulates MSAL acquireTokenByDeviceCode behaviour:
 * - Calls deviceCodeCallback synchronously with a device code response
 * - Returns a promise that resolves with the auth result
 */
function mockDeviceCodeFlowSuccess(authResultOverrides?: Partial<Record<string, unknown>>) {
  const authResult = makeAuthResult(authResultOverrides)
  mockAcquireTokenByDeviceCode.mockImplementation((request: any) => {
    // Simulate MSAL calling the callback with device code info
    request.deviceCodeCallback({
      userCode: "AB12CD34",
      deviceCode: "dc-internal",
      verificationUri: "https://microsoft.com/devicelogin",
      expiresIn: 900,
      interval: 5,
      message:
        "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code AB12CD34 to authenticate.",
    })
    return Promise.resolve(authResult)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("device-code-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv(VALID_ENV)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // createDeviceCodeEngine — validation
  // -------------------------------------------------------------------------
  describe("createDeviceCodeEngine", () => {
    it("throws DeviceCodeConfigError when CLIENT_ID is missing", () => {
      setEnv({ ...VALID_ENV, CLIENT_ID: undefined })
      expect(() => createDeviceCodeEngine()).toThrow(DeviceCodeConfigError)
      expect(() => createDeviceCodeEngine()).toThrow("CLIENT_ID")
    })

    it("does NOT require CLIENT_SECRET (public client)", () => {
      // Ensure no CLIENT_SECRET is set — should NOT throw
      setEnv({ CLIENT_ID: "c" })
      expect(() => createDeviceCodeEngine()).not.toThrow()
    })

    it("defaults tenant to 'organizations' when TENANT_ID is not set", () => {
      setEnv({ CLIENT_ID: "c" })
      const engine = createDeviceCodeEngine()
      expect(engine.tenantId).toBe("organizations")
    })

    it("uses TENANT_ID from environment when provided", () => {
      const engine = createDeviceCodeEngine()
      expect(engine.tenantId).toBe("test-tenant")
    })
  })

  // -------------------------------------------------------------------------
  // initiateDeviceCodeFlow
  // -------------------------------------------------------------------------
  describe("initiateDeviceCodeFlow", () => {
    it("returns a DeviceCodeFlowHandle with userCode, verificationUri, message, and result", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue(cacheWithRefreshToken())

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()

      expect(handle.userCode).toBe("AB12CD34")
      expect(handle.verificationUri).toBe("https://microsoft.com/devicelogin")
      expect(handle.message).toContain("AB12CD34")
      expect(handle.result).toBeInstanceOf(Promise)

      const result = await handle.result
      expect(result.accessToken).toBe("at-mocked")
      expect(result.refreshToken).toBe("rt-mocked")
      expect(typeof result.expiresAt).toBe("number")
    })

    it("calls acquireTokenByDeviceCode with correct DELEGATED_SCOPES", () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue(cacheWithRefreshToken())

      const engine = createDeviceCodeEngine()
      engine.initiateDeviceCodeFlow()

      expect(mockAcquireTokenByDeviceCode).toHaveBeenCalledTimes(1)
      const request = mockAcquireTokenByDeviceCode.mock.calls[0][0]
      const callScopes = request.scopes as string[]
      for (const scope of DELEGATED_SCOPES) {
        expect(callScopes).toContain(scope)
      }
    })

    it("returns OAuthTokenResult with identical shape to auth-code engine", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue(cacheWithRefreshToken())

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result

      // Must have all three fields with correct types
      expect(result).toHaveProperty("accessToken")
      expect(result).toHaveProperty("refreshToken")
      expect(result).toHaveProperty("expiresAt")
      expect(typeof result.accessToken).toBe("string")
      expect(typeof result.refreshToken).toBe("string")
      expect(typeof result.expiresAt).toBe("number")
    })

    it("applies 5-minute proactive refresh buffer to expiresAt", async () => {
      mockDeviceCodeFlowSuccess({ expiresIn: 3600 })
      mockSerialize.mockReturnValue(cacheWithRefreshToken())

      const before = Date.now()
      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result
      const after = Date.now()

      // expiresAt should be ~3600s - 300s (5 min buffer) = 3300s from now
      const expectedMin = before + 3300 * 1000 - 200 // 200ms tolerance
      const expectedMax = after + 3600 * 1000
      expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMin)
      expect(result.expiresAt).toBeLessThanOrEqual(expectedMax)
    })

    it("extracts refresh token from RefreshToken cache section", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue(cacheWithRefreshToken("extracted-rt"))

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result

      expect(result.refreshToken).toBe("extracted-rt")
    })

    it("extracts refresh token from RefreshTokens (plural) cache section", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue(
        JSON.stringify({
          RefreshTokens: { "key-1": { secret: "plural-rt" } },
        }),
      )

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result

      expect(result.refreshToken).toBe("plural-rt")
    })

    it("falls back to scanning cache sections containing 'refresh'", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue(
        JSON.stringify({
          myRefreshCache: { k: { secret: "fallback-rt" } },
        }),
      )

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result

      expect(result.refreshToken).toBe("fallback-rt")
    })

    it("returns empty string for refreshToken when not found in cache", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue(cacheEmpty())

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result

      expect(result.refreshToken).toBe("")
    })

    it("uses custom expiresIn from auth result", async () => {
      mockDeviceCodeFlowSuccess({ expiresIn: 7200 })
      mockSerialize.mockReturnValue(cacheWithRefreshToken())

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result

      // 7200s - 5 min buffer = ~6900s
      expect(result.expiresAt).toBeGreaterThan(Date.now() + 6800 * 1000)
    })

    it("defaults to 3600s when expiresIn is not present", async () => {
      mockDeviceCodeFlowSuccess({ expiresIn: undefined })
      mockSerialize.mockReturnValue(cacheWithRefreshToken())

      const before = Date.now()
      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result
      const after = Date.now()

      // Default 3600s - 5 min buffer = ~3300s
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3300 * 1000 - 200)
      expect(result.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000)
    })

    // -------------------------------------------------------------------------
    // Personal account detection
    // -------------------------------------------------------------------------
    describe("personal account detection", () => {
      const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad"

      it("sets isPersonalAccount: true when tenantId is consumer tenant", async () => {
        mockDeviceCodeFlowSuccess({ tenantId: CONSUMER_TENANT_ID })
        mockSerialize.mockReturnValue(cacheWithRefreshToken())

        const engine = createDeviceCodeEngine()
        const handle = engine.initiateDeviceCodeFlow()
        const result = await handle.result

        expect(result.isPersonalAccount).toBe(true)
      })

      it("sets isPersonalAccount: true when account.tenantId is consumer tenant", async () => {
        mockDeviceCodeFlowSuccess({
          tenantId: undefined,
          account: { username: "user@outlook.com", localAccountId: "abc", tenantId: CONSUMER_TENANT_ID },
        })
        mockSerialize.mockReturnValue(cacheWithRefreshToken())

        const engine = createDeviceCodeEngine()
        const handle = engine.initiateDeviceCodeFlow()
        const result = await handle.result

        expect(result.isPersonalAccount).toBe(true)
      })

      it("omits isPersonalAccount when tenant is not consumer", async () => {
        mockDeviceCodeFlowSuccess({ tenantId: "organizational-tenant-id" })
        mockSerialize.mockReturnValue(cacheWithRefreshToken())

        const engine = createDeviceCodeEngine()
        const handle = engine.initiateDeviceCodeFlow()
        const result = await handle.result

        expect(result.isPersonalAccount).toBeUndefined()
      })

      it("omits isPersonalAccount when tenantId is undefined", async () => {
        mockDeviceCodeFlowSuccess({
          tenantId: undefined,
          account: { username: "user@example.com", localAccountId: "abc", tenantId: undefined },
        })
        mockSerialize.mockReturnValue(cacheWithRefreshToken())

        const engine = createDeviceCodeEngine()
        const handle = engine.initiateDeviceCodeFlow()
        const result = await handle.result

        expect(result.isPersonalAccount).toBeUndefined()
      })

      it("result shape still includes accessToken, refreshToken, expiresAt alongside isPersonalAccount", async () => {
        mockDeviceCodeFlowSuccess({ tenantId: CONSUMER_TENANT_ID })
        mockSerialize.mockReturnValue(cacheWithRefreshToken("rt-personal"))

        const engine = createDeviceCodeEngine()
        const handle = engine.initiateDeviceCodeFlow()
        const result = await handle.result

        expect(result.accessToken).toBe("at-mocked")
        expect(result.refreshToken).toBe("rt-personal")
        expect(typeof result.expiresAt).toBe("number")
        expect(result.isPersonalAccount).toBe(true)
      })
    })

    // -------------------------------------------------------------------------
    // Error handling
    // -------------------------------------------------------------------------
    it("rejects result promise with DeviceCodeExchangeError when MSAL fails", async () => {
      mockAcquireTokenByDeviceCode.mockImplementation((request: any) => {
        request.deviceCodeCallback({
          userCode: "AB12CD34",
          deviceCode: "dc-internal",
          verificationUri: "https://microsoft.com/devicelogin",
          expiresIn: 900,
          interval: 5,
          message: "To sign in...",
        })
        return Promise.reject(new Error("AADSTS70016: pending"))
      })

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()

      await expect(handle.result).rejects.toThrow(DeviceCodeExchangeError)
      await expect(handle.result).rejects.toThrow("AADSTS70016")
    })

    it("includes original cause in DeviceCodeExchangeError", async () => {
      const originalError = new Error("AADSTS70016")
      mockAcquireTokenByDeviceCode.mockImplementation((request: any) => {
        request.deviceCodeCallback({
          userCode: "AB12CD34",
          deviceCode: "dc-internal",
          verificationUri: "https://microsoft.com/devicelogin",
          expiresIn: 900,
          interval: 5,
          message: "To sign in...",
        })
        return Promise.reject(originalError)
      })

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()

      try {
        await handle.result
        expect.unreachable("Should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(DeviceCodeExchangeError)
        expect((err as DeviceCodeExchangeError).cause).toBe(originalError)
      }
    })

    it("rejects result promise with DeviceCodeExchangeError when MSAL returns null", async () => {
      mockAcquireTokenByDeviceCode.mockImplementation((request: any) => {
        request.deviceCodeCallback({
          userCode: "AB12CD34",
          deviceCode: "dc-internal",
          verificationUri: "https://microsoft.com/devicelogin",
          expiresIn: 900,
          interval: 5,
          message: "To sign in...",
        })
        return Promise.resolve(null)
      })

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()

      await expect(handle.result).rejects.toThrow(DeviceCodeExchangeError)
      await expect(handle.result).rejects.toThrow("returned null")
    })
  })
})
