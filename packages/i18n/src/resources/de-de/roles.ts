// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/roles.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "delete": "Löschen",
    "rename": "Umbenennen"
  },
  "builtinLocked": "Integrierte Rollen können nicht gelöscht werden.",
  "category": {
    "access": "Zugriff",
    "data": "Daten",
    "operations": "Betrieb",
    "workspace": "Workspace",
    "records": "Seiten & Datensätze",
    "apps": "Apps"
  },
  "column": {
    "actions": "Aktionen",
    "members": "Mitglieder",
    "name": "Rolle"
  },
  "create": {
    "descriptionLabel": "Beschreibung",
    "description": "Eine neue Rolle startet ganz ohne Berechtigungen.",
    "failed": "Die Rolle konnte nicht erstellt werden",
    "namePlaceholder": "z. B. Support-Mitarbeiter",
    "name": "Name",
    "submit": "Rolle erstellen",
    "title": "Neue Rolle"
  },
  "createButton": "Neue Rolle",
  "delete": {
    "confirm": "Rolle löschen",
    "description": "Die Rolle und ihre Berechtigungszeilen werden entfernt.",
    "failed": "Die Rolle konnte nicht gelöscht werden",
    "hasMembers": "„{name}“ hat weiterhin {count, plural, one {# Mitglied} other {# Mitglieder}}. Wählen Sie die Rolle, in die sie wechseln — Adminium lässt kein Konto ohne Rolle zurück.",
    "noMembers": "Niemand hat „{name}“, es wird also nichts verschoben.",
    "reassignPlaceholder": "Rolle wählen…",
    "reassignTo": "Mitglieder verschieben nach",
    "title": "Rolle löschen"
  },
  "list": {
    "title": "Rollen"
  },
  "loadFailed": {
    "body": "Die Matrix unten ist unvollständig — beim Speichern würden Berechtigungen entfernt, die lediglich nicht geladen wurden. Laden Sie neu, bevor Sie Änderungen vornehmen.",
    "title": "Einige Berechtigungen konnten nicht gelesen werden"
  },
  "matrix": {
    "discard": "Verwerfen",
    "empty": {
      "body": "Diese Instanz hat überhaupt keine vergebbaren Berechtigungen gemeldet, was nicht passieren sollte — laden Sie neu, und prüfen Sie das Server-Log, falls es bestehen bleibt.",
      "title": "Keine Berechtigungen anzuzeigen"
    },
    "label": "Rollenberechtigungen",
    "noChanges": "Keine ausstehenden Änderungen",
    "pending": "{count, plural, one {# ausstehende Änderung} other {# ausstehende Änderungen}}",
    "rowHeader": "Berechtigung",
    "title": "Berechtigungen"
  },
  "memberCount": "{count, plural, one {# Benutzer} other {# Benutzer}}",
  "permission": {
    "apiKeysManage": "API-Schlüssel verwalten",
    "auditRead": "Audit-Log lesen",
    "connectionsManage": "Datenbankverbindungen verwalten",
    "exportsManage": "Exporte aller Benutzer verwalten",
    "importsManage": "Importe aller Benutzer verwalten",
    "jobsManage": "Hintergrundjobs starten und abbrechen",
    "manifestsManage": "Apps und Add-ons installieren und verwalten",
    "jobsRead": "Alle Hintergrundjobs sehen",
    "llmRun": "KI-Assistenz ausführen",
    "pagesManage": "Seiten erstellen und ordnen",
    "projectRead": "Seiten- und Schemaänderungen für einen Projekt-Pull lesen",
    "reportsManage": "Geplante Berichte verwalten",
    "rolesManage": "Rollen und Berechtigungen verwalten",
    "schemaRemap": "Schema-Bezeichnungen und -Überschreibungen bearbeiten",
    "schemaDdl": "Tabellen erstellen, bearbeiten und löschen",
    "settingsManage": "Workspace-Einstellungen verwalten",
    "usersManage": "Benutzer verwalten",
    "filesManage": "Dateien aller Benutzer verwalten",
    "storageManage": "Speicherziele verwalten"
  },
  "rename": {
    "failed": "Die Rolle konnte nicht umbenannt werden",
    "title": "Rolle umbenennen"
  },
  "saveFailed": {
    "title": "Es konnten nicht alle Rollen gespeichert werden"
  },
  "subtitle": "Was jede Rolle darf. Ein Benutzer erhält die Vereinigung aller Rollen, die er innehat.",
  "title": "Rollen & Berechtigungen",
  "data": {
    "pagesView": "Alle Seiten sehen",
    "read": "Datensätze lesen",
    "readPii": "Personenbezogene Daten in Datensätzen sehen",
    "create": "Datensätze anlegen",
    "update": "Datensätze bearbeiten",
    "delete": "Datensätze löschen",
    "export": "Datensätze exportieren",
    "import": "Datensätze importieren",
    "pagesEdit": "Seitenlayouts ändern",
    "narrow": "{count, plural, one {# Berechtigung} other {# Berechtigungen}} für eine einzelne Seite oder Tabelle gelten zusätzlich zu den Zeilen unten. Beim Speichern bleiben sie erhalten."
  },
  "apps": {
    "every": "Mitarbeiterbildschirme aller Apps öffnen",
    "one": "Mitarbeiterbildschirme von {app} öffnen"
  }
} as const;
