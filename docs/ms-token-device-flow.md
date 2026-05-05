# Microsoft graph for personal accounts

Always store the *new* refresh token returned by this call, as Microsoft Identity may rotate refresh tokens for security purposes. Store this configuration inAs an expert in the Microsoft Graph API, I can guide you through the process of setting up OAuth 2.0 and querying the API to integrate your personal `@hotmail.com` account with your Model Context Protocol (MCP) server.

Accessing personal Microsoft accounts (MSA) uses the exact same Microsoft Graph API structure as enterprise accounts, but you must route your authentication through the Microsoft identity platform's consumer endpoints and ensure your app registration permits personal accounts.

Here is the architectural blueprint and step-by-step guide to building this integration.

## Step 1: Register your Application in Microsoft Entra ID

To interact with the Graph API, your MCP server needs an identity. You will register an application in the Azure Portal (now Microsoft Entra ID). **You do not need a paid Azure subscription for this; a free personal account works.**

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
   client_id=YOUR_CLIENT_ID
   scope=User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access
   ```

1. **Poll for Token:**
`POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token`

```x-www-form-urlencoded
   grant_type=urn:ietf:params:oauth:grant-type:device_code
   client_id=YOUR_CLIENT_ID
   device_code=DEVICE_CODE_FROM_PREVIOUS_STEP
   ```

### Option B: Authorization Code Flow (Standard web flow)

1. **Get Authorization Code (Browser redirect):**
`GET https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost:3000/callback&scope=User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access`
2. **Exchange Code for Token:**
`POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token`

```x-www-form-urlencoded
   client_id=YOUR_CLIENT_ID
   client_secret=YOUR_CLIENT_SECRET
   code=CODE_FROM_URL
   redirect_uri=http://localhost:3000/callback
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
  "title": "Build MCP Server for Graph API",
  "importance": "high",
  "dueDateTime": {
    "dateTime": "2026-05-10T12:00:00",
    "timeZone": "W. Europe Standard Time"
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
  "subject": "Deep Work: MCP Integration",
  "start": {
    "dateTime": "2026-05-06T10:00:00",
    "timeZone": "W. Europe Standard Time"
  },
  "end": {
    "dateTime": "2026-05-06T12:00:00",
    "timeZone": "W. Europe Standard Time"
  }
}
```

### Step 5: Handling Token Expiration in your MCP Server

Access tokens expire after roughly 60 minutes. Your MCP server needs background logic to silently refresh the token before fulfilling a context request.

**To refresh the token:**
`POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token`

```x-www-form-urlencoded
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET (if using Auth Code flow)
grant_type=refresh_token
refresh_token=YOUR_STORED_REFRESH_TOKEN
```

Always store the *new* refresh token returned by this call, as Microsoft Identity may rotate refresh tokens for security purposes. Store this configuration in a local `.env` or secure JSON keystore that your MCP server process can read/write to at runtime.
