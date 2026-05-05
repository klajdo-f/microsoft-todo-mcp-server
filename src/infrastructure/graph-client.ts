/**
 * Graph API client — infrastructure-layer HTTP communication with Microsoft Graph.
 *
 * Provides `makeGraphRequest` (typed exceptions on failure, automatic 401 retry)
 * and `getAccessToken` (delegates to the token repository).
 *
 * Failure-mode contract:
 *   - Authentication failure (missing tokens, refresh failure) → `AuthError`
 *   - 401 after retry → `AuthError`
 *   - 403 → `PermissionDeniedError`
 *   - MailboxNotEnabledForRESTAPI → `MailboxNotEnabledError`
 *   - Other non-ok HTTP → `GraphApiError` (carries status + body)
 *   - Network / fetch failure → `NetworkError`
 *   - 204 No Content → returns `null` (no JSON parsing attempted)
 */
import { tokenManager } from "../token-manager.js"
import { logger } from "./logger.js"
import {
  AuthError,
  GraphApiError,
  MailboxNotEnabledError,
  McpError,
  NetworkError,
  PermissionDeniedError,
} from "../domain/errors.js"

// Microsoft Graph API endpoints
export const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
export const USER_AGENT = "microsoft-todo-mcp-server/1.0"

/** Build standard Graph API request headers with bearer token. */
function buildGraphRequestHeaders(token: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

/** Build RequestInit, attaching JSON body for POST/PATCH methods. */
function buildRequestInit(method: string, headers: Record<string, string>, body?: unknown): RequestInit {
  const options: RequestInit = { method, headers }
  if (body && (method === "POST" || method === "PATCH")) {
    options.body = JSON.stringify(body)
  }
  return options
}

/** Log request details with redacted auth header for debugging. */
function logRequest(url: string, method: string, headers: Record<string, string>): void {
  logger.debug(`Making request to: ${url}`, { source: "graph-client", method })
  logger.debug(
    `Request options: ${JSON.stringify({ method, headers: { ...headers, Authorization: "Bearer [REDACTED]" } })}`,
    { source: "graph-client" },
  )
}

/**
 * Execute a fetch, retrying once with a refreshed token on 401.
 *
 * Returns the final Response (which may still be non-ok).
 */
async function fetchWithRetryOn401(
  url: string,
  options: RequestInit,
  headers: Record<string, string>,
  token: string,
): Promise<Response> {
  let response = await fetch(url, options)

  if (response.status === 401) {
    logger.info("Got 401, attempting token refresh...", { source: "graph-client" })
    const newToken = await getAccessToken()
    if (newToken !== token) {
      headers.Authorization = `Bearer ${newToken}`
      response = await fetch(url, { ...options, headers })
    }
  }

  return response
}

/**
 * Classify a non-ok Graph API response into a typed domain exception.
 *
 * Inspects status code and response body to throw the most specific
 * McpError subclass.  Always throws — return type is `never`.
 */
function classifyGraphError(status: number, errorText: string): never {
  if (errorText.includes("MailboxNotEnabledForRESTAPI")) {
    logger.warn("MailboxNotEnabledForRESTAPI detected for personal account", { source: "graph-client", status })
    throw new MailboxNotEnabledError(
      "Microsoft To Do API is not available for personal Microsoft accounts. " +
        "Only Microsoft 365 business accounts have API access.",
      { status },
    )
  }
  if (status === 401) {
    throw new AuthError("Authentication failed after token refresh. Please re-authenticate.", { status })
  }
  if (status === 403) {
    throw new PermissionDeniedError("Insufficient permissions for this operation. Check required scopes.", {
      status,
      body: errorText,
    })
  }
  throw new GraphApiError(`Graph API error: ${status}`, status, errorText)
}

/**
 * Parse a successful Graph API response body.
 *
 * Returns `null` for 204 No Content or empty bodies; otherwise parses
 * JSON text and returns the typed result.
 */
async function parseResponseBody<T>(response: Response): Promise<T | null> {
  if (response.status === 204) {
    logger.debug("Received 204 No Content — returning null", { source: "graph-client" })
    return null as T
  }

  const text = await response.text()
  if (!text || text.trim().length === 0) {
    logger.debug("Empty response body — returning null", { source: "graph-client" })
    return null as T
  }

  const data = JSON.parse(text)
  logger.debug(`Response received: ${JSON.stringify(data).substring(0, 200)}...`, { source: "graph-client" })
  return data as T
}

/**
 * Make an authenticated request to the Microsoft Graph API.
 *
 * On 401, automatically attempts a token refresh via `getAccessToken()`
 * and retries once with the new token.  Throws typed domain exceptions
 * on failure; returns `null` for 204 No Content responses.
 */
export async function makeGraphRequest<T>(
  url: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<T | null> {
  const headers = buildGraphRequestHeaders(token)

  try {
    const options = buildRequestInit(method, headers, body)
    logRequest(url, method, headers)
    const response = await fetchWithRetryOn401(url, options, headers, token)

    if (!response.ok) {
      const errorText = await response.text()
      logger.warn(`HTTP error! status: ${response.status}, body: ${errorText}`, {
        source: "graph-client",
        status: response.status,
      })
      classifyGraphError(response.status, errorText)
    }

    return parseResponseBody<T>(response)
  } catch (error) {
    if (error instanceof McpError) throw error
    logger.error("Network/transport error in Graph API request:", {
      source: "graph-client",
      error: error instanceof Error ? error.message : String(error),
    })
    throw new NetworkError(
      `Network error during Graph API request: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined,
    )
  }
}

/**
 * Authentication helper — delegates to the token manager for token retrieval.
 *
 * Throws `AuthError` when no valid tokens are available or when the token
 * manager itself fails.  Callers should catch `AuthError` to prompt
 * re-authentication.
 */
export async function getAccessToken(): Promise<string> {
  logger.debug("getAccessToken called", { source: "graph-client" })

  try {
    const tokens = await tokenManager.getTokens()

    if (tokens) {
      logger.debug("Successfully retrieved valid token", { source: "graph-client" })
      return tokens.accessToken
    }

    throw new AuthError("No valid tokens available. Please authenticate using the start-auth tool.")
  } catch (error) {
    // Rethrow already-typed AuthError
    if (error instanceof AuthError) {
      throw error
    }

    throw new AuthError(`Failed to retrieve access token: ${error instanceof Error ? error.message : String(error)}`)
  }
}
