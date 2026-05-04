/**
 * Application service for Microsoft To Do list operations.
 *
 * Provides use-case methods that encapsulate Graph API calls for
 * task-list CRUD.  Each method returns domain objects or null on
 * error — callers decide how to present results.
 *
 * Failure-mode contract: returns null when makeGraphRequest fails,
 * matching the existing null-on-error behaviour from todo-index.ts.
 */
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../infrastructure/graph-client.js"
import type { TaskList } from "../domain/entities.js"

/** Fetch all task lists for the authenticated user. */
export async function getLists(): Promise<TaskList[] | null> {
  const token = await getAccessToken()
  if (!token) return null

  const response = await makeGraphRequest<{ value: TaskList[] }>(`${MS_GRAPH_BASE}/me/todo/lists`, token)
  if (!response) return null

  return response.value || []
}

/** Create a new task list with the given display name. */
export async function createList(displayName: string): Promise<TaskList | null> {
  const token = await getAccessToken()
  if (!token) return null

  const requestBody = { displayName }

  const response = await makeGraphRequest<TaskList>(`${MS_GRAPH_BASE}/me/todo/lists`, token, "POST", requestBody)
  return response
}

/** Update the display name of an existing task list. */
export async function updateList(listId: string, displayName: string): Promise<TaskList | null> {
  const token = await getAccessToken()
  if (!token) return null

  const requestBody = { displayName }

  const response = await makeGraphRequest<TaskList>(
    `${MS_GRAPH_BASE}/me/todo/lists/${listId}`,
    token,
    "PATCH",
    requestBody,
  )
  return response
}

/** Delete a task list by ID. Returns true on success, null on auth failure. */
export async function deleteList(listId: string): Promise<boolean | null> {
  const token = await getAccessToken()
  if (!token) return null

  await makeGraphRequest<null>(`${MS_GRAPH_BASE}/me/todo/lists/${listId}`, token, "DELETE")
  // DELETE returns 204 No Content; makeGraphRequest returns null on success
  // for void responses, but we treat reaching this point as success.
  return true
}
