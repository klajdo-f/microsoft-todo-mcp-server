/**
 * Backward-compatible entry point.
 *
 * Re-exports startServer from the modular server implementation so that
 * existing consumers (cli.ts, tests mocking "../../src/todo-index.js")
 * continue to resolve without changes.
 */
export { startServer } from "./interface/server.js"
