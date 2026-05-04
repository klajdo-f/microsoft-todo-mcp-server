import { exec } from "child_process"
import { promisify } from "util"

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
    console.error(`[open-browser] Opened ${url} in default browser.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[open-browser] Failed to open browser: ${message}`)
  }
}
