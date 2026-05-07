/**
 * Tests for authentication MCP tool handlers.
 *
 * Verifies that:
 * - `auth-status` returns clean expiry info without personal-account warnings.
 * - `start-auth` response text includes the auth URL and instructions.
 * - `start-device-auth` returns user code, verification URI, and message.
 * - Concurrent guard returns existing flow info when called twice.
 * - `DeviceCodeConfigError` produces actionable MCP response mentioning
 *   only CLIENT_ID.
 * - Background promise resolves cleanly after device code completion
 *   (token persistence is handled by the engine's MSAL cache layer).
 * - `auth-status` unauthenticated message is flow-aware (mentions
 *   start-device-auth + CLIENT_ID for device_code, start-auth + both
 *   credentials for authorization_code).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

// ---------------------------------------------------------------------------
// Stable mock references — shared between vi.mock() factories and tests
// ---------------------------------------------------------------------------

const mockTokenRepository = {
  getTokens: vi.fn(),
}

const mockStartAuthFlow = vi.fn()

const mockCreateDeviceCodeEngine = vi.fn()

// ---------------------------------------------------------------------------
// Top-level mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/infrastructure/token-repository.js", () => ({
  get tokenRepository() {
    return mockTokenRepository
  },
}))

vi.mock("../../src/interface/auth/auth-callback-server.js", () => ({
  get startAuthFlow() {
    return mockStartAuthFlow
  },
}))

vi.mock("../../src/open-browser.js", () => ({
  openBrowser: vi.fn(),
}))

vi.mock("../../src/infrastructure/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("../../src/interface/auth/oauth-engine.js", () => ({
  OAuthConfigError: class OAuthConfigError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "OAuthConfigError"
    }
  },
}))

vi.mock("../../src/interface/error-handler.js", () => ({
  handleToolError: vi.fn((err: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: err instanceof Error ? err.message : String(err),
      },
    ],
  })),
}))

vi.mock("../../src/interface/auth/device-code-engine.js", () => ({
  get createDeviceCodeEngine() {
    return mockCreateDeviceCodeEngine
  },
  DeviceCodeConfigError: class DeviceCodeConfigError extends Error {
    constructor(missing: string[]) {
      super(`Missing required device-code environment variable(s): ${missing.join(", ")}`)
      this.name = "DeviceCodeConfigError"
    }
  },
  DeviceCodeExchangeError: class DeviceCodeExchangeError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "DeviceCodeExchangeError"
    }
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToolHandler(server: McpServer, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (server as any)._registeredTools[name]
  if (!tool) throw new Error(`Tool ${name} not registered`)
  return tool.handler.bind(tool)
}

/**
 * Dynamically import the auth-tools module so module-level state
 * (activeDeviceCodeHandle) and isDeviceCodeFlow() are re-evaluated
 * with the current AUTH_FLOW env var.
 */
async function importAuthTools() {
  vi.resetModules()

  vi.doMock("../../src/infrastructure/token-repository.js", () => ({
    get tokenRepository() {
      return mockTokenRepository
    },
  }))
  vi.doMock("../../src/interface/auth/auth-callback-server.js", () => ({
    get startAuthFlow() {
      return mockStartAuthFlow
    },
  }))
  vi.doMock("../../src/infrastructure/open-browser.js", () => ({
    openBrowser: vi.fn(),
  }))
  vi.doMock("../../src/infrastructure/logger.js", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }))
  vi.doMock("../../src/interface/auth/oauth-engine.js", () => ({
    OAuthConfigError: class OAuthConfigError extends Error {
      constructor(message: string) {
        super(message)
        this.name = "OAuthConfigError"
      }
    },
  }))
  vi.doMock("../../src/interface/error-handler.js", () => ({
    handleToolError: vi.fn((err: unknown) => ({
      content: [
        {
          type: "text" as const,
          text: err instanceof Error ? err.message : String(err),
        },
      ],
    })),
  }))
  vi.doMock("../../src/interface/auth/device-code-engine.js", () => ({
    get createDeviceCodeEngine() {
      return mockCreateDeviceCodeEngine
    },
    DeviceCodeConfigError: class DeviceCodeConfigError extends Error {
      constructor(missing: string[]) {
        super(`Missing required device-code environment variable(s): ${missing.join(", ")}`)
        this.name = "DeviceCodeConfigError"
      }
    },
    DeviceCodeExchangeError: class DeviceCodeExchangeError extends Error {
      constructor(message: string) {
        super(message)
        this.name = "DeviceCodeExchangeError"
      }
    },
  }))

  const mod = await import("../../src/interface/tools/auth-tools.js")
  return mod.registerAuthTools
}

// ---------------------------------------------------------------------------
// Tests — auth-status
// ---------------------------------------------------------------------------

describe("auth-status", () => {
  const futureDate = Date.now() + 3600_000

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns authenticated text when tokens exist", async () => {
    mockTokenRepository.getTokens.mockResolvedValue({
      accessToken: "at",
      expiresAt: futureDate,
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Authenticated.")
    expect(text).not.toContain("WARNING")
    expect(text).not.toContain("personal")
  })

  it("reports not-authenticated when tokens are null (default flow)", async () => {
    mockTokenRepository.getTokens.mockResolvedValue(null)

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Not authenticated")
    // Default (authorization_code) flow mentions start-auth and both credentials
    expect(text).toContain("start-auth")
    expect(text).toContain("CLIENT_SECRET")
    expect(text).not.toContain("start-device-auth")
  })
})

