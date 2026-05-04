/**
 * Tests for the structured JSON logger.
 *
 * Verifies: level output, context inclusion, ISO timestamp, LOG_LEVEL filtering,
 * singleton export, circular ref safety, boundary inputs (empty message, Unicode,
 * large message), and invalid LOG_LEVEL fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Logger, logger } from "../../src/infrastructure/logger.js"

describe("Logger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    delete process.env.LOG_LEVEL
  })

  // -------------------------------------------------------------------------
  // Level output
  // -------------------------------------------------------------------------

  it("debug outputs valid JSON with level 'debug'", () => {
    const l = new Logger("debug")
    l.debug("test debug")
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("debug")
    expect(entry.message).toBe("test debug")
  })

  it("info outputs valid JSON with level 'info'", () => {
    const l = new Logger("debug")
    l.info("test info")
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("info")
    expect(entry.message).toBe("test info")
  })

  it("warn outputs valid JSON with level 'warn'", () => {
    const l = new Logger("debug")
    l.warn("test warn")
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("warn")
    expect(entry.message).toBe("test warn")
  })

  it("error outputs valid JSON with level 'error'", () => {
    const l = new Logger("debug")
    l.error("test error")
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("error")
    expect(entry.message).toBe("test error")
  })

  // -------------------------------------------------------------------------
  // Context handling
  // -------------------------------------------------------------------------

  it("includes context when provided", () => {
    const l = new Logger("debug")
    l.info("msg", { source: "test", count: 42 })
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.context).toEqual({ source: "test", count: 42 })
  })

  it("omits context when not provided", () => {
    const l = new Logger("debug")
    l.info("msg")
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry).not.toHaveProperty("context")
  })

  // -------------------------------------------------------------------------
  // Timestamp
  // -------------------------------------------------------------------------

  it("timestamp is a valid ISO 8601 string", () => {
    const l = new Logger("debug")
    l.info("ts test")
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const parsed = new Date(entry.timestamp as string)
    expect(parsed.getTime()).not.toBeNaN()
  })

  // -------------------------------------------------------------------------
  // LOG_LEVEL filtering
  // -------------------------------------------------------------------------

  it("LOG_LEVEL=warn suppresses debug and info but not warn and error", () => {
    const l = new Logger("warn")
    l.debug("suppressed debug")
    l.info("suppressed info")
    l.warn("visible warn")
    l.error("visible error")
    expect(stderrSpy).toHaveBeenCalledTimes(2)
    const warnEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    const errorEntry = JSON.parse(stderrSpy.mock.calls[1][0] as string)
    expect(warnEntry.level).toBe("warn")
    expect(errorEntry.level).toBe("error")
  })

  it("defaults to 'info' when LOG_LEVEL is not set", () => {
    delete process.env.LOG_LEVEL
    const l = new Logger()
    l.debug("should be suppressed")
    l.info("should be visible")
    expect(stderrSpy).toHaveBeenCalledTimes(1)
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("info")
  })

  it("falls back to 'info' when LOG_LEVEL is invalid", () => {
    process.env.LOG_LEVEL = "nonsense"
    const l = new Logger()
    l.debug("should be suppressed")
    l.info("should be visible")
    expect(stderrSpy).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Singleton export
  // -------------------------------------------------------------------------

  it("exports a singleton logger instance", () => {
    expect(logger).toBeInstanceOf(Logger)
  })

  // -------------------------------------------------------------------------
  // Negative tests: boundary / malformed inputs
  // -------------------------------------------------------------------------

  it("handles empty message gracefully", () => {
    const l = new Logger("debug")
    l.info("")
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.message).toBe("")
  })

  it("handles circular context object safely", () => {
    const l = new Logger("debug")
    const circular: Record<string, unknown> = {}
    circular.self = circular
    // Should not throw — safe fallback
    expect(() => l.info("circular test", circular)).not.toThrow()
    // Output should still be produced (stringified safely)
    expect(stderrSpy).toHaveBeenCalledTimes(1)
  })

  it("handles Unicode and newline characters in message", () => {
    const l = new Logger("debug")
    l.info("Hello 🌍\nline2\ttab")
    const raw = stderrSpy.mock.calls[0][0] as string
    const entry = JSON.parse(raw)
    expect(entry.message).toContain("🌍")
    expect(entry.message).toContain("\n")
  })

  it("handles message over 10KB", () => {
    const l = new Logger("debug")
    const longMsg = "x".repeat(11_000)
    l.info(longMsg)
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect((entry.message as string).length).toBe(11_000)
  })

  it("handles empty context object", () => {
    const l = new Logger("debug")
    l.info("msg", {})
    const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(entry.context).toEqual({})
  })
})
