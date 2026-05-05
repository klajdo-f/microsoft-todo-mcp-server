/**
 * Server registration smoke test.
 *
 * Asserts that createMcpServer() registers exactly the expected set of
 * MCP tools.  This catches silent tool loss during future refactors.
 */
import { describe, it, expect, vi } from "vitest"

// Mock all dependencies so we can exercise the server factory without
// real network calls or file-system access.
vi.mock("../../src/infrastructure/graph-client.js", () => ({
  getAccessToken: vi.fn(),
  makeGraphRequest: vi.fn(),
  MS_GRAPH_BASE: "https://graph.microsoft.com/v1.0",
}))

vi.mock("../../src/token-manager.js", () => ({
  tokenManager: {
    getTokens: vi.fn(),
    setTokens: vi.fn(),
    clearTokens: vi.fn(),
  },
}))

vi.mock("../../src/auth-callback-server.js", () => ({
  startAuthFlow: vi.fn(),
}))

vi.mock("../../src/oauth-engine.js", () => ({
  OAuthConfigError: class extends Error {},
}))

vi.mock("../../src/open-browser.js", () => ({
  openBrowser: vi.fn(),
}))

vi.mock("../../src/infrastructure/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("../../src/application/list-service.js", () => ({
  getLists: vi.fn(),
  createList: vi.fn(),
  updateList: vi.fn(),
  deleteList: vi.fn(),
}))

vi.mock("../../src/application/task-service.js", () => ({
  getTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}))

vi.mock("../../src/application/checklist-service.js", () => ({
  getChecklistItems: vi.fn(),
  createChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
}))

import { createMcpServer } from "../../src/interface/server.js"

const EXPECTED_TOOLS = [
  "auth-status",
  "start-auth",
  "get-task-lists",
  "get-task-lists-organized",
  "create-task-list",
  "update-task-list",
  "delete-task-list",
  "get-tasks",
  "create-task",
  "update-task",
  "delete-task",
  "get-checklist-items",
  "create-checklist-item",
  "update-checklist-item",
  "delete-checklist-item",
  "archive-completed-tasks",
  "test-graph-api-exploration",
] as const

describe("createMcpServer", () => {
  it("registers exactly the expected set of MCP tools", () => {
    const server = createMcpServer()

    // The McpServer SDK exposes registered tools via the _registeredTools map.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = Object.keys((server as any)._registeredTools ?? {})

    expect(registered.sort()).toEqual([...EXPECTED_TOOLS].sort())
    expect(registered.length).toBe(EXPECTED_TOOLS.length)
  })

  it("registers 17 tools", () => {
    const server = createMcpServer()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = Object.keys((server as any)._registeredTools ?? {})
    expect(registered.length).toBe(17)
  })
})
