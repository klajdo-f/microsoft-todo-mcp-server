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
import {
  AuthError,
  GraphApiError,
  MailboxNotEnabledError,
  McpError,
  NetworkError,
  PermissionDeniedError,
} from "../../src/domain/errors.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchSequence(
  responses: Array<{
    ok?: boolean
    status?: number
    json?: () => Promise<unknown>
    text?: () => Promise<string>
  }>,
) {
  let callIndex = 0
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const resp = responses[callIndex++]
      if (!resp) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(""),
        })
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
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(text),
  }
}

function makeNoContentResponse() {
  return {
    ok: true,
    status: 204,
    text: () => Promise.resolve(""),
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

  // =========================================================================
  // makeGraphRequest — success paths
  // =========================================================================

  describe("makeGraphRequest — success paths", () => {
    it("returns data on successful initial request without refresh", async () => {
      mockFetchSequence([makeJsonResponse({ value: [{ id: "list-1" }] }, 200)])

      const result = await makeGraphRequest<{ value: Array<{ id: string }> }>(
        "https://graph.microsoft.com/v1.0/me/todo/lists",
        "at-123",
      )

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(mockGetTokens).not.toHaveBeenCalled()
      expect(result).not.toBeNull()
      expect(result!.value[0].id).toBe("list-1")
    })

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

      const result = await makeGraphRequest<{ id: string; title: string }>(
        "https://graph.microsoft.com/v1.0/me/todo/lists",
        "old-token",
      )

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(result).not.toBeNull()
      expect(result!.title).toBe("Hello")

      // Second call should use the new token
      const [, secondOptions] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1]
      expect(secondOptions.headers.Authorization).toBe("Bearer new-token")
    })

    it("returns null for 204 No Content without attempting JSON parse", async () => {
      mockFetchSequence([makeNoContentResponse()])

      const result = await makeGraphRequest<null>(
        "https://graph.microsoft.com/v1.0/me/todo/lists/list-1",
        "at-123",
        "DELETE",
      )

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // makeGraphRequest — error paths (typed exceptions)
  // =========================================================================

  describe("makeGraphRequest — typed exceptions", () => {
    it("throws AuthError on 401 after retry with new token still returning 401", async () => {
      mockFetchSequence([
        makeTextResponse("Unauthorized", 401),
        makeTextResponse("Unauthorized", 401),
      ])
      mockGetTokens.mockResolvedValue({
        accessToken: "new-token",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      await expect(
        makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "old-token",
        ),
      ).rejects.toThrow(AuthError)

      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it("throws AuthError with AUTH_ERROR code on double 401", async () => {
      mockFetchSequence([
        makeTextResponse("Unauthorized", 401),
        makeTextResponse("Unauthorized", 401),
      ])
      mockGetTokens.mockResolvedValue({
        accessToken: "new-token",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      try {
        await makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "old-token",
        )
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError)
        expect(error).toBeInstanceOf(McpError)
        expect((error as AuthError).code).toBe("AUTH_ERROR")
      }
    })

    it("throws AuthError when getAccessToken fails during 401 retry", async () => {
      mockFetchSequence([makeTextResponse("Unauthorized", 401)])
      mockGetTokens.mockRejectedValue(new Error("Token refresh failed"))

      await expect(
        makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "old-token",
        ),
      ).rejects.toThrow(AuthError)
    })

    it("throws AuthError when token is the same after 401 (no retry)", async () => {
      mockFetchSequence([makeTextResponse("Unauthorized", 401)])
      mockGetTokens.mockResolvedValue({
        accessToken: "same-token",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      await expect(
        makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "same-token",
        ),
      ).rejects.toThrow(AuthError)

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it("throws PermissionDeniedError on 403", async () => {
      mockFetchSequence([
        makeTextResponse('{"error":{"code":"ErrorAccessDenied","message":"Access is denied."}}', 403),
      ])

      try {
        await makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "at-123",
        )
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(PermissionDeniedError)
        expect(error).toBeInstanceOf(McpError)
        expect((error as PermissionDeniedError).code).toBe("PERMISSION_DENIED")
      }
    })

    it("throws GraphApiError with status 500 on server error", async () => {
      mockFetchSequence([makeTextResponse("Internal Server Error", 500)])

      try {
        await makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "at-123",
        )
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(GraphApiError)
        expect(error).toBeInstanceOf(McpError)
        expect((error as GraphApiError).code).toBe("GRAPH_API_ERROR")
        expect((error as GraphApiError).status).toBe(500)
        expect((error as GraphApiError).responseBody).toBe("Internal Server Error")
      }
    })

    it("throws MailboxNotEnabledError when body contains MailboxNotEnabledForRESTAPI", async () => {
      mockFetchSequence([
        makeTextResponse(
          '{"error":{"code":"ErrorInternalOperation","message":"MailboxNotEnabledForRESTAPI"}}',
          404,
        ),
      ])

      try {
        await makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "at-123",
        )
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(MailboxNotEnabledError)
        expect(error).toBeInstanceOf(McpError)
        expect((error as MailboxNotEnabledError).code).toBe("MAILBOX_NOT_ENABLED")
      }
    })

    it("throws NetworkError when fetch rejects (DNS, timeout, etc.)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      )

      try {
        await makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "at-123",
        )
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError)
        expect(error).toBeInstanceOf(McpError)
        expect((error as NetworkError).code).toBe("NETWORK_ERROR")
        expect((error as NetworkError).context?.cause).toBe("ECONNREFUSED")
      }
    })

    it("does not call getAccessToken for non-401 HTTP errors", async () => {
      mockFetchSequence([makeTextResponse("Server Error", 500)])
      mockGetTokens.mockResolvedValue({
        accessToken: "at-123",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      await expect(
        makeGraphRequest<{ id: string }>("https://graph.microsoft.com/v1.0/me/todo/lists", "at-123"),
      ).rejects.toThrow(GraphApiError)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(mockGetTokens).not.toHaveBeenCalled()
    })

    it("rethrows McpError subclasses without wrapping them in NetworkError", async () => {
      // Simulate a GraphApiError being thrown from within the try block
      const graphError = new GraphApiError("test", 503, "service unavailable")
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => {
          throw graphError
        }),
      )

      // The outer catch should rethrow the McpError as-is, not wrap it
      try {
        await makeGraphRequest<{ id: string }>(
          "https://graph.microsoft.com/v1.0/me/todo/lists",
          "at-123",
        )
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBe(graphError) // same reference, not wrapped
        expect(error).toBeInstanceOf(GraphApiError)
        expect((error as GraphApiError).code).toBe("GRAPH_API_ERROR")
      }
    })
  })

  // =========================================================================
  // getAccessToken
  // =========================================================================

  describe("getAccessToken", () => {
    it("returns the access token when tokens are available", async () => {
      mockGetTokens.mockResolvedValue({
        accessToken: "at-abc",
        refreshToken: "rt-456",
        expiresAt: Date.now() + 3600_000,
      })

      const result = await getAccessToken()

      expect(result).toBe("at-abc")
    })

    it("throws AuthError when tokenManager.getTokens() returns null", async () => {
      mockGetTokens.mockResolvedValue(null)

      try {
        await getAccessToken()
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError)
        expect((error as AuthError).code).toBe("AUTH_ERROR")
      }
    })

    it("throws AuthError when tokenManager.getTokens() rejects", async () => {
      mockGetTokens.mockRejectedValue(new Error("Token service unavailable"))

      try {
        await getAccessToken()
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError)
        expect((error as AuthError).code).toBe("AUTH_ERROR")
        expect((error as AuthError).message).toContain("Token service unavailable")
      }
    })

    it("re-throws AuthError from getTokens without double-wrapping", async () => {
      const authErr = new AuthError("Original auth failure")
      mockGetTokens.mockRejectedValue(authErr)

      try {
        await getAccessToken()
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBe(authErr) // same reference — not wrapped
      }
    })
  })
})
