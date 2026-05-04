import { describe, it, expect } from "vitest"
import {
  McpError,
  AuthError,
  GraphApiError,
  PermissionDeniedError,
  MailboxNotEnabledError,
  NetworkError,
  ValidationError,
} from "../../src/domain/errors.js"

describe("McpError hierarchy", () => {
  it("base McpError carries code, message, and optional context", () => {
    const err = new McpError("base message", "BASE_CODE", { key: "value" })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(McpError)
    expect(err.message).toBe("base message")
    expect(err.code).toBe("BASE_CODE")
    expect(err.context).toEqual({ key: "value" })
    expect(err.name).toBe("McpError")
  })

  it("McpError context is optional", () => {
    const err = new McpError("msg", "CODE")
    expect(err.context).toBeUndefined()
  })
})

describe("AuthError", () => {
  it("is instanceof McpError", () => {
    const err = new AuthError("token expired")
    expect(err).toBeInstanceOf(McpError)
    expect(err).toBeInstanceOf(AuthError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("AUTH_ERROR")
    expect(err.name).toBe("AuthError")
    expect(err.message).toBe("token expired")
  })
})

describe("GraphApiError", () => {
  it("is instanceof McpError and carries status + responseBody", () => {
    const err = new GraphApiError("bad request", 400, '{"error":"invalid"}')
    expect(err).toBeInstanceOf(McpError)
    expect(err).toBeInstanceOf(GraphApiError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("GRAPH_API_ERROR")
    expect(err.name).toBe("GraphApiError")
    expect(err.status).toBe(400)
    expect(err.responseBody).toBe('{"error":"invalid"}')
  })

  it("responseBody is optional", () => {
    const err = new GraphApiError("server error", 500)
    expect(err.responseBody).toBeUndefined()
  })

  it("includes status in context", () => {
    const err = new GraphApiError("forbidden", 403)
    expect(err.context?.status).toBe(403)
  })
})

describe("PermissionDeniedError", () => {
  it("is instanceof McpError", () => {
    const err = new PermissionDeniedError("insufficient scopes")
    expect(err).toBeInstanceOf(McpError)
    expect(err).toBeInstanceOf(PermissionDeniedError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("PERMISSION_DENIED")
    expect(err.name).toBe("PermissionDeniedError")
  })
})

describe("MailboxNotEnabledError", () => {
  it("is instanceof McpError", () => {
    const err = new MailboxNotEnabledError("personal account limitation")
    expect(err).toBeInstanceOf(McpError)
    expect(err).toBeInstanceOf(MailboxNotEnabledError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("MAILBOX_NOT_ENABLED")
    expect(err.name).toBe("MailboxNotEnabledError")
  })
})

describe("NetworkError", () => {
  it("is instanceof McpError and preserves cause message in context", () => {
    const cause = new Error("ECONNREFUSED")
    const err = new NetworkError("connection failed", cause)
    expect(err).toBeInstanceOf(McpError)
    expect(err).toBeInstanceOf(NetworkError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("NETWORK_ERROR")
    expect(err.name).toBe("NetworkError")
    expect(err.context?.cause).toBe("ECONNREFUSED")
  })

  it("works without a cause", () => {
    const err = new NetworkError("timeout")
    expect(err.context?.cause).toBeUndefined()
  })
})

describe("ValidationError", () => {
  it("is instanceof McpError", () => {
    const err = new ValidationError("invalid task id")
    expect(err).toBeInstanceOf(McpError)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("VALIDATION_ERROR")
    expect(err.name).toBe("ValidationError")
  })
})

describe("subclass discrimination", () => {
  const errors = [
    new AuthError("a"),
    new GraphApiError("g", 500),
    new PermissionDeniedError("p"),
    new MailboxNotEnabledError("m"),
    new NetworkError("n"),
    new ValidationError("v"),
  ]

  it.each(errors)("all subclasses pass instanceof McpError: %s.name", (err) => {
    expect(err).toBeInstanceOf(McpError)
  })

  it("catch(McpError) catches every subclass", () => {
    for (const err of errors) {
      try {
        throw err
      } catch (caught) {
        expect(caught).toBeInstanceOf(McpError)
      }
    }
  })

  it("each subclass has a unique error code", () => {
    const codes = errors.map((e) => e.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
