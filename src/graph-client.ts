import { tokenManager } from "./token-manager.js"

// Microsoft Graph API endpoints
export const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
export const USER_AGENT = "microsoft-todo-mcp-server/1.0"

// Helper function for making Microsoft Graph API requests
export async function makeGraphRequest<T>(url: string, token: string, method = "GET", body?: any): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }

  try {
    const options: RequestInit = {
      method,
      headers,
    }

    if (body && (method === "POST" || method === "PATCH")) {
      options.body = JSON.stringify(body)
    }

    console.error(`Making request to: ${url}`)
    console.error(
      `Request options: ${JSON.stringify({
        method,
        headers: {
          ...headers,
          Authorization: "Bearer [REDACTED]",
        },
      })}`,
    )

    let response = await fetch(url, options)

    // If we get a 401, try to refresh the token and retry once
    if (response.status === 401) {
      console.error("Got 401, attempting token refresh...")
      const newToken = await getAccessToken() // This will trigger refresh
      if (newToken && newToken !== token) {
        // Retry with new token
        headers.Authorization = `Bearer ${newToken}`
        response = await fetch(url, { ...options, headers })
      }
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`HTTP error! status: ${response.status}, body: ${errorText}`)

      // Check for the specific MailboxNotEnabledForRESTAPI error
      if (errorText.includes("MailboxNotEnabledForRESTAPI")) {
        console.error(`
=================================================================
ERROR: MailboxNotEnabledForRESTAPI

The Microsoft To Do API is not available for personal Microsoft accounts 
(outlook.com, hotmail.com, live.com, etc.) through the Graph API.

This is a limitation of the Microsoft Graph API, not an authentication issue.
Microsoft only allows To Do API access for Microsoft 365 business accounts.

You can still use Microsoft To Do through the web interface or mobile apps,
but API access is restricted for personal accounts.
=================================================================
        `)

        throw new Error(
          "Microsoft To Do API is not available for personal Microsoft accounts. See console for details.",
        )
      }

      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
    }

    const data = await response.json()
    console.error(`Response received: ${JSON.stringify(data).substring(0, 200)}...`)
    return data as T
  } catch (error) {
    console.error("Error making Graph API request:", error)
    return null
  }
}

// Authentication helper using delegated flow with token manager
export async function getAccessToken(): Promise<string | null> {
  try {
    console.error("getAccessToken called")

    // Use the token manager to get tokens (handles all sources and refresh)
    const tokens = await tokenManager.getTokens()

    if (tokens) {
      console.error(`Successfully retrieved valid token`)
      return tokens.accessToken
    }

    console.error("No valid tokens available")
    return null
  } catch (error) {
    console.error("Error getting access token:", error)
    return null
  }
}
