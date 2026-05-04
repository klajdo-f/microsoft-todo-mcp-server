/**
 * Application service for Microsoft To Do list operations.
 *
 * Provides use-case methods that encapsulate Graph API calls for
 * task-list CRUD.  Methods throw domain exceptions on failure —
 * callers catch at the boundary and format MCP responses.
 *
 * @throws {AuthError} when authentication fails.
 * @throws {GraphApiError} when the Graph API returns a non-success response.
 * @throws {NetworkError} when a network-level failure occurs.
 */
import { makeGraphRequest, getAccessToken, MS_GRAPH_BASE } from "../infrastructure/graph-client.js"
import type { TaskList } from "../domain/entities.js"

/** Fetch all task lists for the authenticated user. */
export async function getLists(): Promise<TaskList[]> {
  const token = await getAccessToken()

  const response = await makeGraphRequest<{ value: TaskList[] }>(`${MS_GRAPH_BASE}/me/todo/lists`, token)

  return response!.value || []
}

/** Create a new task list with the given display name. */
export async function createList(displayName: string): Promise<TaskList> {
  const token = await getAccessToken()

  const requestBody = { displayName }

  return (await makeGraphRequest<TaskList>(`${MS_GRAPH_BASE}/me/todo/lists`, token, "POST", requestBody))!
}

/** Update the display name of an existing task list. */
export async function updateList(listId: string, displayName: string): Promise<TaskList> {
  const token = await getAccessToken()

  const requestBody = { displayName }

  return (await makeGraphRequest<TaskList>(`${MS_GRAPH_BASE}/me/todo/lists/${listId}`, token, "PATCH", requestBody))!
}

/** Delete a task list by ID. Returns true on success. */
export async function deleteList(listId: string): Promise<boolean> {
  const token = await getAccessToken()

  await makeGraphRequest<null>(`${MS_GRAPH_BASE}/me/todo/lists/${listId}`, token, "DELETE")
  // DELETE returns 204 No Content; reaching this point means success.
  return true
}
