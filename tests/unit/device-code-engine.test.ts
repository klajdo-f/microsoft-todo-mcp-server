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
  ConfidentialClientApplication: vi.fn(),
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
  createDeviceCodeEngine,
  DeviceCodeConfigError,
  DeviceCodeExchangeError,
  DELEGATED_SCOPES,
  type DeviceCodeEngine,
  type DeviceCodeFlowHandle,
} from "../../src/interface/auth/device-code-engine.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(env?: Record<string, string | undefined>) {
  delete process.env.CLIENT_ID
  delete process.env.CLIENT_SECRET
  delete process.env.TENANT_ID
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
  TENANT_ID: "test-tenant",
  AUTH_FLOW: "device_code",
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

/**
 * Simulates MSAL acquireTokenByDeviceCode behaviour:
 * - Calls deviceCodeCallback synchronously with a device code response
 * - Returns a promise that resolves with the auth result
 */
function mockDeviceCodeFlowSuccess(authResultOverrides?: Partial<Record<string, unknown>>) {
  const authResult = makeAuthResult(authResultOverrides)
  mockAcquireTokenByDeviceCode.mockImplementation((request: any) => {
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
      setEnv({ CLIENT_ID: "c", AUTH_FLOW: "device_code" })
      expect(() => createDeviceCodeEngine()).not.toThrow()
    })

    it("defaults tenant to 'organizations' when TENANT_ID is not set", () => {
      setEnv({ CLIENT_ID: "c", AUTH_FLOW: "device_code" })
      const engine = createDeviceCodeEngine()
      expect(engine.tenantId).toBe("organizations")
    })

    it("uses TENANT_ID from environment when provided", () => {
      const engine = createDeviceCodeEngine()
      expect(engine.tenantId).toBe("test-tenant")
    })

    it("throws DeviceCodeConfigError when AUTH_FLOW is authorization_code", () => {
      setEnv({ ...VALID_ENV, AUTH_FLOW: "authorization_code", CLIENT_SECRET: "s" })
      expect(() => createDeviceCodeEngine()).toThrow(DeviceCodeConfigError)
    })
  })

  // -------------------------------------------------------------------------
  // initiateDeviceCodeFlow
  // -------------------------------------------------------------------------
  describe("initiateDeviceCodeFlow", () => {
    it("returns a DeviceCodeFlowHandle with userCode, verificationUri, message, and result", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue("serialized-cache")

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()

      expect(handle.userCode).toBe("AB12CD34")
      expect(handle.verificationUri).toBe("https://microsoft.com/devicelogin")
      expect(handle.message).toContain("AB12CD34")
      expect(handle.result).toBeInstanceOf(Promise)

      const result = await handle.result
      expect(result.accessToken).toBe("at-mocked")
    })

    it("calls acquireTokenByDeviceCode with correct DELEGATED_SCOPES", () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue("serialized-cache")

      const engine = createDeviceCodeEngine()
      engine.initiateDeviceCodeFlow()

      expect(mockAcquireTokenByDeviceCode).toHaveBeenCalledTimes(1)
      const request = mockAcquireTokenByDeviceCode.mock.calls[0][0]
      const callScopes = request.scopes as string[]
      for (const scope of DELEGATED_SCOPES) {
        expect(callScopes).toContain(scope)
      }
    })

    it("resolves result to AuthenticationResult with accessToken", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue("serialized-cache")

      const engine = createDeviceCodeEngine()
      const handle = engine.initiateDeviceCodeFlow()
      const result = await handle.result

      expect(result).toHaveProperty("accessToken", "at-mocked")
      expect(result).toHaveProperty("tokenType", "Bearer")
      expect(result).toHaveProperty("scopes")
    })

    it("saves serialized cache via persistence.save()", async () => {
      mockDeviceCodeFlowSuccess()
      mockSerialize.mockReturnValue("serialized-msal-cache")

      const persistence = mockPersistence()
      const engine = createDeviceCodeEngine({ cachePersistence: persistence })
      const handle = engine.initiateDeviceCodeFlow()
      await handle.result

      expect(persistence.save).toHaveBeenCalledWith("serialized-msal-cache")
    })

    it("does not call persistence.save() when acquireTokenByDeviceCode fails", async () => {
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

      const persistence = mockPersistence()
      const engine = createDeviceCodeEngine({ cachePersistence: persistence })
      const handle = engine.initiateDeviceCodeFlow()

      await expect(handle.result).rejects.toThrow(DeviceCodeExchangeError)
      expect(persistence.save).not.toHaveBeenCalled()
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
