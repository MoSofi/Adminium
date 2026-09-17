// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/project.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "cell": {
    "notCell": "{id} ist eine Karte, keine Tabellenzelle.",
    "unknown": "Dieses Projekt hat kein Widget {id}."
  },
  "page": {
    "failed": {
      "title": "Der Code dieser Seite wurde nicht geladen"
    },
    "missing": {
      "body": "Ihr Code stammt aus dem Projektordner. Bauen Sie das Projekt erneut oder starten Sie Adminium neu, um sie zu laden.",
      "title": "Diese Seite ist nicht im laufenden Build"
    }
  },
  "table": {
    "empty": "Keine Datensätze"
  }
} as const;
