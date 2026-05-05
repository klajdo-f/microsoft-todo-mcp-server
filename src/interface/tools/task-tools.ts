/**
 * MCP tool handlers for task operations.
 *
 * Registers the `get-tasks`, `create-task`, `update-task`, and
 * `delete-task` tools on an McpServer instance.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import * as taskService from "../../application/task-service.js"
import type { TaskFields } from "../../application/task-service.js"
import type { Task } from "../../domain/entities.js"
import { handleToolError } from "../error-handler.js"

// ---------------------------------------------------------------------------
// Reusable Zod schemas
// ---------------------------------------------------------------------------

const listIdSchema = z.string().describe("ID of the task list")
const importanceSchema = z.enum(["low", "normal", "high"]).optional().describe("Task importance")
const statusSchema = z.enum(["notStarted", "inProgress", "completed", "waitingOnOthers", "deferred"]).optional()
const taskBodySchema = z.string().optional().describe("Description or body content of the task")
const dueDateSchema = z.string().optional().describe("Due date in ISO format (e.g., 2023-12-31T23:59:59Z)")
const startDateSchema = z.string().optional().describe("Start date in ISO format (e.g., 2023-12-31T23:59:59Z)")
const reminderSchema = z.string().optional().describe("Reminder date and time in ISO format")
const isReminderOnSchema = z.boolean().optional().describe("Whether to enable reminder for this task")
const categoriesSchema = z.array(z.string()).optional().describe("Categories associated with the task")

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTaskItem(task: Task): string {
  let info = `ID: ${task.id}\nTitle: ${task.title}`
  if (task.status) info = `${task.status === "completed" ? "✓" : "○"} ${info}`
  if (task.dueDateTime) info += `\nDue: ${new Date(task.dueDateTime.dateTime).toLocaleDateString()}`
  if (task.importance) info += `\nImportance: ${task.importance}`
  if (task.categories?.length) info += `\nCategories: ${task.categories.join(", ")}`
  if (task.body?.content?.trim()) {
    const preview = task.body.content.length > 50 ? task.body.content.substring(0, 50) + "..." : task.body.content
    info += `\nDescription: ${preview}`
  }
  return `${info}\n---`
}

function buildTaskFieldsFromParams(p: {
  title?: string
  body?: string
  dueDateTime?: string
  startDateTime?: string
  importance?: "low" | "normal" | "high"
  isReminderOn?: boolean
  reminderDateTime?: string
  status?: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred"
  categories?: string[]
}): TaskFields {
  return {
    title: p.title,
    body: p.body,
    dueDateTime: p.dueDateTime,
    startDateTime: p.startDateTime,
    importance: p.importance,
    isReminderOn: p.isReminderOn,
    reminderDateTime: p.reminderDateTime,
    status: p.status,
    categories: p.categories,
  }
}

// ---------------------------------------------------------------------------
// Named handlers
// ---------------------------------------------------------------------------

async function handleGetTasks(args: {
  listId: string
  filter?: string
  select?: string
  orderby?: string
  top?: number
  skip?: number
  count?: boolean
}) {
  try {
    const response = await taskService.getTasks(args.listId, args)
    if (response.tasks.length === 0)
      return { content: [{ type: "text" as const, text: `No tasks found in list with ID: ${args.listId}` }] }
    const formatted = response.tasks.map(formatTaskItem).join("\n")
    const countInfo = args.count && response.odataCount !== undefined ? `Total count: ${response.odataCount}\n\n` : ""
    return { content: [{ type: "text" as const, text: `Tasks in list ${args.listId}:\n\n${countInfo}${formatted}` }] }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleCreateTask(args: {
  listId: string
  title: string
  body?: string
  dueDateTime?: string
  startDateTime?: string
  importance?: "low" | "normal" | "high"
  isReminderOn?: boolean
  reminderDateTime?: string
  status?: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred"
  categories?: string[]
}) {
  try {
    const response = await taskService.createTask(args.listId, buildTaskFieldsFromParams(args))
    return {
      content: [
        { type: "text" as const, text: `Task created successfully!\nID: ${response.id}\nTitle: ${response.title}` },
      ],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleUpdateTask(args: {
  listId: string
  taskId: string
  title?: string
  body?: string
  dueDateTime?: string
  startDateTime?: string
  importance?: "low" | "normal" | "high"
  isReminderOn?: boolean
  reminderDateTime?: string
  status?: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred"
  categories?: string[]
}) {
  try {
    const hasUpdate =
      args.title !== undefined ||
      args.body !== undefined ||
      args.dueDateTime !== undefined ||
      args.startDateTime !== undefined ||
      args.importance !== undefined ||
      args.isReminderOn !== undefined ||
      args.reminderDateTime !== undefined ||
      args.status !== undefined ||
      args.categories !== undefined
    if (!hasUpdate)
      return {
        content: [
          {
            type: "text" as const,
            text: "No properties provided for update. Please specify at least one property to change.",
          },
        ],
      }
    const response = await taskService.updateTask(args.listId, args.taskId, buildTaskFieldsFromParams(args))
    return {
      content: [
        { type: "text" as const, text: `Task updated successfully!\nID: ${response.id}\nTitle: ${response.title}` },
      ],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

async function handleDeleteTask({ listId, taskId }: { listId: string; taskId: string }) {
  try {
    await taskService.deleteTask(listId, taskId)
    return {
      content: [
        { type: "text" as const, text: `Task with ID: ${taskId} was successfully deleted from list: ${listId}` },
      ],
    }
  } catch (error) {
    return handleToolError(error)
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    "get-tasks",
    {
      description:
        "Get tasks from a specific Microsoft Todo list. These are the main todo items that can contain checklist items (subtasks).",
      inputSchema: {
        listId: listIdSchema,
        filter: z.string().optional().describe("OData $filter query (e.g., 'status eq \\'completed\\'')"),
        select: z
          .string()
          .optional()
          .describe("Comma-separated list of properties to include (e.g., 'id,title,status')"),
        orderby: z.string().optional().describe("Property to sort by (e.g., 'createdDateTime desc')"),
        top: z.number().optional().describe("Maximum number of tasks to retrieve"),
        skip: z.number().optional().describe("Number of tasks to skip"),
        count: z.boolean().optional().describe("Whether to include a count of tasks"),
      },
    },
    handleGetTasks,
  )

  server.registerTool(
    "create-task",
    {
      description:
        "Create a new task in a specific Microsoft Todo list. A task is the main todo item that can have a title, description, due date, and other properties.",
      inputSchema: {
        listId: listIdSchema,
        title: z.string().describe("Title of the task"),
        body: taskBodySchema,
        dueDateTime: dueDateSchema,
        startDateTime: startDateSchema,
        importance: importanceSchema,
        isReminderOn: isReminderOnSchema,
        reminderDateTime: reminderSchema,
        status: statusSchema.describe("Status of the task"),
        categories: categoriesSchema,
      },
    },
    handleCreateTask,
  )

  server.registerTool(
    "update-task",
    {
      description:
        "Update an existing task in Microsoft Todo. Allows changing any properties of the task including title, due date, importance, etc.",
      inputSchema: {
        listId: listIdSchema,
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
    },
    handleUpdateTask,
  )

  server.registerTool(
    "delete-task",
    {
      description:
        "Delete a task from a Microsoft Todo list. This will remove the task and all its checklist items (subtasks).",
      inputSchema: {
        listId: listIdSchema,
        taskId: z.string().describe("ID of the task to delete"),
      },
    },
    handleDeleteTask,
  )
}
