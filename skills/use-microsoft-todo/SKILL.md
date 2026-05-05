---
name: use-microsoft-todo
description: "Teach AI assistants how to effectively use the Microsoft To Do MCP server. Covers all 17 tools, authentication flows, task hierarchy, and workflow recipes for project setup, daily review, bulk creation, and cross-list management. Load this skill when users mention Microsoft To Do, Outlook Tasks, or ask about managing their todo list through MCP. Asks to create, read, update, or delete tasks, lists, or checklist items"
version: 1.0.0
---

## Objective

Enable AI assistants to operate Microsoft To Do confidently through the MCP server by understanding the authentication flow, the three-level data hierarchy (List → Task → Checklist Item), and all 17 available tools — including when to use each tool and how to compose them into productive workflows.

## Conventions

### Authentication First

Always call `auth-status` before any data operation. If the response indicates the user is not authenticated, guide them through the appropriate auth flow:

- **Authorization code flow** (default): Call `start-auth` — opens a browser for sign-in. Requires `CLIENT_ID` and `CLIENT_SECRET` in the MCP client's `env` field.
- **Device code flow** (when `AUTH_FLOW=device`): Call `start-device-auth` — displays a code and URL for sign-in on any device. Requires only `CLIENT_ID`.

Tokens are stored automatically and refreshed 5 minutes before expiration. Personal Microsoft accounts (Outlook.com, Hotmail.com, Live.com) may have limited API access due to Microsoft platform restrictions.

### Data Hierarchy

The Microsoft To Do data model has three levels:

```
Task List (container)
  └── Task (main todo item)
        └── Checklist Item (subtask / step)
```

- **Task Lists** are top-level containers (e.g., "Work", "Personal", "Project Alpha").
- **Tasks** belong to a list and have properties like title, body, due date, importance, status, and categories.
- **Checklist Items** belong to a task and are simple checked/unchecked steps.

Every operation requires knowing the parent ID: tasks need a `listId`, checklist items need both `listId` and `taskId`.

### Reduce Token Consumption

- Prefer `get-task-lists-organized` over `get-task-lists` for a cleaner, categorized view.
- Use `$select` to request only needed fields (e.g., `select: "id,title,status"`).
- Use `$filter` to narrow results (e.g., `filter: "status eq 'notStarted'"`).
- Use `$top` to limit the number of items returned.
- Use `$orderby` to get the most relevant items first (e.g., `orderby: "createdDateTime desc"`).

### IDs Are Required

All update and delete operations require the exact string ID of the target entity. If the user refers to something by name, first look it up with a list/get call to resolve the ID.

### Safe Operations

- Use `dryRun: true` with `archive-completed-tasks` to preview changes before committing.
- `delete-task-list` removes the list **and all tasks within it** — confirm with the user first.
- `delete-task` removes the task and all its checklist items.

### Status Values

Tasks support these statuses: `notStarted`, `inProgress`, `completed`, `waitingOnOthers`, `deferred`.

Importance levels: `low`, `normal`, `high`.

## Token Reduction Patterns

Token efficiency matters because every character in a tool call and its response consumes context window budget. These patterns reduce waste without sacrificing functionality.

**1. Prefer organized list views**
`get-task-lists-organized` returns a grouped, human-readable summary instead of raw JSON. It also supports `includeIds: true` so you get IDs in the same call, eliminating a separate lookup.

- Before: `get-task-lists` → returns every list as raw objects with all default fields.
- After: `get-task-lists-organized { includeIds: true, groupBy: "category" }` → returns grouped names and IDs, typically 40–60% fewer tokens.

**2. Use `$select` to request only needed fields**
The default `get-tasks` response includes ~15 fields per task. Most workflows only need 3–5 fields. Stripping unused fields saves substantial tokens, especially on lists with many tasks.

- Before: `get-tasks { listId: "AQM..." }` → returns id, title, body, status, importance, dueDateTime, startDateTime, isReminderOn, reminderDateTime, categories, createdDateTime, lastModifiedDateTime, and more.
- After: `get-tasks { listId: "AQM...", select: "id,title,status" }` → returns only the three fields you care about.

**3. Use `$filter` to narrow result sets**
Fetching all tasks and then filtering in the conversation wastes tokens on items you discard. Push the filter to the API so you only pay for relevant results.

- Before: `get-tasks { listId: "AQM..." }` → returns 200 tasks, then you scan for incomplete ones.
- After: `get-tasks { listId: "AQM...", filter: "status eq 'notStarted'" }` → returns only incomplete tasks.

