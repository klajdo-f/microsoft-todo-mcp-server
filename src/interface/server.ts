/**
 * MCP server assembly point.
 *
 * Creates a single McpServer instance, delegates tool registration to
 * domain-grouped modules in interface/tools/, and exports startServer()
 * for the CLI entry point (src/cli.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { registerAuthTools } from "./tools/auth-tools.js"
import { registerListTools } from "./tools/list-tools.js"
import { registerTaskTools } from "./tools/task-tools.js"
import { registerChecklistTools } from "./tools/checklist-tools.js"
import { registerDebugTools } from "./tools/debug-tools.js"

// ---------------------------------------------------------------------------
// Server configuration (kept for backward compatibility)
// ---------------------------------------------------------------------------

export interface ServerConfig {
  accessToken?: string
  refreshToken?: string
  tokenFilePath?: string
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Create and return a fully-wired McpServer with all 17 tools registered.
 * Exported for testing or advanced composition; prefer startServer() for
 * normal use.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mstodo",
    version: "1.0.0",
  })

  registerAuthTools(server)
  registerListTools(server)
  registerTaskTools(server)
  registerChecklistTools(server)
  registerDebugTools(server)

  return server
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the MCP server on stdio.
 *
 * Token management is handled by the TokenManager class; config options
 * are accepted for backward compatibility but are not used.
 */
export async function startServer(_config?: ServerConfig): Promise<void> {
  try {
    const server = createMcpServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)

    console.error("Server started and listening")
  } catch (error) {
    console.error("Error starting server:", error)
    throw error
  }
}
