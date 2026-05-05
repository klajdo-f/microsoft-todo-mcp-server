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

1. Navigate to the [Azure Portal - App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps).
2. Click **New registration**.
3. **Name:** e.g., `MCP-Graph-Integration`.
4. **Supported account types:** This is the most critical step for a Hotmail account. You **must** select:
   * *Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)* **OR**
   * *Personal Microsoft accounts only*.
5. **Redirect URI:**
   * If you are using the **Authorization Code Flow** (spinning up a local HTTP server to catch the callback), set it to `Web` or `Single-page application` and use `http://localhost:3000/callback` (or your preferred port).
   * If you plan to use the **Device Authorization Grant** (best for headless CLI/MCP server processes), leave this blank for now, but under your app's **Authentication** menu, enable **Allow public client flows**.
6. Once created, save your **Application (client) ID**.
7. If using the Authorization Code flow, go to **Certificates & secrets** and create a **New client secret**. Save this value immediately.

## Step 2: Define Your OAuth 2.0 Scopes

Scopes dictate what your MCP server is allowed to read and write. Because you are building a background tool that needs continuous access without prompting you to log in every hour, you must request offline access.

Your required `scope` string will be:
`User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access`

* `Calendars.ReadWrite`: Grants access to your Outlook/Hotmail Calendar.
* `Tasks.ReadWrite`: Grants access to your Microsoft To Do tasks.
* `offline_access`: Yields a **Refresh Token** alongside your Access Token. Your MCP server will securely store this to silently mint new access tokens when they expire.

## Step 3: Implement the OAuth 2.0 Flow

For a personal account, you must use the `consumers` or `common` tenant endpoints.

### Option A: Device Code Flow (Recommended for headless MCP servers)

This avoids needing a local web server for redirects. The server outputs a code, you type it into a browser, and the server polls for the token.

1. **Request Device Code:**
`POST https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode`

```x-www-form-urlencoded
  client_id=${CLIENT_ID}
  scope=User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access
```

1. **Poll for Token:**
`POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token`

```x-www-form-urlencoded
grant_type=urn:ietf:params:oauth:grant-type:device_code
client_id=${CLIENT_ID}
device_code=DEVICE_CODE_FROM_PREVIOUS_STEP
```

### Option B: Authorization Code Flow (Standard web flow)

1. **Get Authorization Code (Browser redirect):**
`GET https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=http://localhost:4040/callback&scope=User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access`
2. **Exchange Code for Token:**
`POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token`

```x-www-form-urlencoded
client_id=${CLIENT_ID}
client_secret=${CLIENT_SECRET}
code=${CODE_FROM_URL}
redirect_uri=http://localhost:4040/callback
grant_type=authorization_code
```

## Step 4: Microsoft Graph API Endpoints for MCP Tools

Once you have the `access_token`, include it in the header of all Graph API requests:
`Authorization: Bearer <your_access_token>`

### 1. Microsoft To Do (Tasks API)

Microsoft To Do is accessed via the `todo` endpoints in the Graph API v1.0.

* **List Task Lists:**
`GET https://graph.microsoft.com/v1.0/me/todo/lists`
*(Note: You need the `id` of a specific list to fetch or create tasks inside it.)*
* **List Tasks in a List:**
`GET https://graph.microsoft.com/v1.0/me/todo/lists/{list-id}/tasks?$filter=status ne 'completed'`
* **Create a Task:**
`POST https://graph.microsoft.com/v1.0/me/todo/lists/{list-id}/tasks`

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

#### 2. Outlook Calendar API

* **List Events (Next 7 Days):**
Use the `calendarView` endpoint instead of `events` to automatically expand recurring events.
`GET https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-05-05T00:00:00Z&endDateTime=2026-05-12T00:00:00Z`
* **Create a Calendar Event:**
`POST https://graph.microsoft.com/v1.0/me/events`

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

### Step 5: Handling Token Expiration in your MCP Server

Access tokens expire after roughly 60 minutes. Your MCP server needs background logic to silently refresh the token before fulfilling a context request.

**To refresh the token:**
`POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token`

```x-www-form-urlencoded
client_id=${CLIENT_ID}
client_secret=${CLIENT_SECRET} (if using Auth Code flow)
grant_type=refresh_token
refresh_token=YOUR_STORED_REFRESH_TOKEN
```

Always store the *new* refresh token returned by this call, as Microsoft Identity may rotate refresh tokens for security purposes. Store this configuration in a local `.env` or secure JSON keystore that your MCP server process can read/write to at runtime.
