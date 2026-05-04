import { join } from "path"
import { homedir } from "os"
import { existsSync, mkdirSync } from "fs"

/**
 * Returns the platform-specific config directory for microsoft-todo-mcp.
 *
 * - Windows: %APPDATA%/microsoft-todo-mcp  (falls back to ~/AppData/Roaming)
 * - macOS/Linux: ~/.config/microsoft-todo-mcp
 */
export function getConfigDir(): string {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "microsoft-todo-mcp",
    )
  }
  return join(homedir(), ".config", "microsoft-todo-mcp")
}

/**
 * Returns the absolute path to the token file inside the platform config dir.
 */
export function getTokenFilePath(): string {
  return join(getConfigDir(), "tokens.json")
}

/**
 * Returns the platform-specific Claude Desktop config path.
 *
 * - Windows: %APPDATA%/Claude/claude_desktop_config.json
 * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Linux: ~/.config/Claude/claude_desktop_config.json
 */
export function getClaudeConfigPath(): string {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "Claude",
      "claude_desktop_config.json",
    )
  }
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    )
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json")
}

/**
 * Ensures the config directory exists. Idempotent — safe to call when the
 * directory already exists.
 */
export function ensureConfigDir(): string {
  const dir = getConfigDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}
