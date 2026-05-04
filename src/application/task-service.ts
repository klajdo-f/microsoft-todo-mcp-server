/**
 * Application service for Microsoft To Do task operations.
 *
 * Provides use-case methods that encapsulate Graph API calls for
 * task CRUD within a task list.  Each method returns domain objects
 * or null on error — callers decide how to present results.
 *
 * Failure-mode contract: returns null when makeGraphRequest fails,
 * matching the existing null-on-error behaviour from todo-index.ts.
 */
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../infrastructure/graph-client.js"
import type { Task } from "../domain/entities.js"

/** Options for filtering, sorting, and paginating task queries. */
export interface GetTasksOptions {
  filter?: string
  select?: string
  orderby?: string
  top?: number
  skip?: number
  count?: boolean
}

/** Fields for creating or updating a task. */
export interface TaskFields {
  title?: string
  body?: string
  dueDateTime?: string
  startDateTime?: string
  importance?: "low" | "normal" | "high"
  isReminderOn?: boolean
  reminderDateTime?: string
  status?: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred"
  categories?: string[]
}

/** Response shape for getTasks, including optional OData count. */
export interface GetTasksResponse {
  tasks: Task[]
  odataCount?: number
}

/**
 * Fetch tasks from a specific task list.
 *
 * Builds OData query parameters from the options and returns the
 * task array plus optional total count.
 */
export async function getTasks(listId: string, options?: GetTasksOptions): Promise<GetTasksResponse | null> {
  const token = await getAccessToken()
  if (!token) return null

  // Build the query parameters
  const queryParams = new URLSearchParams()

  if (options?.filter) queryParams.append("$filter", options.filter)
  if (options?.select) queryParams.append("$select", options.select)
  if (options?.orderby) queryParams.append("$orderby", options.orderby)
  if (options?.top !== undefined) queryParams.append("$top", options.top.toString())
  if (options?.skip !== undefined) queryParams.append("$skip", options.skip.toString())
  if (options?.count !== undefined) queryParams.append("$count", options.count.toString())

  const queryString = queryParams.toString()
  const url = `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks${queryString ? "?" + queryString : ""}`

  const response = await makeGraphRequest<{ value: Task[]; "@odata.count"?: number }>(url, token)
  if (!response) return null

  return {
    tasks: response.value || [],
    odataCount: response["@odata.count"],
  }
}

/**
 * Create a new task in a task list.
 *
 * Constructs the request body from the provided fields, mapping
 * simple string dates to the Graph API's { dateTime, timeZone } shape.
 */
export async function createTask(listId: string, fields: TaskFields): Promise<Task | null> {
  const token = await getAccessToken()
  if (!token) return null

  const taskBody: Record<string, unknown> = {}

  if (fields.title !== undefined) {
    taskBody.title = fields.title
  }

  if (fields.body) {
    taskBody.body = { content: fields.body, contentType: "text" }
  }

  if (fields.dueDateTime) {
    taskBody.dueDateTime = { dateTime: fields.dueDateTime, timeZone: "UTC" }
  }

  if (fields.startDateTime) {
    taskBody.startDateTime = { dateTime: fields.startDateTime, timeZone: "UTC" }
  }

  if (fields.importance) {
    taskBody.importance = fields.importance
  }

  if (fields.isReminderOn !== undefined) {
    taskBody.isReminderOn = fields.isReminderOn
  }

  if (fields.reminderDateTime) {
    taskBody.reminderDateTime = { dateTime: fields.reminderDateTime, timeZone: "UTC" }
  }

  if (fields.status) {
    taskBody.status = fields.status
  }

  if (fields.categories && fields.categories.length > 0) {
    taskBody.categories = fields.categories
  }

  const response = await makeGraphRequest<Task>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks`,
    token,
    "POST",
    taskBody,
  )
  return response
}

/**
 * Update an existing task in a task list.
 *
 * Constructs the update body from provided fields. Empty-string date
 * values are treated as "clear this field" by setting it to null.
 */
export async function updateTask(listId: string, taskId: string, fields: TaskFields): Promise<Task | null> {
  const token = await getAccessToken()
  if (!token) return null

  const taskBody: Record<string, unknown> = {}

  if (fields.title !== undefined) {
    taskBody.title = fields.title
  }

  if (fields.body !== undefined) {
    taskBody.body = { content: fields.body, contentType: "text" }
  }

  if (fields.dueDateTime !== undefined) {
    taskBody.dueDateTime = fields.dueDateTime === "" ? null : { dateTime: fields.dueDateTime, timeZone: "UTC" }
  }

  if (fields.startDateTime !== undefined) {
    taskBody.startDateTime = fields.startDateTime === "" ? null : { dateTime: fields.startDateTime, timeZone: "UTC" }
  }

  if (fields.importance !== undefined) {
    taskBody.importance = fields.importance
  }

  if (fields.isReminderOn !== undefined) {
    taskBody.isReminderOn = fields.isReminderOn
  }

  if (fields.reminderDateTime !== undefined) {
    taskBody.reminderDateTime =
      fields.reminderDateTime === "" ? null : { dateTime: fields.reminderDateTime, timeZone: "UTC" }
  }

  if (fields.status !== undefined) {
    taskBody.status = fields.status
  }

  if (fields.categories !== undefined) {
    taskBody.categories = fields.categories
  }

  if (Object.keys(taskBody).length === 0) {
    // Nothing to update — return a sentinel to let the caller know
    return null
  }

  const response = await makeGraphRequest<Task>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}`,
    token,
    "PATCH",
    taskBody,
  )
  return response
}

/**
 * Delete a task from a task list.
 *
 * Returns true on success, null on auth failure.
 */
export async function deleteTask(listId: string, taskId: string): Promise<boolean | null> {
  const token = await getAccessToken()
  if (!token) return null

  await makeGraphRequest<null>(`${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}`, token, "DELETE")
  return true
}
