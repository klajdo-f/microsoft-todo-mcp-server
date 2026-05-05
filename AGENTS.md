# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Development

```bash
pnpm install         # Install dependencies
pnpm run build       # Build with tsup to build/ directory
pnpm run dev         # Build and run CLI in one command
pnpm run typecheck   # Run TypeScript type checking (no emit)
pnpm run check       # Run format check + typecheck
pnpm run check:fix   # Auto-fix formatting + typecheck
```

### Running the Server

```bash
pnpm run cli         # Run MCP server via CLI wrapper
pnpm start           # Run MCP server directly (dist/todo-index.js)
```

### Testing and Quality

```bash
pnpm test            # Run all test suites (vitest)
pnpm run lint        # Run Prettier format check
pnpm run format      # Auto-format all source files
pnpm run ci          # Full CI pipeline: check + build
```

## Architecture Overview

This is a Model Context Protocol (MCP) server that enables AI assistants to interact with Microsoft To Do via the Microsoft Graph API. The codebase follows a layered Clean Architecture / DDD-lite structure:

### Directory Structure

```txt
src/
├── domain/                  # Core entities, errors, repository interfaces
│   ├── entities.ts          # TaskList, Task, ChecklistItem types + Zod schemas
│   └── errors.ts            # McpError hierarchy (AuthError, GraphApiError, etc.)
├── application/             # Domain services (use cases)
│   ├── list-service.ts      # Task list CRUD operations
│   ├── task-service.ts      # Task CRUD operations
│   └── checklist-service.ts # Checklist item CRUD operations
├── infrastructure/          # External adapters (Graph API, persistence, logging)
│   ├── graph-client.ts      # Microsoft Graph API v1.0 client
│   ├── token-repository.ts  # OAuth token file persistence
│   └── logger.ts            # Zero-dependency structured JSON Lines logger
├── interface/               # MCP transport and tool registration
│   ├── server.ts            # McpServer factory + startServer() lifecycle
│   ├── error-handler.ts     # Domain exception → actionable MCP text formatter
│   └── tools/               # Domain-grouped MCP tool registrars
│       ├── auth-tools.ts       # auth-status, start-auth, start-device-auth
│       ├── list-tools.ts       # get-task-lists, get-task-lists-organized, etc.
│       ├── task-tools.ts       # get-tasks, create-task, update-task, etc.
│       ├── checklist-tools.ts  # get-checklist-items, create-checklist-item, etc.
│       └── debug-tools.ts      # archive-completed-tasks, test-graph-api-exploration
```

### Key Architectural Patterns

- **Layered Architecture**: Import direction is `interface → application → domain`. Infrastructure depends on domain interfaces, not the other way around.
- **Token Management**: Tokens are stored in `tokens.json` with automatic refresh 5 minutes before expiration. Silent reactive refresh on 401 responses.
- **Multi-flow Authentication**: `AUTH_FLOW` environment variable selects `authorization_code` (default, requires `CLIENT_ID` + `CLIENT_SECRET`) or `device_code` (requires only `CLIENT_ID`).
- **Multi-tenant Support**: Configurable for different Microsoft account types via `TENANT_ID`.
- **Typed Error Handling**: Domain exceptions (`AuthError`, `GraphApiError`, `PermissionDeniedError`, `MailboxNotEnabledError`, `NetworkError`, `ValidationError`) are raised by the Graph client and formatted into actionable MCP responses at the interface boundary.
- **Structured Logging**: JSON Lines output to stderr with `{ level, timestamp, message, context? }`. No external logging dependency. Log level controlled via `LOG_LEVEL` env var.
- **Type Safety**: Strict TypeScript with Zod schemas at tool boundaries and domain type interfaces throughout.

### MCP Tool Surface (17+ tools)

**Authentication**: `auth-status`, `start-auth` (authorization code), `start-device-auth` (device code)

**Task Lists**: `get-task-lists`, `get-task-lists-organized`, `create-task-list`, `update-task-list`, `delete-task-list`

**Tasks**: `get-tasks`, `create-task`, `update-task`, `delete-task`

**Checklist Items**: `get-checklist-items`, `create-checklist-item`, `update-checklist-item`, `delete-checklist-item`

**Debug & Organization**: `archive-completed-tasks`, `test-graph-api-exploration`

The auth tools register conditionally: `start-auth` is available when `AUTH_FLOW` is not set to `device`; `start-device-auth` is available when `AUTH_FLOW=device`.

### Microsoft Graph API Integration

The server communicates with Microsoft Graph API v1.0:

- Base URL: `https://graph.microsoft.com/v1.0`
- Three-level hierarchy: Lists → Tasks → Checklist Items
- Supports OData query parameters for filtering and sorting (`$select`, `$filter`, `$top`, `$orderby`, `$skip`, `$count`)

### Environment Configuration

- `MSTODO_TOKEN_FILE`: Custom path for tokens.json (defaults to ./tokens.json)
- `AUTH_FLOW`: Authentication flow selection (`authorization_code` or `device`)
- `CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`, `REDIRECT_URI`: Azure AD app registration credentials (read from `process.env` at runtime)
- `LOG_LEVEL`: Logger filtering (`debug`, `info`, `warn`, `error`)

## Usage Skill

An agent skill at `skills/use-microsoft-todo/SKILL.md` teaches AI assistants how to effectively use this MCP server. It covers:

- All 17+ tools with quick-reference cards (name, purpose, params, examples)
- 4 workflow recipes (Project Setup, Daily/Weekly Review, Bulk Task Creation, Cross-List Moves)
- 10 token reduction patterns with before/after comparisons
- Troubleshooting for 6 error codes (`AUTH_ERROR`, `MAILBOX_NOT_ENABLED`, `PERMISSION_DENIED`, `GRAPH_API_ERROR`, `NETWORK_ERROR`, `VALIDATION_ERROR`)
- Auth diagnostic decision tree

Load the skill when working with Microsoft To Do operations, task management workflows, or MCP server usage questions.

## Important Notes

- Always run `pnpm run build` after modifying TypeScript files (uses tsup for bundling).
- Tokens are automatically refreshed using the refresh token when needed (proactive at 5 minutes before expiry, reactive on 401).
- Personal Microsoft accounts (Outlook.com, Hotmail.com, Live.com) have limited API access compared to work/school accounts and will surface `[MAILBOX_NOT_ENABLED]` errors.
- The `auth-status` tool is the first diagnostic step for any unexpected failure.
- The server does not load `.env` files automatically — credentials must be provided via the MCP client's `env` field.
- `dotenv.config()` was removed from all entry points; credentials are read exclusively from `process.env`.
