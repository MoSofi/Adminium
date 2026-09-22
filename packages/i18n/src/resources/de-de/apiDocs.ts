// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/apiDocs.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "badge": {
    "anon": "Öffentlich lesbar",
    "authenticated": "Anmeldung erforderlich",
    "public": "Öffentlich",
    "service": "Service-Rolle"
  },
  "code": {
    "copied": "Kopiert",
    "copy": "Kopieren",
    "curl": "cURL",
    "js": "JavaScript",
    "languages": "Sprache des Codebeispiels",
    "python": "Python"
  },
  "copyBase": "Basis-URL kopieren",
  "crumb": "API",
  "empty": {
    "body": "Diese Installation hat noch keine Endpunkte veröffentlicht.",
    "title": "Noch keine Endpunkte"
  },
  "ep": {
    "batch": {
      "desc": "Massenweises Einfügen oder Upsert, bis zu 500 Zeilen.",
      "title": "Mehrere {ref} erstellen"
    },
    "create": {
      "desc": "Eine Zeile einfügen. Gibt den erstellten Datensatz zurück.",
      "title": "{article, select, other {}}{singular} erstellen"
    },
    "delete": {
      "desc": "Die Zeile mit diesem Primärschlüssel entfernen.",
      "title": "{article, select, other {}}{singular} löschen"
    },
    "list": {
      "desc": "Eine gefilterte, sortierte und seitenweise Menge von Zeilen zurückgeben.",
      "title": "{ref} auflisten"
    },
    "one": {
      "desc": "Eine einzelne Zeile per Primärschlüssel abrufen.",
      "title": "{article, select, other {}}{singular} abrufen"
    },
    "replace": {
      "desc": "Eine ganze Zeile per Primärschlüssel ersetzen.",
      "title": "{article, select, other {}}{singular} ersetzen"
    },
    "rowWord": "Zeile",
    "update": {
      "desc": "Spalten der Zeile mit diesem Primärschlüssel teilweise aktualisieren.",
      "title": "{article, select, other {}}{singular} aktualisieren"
    }
  },
  "meta": "{endpoints, plural, one {# Endpunkt} other {# Endpunkte}} · Limit {limit}, Sortierung {order}",
  "pg": {
    "auth": "Autorisierung",
    "authHelper": "Ein Browser-Schlüssel. Er bleibt nur in diesem Tab und ist nach dem Neuladen verschwunden.",
    "authPlaceholder": "Schlüssel einfügen",
    "body": "Anfragetext",
    "needKey": "Fügen Sie zuerst einen Schlüssel ein",
    "send": "Anfrage senden",
    "sending": "Wird gesendet…",
    "title": "Testkonsole"
  },
  "rail": {
    "empty": "Nichts entspricht diesem Filter.",
    "filter": "Tabellen filtern…",
    "heading": "Ressourcen",
    "reference": "API-Referenz"
  },
  "res": {
    "idle": "Senden Sie eine Anfrage, um die Antwort zu sehen.",
    "ms": "{ms} ms",
    "network": "Die Anfrage hat den Server nicht erreicht.",
    "noBody": "204 No Content — Zeile gelöscht",
    "title": "Antwort"
  },
  "schema": {
    "body": "Schema des Anfragetexts",
    "response": "Spalten der Antwort"
  },
  "status": {
    "live": "API aktiv",
    "off": "Deaktiviert"
  },
  "tag": {
    "fk": "FK",
    "pk": "PK",
    "unique": "UNIQUE"
  }
} as const;
