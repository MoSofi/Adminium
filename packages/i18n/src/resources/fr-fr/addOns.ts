// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "notInstalled": {
    "title": "Ce module n’est pas installé",
    "body": "La page que vous avez ouverte appartient à un module qui n’est pas installé dans cet espace de travail, ou qui a été désactivé. Un administrateur peut l’installer depuis le Studio."
  },
  "unknown": {
    "title": "Page introuvable",
    "body": "Ce module est installé, mais il n’a aucune page à cette adresse."
  },
  "retry": "Réessayer",
  "noBundle": {
    "title": "Cette page n’a pas pu être chargée",
    "body": "Le module annonce cette page mais ne fournit pas le fichier correspondant. Le réinstaller, ou passer à une version plus récente, corrige ce problème."
  },
  "failed": {
    "title": "Cette page n’a pas pu être chargée",
    "body": "Le code du module n’a pas pu être récupéré, ou il ne correspondait pas à l’empreinte enregistrée lors de l’installation. Rien n’en a été exécuté."
  },
  "listFailed": {
    "body": "La liste des modules installés n’a pas pu être lue ; impossible donc de savoir quel fichier cette page doit charger."
  }
} as const;
