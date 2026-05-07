import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { exec } from "child_process"

// Mock child_process before importing the module
vi.mock("child_process", () => ({
  exec: vi.fn(),
}))

// Import after mock is in place
import { openBrowser } from "../../src/infrastructure/open-browser.js"

describe("openBrowser", () => {
  let execMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    execMock = vi.mocked(exec)
    execMock.mockImplementation((_cmd, _opts, callback) => {
      callback?.(null, { stdout: "", stderr: "" })
      return {} as any
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("uses 'start' command on Windows", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" })

    await openBrowser("https://example.com/auth")

    expect(execMock).toHaveBeenCalledWith(
      `start "" "https://example.com/auth"`,
      { timeout: 10_000 },
      expect.any(Function),
    )

    vi.unstubAllGlobals()
  })

  it("uses 'open' command on macOS", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" })

    await openBrowser("https://example.com/auth")

    expect(execMock).toHaveBeenCalledWith(`open "https://example.com/auth"`, { timeout: 10_000 }, expect.any(Function))

    vi.unstubAllGlobals()
  })

  it("uses 'xdg-open' command on Linux", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" })

    await openBrowser("https://example.com/auth")

    expect(execMock).toHaveBeenCalledWith(
      `xdg-open "https://example.com/auth"`,
      { timeout: 10_000 },
      expect.any(Function),
    )

    vi.unstubAllGlobals()
  })

  it("does not throw when exec fails", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" })
    execMock.mockImplementation((_cmd, _opts, callback) => {
      callback?.(new Error("Command failed"), { stdout: "", stderr: "" })
      return {} as any
    })

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    // Should not throw
    await expect(openBrowser("https://example.com/auth")).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to open browser"))

    errorSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
