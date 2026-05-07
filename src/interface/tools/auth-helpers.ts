/**
 * Authentication helper functions — clean status formatting.
 *
 * Pure helpers for auth-status text generation.
 * No personal-account detection (removed in S03/T02).
 */
import { logger } from "../../infrastructure/logger.js"

// ---------------------------------------------------------------------------
// Status text builder
// ---------------------------------------------------------------------------

/**
 * Build the auth-status text showing expiry information.
 *
 * Accepts only the expiry timestamp and produces clean status text
 * without personal-account warnings or refresh-failure metadata.
 */
export function formatAuthStatusText(tokens: { expiresAt: number }): string {
  const isExpired = Date.now() > tokens.expiresAt
  const expiryTime = new Date(tokens.expiresAt).toLocaleString()

  if (isExpired) {
    return `Authentication expired at ${expiryTime}. Will attempt to refresh when you call any API.`
  }

  return `Authenticated. Token expires at ${expiryTime}.`
}
