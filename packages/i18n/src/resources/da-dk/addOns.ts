// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/addOns.json — do not edit by hand.
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
      "title": "Dette add-on er ikke installeret",
      "body": "Siden, du fulgte, hører til et add-on, som ikke er installeret i dette arbejdsområde, eller som er slået fra. En administrator kan installere det i Studio."
    },
    "unknown": {
      "title": "Siden findes ikke",
      "body": "Dette add-on er installeret, men det har ingen side på denne adresse."
    },
    "retry": "Prøv igen",
    "noBundle": {
      "title": "Siden kunne ikke indlæses",
      "body": "Add-on'et annoncerer denne side, men leverer ikke den fil, den peger på. En geninstallation eller en nyere version løser det."
    },
    "failed": {
      "title": "Siden kunne ikke indlæses",
      "body": "Add-on'ets kode kunne ikke hentes, eller den svarede ikke til det fingeraftryk, der blev registreret ved installationen. Intet af den er blevet kørt."
    },
    "listFailed": {
      "body": "Listen over installerede add-ons kunne ikke læses, så det kan ikke afgøres, hvilken fil denne side skal indlæse."
    }
  }
} as const;
