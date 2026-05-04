/**
 * Application service for Microsoft To Do checklist-item operations.
 *
 * Provides use-case methods that encapsulate Graph API calls for
 * checklist-item CRUD within a task.  Each method returns domain
 * objects or null on error — callers decide how to present results.
 *
 * Failure-mode contract: returns null when makeGraphRequest fails,
 * matching the existing null-on-error behaviour from todo-index.ts.
 */
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../infrastructure/graph-client.js"
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
): Promise<{ taskTitle: string; items: ChecklistItem[] } | null> {
  const token = await getAccessToken()
  if (!token) return null

  // Fetch the task to get its title
  const taskResponse = await makeGraphRequest<Task>(`${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}`, token)
  const taskTitle = taskResponse ? taskResponse.title : "Unknown Task"

  // Fetch the checklist items
  const response = await makeGraphRequest<{ value: ChecklistItem[] }>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`,
    token,
  )
  if (!response) return null

  return {
    taskTitle,
    items: response.value || [],
  }
}

/** Create a new checklist item under a task. */
export async function createChecklistItem(
  listId: string,
  taskId: string,
  displayName: string,
  isChecked?: boolean,
): Promise<ChecklistItem | null> {
  const token = await getAccessToken()
  if (!token) return null

  const requestBody: Record<string, unknown> = { displayName }

  if (isChecked !== undefined) {
    requestBody.isChecked = isChecked
  }

  const response = await makeGraphRequest<ChecklistItem>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`,
    token,
    "POST",
    requestBody,
  )
  return response
}

/** Update an existing checklist item. */
export async function updateChecklistItem(
  listId: string,
  taskId: string,
  checklistItemId: string,
  fields: ChecklistItemFields,
): Promise<ChecklistItem | null> {
  const token = await getAccessToken()
  if (!token) return null

  const requestBody: Record<string, unknown> = {}

  if (fields.displayName !== undefined) {
    requestBody.displayName = fields.displayName
  }

  if (fields.isChecked !== undefined) {
    requestBody.isChecked = fields.isChecked
  }

  if (Object.keys(requestBody).length === 0) {
    // Nothing to update
    return null
  }

  const response = await makeGraphRequest<ChecklistItem>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`,
    token,
    "PATCH",
    requestBody,
  )
  return response
}

/** Delete a checklist item from a task. Returns true on success, null on auth failure. */
export async function deleteChecklistItem(
  listId: string,
  taskId: string,
  checklistItemId: string,
): Promise<boolean | null> {
  const token = await getAccessToken()
  if (!token) return null

  await makeGraphRequest<null>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`,
    token,
    "DELETE",
  )
  return true
}
