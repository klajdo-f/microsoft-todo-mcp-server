#!/usr/bin/env node

import { startServer } from "./todo-index.js"
import { pathToFileURL } from "url"
import { logger } from "./infrastructure/logger.js"
import { getAuthFlow } from "./auth-flow-config.js"

/**
 * CLI entry point. Validates required environment variables based on the
 * detected AUTH_FLOW and starts the MCP server.
 *
 * - `authorization_code` (default): requires CLIENT_ID and CLIENT_SECRET.
 * - `device_code`: requires only CLIENT_ID (public client — no secret).
 *
 * The server starts even when no tokens are present so the auth tools
 * are available.
 */
export async function runCli(): Promise<void> {
  const flow = getAuthFlow()
  const missing: string[] = []

  if (!process.env.CLIENT_ID) missing.push("CLIENT_ID")

  if (flow === "authorization_code") {
    if (!process.env.CLIENT_SECRET) missing.push("CLIENT_SECRET")
  }

  if (missing.length > 0) {
    const list = missing.join(" and ")
    logger.error(
      `Microsoft To Do MCP server (AUTH_FLOW=${flow}): missing required credential${missing.length > 1 ? "s" : ""}: ${list}. ` +
        `Provide them via the MCP client's "env" field in your server configuration.`,
      { source: "cli", missing, authFlow: flow },
    )
    throw new Error(`Missing required credential(s): ${list}`)
  }

  logger.info("Starting server", { source: "cli", authFlow: flow })

  await startServer()
}

// Only run when executed directly (not when imported by tests)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    logger.error("Fatal error starting server", {
      source: "cli",
      error: error instanceof Error ? error.message : String(error),
    })
    process.exit(1)
  })
}
