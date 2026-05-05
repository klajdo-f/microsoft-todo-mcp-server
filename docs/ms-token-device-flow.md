# Device Code Authentication Guide

This guide explains how to use the **device code flow** with the Microsoft To Do MCP Server. The device code flow is designed for headless, terminal-only, or remote environments where opening a browser on the same machine isn't possible.

## When to Use Device Code Flow

Use device code flow when:

- Your MCP client runs in a terminal-only environment (SSH, containers, remote servers)
- No browser is available on the machine running the MCP server
- You prefer to authenticate on a separate device (phone, tablet, another computer)

Use the default **authorization code flow** when you have a browser available on the same machine — it's simpler and doesn't require Azure app configuration changes.

## Prerequisites

### 1. Azure App Registration

If you haven't already, register an application in the [Azure Portal](https://portal.azure.com):

1. Navigate to **App registrations** → **New registration**
2. Name your application (e.g., "To Do MCP — Device Code")
3. For **Supported account types**, choose based on your needs (see the [Azure App Registration](../README.md#azure-app-registration) section in the README for details)
4. Set the **Redirect URI** to `http://localhost:4040/callback` (required even though device code flow doesn't use it directly)

### 2. Enable Public Client Flows

This is the critical step for device code flow:

1. In your Azure App Registration, go to **Authentication**
2. Scroll to **Advanced settings**
3. Enable **Allow public client flows**
4. Click **Save**

Without this setting, the device code flow will fail with an authorization error.

### 3. API Permissions

Ensure your app registration has these **Microsoft Graph → Delegated permissions**:

- `Tasks.Read`
- `Tasks.Read.Shared`
- `Tasks.ReadWrite`
- `Tasks.ReadWrite.Shared`
- `User.Read`
- `offline_access` (included automatically)

Click **Grant admin consent** for organizational accounts.

## Configuration

### Environment Variables

Device code flow requires **only** `CLIENT_ID`. No client secret is needed.

| Variable    | Required | Description                                                                              |
| ----------- | -------- | ---------------------------------------------------------------------------------------- |
| `CLIENT_ID` | **Yes**  | Your Azure App Registration application (client) ID                                      |
| `AUTH_FLOW` | **Yes**  | Must be set to `device_code`                                                             |
| `TENANT_ID` | No       | Defaults to `organizations`. Set to `consumers` for personal accounts, `common` for both |

> **Note:** `CLIENT_SECRET` is **not required** and will be ignored when using device code flow. The device code flow is a _public client_ OAuth grant — it does not use a client secret.

### MCP Client Configuration Examples

#### Claude Desktop

Add to your `claude_desktop_config.json`:

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

Add to `~/.cursor/mcp.json` or your project's `.cursor/mcp.json`:

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

Add to your Windsurf MCP configuration:

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

## Using `start-device-auth`

Once your MCP client is configured with `AUTH_FLOW=device_code`, the server registers the `start-device-auth` tool instead of `start-auth`.

### Step-by-Step

1. **Ask your AI assistant** to run the `start-device-auth` tool (e.g., _"Run start-device-auth to authenticate"_)
2. The tool responds with:
   - A **user code** (e.g., `A1B2C3D4`)
   - A **verification URL** (e.g., `https://microsoft.com/devicelogin`)
3. **Open the verification URL** on any device — your phone, another computer, or a different browser
4. **Enter the user code** when prompted
5. **Sign in** with your Microsoft account and grant consent
6. The MCP server polls Microsoft in the background and **saves your tokens automatically** once you complete sign-in
7. Verify with the `auth-status` tool

### What the Tool Returns

The `start-device-auth` tool returns a response like:

```
Microsoft Device Code Authentication
====================================

To sign in, visit the URL below and enter the code when prompted.

**Code:** `A1B2C3D4`

[Click here to verify: https://microsoft.com/devicelogin](https://microsoft.com/devicelogin)

Or copy and paste the verification URL:
```

https://microsoft.com/devicelogin

```

After you complete authentication, your tokens will be saved automatically.
You can verify your status with the auth-status tool.
```

### Timing

- The user code is valid for **15 minutes**. If you don't complete sign-in within that time, the flow expires and you'll need to run `start-device-auth` again.
- The server polls Microsoft every few seconds. Token acquisition typically completes within a few seconds after you sign in.

### Concurrent Flow Guard

If you call `start-device-auth` while a previous flow is still pending, the tool returns the existing user code and verification URL instead of starting a new flow. This prevents confusion from multiple concurrent flows.

## After Sign-In

Once you complete sign-in:

1. **Tokens are saved automatically** to `tokens.json` (or the path specified by `MSTODO_TOKEN_FILE`)
2. The server stores the access token, refresh token, expiration time, and account type
3. Tokens are **refreshed automatically** 5 minutes before expiration
4. Run `auth-status` at any time to check your authentication state:
   - Whether credentials are present
   - Token expiration time
   - Account type (personal or work/school)
   - Any refresh errors

## Personal Microsoft Accounts

> **Warning:** Personal Microsoft accounts (Outlook.com, Hotmail.com, Live.com) have **limited access** to the Microsoft To Do API through Microsoft Graph. This is a Microsoft platform restriction, not an authentication issue.

The server detects personal accounts at sign-in and warns you. If you authenticate with a personal account, To Do data tools (like `get-task-lists`) may return a `[MAILBOX_NOT_ENABLED]` error.

For full API access, use a work/school account or sign up for a free [Microsoft 365 Developer Program](https://developer.microsoft.com/microsoft-365/dev-program) tenant. See the [Personal Microsoft Accounts](../README.md#personal-microsoft-accounts) section in the README for detailed alternatives.

## Troubleshooting

### "Device code configuration error: Missing required device-code environment variable(s): CLIENT_ID"

The `CLIENT_ID` environment variable is not set. Add it to your MCP client's `env` configuration:

```json
"env": {
  "CLIENT_ID": "your_client_id",
  "AUTH_FLOW": "device_code"
}
```

### "A device code authentication flow is already in progress"

A previous `start-device-auth` call is still polling. The tool returns the existing user code and verification URL. Either:

- Complete the existing flow on the verification URL
- Wait for the previous flow to expire (15 minutes)
- Restart the MCP server to clear the state

### User code expired

User codes expire after 15 minutes. Call `start-device-auth` again to get a fresh code.

### "Allow public client flows" error at sign-in

If you see an error about the client not being authorized for device code flow:

1. Go to your Azure App Registration in the Azure Portal
2. Navigate to **Authentication** → **Advanced settings**
3. Enable **Allow public client flows**
4. Click **Save**
5. Try `start-device-auth` again

### Token refresh failures

Tokens are refreshed automatically 5 minutes before expiration. If refresh fails:

- Run `auth-status` to see the specific error
- If the refresh token has been revoked, run `start-device-auth` again to re-authenticate
- Ensure your Azure App Registration's API permissions are still granted

### The `start-auth` tool is not available

When `AUTH_FLOW=device_code`, the server registers `start-device-auth` instead of `start-auth`. This is expected — only one authentication tool is available at a time, matching your configured flow.

## Switching Between Flows

To switch from device code flow back to authorization code flow:

1. Remove `AUTH_FLOW` from your MCP client configuration (or set it to `authorization_code`)
2. Add `CLIENT_SECRET` and `TENANT_ID` to the `env` configuration
3. Restart your MCP client

To switch from authorization code to device code flow:

1. Set `AUTH_FLOW=device_code` in your MCP client's `env` configuration
2. Ensure `CLIENT_ID` is set
3. Remove `CLIENT_SECRET` (optional — it's ignored in device code flow)
4. Restart your MCP client
