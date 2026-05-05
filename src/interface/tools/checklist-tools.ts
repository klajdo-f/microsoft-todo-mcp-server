/**
 * MCP tool handlers for checklist-item operations.
 *
 * Registers the `get-checklist-items`, `create-checklist-item`,
 * `update-checklist-item`, and `delete-checklist-item` tools on an
 * McpServer instance.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import * as checklistService from "../../application/checklist-service.js"
import type { ChecklistItemFields } from "../../application/checklist-service.js"
import type { ChecklistItem } from "../../domain/entities.js"
import { handleToolError } from "../error-handler.js"

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatChecklistItem(item: ChecklistItem): string {
  const status = item.isChecked ? "✓" : "○"
  let itemInfo = `${status} ${item.displayName} (ID: ${item.id})`

  if (item.createdDateTime) {
    itemInfo += `\nCreated: ${new Date(item.createdDateTime).toLocaleString()}`
  }

  return itemInfo
}

function formatChecklistItemsResponse(taskTitle: string, taskId: string, items: ChecklistItem[]): string {
  const formatted = items.map(formatChecklistItem).join("\n\n")
  return `Checklist items for task "${taskTitle}" (ID: ${taskId}):\n\n${formatted}`
}

// ---------------------------------------------------------------------------
// Named handlers
// ---------------------------------------------------------------------------

async function handleGetChecklistItems({ listId, taskId }: { listId: string; taskId: string }) {
  try {
    const { taskTitle, items } = await checklistService.getChecklistItems(listId, taskId)

    if (items.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No checklist items found for task "${taskTitle}" (ID: ${taskId})` }],
      }
    }

    return {
      content: [{ type: "text" as const, text: formatChecklistItemsResponse(taskTitle, taskId, items) }],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleCreateChecklistItem({
  listId,
  taskId,
  displayName,
  isChecked,
}: {
  listId: string
  taskId: string
  displayName: string
  isChecked?: boolean
}) {
  try {
    const response = await checklistService.createChecklistItem(listId, taskId, displayName, isChecked)
    return {
      content: [
        {
          type: "text" as const,
          text: `Checklist item created successfully!\nContent: ${response.displayName}\nID: ${response.id}`,
        },
      ],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleUpdateChecklistItem({
  listId,
  taskId,
  checklistItemId,
  displayName,
  isChecked,
}: {
  listId: string
  taskId: string
  checklistItemId: string
  displayName?: string
  isChecked?: boolean
}) {
  try {
    const hasUpdate = displayName !== undefined || isChecked !== undefined
    if (!hasUpdate) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No properties provided for update. Please specify either displayName or isChecked.",
          },
        ],
      }
    }

    const fields: ChecklistItemFields = { displayName, isChecked }
    const response = await checklistService.updateChecklistItem(listId, taskId, checklistItemId, fields)
    const statusText = response.isChecked ? "Checked" : "Not checked"

    return {
      content: [
        {
          type: "text" as const,
          text: `Checklist item updated successfully!\nContent: ${response.displayName}\nStatus: ${statusText}`,
        },
      ],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleDeleteChecklistItem({
  listId,
  taskId,
  checklistItemId,
}: {
  listId: string
  taskId: string
  checklistItemId: string
}) {
  try {
    await checklistService.deleteChecklistItem(listId, taskId, checklistItemId)
    return {
      content: [
        {
          type: "text" as const,
          text: `Checklist item with ID: ${checklistItemId} was successfully deleted from task: ${taskId}`,
        },
      ],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerChecklistTools(server: McpServer): void {
  server.registerTool(
    "get-checklist-items",
    {
      description:
        "Get checklist items (subtasks) for a specific task. Checklist items are smaller steps or components that belong to a parent task.",
      inputSchema: {
        listId: z.string().describe("ID of the task list"),
        taskId: z.string().describe("ID of the task"),
      },
    },
    handleGetChecklistItems,
  )

  server.registerTool(
    "create-checklist-item",
    {
      description:
        "Create a new checklist item (subtask) for a task. Checklist items help break down a task into smaller, manageable steps.",
      inputSchema: {
        listId: z.string().describe("ID of the task list"),
        taskId: z.string().describe("ID of the task"),
        displayName: z.string().describe("Text content of the checklist item"),
        isChecked: z.boolean().optional().describe("Whether the item is checked off"),
      },
    },
    handleCreateChecklistItem,
  )

  server.registerTool(
    "update-checklist-item",
    {
      description:
        "Update an existing checklist item (subtask). Allows changing the text content or completion status of the subtask.",
      inputSchema: {
        listId: z.string().describe("ID of the task list"),
        taskId: z.string().describe("ID of the task"),
        checklistItemId: z.string().describe("ID of the checklist item to update"),
        displayName: z.string().optional().describe("New text content of the checklist item"),
        isChecked: z.boolean().optional().describe("Whether the item is checked off"),
      },
    },
    handleUpdateChecklistItem,
  )

  server.registerTool(
    "delete-checklist-item",
    {
      description:
        "Delete a checklist item (subtask) from a task. This removes just the specific subtask, not the parent task.",
      inputSchema: {
        listId: z.string().describe("ID of the task list"),
        taskId: z.string().describe("ID of the task"),
        checklistItemId: z.string().describe("ID of the checklist item to delete"),
      },
    },
    handleDeleteChecklistItem,
  )
}
