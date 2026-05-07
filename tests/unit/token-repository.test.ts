import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock references — accessible from hoisted vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockLoad,
  mockSave,
  mockCreateMsalClient,
  mockAcquireTokenSilent,
  mockDeserialize,
  mockSerialize,
  mockGetAllAccounts,
} = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockSave: vi.fn(),
  mockCreateMsalClient: vi.fn(),
  mockAcquireTokenSilent: vi.fn(),
  mockDeserialize: vi.fn(),
  mockSerialize: vi.fn(() => '{"mock":"cache"}'),
  mockGetAllAccounts: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks — paths relative to this test file (tests/unit/)
// ---------------------------------------------------------------------------

vi.mock("../../src/infrastructure/cache-persistence.js", () => ({
  MsalCachePersistence: vi.fn(function (this: any) {
    this.load = mockLoad
    this.save = mockSave
  }),
}))

vi.mock("../../src/infrastructure/msal-client.js", () => ({
  get createMsalClient() {
    return mockCreateMsalClient
  },
  DELEGATED_SCOPES: ["offline_access", "openid", "Tasks.Read"],
  MsalConfigError: class MsalConfigError extends Error {
    constructor(missing: string[]) {
      super(`Missing: ${missing.join(", ")}`)
      this.name = "MsalConfigError"
    }
  },
}))

vi.mock("../../src/infrastructure/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Import after mocks
import { TokenRepository } from "../../src/infrastructure/token-repository.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMsalClient(opts: { accounts?: object[]; acquireTokenResult?: object | null; acquireTokenError?: Error }) {
  const accounts = opts.accounts ?? []
  const tokenCache = {
    deserialize: mockDeserialize,
    serialize: mockSerialize,
    getAllAccounts: mockGetAllAccounts.mockReturnValue(accounts),
  }

  const app = {
    getTokenCache: vi.fn(() => tokenCache),
    acquireTokenSilent: opts.acquireTokenError
      ? mockAcquireTokenSilent.mockRejectedValue(opts.acquireTokenError)
      : mockAcquireTokenSilent.mockResolvedValue(opts.acquireTokenResult ?? null),
  }

  mockCreateMsalClient.mockReturnValue({ type: "confidential", app })
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TokenRepository", () => {
  let repo: TokenRepository

  beforeEach(() => {
    vi.resetAllMocks()
    repo = new TokenRepository()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // No cache file → null
  // -----------------------------------------------------------------------
  it("returns null when no cache file exists", async () => {
    mockLoad.mockReturnValue(null)
    setupMsalClient({})

    const result = await repo.getTokens()
    expect(result).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Missing env vars (MsalConfigError) → null
  // -----------------------------------------------------------------------
  it("returns null when MSAL config is missing (MsalConfigError)", async () => {
    mockLoad.mockReturnValue('{"Account":{}}')
    const { MsalConfigError } = await import("../../src/infrastructure/msal-client.js")
    mockCreateMsalClient.mockImplementation(() => {
      throw new MsalConfigError(["CLIENT_ID"])
    })

    const result = await repo.getTokens()
    expect(result).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Cache with accounts + successful silent → tokens
  // -----------------------------------------------------------------------
  it("returns tokens when silent acquisition succeeds", async () => {
    const expiresAt = Date.now() + 3600_000
    mockLoad.mockReturnValue('{"mock":"cache"}')
    setupMsalClient({
      accounts: [{ homeAccountId: "acct1", localAccountId: "local1", username: "user@test.com" }],
      acquireTokenResult: {
        accessToken: "at-123",
        expiresOn: new Date(expiresAt),
      },
    })

    const result = await repo.getTokens()

    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe("at-123")
    expect(result!.expiresAt).toBe(expiresAt)
    expect(mockSave).toHaveBeenCalledWith('{"mock":"cache"}')
  })

  // -----------------------------------------------------------------------
  // Cache with accounts + silent failure → null
  // -----------------------------------------------------------------------
  it("returns null when silent acquisition fails", async () => {
    mockLoad.mockReturnValue('{"mock":"cache"}')
    setupMsalClient({
      accounts: [{ homeAccountId: "acct1", localAccountId: "local1", username: "user@test.com" }],
      acquireTokenError: new Error("interaction_required"),
    })

    const result = await repo.getTokens()
    expect(result).toBeNull()
    // Should not save cache on failure
    expect(mockSave).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Empty accounts → null
  // -----------------------------------------------------------------------
  it("returns null when no accounts in cache", async () => {
    mockLoad.mockReturnValue('{"mock":"cache"}')
    setupMsalClient({ accounts: [] })

    const result = await repo.getTokens()
    expect(result).toBeNull()
    // Should not attempt silent acquisition
    expect(mockAcquireTokenSilent).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Cache deserialization error → null
  // -----------------------------------------------------------------------
  it("returns null when cache deserialization fails", async () => {
    mockLoad.mockReturnValue("corrupt-data")
    setupMsalClient({ accounts: [] })
    mockDeserialize.mockImplementation(() => {
      throw new Error("Failed to deserialize")
    })

    const result = await repo.getTokens()
    expect(result).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Fallback expiresAt when result.expiresOn is undefined
  // -----------------------------------------------------------------------
  it("uses fallback expiresAt when expiresOn is undefined", async () => {
    const beforeCall = Date.now()
    mockLoad.mockReturnValue('{"mock":"cache"}')
    setupMsalClient({
      accounts: [{ homeAccountId: "acct1", localAccountId: "local1", username: "user@test.com" }],
      acquireTokenResult: {
        accessToken: "at-456",
        expiresOn: undefined,
      },
    })

    const result = await repo.getTokens()

    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe("at-456")
    // Should be a reasonable future timestamp (within a few seconds of now + 1h)
    expect(result!.expiresAt).toBeGreaterThanOrEqual(beforeCall)
  })

  // -----------------------------------------------------------------------
  // Null acquireTokenResult → null
  // -----------------------------------------------------------------------
  it("returns null when acquireTokenSilent returns null", async () => {
    mockLoad.mockReturnValue('{"mock":"cache"}')
    setupMsalClient({
      accounts: [{ homeAccountId: "acct1", localAccountId: "local1", username: "user@test.com" }],
      acquireTokenResult: null,
    })

    const result = await repo.getTokens()
    expect(result).toBeNull()
  })
})
