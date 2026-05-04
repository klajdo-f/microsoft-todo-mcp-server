/**
 * MCP tool handlers for task-list operations.
 *
 * Registers the `get-task-lists`, `get-task-lists-organized`,
 * `create-task-list`, `update-task-list`, and `delete-task-list`
 * tools on an McpServer instance.  All Zod schemas, descriptions,
 * and response shapes are preserved from the original todo-index.ts
 * god file.
 *
 * Inline Graph API logic has been replaced with calls to the
 * corresponding application service methods.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import * as listService from "../../application/list-service.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOT_AUTHENTICATED =
  "Not authenticated. Please run the start-auth tool first to authenticate with Microsoft."

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Organise lists into categories based on naming patterns, emoji prefixes,
 * and sharing status.  Preserved verbatim from the original todo-index.ts.
 */
function organizeLists(lists: import("../../domain/entities.js").TaskList[]): {
  [category: string]: import("../../domain/entities.js").TaskList[]
} {
  const organized: { [category: string]: import("../../domain/entities.js").TaskList[] } = {}

  const patterns = {
    archived: /\(([^)]+)\s*-\s*Archived\)$/i,
    archive: /^📦\s*Archive/i,
    shopping: /^🛒/,
    property: /^🏡/,
    family: /^👪/,
    seasonal: /^(🎄|🎉)/,
    work: /^(Work|SBIR)/i,
    travel: /^(🚗|Rangeley)/i,
    reading: /^📰/,
  }

  lists.forEach((list) => {
    let placed = false

    const archiveMatch = list.displayName.match(patterns.archived)
    if (archiveMatch) {
      const category = `📦 Archived - ${archiveMatch[1]}`
      if (!organized[category]) organized[category] = []
      organized[category].push(list)
      placed = true
    } else if (patterns.archive.test(list.displayName)) {
      if (!organized["📦 Archives"]) organized["📦 Archives"] = []
      organized["📦 Archives"].push(list)
      placed = true
    } else if (patterns.shopping.test(list.displayName)) {
      if (!organized["🛒 Shopping Lists"]) organized["🛒 Shopping Lists"] = []
      organized["🛒 Shopping Lists"].push(list)
      placed = true
    } else if (patterns.property.test(list.displayName)) {
      if (!organized["🏡 Properties"]) organized["🏡 Properties"] = []
      organized["🏡 Properties"].push(list)
      placed = true
    } else if (patterns.family.test(list.displayName)) {
      if (!organized["👪 Family"]) organized["👪 Family"] = []
      organized["👪 Family"].push(list)
      placed = true
    } else if (patterns.seasonal.test(list.displayName)) {
      if (!organized["🎉 Seasonal & Events"]) organized["🎉 Seasonal & Events"] = []
      organized["🎉 Seasonal & Events"].push(list)
      placed = true
    } else if (patterns.work.test(list.displayName)) {
      if (!organized["💼 Work"]) organized["💼 Work"] = []
      organized["💼 Work"].push(list)
      placed = true
    } else if (patterns.travel.test(list.displayName)) {
      if (!organized["🚗 Travel & Rangeley"]) organized["🚗 Travel & Rangeley"] = []
      organized["🚗 Travel & Rangeley"].push(list)
      placed = true
    } else if (patterns.reading.test(list.displayName)) {
      if (!organized["📚 Reading"]) organized["📚 Reading"] = []
      organized["📚 Reading"].push(list)
      placed = true
    } else if (list.wellknownListName && list.wellknownListName !== "none") {
      if (!organized["⭐ Special Lists"]) organized["⭐ Special Lists"] = []
      organized["⭐ Special Lists"].push(list)
      placed = true
    } else if (list.isShared && !placed) {
      if (!organized["👥 Shared Lists"]) organized["👥 Shared Lists"] = []
      organized["👥 Shared Lists"].push(list)
      placed = true
    } else {
      if (!organized["📋 Other Lists"]) organized["📋 Other Lists"] = []
      organized["📋 Other Lists"].push(list)
    }
  })

  return organized
}

