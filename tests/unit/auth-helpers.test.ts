import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock logger before importing the module under test
vi.mock("../../src/infrastructure/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { formatAuthStatusText } from "../../src/interface/tools/auth-helpers.js"

describe("formatAuthStatusText", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"))
  })

  it("returns authenticated text when token is not expired", () => {
    const expiresAt = new Date("2025-01-15T13:00:00Z").getTime()
    const result = formatAuthStatusText({ expiresAt })

    expect(result).toContain("Authenticated.")
    expect(result).toContain("expires at")
    expect(result).not.toContain("expired")
  })

  it("returns expired text when token is expired", () => {
    const expiresAt = new Date("2025-01-15T11:00:00Z").getTime()
    const result = formatAuthStatusText({ expiresAt })

    expect(result).toContain("expired at")
    expect(result).toContain("attempt to refresh")
    expect(result).not.toContain("Authenticated.")
  })

  it("does not contain personal account warnings", () => {
    const expiresAt = new Date("2025-01-15T13:00:00Z").getTime()
    const result = formatAuthStatusText({ expiresAt })

    expect(result).not.toContain("WARNING")
    expect(result).not.toContain("personal")
  })

  it("does not contain refresh failure messages", () => {
    const expiresAt = new Date("2025-01-15T13:00:00Z").getTime()
    const result = formatAuthStatusText({ expiresAt })

    expect(result).not.toContain("refresh failed")
    expect(result).not.toContain("lastRefreshError")
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
