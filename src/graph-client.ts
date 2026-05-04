/**
 * Backward-compatible wrapper for the Graph API client.
 *
 * Re-exports the infrastructure-layer functions and constants so that
 * existing consumers continue to work without import changes.
 *
 * New code should import from `./infrastructure/graph-client.js` directly.
 */
export { makeGraphRequest, getAccessToken, MS_GRAPH_BASE, USER_AGENT } from "./infrastructure/graph-client.js"
