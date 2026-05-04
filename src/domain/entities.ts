/**
 * Domain entities for the Microsoft To Do MCP server.
 *
 * These types model the core domain objects as exposed by the
 * Microsoft Graph To Do API.  They are shared across the application,
 * infrastructure, and interface layers.
 */

/** A task list — the top-level container that organizes tasks. */
export interface TaskList {
  id: string
  displayName: string
  isOwner?: boolean
  isShared?: boolean
  wellknownListName?: string // 'none', 'defaultList', 'flaggedEmails', 'unknownFutureValue'
}

/** A task — the main todo item that lives inside a task list. */
export interface Task {
  id: string
  title: string
  status: string
  importance: string
  dueDateTime?: {
    dateTime: string
    timeZone: string
  }
  completedDateTime?: {
    dateTime: string
    timeZone: string
  }
  reminderDateTime?: {
    dateTime: string
    timeZone: string
  }
  body?: {
    content: string
    contentType: string
  }
  categories?: string[]
}

/** A checklist item — a subtask that belongs to a parent task. */
export interface ChecklistItem {
  id: string
  displayName: string
  isChecked: boolean
  createdDateTime?: string
}
