/**
 * Domain error types for the Microsoft To Do MCP server.
 *
 * Provides a typed exception hierarchy that carries structured context
 * (code, message, metadata) so that tool handlers can catch at the
 * boundary and format actionable MCP responses.
 *
 * Hierarchy:
 *   McpError                 — base: code + optional context
 *     ├── AuthError          — authentication / token failures
 *     ├── GraphApiError      — Microsoft Graph API errors (carries HTTP status + body)
 *     ├── PermissionDeniedError — insufficient scopes / access
 *     ├── MailboxNotEnabledError — personal-account mailbox limitation
 *     ├── NetworkError       — connectivity / DNS / timeout issues
 *     └── ValidationError    — input schema or business-rule violations
 *
 * Pattern: fail fast in domain / application layers, handle at the
 * interface boundary (per DDD convention).
 */

/**
 * Base class for all MCP server domain errors.
 *
 * Subclasses add domain-specific context (HTTP status, API error codes,
 * permission details, etc.) while this base guarantees every error
 * carries a machine-readable `code` and optional structured `context`.
 *
 * Every subclass preserves `instanceof McpError` so that boundary
 * handlers can catch all domain errors uniformly or narrow to a
 * specific subtype.
 */
export class McpError extends Error {
  /** Machine-readable error code for programmatic handling. */
  public readonly code: string

  /** Optional structured metadata for downstream consumers. */
  public readonly context?: Record<string, unknown>

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message)
    this.name = "McpError"
    this.code = code
    this.context = context
  }
}

/**
 * Thrown when authentication fails — expired tokens, invalid credentials,
 * or the user has not completed the OAuth flow.
 *
 * Code: `AUTH_ERROR`
 */
export class AuthError extends McpError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "AUTH_ERROR", context)
    this.name = "AuthError"
  }
}

/**
 * Thrown when the Microsoft Graph API returns a non-success response.
 *
 * Carries the HTTP `status` code and optional raw `responseBody` so
 * that boundary handlers can surface actionable diagnostics.
 *
 * Code: `GRAPH_API_ERROR`
 */
export class GraphApiError extends McpError {
  /** HTTP status code from the Graph API response. */
  public readonly status: number

  /** Raw response body from the Graph API (may contain OData error details). */
  public readonly responseBody?: string

  constructor(message: string, status: number, responseBody?: string, context?: Record<string, unknown>) {
    super(message, "GRAPH_API_ERROR", { ...context, status })
    this.name = "GraphApiError"
    this.status = status
    this.responseBody = responseBody
  }
}

/**
 * Thrown when the authenticated user lacks the required Microsoft Graph
 * permissions / scopes for the requested operation.
 *
 * Code: `PERMISSION_DENIED`
 */
export class PermissionDeniedError extends McpError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "PERMISSION_DENIED", context)
    this.name = "PermissionDeniedError"
  }
}

/**
 * Thrown when a personal Microsoft account hits the
 * MailboxNotEnabledForRESTAPI limitation — common for consumer accounts
 * that lack Exchange Online mailboxes.
 *
 * Code: `MAILBOX_NOT_ENABLED`
 */
export class MailboxNotEnabledError extends McpError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "MAILBOX_NOT_ENABLED", context)
    this.name = "MailboxNotEnabledError"
  }
}

/**
 * Thrown when a network-level failure occurs — DNS resolution, connection
 * refused, socket timeout, or TLS errors. The original error cause is
 * preserved in `context.cause` for downstream diagnostics.
 *
 * Code: `NETWORK_ERROR`
 */
export class NetworkError extends McpError {
  constructor(message: string, cause?: Error, context?: Record<string, unknown>) {
    super(message, "NETWORK_ERROR", {
      ...context,
      ...(cause ? { cause: cause.message } : {}),
    })
    this.name = "NetworkError"
  }
}

/**
 * Thrown when input validation fails — schema violations, out-of-range
 * values, or business-rule constraints.
 *
 * Code: `VALIDATION_ERROR`
 */
export class ValidationError extends McpError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", context)
    this.name = "ValidationError"
  }
}
