// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "toast": {
    "restored": "{name} wurde wiederhergestellt",
    "restoreFailed": "Diese Datei konnte nicht wiederhergestellt werden",
    "trashed": "{name} wurde in den Papierkorb verschoben",
    "trashFailed": "Diese Datei konnte nicht in den Papierkorb verschoben werden"
  },
  "title": "Dateien",
  "subtitle": "Jede Datei in diesem Arbeitsbereich: die an Datensätzen und die in der Bibliothek. Und wo jede liegt.",
  "search": "Nach Dateiname suchen",
  "trash": {
    "notice": {
      "title": "Der Papierkorb leert sich selbst",
      "body": "Eine Datei im Papierkorb wird mitsamt ihren Daten entfernt, sobald der Aufbewahrungszeitraum dieses Servers abgelaufen ist. Stellen Sie vorher wieder her, was Sie noch brauchen."
    }
  },
  "listFailed": {
    "title": "Diese Dateien konnten nicht geladen werden"
  },
  "empty": {
    "filtered": {
      "title": "Nichts gefunden",
      "body": "Leeren Sie die Suche oder wählen Sie einen anderen Schnellzugriff aus der Leiste."
    },
    "title": "Noch keine Dateien",
    "body": "Dateien landen hier, wenn jemand eine zu einem Datensatz hinzufügt oder ein Dateifeld ausfüllt.",
    "library": "Hier wurde noch nichts hochgeladen."
  },
  "loadMore": "Weitere Dateien laden",
  "usage": {
    "label": "Belegter Speicher",
    "used": "{size} belegt",
    "count": "{count, plural, one {# Datei} other {# Dateien}}",
    "diskLabel": "Belegter Speicher",
    "ofDisk": "{used} von {size} auf diesem Datenträger"
  },
  "rail": {
    "label": "Datei-Schnellzugriffe",
    "byTable": "Nach Tabelle",
    "byDestination": "Nach Speicherziel",
    "byConnection": "Nach Verbindung"
  },
  "preset": {
    "all": "Alle Dateien",
    "unattached": "Noch nicht verwendet",
    "trash": "Papierkorb",
    "recent": "Zuletzt",
    "unattachedHelp": "Hochgeladene Dateien, die kein Datensatz übernommen hat. Sie kommen nach {hours} Stunden in den Papierkorb.",
    "library": "Hier hochgeladen"
  },
  "column": {
    "name": "Datei",
    "size": "Größe",
    "attachedTo": "Am Datensatz",
    "destination": "Speicherziel",
    "added": "Hinzugefügt",
    "actions": "Aktionen"
  },
  "row": {
    "unattached": "Noch nicht verwendet",
    "localDestination": "Die Festplatte dieses Servers",
    "noRecord": "An keinem Datensatz",
    "uploadedHere": "Hier hochgeladen"
  },
  "action": {
    "restore": "Wiederherstellen",
    "download": "Herunterladen",
    "deleteNamed": "{name} löschen",
    "delete": "Löschen"
  },
  "drawer": {
    "none": "Keine",
    "subtitle": "{size} · {type}",
    "destination": "Speicherziel",
    "attachedTo": "Am Datensatz",
    "uploadedBy": "Hochgeladen von",
    "added": "Hinzugefügt",
    "attachedAt": "In Verwendung seit",
    "trashedAt": "In den Papierkorb verschoben",
    "id": "Datei-ID",
    "checksum": "Prüfsumme",
    "previewTitle": "Vorschau von {name}",
    "previewNone": "Für diese Art von Datei gibt es keine Vorschau.",
    "previewTrashed": "Eine Datei im Papierkorb kann nicht angezeigt werden.",
    "previewFailed": "Diese Datei kann hier nicht angezeigt werden. Laden Sie sie herunter, um sie zu öffnen.",
    "previewTruncated": "Die ersten {size} werden angezeigt."
  },
  "view": {
    "label": "Wie Dateien angezeigt werden",
    "grid": "Kacheln",
    "list": "Liste"
  },
  "upload": {
    "open": "Hochladen",
    "title": "Dateien hochladen",
    "subtitle": "Fügen Sie diesem Arbeitsbereich Dateien hinzu.",
    "connection": "Zu welcher Verbindung sie gehören",
    "drop": "Dateien hierher ziehen",
    "browse": "Auf Ihrem Computer suchen",
    "sending": "Wird hochgeladen",
    "cancelOne": "{name} abbrechen",
    "removeOne": "{name} entfernen",
    "complete": "Hochladen abgeschlossen",
    "completeBody": "Diese Dateien sind jetzt in der Bibliothek. Fügen Sie eine über „Vorhandenes wählen…“ im Feld eines Datensatzes hinzu. Der Datensatz erhält eine eigene Kopie.",
    "send": "{count, plural, one {# Datei hochladen} other {# Dateien hochladen}}",
    "done": "Fertig",
    "failed": "Fehlgeschlagen",
    "cancelled": "Abgebrochen"
  }
} as const;
