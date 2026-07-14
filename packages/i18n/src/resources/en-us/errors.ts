/**
 * GENERATED MIRROR of ../../../locales/en-US/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "You need to sign in to continue.",
  "SESSION_EXPIRED": "Your session expired. Sign in again to continue.",
  "FORBIDDEN": "You don’t have permission to do that.",
  "NOT_FOUND": "That resource doesn’t exist or was removed.",
  "CONFLICT": "That change conflicts with the current state. Refresh and try again.",
  "UNIQUE_VIOLATION": "That value is already in use.",
  "VALIDATION_FAILED": "Some fields need attention before this can be saved.",
  "RATE_LIMITED": "Too many requests — wait a moment and try again.",
  "PAYLOAD_TOO_LARGE": "That request is too large.",
  "META_NOT_CONFIGURED": "No meta store is configured yet.",
  "CONNECTION_FAILED": "Adminium couldn’t reach the database.",
  "INTERNAL": "Something went wrong. Share the request id with support.",
  "OFFLINE": "You appear to be offline. Reconnect to continue."
} as const;
