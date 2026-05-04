import { join, resolve } from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"

/**
 * Detects the appropriate command and args to run the MCP server.
 *
 * - If running from a local clone (package.json with bin field present),
 *   uses `node <abs-path-to-cli.js>`.
 * - If installed globally via npm, uses `npx microsoft-todo-mcp-server`.
 *
 * @param runtimeDir - The directory containing the dist/ output.
 *                      When empty or whitespace, falls back to npx.
 */
export function detectServerCommand(runtimeDir: string): { command: string; args: string[] } {
  // Guard against empty / whitespace input
  if (!runtimeDir || !runtimeDir.trim()) {
    return { command: "npx", args: ["microsoft-todo-mcp-server"] }
  }

  const absRuntimeDir = resolve(runtimeDir)
  const cliJsPath = join(absRuntimeDir, "cli.js")

  // If the built cli.js exists locally, point directly at it
  if (existsSync(cliJsPath)) {
    return { command: "node", args: [cliJsPath] }
  }

  // Otherwise fall back to the global npx resolution
  return { command: "npx", args: ["microsoft-todo-mcp-server"] }
}

/**
 * Generates the MCP config entry object for Claude Desktop.
 *
 * The returned object contains **only** `command` and `args` — never an
 * `env` property.  Tokens are read from the platform-specific config dir
 * so there is no need to embed secrets in the Claude config.
 */
export function generateClaudeConfigEntry(serverCommand: { command: string; args: string[] }): Record<string, unknown> {
  return {
    command: serverCommand.command,
    args: serverCommand.args,
  }
}
