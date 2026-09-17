// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/project.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "cell": {
    "notCell": "{id} est une carte, pas une cellule de tableau.",
    "unknown": "Ce projet n’a pas de widget {id}."
  },
  "page": {
    "failed": {
      "title": "Le code de cette page ne s’est pas chargé"
    },
    "missing": {
      "body": "Son code vient du dossier du projet. Reconstruisez le projet, ou redémarrez Adminium, pour la charger.",
      "title": "Cette page n’est pas dans le build en cours"
    }
  },
  "table": {
    "empty": "Aucun enregistrement"
  }
} as const;
