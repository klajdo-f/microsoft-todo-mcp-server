/**
 * MCP tool handlers for debug / utility operations.
 *
 * Registers the `archive-completed-tasks` and `test-graph-api-exploration`
 * tools on an McpServer instance.  All Zod schemas, descriptions, and
 * response shapes are preserved from the original todo-index.ts god file.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../../infrastructure/graph-client.js"
import type { TaskList, Task } from "../../domain/entities.js"
import { handleToolError } from "../error-handler.js"

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerDebugTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // archive-completed-tasks
  // -----------------------------------------------------------------------
  server.tool(
    "archive-completed-tasks",
    "Move completed tasks older than a specified number of days from one list to another (archive) list. Useful for cleaning up active lists while preserving historical tasks.",
    {
      sourceListId: z.string().describe("ID of the source list to archive tasks from"),
      targetListId: z.string().describe("ID of the target archive list"),
      olderThanDays: z
        .number()
        .min(0)
        .default(90)
        .describe("Archive tasks completed more than this many days ago (default: 90)"),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, only preview what would be archived without making changes"),
    },
    async ({ sourceListId, targetListId, olderThanDays, dryRun }) => {
      try {
        const token = await getAccessToken()

        // Calculate cutoff date
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

        // Get all completed tasks from source list
        const tasksResponse = await makeGraphRequest<{ value: Task[] }>(
          `${MS_GRAPH_BASE}/me/todo/lists/${sourceListId}/tasks?$filter=status eq 'completed'`,
          token,
        )

        const allTasks = tasksResponse?.value || []

        // Filter tasks older than cutoff
        const tasksToArchive = allTasks.filter((task) => {
          if (!task.completedDateTime?.dateTime) return false
          const completedDate = new Date(task.completedDateTime.dateTime)
          return completedDate < cutoffDate
        })

        if (tasksToArchive.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No completed tasks found older than ${olderThanDays} days.`,
              },
            ],
          }
        }

        if (dryRun) {
          // Preview mode - just show what would be archived
          let preview = `📋 Archive Preview\n`
          preview += `Would archive ${tasksToArchive.length} tasks completed before ${cutoffDate.toLocaleDateString()}\n\n`

          tasksToArchive.forEach((task) => {
            const completedDate = task.completedDateTime?.dateTime
              ? new Date(task.completedDateTime.dateTime).toLocaleDateString()
              : "Unknown"
            preview += `- ${task.title} (completed: ${completedDate})\n`
          })

          return { content: [{ type: "text", text: preview }] }
        }

        // Actually archive the tasks
        let successCount = 0
        let failedTasks: string[] = []

        for (const task of tasksToArchive) {
          try {
            // Create task in target list
            await makeGraphRequest(
              `${MS_GRAPH_BASE}/me/todo/lists/${targetListId}/tasks`,
              token,
              "POST",
              {
                title: task.title,
                status: "completed",
                body: task.body,
                importance: task.importance,
                completedDateTime: task.completedDateTime,
                dueDateTime: task.dueDateTime,
                reminderDateTime: task.reminderDateTime,
                categories: task.categories,
              },
            )

            // Delete from source list
            await makeGraphRequest(`${MS_GRAPH_BASE}/me/todo/lists/${sourceListId}/tasks/${task.id}`, token, "DELETE")
            successCount++
          } catch (error) {
            failedTasks.push(task.title)
          }
        }

        let result = `📦 Archive Complete\n`
        result += `Successfully archived ${successCount} of ${tasksToArchive.length} tasks\n`
        result += `Tasks completed before ${cutoffDate.toLocaleDateString()} were moved.\n`

        if (failedTasks.length > 0) {
          result += `\n⚠️ Failed to archive ${failedTasks.length} tasks:\n`
          failedTasks.forEach((title) => {
            result += `- ${title}\n`
          })
        }

        return { content: [{ type: "text", text: result }] }
      } catch (error) {
        return handleToolError(error)
      }
    },
  )

  // -----------------------------------------------------------------------
  // test-graph-api-exploration
  // -----------------------------------------------------------------------
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

        // Test 1: Try with $select=* to get all properties
        if (testType === "odata-select" || testType === "all") {
          results += "📊 Test 1: Using $select=* to retrieve all properties\n"
          try {
            const response = await makeGraphRequest<any>(`${MS_GRAPH_BASE}/me/todo/lists?$select=*`, token)
            if (response && response.value && response.value.length > 0) {
              const firstList = response.value[0]
              const properties = Object.keys(firstList)
              results += `Found ${properties.length} properties: ${properties.join(", ")}\n`

              // Show full first list as example
              results += "\nExample list object:\n"
              results += JSON.stringify(firstList, null, 2).substring(0, 1000) + "...\n"
            }
          } catch (error) {
            results += `Error: ${error}\n`
          }
          results += "\n"
        }

        // Test 2: Try various $expand options
        if (testType === "odata-expand" || testType === "all") {
          results += "📊 Test 2: Using $expand to retrieve related data\n"
          const expandOptions = [
            "extensions",
            "singleValueExtendedProperties",
            "multiValueExtendedProperties",
            "openExtensions",
            "parent",
            "children",
            "folder",
            "parentFolder",
            "group",
            "category",
          ]

          for (const expand of expandOptions) {
            try {
              const response = await makeGraphRequest<any>(
                `${MS_GRAPH_BASE}/me/todo/lists?$expand=${expand}&$top=1`,
                token,
              )
              if (response && response.value) {
                results += `✓ $expand=${expand}: Success - `
                if (response.value.length > 0 && response.value[0][expand]) {
                  results += `Found data!\n`
                  results += JSON.stringify(response.value[0][expand], null, 2).substring(0, 500) + "...\n"
                } else {
                  results += `No additional data returned\n`
                }
              }
            } catch (error: any) {
              results += `✗ $expand=${expand}: ${error.message || "Failed"}\n`
            }
          }
          results += "\n"
        }

        // Test 3: Check response headers for additional info
        if (testType === "headers" || testType === "all") {
          results += "📊 Test 3: Checking response headers\n"
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
          } catch (error) {
            results += `Error: ${error}\n`
          }
          results += "\n"
        }

        // Test 4: Try extensions endpoint
        if (testType === "extensions" || testType === "all") {
          results += "📊 Test 4: Checking for extensions\n"
          try {
            const listsResponse = await makeGraphRequest<{ value: TaskList[] }>(
              `${MS_GRAPH_BASE}/me/todo/lists?$top=1`,
              token,
            )

            if (listsResponse && listsResponse.value && listsResponse.value.length > 0) {
              const listId = listsResponse.value[0].id

              // Try to get extensions
              try {
                const extResponse = await makeGraphRequest<any>(
                  `${MS_GRAPH_BASE}/me/todo/lists/${listId}/extensions`,
                  token,
                )
                results += `Extensions found: ${JSON.stringify(extResponse, null, 2)}\n`
              } catch (error: any) {
                results += `No extensions endpoint: ${error.message}\n`
              }
            }
          } catch (error) {
            results += `Error: ${error}\n`
          }
          results += "\n"
        }

        // Test 5: Check if there's a separate folders or groups endpoint
        if (testType === "all") {
          results += "📊 Test 5: Checking for folder/group endpoints\n"
          const endpoints = [
            "/me/todo/folders",
            "/me/todo/groups",
            "/me/todo/listGroups",
            "/me/todo/listFolders",
            "/me/todo/categories",
          ]

          for (const endpoint of endpoints) {
            try {
              const response = await makeGraphRequest<any>(`${MS_GRAPH_BASE}${endpoint}`, token)
              results += `✓ ${endpoint}: Found! Response: ${JSON.stringify(response).substring(0, 200)}...\n`
            } catch (error: any) {
              results += `✗ ${endpoint}: Not found (${error.message || "Failed"})\n`
            }
          }
        }

        results += "\n" + "=".repeat(50) + "\n"
        results += "Analysis complete. Check results above for any discovered properties or endpoints."

        return {
          content: [
            {
              type: "text",
              text: results,
            },
          ],
        }
      } catch (error) {
        return handleToolError(error)
      }
    },
  )
}
