/**
 * Tests for authentication MCP tool handlers.
 *
 * Verifies that:
 * - `auth-status` reads the persisted `isPersonalAccount` flag directly
 *   (no live API call) and surfaces the warning exactly when true.
 * - `start-auth` response text includes a pre-emptive personal-account
 *   limitation note.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerAuthTools } from "../../src/interface/tools/auth-tools.js"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/token-manager.js", () => ({
  tokenManager: {
    getTokens: vi.fn(),
  },
}))

vi.mock("../../src/auth-callback-server.js", () => ({
  startAuthFlow: vi.fn(),
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

vi.mock("../../src/oauth-engine.js", () => ({
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

import { tokenManager } from "../../src/token-manager.js"
import { startAuthFlow } from "../../src/auth-callback-server.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToolHandler(server: McpServer, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (server as any)._registeredTools[name]
  if (!tool) throw new Error(`Tool ${name} not registered`)
  return tool.handler.bind(tool)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth-status", () => {
  const futureDate = Date.now() + 3600_000

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("surfaces warning when isPersonalAccount is true", async () => {
    vi.mocked(tokenManager.getTokens).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: futureDate,
      isPersonalAccount: true,
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Authenticated.")
    expect(text).toContain("WARNING")
    expect(text).toContain("personal Microsoft account")
  })

  it("omits warning when isPersonalAccount is false", async () => {
    vi.mocked(tokenManager.getTokens).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: futureDate,
      isPersonalAccount: false,
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Authenticated.")
    expect(text).not.toContain("WARNING")
    expect(text).not.toContain("personal Microsoft account")
  })

  it("omits warning when isPersonalAccount is missing", async () => {
    vi.mocked(tokenManager.getTokens).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: futureDate,
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Authenticated.")
    expect(text).not.toContain("WARNING")
    expect(text).not.toContain("personal Microsoft account")
  })

  it("reports not-authenticated when tokens are null", async () => {
    vi.mocked(tokenManager.getTokens).mockResolvedValue(null)

    const server = new McpServer({ name: "test", version: "1.0" })
    registerAuthTools(server)

    const handler = getToolHandler(server, "auth-status")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("Not authenticated")
    expect(text).not.toContain("Authenticated")
  })
})

describe("start-auth", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("response text mentions personal account limitations", async () => {
    vi.mocked(startAuthFlow).mockResolvedValue({
      authUrl: "https://login.microsoftonline.com/test",
      result: Promise.resolve({ success: true, message: "ok" }),
    })

    const server = new McpServer({ name: "test", version: "1.0" })
    registerAuthTools(server)

    const handler = getToolHandler(server, "start-auth")
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("personal Microsoft account")
    expect(text).toContain("Outlook.com")
    expect(text).toContain("Microsoft Graph API")
    expect(text).toContain("platform restriction")
  })
})
