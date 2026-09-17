// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/project.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "cell": {
    "notCell": "{id} er et kort, ikke en tabelcelle.",
    "unknown": "Dette projekt har ingen widget {id}."
  },
  "page": {
    "failed": {
      "title": "Koden til denne side blev ikke indlæst"
    },
    "missing": {
      "body": "Dens kode kommer fra projektmappen. Byg projektet igen, eller genstart Adminium, for at indlæse den.",
      "title": "Denne side er ikke med i det kørende build"
    }
  },
  "table": {
    "empty": "Ingen poster"
  }
} as const;
