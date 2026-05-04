import { describe, it, expect, vi, beforeEach } from "vitest"
import path from "path"

// Mock fs so detectServerCommand doesn't hit the real filesystem
vi.mock("fs", async () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

describe("detectServerCommand", () => {
  beforeEach(async () => {
    const fs = await import("fs")
    vi.mocked(fs.existsSync).mockReset()
  })

  it("returns node + abs cli.js path when dist/cli.js exists locally", async () => {
    const fs = await import("fs")
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const { detectServerCommand } = await import("../../src/setup-config.js")
    const result = detectServerCommand("/project/dist")
    expect(result.command).toBe("node")
    expect(result.args[0]).toBe(path.resolve("/project/dist", "cli.js"))
    expect(result.args[0]).toContain("cli.js")
  })

  it("falls back to npx when dist/cli.js does not exist", async () => {
    const fs = await import("fs")
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const { detectServerCommand } = await import("../../src/setup-config.js")
    const result = detectServerCommand("/some/random/path")
    expect(result.command).toBe("npx")
    expect(result.args).toEqual(["microsoft-todo-mcp-server"])
  })

  it("falls back to npx when runtimeDir is an empty string", async () => {
    const { detectServerCommand } = await import("../../src/setup-config.js")
    const result = detectServerCommand("")
    expect(result.command).toBe("npx")
    expect(result.args).toEqual(["microsoft-todo-mcp-server"])
  })

  it("falls back to npx when runtimeDir is whitespace only", async () => {
    const { detectServerCommand } = await import("../../src/setup-config.js")
    const result = detectServerCommand("   ")
    expect(result.command).toBe("npx")
    expect(result.args).toEqual(["microsoft-todo-mcp-server"])
  })

  it("resolves relative paths to absolute", async () => {
    const fs = await import("fs")
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const { detectServerCommand } = await import("../../src/setup-config.js")
    const result = detectServerCommand("./dist")
    expect(path.isAbsolute(result.args[0])).toBe(true)
  })
})

describe("generateClaudeConfigEntry", () => {
  it("returns only command and args", async () => {
    const { generateClaudeConfigEntry } = await import("../../src/setup-config.js")
    const entry = generateClaudeConfigEntry({
      command: "node",
      args: ["/usr/local/lib/node_modules/microsoft-todo-mcp-server/dist/cli.js"],
    })

    expect(entry).toEqual({
      command: "node",
      args: ["/usr/local/lib/node_modules/microsoft-todo-mcp-server/dist/cli.js"],
    })
  })

  it("never includes an env property", async () => {
    const { generateClaudeConfigEntry } = await import("../../src/setup-config.js")
    const entry = generateClaudeConfigEntry({
      command: "npx",
      args: ["microsoft-todo-mcp-server"],
    })

    expect(entry).not.toHaveProperty("env")
    expect(Object.keys(entry).sort()).toEqual(["args", "command"])
  })

  it("does not include env even when called with missing env vars in process", async () => {
    const { generateClaudeConfigEntry } = await import("../../src/setup-config.js")
    // Simulate being called in an environment with no env vars set
    const originalEnv = process.env.MS_TODO_ACCESS_TOKEN
    delete process.env.MS_TODO_ACCESS_TOKEN

    const entry = generateClaudeConfigEntry({
      command: "node",
      args: ["/some/path/cli.js"],
    })

    expect(entry).not.toHaveProperty("env")

    // Restore
    if (originalEnv !== undefined) {
      process.env.MS_TODO_ACCESS_TOKEN = originalEnv
    }
  })
})