describe("start-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns auth URL and instructions", async () => {
    mockStartAuthFlow.mockResolvedValue({
      authUrl: "https://login.microsoftonline.com/test",
      result: Promise.resolve({ success: true, message: "ok" }),
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "start-auth")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("https://login.microsoftonline.com/test")
    expect(text).toContain("Opening your default browser")
    expect(text).toContain("auth-status")
  })
})

// ---------------------------------------------------------------------------
// Tests — device_code flow
// ---------------------------------------------------------------------------

describe("start-device-auth", () => {
  let originalAuthFlow: string | undefined

  beforeEach(() => {
    originalAuthFlow = process.env.AUTH_FLOW
    process.env.AUTH_FLOW = "device_code"
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalAuthFlow !== undefined) {
      process.env.AUTH_FLOW = originalAuthFlow
    } else {
      delete process.env.AUTH_FLOW
    }
  })

  it("returns user code, verification URI, and message on first call", async () => {
    mockCreateDeviceCodeEngine.mockReturnValue({
      tenantId: "organizations",
      initiateDeviceCodeFlow: () => ({
        userCode: "ABC-1234",
        verificationUri: "https://microsoft.com/devicelogin",
        message: "To sign in, use a web browser...",
        result: new Promise(() => {}),
      }),
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "start-device-auth")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("ABC-1234")
    expect(text).toContain("https://microsoft.com/devicelogin")
    expect(text).toContain("Device Code Authentication")
  })

  it("concurrent guard returns existing flow info on second call", async () => {
    const handle = {
      userCode: "XYZ-5678",
      verificationUri: "https://microsoft.com/devicelogin",
      message: "To sign in...",
      result: new Promise(() => {}),
    }

    mockCreateDeviceCodeEngine.mockReturnValue({
      tenantId: "organizations",
      initiateDeviceCodeFlow: () => handle,
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "start-device-auth")

    // First call — initiates the flow
    const result1 = await handler({})
    expect(result1.content[0].text).toContain("XYZ-5678")

    // Second call — concurrent guard returns existing flow info
    const result2 = await handler({})
    const text2 = result2.content[0].text
    expect(text2).toContain("already in progress")
    expect(text2).toContain("XYZ-5678")
    expect(text2).toContain("https://microsoft.com/devicelogin")
  })

  it("DeviceCodeConfigError returns actionable text mentioning only CLIENT_ID", async () => {
    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const { DeviceCodeConfigError } = await import("../../src/interface/auth/device-code-engine.js")
    mockCreateDeviceCodeEngine.mockImplementation(() => {
      throw new DeviceCodeConfigError(["CLIENT_ID"])
    })

    const handler = getToolHandler(server, "start-device-auth")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("configuration error")
    expect(text).toContain("CLIENT_ID")
    expect(text).not.toContain("CLIENT_SECRET")
  })

  it("background promise resolves without error after device code completion", async () => {
    let resolveResult!: (value: unknown) => void
    const resultPromise = new Promise((resolve) => {
      resolveResult = resolve
    })

    mockCreateDeviceCodeEngine.mockReturnValue({
      tenantId: "organizations",
      initiateDeviceCodeFlow: () => ({
        userCode: "DEV-9999",
        verificationUri: "https://microsoft.com/devicelogin",
        message: "Enter the code",
        result: resultPromise,
      }),
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "start-device-auth")

    // Call handler — starts background flow
    const result = await handler({})
    expect(result.content[0].text).toContain("DEV-9999")

    // Simulate device code exchange completion (engine handles persistence)
    resolveResult({})

    // Allow microtask queue to flush — background promise should resolve cleanly
    await new Promise((r) => setTimeout(r, 10))
  })
})

describe("auth-status flow-aware messaging", () => {
  let originalAuthFlow: string | undefined

  beforeEach(() => {
    originalAuthFlow = process.env.AUTH_FLOW
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalAuthFlow !== undefined) {
      process.env.AUTH_FLOW = originalAuthFlow
    } else {
      delete process.env.AUTH_FLOW
    }
  })

  it("AUTH_FLOW=device_code unauthenticated message mentions start-device-auth and CLIENT_ID only", async () => {
    process.env.AUTH_FLOW = "device_code"
    mockTokenRepository.getTokens.mockResolvedValue(null)

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Not authenticated")
    expect(text).toContain("start-device-auth")
    expect(text).toContain("CLIENT_ID")
    expect(text).not.toContain("CLIENT_SECRET")
    expect(text).not.toContain("start-auth")
  })

  it("default flow unauthenticated message mentions start-auth and both credentials", async () => {
    delete process.env.AUTH_FLOW
    mockTokenRepository.getTokens.mockResolvedValue(null)

    const server = new McpServer({ name: "test", version: "1.0" })
    const registerAuthTools = await importAuthTools()
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Not authenticated")
    expect(text).toContain("start-auth")
    expect(text).toContain("CLIENT_ID")
    expect(text).toContain("CLIENT_SECRET")
    expect(text).not.toContain("start-device-auth")
  })
})
