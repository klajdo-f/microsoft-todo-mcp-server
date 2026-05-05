/**
 * MCP tool registration for the `test-graph-api-exploration` debug utility.
 *
 * Provides `registerExplorationTools()` — a focused registrar that runs
 * exploratory Graph API queries to discover hidden properties or endpoints.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../../infrastructure/graph-client.js"
import type { TaskList } from "../../domain/entities.js"
import { handleToolError } from "../error-handler.js"

// ---------------------------------------------------------------------------
// Per-test runner functions
// ---------------------------------------------------------------------------

/**
 * Test 1: Use $select=* to retrieve all properties from todo lists.
 */
async function runOdataSelectTest(token: string): Promise<string> {
  let results = "📊 Test 1: Using $select=* to retrieve all properties\n"
  try {
    const response = await makeGraphRequest<Record<string, unknown>>(`${MS_GRAPH_BASE}/me/todo/lists?$select=*`, token)
    if (response && typeof response === "object" && "value" in response) {
      const value = response.value
      if (Array.isArray(value) && value.length > 0) {
        const firstList = value[0] as Record<string, unknown>
        const properties = Object.keys(firstList)
        results += `Found ${properties.length} properties: ${properties.join(", ")}\n`
        results += "\nExample list object:\n"
        results += JSON.stringify(firstList, null, 2).substring(0, 1000) + "...\n"
      }
    }
  } catch (error: unknown) {
    results += `Error: ${error instanceof Error ? error.message : String(error)}\n`
  }
  return results + "\n"
}

/**
 * Test 2: Try various $expand options to retrieve related data.
 */
const EXPAND_OPTIONS = [
  "extensions", "singleValueExtendedProperties", "multiValueExtendedProperties",
  "openExtensions", "parent", "children", "folder", "parentFolder", "group", "category",
]

async function runOdataExpandTest(token: string): Promise<string> {
  let results = "📊 Test 2: Using $expand to retrieve related data\n"
  for (const expand of EXPAND_OPTIONS) {
    try {
      const response = await makeGraphRequest<Record<string, unknown>>(
        `${MS_GRAPH_BASE}/me/todo/lists?$expand=${expand}&$top=1`, token,
      )
      results += `✓ $expand=${expand}: Success - `
      if (response && typeof response === "object" && "value" in response && Array.isArray(response.value) && response.value.length > 0) {
        const firstItem = response.value[0] as Record<string, unknown>
        results += firstItem[expand] ? `Found data!\n${JSON.stringify(firstItem[expand], null, 2).substring(0, 500)}...\n` : `No additional data returned\n`
      }
    } catch (error: unknown) {
      results += `✗ $expand=${expand}: ${error instanceof Error ? error.message : "Failed"}\n`
    }
  }
  return results + "\n"
}

/**
 * Test 3: Check response headers for additional info.
 */
async function runHeadersTest(token: string): Promise<string> {
  let results = "📊 Test 3: Checking response headers\n"
  try {
    const response = await fetch(`${MS_GRAPH_BASE}/me/todo/lists`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Prefer: "return=representation",
      },
    })

    results += "Response headers:\n"
    response.headers.forEach((value, key) => {
      results += `${key}: ${value}\n`
    })
  } catch (error: unknown) {
    results += `Error: ${error instanceof Error ? error.message : String(error)}\n`
  }
  return results + "\n"
}

/**
 * Test 4: Check for extensions on the first todo list.
 */
async function runExtensionsTest(token: string): Promise<string> {
  let results = "📊 Test 4: Checking for extensions\n"
  try {
    const listsResponse = await makeGraphRequest<{ value: TaskList[] }>(`${MS_GRAPH_BASE}/me/todo/lists?$top=1`, token)

    if (listsResponse?.value?.length) {
      const listId = listsResponse.value[0].id
      try {
        const extResponse = await makeGraphRequest<Record<string, unknown>>(
          `${MS_GRAPH_BASE}/me/todo/lists/${listId}/extensions`,
          token,
        )
        results += `Extensions found: ${JSON.stringify(extResponse, null, 2)}\n`
      } catch (error: unknown) {
        results += `No extensions endpoint: ${error instanceof Error ? error.message : String(error)}\n`
      }
    }
  } catch (error: unknown) {
    results += `Error: ${error instanceof Error ? error.message : String(error)}\n`
  }
  return results + "\n"
}

/**
 * Test 5: Probe for alternative folder/group/category endpoints.
 */
async function runEndpointsTest(token: string): Promise<string> {
  let results = "📊 Test 5: Checking for folder/group endpoints\n"
  const endpoints = [
    "/me/todo/folders",
    "/me/todo/groups",
    "/me/todo/listGroups",
    "/me/todo/listFolders",
    "/me/todo/categories",
  ]

  for (const endpoint of endpoints) {
    try {
      const response = await makeGraphRequest<Record<string, unknown>>(`${MS_GRAPH_BASE}${endpoint}`, token)
      results += `✓ ${endpoint}: Found! Response: ${JSON.stringify(response).substring(0, 200)}...\n`
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed"
      results += `✗ ${endpoint}: Not found (${msg})\n`
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerExplorationTools(server: McpServer): void {
  server.tool(
    "test-graph-api-exploration",
    "Test various Graph API queries to discover hidden properties or endpoints for folder/group organization in Microsoft To Do.",
    {
      testType: z
        .enum(["odata-select", "odata-expand", "headers", "extensions", "all"])
        .describe("Type of test to run"),
    },
    async ({ testType }) => {
      try {
        const token = await getAccessToken()
        let results = "🔍 Graph API Exploration Results\n" + "=".repeat(50) + "\n\n"

        if (testType === "odata-select" || testType === "all") {
          results += await runOdataSelectTest(token)
        }

        if (testType === "odata-expand" || testType === "all") {
          results += await runOdataExpandTest(token)
        }

        if (testType === "headers" || testType === "all") {
          results += await runHeadersTest(token)
        }

        if (testType === "extensions" || testType === "all") {
          results += await runExtensionsTest(token)
        }

        if (testType === "all") {
          results += await runEndpointsTest(token)
        }

        results += "\n" + "=".repeat(50) + "\n"
        results += "Analysis complete. Check results above for any discovered properties or endpoints."

        return {
          content: [{ type: "text", text: results }],
        }
      } catch (error: unknown) {
        return handleToolError(error)
      }
    },
  )
}
