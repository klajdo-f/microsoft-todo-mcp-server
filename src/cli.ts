#!/usr/bin/env node

import { startServer } from "./todo-index.js"
import { tokenManager } from "./token-manager.js"

/**
 * CLI entry point. Checks for valid tokens via TokenManager and starts the
 * MCP server, or exits with an actionable error when no tokens are found.
 */
export async function runCli(): Promise<void> {
  const tokens = await tokenManager.getTokens()

  if (!tokens) {
    console.error(
      "Microsoft To Do MCP server: no tokens found. Run `npx mstodo-setup` to authenticate, then restart."
    )
    throw new Error("No tokens available — authentication required")
  }

  await startServer()
}

// Only run when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch(() => {
    process.exit(1)
  })
}
