#!/usr/bin/env node

import { startServer } from "./todo-index.js"

/**
 * CLI entry point. Checks for OAuth client credentials (CLIENT_ID and
 * CLIENT_SECRET) in process.env and starts the MCP server, or exits with an
 * actionable error when credentials are missing. The server starts even when
 * no tokens are present so the start-auth MCP tool is available.
 */
export async function runCli(): Promise<void> {
  const missing: string[] = []
  if (!process.env.CLIENT_ID) missing.push("CLIENT_ID")
  if (!process.env.CLIENT_SECRET) missing.push("CLIENT_SECRET")

  if (missing.length > 0) {
    const list = missing.join(" and ")
    console.error(
      `Microsoft To Do MCP server: missing required credential${missing.length > 1 ? "s" : ""}: ${list}. ` +
        `Provide them via the MCP client's "env" field in your server configuration.`,
    )
    throw new Error(`Missing required credential(s): ${list}`)
  }

  await startServer()
}

// Only run when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch(() => {
    process.exit(1)
  })
}
