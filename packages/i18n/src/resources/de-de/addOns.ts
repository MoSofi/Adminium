// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/addOns.json — do not edit by hand.
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
      "title": "Dieses Add-on ist nicht installiert",
      "body": "Die aufgerufene Seite gehört zu einem Add-on, das in diesem Arbeitsbereich nicht installiert oder abgeschaltet ist. Eine Administratorin oder ein Administrator kann es im Studio installieren."
    },
    "unknown": {
      "title": "Seite nicht vorhanden",
      "body": "Dieses Add-on ist installiert, hat unter dieser Adresse aber keine Seite."
    },
    "retry": "Erneut versuchen",
    "noBundle": {
      "title": "Diese Seite konnte nicht geladen werden",
      "body": "Das Add-on kündigt diese Seite an, liefert die zugehörige Datei aber nicht mit. Eine erneute Installation oder eine neuere Version behebt das."
    },
    "failed": {
      "title": "Diese Seite konnte nicht geladen werden",
      "body": "Der Code des Add-ons konnte nicht geladen werden oder stimmte nicht mit dem bei der Installation erfassten Fingerabdruck überein. Es wurde nichts davon ausgeführt."
    },
    "listFailed": {
      "body": "Die Liste der installierten Add-ons konnte nicht gelesen werden, daher lässt sich nicht bestimmen, welche Datei diese Seite laden soll."
    }
  }
} as const;