Common filters: `status eq 'completed'`, `importance eq 'high'`, `dueDateTime le 2025-07-31T23:59:59Z`.

**4. Use `$top` to cap result count**
Even with filters, result sets can be large. Set an explicit limit to bound response size and avoid surprise pagination costs.

- Before: `get-tasks { listId: "AQM...", filter: "status ne 'completed'" }` → potentially 100+ tasks.
- After: `get-tasks { listId: "AQM...", filter: "status ne 'completed'", top: 15 }` → at most 15 tasks.

**5. Use `$orderby` to get the most relevant items first**
Combine `$orderby` with `$top` so the most important or recent items fill your limited result window — reducing the need for follow-up queries.

- Before: `get-tasks { listId: "AQM...", top: 10 }` → returns 10 arbitrary tasks in default order.
- After: `get-tasks { listId: "AQM...", top: 10, orderby: "importance desc,dueDateTime asc" }` → returns the 10 highest-priority, soonest-due tasks.

**6. Batch writes before reads**
Interleaving create/read cycles wastes tokens on verification reads that are only needed once at the end. Submit all write operations, then verify once.

- Before: `create-task → get-tasks → create-task → get-tasks → create-task → get-tasks` (6 tool calls).
- After: `create-task → create-task → create-task → get-tasks { select: "id,title", top: 20 }` (4 tool calls, one read).

**7. Use `dryRun: true` for destructive previews**
Running `archive-completed-tasks` without `dryRun` both risks data loss and costs more tokens if the results aren't what you expected and you need to undo. A dry run previews the exact outcome for the same token cost as the real call.

- Before: `archive-completed-tasks { sourceListId: "AQM...", targetListId: "BQM...", olderThanDays: 30 }` — commits immediately with no preview.
- After: `archive-completed-tasks { sourceListId: "AQM...", targetListId: "BQM...", olderThanDays: 30, dryRun: true }` — shows what would happen without executing.

**8. Skip verification reads for bulk operations**
When creating more than 10 tasks, the final verification `get-tasks` call returns a large response that mostly confirms what you already know. Skip it and just report the count.

- Before: Creating 15 tasks followed by `get-tasks { listId: "AQM..." }` to confirm (16 calls, large read response).
- After: Creating 15 tasks and reporting "15 tasks created in list X" (15 calls, no read response).

**9. Use `categories` for future filtering**
Tagging tasks with `categories` on creation costs zero extra tokens in the response but enables efficient `$filter` queries later. Without categories, finding related tasks requires full scans.

- Before: `create-task { listId: "AQM...", title: "Fix CSS bug" }` → later you must scan all tasks to find bugs.
- After: `create-task { listId: "AQM...", title: "Fix CSS bug", categories: ["Bug"] }` → later: `get-tasks { listId: "AQM...", filter: "categories/any(c: c eq 'Bug')" }`.

**10. Cache list IDs for the session**
Call `get-task-lists-organized { includeIds: true }` once at the start of a session and remember the IDs. Every subsequent operation that needs a `listId` uses the cached value instead of re-querying.

- Before: Calling `get-task-lists` before every create/update/delete to resolve the list name to an ID.
- After: One `get-task-lists-organized { includeIds: true }` at session start, then reuse the IDs for all subsequent calls.

## Success Criteria

This skill is working when:

1. The assistant checks `auth-status` before attempting any data operation.
2. The assistant correctly resolves names to IDs before update/delete calls.
3. The assistant uses `$select`, `$filter`, and `$top` to keep responses concise.
4. The assistant understands the List → Task → Checklist Item hierarchy and never tries to operate on a child without the parent ID.
5. The assistant suggests appropriate workflows (e.g., project setup, daily review) when the user's request is open-ended.

## Troubleshooting

When a tool call returns an error, the response includes a machine-readable code prefix in brackets. Use this reference to diagnose the cause and guide the user to a fix.

**`[AUTH_ERROR]` — Not authenticated**

The server has no valid access token or the token has expired and could not be refreshed.

Common triggers:

- First use before running any authentication flow.
- Refresh token expired or revoked (Microsoft refresh tokens can be invalidated by password changes, admin revocation, or prolonged inactivity).
- `CLIENT_ID` or `CLIENT_SECRET` missing or incorrect in the MCP client's `env` field.

Corrective actions:

1. Call `auth-status` to confirm the authentication state.
2. If not authenticated, start the appropriate flow:
   - Authorization code flow: call `start-auth` (requires `CLIENT_ID` and `CLIENT_SECRET`).
   - Device code flow: call `start-device-auth` when `AUTH_FLOW=device` (requires `CLIENT_ID` only).