/** Category display-order mapping. */
const CATEGORY_PRIORITY: Record<string, number> = {
  "⭐ Special Lists": 1,
  "👥 Shared Lists": 2,
  "💼 Work": 3,
  "👪 Family": 4,
  "🏡 Properties": 5,
  "🛒 Shopping Lists": 6,
  "🚗 Travel & Rangeley": 7,
  "🎉 Seasonal & Events": 8,
  "📚 Reading": 9,
  "📋 Other Lists": 10,
  "📦 Archives": 11,
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerListTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // get-task-lists
  // -----------------------------------------------------------------------
  server.tool(
    "get-task-lists",
    "Get all Microsoft Todo task lists (the top-level containers that organize your tasks). Shows list names, IDs, and indicates default or shared lists.",
    {},
    async () => {
      try {
        const lists = await listService.getLists()

        if (lists === null) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        if (lists.length === 0) {
          return {
            content: [{ type: "text", text: "No task lists found." }],
          }
        }

        const formattedLists = lists.map((list) => {
          let wellKnownInfo = ""
          if (list.wellknownListName && list.wellknownListName !== "none") {
            if (list.wellknownListName === "defaultList") {
              wellKnownInfo = " (Default Tasks List)"
            } else if (list.wellknownListName === "flaggedEmails") {
              wellKnownInfo = " (Flagged Emails)"
            }
          }

          let sharingInfo = ""
          if (list.isShared) {
            sharingInfo = list.isOwner ? " (Shared by you)" : " (Shared with you)"
          }

          return `ID: ${list.id}\nName: ${list.displayName}${wellKnownInfo}${sharingInfo}\n---`
        })

        return {
          content: [{ type: "text", text: `Your task lists:\n\n${formattedLists.join("\n")}` }],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error fetching task lists: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // get-task-lists-organized
  // -----------------------------------------------------------------------
  server.tool(
    "get-task-lists-organized",
    "Get all task lists organized into logical folders/categories based on naming patterns, emoji prefixes, and sharing status. Provides a hierarchical view similar to folder organization.",
    {
      includeIds: z.boolean().optional().describe("Include list IDs in output (default: false)"),
      groupBy: z
        .enum(["category", "shared", "type"])
        .optional()
        .describe("Grouping strategy - 'category' (default), 'shared', or 'type'"),
    },
    async ({ includeIds, groupBy }) => {
      try {
        const lists = await listService.getLists()

        if (lists === null) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        if (lists.length === 0) {
          return {
            content: [{ type: "text", text: "No task lists found." }],
          }
        }

        // Group by shared status
        if (groupBy === "shared") {
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

          return { content: [{ type: "text", text: output }] }
        }

        // Default: organize by category
        const organized = organizeLists(lists)

        let output = "📂 Microsoft To Do Lists - Organized View\n"
        output += "=".repeat(50) + "\n\n"

        const sortedCategories = Object.keys(organized).sort((a, b) => {
          const aIsArchived = a.startsWith("📦 Archived -")
          const bIsArchived = b.startsWith("📦 Archived -")

          if (aIsArchived && !bIsArchived) return 1
          if (!aIsArchived && bIsArchived) return -1
          if (aIsArchived && bIsArchived) return a.localeCompare(b)

          const aPriority = CATEGORY_PRIORITY[a] || 999
          const bPriority = CATEGORY_PRIORITY[b] || 999

          if (aPriority !== bPriority) return aPriority - bPriority
          return a.localeCompare(b)
        })

        sortedCategories.forEach((category) => {
          const categoryLists = organized[category]
          output += `${category} (${categoryLists.length})\n`

          categoryLists.forEach((list, index) => {
            const isLast = index === categoryLists.length - 1
            const prefix = isLast ? "└─" : "├─"

            let listInfo = `${prefix} ${list.displayName}`

            const metadata: string[] = []
            if (list.wellknownListName === "defaultList") metadata.push("Default")
            if (list.wellknownListName === "flaggedEmails") metadata.push("Flagged Emails")
            if (list.isShared && list.isOwner) metadata.push("Shared by you")
            if (list.isShared && !list.isOwner) metadata.push("Shared with you")

            if (metadata.length > 0) {
              listInfo += ` [${metadata.join(", ")}]`
            }

            output += `   ${listInfo}\n`

            if (!isLast) {
              output += "   │\n"
            }
          })

          output += "\n"
        })

        // Add summary
        const totalLists = Object.values(organized).reduce((sum, l) => sum + l.length, 0)
        const totalCategories = Object.keys(organized).length

        output += "-".repeat(50) + "\n"
        output += `Summary: ${totalLists} lists in ${totalCategories} categories\n`

        if (includeIds) {
          output += "\n\n📋 List IDs Reference:\n" + "-".repeat(50) + "\n"
          lists.forEach((list) => {
            output += `${list.displayName}: ${list.id}\n`
          })
        }

        return { content: [{ type: "text", text: output }] }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error fetching organized task lists: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // create-task-list
  // -----------------------------------------------------------------------
  server.tool(
    "create-task-list",
    "Create a new task list (top-level container) in Microsoft Todo to help organize your tasks into categories or projects.",
    {
      displayName: z.string().describe("Name of the new task list"),
    },
    async ({ displayName }) => {
      try {
        const response = await listService.createList(displayName)

        if (!response) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Task list created successfully!\nName: ${response.displayName}\nID: ${response.id}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error creating task list: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // update-task-list
  // -----------------------------------------------------------------------
  server.tool(
    "update-task-list",
    "Update the name of an existing task list (top-level container) in Microsoft Todo.",
    {
      listId: z.string().describe("ID of the task list to update"),
      displayName: z.string().describe("New name for the task list"),
    },
    async ({ listId, displayName }) => {
      try {
        const response = await listService.updateList(listId, displayName)

        if (!response) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Task list updated successfully!\nNew name: ${response.displayName}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error updating task list: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // delete-task-list
  // -----------------------------------------------------------------------
  server.tool(
    "delete-task-list",
    "Delete a task list (top-level container) from Microsoft Todo. This will remove the list and all tasks within it.",
    {
      listId: z.string().describe("ID of the task list to delete"),
    },
    async ({ listId }) => {
      try {
        const result = await listService.deleteList(listId)

        if (result === null) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Task list with ID: ${listId} was successfully deleted.`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error deleting task list: ${error}` }],
        }
      }
    },
  )
}
