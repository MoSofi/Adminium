// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "page": {
    "notInstalled": {
      "title": "This add-on is not installed",
      "body": "The page you followed belongs to an add-on this workspace does not have installed, or that has been switched off. An administrator can install it from Studio."
    },
    "unknown": {
      "title": "No such page",
      "body": "This add-on is installed, but it does not have a page at this address."
    },
    "retry": "Try again",
    "noBundle": {
      "title": "This page could not be loaded",
      "body": "The add-on declares this page but does not ship the file it points at. Installing it again, or upgrading it, is what fixes this."
    },
    "failed": {
      "title": "This page could not be loaded",
      "body": "The add-on’s code could not be fetched, or it did not match the fingerprint recorded when it was installed. Nothing from it has been run."
    },
    "listFailed": {
      "body": "The list of installed add-ons could not be read, so there is no way to tell which file this page should load."
    }
  }
} as const;
