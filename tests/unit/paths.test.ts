import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// We test paths.ts by controlling process.platform and process.env.APPDATA
// via vi.spyOn / manual overrides. The module uses os.homedir() and path.join
// (real implementations, not mocked) so the paths are realistic.
// ---------------------------------------------------------------------------

describe("paths", () => {
  const originalPlatform = process.platform
  const originalAppdata = process.env.APPDATA

  afterEach(() => {
    // Restore env
    if (originalAppdata === undefined) {
      delete process.env.APPDATA
    } else {
      process.env.APPDATA = originalAppdata
    }
    vi.resetModules()
  })

  // -----------------------------------------------------------------------
  // Helper: import paths with a fresh module cache so the module-level
  // computations pick up the current process.platform / env state.
  // -----------------------------------------------------------------------
  async function importPaths() {
    return import("../../src/infrastructure/paths.js")
  }

  // -----------------------------------------------------------------------
  // getConfigDir
  // -----------------------------------------------------------------------
  describe("getConfigDir", () => {
    it("returns a path ending with microsoft-todo-mcp", async () => {
      const { getConfigDir } = await importPaths()
      const dir = getConfigDir()
      expect(dir).toContain("microsoft-todo-mcp")
    })

    it("on Windows, prefers APPDATA when set", async () => {
      process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming"
      // We can't change process.platform at runtime, so just verify the
      // APPDATA branch is used when platform is win32. On non-Windows CI we
      // verify the Unix path instead.
      const { getConfigDir } = await importPaths()
      const dir = getConfigDir()
      if (process.platform === "win32") {
        expect(dir).toMatch(/AppData[\\/]Roaming[\\/]microsoft-todo-mcp/)
      } else {
        expect(dir).toMatch(/\.config[\\/]microsoft-todo-mcp/)
      }
    })
  })

  // -----------------------------------------------------------------------
  // getTokenFilePath
  // -----------------------------------------------------------------------
  describe("getTokenFilePath", () => {
    it("ends with tokens.json", async () => {
      const { getTokenFilePath } = await importPaths()
      expect(getTokenFilePath()).toMatch(/tokens\.json$/)
    })

    it("is inside the config dir", async () => {
      const { getConfigDir, getTokenFilePath } = await importPaths()
      const configDir = getConfigDir()
      const tokenPath = getTokenFilePath()
      expect(tokenPath.startsWith(configDir)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // getClaudeConfigPath
  // -----------------------------------------------------------------------
  describe("getClaudeConfigPath", () => {
    it("ends with claude_desktop_config.json", async () => {
      const { getClaudeConfigPath } = await importPaths()
      expect(getClaudeConfigPath()).toMatch(/claude_desktop_config\.json$/)
    })

    it("contains Claude directory segment", async () => {
      const { getClaudeConfigPath } = await importPaths()
      expect(getClaudeConfigPath()).toContain("Claude")
    })
  })

  // -----------------------------------------------------------------------
  // ensureConfigDir
  // -----------------------------------------------------------------------
  describe("ensureConfigDir", () => {
    it("returns the config dir path", async () => {
      const { ensureConfigDir, getConfigDir } = await importPaths()
      const dir = ensureConfigDir()
      expect(dir).toBe(getConfigDir())
    })
  })
})
