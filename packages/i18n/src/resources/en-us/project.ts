// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/project.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "cell": {
    "notCell": "{id} is a card, not a table cell.",
    "unknown": "This project has no widget {id}."
  },
  "page": {
    "failed": {
      "title": "This page’s code did not load"
    },
    "missing": {
      "body": "Its code comes from the project folder. Build the project again, or restart Adminium, to load it.",
      "title": "This page is not in the running build"
    }
  },
  "table": {
    "empty": "No records"
  }
} as const;
