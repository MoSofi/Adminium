// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "You need to sign in to continue.",
  "SESSION_EXPIRED": "Your session expired. Sign in again to continue.",
  "FORBIDDEN": "You don’t have permission to do that.",
  "PAGE_FORBIDDEN": "You don’t have permission to edit this page.",
  "NOT_FOUND": "That resource doesn’t exist or was removed.",
  "CONFLICT": "That change conflicts with the current state. Refresh and try again.",
  "UNIQUE_VIOLATION": "That value is already in use.",
  "VALIDATION_FAILED": "Some fields need attention before this can be saved.",
  "RATE_LIMITED": "Too many requests — wait a moment and try again.",
  "PAYLOAD_TOO_LARGE": "That request is too large.",
  "META_NOT_CONFIGURED": "No meta store is configured yet.",
  "CONNECTION_FAILED": "Adminium couldn’t reach the database.",
  "INTERNAL": "Something went wrong. Share the request id with support.",
  "OFFLINE": "You appear to be offline. Reconnect to continue.",
  "LLM_JSON_PARSE": "The AI response wasn’t valid JSON.",
  "LLM_TRUNCATED": "The AI response was cut off before it finished.",
  "LLM_VERSION_MISMATCH": "This response was made for an unsupported version. Regenerate the prompt in Settings → AI.",
  "LLM_MODEL_DECLINED": "The AI declined to produce suggestions for this schema.",
  "LLM_SCHEMA_INVALID": "The AI response didn’t match the expected shape.",
  "LLM_LOCALE_KEYS": "A translated value is missing one of the requested languages.",
  "LLM_UNKNOWN_TABLE": "The AI referenced a table that isn’t in this schema; the suggestion was discarded.",
  "LLM_UNKNOWN_COLUMN": "The AI referenced a column that isn’t in this schema; the suggestion was discarded.",
  "LLM_BAD_DISPLAY_COLUMN": "The suggested display column is an id, not a human-readable value.",
  "LLM_NOT_AN_ENUM": "The AI treated a column as a status list when it isn’t one.",
  "LLM_ENUM_VALUES": "The suggested status values don’t match the column’s actual values.",
  "LLM_UNKNOWN_RELATION": "The AI confirmed a relationship that isn’t declared in this schema.",
  "LLM_RELATION_INVALID": "The suggested relationship is invalid or duplicates an existing one.",
  "LLM_UNKNOWN_TEMPLATE": "The AI recommended a page template that isn’t allowed.",
  "LLM_UNKNOWN_WIDGET": "The AI recommended a dashboard widget that isn’t allowed.",
  "LLM_WIDGET_BINDING": "A suggested widget is bound to columns that don’t fit; it was dropped.",
  "LLM_GROUP_INVALID": "A navigation group is invalid — a table appears in more than one group.",
  "LLM_UNKNOWN_ICON": "The suggested icon isn’t available; a default icon was used instead.",
  "LLM_LABEL_COLLISION": "Two suggestions share a name; both would appear under the same title.",
  "LLM_RUN_MISMATCH": "This response looks like it was generated from a different prompt.",
  "POSTING_REFUSED": "This could not be saved: the add-on that keeps its records refused it.",
  "POSTING_REASON": {
    "out-of-stock": "There is not enough of this left.",
    "expired": "This has expired.",
    "needs-batch": "Choose which batch this comes from.",
    "not-valid": "This code is not valid.",
    "inactive": "This is not active yet.",
    "void": "This has been cancelled.",
    "empty": "Nothing is left on this.",
    "used-up": "This has been used up.",
    "over-limit": "This would go over a limit.",
    "needs-customer": "This needs a customer whose address is confirmed.",
    "refund-over": "This is more than was paid this way.",
    "not-allowed": "This is not allowed here.",
    "mapped-changed": "This row still holds something: put it back first, then change it.",
    "receipt-open": "This still holds something: put it back first.",
    "one-at-a-time": "These rows are saved one at a time.",
    "add-on-unavailable": "The add-on this depends on cannot be asked right now, so this cannot be saved.",
    "planner-failed": "The add-on this depends on did not answer as it should, so nothing was saved.",
    "too-large": "This is more than can be saved in one go.",
    "hooked": "Project code changes a table the add-on keeps, so nothing can be recorded there during a save.",
    "guarded": "A table the add-on keeps has a lock of its own, so nothing can be recorded there during a save.",
    "card-pays-card": "This cannot be paid for this way."
  },
  "ADJUST_REFUSED": "This could not be applied to the price.",
  "ADJUST_REASON": {
    "unknown": "No code like this is on offer here.",
    "used-up": "This code has been used as many times as it can be.",
    "needs-minimum": "This code needs a spend of {amount} or more.",
    "not-for-these-items": "This code is not for anything on this order.",
    "needs-sign-in": "This code is for a signed-in customer.",
    "needs-customer": "Name the customer first: this code is kept for one use each.",
    "over-ceiling": "This is more than you may take off. The most is {max}.",
    "expired": "This code has expired.",
    "inactive": "This code is not active.",
    "void": "This code was voided.",
    "not-yet": "This code cannot be used yet.",
    "over-limit": "This customer has used this code as often as it allows.",
    "frozen": "This order’s price stands: it cannot be changed any more.",
    "not-allowed": "You may not change this.",
    "refund-over": "This is more than is left to give back."
  }
} as const;
