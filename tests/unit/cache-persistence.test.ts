import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockExistsSync = vi.fn<boolean, [string]>()
const mockReadFileSync = vi.fn<string, [string, string]>()
const mockWriteFileSync = vi.fn<void, [string, string, string]>()
const mockEnsureConfigDir = vi.fn<string, []>()
const mockGetTokenFilePath = vi.fn<string, []>()

vi.mock("fs", () => ({
  existsSync: (...args: [string]) => mockExistsSync(...args),
  readFileSync: (...args: [string, string]) => mockReadFileSync(...args),
  writeFileSync: (...args: [string, string, string]) => mockWriteFileSync(...args),
}))

vi.mock("../../src/paths.js", () => ({
  getTokenFilePath: () => mockGetTokenFilePath(),
  ensureConfigDir: () => mockEnsureConfigDir(),
}))

vi.mock("../../src/infrastructure/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Import after mocks are in place
import { MsalCachePersistence } from "../../src/infrastructure/cache-persistence.js"
import { logger } from "../../src/infrastructure/logger.js"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MsalCachePersistence", () => {
  const DEFAULT_PATH = "/mock/config/tokens.json"

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTokenFilePath.mockReturnValue(DEFAULT_PATH)
    mockEnsureConfigDir.mockReturnValue("/mock/config")
  })

  // -------------------------------------------------------------------------
  // load()
  // -------------------------------------------------------------------------

  describe("load()", () => {
    it("returns null when the file does not exist", () => {
      mockExistsSync.mockReturnValue(false)

      const persistence = new MsalCachePersistence()
      const result = persistence.load()

      expect(result).toBeNull()
      expect(mockExistsSync).toHaveBeenCalledWith(DEFAULT_PATH)
      expect(mockReadFileSync).not.toHaveBeenCalled()
    })

    it("returns the serialized string when the file exists", () => {
      const serialized = '{"Account":{},"RefreshToken":"abc123"}'
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(serialized)

      const persistence = new MsalCachePersistence()
      const result = persistence.load()

      expect(result).toBe(serialized)
      expect(mockReadFileSync).toHaveBeenCalledWith(DEFAULT_PATH, "utf-8")
    })

    it("returns null and logs error when readFileSync throws", () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied")
      })

      const persistence = new MsalCachePersistence()
      const result = persistence.load()

      expect(result).toBeNull()
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to read MSAL cache from disk",
        expect.objectContaining({
          path: DEFAULT_PATH,
          error: "EACCES: permission denied",
        }),
      )
    })

    it("handles non-Error throws gracefully in load", () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw "raw string error" // eslint-disable-line no-throw-literal
      })

      const persistence = new MsalCachePersistence()
      const result = persistence.load()

      expect(result).toBeNull()
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to read MSAL cache from disk",
        expect.objectContaining({ error: "raw string error" }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // save()
  // -------------------------------------------------------------------------

  describe("save()", () => {
    it("ensures config dir and writes serialized cache to the expected path", () => {
      const serialized = '{"Account":{},"RefreshToken":"abc123"}'

      const persistence = new MsalCachePersistence()
      persistence.save(serialized)

      expect(mockEnsureConfigDir).toHaveBeenCalledOnce()
      expect(mockWriteFileSync).toHaveBeenCalledWith(DEFAULT_PATH, serialized, "utf-8")
    })

    it("uses custom path when provided via constructor", () => {
      const customPath = "/custom/path/tokens.json"
      mockGetTokenFilePath.mockReturnValue(customPath)
      const serialized = '{"data":"test"}'

      const persistence = new MsalCachePersistence(customPath)
      persistence.save(serialized)

      expect(mockWriteFileSync).toHaveBeenCalledWith(customPath, serialized, "utf-8")
    })

    it("logs error and does not throw when writeFileSync fails", () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error("ENOSPC: no space left on device")
      })

      const persistence = new MsalCachePersistence()
      expect(() => persistence.save("{}")).not.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to write MSAL cache to disk",
        expect.objectContaining({
          path: DEFAULT_PATH,
          error: "ENOSPC: no space left on device",
        }),
      )
    })

    it("logs error and does not throw when ensureConfigDir fails", () => {
      mockEnsureConfigDir.mockImplementation(() => {
        throw new Error("EACCES: cannot create config dir")
      })

      const persistence = new MsalCachePersistence()
      expect(() => persistence.save("{}")).not.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to write MSAL cache to disk",
        expect.objectContaining({
          error: "EACCES: cannot create config dir",
        }),
      )
    })

    it("handles non-Error throws gracefully in save", () => {
      mockWriteFileSync.mockImplementation(() => {
        throw undefined // eslint-disable-line no-throw-literal
      })

      const persistence = new MsalCachePersistence()
      expect(() => persistence.save("{}")).not.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to write MSAL cache to disk",
        expect.objectContaining({ error: "undefined" }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("defaults to getTokenFilePath() when no path is provided", () => {
      mockExistsSync.mockReturnValue(false)

      const persistence = new MsalCachePersistence()
      persistence.load()

      expect(mockGetTokenFilePath).toHaveBeenCalledOnce()
    })

    it("uses the provided custom path", () => {
      const customPath = "/tmp/custom-tokens.json"
      mockExistsSync.mockReturnValue(false)

      const persistence = new MsalCachePersistence(customPath)
      persistence.load()

      expect(mockExistsSync).toHaveBeenCalledWith(customPath)
      // getTokenFilePath should NOT be called when a custom path is provided
      expect(mockGetTokenFilePath).not.toHaveBeenCalled()
    })
  })
})
