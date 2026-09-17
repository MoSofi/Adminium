// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/onboarding.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "account": {
    "body": "Der erste Administrator. Das passiert nur einmal, und Sie bleiben danach angemeldet.",
    "confirm": "Passwort bestätigen",
    "email": "E-Mail",
    "hidePassword": "Passwort verbergen",
    "label": "Ihr Konto",
    "name": "Ihr Name",
    "password": "Passwort",
    "passwordHelper": "Mindestens {min} Zeichen.",
    "showPassword": "Passwort anzeigen",
    "strength": "Passwortstärke",
    "strengthLevels": {
      "fair": "Ausreichend",
      "good": "Gut",
      "strong": "Stark",
      "weak": "Schwach"
    },
    "sub": "Anmeldedaten",
    "submit": "Konto erstellen",
    "title": "Erstellen Sie Ihr Konto"
  },
  "back": "Zurück",
  "connect": {
    "body": "Richten Sie Adminium auf eine Datenquelle. Wir lesen das Schema und schreiben nie hinein, sofern Sie es nicht verlangen.",
    "bridge": {
      "body": "Er wurde von adminium.dev übergeben. Erstellen Sie Ihr Konto, dann öffnen wir ihn im Verbindungsassistenten, wo Sie ihn lesen können, bevor ihn irgendetwas verwendet.",
      "title": "Für diese Instanz wartet eine Verbindungszeichenfolge"
    },
    "dsn": {
      "checking": "Diese Datenbank wird geprüft…",
      "helper": "Nichts verlässt diesen Browser, bevor Ihr Konto existiert — dann testen wir sie.",
      "incomplete": "Ergänzen Sie Host und Datenbank, z. B. postgres://user@host:5432/db",
      "invalidScheme": "Unbekanntes Schema — erwartet wurde postgres://, mysql://, mariadb:// oder sqlite:",
      "label": "Verbindungszeichenfolge"
    },
    "engine": {
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "engineLabel": "Datenbank-Engine",
    "existing": {
      "adopt": "Diese verwenden und anmelden",
      "adopting": "Diese Instanz wird darauf ausgerichtet…",
      "body": "Sie enthält {count, plural, one {# Adminium-Tabelle} other {# Adminium-Tabellen}} mit Daten. Zwei Möglichkeiten:",
      "failed": "Diese Instanz konnte nicht auf diese Datenbank ausgerichtet werden.",
      "otherSecret": "Sie wurde mit einem anderen ADMINIUM_SECRET eingerichtet: die Anmeldung dort funktioniert, aber ihre gespeicherten Verbindungszeichenfolgen kann diese Instanz nicht entschlüsseln.",
      "park": "Behalten und neu anfangen",
      "parked": {
        "body": "Sie werden umbenannt und beiseitegelegt — jede Zeile bleibt erhalten — und Adminium beginnt mit frischen Tabellen daneben. Es passiert nichts, bis Sie Adminiums eigene Daten in diese Datenbank legen.",
        "title": "Die vorhandenen Tabellen bleiben erhalten"
      },
      "restarting": "Neustart darauf…",
      "timeout": "Adminium ist auf diese Datenbank ausgerichtet, aber noch nicht zurück — laden Sie diese Seite gleich neu.",
      "title": "In dieser Datenbank läuft bereits ein Adminium"
    },
    "label": "Daten verbinden",
    "sub": "Datenbank verknüpfen",
    "title": "Verbinden Sie Ihre Datenbank"
  },
  "continue": "Weiter",
  "done": {
    "connected": {
      "reading": "Verbunden — Adminium liest gerade Ihr Schema.",
      "tables": "Verbunden · {count, plural, one {# Tabelle} other {# Tabellen}} gefunden."
    },
    "invited": "{count, plural, one {# Einladung} other {# Einladungen}} erstellt.",
    "label": "Fertig",
    "next": {
      "blank": "Ihr Arbeitsbereich ist bereit. Legen Sie eine Seite an, wann immer Sie möchten — es wurde nichts generiert, genau wie gewünscht.",
      "generate": "Ihr Arbeitsbereich ist bereit. Als Nächstes wählen wir die Tabellen aus und generieren Ihre Seiten."
    },
    "storage": {
      "local": "Adminium bewahrt seine eigenen Daten in einer Datei auf diesem Rechner auf.",
      "sameDb": "Adminium bewahrt seine eigenen Daten in der Datenbank auf, die Sie verbunden haben.",
      "separate": "Adminium bewahrt seine eigenen Daten in der Datenbank auf, die Sie ihm gegeben haben."
    },
    "sub": "Loslegen",
    "title": "Alles bereit! 🎉"
  },
  "error": {
    "alreadyCompleted": "Diese Instanz wurde bereits eingerichtet. Melden Sie sich mit dem vorhandenen Administratorkonto an.",
    "connectionFailed": "Ihr Konto wurde erstellt und Sie sind angemeldet — aber diese Datenbank war nicht erreichbar: {detail}",
    "connectionUnknown": "die Datenbank hat nicht geantwortet",
    "failed": "Die Einrichtung ist fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
    "rejected": "Der Server hat diese Angaben abgelehnt. Prüfen Sie E-Mail und Passwort und versuchen Sie es erneut."
  },
  "finish": "Zum Dashboard",
  "kicker": "Schritt {n} von {total}",
  "meta": {
    "body": "Ihre Anmeldung, die generierten Seiten und Ihre gespeicherten Einstellungen. Das ist getrennt von der Datenbank, die Sie gerade verbunden haben und die Adminium nur liest.",
    "label": "Adminiums Daten",
    "local": {
      "body": "Nichts einzurichten. Richtig zum Ausprobieren von Adminium oder für eine einzelne Instanz.",
      "title": "In einer Datei auf diesem Rechner"
    },
    "moving": {
      "copying": "Adminiums Daten werden kopiert …",
      "failed": "Adminiums Daten konnten nicht verschoben werden — erneut versuchen.",
      "restarting": "Neustart auf der neuen Datenbank …",
      "timeout": "Adminium hat seine Daten verschoben, ist aber noch nicht zurück. Sie liegen sicher in der neuen Datenbank — laden Sie diese Seite gleich neu."
    },
    "pinned": {
      "body": "Diese Instanz wurde mit konfiguriertem Meta-Speicher gestartet, es gibt also nichts zu verschieben. Sie können das später in den Studio-Einstellungen ändern.",
      "title": "Adminiums Daten haben bereits ein Zuhause"
    },
    "sameDb": {
      "alreadyAdminium": "Diese Datenbank enthält bereits eine Adminium-Instanz. Gehen Sie einen Schritt zurück, um deren Tabellen zu behalten und daneben neu anzufangen — oder melden Sie sich stattdessen dort an.",
      "body": "Adminium legt seine eigenen `adminium_`-Tabellen neben Ihren an. Eine Datenbank zum Sichern.",
      "disabledFile": "Eine SQLite-Datei ist kein Server, dem Adminium eigene Tabellen hinzufügen kann.",
      "disabledNoDdl": "Diese Rolle darf kein CREATE TABLE ausführen, was Adminiums eigene Migrationen benötigen.",
      "disabledReadOnly": "Diese Rolle ist schreibgeschützt — Adminium schreibt nie in Ihre Datenbank. Behalten Sie seine Daten in einer Datei oder geben Sie ihm eine eigene.",
      "noSource": "Sie haben noch keine Datenbank verbunden — verbinden Sie zuerst eine, oder behalten Sie Adminiums Daten in einer Datei.",
      "parked": "Die bereits vorhandenen Adminium-Tabellen werden zuerst umbenannt und beiseitegelegt — jede Zeile bleibt erhalten — und Adminium beginnt mit frischen daneben.",
      "title": "In der Datenbank, die Sie gerade verbunden haben"
    },
    "separate": {
      "body": "Eine PostgreSQL- oder MySQL-Datenbank, die Sie bereitstellen. Richtig für den Produktivbetrieb oder für mehrere Instanzen.",
      "failed": "Diese Datenbank hat nicht geantwortet.",
      "incomplete": "Ergänzen Sie Host und Datenbank, z. B. postgres://user@host:5432/adminium",
      "insufficient": "Diese Rolle darf kein CREATE TABLE ausführen — Adminiums eigene Migrationen brauchen es.",
      "invalidScheme": "Unbekanntes Schema — erwartet wurde postgres://, mysql:// oder mariadb://",
      "label": "Verbindungszeichenfolge für Adminium",
      "ok": "Erreichbar, und es können Tabellen angelegt werden.",
      "test": "Diese Datenbank testen",
      "title": "In einer eigenen Datenbank"
    },
    "sub": "Wo sie liegen",
    "title": "Wo Adminium seine eigenen Daten aufbewahrt"
  },
  "progressComplete": "{percent} % abgeschlossen",
  "progressLabel": "Einrichtungsfortschritt",
  "skip": "Überspringen",
  "start": {
    "body": "Das bestimmt nur, welche Seiten wir für Sie generieren. Sie können alles später ändern oder ganz ohne Vorlage beginnen.",
    "label": "Ausgangspunkt",
    "options": {
      "analytics": {
        "body": "Diagramme und Tabellen zum Lesen. Nichts schreibt zurück.",
        "title": "Nur-Lese-Analysen"
      },
      "blank": {
        "body": "Nichts generieren. Verbinden Sie eine Datenbank und bauen Sie die Seiten, die Sie wollen, eine nach der anderen.",
        "title": "Leere Arbeitsfläche"
      },
      "crud": {
        "body": "Tabellen und Formulare, ohne die Dashboards.",
        "title": "CRUD-Tabellen"
      },
      "fullAdmin": {
        "body": "Eine Seite pro Tabelle, mit Anlegen, Bearbeiten und Löschen.",
        "title": "Vollständiges Admin-Panel"
      },
      "support": {
        "body": "Zuerst Warteschlangen und Kundendetailseiten, mit deaktiviertem Löschen.",
        "title": "Support-Konsole"
      }
    },
    "sub": "Form wählen",
    "title": "Was bauen Sie zuerst?"
  },
  "team": {
    "body": "Laden Sie die Menschen ein, mit denen Sie arbeiten. Sie können jederzeit weitere hinzufügen.",
    "copied": "Kopiert",
    "copyLink": "Link kopieren",
    "duplicate": "Diese Person wurde bereits eingeladen.",
    "emailLabel": "E-Mail der Kollegin oder des Kollegen",
    "emailed": "Einladung per E-Mail gesendet",
    "failed": "Diese Einladung konnte nicht erstellt werden.",
    "invalidEmail": "Geben Sie eine gültige E-Mail-Adresse ein.",
    "invite": "Einladen",
    "label": "Ihr Team",
    "note": "Einladungen ohne E-Mail zeigen einen Link, den Sie selbst versenden. Er wird nur einmal angezeigt — Adminium bewahrt davon nur einen Hash auf.",
    "placeholder": "kollege@firma.de",
    "sub": "Personen hinzufügen",
    "title": "Holen Sie Ihr Team dazu"
  }
} as const;
