/**
 * Domain error types for the Microsoft To Do MCP server.
 *
 * Provides a typed exception hierarchy that carries structured context
 * (code, message, metadata) so that tool handlers can catch at the
 * boundary and format actionable MCP responses.
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
 */
export class McpError extends Error {
  /** Machine-readable error code for programmatic handling. */
  public readonly code: string

  /** Optional structured metadata for downstream consumers. */
  public readonly context?: Record<string, unknown>

  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "McpError"
    this.code = code
    this.context = context
  }
}
