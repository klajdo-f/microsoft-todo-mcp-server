/**
 * Authentication helper functions extracted from auth-tools.ts.
 *
 * Pure-ish helpers for personal-account detection, warning text
 * generation, and auth-status formatting.  Kept separate from the
 * MCP tool registrations so they can be tested and reused independently.
 */
import { getAccessToken, MS_GRAPH_BASE } from "../../infrastructure/graph-client.js"
import { logger } from "../../infrastructure/logger.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERSONAL_DOMAINS = ["outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com"]

// ---------------------------------------------------------------------------
// Account-type detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the currently-authenticated user is on a personal
 * Microsoft account (outlook.com, hotmail.com, etc.).
 */
export async function isPersonalMicrosoftAccount(): Promise<boolean> {
  try {
    const token = await getAccessToken()
    if (!token) return false

    const url = `${MS_GRAPH_BASE}/me`
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })

    if (!response.ok) {
      logger.error("Error getting user info", { source: "auth-helpers", status: response.status })
      return false
    }

    const userData = await response.json()
    const email = userData.mail || userData.userPrincipalName || ""
    const domain = email.split("@")[1]?.toLowerCase()

    if (domain && PERSONAL_DOMAINS.some((d) => domain.includes(d))) {
      logger.warn(buildPersonalAccountWarning(email), { source: "auth-helpers", email })
      return true
    }

    return false
  } catch (error) {
    logger.error("Error checking account type", {
      source: "auth-helpers",
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

// ---------------------------------------------------------------------------
// Warning / status text builders
// ---------------------------------------------------------------------------

/**
 * Build the warning string for a personal Microsoft account email.
 */
export function buildPersonalAccountWarning(email: string): string {
  return (
    `Personal Microsoft Account Detected: Your Microsoft account (${email}) appears to be a personal account. ` +
    "Microsoft To Do API access is typically not available for personal accounts " +
    "through the Microsoft Graph API, only for Microsoft 365 business accounts. " +
    "You may encounter the 'MailboxNotEnabledForRESTAPI' error when trying to " +
    "access To Do lists or tasks. This is a limitation of the Microsoft Graph API, " +
    "not an issue with your authentication or this application. " +
    "You can still use Microsoft To Do through the web interface or mobile apps, " +
    "but API access is restricted for personal accounts."
  )
}

/**
 * Build the full auth-status text including expiry, personal-account
 * warnings, and refresh-failure metadata.
 */
export function formatAuthStatusText(tokens: {
  expiresAt: number
  lastRefreshError?: string
  lastRefreshAttempt?: number
}, isPersonal: boolean): string {
  const isExpired = Date.now() > tokens.expiresAt
  const expiryTime = new Date(tokens.expiresAt).toLocaleString()

  let accountMessage = ""
  if (isPersonal) {
    accountMessage =
      "\n\n⚠️ WARNING: You are using a personal Microsoft account. " +
      "Microsoft To Do API access is typically not available for personal accounts " +
      "through the Microsoft Graph API. You may encounter 'MailboxNotEnabledForRESTAPI' errors. " +
      "This is a Microsoft limitation, not an authentication issue."
  }

  let refreshFailureMessage = ""
  if (tokens.lastRefreshError) {
    const attemptTime = tokens.lastRefreshAttempt
      ? new Date(tokens.lastRefreshAttempt).toLocaleString()
      : "unknown time"
    refreshFailureMessage = `\n\n⚠️ Last token refresh failed at ${attemptTime}: ${tokens.lastRefreshError}`
  }

  if (isExpired) {
    return `Authentication expired at ${expiryTime}. Will attempt to refresh when you call any API.${accountMessage}${refreshFailureMessage}`
  }

  return `Authenticated. Token expires at ${expiryTime}.${accountMessage}${refreshFailureMessage}`
}
