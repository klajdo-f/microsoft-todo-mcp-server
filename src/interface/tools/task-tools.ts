/**
 * MCP tool handlers for task operations.
 *
 * Registers the `get-tasks`, `create-task`, `update-task`, and
 * `delete-task` tools on an McpServer instance.  All Zod schemas,
 * descriptions, and response shapes are preserved from the original
 * todo-index.ts god file.
 *
 * Inline Graph API logic has been replaced with calls to the
 * corresponding application service methods.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import * as taskService from "../../application/task-service.js"
import type { TaskFields } from "../../application/task-service.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOT_AUTHENTICATED = "Not authenticated. Please run the start-auth tool first to authenticate with Microsoft."

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTaskTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // get-tasks
  // -----------------------------------------------------------------------
  server.tool(
    "get-tasks",
    "Get tasks from a specific Microsoft Todo list. These are the main todo items that can contain checklist items (subtasks).",
    {
      listId: z.string().describe("ID of the task list"),
      filter: z.string().optional().describe("OData $filter query (e.g., 'status eq \\'completed\\'')"),
      select: z.string().optional().describe("Comma-separated list of properties to include (e.g., 'id,title,status')"),
      orderby: z.string().optional().describe("Property to sort by (e.g., 'createdDateTime desc')"),
      top: z.number().optional().describe("Maximum number of tasks to retrieve"),
      skip: z.number().optional().describe("Number of tasks to skip"),
      count: z.boolean().optional().describe("Whether to include a count of tasks"),
    },
    async ({ listId, filter, select, orderby, top, skip, count }) => {
      try {
        const response = await taskService.getTasks(listId, { filter, select, orderby, top, skip, count })

        if (response === null) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        const tasks = response.tasks
        if (tasks.length === 0) {
          return {
            content: [{ type: "text", text: `No tasks found in list with ID: ${listId}` }],
          }
        }

        const formattedTasks = tasks.map((task) => {
          let taskInfo = `ID: ${task.id}\nTitle: ${task.title}`

          if (task.status) {
            const status = task.status === "completed" ? "✓" : "○"
            taskInfo = `${status} ${taskInfo}`
          }

          if (task.dueDateTime) {
            taskInfo += `\nDue: ${new Date(task.dueDateTime.dateTime).toLocaleDateString()}`
          }

          if (task.importance) {
            taskInfo += `\nImportance: ${task.importance}`
          }

          if (task.categories && task.categories.length > 0) {
            taskInfo += `\nCategories: ${task.categories.join(", ")}`
          }

          if (task.body && task.body.content && task.body.content.trim() !== "") {
            const previewLength = 50
            const contentPreview =
              task.body.content.length > previewLength
                ? task.body.content.substring(0, previewLength) + "..."
                : task.body.content
            taskInfo += `\nDescription: ${contentPreview}`
          }

          return `${taskInfo}\n---`
        })

        let countInfo = ""
        if (count && response.odataCount !== undefined) {
          countInfo = `Total count: ${response.odataCount}\n\n`
        }

        return {
          content: [
            {
              type: "text",
              text: `Tasks in list ${listId}:\n\n${countInfo}${formattedTasks.join("\n")}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error fetching tasks: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // create-task
  // -----------------------------------------------------------------------
  server.tool(
    "create-task",
    "Create a new task in a specific Microsoft Todo list. A task is the main todo item that can have a title, description, due date, and other properties.",
    {
      listId: z.string().describe("ID of the task list"),
      title: z.string().describe("Title of the task"),
      body: z.string().optional().describe("Description or body content of the task"),
      dueDateTime: z.string().optional().describe("Due date in ISO format (e.g., 2023-12-31T23:59:59Z)"),
      startDateTime: z.string().optional().describe("Start date in ISO format (e.g., 2023-12-31T23:59:59Z)"),
      importance: z.enum(["low", "normal", "high"]).optional().describe("Task importance"),
      isReminderOn: z.boolean().optional().describe("Whether to enable reminder for this task"),
      reminderDateTime: z.string().optional().describe("Reminder date and time in ISO format"),
      status: z
        .enum(["notStarted", "inProgress", "completed", "waitingOnOthers", "deferred"])
        .optional()
        .describe("Status of the task"),
      categories: z.array(z.string()).optional().describe("Categories associated with the task"),
    },
    async ({
      listId,
      title,
      body,
      dueDateTime,
      startDateTime,
      importance,
      isReminderOn,
      reminderDateTime,
      status,
      categories,
    }) => {
      try {
        const fields: TaskFields = {
          title,
          body,
          dueDateTime,
          startDateTime,
          importance,
          isReminderOn,
          reminderDateTime,
          status,
          categories,
        }

        const response = await taskService.createTask(listId, fields)

        if (!response) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Task created successfully!\nID: ${response.id}\nTitle: ${response.title}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error creating task: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // update-task
  // -----------------------------------------------------------------------
  server.tool(
    "update-task",
    "Update an existing task in Microsoft Todo. Allows changing any properties of the task including title, due date, importance, etc.",
    {
      listId: z.string().describe("ID of the task list"),
      taskId: z.string().describe("ID of the task to update"),
      title: z.string().optional().describe("New title of the task"),
      body: z.string().optional().describe("New description or body content of the task"),
      dueDateTime: z.string().optional().describe("New due date in ISO format (e.g., 2023-12-31T23:59:59Z)"),
      startDateTime: z.string().optional().describe("New start date in ISO format (e.g., 2023-12-31T23:59:59Z)"),
      importance: z.enum(["low", "normal", "high"]).optional().describe("New task importance"),
      isReminderOn: z.boolean().optional().describe("Whether to enable reminder for this task"),
      reminderDateTime: z.string().optional().describe("New reminder date and time in ISO format"),
      status: z
        .enum(["notStarted", "inProgress", "completed", "waitingOnOthers", "deferred"])
        .optional()
        .describe("New status of the task"),
      categories: z.array(z.string()).optional().describe("New categories associated with the task"),
    },
    async ({
      listId,
      taskId,
      title,
      body,
      dueDateTime,
      startDateTime,
      importance,
      isReminderOn,
      reminderDateTime,
      status,
      categories,
    }) => {
      try {
        const fields: TaskFields = {
          title,
          body,
          dueDateTime,
          startDateTime,
          importance,
          isReminderOn,
          reminderDateTime,
          status,
          categories,
        }

        // Check that at least one property was explicitly provided.
        // The application service returns null for an empty update body,
        // but we want a specific message here.
        const hasUpdate =
          title !== undefined ||
          body !== undefined ||
          dueDateTime !== undefined ||
          startDateTime !== undefined ||
          importance !== undefined ||
          isReminderOn !== undefined ||
          reminderDateTime !== undefined ||
          status !== undefined ||
          categories !== undefined

        if (!hasUpdate) {
          return {
            content: [
              {
                type: "text",
                text: "No properties provided for update. Please specify at least one property to change.",
              },
            ],
          }
        }

        const response = await taskService.updateTask(listId, taskId, fields)

        if (!response) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Task updated successfully!\nID: ${response.id}\nTitle: ${response.title}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error updating task: ${error}` }],
        }
      }
    },
  )

  // -----------------------------------------------------------------------
  // delete-task
  // -----------------------------------------------------------------------
  server.tool(
    "delete-task",
    "Delete a task from a Microsoft Todo list. This will remove the task and all its checklist items (subtasks).",
    {
      listId: z.string().describe("ID of the task list"),
      taskId: z.string().describe("ID of the task to delete"),
    },
    async ({ listId, taskId }) => {
      try {
        const result = await taskService.deleteTask(listId, taskId)

        if (result === null) {
          return {
            content: [{ type: "text", text: NOT_AUTHENTICATED }],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Task with ID: ${taskId} was successfully deleted from list: ${listId}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error deleting task: ${error}` }],
        }
      }
    },
  )
}
