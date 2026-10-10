// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/desktop.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "new": {
    "back": "Zurück",
    "change": "Ändern…",
    "create": "Erstellen",
    "creating": "Wird vorbereitet…",
    "failed": "Das Projekt konnte nicht angelegt werden.",
    "heading": "Eine App bauen",
    "help": "Adminium legt diesen Ordner für Sie an. Alles zu Ihrer App liegt darin.",
    "name": "Name",
    "refuse": {
      "badName": "Verwenden Sie mindestens einen Buchstaben oder eine Ziffer im Namen.",
      "existsWithFiles": "Ein Ordner mit diesem Namen ist schon vorhanden und enthält Dateien. Wählen Sie einen anderen Namen oder einen anderen Ordner.",
      "homeFolder": "Ein Projekt kann nicht direkt in Ihrem Benutzerordner liegen. Wählen oder erstellen Sie einen Ordner darin.",
      "insideAProject": "Dieser Ordner liegt in einem anderen Projekt. Wählen Sie einen Ordner außerhalb davon.",
      "insideTheApp": "Ein Projekt kann nicht in Adminium selbst liegen. Wählen Sie einen anderen Ordner.",
      "notAbsolute": "Wählen Sie einen Ordner mit der Schaltfläche „Ändern…“.",
      "systemFolder": "Ein Projekt kann nicht in einem Ordner liegen, der dem System gehört. Wählen Sie einen eigenen Ordner."
    },
    "warn": {
      "another": "Anderen Ordner wählen",
      "anyway": "Trotzdem verwenden",
      "dropbox": "Dieser Ordner wird von Dropbox synchronisiert. Projekte funktionieren in synchronisierten Ordnern schlecht: Die Synchronisierung kann ihre Daten beschädigen.",
      "googledrive": "Dieser Ordner wird von Google Drive synchronisiert. Projekte funktionieren in synchronisierten Ordnern schlecht: Die Synchronisierung kann ihre Daten beschädigen.",
      "icloud": "Dieser Ordner wird von iCloud Drive synchronisiert. Projekte funktionieren in synchronisierten Ordnern schlecht: Die Synchronisierung kann ihre Daten beschädigen.",
      "noLinks": "Dieser Datenträger kann die Verknüpfungen nicht speichern, die die Pakete eines Projekts brauchen. Das Laden der Pakete schlägt daher wahrscheinlich fehl.",
      "onedrive": "Dieser Ordner wird von OneDrive synchronisiert. Projekte funktionieren in synchronisierten Ordnern schlecht: Die Synchronisierung kann ihre Daten beschädigen."
    },
    "where": "Speicherort"
  },
  "start": {
    "choice": {
      "build": {
        "line": "Beschreiben Sie sie, und der Designer baut sie auf diesem Computer.",
        "title": "Eine App bauen"
      },
      "connect": {
        "line": "Ein Adminium nutzen, das auf einem anderen Computer läuft.",
        "title": "Mit einem anderen Adminium verbinden"
      },
      "db": {
        "line": "Oberflächen für eine Datenbank erstellen, die Sie schon haben.",
        "title": "Eigene Datenbank verwenden"
      },
      "open": {
        "line": "Mit einer App weitermachen, die schon in einem Ordner liegt oder die Ihnen jemand geschickt hat.",
        "title": "Einen Ordner öffnen"
      }
    },
    "heading": "Was möchten Sie tun?",
    "open": {
      "needsPackages": "Die Pakete dieses Projekts sind noch nicht auf diesem Computer.",
      "notAProject": "Dieser Ordner ist kein Adminium-Projekt."
    },
    "recent": {
      "alreadyListed": "Dieser Ordner steht schon in der Liste.",
      "building": "Im Bau",
      "gone": "Dieser Ordner wurde verschoben oder gelöscht",
      "heading": "Zuletzt verwendete Projekte",
      "locate": "Suchen…",
      "locateTitle": "Wo liegt {name} jetzt?",
      "notThatProject": "Dieser Ordner ist kein Adminium-Projekt.",
      "open": "{name} öffnen",
      "opened": "Geöffnet: {when}",
      "remove": "Entfernen",
      "removed": "Aus den zuletzt verwendeten Projekten entfernt",
      "shared": "Geteilt"
    },
    "welcome": "Willkommen bei Adminium."
  },
  "toast": {
    "dismiss": "Schließen",
    "region": "Hinweise"
  },
  "trust": {
    "body": "Beim Öffnen wird sein Code auf diesem Computer ausgeführt, mit Ihrem Zugriff auf Ihre Dateien. Öffnen Sie nur Ordner, die Sie selbst angelegt haben oder die von jemandem stammen, dem Sie vertrauen.",
    "cancel": "Abbrechen",
    "changed": "Der Code dieses Ordners hat sich geändert, seit Sie ihn zuletzt geöffnet haben.",
    "open": "Öffnen",
    "title": "Diesen Ordner öffnen?"
  }
} as const;
