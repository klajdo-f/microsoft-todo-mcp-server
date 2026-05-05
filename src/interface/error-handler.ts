/**
 * Shared error handler for MCP tool boundary.
 *
 * Catches domain exceptions thrown by application / infrastructure layers
 * and formats them into actionable MCP text responses that the LLM client
 * can surface to the user.
 *
 * Pattern: fail fast in domain, handle at the interface boundary (per DDD).
 */
import {
  AuthError,
  GraphApiError,
  MailboxNotEnabledError,
  McpError,
  NetworkError,
  PermissionDeniedError,
  ValidationError,
} from "../domain/errors.js"

/** MCP tool response shape — matches the `content` array convention. */
export type ToolErrorResponse = {
  content: Array<{ type: "text"; text: string }>
}

/** Format an AuthError into an MCP response. */
function formatAuthError(): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text: `[AUTH_ERROR] Not authenticated. Please use the start-auth tool first to authenticate with Microsoft.`,
      },
    ],
  }
}

/** Format a MailboxNotEnabledError into an MCP response. */
function formatMailboxError(error: MailboxNotEnabledError): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text:
          `[MAILBOX_NOT_ENABLED] ${error.message}\n\n` +
          `This error occurs with personal Microsoft accounts (Outlook.com, Hotmail, etc.) because ` +
          `the Microsoft To Do API requires a Microsoft 365 mailbox, which personal accounts do not have.\n\n` +
          `To resolve this, try one of the following:\n\n` +
          `1. Sign up for a free Microsoft 365 developer tenant at ` +
          `https://developer.microsoft.com/microsoft-365/dev-program — this gives you a work/school ` +
          `account with full Graph API access, including To Do, at no cost.\n\n` +
          `2. Use an existing work or school Microsoft 365 account instead of your personal account. ` +
          `Re-run start-auth and sign in with your organizational credentials.\n\n` +
          `3. Use the Microsoft To Do web app at https://to-do.microsoft.com or the mobile apps ` +
          `(available on iOS and Android) — these support personal accounts natively.`,
      },
    ],
  }
}

/** Format a PermissionDeniedError into an MCP response. */
function formatPermissionError(error: PermissionDeniedError): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text:
          `[PERMISSION_DENIED] ${error.message}\n\n` +
          `Your account lacks the required Microsoft Graph permissions. ` +
          `An administrator may need to grant consent for the Tasks.ReadWrite scope.`,
      },
    ],
  }
}

/** Format a GraphApiError into an MCP response, including a truncated response body excerpt. */
function formatGraphApiError(error: GraphApiError): ToolErrorResponse {
  let text = `[GRAPH_API_ERROR] ${error.message} (HTTP ${error.status})`
  if (error.responseBody) {
    const excerpt = error.responseBody.length > 300 ? error.responseBody.substring(0, 300) + "…" : error.responseBody
    text += `\n\nResponse: ${excerpt}`
  }
  return { content: [{ type: "text", text }] }
}

/** Format a NetworkError into an MCP response. */
function formatNetworkError(error: NetworkError): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text:
          `[NETWORK_ERROR] ${error.message}\n\n` +
          `Could not reach the Microsoft Graph API. Check your internet connection and try again.`,
      },
    ],
  }
}

/**
 * Convert a caught error into a structured MCP tool response.
 *
 * Discriminates each `McpError` subclass to produce a human-readable
 * message with a machine-readable code prefix.  Unknown errors fall
 * through to a generic catch-all.
 */
export function handleToolError(error: unknown): ToolErrorResponse {
  if (error instanceof AuthError) return formatAuthError()
  if (error instanceof MailboxNotEnabledError) return formatMailboxError(error)
  if (error instanceof PermissionDeniedError) return formatPermissionError(error)
  if (error instanceof GraphApiError) return formatGraphApiError(error)
  if (error instanceof NetworkError) return formatNetworkError(error)
  if (error instanceof ValidationError) {
    return { content: [{ type: "text", text: `[VALIDATION_ERROR] ${error.message}` }] }
  }
  if (error instanceof Error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }] }
  }
  return { content: [{ type: "text", text: `An unexpected error occurred: ${String(error)}` }] }
}
