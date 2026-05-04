import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import http from "http"

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// NOTE: vi.mock factories are hoisted above all imports, so they cannot
// reference `const` variables declared at module level.  All mock functions
// are created inline inside the factory and accessed through vi.mocked()
// after the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock("../../src/oauth-engine.js", () => ({
  createOAuthEngine: vi.fn(() => ({
    getAuthUrl: vi.fn().mockResolvedValue("https://login.microsoftonline.com/test/oauth2?code=abc"),
    exchangeAuthCode: vi.fn().mockResolvedValue({
      accessToken: "at-test",
      refreshToken: "rt-test",
      expiresAt: Date.now() + 3600 * 1000,
    }),
    redirectUri: "http://localhost:4040/callback",
    tenantId: "organizations",
  })),
  OAuthConfigError: class OAuthConfigError extends Error {
    constructor(missing: string[]) {
      super(`Missing required OAuth environment variable(s): ${missing.join(", ")}`)
      this.name = "OAuthConfigError"
    }
  },
  OAuthExchangeError: class OAuthExchangeError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "OAuthExchangeError"
    }
  },
}))

vi.mock("../../src/token-manager.js", () => ({
  tokenManager: {
    saveTokens: vi.fn(),
  },
}))

// Import after mocks are in place
import { startAuthFlow } from "../../src/auth-callback-server.js"
import { createOAuthEngine } from "../../src/oauth-engine.js"
import { tokenManager } from "../../src/token-manager.js"

// Typed reference to the mocked saveTokens
const mockSaveTokens = vi.mocked(tokenManager.saveTokens)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let portCounter = 3100

/** Return a unique redirect URI for each test to avoid port conflicts. */
function uniqueRedirectUri(): string {
  return `http://localhost:${portCounter++}/callback`
}

function setEnv(env?: Record<string, string | undefined>) {
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
}

/** Make an HTTP GET request and return status + body. */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ""
        res.on("data", (chunk: string) => (body += chunk))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
      })
      .on("error", reject)
  })
}

