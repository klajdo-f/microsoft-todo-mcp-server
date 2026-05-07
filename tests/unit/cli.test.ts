import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test.
// cli.ts imports startServer — we control it.
// ---------------------------------------------------------------------------

const mockStartServer = vi.fn()

vi.mock("../../src/interface/server.js", () => ({
  startServer: (...args: unknown[]) => mockStartServer(...args),
}))

// Import after mocks are in place
import { runCli } from "../../src/cli.js"

describe("runCli", () => {
  let originalClientId: string | undefined
  let originalClientSecret: string | undefined
  let originalAuthFlow: string | undefined

  beforeEach(() => {
    mockStartServer.mockReset()
    // Save originals
    originalClientId = process.env.CLIENT_ID
    originalClientSecret = process.env.CLIENT_SECRET
    originalAuthFlow = process.env.AUTH_FLOW
  })

  afterEach(() => {
    // Restore originals
    if (originalClientId !== undefined) {
      process.env.CLIENT_ID = originalClientId
    } else {
      delete process.env.CLIENT_ID
    }
    if (originalClientSecret !== undefined) {
      process.env.CLIENT_SECRET = originalClientSecret
    } else {
      delete process.env.CLIENT_SECRET
    }
    if (originalAuthFlow !== undefined) {
      process.env.AUTH_FLOW = originalAuthFlow
    } else {
      delete process.env.AUTH_FLOW
    }
  })

  // -------------------------------------------------------------------------
  // Authorization code flow (default)
  // -------------------------------------------------------------------------

  describe("AUTH_FLOW=authorization_code (default)", () => {
    beforeEach(() => {
      delete process.env.AUTH_FLOW
    })

    it("throws and never calls startServer when CLIENT_ID is missing", async () => {
      delete process.env.CLIENT_ID
      process.env.CLIENT_SECRET = "secret-123"

      await expect(runCli()).rejects.toThrow("Missing required credential(s): CLIENT_ID")

      expect(mockStartServer).not.toHaveBeenCalled()
    })

    it("throws and never calls startServer when CLIENT_SECRET is missing", async () => {
      process.env.CLIENT_ID = "id-123"
      delete process.env.CLIENT_SECRET

      await expect(runCli()).rejects.toThrow("Missing required credential(s): CLIENT_SECRET")

      expect(mockStartServer).not.toHaveBeenCalled()
    })

    it("throws and never calls startServer when both credentials are missing", async () => {
      delete process.env.CLIENT_ID
      delete process.env.CLIENT_SECRET

      await expect(runCli()).rejects.toThrow("Missing required credential(s): CLIENT_ID and CLIENT_SECRET")

      expect(mockStartServer).not.toHaveBeenCalled()
    })

    it("calls startServer when both CLIENT_ID and CLIENT_SECRET are present", async () => {
      process.env.CLIENT_ID = "id-123"
      process.env.CLIENT_SECRET = "secret-123"
      mockStartServer.mockResolvedValue(undefined)

      await runCli()

      expect(mockStartServer).toHaveBeenCalledTimes(1)
    })

    it("propagates errors when startServer() rejects", async () => {
      process.env.CLIENT_ID = "id-123"
      process.env.CLIENT_SECRET = "secret-123"
      mockStartServer.mockRejectedValue(new Error("server boom"))

      await expect(runCli()).rejects.toThrow("server boom")
    })

    it("prints actionable error to stderr when credentials are missing", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      delete process.env.CLIENT_ID
      delete process.env.CLIENT_SECRET

      await expect(runCli()).rejects.toThrow()

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const message = errorSpy.mock.calls[0][0] as string
      expect(message).toContain("CLIENT_ID")
      expect(message).toContain("env")
      // Verify no secret values leak
      expect(message).not.toContain("secret-123")
      expect(message).not.toContain("id-123")

      errorSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Device code flow
  // -------------------------------------------------------------------------

  describe("AUTH_FLOW=device_code", () => {
    beforeEach(() => {
      process.env.AUTH_FLOW = "device_code"
    })

    it("calls startServer with only CLIENT_ID present (no CLIENT_SECRET needed)", async () => {
      process.env.CLIENT_ID = "id-123"
      delete process.env.CLIENT_SECRET
      mockStartServer.mockResolvedValue(undefined)

      await runCli()

      expect(mockStartServer).toHaveBeenCalledTimes(1)
    })

    it("throws and never calls startServer when CLIENT_ID is missing", async () => {
      delete process.env.CLIENT_ID
      delete process.env.CLIENT_SECRET

      await expect(runCli()).rejects.toThrow("Missing required credential(s): CLIENT_ID")

      expect(mockStartServer).not.toHaveBeenCalled()
    })

    it("calls startServer even without CLIENT_SECRET", async () => {
      process.env.CLIENT_ID = "id-123"
      delete process.env.CLIENT_SECRET
      mockStartServer.mockResolvedValue(undefined)

      await runCli()

      expect(mockStartServer).toHaveBeenCalledTimes(1)
    })

    it("propagates errors when startServer() rejects", async () => {
      process.env.CLIENT_ID = "id-123"
      mockStartServer.mockRejectedValue(new Error("server boom"))

      await expect(runCli()).rejects.toThrow("server boom")
    })
  })
})
