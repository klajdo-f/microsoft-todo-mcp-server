/**
 * MCP tool handlers for task-list operations.
 *
 * Registers the `get-task-lists`, `get-task-lists-organized`,
 * `create-task-list`, `update-task-list`, and `delete-task-list`
 * tools on an McpServer instance.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import * as listService from "../../application/list-service.js"
import { handleToolError } from "../error-handler.js"
import { organizeLists, buildOrganizedOutput } from "./list-organizer.js"

// ---------------------------------------------------------------------------
// Named handlers
// ---------------------------------------------------------------------------

async function handleGetTaskLists() {
  try {
    const lists = await listService.getLists()

    if (lists.length === 0) {
      return { content: [{ type: "text" as const, text: "No task lists found." }] }
    }

    const formattedLists = lists.map(formatListSummary)
    return {
      content: [{ type: "text" as const, text: `Your task lists:\n\n${formattedLists.join("\n")}` }],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleGetTaskListsOrganized({
  includeIds,
  groupBy,
}: {
  includeIds?: boolean
  groupBy?: "category" | "shared" | "type"
}) {
  try {
    const lists = await listService.getLists()

    if (lists.length === 0) {
      return { content: [{ type: "text" as const, text: "No task lists found." }] }
    }

    if (groupBy === "shared") {
      return { content: [{ type: "text" as const, text: buildSharedView(lists) }] }
    }

    const organized = organizeLists(lists)
    const output = buildOrganizedOutput(lists, organized, includeIds)
    return { content: [{ type: "text" as const, text: output }] }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleCreateTaskList({ displayName }: { displayName: string }) {
  try {
    const response = await listService.createList(displayName)
    return {
      content: [
        {
          type: "text" as const,
          text: `Task list created successfully!\nName: ${response.displayName}\nID: ${response.id}`,
        },
      ],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleUpdateTaskList({ listId, displayName }: { listId: string; displayName: string }) {
  try {
    const response = await listService.updateList(listId, displayName)
    return {
      content: [{ type: "text" as const, text: `Task list updated successfully!\nNew name: ${response.displayName}` }],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleDeleteTaskList({ listId }: { listId: string }) {
  try {
    await listService.deleteList(listId)
    return {
      content: [{ type: "text" as const, text: `Task list with ID: ${listId} was successfully deleted.` }],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

// ---------------------------------------------------------------------------
// Small format helpers
// ---------------------------------------------------------------------------

function formatListSummary(list: {
  id: string
  displayName: string
  wellknownListName?: string
  isShared?: boolean
  isOwner?: boolean
}): string {
  let wellKnownInfo = ""
  if (list.wellknownListName && list.wellknownListName !== "none") {
    if (list.wellknownListName === "defaultList") wellKnownInfo = " (Default Tasks List)"
    else if (list.wellknownListName === "flaggedEmails") wellKnownInfo = " (Flagged Emails)"
  }

  let sharingInfo = ""
  if (list.isShared) sharingInfo = list.isOwner ? " (Shared by you)" : " (Shared with you)"

  return `ID: ${list.id}\nName: ${list.displayName}${wellKnownInfo}${sharingInfo}\n---`
}

function buildSharedView(lists: Array<{ displayName: string; isShared?: boolean; isOwner?: boolean }>): string {
  const sharedLists = lists.filter((l) => l.isShared)
  const personalLists = lists.filter((l) => !l.isShared)

  let output = "📂 Microsoft To Do Lists - By Sharing Status\n"
  output += "=".repeat(50) + "\n\n"

  output += `👥 Shared Lists (${sharedLists.length})\n`
  sharedLists.forEach((list) => {
    const ownership = list.isOwner ? "Shared by you" : "Shared with you"
    output += `   ├─ ${list.displayName} [${ownership}]\n`
  })

  output += `\n🔒 Personal Lists (${personalLists.length})\n`
  personalLists.forEach((list) => {
    output += `   ├─ ${list.displayName}\n`
  })

  return output
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerListTools(server: McpServer): void {
  server.registerTool(
    "get-task-lists",
    {
      description:
        "Get all Microsoft Todo task lists (the top-level containers that organize your tasks). Shows list names, IDs, and indicates default or shared lists.",
    },
    handleGetTaskLists,
  )

  server.registerTool(
    "get-task-lists-organized",
    {
      description:
        "Get all task lists organized into logical folders/categories based on naming patterns, emoji prefixes, and sharing status. Provides a hierarchical view similar to folder organization.",
      inputSchema: {
        includeIds: z.boolean().optional().describe("Include list IDs in output (default: false)"),
        groupBy: z
          .enum(["category", "shared", "type"])
          .optional()
          .describe("Grouping strategy - 'category' (default), 'shared', or 'type'"),
      },
    },
    handleGetTaskListsOrganized,
  )

  server.registerTool(
    "create-task-list",
    {
      description:
        "Create a new task list (top-level container) in Microsoft Todo to help organize your tasks into categories or projects.",
      inputSchema: {
        displayName: z.string().describe("Name of the new task list"),
      },
    },
    handleCreateTaskList,
  )

  server.registerTool(
    "update-task-list",
    {
      description: "Update the name of an existing task list (top-level container) in Microsoft Todo.",
      inputSchema: {
        listId: z.string().describe("ID of the task list to update"),
        displayName: z.string().describe("New name for the task list"),
      },
    },
    handleUpdateTaskList,
  )

  server.registerTool(
    "delete-task-list",
    {
      description:
        "Delete a task list (top-level container) from Microsoft Todo. This will remove the list and all tasks within it.",
      inputSchema: {
        listId: z.string().describe("ID of the task list to delete"),
      },
    },
    handleDeleteTaskList,
  )
}
