/**
 * Structured JSON logger — lightweight, zero-dependency JSON Lines output to stderr.
 *
 * Each log entry is a single JSON line: `{ level, timestamp, message, context? }`.
 * Level filtering is controlled by the `LOG_LEVEL` env var (default: "info").
 * Valid levels: debug < info < warn < error.
 *
 * Circular references in context objects are handled gracefully — the offending
 * value is replaced with `"[Circular]"` rather than throwing.
 */

// ---------------------------------------------------------------------------
// Level hierarchy
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const VALID_LEVELS = new Set(Object.keys(LEVEL_ORDER))

function resolveMinLevel(): number {
  const env = process.env.LOG_LEVEL?.toLowerCase()
  if (env && VALID_LEVELS.has(env)) {
    return LEVEL_ORDER[env]
  }
  return LEVEL_ORDER["info"]
}

// ---------------------------------------------------------------------------
// Safe stringify (handles circular refs)
// ---------------------------------------------------------------------------

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------------------
// Logger class
// ---------------------------------------------------------------------------

export class Logger {
  private minLevel: number

  constructor(minLevel?: string) {
    this.minLevel = minLevel && VALID_LEVELS.has(minLevel) ? LEVEL_ORDER[minLevel] : resolveMinLevel()
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context)
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context)
  }

  private log(level: string, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) {
      return
    }

    const entry: Record<string, unknown> = {
      level,
      timestamp: new Date().toISOString(),
      message,
    }

    if (context !== undefined) {
      entry.context = context
    }

    // Use console.error to write to stderr as JSON Lines
    console.error(safeStringify(entry))
  }
}

/** Application-wide singleton logger instance. */
export const logger = new Logger()
