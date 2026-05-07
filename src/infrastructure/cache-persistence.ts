import { existsSync, readFileSync, writeFileSync } from "fs"
import { getTokenFilePath } from "./paths.js"
import { ensureConfigDir } from "./paths.js"
import { logger } from "./logger.js"

/**
 * Synchronous persistence wrapper for the MSAL serialized token cache.
 *
 * Reads from and writes to the platform-specific token file path returned by
 * `getTokenFilePath()`. All I/O errors are caught, logged via the structured
 * logger, and gracefully handled — callers never see thrown exceptions.
 */
export class MsalCachePersistence {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? getTokenFilePath()
  }

  /**
   * Load the serialized cache from disk.
   * @returns The serialized cache string, or `null` when the file is absent or
   *          a read error occurs.
   */
  load(): string | null {
    try {
      if (!existsSync(this.filePath)) {
        return null
      }
      return readFileSync(this.filePath, "utf-8")
    } catch (error) {
      logger.error("Failed to read MSAL cache from disk", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Persist the serialized cache to disk.
   * Ensures the config directory exists before writing.
   * I/O errors are logged but not re-thrown.
   */
  save(serialized: string): void {
    try {
      ensureConfigDir()
      writeFileSync(this.filePath, serialized, "utf-8")
    } catch (error) {
      logger.error("Failed to write MSAL cache to disk", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
