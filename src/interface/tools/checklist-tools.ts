/**
 * MCP tool handlers for checklist-item operations.
 *
 * Registers the `get-checklist-items`, `create-checklist-item`,
 * `update-checklist-item`, and `delete-checklist-item` tools on an
 * McpServer instance.  All Zod schemas, descriptions, and response
 * shapes are preserved from the original todo-index.ts god file.
 *
 * Inline Graph API logic has been replaced with calls to the
 * corresponding application service methods.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import * as checklistService from "../../application/checklist-service.js"
import type { ChecklistItemFields } from "../../application/checklist-service.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOT_AUTHENTICATED =
  "Not authenticated. Please run the start-auth tool first to authenticate with Microsoft."

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerChecklistTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // get-checklist-items
  // -----------------------------------------------------------------------
  server.tool(
    "get-checklist-items",
    "Get checklist items (subtasks) for a specific task. Checklist items are smaller steps or components that belong to a parent task.",
    {
      listId: z.string().describe("ID of the task list"),
      taskId: z.string().describe("ID of the task"),
    },
    async ({ listId, taskId }) => {
      try {
        const response = await checklistService.getChecklistItems(listId, taskId)

        if (response === null) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        const { taskTitle, items } = response

        if (items.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No checklist items found for task "${taskTitle}" (ID: ${taskId})`,
              },
            ],
          }
        }

        const formattedItems = items.map((item) => {
          const status = item.isChecked ? "✓" : "○"
          let itemInfo = `${status} ${item.displayName} (ID: ${item.id})`

          if (item.createdDateTime) {
            const createdDate = new Date(item.createdDateTime).toLocaleString()
            itemInfo += `\nCreated: ${createdDate}`
          }

          return itemInfo
        })

        return {
          content: [
            {
              type: "text",
              text: `Checklist items for task "${taskTitle}" (ID: ${taskId}):\n\n${formattedItems.join("\n\n")}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error fetching checklist items: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // create-checklist-item
  // -----------------------------------------------------------------------
  server.tool(
    "create-checklist-item",
    "Create a new checklist item (subtask) for a task. Checklist items help break down a task into smaller, manageable steps.",
    {
      listId: z.string().describe("ID of the task list"),
      taskId: z.string().describe("ID of the task"),
      displayName: z.string().describe("Text content of the checklist item"),
      isChecked: z.boolean().optional().describe("Whether the item is checked off"),
    },
    async ({ listId, taskId, displayName, isChecked }) => {
      try {
        const response = await checklistService.createChecklistItem(listId, taskId, displayName, isChecked)

        if (!response) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Checklist item created successfully!\nContent: ${response.displayName}\nID: ${response.id}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error creating checklist item: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // update-checklist-item
  // -----------------------------------------------------------------------
  server.tool(
    "update-checklist-item",
    "Update an existing checklist item (subtask). Allows changing the text content or completion status of the subtask.",
    {
      listId: z.string().describe("ID of the task list"),
      taskId: z.string().describe("ID of the task"),
      checklistItemId: z.string().describe("ID of the checklist item to update"),
      displayName: z.string().optional().describe("New text content of the checklist item"),
      isChecked: z.boolean().optional().describe("Whether the item is checked off"),
    },
    async ({ listId, taskId, checklistItemId, displayName, isChecked }) => {
      try {
        const fields: ChecklistItemFields = { displayName, isChecked }

        // Check that at least one property was explicitly provided
        const hasUpdate = displayName !== undefined || isChecked !== undefined

        if (!hasUpdate) {
          return {
            content: [
              {
                type: "text",
                text: "No properties provided for update. Please specify either displayName or isChecked.",
              },
            ],
          }
        }

        const response = await checklistService.updateChecklistItem(listId, taskId, checklistItemId, fields)

        if (!response) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        const statusText = response.isChecked ? "Checked" : "Not checked"

        return {
          content: [
            {
              type: "text",
              text: `Checklist item updated successfully!\nContent: ${response.displayName}\nStatus: ${statusText}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error updating checklist item: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // delete-checklist-item
  // -----------------------------------------------------------------------
  server.tool(
    "delete-checklist-item",
    "Delete a checklist item (subtask) from a task. This removes just the specific subtask, not the parent task.",
    {
      listId: z.string().describe("ID of the task list"),
      taskId: z.string().describe("ID of the task"),
      checklistItemId: z.string().describe("ID of the checklist item to delete"),
    },
    async ({ listId, taskId, checklistItemId }) => {
      try {
        const result = await checklistService.deleteChecklistItem(listId, taskId, checklistItemId)

        if (result === null) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Checklist item with ID: ${checklistItemId} was successfully deleted from task: ${taskId}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error deleting checklist item: ${error}` }],
        }
      }
    },
  )
}