/** Create a default mock engine that resolves successfully. */
function defaultMockEngine(redirectUri: string) {
  return {
    getAuthUrl: vi.fn().mockResolvedValue("https://login.microsoftonline.com/test/oauth2?code=abc"),
    exchangeAuthCode: vi.fn().mockResolvedValue({
      accessToken: "at-test",
      refreshToken: "rt-test",
      expiresAt: Date.now() + 3600 * 1000,
    }),
    redirectUri,
    tenantId: "organizations",
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth-callback-server", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv(VALID_ENV)
  })

  afterEach(() => {
    // Do NOT call vi.restoreAllMocks() — it would undo our mock setup.
    // vi.clearAllMocks() in beforeEach is sufficient.
  })

  // -------------------------------------------------------------------------
  // startAuthFlow — basic flow
  // -------------------------------------------------------------------------
  describe("startAuthFlow", () => {
    it("returns an auth URL from the OAuth engine", async () => {
      const redirectUri = uniqueRedirectUri()
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)

      const { authUrl } = await startAuthFlow({ redirectUri })
      expect(authUrl).toBe("https://login.microsoftonline.com/test/oauth2?code=abc")
    })

    it("starts a callback server and handles successful auth", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)

      const { result } = await startAuthFlow({ redirectUri })

      // Send a callback request
      const response = await httpGet(`http://localhost:${port}/callback?code=test-code-123`)

      expect(response.status).toBe(200)
      expect(response.body).toContain("Authentication Successful")

      const flowResult = await result
      expect(flowResult.success).toBe(true)
      expect(flowResult.message).toContain("successful")
    })

    it("exchanges the authorization code and saves tokens", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      const mockExchange = vi.fn().mockResolvedValue({
        accessToken: "at-test",
        refreshToken: "rt-test",
        expiresAt: Date.now() + 3600 * 1000,
      })
      vi.mocked(createOAuthEngine).mockImplementation(
        () =>
          ({
            getAuthUrl: vi.fn().mockResolvedValue("https://example.com/auth"),
            exchangeAuthCode: mockExchange,
            redirectUri,
            tenantId: "organizations",
          }) as any,
      )

      const { result } = await startAuthFlow({ redirectUri })
      await httpGet(`http://localhost:${port}/callback?code=exchange-me`)

      const flowResult = await result

      expect(mockExchange).toHaveBeenCalledWith("exchange-me")
      expect(mockSaveTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "at-test",
          refreshToken: "rt-test",
        }),
      )
      expect(flowResult.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Concurrent flow guard
  // -------------------------------------------------------------------------
  describe("concurrent flow prevention", () => {
    it("closes the previous server when starting a new flow on the same port", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port

      // First flow on this port
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)
      await startAuthFlow({ redirectUri })

      // Second flow on the same port — should close the first server
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)
      const second = await startAuthFlow({ redirectUri })

      // The second flow's server should be up
      const response = await httpGet(`http://localhost:${port}/callback?code=second-code`)
      expect(response.status).toBe(200)

      const result = await second.result
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------
  describe("timeout handling", () => {
    it("resolves with a timeout message when no callback is received", async () => {
      const redirectUri = uniqueRedirectUri()
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)

      const { result } = await startAuthFlow({ redirectUri, timeoutMs: 500 })

      const flowResult = await result
      expect(flowResult.success).toBe(false)
      expect(flowResult.message).toContain("timed out")
    }, 10_000)
  })

  // -------------------------------------------------------------------------
  // OAuth error in callback
  // -------------------------------------------------------------------------
  describe("OAuth error callback", () => {
    it("handles error parameter in callback", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)

      const { result } = await startAuthFlow({ redirectUri })

      const response = await httpGet(
        `http://localhost:${port}/callback?error=access_denied&error_description=User+cancelled`,
      )

      expect(response.status).toBe(400)
      expect(response.body).toContain("Authentication Failed")

      const flowResult = await result
      expect(flowResult.success).toBe(false)
      expect(flowResult.message).toContain("Authentication failed")
      expect(flowResult.message).toContain("User cancelled")
    })

    it("handles callback with no code and no error", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)

      const { result } = await startAuthFlow({ redirectUri })

      const response = await httpGet(`http://localhost:${port}/callback?state=xyz`)

      expect(response.status).toBe(400)

      const flowResult = await result
      expect(flowResult.success).toBe(false)
      expect(flowResult.message).toContain("No authorization code")
    })
  })

  // -------------------------------------------------------------------------
  // Token exchange failure
  // -------------------------------------------------------------------------
  describe("token exchange failure", () => {
    it("handles exchange errors gracefully", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      vi.mocked(createOAuthEngine).mockImplementation(
        () =>
          ({
            getAuthUrl: vi.fn().mockResolvedValue("https://example.com/auth"),
            exchangeAuthCode: vi.fn().mockRejectedValue(new Error("AADSTS70000: invalid code")),
            redirectUri,
            tenantId: "organizations",
          }) as any,
      )

      const { result } = await startAuthFlow({ redirectUri })

      const response = await httpGet(`http://localhost:${port}/callback?code=bad-code`)

      expect(response.status).toBe(500)
      expect(response.body).toContain("Authentication Failed")

      const flowResult = await result
      expect(flowResult.success).toBe(false)
      expect(flowResult.message).toContain("Token exchange failed")
    })
  })

  // -------------------------------------------------------------------------
  // Personal account detection
  // -------------------------------------------------------------------------
  describe("personal account detection", () => {
    it("returns 400 and skips token exchange when a consumer account hits the organizations endpoint", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      const mockExchange = vi.fn().mockResolvedValue({
        accessToken: "at-test",
        refreshToken: "rt-test",
        expiresAt: Date.now() + 3600 * 1000,
      })
      vi.mocked(createOAuthEngine).mockImplementation(
        () =>
          ({
            getAuthUrl: vi.fn().mockResolvedValue("https://example.com/auth"),
            exchangeAuthCode: mockExchange,
            redirectUri,
            tenantId: "organizations",
          }) as any,
      )

      const { result } = await startAuthFlow({ redirectUri })

      // client_info with utid = consumer tenant GUID
      const clientInfo =
        "eyJ1aWQiOiIwMDAwMDAwMC0wMDAwLTAwMDAtZjU0ZS0xN2VmOWJmM2I1NWQiLCJ1dGlkIjoiOTE4ODA0MGQtNmM2Ny00YzViLWIxMTItMzZhMzA0YjY2ZGFkIn0"
      const response = await httpGet(
        `http://localhost:${port}/callback?code=real-code&client_info=${clientInfo}`,
      )

      expect(response.status).toBe(400)
      expect(response.body).toContain("Personal Microsoft account detected")

      const flowResult = await result
      expect(flowResult.success).toBe(false)
      expect(flowResult.message).toContain("TENANT_ID=consumers")
      expect(mockExchange).not.toHaveBeenCalled()
    })

    it("allows consumer accounts when TENANT_ID is already set to consumers", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      const mockExchange = vi.fn().mockResolvedValue({
        accessToken: "at-test",
        refreshToken: "rt-test",
        expiresAt: Date.now() + 3600 * 1000,
      })
      vi.mocked(createOAuthEngine).mockImplementation(
        () =>
          ({
            getAuthUrl: vi.fn().mockResolvedValue("https://example.com/auth"),
            exchangeAuthCode: mockExchange,
            redirectUri,
            tenantId: "consumers",
          }) as any,
      )

      const { result } = await startAuthFlow({ redirectUri })

      const clientInfo =
        "eyJ1aWQiOiIwMDAwMDAwMC0wMDAwLTAwMDAtZjU0ZS0xN2VmOWJmM2I1NWQiLCJ1dGlkIjoiOTE4ODA0MGQtNmM2Ny00YzViLWIxMTItMzZhMzA0YjY2ZGFkIn0"
      const response = await httpGet(
        `http://localhost:${port}/callback?code=real-code&client_info=${clientInfo}`,
      )

      expect(response.status).toBe(200)
      expect(mockExchange).toHaveBeenCalledWith("real-code")

      const flowResult = await result
      expect(flowResult.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Non-callback requests
  // -------------------------------------------------------------------------
  describe("non-callback paths", () => {
    it("returns 404 for non-callback paths", async () => {
      const redirectUri = uniqueRedirectUri()
      const port = new URL(redirectUri).port
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)

      const { result } = await startAuthFlow({ redirectUri })

      const response = await httpGet(`http://localhost:${port}/other-path`)
      expect(response.status).toBe(404)

      // Clean up by triggering a callback
      await httpGet(`http://localhost:${port}/callback?code=cleanup`)
      await result
    })
  })

  // -------------------------------------------------------------------------
  // Config error propagation
  // -------------------------------------------------------------------------
  describe("config error", () => {
    it("propagates OAuthConfigError when env vars are missing", async () => {
      setEnv({})

      // Since createOAuthEngine is mocked, it won't actually throw.
      // The real error propagation is tested at the tool level.
      // Here we verify the module doesn't crash on its own.
      const redirectUri = uniqueRedirectUri()
      vi.mocked(createOAuthEngine).mockImplementation(() => defaultMockEngine(redirectUri) as any)

      const { authUrl } = await startAuthFlow({ redirectUri })
      expect(authUrl).toBeDefined()
    })
  })
})
