# Microsoft To Do MCP

[![CI](https://github.com/jordanburke/microsoft-todo-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/jordanburke/microsoft-todo-mcp-server/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/microsoft-todo-mcp-server.svg)](https://www.npmjs.com/package/microsoft-todo-mcp-server)

A Model Context Protocol (MCP) server that enables AI assistants to interact with Microsoft To Do via the Microsoft Graph API. Works with any MCP-compatible client — Claude Desktop, Cursor, Windsurf, and more.

## Features

- **17 MCP Tools**: Complete task management including lists, tasks, checklist items, and organization
- **In-Band Authentication**: Authenticate directly through an MCP tool — use `start-auth` (browser-based) or `start-device-auth` (headless/terminal), selected via the `AUTH_FLOW` environment variable
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
5. Set the **Redirect URI** to `http://localhost:4040/callback`
6. After creation, go to **Certificates & secrets** → create a new client secret
7. Go to **API permissions** → add the following **Microsoft Graph > Delegated permissions**:
   - `Tasks.Read`
   - `Tasks.ReadWrite`
   - `User.Read`
8. Click **Grant admin consent** for these permissions

Save your **Application (client) ID** and **Client Secret** — you'll need them for configuration.

## MCP Client Configuration

Configure the server in your MCP client using environment variables for credentials. The required variables depend on the authentication flow you choose.

### Authentication Flows

The server supports two authentication flows, selected via the `AUTH_FLOW` environment variable:

| Variable    | Values                              | Default              | Description                               |
| ----------- | ----------------------------------- | -------------------- | ----------------------------------------- |
| `AUTH_FLOW` | `authorization_code`, `device_code` | `authorization_code` | Selects the OAuth flow for authentication |

- **`authorization_code`** (default) — Browser-based flow. Requires `CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID`. Best for desktop environments where a browser is available.
- **`device_code`** — Headless flow for terminal-only or remote environments. Requires only `CLIENT_ID`. No client secret needed. The server displays a user code and verification URL for sign-in on any device.

### Environment Variables

| Variable        | Required                     | Description                                                       |
| --------------- | ---------------------------- | ----------------------------------------------------------------- |
| `CLIENT_ID`     | Yes                          | Azure App Registration application (client) ID                    |
| `CLIENT_SECRET` | Authorization code flow only | Client secret from Azure App Registration                         |
| `TENANT_ID`     | Authorization code flow only | Tenant identifier (see table below)                               |
| `AUTH_FLOW`     | No                           | `authorization_code` (default) or `device_code`                   |
| `REDIRECT_URI`  | No                           | OAuth callback URL (defaults to `http://localhost:4040/callback`) |

### TENANT_ID Options

| Value            | Use Case                                                       |
| ---------------- | -------------------------------------------------------------- |
| `organizations`  | Multi-tenant organizational/work accounts (default if omitted) |
| `consumers`      | Personal Microsoft accounts only                               |
| `common`         | Both organizational and personal accounts                      |
| `your-tenant-id` | Single-tenant (use your Azure AD tenant GUID)                  |

### Authorization Code Flow Configuration

Use this configuration for desktop environments with browser access:

#### Claude Desktop

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

#### Cursor

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

#### Windsurf

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

### Device Code Flow Configuration

Use this configuration for headless, terminal-only, or remote environments. Only `CLIENT_ID` is required — no client secret.

> **Prerequisite:** In your Azure App Registration, go to **Authentication** → enable **Allow public client flows**.

#### Claude Desktop

```json
{
  "mcpServers": {
    "microsoftTodo": {
      "command": "npx",
      "args": ["-y", "microsoft-todo-mcp-server"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "AUTH_FLOW": "device_code"
      }
    }
  }
}
```

#### Cursor

```json
{
  "mcpServers": {
    "microsoftTodo": {
      "command": "npx",
      "args": ["-y", "microsoft-todo-mcp-server"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "AUTH_FLOW": "device_code"
      }
    }
  }
}
```

#### Windsurf

```json
{
  "mcpServers": {
    "microsoftTodo": {
      "command": "npx",
      "args": ["-y", "microsoft-todo-mcp-server"],
      "env": {
        "CLIENT_ID": "your_client_id",
        "AUTH_FLOW": "device_code"
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

After adding the server to your MCP client, authenticate with Microsoft. The authentication method depends on your `AUTH_FLOW` setting:

### Authorization Code Flow (`AUTH_FLOW=authorization_code`, default)

1. **Ask your AI assistant** to run the `start-auth` tool (e.g., _"Run start-auth to authenticate with Microsoft"_)
2. The tool will return an **authentication URL** — open it in your browser
3. **Sign in** with your Microsoft account and grant consent
4. The server captures the OAuth callback automatically and **saves your tokens**
5. You're ready to use all Microsoft To Do tools

### Device Code Flow (`AUTH_FLOW=device_code`)

1. **Ask your AI assistant** to run the `start-device-auth` tool
2. The tool returns a **user code** and a **verification URL**
3. Open the verification URL on any device (browser, phone, etc.)
4. **Enter the user code** when prompted and sign in with your Microsoft account
5. The server polls in the background and **saves your tokens** automatically once you complete sign-in
6. Verify your status with the `auth-status` tool

### Token Management

The server stores authentication tokens in a `tokens.json` file alongside your configuration. Tokens are refreshed automatically 5 minutes before expiration. You can customize the token file location with the `MSTODO_TOKEN_FILE` environment variable.

**Re-authentication**: If your tokens expire or become invalid, simply call `start-auth` (authorization code flow) or `start-device-auth` (device code flow) again. The server also attempts automatic refresh on each API call.

## MCP Tools

The server provides 17 tools for comprehensive Microsoft To Do management. The authentication tool depends on your `AUTH_FLOW` setting: `start-auth` for authorization code flow, `start-device-auth` for device code flow.

### Authentication

| Tool                    | Description                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`auth-status`**       | Check authentication status — shows credential presence, token expiration time, account type (personal/work), and last refresh error if any                                            |
| **`start-auth`**        | Start the Microsoft OAuth browser flow — returns a URL to open in your browser; tokens are saved automatically after consent. Available when `AUTH_FLOW=authorization_code` (default). |
| **`start-device-auth`** | Start device code authentication — displays a user code and verification URL; visit the URL on any device to complete sign-in. Available when `AUTH_FLOW=device_code`.                 |

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
- **Auth Flow Config** (`src/auth-flow-config.ts`) — Reads the `AUTH_FLOW` environment variable and selects the appropriate authentication flow
- **OAuth Engine** (`src/oauth-engine.ts`) — MSAL-based OAuth logic for authorization code flow: authorization URL generation, token exchange, and refresh
- **Device Code Engine** (`src/device-code-engine.ts`) — MSAL-based device code flow using `PublicClientApplication`; requires only `CLIENT_ID` (no client secret)
- **Auth Callback Server** (`src/auth-callback-server.ts`) — Lightweight HTTP server that listens for the OAuth callback during `start-auth` and writes tokens via `TokenManager`
- **Token Manager** (`src/token-manager.ts`) — Reads, writes, and refreshes tokens in `tokens.json`
- **Graph Client** (`src/graph-client.ts`) — Microsoft Graph API helper for authenticated requests

### Technical Details

- **Microsoft Graph API**: v1.0 endpoints
- **Authentication**: MSAL (Microsoft Authentication Library) with PKCE flow
- **Token Management**: Automatic refresh 5 minutes before expiration, with `lastRefreshError` and `lastRefreshAttempt` persisted for diagnostics
- **Build System**: tsup for fast TypeScript compilation
- **Module System**: ESM (ECMAScript modules)

## Personal Microsoft Accounts

Personal Microsoft accounts (Outlook.com, Hotmail, Live) have **limited access** to the Microsoft To Do API through Microsoft Graph. This is a **Microsoft service limitation** — not a bug in this server. Work and school accounts have full API access.

### How the Server Helps

This server detects and communicates the personal account limitation proactively:

1. **Detection at sign-in** — When you complete the `start-auth` or `start-device-auth` flow, the server checks whether your account is a personal Microsoft account and stores that information in your token metadata.
2. **Warning via `auth-status`** — Running `auth-status` shows your account type (personal or work/school) so you can verify at any time.
3. **Actionable error messages** — If you use a data tool (e.g., `get-task-lists`) with a personal account, the server returns a `[MAILBOX_NOT_ENABLED]` error with a clear explanation and a link to this section.

### Alternatives for Personal Account Users

You have three options to get full Microsoft To Do API access:

#### Option 1 — Sign Up for a Free Microsoft 365 Developer Tenant (Recommended)

Microsoft offers a free developer program that includes a Microsoft 365 tenant with full Graph API access. This is the best option for personal account users who want to use this server.

**Step-by-step instructions:**

1. Visit the [Microsoft 365 Developer Program](https://developer.microsoft.com/microsoft-365/dev-program) page.
2. Sign in with your existing Microsoft account (personal or otherwise).
3. Click **Join now** to enroll in the developer program (free, no credit card required).
4. After joining, click **Set up E5 subscription** to create a free developer tenant.
5. Complete the setup form — you'll choose a tenant domain name (e.g., `yourname.onmicrosoft.com`).
6. Once the tenant is provisioned, you'll receive a work account (e.g., `admin@yourname.onmicrosoft.com`).
7. [Register a new Azure App](#azure-app-registration) in this developer tenant, making sure to set the redirect URI to `http://localhost:4040/callback` and add the required Graph API permissions (`Tasks.Read`, `Tasks.ReadWrite`, `User.Read`).
8. Update your MCP client configuration with the new `CLIENT_ID`, `CLIENT_SECRET`, and set `TENANT_ID` to your developer tenant GUID (found in the Azure Portal under **Overview**).
9. Run `start-auth` (or `start-device-auth` if using device code flow) and sign in with your new developer tenant account.

#### Option 2 — Use an Existing Work or School Account

If you have a Microsoft 365 account through your employer or school:

1. Update your MCP client configuration and set `TENANT_ID` to `organizations`.
2. Run `start-auth` (or `start-device-auth`) and sign in with your work or school account.
3. Your organization's account has full To Do API access.

#### Option 3 — Use the Microsoft To Do App Directly

If you don't need programmatic access and just want to manage your tasks:

- **Web**: [https://to-do.microsoft.com](https://to-do.microsoft.com)
- **iOS**: Download Microsoft To Do from the App Store
- **Android**: Download Microsoft To Do from Google Play
- **Windows**: Available in the Microsoft Store

The web and mobile apps work with personal accounts and provide the full To Do experience.

---

## Limitations & Known Issues

### API Limitations

- Rate limits apply according to Microsoft's policies
- Some features may be unavailable for personal accounts
- Shared lists have limited functionality

## Troubleshooting

### Authentication Issues

**"Missing required credentials" at startup**

- For **authorization code flow**: ensure `CLIENT_ID` and `CLIENT_SECRET` are set in your MCP client's `env` configuration.
- For **device code flow**: ensure `CLIENT_ID` is set. `CLIENT_SECRET` is not required.

**Token acquisition failures**

- Ensure your Azure App's redirect URI matches exactly: `http://localhost:4040/callback` (authorization code flow only)
- Check that the required Graph API permissions (`Tasks.Read`, `Tasks.ReadWrite`, `User.Read`) are added and consented
- For organizational accounts, admin consent may be required

**Device code flow issues**

- Ensure **Allow public client flows** is enabled in your Azure App Registration under **Authentication**
- The user code expires after 15 minutes — if it expires, call `start-device-auth` again
- If you see "flow already in progress", the server is still polling for the previous attempt. Wait for it to complete or restart the server.

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
