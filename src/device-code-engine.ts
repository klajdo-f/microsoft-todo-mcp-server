/**
 * Device code engine — thin MSAL wrapper for OAuth 2.0 Device Authorization Grant.
 *
 * Uses the unified createMsalClient() factory and MsalCachePersistence.
 * Returns MSAL AuthenticationResult directly; no manual token extraction.
 */
import { AuthenticationResult } from "@azure/msal-node"
import { createMsalClient, DELEGATED_SCOPES } from "./infrastructure/msal-client.js"
import { MsalCachePersistence } from "./infrastructure/cache-persistence.js"
import { logger } from "./infrastructure/logger.js"

export { DELEGATED_SCOPES }

/** Handle returned by `initiateDeviceCodeFlow()`. */
export interface DeviceCodeFlowHandle {
  userCode: string
  verificationUri: string
  message: string
  result: Promise<AuthenticationResult>
}

export class DeviceCodeConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing required device-code environment variable(s): ${missing.join(", ")}`)
    this.name = "DeviceCodeConfigError"
  }
}

export class DeviceCodeExchangeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "DeviceCodeExchangeError"
  }
}

export function createDeviceCodeEngine(options?: { cachePersistence?: MsalCachePersistence }) {
  const missing: string[] = []
  if (!process.env.CLIENT_ID) missing.push("CLIENT_ID")
  if (missing.length > 0) throw new DeviceCodeConfigError(missing)

  const client = createMsalClient()
  if (client.type !== "public") {
    throw new DeviceCodeConfigError(["AUTH_FLOW must be 'device_code' for device code engine"])
  }

  const persistence = options?.cachePersistence ?? new MsalCachePersistence()

  return {
    tenantId: process.env.TENANT_ID || "organizations",
    initiateDeviceCodeFlow(): DeviceCodeFlowHandle {
      let resolveResult: ((value: AuthenticationResult) => void) | null = null
      let rejectResult: ((reason: unknown) => void) | null = null
      const resultPromise = new Promise<AuthenticationResult>((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      })

      const handle: DeviceCodeFlowHandle = {
        userCode: "",
        verificationUri: "",
        message: "",
        result: resultPromise,
      }

      client.app
        .acquireTokenByDeviceCode({
          scopes: [...DELEGATED_SCOPES],
          deviceCodeCallback(response) {
            logger.info("Device code flow initiated", {
              source: "device-code-engine",
              userCodeLength: response.userCode.length,
              verificationUri: response.verificationUri,
            })
            handle.userCode = response.userCode
            handle.verificationUri = response.verificationUri
            handle.message = response.message
          },
        })
        .then((authResult) => {
          if (!authResult) throw new DeviceCodeExchangeError("Device code flow returned null — user may have cancelled")
          // TokenCache.serialize() is synchronous (MEM080)
          persistence.save(client.app.getTokenCache().serialize() as string)
          logger.info("Device code exchange succeeded", { source: "device-code-engine" })
          resolveResult!(authResult)
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          const wrapped = new DeviceCodeExchangeError(`Device code exchange failed: ${message}`, error)
          logger.error("Device code exchange failed", { source: "device-code-engine", errorMessage: message })
          rejectResult!(wrapped)
        })

      return handle
    },
  }
}

export type DeviceCodeEngine = ReturnType<typeof createDeviceCodeEngine>
