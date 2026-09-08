// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/automations.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "rules": {
    "title": "Automatisierungsregeln",
    "subtitle": "Lösen Sie Abläufe automatisch aus, wenn etwas passiert.",
    "new": "Neue Regel",
    "empty": {
      "title": "Noch keine Regeln",
      "body": "Erstellen Sie eine Regel, damit Schritte automatisch laufen, wenn etwas passiert."
    },
    "none": "Wählen Sie eine Regel, um ihren Ablauf zu sehen"
  },
  "kpi": {
    "activeRules": "Aktive Regeln",
    "runsToday": "Läufe heute",
    "successRate": "Erfolgsquote",
    "timeSaved": "Gesparte Zeit (Mon.)"
  },
  "filter": {
    "all": "Alle",
    "active": "Aktiv",
    "paused": "Pausiert"
  },
  "card": {
    "runs": "Läufe",
    "success": "Erfolg",
    "never": "Nie gelaufen",
    "toggle": "Umschalten"
  },
  "status": {
    "active": "Aktiv",
    "paused": "Pausiert"
  },
  "flow": {
    "steps": "{count, plural, one {# Schritt} other {# Schritte}}",
    "saves": "spart {time} / Lauf",
    "runs30d": "Läufe 30 T.",
    "success": "Erfolg",
    "test": "Testen",
    "running": "Läuft",
    "noSample": "Kein Datensatz zum Testen – legen Sie zuerst einen an",
    "menu": "Regelaktionen"
  },
  "menu": {
    "rename": "Umbenennen",
    "duplicate": "Duplizieren",
    "delete": "Löschen"
  },
  "delete": {
    "title": "{name} löschen?",
    "body": "Der Verlauf der Läufe geht mit. Das lässt sich nicht rückgängig machen.",
    "confirm": "Löschen",
    "cancel": "Abbrechen"
  },
  "save": {
    "unsaved": "Nicht gespeichert",
    "saving": "Wird gespeichert…",
    "saved": "Alles gespeichert",
    "action": "Speichern"
  },
  "guard": {
    "title": "Ohne Speichern verlassen?",
    "body": "Ihre Änderungen an dieser Regel gehen verloren.",
    "stay": "Weiter bearbeiten",
    "leave": "Verlassen"
  },
  "toast": {
    "saved": "Regel gespeichert",
    "enabled": "{name} ist an",
    "paused": "{name} ist pausiert",
    "incomplete": "Schließen Sie „{step}“ ab, bevor Sie die Regel einschalten",
    "duplicated": "{name} dupliziert",
    "deleted": "{name} gelöscht",
    "failed": "Das wurde nicht gespeichert – {reason}"
  },
  "canvas": {
    "insert": "Hier Schritt einfügen",
    "addStep": "Schritt hinzufügen",
    "remove": "Schritt entfernen"
  },
  "kind": {
    "trigger": "AUSLÖSER",
    "condition": "FILTER",
    "branch": "WENN / SONST",
    "wait": "VERZÖGERUNG",
    "action": "AKTION"
  },
  "branch": {
    "ifMatches": "Wenn zutrifft",
    "otherwise": "Sonst"
  },
  "picker": {
    "title": "Schritt hinzufügen",
    "before": "Vor · {title}",
    "end": "Am Ende des Ablaufs",
    "inBranch": "Im Zweig · {label}",
    "actions": "Aktionen",
    "logic": "Logik",
    "close": "Schließen"
  },
  "pick": {
    "email": "E-Mail senden",
    "emailDesc": "Aus einer gespeicherten Vorlage",
    "notification": "Benachrichtigung senden",
    "notificationDesc": "Personen in diesem Workspace informieren",
    "create": "Datensatz anlegen",
    "createDesc": "Eine Zeile in einer Tabelle anlegen",
    "update": "Feld aktualisieren",
    "updateDesc": "In einen Datensatz zurückschreiben",
    "webhook": "Webhook aufrufen",
    "webhookDesc": "Daten überallhin senden",
    "slack": "Slack-Nachricht",
    "slackDesc": "In einem Kanal posten",
    "branch": "Wenn/Sonst-Verzweigung",
    "branchDesc": "In zwei Pfade aufteilen",
    "filter": "Nur fortfahren, wenn",
    "filterDesc": "Anhalten, wenn nicht zutrifft",
    "wait": "Warten / Verzögern",
    "waitDesc": "Vor dem nächsten Schritt pausieren",
    "stop": "Ablauf stoppen",
    "stopDesc": "Diesen Lauf hier beenden"
  },
  "node": {
    "email": {
      "sub": "Vorlage · auswählen",
      "summary": "Vorlage · {template} → {to}"
    },
    "notification": {
      "sub": "Empfänger auswählen",
      "summary": "An · {who}"
    },
    "create": {
      "sub": "Tabelle · auswählen",
      "summary": "{table} · {count} Werte"
    },
    "update": {
      "sub": "Wert setzen",
      "summary": "{pairs}"
    },
    "webhook": {
      "sub": "POST · JSON-Payload",
      "summary": "{method} {host}"
    },
    "slack": {
      "sub": "Kanal · Webhook-URL hinzufügen",
      "summary": "Slack · {host}"
    },
    "wait": {
      "title": "Warten / Verzögern",
      "sub": "Pause von {duration}"
    },
    "stop": {
      "title": "Ablauf stoppen",
      "sub": "Beendet den Lauf"
    },
    "condition": {
      "empty": "Bedingung festlegen"
    },
    "trigger": {
      "record": "Wenn ein Datensatz in {table} {event} wird",
      "interval": "Alle {minutes} Minuten",
      "daily": "Täglich um {time}",
      "weekly": "Wöchentlich am {day} um {time}",
      "monthly": "Monatlich am {day}. um {time}",
      "sub": "Auslöser · {event}"
    }
  },
  "event": {
    "created": "angelegt",
    "updated": "aktualisiert",
    "deleted": "gelöscht"
  },
  "insp": {
    "stepName": "Schrittname",
    "description": "Beschreibung",
    "condition": "Bedingung",
    "lookAt": "Betrachten",
    "thisRecord": "Diesen Datensatz",
    "related": "Verknüpfte Datensätze",
    "field": "Feld",
    "value": "Wert",
    "countOf": "Anzahl von",
    "where": "wobei",
    "isThisRecords": "gleich dem Wert dieses Datensatzes in",
    "andWhere": "und wobei",
    "branchLabels": "Zweigbezeichnungen",
    "onError": "Bei Fehler fortfahren",
    "onErrorBody": "Spätere Schritte auch dann ausführen, wenn dieser fehlschlägt",
    "moveUp": "Nach oben",
    "moveDown": "Nach unten",
    "duplicate": "Duplizieren",
    "delete": "Löschen",
    "close": "Schließen",
    "settings": "Einstellungen"
  },
  "op": {
    "is": "ist",
    "isNot": "ist nicht",
    "contains": "enthält",
    "gt": "ist größer als",
    "lt": "ist kleiner als",
    "isEmpty": "ist leer",
    "notEmpty": "ist nicht leer",
    "withinNext": "liegt in den nächsten",
    "withinLast": "liegt in den letzten",
    "moreThanAgo": "war vor mehr als …",
    "moreThanAhead": "liegt mehr als … in der Zukunft"
  },
  "unit": {
    "minutes": "{count, plural, one {Minute} other {Minuten}}",
    "hours": "{count, plural, one {Stunde} other {Stunden}}",
    "days": "{count, plural, one {Tag} other {Tage}}"
  },
  "trig": {
    "title": "Auslöser",
    "kind": "Wann",
    "record": "Ein Datensatz wird {event}",
    "schedule": "Nach Zeitplan",
    "table": "Tabelle",
    "changed": "Nur wenn sich diese Spalte ändert",
    "anyColumn": "Beliebige Spalte",
    "watch": {
      "on": "Beobachtet auch Zeilen, die außerhalb von Adminium geschrieben werden · jede Minute · über {column}",
      "off": "Beobachtung ist aus: Diese Tabelle hat keine Spalte in der Form „{shape}“ und keinen aufsteigenden Schlüssel – nur Schreibvorgänge über Adminium lösen diese Regel aus",
      "deleted": "Gelöschte Zeilen lassen sich nicht beobachten; nur Löschungen über Adminium lösen diese Regel aus",
      "fromNow": "Zeilen ab jetzt"
    },
    "when": "Nur wenn",
    "every": "Alle",
    "at": "Um",
    "timezone": "Zeitzone",
    "forEach": "Für jeden Datensatz aus",
    "forEachWhere": "wobei",
    "once": "Einmal pro Datensatz",
    "onceBody": "Ein Datensatz, der bereits zutraf, läuft nicht erneut",
    "timeSaved": "Gesparte Zeit pro Lauf",
    "timeSavedBody": "Minuten, die eine Person gebraucht hätte – erscheint als „spart“ an der Regel",
    "addCondition": "Bedingung hinzufügen",
    "connection": "Verbindung"
  },
  "sched": {
    "interval": "Intervall",
    "daily": "Täglich",
    "weekly": "Wöchentlich",
    "monthly": "Monatlich"
  },
  "email": {
    "template": "Vorlage",
    "to": "An",
    "toField": "E-Mail dieses Datensatzes",
    "toFixed": "Adressen",
    "column": "Spalte",
    "addresses": "Adresse hinzufügen…"
  },
  "notif": {
    "to": "Senden an",
    "roles": "Alle mit einer Rolle",
    "users": "Bestimmte Personen",
    "title": "Titel",
    "body": "Nachricht"
  },
  "rec": {
    "table": "Tabelle",
    "values": "Werte",
    "addValue": "Wert hinzufügen",
    "column": "Spalte",
    "value": "Wert",
    "now": "Jetzt",
    "remove": "Diesen Wert entfernen",
    "tokenHint": "Mit {token} aus dem Datensatz übernehmen"
  },
  "hook": {
    "url": "URL",
    "method": "Methode",
    "body": "Body",
    "bodyJson": "JSON (Ereignis, Regel, Datensatz)",
    "bodyText": "Eigener Text",
    "header": "Header",
    "headerName": "Name",
    "headerValue": "Wert",
    "slackUrl": "Slack-Webhook-URL",
    "slackText": "Nachricht"
  },
  "wait": {
    "for": "Warten",
    "max": "Bis zu 30 Tage",
    "amount": "Anzahl",
    "unit": "Einheit"
  },
  "modal": {
    "title": "Neue Regel",
    "subtitle": "Lösen Sie Abläufe automatisch aus, wenn etwas passiert.",
    "name": "Regelname",
    "namePlaceholder": "z. B. Neue Registrierungen begrüßen",
    "when": "Wenn (Auslöser)",
    "then": "Dann (Aktion)",
    "enable": "Sofort aktivieren",
    "enableBody": "Läuft, sobald die Regel angelegt ist",
    "cancel": "Abbrechen",
    "create": "Regel anlegen",
    "doneTitle": "Regel angelegt",
    "doneBody": "Ihre Regel ist aktiv und läuft, sobald sie das nächste Mal ausgelöst wird.",
    "savedTitle": "Regel gespeichert",
    "savedBody": "Schließen Sie die Schritte ab und schalten Sie sie dann ein.",
    "done": "Fertig",
    "trigger": {
      "created": "Ein Datensatz wird in {table} angelegt",
      "updated": "Ein Datensatz wird in {table} aktualisiert",
      "deleted": "Ein Datensatz wird in {table} gelöscht",
      "schedule": "Nach Zeitplan"
    },
    "connection": "{connection} · {table}"
  },
  "logs": {
    "title": "Ablaufprotokolle",
    "subtitle": "Ausführungsverlauf Ihrer Automatisierungen.",
    "refresh": "Aktualisieren",
    "kpi": {
      "runsToday": "Läufe heute",
      "success": "Erfolgsquote",
      "failed": "Fehlgeschlagen",
      "avgDuration": "Ø Dauer"
    },
    "filter": {
      "all": "Alle",
      "success": "Erfolg",
      "failed": "Fehlgeschlagen",
      "running": "Läuft"
    },
    "status": {
      "success": "Erfolg",
      "failed": "Fehlgeschlagen",
      "running": "Läuft",
      "pending": "Startet {when}",
      "waiting": "Wartet · fährt {when} fort",
      "skipped": "Übersprungen",
      "cancelled": "Abgebrochen"
    },
    "trigger": "Auslöser",
    "duration": "Dauer",
    "started": "Gestartet",
    "trace": "Ausführungsprotokoll",
    "loadOlder": "Ältere laden",
    "empty": {
      "title": "Noch keine Läufe",
      "filtered": "Keine Läufe mit Status „{status}“ in den letzten 7 Tagen"
    },
    "select": "Wählen Sie einen Lauf, um sein Protokoll zu sehen",
    "justNow": "gerade eben"
  },
  "trace": {
    "trigger": "Datensatz = {label} · {summary}",
    "scheduleTick": "Takt · {stamp}",
    "evaluated": "ausgewertet → {result}",
    "stopped": "ausgewertet → false · gestoppt",
    "branch": "wählte „{label}“",
    "wait": "fährt {stamp} fort",
    "wouldWait": "Würde {duration} warten",
    "email": {
      "ok": "{smtp} · zugestellt an {to}",
      "fail": "FEHLER · {reason}",
      "would": "Würde „{subject}“ an {to} senden",
      "noSmtp": "SMTP ist nicht eingerichtet – Einstellungen → E-Mail",
      "noRecipient": "Kein Empfänger: {column} ist leer"
    },
    "notif": {
      "ok": "{count, plural, one {# Person} other {# Personen}} benachrichtigt"
    },
    "create": {
      "ok": "{label} angelegt"
    },
    "update": {
      "ok": "{pairs} gesetzt"
    },
    "write": {
      "would": "Würde {pairs} setzen"
    },
    "hook": {
      "ok": "{method} {path} → {status} · {ms} ms",
      "fail": "{method} {path} → {status}",
      "would": "Würde {method} {url}"
    },
    "stop": "Hier gestoppt",
    "undone": "Vor dem Lauf rückgängig gemacht",
    "gone": "Datensatz existiert nicht mehr",
    "ruleOff": "Regel wurde während des Wartens ausgeschaltet",
    "skipped": "—"
  },
  "dur": {
    "ms": "{ms} ms",
    "s": "{s} s",
    "none": "—"
  },
  "saved": {
    "h": "{h} Std.",
    "m": "{m} Min."
  }
} as const;
