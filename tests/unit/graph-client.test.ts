import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock tokenManager before importing graph-client
// ---------------------------------------------------------------------------

const mockGetTokens = vi.fn()

vi.mock("../../src/token-manager.js", () => ({
  tokenManager: {
    getTokens: (...args: unknown[]) => mockGetTokens(...args),
  },
}))

// Import after mocks are in place
import { makeGraphRequest, getAccessToken } from "../../src/graph-client.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }>) {
  let callIndex = 0
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const resp = responses[callIndex++]
      if (!resp) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("") })
      }
      return Promise.resolve(resp)
    }),
  )
}

function makeJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function makeTextResponse(text: string, status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(text),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("graph-client", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTokens.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("makeGraphRequest", () => {
    it("retries with a new token after a 401 and returns data", async () => {
      mockFetchSequence([
        makeTextResponse("Unauthorized", 401),
        makeJsonResponse({ id: "task-1", title: "Hello" }, 200),
      ])
      mockGetTokens.mockResolvedValue({
        accessToken: "new-token",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      const result = await makeGraphRequest<{ id: string; title: string }>("https://graph.microsoft.com/v1.0/me/todo/lists", "old-token")

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(result).not.toBeNull()
      expect(result!.title).toBe("Hello")

      // Second call should use the new token
      const [, secondOptions] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1]
      expect(secondOptions.headers.Authorization).toBe("Bearer new-token")
    })

    it("does not retry when getAccessToken returns the same token", async () => {
      mockFetchSequence([makeTextResponse("Unauthorized", 401)])
      mockGetTokens.mockResolvedValue({
        accessToken: "same-token",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      const result = await makeGraphRequest<{ id: string }>("https://graph.microsoft.com/v1.0/me/todo/lists", "same-token")

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(result).toBeNull()
    })

    it("does not infinite loop on double 401", async () => {
      mockFetchSequence([
        makeTextResponse("Unauthorized", 401),
        makeTextResponse("Unauthorized", 401),
      ])
      mockGetTokens.mockResolvedValue({
        accessToken: "new-token",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      // makeGraphRequest catches errors and returns null for non-MailboxNotEnabled errors
      const result = await makeGraphRequest<{ id: string }>("https://graph.microsoft.com/v1.0/me/todo/lists", "old-token")

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(result).toBeNull()
    })

    it("propagates non-401 errors immediately without calling getAccessToken", async () => {
      mockFetchSequence([makeTextResponse("Server Error", 500)])
      mockGetTokens.mockResolvedValue({
        accessToken: "at-123",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      // makeGraphRequest catches the thrown error and returns null
      const result = await makeGraphRequest<{ id: string }>("https://graph.microsoft.com/v1.0/me/todo/lists", "at-123")

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(mockGetTokens).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it("returns data on successful initial request without refresh", async () => {
      mockFetchSequence([makeJsonResponse({ value: [{ id: "list-1" }] }, 200)])

      const result = await makeGraphRequest<{ value: Array<{ id: string }> }>("https://graph.microsoft.com/v1.0/me/todo/lists", "at-123")

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(mockGetTokens).not.toHaveBeenCalled()
      expect(result).not.toBeNull()
      expect(result!.value[0].id).toBe("list-1")
    })
  })

  describe("getAccessToken", () => {
    it("returns null when tokenManager.getTokens() returns null", async () => {
      mockGetTokens.mockResolvedValue(null)

      const result = await getAccessToken()

      expect(result).toBeNull()
      expect(mockGetTokens).toHaveBeenCalledTimes(1)
    })

    it("returns the access token when tokens are available", async () => {
      mockGetTokens.mockResolvedValue({
        accessToken: "at-abc",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      const result = await getAccessToken()

      expect(result).toBe("at-abc")
    })
  })
})
