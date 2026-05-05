/**
 * Debug tools — thin re-export aggregator.
 *
 * Delegates registration to the two focused modules so that `server.ts`
 * can continue importing `registerDebugTools` without changes.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerArchiveTools } from "./debug-archive-tools.js"
import { registerExplorationTools } from "./debug-exploration-tools.js"

export function registerDebugTools(server: McpServer): void {
  registerArchiveTools(server)
  registerExplorationTools(server)
}
