/**
 * Tests for the shared tool error handler.
 *
 * Verifies that each McpError subclass produces a correctly formatted
 * MCP text response with the expected code prefix and human-readable
 * message content.
 */
import { describe, it, expect } from "vitest"
import { handleToolError } from "../../src/interface/error-handler.js"
import {
  AuthError,
  GraphApiError,
  MailboxNotEnabledError,
  NetworkError,
  PermissionDeniedError,
  ValidationError,
} from "../../src/domain/errors.js"

describe("handleToolError", () => {
  it("formats AuthError with start-auth guidance", () => {
    const result = handleToolError(new AuthError("Token expired"))
    const text = result.content[0].text

    expect(text).toContain("[AUTH_ERROR]")
    expect(text).toContain("start-auth")
  })

  it("formats MailboxNotEnabledError with personal-account warning", () => {
    const result = handleToolError(new MailboxNotEnabledError("MailboxNotEnabledForRESTAPI"))
    const text = result.content[0].text

    expect(text).toContain("[MAILBOX_NOT_ENABLED]")
    expect(text).toContain("personal")
  })

  it("formats PermissionDeniedError with permission guidance", () => {
    const result = handleToolError(new PermissionDeniedError("Insufficient privileges"))
    const text = result.content[0].text

    expect(text).toContain("[PERMISSION_DENIED]")
  })

  it("formats GraphApiError with HTTP status and response excerpt", () => {
    const result = handleToolError(
      new GraphApiError("Bad request", 400, '{"error":{"message":"invalid filter"}}'),
    )
    const text = result.content[0].text

    expect(text).toContain("[GRAPH_API_ERROR]")
    expect(text).toContain("HTTP 400")
    expect(text).toContain("invalid filter")
  })

  it("formats GraphApiError without response body", () => {
    const result = handleToolError(new GraphApiError("Not found", 404))
    const text = result.content[0].text

    expect(text).toContain("[GRAPH_API_ERROR]")
    expect(text).toContain("HTTP 404")
    expect(text).not.toContain("Response:")
  })

  it("formats NetworkError with connectivity guidance", () => {
    const result = handleToolError(new NetworkError("Connection refused", new Error("ECONNREFUSED")))
    const text = result.content[0].text

    expect(text).toContain("[NETWORK_ERROR]")
    expect(text).toContain("internet connection")
  })

  it("formats ValidationError with validation message", () => {
    const result = handleToolError(new ValidationError("No fields provided for update"))
    const text = result.content[0].text

    expect(text).toContain("[VALIDATION_ERROR]")
    expect(text).toContain("No fields provided")
  })

  it("formats generic Error with message", () => {
    const result = handleToolError(new Error("Something unexpected"))
    const text = result.content[0].text

    expect(text).toContain("Error:")
    expect(text).toContain("Something unexpected")
  })

  it("formats unknown thrown value as string", () => {
    const result = handleToolError("string error")
    const text = result.content[0].text

    expect(text).toContain("An unexpected error occurred")
    expect(text).toContain("string error")
  })

  it("formats null thrown value", () => {
    const result = handleToolError(null)
    const text = result.content[0].text

    expect(text).toContain("An unexpected error occurred")
  })

  it("returns content array with single text entry", () => {
    const result = handleToolError(new AuthError("test"))

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
  })

  it("truncates long Graph API response bodies", () => {
    const longBody = "x".repeat(500)
    const result = handleToolError(new GraphApiError("Error", 500, longBody))
    const text = result.content[0].text

    // Should truncate to ~300 chars + "…"
    const responseSection = text.split("Response: ")[1]
    expect(responseSection.length).toBeLessThan(longBody.length + 5)
    expect(responseSection).toContain("…")
  })
})
