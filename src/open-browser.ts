import { exec } from "child_process"
import { promisify } from "util"
import { logger } from "./infrastructure/logger.js"

const execAsync = promisify(exec)

/**
 * Open a URL in the system's default browser.
 *
 * Uses platform-specific commands:
 *   - Windows: `start "" "url"`
 *   - macOS:   `open "url"`
 *   - Linux:   `xdg-open "url"`
 *
 * Failures are logged to stderr but not thrown, so the caller can still
 * surface the URL to the user via other means.
 */
export async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`

  try {
    await execAsync(cmd, { timeout: 10_000 })
    logger.info(`Opened ${url} in default browser.`, { source: "open-browser" })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Failed to open browser: ${message}`, { source: "open-browser" })
  }
}
