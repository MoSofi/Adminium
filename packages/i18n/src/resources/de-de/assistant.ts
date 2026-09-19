// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/assistant.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "ask": {
    "continue": "Weiter",
    "pick": "Wähle in jeder Gruppe eine Option",
    "picked": "Gewählt: {labels}",
    "ready": "Bereit",
    "waiting": "Warte auf dich"
  },
  "audit": {
    "note": "Jede Aktion wird im Audit-Log protokolliert"
  },
  "button": "{name} fragen",
  "buttonTitle": "{name} zu dieser Seite fragen",
  "close": "Schließen",
  "composer": {
    "send": "Senden",
    "working": "Arbeitet …"
  },
  "confirm": {
    "cancel": "Abbrechen"
  },
  "details": {
    "checks": "Prüfungen",
    "figures": "Kennzahlen",
    "figuresValue": "{blocks, plural, one {# Block mit Kennzahlen} other {# Blöcke mit Kennzahlen}}",
    "format": "Format",
    "formatEmailValue": "Adminium-E-Mail · {blocks, plural, one {# Block} other {# Blöcke}}",
    "formatInvoiceValue": "Adminium-Rechnungsvorlage · {sections, plural, one {# Abschnitt aktiv} other {# Abschnitte aktiv}}",
    "lines": "Positionen",
    "linesValue": "{lines, plural, one {# Position} other {# Positionen}} · {total}",
    "noChecks": "keine angegeben",
    "none": "keine",
    "notPublished": "Nicht veröffentlicht",
    "notPublishedValue": "als Entwurf gespeichert",
    "notTouched": "Unberührt",
    "notTouchedValue": "keine Kundendatensätze geändert, keine E-Mail gesendet",
    "record": "Datensatz",
    "recordValue": "Rechnungsdokument · 1 neue Zeile · Status Entwurf",
    "sources": "Gelesene Quellen",
    "sourcesChosen": "Gewählte Quellen",
    "taxLines": "Steuerzeilen",
    "taxLinesValue": "{rate} %",
    "tokens": "Tokens",
    "tokensValue": "{in} rein · {out} raus",
    "variables": "Variablen"
  },
  "diff": {
    "adds": "+{n}",
    "against": "Verglichen mit {name}",
    "dels": "−{n}",
    "new": "Neu: {kind} — Felder, die geschrieben werden",
    "truncated": "Der Vergleich wurde gekürzt — öffne den Entwurf, um den Rest zu sehen."
  },
  "draft": {
    "account": "Konto",
    "draft": "Entwurf",
    "due": "Fällig",
    "issued": "Ausgestellt",
    "lineCount": "{n, plural, one {# Position} other {# Positionen}}",
    "lines": "Übernommene Positionen",
    "notTouched": "Es werden keine Kundendatensätze geändert und keine E-Mail gesendet.",
    "status": "Status",
    "template": "Vorlage",
    "total": "Gesamt"
  },
  "echo": {
    "applied": "In den Editor übernommen — prüfe die markierten Blöcke."
  },
  "email": {
    "action1": "Test-E-Mail senden",
    "action2": "Im Editor öffnen",
    "action3": "Vorlage speichern",
    "blurb": "Kennt diese Seite: {templates, plural, one {# Vorlage} other {# Vorlagen}} · {campaigns, plural, one {# Kampagne} other {# Kampagnen}} · Branding",
    "chip1": "Entwirf eine Erinnerung für eine offene Rechnung",
    "chip2": "Erstelle eine Terminerinnerung, 3 Tage vorher",
    "chip3": "Übersetze die Willkommensvorlage ins Deutsche",
    "confirm": {
      "body": "{name} legt „{title}“ als Entwurf unter E-Mail-Vorlagen an. Bis du sie aktiv schaltest, geht nichts an Kundinnen und Kunden.",
      "bodyOpen": "{name} legt „{title}“ als Entwurf unter E-Mail-Vorlagen an und öffnet sie im Editor.",
      "button": "Als Entwurf speichern",
      "title": "Als neue Vorlage speichern?"
    },
    "echo": {
      "editor": "Als Entwurfsvorlage gespeichert. Wird im Editor geöffnet.",
      "sample": "Beispiel für {record} gerendert.",
      "saved": "Als Entwurfsvorlage gespeichert.",
      "test": "Test an {email} mit Beispieldaten gesendet."
    },
    "greeting": "Ich sehe deine E-Mail-Vorlagen — das Blockformat, dein Branding und die Variablen, die jede Vorlage verwenden darf.",
    "greetingSub": "Beschreibe die E-Mail, die du brauchst, und ich entwerfe sie im Vorlagenformat von Adminium; danach kannst du sie vor dem Speichern testweise senden.",
    "language": {
      "saved": "Die Variante {locale} wurde als Entwurf hinzugefügt."
    },
    "page": "E-Mail-Vorlagen",
    "placeholder": "Beschreibe die Vorlage, die du brauchst …",
    "readPage": "E-Mail-Vorlagen · {templates, plural, one {# Vorlage} other {# Vorlagen}} · Branding",
    "scopePrimary": "email_templates",
    "workTitle": "Neue E-Mail-Vorlage entworfen"
  },
  "error": {
    "generic": "Das hat nicht geklappt. Frag es noch einmal.",
    "smtp": "E-Mail ist noch nicht eingerichtet. Öffne die E-Mail-Einstellungen, um ein Relay hinzuzufügen.",
    "tooLong": "Dieses Gespräch ist zu lang für das Modell — starte eine neue Sitzung.",
    "tryAgain": "Erneut versuchen"
  },
  "invoiceTemplate": {
    "action1": "Anderes Beispiel ansehen",
    "action2": "Im Editor öffnen",
    "action3": "Vorlage speichern",
    "blurb": "Kennt diese Seite: {templates, plural, one {# Vorlage} other {# Vorlagen}} · Nummerierung {pattern} · {invoices, plural, one {# Rechnung} other {# Rechnungen}}",
    "chip1": "Erstelle eine Vorlage für EU-Kunden mit Reverse-Charge-Umsatzsteuer",
    "chip2": "Füge einer meiner Vorlagen einen Abschnitt für Verzugsgebühren hinzu",
    "chip3": "Passe eine meiner Vorlagen an unsere Markenfarben an",
    "confirm": {
      "body": "{name} fügt „{title}“ als Entwurf zu den Rechnungsvorlagen hinzu. Bestehende Rechnungen bleiben unberührt.",
      "bodyOpen": "{name} fügt „{title}“ als Entwurf zu den Rechnungsvorlagen hinzu und öffnet sie im Editor.",
      "button": "Als Entwurf speichern",
      "title": "Als neue Rechnungsvorlage speichern?"
    },
    "echo": {
      "editor": "Als Entwurf gespeichert. Wird im Editor geöffnet.",
      "noSample": "Hier gibt es keine Rechnung, aus der sich ein Beispiel zeichnen lässt.",
      "sample": "Beispiel für {record} gerendert.",
      "saved": "Als Entwurfsvorlage gespeichert.",
      "test": "Test an {email} gesendet."
    },
    "greeting": "Ich sehe deine Rechnungsvorlagen, dein Nummernschema und die Steuerzeilen, die deine Vorlagen verwenden.",
    "greetingSub": "Sag mir, welche Vorlage du brauchst, und ich baue sie im Rechnungsformat von Adminium; danach rendere ich ein Beispiel mit echten Kontodaten.",
    "language": {
      "saved": "Die Variante {locale} wurde als Entwurf hinzugefügt."
    },
    "page": "Rechnungsvorlagen",
    "placeholder": "Beschreibe die Rechnungsvorlage, die du brauchst …",
    "readPage": "Rechnungsvorlagen · {templates, plural, one {# Vorlage} other {# Vorlagen}} · Nummerierung {pattern}",
    "scopePrimary": "invoice_templates",
    "workTitle": "Neue Rechnungsvorlage gebaut"
  },
  "invoices": {
    "action1": "Im Editor öffnen",
    "action2": "Rechnungsentwurf anlegen",
    "blurb": "Kennt diese Seite: {invoices, plural, one {# Rechnung} other {# Rechnungen}} · {templates, plural, one {# Vorlage} other {# Vorlagen}} · deine Rolle darf {write, select, true {schreiben} other {lesen}}",
    "chip1": "Erstelle eine Rechnung für einen Kunden für letzten Monat",
    "chip2": "Entwirf eine Rechnung aus den nicht abgerechneten Einträgen des letzten Monats",
    "chip3": "Zeige die Rechnungen, deren Fälligkeit überschritten ist",
    "confirm": {
      "body": "{name} fügt diese Rechnung als Entwurf zu den Rechnungen hinzu. Bis du sie versendest, werden keine Kundendatensätze geändert.",
      "bodyOpen": "{name} fügt diese Rechnung als Entwurf zu den Rechnungen hinzu und öffnet sie im Editor.",
      "button": "Entwurf anlegen",
      "title": "Diesen Rechnungsentwurf anlegen?"
    },
    "echo": {
      "editor": "Als Entwurf angelegt. Wird im Rechnungseditor geöffnet.",
      "sample": "Beispiel für {record} gerendert.",
      "saved": "Als Entwurf angelegt. Er steht oben in der Tabelle.",
      "test": "Test an {email} gesendet."
    },
    "greeting": "Ich sehe die Rechnungstabelle, deine Vorlagen und die Orte, aus denen Rechnungsdaten kommen können.",
    "greetingSub": "Sag mir, wem du etwas berechnen willst; ich frage nach der Vorlage und der Datenquelle, bevor ich etwas entwerfe.",
    "language": {
      "saved": "Die Variante {locale} wurde als Entwurf hinzugefügt."
    },
    "page": "Rechnungen",
    "placeholder": "z. B. erstelle eine Rechnung für einen Kunden für letzten Monat …",
    "readPage": "Rechnungen · {invoices, plural, one {# Datensatz} other {# Datensätze}} · deine Rolle darf {write, select, true {schreiben} other {lesen}}",
    "scopePrimary": "invoices",
    "workTitle": "Rechnung entworfen"
  },
  "readOnly": {
    "enable": "Aktionen freigeben",
    "lockedTitle": "Gib Aktionen frei, damit {name} das tun kann",
    "noWrite": "Deine Rolle darf hier ansehen, entwerfen und vorschauen, aber nicht speichern.",
    "noWriteTitle": "Deine Rolle darf das hier nicht",
    "note": "{name} ist gerade schreibgeschützt — es kann ansehen, entwerfen und vorschauen, aber nicht speichern, senden oder anlegen."
  },
  "report": {
    "action1": "Vollständige Vorschau ausführen",
    "action2": "Im Builder öffnen",
    "action3": "Bericht speichern",
    "blurb": "Kennt diese Seite: {reports, plural, one {# Bericht} other {# Berichte}} · {connection} · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "chip1": "Welche Kunden brauchen die meiste Supportzeit? Wähle du die Quellen",
    "chip2": "Baue einen Retention-Bericht aus Kunden und Bestellungen",
    "chip3": "Erstelle eine Vorlage für den monatlichen Betriebsrückblick",
    "confirm": {
      "body": "{name} fügt „{title}“ zu den Berichten hinzu. Er läuft auf Abruf — ohne Zeitplan, bis du einen einrichtest.",
      "bodyOpen": "{name} fügt „{title}“ zu den Berichten hinzu und öffnet ihn im Builder.",
      "button": "Bericht speichern",
      "title": "Diesen Bericht speichern?"
    },
    "echo": {
      "editor": "In Berichten gespeichert. Wird im Builder geöffnet.",
      "resampled": "Quellen erneut ausgeführt — {n, plural, one {# Wert} other {# Werte}} aktualisiert.",
      "resampledRefused": "Quellen erneut ausgeführt — {n, plural, one {# Wert} other {# Werte}} aktualisiert; {refused, plural, one {# Quelle} other {# Quellen}} konnten nicht gelesen werden.",
      "sample": "Vollständige Abfrage für {record} ausgeführt.",
      "saved": "In Berichten gespeichert. Einen Zeitplan fügst du in der Berichtskopfzeile hinzu.",
      "test": "Test an {email} gesendet."
    },
    "greeting": "Ich sehe deine Berichtsbibliothek und die {tables, plural, one {# Tabelle} other {# Tabellen}}, die deine Rolle in {connection} lesen darf.",
    "greetingSub": "Nenne die Tabellen und das Layout — oder einfach die Frage, dann wähle ich die Quellen und zeige dir, warum.",
    "language": {
      "saved": "Die Variante {locale} wurde als Entwurf hinzugefügt."
    },
    "page": "Berichts-Builder",
    "placeholder": "Frag nach einem Bericht oder nenne die Tabellen …",
    "readPage": "Berichts-Builder · {reports, plural, one {# Bericht} other {# Berichte}} · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "scopePrimary": "reports",
    "workTitle": "Bericht gebaut"
  },
  "scope": {
    "connection": "{connection} · {n, plural, one {# Tabelle} other {# Tabellen}}",
    "extra": "+{n}",
    "title": "Daten, die diese Sitzung lesen darf"
  },
  "steps": {
    "done": "fertig",
    "failed": "fehlgeschlagen",
    "note": {
      "ready": "bereit",
      "warning": "{n, plural, one {# Warnung} other {# Warnungen}}"
    },
    "readPage": "Diese Seite gelesen",
    "step": "Schritt {n}",
    "working": "Arbeitet daran"
  },
  "tabs": {
    "details": "Details",
    "diff": "Diff",
    "preview": "Vorschau"
  },
  "tokens": {
    "hint": "~{n} Tokens",
    "title": "In dieser Sitzung verbrauchte Tokens",
    "value": "{n} Tokens"
  },
  "try": "Ausprobieren",
  "unavailable": {
    "askAdmin": "Bitte eine Administratorin oder einen Administrator, einen einzurichten.",
    "forbidden": "Du hast keine Berechtigung, {name} zu verwenden.",
    "network": "Ausgehende Netzwerkfunktionen sind auf dieser Instanz deaktiviert.",
    "noProvider": "Es ist noch kein KI-Anbieter konfiguriert.",
    "settings": "Einstellungen → KI öffnen"
  }
} as const;
