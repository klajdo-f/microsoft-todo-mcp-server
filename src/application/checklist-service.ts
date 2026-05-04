/**
 * Application service for Microsoft To Do checklist-item operations.
 *
 * Provides use-case methods that encapsulate Graph API calls for
 * checklist-item CRUD within a task.  Methods throw domain exceptions
 * on failure — callers catch at the boundary and format MCP responses.
 *
 * @throws {AuthError} when authentication fails.
 * @throws {GraphApiError} when the Graph API returns a non-success response.
 * @throws {NetworkError} when a network-level failure occurs.
 * @throws {ValidationError} when the update payload is empty.
 */
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../infrastructure/graph-client.js"
import { ValidationError } from "../domain/errors.js"
import type { Task, ChecklistItem } from "../domain/entities.js"

/** Fields for updating a checklist item. */
export interface ChecklistItemFields {
  displayName?: string
  isChecked?: boolean
}

/**
 * Fetch checklist items for a specific task.
 *
 * Returns the task title alongside the checklist items so callers
 * can format human-readable output without an extra round-trip.
 */
export async function getChecklistItems(
  listId: string,
  taskId: string,
): Promise<{ taskTitle: string; items: ChecklistItem[] }> {
  const token = await getAccessToken()

  // Fetch the task to get its title — errors propagate as domain exceptions
  const taskResponse = await makeGraphRequest<Task>(`${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}`, token)
  const taskTitle = taskResponse!.title

  // Fetch the checklist items
  const response = await makeGraphRequest<{ value: ChecklistItem[] }>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`,
    token,
  )

  return {
    taskTitle,
    items: response!.value || [],
  }
}

/** Create a new checklist item under a task. */
export async function createChecklistItem(
  listId: string,
  taskId: string,
  displayName: string,
  isChecked?: boolean,
): Promise<ChecklistItem> {
  const token = await getAccessToken()

  const requestBody: Record<string, unknown> = { displayName }

  if (isChecked !== undefined) {
    requestBody.isChecked = isChecked
  }

  return (await makeGraphRequest<ChecklistItem>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`,
    token,
    "POST",
    requestBody,
  ))!
}

/**
 * Update an existing checklist item.
 *
 * @throws {ValidationError} when no fields are provided for the update.
 */
export async function updateChecklistItem(
  listId: string,
  taskId: string,
  checklistItemId: string,
  fields: ChecklistItemFields,
): Promise<ChecklistItem> {
  const token = await getAccessToken()

  const requestBody: Record<string, unknown> = {}

  if (fields.displayName !== undefined) {
    requestBody.displayName = fields.displayName
  }

  if (fields.isChecked !== undefined) {
    requestBody.isChecked = fields.isChecked
  }

  if (Object.keys(requestBody).length === 0) {
    throw new ValidationError("No fields provided for checklist item update. At least one field must be specified.")
  }

  return (await makeGraphRequest<ChecklistItem>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`,
    token,
    "PATCH",
    requestBody,
  ))!
}

/** Delete a checklist item from a task. Returns true on success. */
export async function deleteChecklistItem(listId: string, taskId: string, checklistItemId: string): Promise<boolean> {
  const token = await getAccessToken()

  await makeGraphRequest<null>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`,
    token,
    "DELETE",
  )
  return true
}
