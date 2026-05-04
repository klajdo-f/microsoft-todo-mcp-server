/**
 * Backward-compatible wrapper for the token repository.
 *
 * Re-exports the infrastructure-layer `TokenRepository` class and singleton
 * under their original names (`TokenManager` / `tokenManager`) so that
 * existing consumers continue to work without import changes.
 *
 * New code should import from `./infrastructure/token-repository.js` directly.
 */
export { TokenRepository as TokenManager, tokenRepository as tokenManager } from "./infrastructure/token-repository.js"
export type { TokenData, StoredTokenData } from "./infrastructure/token-repository.js"