3. Ensure the required credentials are set in the MCP client's `env` field.
4. The server handles token refresh automatically (proactive at 5 minutes before expiry, reactive on 401 responses). Do **not** retry manually on auth errors — guide the user to re-authenticate instead.

**`[MAILBOX_NOT_ENABLED]` — Personal account limitation**

The authenticated account is a personal Microsoft account (Outlook.com, Hotmail.com, Live.com, etc.) and lacks a Microsoft 365 mailbox. The Microsoft To Do Graph API requires an Exchange Online mailbox, which personal accounts do not have.

Common triggers:

- Signed in with a consumer Microsoft account instead of a work/school account.
- Using a personal email address that was added to a tenant but is still classified as a consumer account.

**`[PERMISSION_DENIED]` — Insufficient Graph API permissions**

The authenticated account does not have the required Microsoft Graph API scopes for the requested operation.

Common triggers:

- The app registration was not granted admin consent for `Tasks.ReadWrite`.
- The user's organization requires admin approval for third-party app permissions.
- The app registration's API permissions are incomplete or were reset.

Corrective actions:

1. Check the Azure AD (Entra ID) app registration — ensure `Tasks.ReadWrite` (delegated) is listed under API permissions.
2. If a "consent required" error appears, an administrator must grant tenant-wide consent. Navigate to Azure Portal → App registrations → API permissions → Grant admin consent.
3. After permissions are granted, re-authenticate with `start-auth` to obtain a token with the updated scopes.

**`[GRAPH_API_ERROR]` — Microsoft Graph API returned an error**

The Graph API responded with a non-success HTTP status. The error message includes the status code and a truncated response body excerpt for diagnosis.

Common triggers:

- Invalid or stale resource IDs (list, task, or checklist item was deleted or moved).
- Malformed OData query parameters (syntax errors in `$filter`, `$orderby`, or `$select`).
- Resource not found (HTTP 404) — the entity no longer exists or belongs to a different user.
- Rate limiting (HTTP 429) — too many requests in a short window. Look for a `Retry-After` header.
- Service outage (HTTP 5xx) — transient Microsoft-side failure.

Corrective actions:

1. Read the HTTP status code and response excerpt in the error message.
2. For 404 errors: the resource ID is likely stale. Re-fetch the parent collection to get current IDs.
3. For 400 errors: check parameter values for typos, invalid enum values, or malformed OData expressions.
4. For 429 errors: wait and retry. The Graph API typically returns a `Retry-After` header indicating how long to wait.
5. For 5xx errors: these are transient. Wait a few minutes and retry the operation.

**`[NETWORK_ERROR]` — Cannot reach Microsoft Graph API**

