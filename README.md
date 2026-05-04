# Microsoft To Do MCP

[![CI](https://github.com/jordanburke/microsoft-todo-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/jordanburke/microsoft-todo-mcp-server/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/microsoft-todo-mcp-server.svg)](https://www.npmjs.com/package/microsoft-todo-mcp-server)

A Model Context Protocol (MCP) server that enables AI assistants to interact with Microsoft To Do via the Microsoft Graph API. Works with any MCP-compatible client — Claude Desktop, Cursor, Windsurf, and more.

## Features

- **17 MCP Tools**: Complete task management including lists, tasks, checklist items, and organization
- **In-Band Authentication**: Authenticate directly through the `start-auth` MCP tool — no separate CLI steps
- **Universal Client Support**: Configure once with environment variables, works in every MCP client
- **Automatic Token Refresh**: Tokens are refreshed 5 minutes before expiration, transparently
- **Microsoft Graph API Integration**: Direct integration with Microsoft's official API v1.0
- **Multi-tenant Support**: Works with personal, work, and school Microsoft accounts
- **TypeScript**: Fully typed for reliability and developer experience
- **ESM Modules**: Modern JavaScript module system

## Prerequisites

- Node.js 18 or higher
- A Microsoft account (personal, work, or school)
- An Azure App Registration (see setup below)

## Installation

### Option 1: Use with an MCP Client (No Installation)

Add the server to your MCP client configuration (see [MCP Client Configuration](#mcp-client-configuration) below). The client will download and run the package automatically via `npx`.

### Option 2: Global Installation

```bash
npm install -g microsoft-todo-mcp-server
# or
pnpm install -g microsoft-todo-mcp-server
```

The package provides two command aliases:

- `microsoft-todo-mcp-server` — Full package name
- `mstodo` — Short alias

### Option 3: Clone and Build Locally

```bash
git clone https://github.com/jordanburke/microsoft-todo-mcp-server.git
cd microsoft-todo-mcp-server
pnpm install
pnpm run build
```

## Azure App Registration

Before using the server, you need to register an application in Azure:

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **App registrations** → **New registration**
3. Name your application (e.g., "To Do MCP")
4. For **Supported account types**, choose based on your needs:
   - **Accounts in this organizational directory only** — Single tenant
   - **Accounts in any organizational directory** — Multi-tenant
   - **Accounts in any organizational directory and personal Microsoft accounts** — Both work and personal accounts
5. Set the **Redirect URI** to `http://localhost:3000/callback`
6. After creation, go to **Certificates & secrets** → create a new client secret
7. Go to **API permissions** → add the following **Microsoft Graph > Delegated permissions**:
   - `Tasks.Read`
   - `Tasks.ReadWrite`
   - `User.Read`
8. Click **Grant admin consent** for these permissions

Save your **Application (client) ID** and **Client Secret** — you'll need them for configuration.

## MCP Client Configuration

Configure the server in your MCP client using environment variables for credentials. The server requires three environment variables: `CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID`. A fourth optional variable `REDIRECT_URI` defaults to `http://localhost:3000/callback`.

### TENANT_ID Options

| Value            | Use Case                                                       |
| ---------------- | -------------------------------------------------------------- |
| `organizations`  | Multi-tenant organizational/work accounts (default if omitted) |
| `consumers`      | Personal Microsoft accounts only                               |
| `common`         | Both organizational and personal accounts                      |
| `your-tenant-id` | Single-tenant (use your Azure AD tenant GUID)                  |

### Claude Desktop

Add to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "microsoftTodo": {
      "command": "npx",
      "args": ["-y", "microsoft-todo-mcp-server"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "CLIENT_SECRET": "your_client_secret",
        "TENANT_ID": "organizations"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP configuration:

- **Global**: `~/.cursor/mcp.json`
- **Project**: `.cursor/mcp.json` in your project root

```json
{
  "mcpServers": {
    "microsoftTodo": {
      "command": "npx",
      "args": ["-y", "microsoft-todo-mcp-server"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "CLIENT_SECRET": "your_client_secret",
        "TENANT_ID": "organizations"
      }
    }
  }
}
```

### Windsurf

Add to your Windsurf MCP configuration (usually `~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "microsoftTodo": {
      "command": "npx",
      "args": ["-y", "microsoft-todo-mcp-server"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "CLIENT_SECRET": "your_client_secret",
        "TENANT_ID": "organizations"
      }
    }
  }
}
```

### Running from Source

If you cloned the repo and built locally, point the `command` at the built CLI:

```json
{
  "mcpServers": {
    "microsoftTodo": {
      "command": "node",
      "args": ["/path/to/microsoft-todo-mcp-server/dist/cli.js"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "CLIENT_SECRET": "your_client_secret",
        "TENANT_ID": "organizations"
      }
    }
  }
}
```

## First-Time Authentication

After adding the server to your MCP client, authenticate with Microsoft using the built-in `start-auth` tool:

1. **Ask your AI assistant** to run the `start-auth` tool (e.g., _"Run start-auth to authenticate with Microsoft"_)
2. The tool will return an **authentication URL** — open it in your browser
3. **Sign in** with your Microsoft account and grant consent
4. The server captures the OAuth callback automatically and **saves your tokens**
5. You're ready to use all Microsoft To Do tools

The server stores authentication tokens in a `tokens.json` file alongside your configuration. Tokens are refreshed automatically 5 minutes before expiration. You can customize the token file location with the `MSTODO_TOKEN_FILE` environment variable.

**Re-authentication**: If your tokens expire or become invalid, simply call `start-auth` again. The server also attempts automatic refresh on each API call.

## MCP Tools

The server provides 17 tools for comprehensive Microsoft To Do management:

### Authentication

| Tool              | Description                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **`auth-status`** | Check authentication status — shows credential presence, token expiration time, account type (personal/work), and last refresh error if any |
| **`start-auth`**  | Start the Microsoft OAuth flow — returns a URL to open in your browser; tokens are saved automatically after consent                        |

### Task Lists

| Tool                           | Description                                                                 |
| ------------------------------ | --------------------------------------------------------------------------- |
| **`get-task-lists`**           | Retrieve all task lists with metadata (default, shared, etc.)               |
| **`get-task-lists-organized`** | Retrieve task lists organized by category (owned, shared, default, flagged) |
| **`create-task-list`**         | Create a new task list                                                      |
| **`update-task-list`**         | Rename an existing task list                                                |
| **`delete-task-list`**         | Delete a task list and all its contents                                     |

### Tasks

| Tool              | Description                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`get-tasks`**   | Get tasks from a list with filtering, sorting, and pagination (supports OData query parameters: `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`) |
| **`create-task`** | Create a new task with full property support (title, description, due date, start date, importance, reminders, status, categories)                           |
| **`update-task`** | Update any task properties                                                                                                                                   |
| **`delete-task`** | Delete a task and all its checklist items                                                                                                                    |

### Checklist Items (Subtasks)

| Tool                        | Description                              |
| --------------------------- | ---------------------------------------- |
| **`get-checklist-items`**   | Get subtasks for a specific task         |
| **`create-checklist-item`** | Add a new subtask to a task              |
| **`update-checklist-item`** | Update subtask text or completion status |
| **`delete-checklist-item`** | Remove a specific subtask                |

### Organization

| Tool                          | Description                             |
| ----------------------------- | --------------------------------------- |
| **`archive-completed-tasks`** | Move completed tasks to an archive list |

### Exploration

| Tool                             | Description                                         |
| -------------------------------- | --------------------------------------------------- |
| **`test-graph-api-exploration`** | Explore Microsoft Graph API endpoints for debugging |

## Available Scripts

For local development:

```bash
pnpm run build        # Build TypeScript to JavaScript
pnpm run dev          # Build and run CLI in one command
pnpm start            # Run MCP server directly
pnpm run cli          # Run MCP server via CLI wrapper
pnpm run test         # Run tests
pnpm run typecheck    # TypeScript type checking
pnpm run format       # Format code with Prettier
pnpm run format:check # Check code formatting
pnpm run lint         # Run linting checks
```

## Architecture

### Project Structure

- **MCP Server** (`src/todo-index.ts`) — Core server implementing the MCP protocol with 17 tools
- **CLI Wrapper** (`src/cli.ts`) — Executable entry point; checks for credentials and starts the server
- **OAuth Engine** (`src/oauth-engine.ts`) — MSAL-based OAuth logic: authorization URL generation, token exchange, and refresh
- **Auth Callback Server** (`src/auth-callback-server.ts`) — Lightweight HTTP server that listens for the OAuth callback during `start-auth` and writes tokens via `TokenManager`
- **Token Manager** (`src/token-manager.ts`) — Reads, writes, and refreshes tokens in `tokens.json`
- **Graph Client** (`src/graph-client.ts`) — Microsoft Graph API helper for authenticated requests

### Technical Details

- **Microsoft Graph API**: v1.0 endpoints
- **Authentication**: MSAL (Microsoft Authentication Library) with PKCE flow
- **Token Management**: Automatic refresh 5 minutes before expiration, with `lastRefreshError` and `lastRefreshAttempt` persisted for diagnostics
- **Build System**: tsup for fast TypeScript compilation
- **Module System**: ESM (ECMAScript modules)

## Limitations & Known Issues

### Personal Microsoft Accounts

- **MailboxNotEnabledForRESTAPI Error**: Personal Microsoft accounts (outlook.com, hotmail.com, live.com) have limited access to the To Do API through Microsoft Graph
- This is a Microsoft service limitation, not an issue with this server
- Work/school accounts have full API access

### API Limitations

- Rate limits apply according to Microsoft's policies
- Some features may be unavailable for personal accounts
- Shared lists have limited functionality

## Troubleshooting

### Authentication Issues

**"Missing required credentials" at startup**

The server requires `CLIENT_ID` and `CLIENT_SECRET` in your MCP client's `env` configuration. Verify these are set correctly in your client's config file.

**Token acquisition failures**

- Ensure your Azure App's redirect URI matches exactly: `http://localhost:3000/callback`
- Check that the required Graph API permissions (`Tasks.Read`, `Tasks.ReadWrite`, `User.Read`) are added and consented
- For organizational accounts, admin consent may be required

**Check authentication status**

Ask your AI assistant: _"Check my auth status"_ — this runs the `auth-status` tool, which shows credential presence, token expiration, and any refresh errors.

### Debugging

The server logs diagnostic information to stderr:

```bash
# View server logs (when running from a terminal)
mstodo 2> debug.log
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Run `pnpm run typecheck` and `pnpm run format:check` before submitting
4. Submit a pull request

## License

MIT License — See [LICENSE](LICENSE) file for details.

## Acknowledgments

- Fork of [@jhirono/todomcp](https://github.com/jhirono/todomcp)
- Built on the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk)
- Uses [Microsoft Graph API](https://developer.microsoft.com/en-us/graph)

## Support

- [GitHub Issues](https://github.com/jordanburke/microsoft-todo-mcp-server/issues)
- [npm Package](https://www.npmjs.com/package/microsoft-todo-mcp-server)
