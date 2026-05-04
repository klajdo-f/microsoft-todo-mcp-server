import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test.
// cli.ts imports tokenManager (a singleton) and startServer — we control both.
// ---------------------------------------------------------------------------

const mockGetTokens = vi.fn()
const mockStartServer = vi.fn()

vi.mock("../../src/token-manager.js", () => ({
  tokenManager: {
    getTokens: (...args: unknown[]) => mockGetTokens(...args),
  },
}))

vi.mock("../../src/todo-index.js", () => ({
  startServer: (...args: unknown[]) => mockStartServer(...args),
}))

// Import after mocks are in place
import { runCli } from "../../src/cli.js"

describe("runCli", () => {
  beforeEach(() => {
    mockGetTokens.mockReset()
    mockStartServer.mockReset()
  })

  it("throws and never calls startServer when getTokens() returns null", async () => {
    mockGetTokens.mockResolvedValue(null)

    await expect(runCli()).rejects.toThrow("No tokens available")

    expect(mockStartServer).not.toHaveBeenCalled()
  })

  it("calls startServer once when getTokens() returns valid tokens", async () => {
    mockGetTokens.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
    })
    mockStartServer.mockResolvedValue(undefined)

    await runCli()

    expect(mockStartServer).toHaveBeenCalledTimes(1)
  })

  it("propagates errors when startServer() rejects", async () => {
    mockGetTokens.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
    })
    mockStartServer.mockRejectedValue(new Error("server boom"))

    await expect(runCli()).rejects.toThrow("server boom")
  })

  it("prints actionable error to stderr when no tokens are found", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockGetTokens.mockResolvedValue(null)

    await expect(runCli()).rejects.toThrow()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toContain("mstodo-setup")
    expect(message).not.toContain("at-")   // no token leakage
    expect(message).not.toContain("rt-")

    errorSpy.mockRestore()
  })
})
