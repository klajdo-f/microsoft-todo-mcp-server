/**
 * MCP tool registration for the `archive-completed-tasks` debug utility.
 *
 * Provides `registerArchiveTools()` — a focused registrar that handles
 * moving completed tasks older than a threshold from one list to another.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../../infrastructure/graph-client.js"
import type { Task } from "../../domain/entities.js"
import { handleToolError } from "../error-handler.js"

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Calculate the cutoff date for archiving.
 */
function computeCutoffDate(olderThanDays: number): Date {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)
  return cutoffDate
}

/**
 * Fetch all completed tasks from the given list, filtering by cutoff date.
 */
async function fetchCompletedTasks(sourceListId: string, cutoffDate: Date, token: string): Promise<Task[]> {
  const tasksResponse = await makeGraphRequest<{ value: Task[] }>(
    `${MS_GRAPH_BASE}/me/todo/lists/${sourceListId}/tasks?$filter=status eq 'completed'`,
    token,
  )

  const allTasks = tasksResponse?.value || []
  return allTasks.filter((task) => {
    if (!task.completedDateTime?.dateTime) return false
    const completedDate = new Date(task.completedDateTime.dateTime)
    return completedDate < cutoffDate
  })
}

/**
 * Build a human-readable preview of tasks that would be archived (dry-run mode).
 */
function buildArchivePreview(tasksToArchive: Task[], cutoffDate: Date, olderThanDays: number): string {
  let preview = `📋 Archive Preview\n`
  preview += `Would archive ${tasksToArchive.length} tasks completed before ${cutoffDate.toLocaleDateString()}\n\n`

  for (const task of tasksToArchive) {
    const completedDate = task.completedDateTime?.dateTime
      ? new Date(task.completedDateTime.dateTime).toLocaleDateString()
      : "Unknown"
    preview += `- ${task.title} (completed: ${completedDate})\n`
  }

  return preview
}

/**
 * Archive a single task: create it in the target list, then delete from source.
 */
async function archiveSingleTask(
  task: Task,
  sourceListId: string,
  targetListId: string,
  token: string,
): Promise<boolean> {
  try {
    await makeGraphRequest(`${MS_GRAPH_BASE}/me/todo/lists/${targetListId}/tasks`, token, "POST", {
      title: task.title,
      status: "completed",
      body: task.body,
      importance: task.importance,
      completedDateTime: task.completedDateTime,
      dueDateTime: task.dueDateTime,
      reminderDateTime: task.reminderDateTime,
      categories: task.categories,
    })

    await makeGraphRequest(`${MS_GRAPH_BASE}/me/todo/lists/${sourceListId}/tasks/${task.id}`, token, "DELETE")
    return true
  } catch {
    return false
  }
}

/**
 * Build the final archive result message summarising successes and failures.
 */
function buildArchiveResult(successCount: number, totalCount: number, cutoffDate: Date, failedTasks: string[]): string {
  let result = `📦 Archive Complete\n`
  result += `Successfully archived ${successCount} of ${totalCount} tasks\n`
  result += `Tasks completed before ${cutoffDate.toLocaleDateString()} were moved.\n`

  if (failedTasks.length > 0) {
    result += `\n⚠️ Failed to archive ${failedTasks.length} tasks:\n`
    for (const title of failedTasks) {
      result += `- ${title}\n`
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerArchiveTools(server: McpServer): void {
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
        const cutoffDate = computeCutoffDate(olderThanDays)
        const tasksToArchive = await fetchCompletedTasks(sourceListId, cutoffDate, token)

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
          return {
            content: [{ type: "text", text: buildArchivePreview(tasksToArchive, cutoffDate, olderThanDays) }],
          }
        }

        let successCount = 0
        const failedTasks: string[] = []

        for (const task of tasksToArchive) {
          const ok = await archiveSingleTask(task, sourceListId, targetListId, token)
          if (ok) {
            successCount++
          } else {
            failedTasks.push(task.title)
          }
        }

        return {
          content: [
            {
              type: "text",
              text: buildArchiveResult(successCount, tasksToArchive.length, cutoffDate, failedTasks),
            },
          ],
        }
      } catch (error: unknown) {
        return handleToolError(error)
      }
    },
  )
}