A network-level failure prevented the request from reaching the Graph API endpoint (https://graph.microsoft.com).

Common triggers:

- No internet connection or DNS resolution failure.
- Proxy or firewall blocking outbound HTTPS traffic to `graph.microsoft.com`.
- TLS/certificate issues.
- Connection timeout due to severe network congestion.

Corrective actions:

1. Verify internet connectivity — can the user reach other websites?
2. If behind a corporate proxy, ensure the proxy allows HTTPS traffic to `graph.microsoft.com` and that proxy credentials are configured at the system level.
3. Check DNS: `nslookup graph.microsoft.com` should resolve to a valid IP address.
4. Retry after confirming connectivity is restored — this is always a transient condition.

**`[VALIDATION_ERROR]` — Input validation failed**

The tool call parameters failed schema validation or violated a business rule before any API request was made.

Common triggers:

- Missing required parameter (e.g., `listId`, `taskId`, `title`).
- Parameter type mismatch (e.g., passing a string where a number is expected).
- Invalid enum value (e.g., `status: "pending"` instead of `"notStarted"`).
- Business rule violation (e.g., trying to create a task without specifying a `listId`).

Corrective actions:

1. Read the validation error message — it specifies which parameter failed and why.
2. Check required parameters against the tool reference in this skill.
3. Verify parameter types: `listId` and `taskId` are strings, `top` and `skip` are numbers, boolean flags are `true`/`false`.
4. Use valid enum values: status must be one of `notStarted`, `inProgress`, `completed`, `waitingOnOthers`, `deferred`. Importance must be `low`, `normal`, or `high`.
5. Retry with corrected parameters.

## Authentication Diagnostics

The `auth-status` tool is the first diagnostic step for any unexpected failure. Call it before investigating further — most issues trace back to authentication state.

**Why `auth-status` first?**

Authentication problems cascade into every other error category. An expired token produces `AUTH_ERROR`, but a failing refresh can also surface as `GRAPH_API_ERROR` (401) or `NETWORK_ERROR` (if the token endpoint is unreachable). Checking `auth-status` first eliminates the most common root cause in a single call.

**Interpreting `auth-status` output**

The response falls into one of three states:

| Output pattern                                                       | Meaning                                                                                 | Action                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Authenticated. Token expires at ...` / `Token expires in N minutes` | Active session, no action needed.                                                       | Proceed with the data operation.                                                |
| `Authentication expired ...` / `Not authenticated.`                  | No valid token. The user must re-authenticate.                                          | Guide the user through `start-auth` or `start-device-auth`.                     |
| `⚠️ WARNING: Personal Microsoft account detected`                    | Consumer account (Outlook.com, Hotmail, etc.). Will likely hit `[MAILBOX_NOT_ENABLED]`. | Warn the user and offer the alternatives listed in the troubleshooting section. |

**Warning signs to watch for:**

- **Personal account warning** (⚠️ `WARNING: Personal Microsoft account detected`) — This appears when the authenticated account is a consumer Microsoft account. It predicts that data operations will fail with `[MAILBOX_NOT_ENABLED]`. Surface this to the user proactively and offer the three alternatives before they encounter the error.

- **Refresh failure** (⚠️ `Last token refresh failed ...`) — The refresh token is invalid or expired. The current token may still be valid for a short time, but once it expires, all operations will fail with `[AUTH_ERROR]`. Guide the user to re-authenticate immediately rather than waiting for the failure.

**Server-side refresh behavior**

The server handles token refresh automatically in two scenarios:

- **Proactive refresh**: 5 minutes before the current token expires, the server refreshes preemptively.
- **Reactive refresh**: When a Graph API call returns HTTP 401, the server refreshes the token and retries the request once.

Because of this, you should **not** manually retry on auth errors. If the server's reactive refresh fails (indicated by `[AUTH_ERROR]`), the refresh token itself is invalid and the user must re-authenticate through the full OAuth flow.

**Quick diagnostic decision tree**

```
Tool call failed unexpectedly
│
├── Call auth-status
│   │
│   ├── "Authenticated. Token expires ..."
│   │   └── Auth is fine. Check the error code prefix:
│   │       ├── [GRAPH_API_ERROR] → Check HTTP status, verify IDs, review OData params.
│   │       ├── [PERMISSION_DENIED] → Admin consent needed for Tasks.ReadWrite.
│   │       ├── [NETWORK_ERROR] → Check connectivity and proxy settings.
│   │       └── [VALIDATION_ERROR] → Fix parameter types, required fields, or enum values.
│   │
│   ├── "Authentication expired" / "Not authenticated"
│   │   └── Guide user to re-authenticate:
│   │       ├── AUTH_FLOW not set to "device" → start-auth
│   │       └── AUTH_FLOW=device → start-device-auth
│   │
│   └── ⚠️ Personal account warning
│       └── Warn user. Expect [MAILBOX_NOT_ENABLED].
│           Offer: M365 dev tenant, work/school account, or web/mobile apps.
│
└── auth-status itself fails
    └── Server may be misconfigured. Check CLIENT_ID, CLIENT_SECRET, TENANT_ID in env.
```

## Workflow Recipes

<recipe>
**Name:** Project Setup
**Goal:** Create a new project task list, populate it with initial tasks, and add checklist items for complex tasks — all in one session.

**Steps:**

1. `auth-status` — Confirm authentication before making changes.
2. `create-task-list { displayName: "Project Alpha" }` — Create the project list. Note the returned `listId`.
3. For each major deliverable, call `create-task`:
   ```
   create-task { listId: "<id>", title: "Define requirements", importance: "high", dueDateTime: "2025-08-01T17:00:00Z" }
   create-task { listId: "<id>", title: "Design architecture", importance: "normal", dueDateTime: "2025-08-15T17:00:00Z" }
   create-task { listId: "<id>", title: "Build MVP", importance: "high", dueDateTime: "2025-09-01T17:00:00Z" }
   ```
4. For tasks that need breakdown, add checklist items:
   ```
   create-checklist-item { listId: "<id>", taskId: "<task-id>", displayName: "Interview stakeholders" }
   create-checklist-item { listId: "<id>", taskId: "<task-id>", displayName: "Write spec document" }
   create-checklist-item { listId: "<id>", taskId: "<task-id>", displayName: "Get sign-off" }
   ```
5. Verify the result: `get-tasks { listId: "<id>", select: "id,title,status,importance" }`

**Expected outcome:** A fully structured project list with prioritized tasks, due dates, and subtask breakdowns ready for execution.

**Token tip:** Batch all `create-task` calls before reading back — avoid interleaving reads between writes. Use `select: "id,title"` on the verification read to minimize response size.
</recipe>

<recipe>
**Name:** Daily / Weekly Review
**Goal:** Review all task lists, surface overdue and high-priority items, and update statuses to reflect current progress.

**Steps:**

1. `auth-status` — Confirm authentication.
2. `get-task-lists-organized { includeIds: true, groupBy: "category" }` — Get a categorized overview of all lists with their IDs.
3. For each active list, retrieve incomplete tasks:
   ```
   get-tasks { listId: "<id>", filter: "status ne 'completed'", orderby: "importance desc", top: 20, select: "id,title,status,importance,dueDateTime" }
   ```
4. Identify overdue items by comparing `dueDateTime` to today's date. For tasks that are overdue:
   ```
   update-task { listId: "<id>", taskId: "<task-id>", importance: "high" }
   ```
5. For tasks completed since last review:
   ```
   update-task { listId: "<id>", taskId: "<task-id>", status: "completed" }
   ```
6. Summarize for the user: list counts of overdue, in-progress, and upcoming tasks.

**Expected outcome:** A clear snapshot of current work across all lists, with overdue items surfaced and statuses updated.

**Token tip:** Use `select` to fetch only the fields you need for review (`id,title,status,importance,dueDateTime`). Use `top: 20` per list to keep responses manageable. Skip lists the user considers archived or inactive.
</recipe>

<recipe>
**Name:** Bulk Task Creation
**Goal:** Create multiple tasks in a list from a user-provided list of items — for example, meeting action items, sprint backlog entries, or a brain-dump of ideas.

**Steps:**

1. `auth-status` — Confirm authentication.
2. Resolve or create the target list:
   ```
   get-task-lists-organized { includeIds: true }
   ```
   If the list doesn't exist: `create-task-list { displayName: "Sprint 12 Backlog" }`
3. Create each task with appropriate metadata. For a structured backlog:
   ```
   create-task { listId: "<id>", title: "Fix login timeout bug", importance: "high", categories: ["Bug"], dueDateTime: "2025-07-20T17:00:00Z" }
   create-task { listId: "<id>", title: "Add export CSV feature", importance: "normal", categories: ["Feature"], dueDateTime: "2025-07-25T17:00:00Z" }
   create-task { listId: "<id>", title: "Update API docs", importance: "low", categories: ["Documentation"], dueDateTime: "2025-07-30T17:00:00Z" }
   ```
4. Verify the batch: `get-tasks { listId: "<id>", select: "id,title,status", orderby: "createdDateTime desc", top: 50 }`

**Expected outcome:** All items created as individual tasks in the target list with consistent metadata (importance, categories, due dates).

**Token tip:** Skip the verification read if the user provided more than 10 items — just confirm the count. Use `categories` to tag tasks so they can be filtered later with `$filter` on future reviews.
</recipe>

<recipe>
**Name:** Cross-List Task Moves and Archiving
**Goal:** Reorganize tasks across lists — archive completed items, move tasks between projects, and clean up stale lists.

**Steps:**

1. `auth-status` — Confirm authentication.
2. Preview archiving with a dry run first:
   ```
   archive-completed-tasks { sourceListId: "<active-list-id>", targetListId: "<archive-list-id>", olderThanDays: 30, dryRun: true }
   ```
3. Review the dry-run output with the user, then execute:
   ```
   archive-completed-tasks { sourceListId: "<active-list-id>", targetListId: "<archive-list-id>", olderThanDays: 30, dryRun: false }
   ```
4. For tasks that need to move between active lists (e.g., reassigning to another project), there is no direct "move" API — recreate and delete:
   ```
   get-tasks { listId: "<source-list-id>", filter: "title eq 'Review vendor contract'", select: "id,title,body,dueDateTime,importance,status,categories" }
   create-task { listId: "<target-list-id>", title: "<original-title>", body: "<original-body>", ... }
   delete-task { listId: "<source-list-id>", taskId: "<original-task-id>" }
   ```
5. Optionally clean up empty lists: `delete-task-list { listId: "<empty-list-id>" }` (confirm with user first).

**Expected outcome:** Completed tasks archived, active tasks reorganized into the correct lists, and empty or stale lists removed.

**Token tip:** Always use `dryRun: true` before archiving — it costs the same tokens but prevents accidental data loss. When recreating tasks for a move, use `select` on the read step to capture all fields you'll need to replicate.
</recipe>
