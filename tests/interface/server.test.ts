/**
 * Server registration smoke test.
 *
 * Asserts that createMcpServer() registers exactly the expected set of
 * MCP tools based on the current AUTH_FLOW.  This catches silent tool
 * loss during future refactors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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

/** Tools registered when AUTH_FLOW=authorization_code (default). */
const EXPECTED_TOOLS_AUTH_CODE = [
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

/** Tools registered when AUTH_FLOW=device_code. */
const EXPECTED_TOOLS_DEVICE_CODE = [
  "auth-status",
  "start-device-auth",
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
  let originalAuthFlow: string | undefined

  beforeEach(() => {
    originalAuthFlow = process.env.AUTH_FLOW
  })

  afterEach(() => {
    if (originalAuthFlow !== undefined) {
      process.env.AUTH_FLOW = originalAuthFlow
    } else {
      delete process.env.AUTH_FLOW
    }
  })

  describe("AUTH_FLOW=authorization_code (default)", () => {
    beforeEach(() => {
      delete process.env.AUTH_FLOW
    })

    it("registers exactly the expected set of MCP tools", () => {
      const server = createMcpServer()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})

      expect(registered.sort()).toEqual([...EXPECTED_TOOLS_AUTH_CODE].sort())
      expect(registered.length).toBe(EXPECTED_TOOLS_AUTH_CODE.length)
    })

    it("registers 17 tools", () => {
      const server = createMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})
      expect(registered.length).toBe(17)
    })

    it("includes start-auth tool", () => {
      const server = createMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})
      expect(registered).toContain("start-auth")
    })
  })

  describe("AUTH_FLOW=device_code", () => {
    beforeEach(() => {
      process.env.AUTH_FLOW = "device_code"
    })

    it("registers tools without start-auth", () => {
      const server = createMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})

      expect(registered.sort()).toEqual([...EXPECTED_TOOLS_DEVICE_CODE].sort())
    })

    it("registers 17 tools (no start-auth, has start-device-auth)", () => {
      const server = createMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})
      expect(registered.length).toBe(17)
    })

    it("does NOT include start-auth tool", () => {
      const server = createMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})
      expect(registered).not.toContain("start-auth")
    })

    it("still includes auth-status tool", () => {
      const server = createMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})
      expect(registered).toContain("auth-status")
    })

    it("includes start-device-auth tool", () => {
      const server = createMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = Object.keys((server as any)._registeredTools ?? {})
      expect(registered).toContain("start-device-auth")
    })
  })
})
