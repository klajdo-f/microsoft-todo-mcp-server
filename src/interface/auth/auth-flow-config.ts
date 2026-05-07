/**
 * Auth flow configuration — reads AUTH_FLOW from the environment.
 *
 * Centralises the env-only auth flow selection so that CLI startup,
 * tool registration, and future consumers share a single source of truth.
 */

/** Supported authentication flow values. */
export type AuthFlow = "authorization_code" | "device_code"

/**
 * Read the AUTH_FLOW environment variable.
 *
 * Defaults to `"authorization_code"` (existing behaviour) when unset or
 * unrecognised.
 */
export function getAuthFlow(): AuthFlow {
  const value = process.env.AUTH_FLOW
  if (value === "device_code") return "device_code"
  return "authorization_code"
}

/** Convenience predicate — true when AUTH_FLOW is `"device_code"`. */
export function isDeviceCodeFlow(): boolean {
  return getAuthFlow() === "device_code"
}
