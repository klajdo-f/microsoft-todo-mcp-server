import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockConfidentialConstructor = vi.fn()
const mockPublicConstructor = vi.fn()

vi.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: vi.fn(function (this: any) {
    mockConfidentialConstructor.call(this, ...arguments)
  }),
  PublicClientApplication: vi.fn(function (this: any) {
    mockPublicConstructor.call(this, ...arguments)
  }),
  LogLevel: { Warning: 2, Verbose: 3 },
}))

vi.mock("../../src/infrastructure/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Import after mocks are in place
import { createMsalClient, DELEGATED_SCOPES, MsalConfigError } from "../../src/infrastructure/msal-client.js"
import { ConfidentialClientApplication, PublicClientApplication } from "@azure/msal-node"
import { logger } from "../../src/infrastructure/logger.js"

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

const VALID_CONFIDENTIAL_ENV = {
  CLIENT_ID: "test-client-id",
  CLIENT_SECRET: "test-client-secret",
  TENANT_ID: "test-tenant",
}

const VALID_PUBLIC_ENV = {
  CLIENT_ID: "test-client-id",
  AUTH_FLOW: "device_code",
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("msal-client", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv(VALID_CONFIDENTIAL_ENV)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // DELEGATED_SCOPES
  // -------------------------------------------------------------------------

  describe("DELEGATED_SCOPES", () => {
    it("includes required Task scopes", () => {
      const scopes = [...DELEGATED_SCOPES]
      expect(scopes).toContain("Tasks.Read")
      expect(scopes).toContain("Tasks.ReadWrite")
      expect(scopes).toContain("Tasks.Read.Shared")
      expect(scopes).toContain("Tasks.ReadWrite.Shared")
    })

    it("includes standard OIDC scopes", () => {
      const scopes = [...DELEGATED_SCOPES]
      expect(scopes).toContain("offline_access")
      expect(scopes).toContain("openid")
      expect(scopes).toContain("profile")
      expect(scopes).toContain("User.Read")
    })
  })

  // -------------------------------------------------------------------------
  // createMsalClient — authorization_code flow (default)
  // -------------------------------------------------------------------------

  describe("createMsalClient — authorization_code flow", () => {
    it("returns a confidential client when AUTH_FLOW is unset", () => {
      delete process.env.AUTH_FLOW
      const client = createMsalClient()
      expect(client.type).toBe("confidential")
      expect(client.app).toBeInstanceOf(ConfidentialClientApplication)
    })

    it("returns a confidential client when AUTH_FLOW=authorization_code", () => {
      process.env.AUTH_FLOW = "authorization_code"
      const client = createMsalClient()
      expect(client.type).toBe("confidential")
      expect(client.app).toBeInstanceOf(ConfidentialClientApplication)
    })

    it("passes correct authority to ConfidentialClientApplication", () => {
      process.env.TENANT_ID = "custom-tenant-42"
      createMsalClient()

      expect(ConfidentialClientApplication).toHaveBeenCalledTimes(1)
      const configArg = mockConfidentialConstructor.mock.calls[0][0]
      expect(configArg.auth.authority).toBe("https://login.microsoftonline.com/custom-tenant-42")
      expect(configArg.auth.clientId).toBe("test-client-id")
      expect(configArg.auth.clientSecret).toBe("test-client-secret")
    })

    it("defaults tenant to 'organizations' when TENANT_ID is unset", () => {
      delete process.env.TENANT_ID
      createMsalClient()

      const configArg = mockConfidentialConstructor.mock.calls[0][0]
      expect(configArg.auth.authority).toBe("https://login.microsoftonline.com/organizations")
    })

    it("configures MSAL logger callback", () => {
      createMsalClient()

      const configArg = mockConfidentialConstructor.mock.calls[0][0]
      expect(configArg.system.loggerOptions).toBeDefined()
      expect(configArg.system.loggerOptions.piiLoggingEnabled).toBe(false)
      expect(configArg.system.loggerOptions.logLevel).toBe(2) // LogLevel.Warning
      expect(typeof configArg.system.loggerOptions.loggerCallback).toBe("function")
    })

    it("does NOT create PublicClientApplication", () => {
      createMsalClient()
      expect(PublicClientApplication).not.toHaveBeenCalled()
    })

    it("throws MsalConfigError when CLIENT_ID is missing", () => {
      delete process.env.CLIENT_ID
      expect(() => createMsalClient()).toThrow(MsalConfigError)
      expect(() => createMsalClient()).toThrow("CLIENT_ID")
    })

    it("throws MsalConfigError when CLIENT_SECRET is missing", () => {
      delete process.env.CLIENT_SECRET
      expect(() => createMsalClient()).toThrow(MsalConfigError)
      expect(() => createMsalClient()).toThrow("CLIENT_SECRET")
    })

    it("includes all missing variables in the error message", () => {
      delete process.env.CLIENT_ID
      delete process.env.CLIENT_SECRET
      expect(() => createMsalClient()).toThrow(/CLIENT_ID.*CLIENT_SECRET|CLIENT_SECRET.*CLIENT_ID/)
    })
  })

  // -------------------------------------------------------------------------
  // createMsalClient — device_code flow
  // -------------------------------------------------------------------------

  describe("createMsalClient — device_code flow", () => {
    beforeEach(() => {
      setEnv(VALID_PUBLIC_ENV)
    })

    it("returns a public client when AUTH_FLOW=device_code", () => {
      const client = createMsalClient()
      expect(client.type).toBe("public")
      expect(client.app).toBeInstanceOf(PublicClientApplication)
    })

    it("passes correct authority to PublicClientApplication", () => {
      process.env.TENANT_ID = "my-tenant"
      createMsalClient()

      expect(PublicClientApplication).toHaveBeenCalledTimes(1)
      const configArg = mockPublicConstructor.mock.calls[0][0]
      expect(configArg.auth.authority).toBe("https://login.microsoftonline.com/my-tenant")
      expect(configArg.auth.clientId).toBe("test-client-id")
    })

    it("does NOT include clientSecret in the config", () => {
      createMsalClient()

      const configArg = mockPublicConstructor.mock.calls[0][0]
      expect(configArg.auth.clientSecret).toBeUndefined()
    })

    it("does NOT create ConfidentialClientApplication", () => {
      createMsalClient()
      expect(ConfidentialClientApplication).not.toHaveBeenCalled()
    })

    it("configures MSAL logger callback", () => {
      createMsalClient()

      const configArg = mockPublicConstructor.mock.calls[0][0]
      expect(configArg.system.loggerOptions).toBeDefined()
      expect(configArg.system.loggerOptions.piiLoggingEnabled).toBe(false)
      expect(typeof configArg.system.loggerOptions.loggerCallback).toBe("function")
    })

    it("throws MsalConfigError when CLIENT_ID is missing", () => {
      delete process.env.CLIENT_ID
      expect(() => createMsalClient()).toThrow(MsalConfigError)
      expect(() => createMsalClient()).toThrow("CLIENT_ID")
    })

    it("does NOT require CLIENT_SECRET for device_code flow", () => {
      // CLIENT_SECRET is not set in VALID_PUBLIC_ENV — should not throw
      expect(() => createMsalClient()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // MsalConfigError
  // -------------------------------------------------------------------------

  describe("MsalConfigError", () => {
    it("has the correct error name", () => {
      const error = new MsalConfigError(["CLIENT_ID"])
      expect(error.name).toBe("MsalConfigError")
    })

    it("formats missing variables in the message", () => {
      const error = new MsalConfigError(["CLIENT_ID", "CLIENT_SECRET"])
      expect(error.message).toContain("CLIENT_ID")
      expect(error.message).toContain("CLIENT_SECRET")
      expect(error.message).toContain("Missing required MSAL environment variable(s)")
    })
  })

  // -------------------------------------------------------------------------
  // Logger callback integration
  // -------------------------------------------------------------------------

  describe("logger callback", () => {
    it("invokes logger.debug with MSAL message", () => {
      createMsalClient()

      const configArg = mockConfidentialConstructor.mock.calls[0][0]
      const callback = configArg.system.loggerOptions.loggerCallback

      // Simulate MSAL calling the logger
      callback(2, "test-msal-message", false)

      expect(logger.debug).toHaveBeenCalledWith("[MSAL] test-msal-message", { source: "msal" })
    })
  })
})
