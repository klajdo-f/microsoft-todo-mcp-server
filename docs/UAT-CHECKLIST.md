# Microsoft To Do MCP Server — UAT Checklist

Use this checklist to verify the live token lifecycle end-to-end with a real Microsoft 365 business account. A personal Microsoft account (outlook.com, hotmail.com, live.com) will fail with `MailboxNotEnabledForRESTAPI` — this is a Microsoft limitation, not a server bug.

## Prerequisites

- [ ] Microsoft 365 business account (work/school) with To Do enabled
- [ ] Node.js ≥ 18 installed
- [ ] pnpm installed (`npm install -g pnpm`)
- [ ] Claude Desktop installed (or Cursor with MCP support)

## Setup Flow

**Goal:** One-shot setup produces a clean Claude config with no embedded tokens.

1. [ ] Run `npx microsoft-todo-mcp-server setup` in a terminal.
2. [ ] A browser opens; complete the Microsoft OAuth consent flow.
3. [ ] The terminal prints "Setup complete" and the path to the written Claude config.
4. [ ] Open the Claude config file (path printed in terminal).
   - **Pass:** The `mcpServers["microsoft-todo"]` entry contains `command` and `args` only.
   - **Fail:** An `env` property exists with `MS_TODO_ACCESS_TOKEN` or `MS_TODO_REFRESH_TOKEN`.
5. [ ] Restart Claude Desktop.

## Startup Guard

**Goal:** The server fails fast with an actionable error when tokens are missing.

1. [ ] Temporarily rename the token file:
   - macOS/Linux: `mv ~/.config/microsoft-todo-mcp/tokens.json ~/.config/microsoft-todo-mcp/tokens.json.bak`
   - Windows: `move %APPDATA%\microsoft-todo-mcp\tokens.json %APPDATA%\microsoft-todo-mcp\tokens.json.bak`
2. [ ] Run `node dist/cli.js` (or let Claude start the server).
   - **Pass:** Process exits with code 1 and stderr contains "mstodo-setup".
   - **Fail:** Process starts successfully or the error is vague.
3. [ ] Restore the token file (reverse the rename).
4. [ ] Run `node dist/cli.js` again.
   - **Pass:** Server starts and prints "Server started and listening".
   - **Fail:** Any authentication error at startup.

## Proactive Refresh

**Goal:** Tokens refresh silently 5 minutes before expiry without user intervention.

1. [ ] Call the `auth-status` tool in Claude.
   - Note the "Token expires at" timestamp.
2. [ ] Wait until the expiry time has passed (or temporarily edit `expiresAt` in the token file to a past timestamp, then restore after the test).
3. [ ] Call any tool (e.g., `get-task-lists`).
   - **Pass:** The tool returns data successfully with no auth error.
   - **Fail:** "Failed to authenticate" or `MailboxNotEnabledForRESTAPI` (if using a personal account).
4. [ ] Check the server stderr/logs.
   - **Pass:** Logs show "getAccessToken called" and "Successfully retrieved valid token".
   - **Fail:** No refresh attempt logged, or "TOKEN REFRESH FAILED" message present.

## Reactive Refresh

**Goal:** A 401 from Graph API triggers a single silent refresh and retry.

1. [ ] Ensure tokens are valid (run `auth-status` and confirm not expired).
2. [ ] Temporarily corrupt only the `accessToken` field in the token file (e.g., prepend `x` to it) — do **not** touch the `refreshToken`.
3. [ ] Call any tool (e.g., `get-task-lists`).
   - **Pass:** The first Graph API call returns 401, the server attempts refresh, retries once, and returns data successfully.
   - **Fail:** The tool fails immediately with "Failed to authenticate" and no retry is logged.
4. [ ] Check stderr for the exact sequence:
   - "Got 401, attempting token refresh..."
   - "getAccessToken called"
   - "Successfully retrieved valid token"
   - "Making request to: ..." (the retry)
   - **Pass:** All four lines appear in this order.
   - **Fail:** Missing retry line, or multiple retries (infinite loop).
5. [ ] Restore the original `accessToken` value in the token file.

## Failure Recovery

**Goal:** When refresh fails, `auth-status` shows clear diagnostics and an actionable re-auth message.

1. [ ] Temporarily corrupt the `refreshToken` field in the token file (e.g., replace it with `invalid`).
2. [ ] Call `auth-status`.
   - **Pass:** Response shows a ⚠️ warning with `lastRefreshError` containing an HTTP error code and a `lastRefreshAttempt` timestamp.
   - **Fail:** No failure metadata shown, or stale success message.
3. [ ] Call any data tool (e.g., `get-task-lists`).
   - **Pass:** Tool fails with a clear auth-related error and stderr contains the "TOKEN REFRESH FAILED - REAUTHENTICATION REQUIRED" banner.
   - **Fail:** Generic "Failed to retrieve" error with no guidance.
4. [ ] Run `npx microsoft-todo-mcp-server setup` again to re-authenticate.
5. [ ] Call `auth-status`.
   - **Pass:** `lastRefreshError` and `lastRefreshAttempt` are gone; token shows as valid.
   - **Fail:** Stale error metadata persists after successful re-auth.

## Token File Self-Sufficiency

**Goal:** No env vars or config edits are needed after setup.

1. [ ] Verify `MS_TODO_ACCESS_TOKEN` and `MS_TODO_REFRESH_TOKEN` are **not** set in your shell or Claude config.
2. [ ] Restart Claude Desktop.
3. [ ] Call `get-task-lists`.
   - **Pass:** Works immediately with no manual token entry.
   - **Fail:** Requires env vars or manual token copy-paste.
