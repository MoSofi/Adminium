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
  "actions": {
    "saved": "Gespeichert"
  },
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
  "automation": {
    "action1": "Im Builder öffnen",
    "action2": "Regel speichern (ausgeschaltet)",
    "blurb": "Kennt diese Seite: {rules, plural, one {# Regel} other {# Regeln}} · {templates, plural, one {# aktive E-Mail-Vorlage} other {# aktive E-Mail-Vorlagen}} · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "chip1": "Dem Kunden per E-Mail danken, wenn seine Bestellung versendet wird",
    "chip2": "Admins benachrichtigen, wenn ein neuer Kunde angelegt wird",
    "chip3": "Jeden Morgen Bestellungen markieren, deren Wunschtermin überschritten ist",
    "confirm": {
      "body": "{name} fügt „{title}“ ausgeschaltet zu den Automatisierungsregeln hinzu. Nichts läuft, bis du sie einschaltest.",
      "bodyOpen": "{name} fügt „{title}“ ausgeschaltet zu den Automatisierungsregeln hinzu und öffnet sie im Builder.",
      "button": "Ausgeschaltet speichern",
      "title": "Diese Regel speichern?"
    },
    "echo": {
      "editor": "Ausgeschaltet gespeichert. Wird im Builder geöffnet.",
      "saved": "In den Automatisierungsregeln gespeichert, ausgeschaltet."
    },
    "greeting": "Ich sehe deine Automatisierungsregeln, deine aktiven E-Mail-Vorlagen und die Tabellen, die deine Rolle lesen darf.",
    "greetingSub": "Beschreibe, was wann passieren soll, und ich entwerfe die Regel. Sie wird ausgeschaltet gespeichert, bis du sie einschaltest.",
    "page": "Automatisierungsregeln",
    "placeholder": "Beschreibe die Regel, die du brauchst …",
    "readPage": "Automatisierungsregeln · {rules, plural, one {# Regel} other {# Regeln}} · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "scopePrimary": "automations",
    "workTitle": "Neue Regel entworfen",
    "applied": "Auf diese Regel angewendet. Sie ist noch nicht gespeichert.",
    "apply": "Auf diese Regel anwenden",
    "handoff": "Öffnen Sie die E-Mail-Vorlagen, um eine zu entwerfen.",
    "handoffSub": "Diese Unterhaltung kommt mit.",
    "handoffOpen": "E-Mail-Vorlagen öffnen",
    "waiting": "Wartet auf eine Vorlage",
    "savedOff": "Wird ausgeschaltet gespeichert",
    "notSaved": "Nichts wird gespeichert, bis Sie die Regel speichern.",
    "workTitleChange": "Geöffnete Regel geändert"
  },
  "button": "{name} fragen",
  "buttonTitle": "{name} zu dieser Seite fragen",
  "close": "Schließen",
  "composer": {
    "send": "Senden",
    "working": "Arbeitet …"
  },
  "mic": {
    "speak": "Mit {name} sprechen",
    "stop": "Zuhören beenden",
    "listening": "Hört zu",
    "asking": "Erlauben Sie das Mikrofon, um mit {name} zu sprechen",
    "working": "Ihre Worte werden aufgeschrieben…",
    "check": "Text prüfen, dann senden.",
    "stopped": "Nach {minutes, plural, one {# Minute} other {# Minuten}} beendet.",
    "blocked": "Das Mikrofon ist für diese Website gesperrt. Erlauben Sie es in der Adressleiste Ihres Browsers.",
    "used": "Die Sprachzeit für heute ist aufgebraucht.",
    "failed": "Das hat nicht geklappt. Versuchen Sie es erneut.",
    "noticeProvider": "Was Sie sagen, wird zum Aufschreiben an {provider} gesendet. Nichts wird aufbewahrt.",
    "noticeBrowser": "Was Sie sagen, schreibt der Sprachdienst Ihres Browsers auf.",
    "noticeOk": "OK",
    "ownService": "den Modelldienst Ihres Arbeitsbereichs"
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
    "tryAgain": "Erneut versuchen",
    "modelFormat": "Dieses Modell antwortet nicht so, wie {name} es braucht. Wählen Sie unter Einstellungen → KI ein anderes Modell.",
    "modelFormatAsk": "Dieses Modell antwortet nicht so, wie {name} es braucht. Bitten Sie einen Administrator, ein anderes Modell zu wählen.",
    "setup": "Diese Seite konnte gerade nicht gelesen werden. Fragen Sie noch einmal.",
    "busy": "Ihre letzte Frage wird noch bearbeitet. Warten Sie darauf oder halten Sie sie zuerst an.",
    "budget": "Das wurde mittendrin angehalten: Das heutige Kontingent ist aufgebraucht."
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
    "noWrite": "Deine Rolle darf hier ansehen, entwerfen und vorschauen, aber nicht speichern.",
    "noWriteTitle": "Deine Rolle darf das hier nicht",
    "switchedOff": "Speichern ist für {name} in diesem Arbeitsbereich ausgeschaltet.",
    "openSettings": "Einstellungen öffnen",
    "switchedOffTitle": "Speichern ist für {name} in diesem Arbeitsbereich ausgeschaltet"
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
  "tryFrom": "Von {addOn}",
  "unavailable": {
    "askAdmin": "Bitte eine Administratorin oder einen Administrator, einen einzurichten.",
    "forbidden": "Du hast keine Berechtigung, {name} zu verwenden.",
    "network": "Ausgehende Netzwerkfunktionen sind auf dieser Instanz deaktiviert.",
    "noProvider": "Es ist noch kein KI-Anbieter konfiguriert.",
    "settings": "Einstellungen → KI öffnen"
  },
  "budget": {
    "usedUp": "Das heutige Kontingent ist aufgebraucht. Es beginnt um {time} neu."
  },
  "data": {
    "page": "Diese Seite",
    "blurb": "Kennt diese Seite: {table} · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "blurbNoTable": "Kennt diese Seite · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "greeting": "Ich kann lesen, was diese Seite zeigt, und die anderen Tabellen, die Ihre Rolle lesen darf.",
    "greetingSub": "Fragen Sie nach den Zeilen hier. Ich antworte in Worten, mit den Zahlen, und sage, welche Tabellen ich gelesen habe.",
    "placeholder": "Fragen Sie nach diesen Daten …",
    "chip1": "Wie viele Zeilen werden hier angezeigt?",
    "chip2": "Fasse zusammen, was diese Seite zeigt",
    "chip3": "Was hat sich zuletzt geändert?",
    "workTitle": "Daten gelesen",
    "scopePrimary": "diese Seite",
    "readPage": "{page} · {table} · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "readPageNoTable": "{tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "confirm": {
      "title": "Hier gibt es nichts zu speichern",
      "body": "{name} entwirft auf dieser Seite nichts.",
      "button": "Schließen"
    }
  },
  "general": {
    "page": "Dieser Arbeitsbereich",
    "blurb": "Kennt diesen Arbeitsbereich · {tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}",
    "greeting": "Ich kann die Tabellen lesen, die Ihre Rolle lesen darf, und Ihnen sagen, wo etwas erledigt wird.",
    "greetingSub": "Fragen Sie nach Ihren Daten oder danach, wo sich etwas ändern lässt. Ich antworte in Worten und verlinke die Stelle.",
    "placeholder": "Fragen Sie nach diesem Arbeitsbereich …",
    "chip1": "Wo lade ich eine Kollegin oder einen Kollegen ein?",
    "chip2": "Was kann ich in diesem Arbeitsbereich sehen?",
    "chip3": "Welche Tabelle hat die meisten Zeilen?",
    "workTitle": "Nachgeschlagen",
    "scopePrimary": "Arbeitsbereich",
    "readPage": "{tables, plural, one {# lesbare Tabelle} other {# lesbare Tabellen}}"
  },
  "answer": {
    "from": "Aus:",
    "part": "{returned, number} von {total, number} Zeilen aus {table} gelesen.",
    "nothingRead": "Für diese Antwort wurde nichts gelesen.",
    "readAgain": "Erneut lesen",
    "readAgainAsk": "{question} Lies die Daten, um zu antworten.",
    "forgot": "{name} hat {count, plural, one {die erste Nachricht} other {die ersten # Nachrichten}} nicht mehr im Blick."
  },
  "suggestion": {
    "open": "Öffnen",
    "openLabel": "{addOn} unter Add-ons öffnen",
    "askAdmin": "Bitten Sie eine Administratorin oder einen Administrator, dies zu installieren."
  },
  "panel": {
    "loading": "Unterhaltung wird geladen …",
    "recordOpen": "{page} · {record} geöffnet",
    "rowsShown": "{page} · {rows, plural, one {# Zeile angezeigt} other {# Zeilen angezeigt}}",
    "new": "Neue Unterhaltung",
    "earlier": "{count, plural, one {# frühere Nachricht wird} other {# frühere Nachrichten werden}} nicht angezeigt.",
    "onPage": "auf {page}",
    "closedElsewhere": "Diese Unterhaltung wurde in einem anderen Fenster geschlossen.",
    "stillWorking": "{name} arbeitet noch an Ihrer letzten Frage.",
    "stop": "Stopp",
    "pageDialog": "Schließen Sie, was auf der Seite geöffnet ist, um {name} zu verwenden.",
    "aged": "Ihre frühere Unterhaltung wurde wegen ihres Alters geschlossen."
  },
  "chip": {
    "selected": "{count, plural, one {# ausgewählt} other {# ausgewählt}}",
    "record": "Der geöffnete Datensatz",
    "filtered": "{rows, plural, one {# gefilterte Zeile} other {# gefilterte Zeilen}}",
    "filteredUnknown": "Gefilterte Zeilen",
    "remove": "Ohne „{label}“ fragen"
  },
  "parked": {
    "madeOn": "Erstellt auf {page}.",
    "open": "{page} öffnen, um diesen Entwurf zu verwenden",
    "deleted": "Das Dokument dieses Entwurfs wurde gelöscht."
  },
  "proposal": {
    "checking": {
      "title": "Eine Änderung zum Bestätigen",
      "line": "Es wird geprüft, was sich ändern würde…"
    },
    "badge": {
      "replaced": "Ersetzt",
      "expired": "Abgelaufen",
      "cancelled": "Abgebrochen",
      "parked": "Geparkt"
    },
    "replaced": "Danach wurde etwas anderes gefragt. Nichts wurde geändert.",
    "expired": "Dieser Vorschlag ist 30 Minuten alt. Frag noch einmal.",
    "overCap": "Das sind {count} Änderungen; höchstens {cap} lassen sich auf einmal bestätigen. Für mehr nutze die Sammelfunktionen der Seite.",
    "applying": "Wird ausgeführt…",
    "undone": "Rückgängig gemacht. Alles ist wie zuvor.",
    "undonePart": "{count, plural, one {# Änderung wurde} other {# Änderungen wurden}} zurückgenommen.",
    "undoneRest": "Der Rest bleibt geändert.",
    "interrupted": "Das wurde mittendrin unterbrochen.",
    "group": {
      "done": "Erledigt",
      "check": "Diesen Eintrag prüfen",
      "checkLine": "Das Speichern wurde abgeschnitten. Es kann geändert sein oder nicht.",
      "notTried": "Nicht versucht",
      "shared": "{field} {arrow} {value} in {count, plural, one {# Zeile} other {# Zeilen}}"
    },
    "openHome": "{page} öffnen",
    "notTried": "Nicht versucht: zu viele Anfragen auf einmal. Frag in einer Minute noch einmal.",
    "again": "Den Rest noch einmal vorschlagen",
    "againAsk": "Schlage die Änderungen noch einmal vor, die nicht gemacht wurden:\n{rows}",
    "undo": "Rückgängig",
    "undoSome": "{count} von {total} rückgängig machen",
    "undoPassed": "Die Zeit zum Rückgängigmachen ist vorbei.",
    "noUndo": "Das lässt sich von hier aus nicht rückgängig machen.",
    "noUndoSome": "{count, plural, one {# Änderung lässt} other {# Änderungen lassen}} sich von hier aus nicht rückgängig machen.",
    "notChanged": "{count, plural, one {Dieser Eintrag wurde} other {Diese # wurden}} nicht geändert:",
    "cancelled": "Nichts wurde geändert.",
    "parked": "Öffne {page}, um das zu nutzen.",
    "someRefused": "{refused} von {count, plural, one {# Änderung} other {# Änderungen}} können nicht gemacht werden.",
    "changedSince": "Das hat sich geändert, seit es dir gezeigt wurde. Sieh es dir vor dem Bestätigen noch einmal an.",
    "fix": "{name} bitten, das zu korrigieren",
    "fixAsk": "Ein Teil davon geht nicht. Schlage es ohne diese noch einmal vor:\n{reasons}",
    "send": {
      "template": "Vorlage",
      "subject": "Betreff",
      "to": "An",
      "roles": "alle mit der Rolle {roles} ({count, plural, one {# Person} other {# Personen}})",
      "open": "Vorlage öffnen",
      "skipped": "{count, plural, one {# Person hat sich abgemeldet und bekommt nichts.} other {# Personen haben sich abgemeldet und bekommen nichts.}}"
    },
    "more": "{count} weitere. Groß öffnen, um alle zu sehen.",
    "irreversible": "Das lässt sich nicht rückgängig machen.",
    "chosen": "{picked} von {count} gewählt",
    "large": "Groß öffnen",
    "doc": {
      "email": "E-Mail-Vorlage",
      "report": "Bericht",
      "rule": "Regel",
      "invoice": "Rechnung",
      "invoiceTemplate": "Rechnungsvorlage"
    },
    "ask": {
      "change": "{count, plural, one {# Zeile} other {# Zeilen}} ändern",
      "add": "{count, plural, one {# Zeile} other {# Zeilen}} hinzufügen",
      "delete": "{count, plural, one {# Zeile} other {# Zeilen}} löschen",
      "save": "Als neu speichern: {what}",
      "saveOver": "„{name}“ überschreiben",
      "deleteDoc": "„{name}“ löschen",
      "deleteDocs": "{count, plural, one {# Dokument} other {# Dokumente}} löschen",
      "send": "An {count, plural, one {# Person} other {# Personen}} senden",
      "mixed": "{count, plural, one {# Änderung} other {# Änderungen}} vornehmen"
    },
    "done": {
      "changePart": "{done} von {count, plural, one {# Zeile} other {# Zeilen}} geändert.",
      "part": "{done} von {count, plural, one {# Änderung} other {# Änderungen}} gemacht.",
      "change": "{count, plural, one {# Zeile} other {# Zeilen}} geändert.",
      "add": "{count, plural, one {# Zeile} other {# Zeilen}} hinzugefügt.",
      "delete": "{count, plural, one {# Zeile} other {# Zeilen}} gelöscht.",
      "save": "Gespeichert.",
      "deleteDoc": "{count, plural, one {# Dokument} other {# Dokumente}} gelöscht.",
      "send": "Wird an {count, plural, one {# Person} other {# Personen}} gesendet.",
      "mixed": "{count, plural, one {# Änderung} other {# Änderungen}} gemacht."
    },
    "refused": {
      "generic": "Der Server hat das abgelehnt.",
      "switchedOff": "Das ist für {name} in diesem Arbeitsbereich ausgeschaltet.",
      "notThisTable": "Von hier aus lässt sich nur die Tabelle der Seite ändern, auf der gefragt wurde.",
      "notData": "Das ist keine Tabelle deiner Daten.",
      "noChange": "Die Zeile enthält diese Werte bereits.",
      "unsafeKey": "Diese ID kann nicht verwendet werden.",
      "notFound": "Das gibt es nicht mehr.",
      "notOffered": "Das geht von hier aus nicht.",
      "builtIn": "Eine eingebaute Mail wird auf ihrer eigenen Seite geändert.",
      "notCampaign": "Nur eine Kampagne kann an Personen gesendet werden.",
      "noRecipients": "Niemand würde diese Mail bekommen.",
      "notLive": "Ein Entwurf wird von einer Person eingeschaltet, bevor er gesendet werden kann."
    },
    "row": {
      "untitled": "Ohne Titel",
      "new": "Neue Zeile",
      "switchesOff": "Wird ausgeschaltet gespeichert: Schalte sie wieder ein, wenn du sie angesehen hast."
    },
    "delete": {
      "reference": "{count} in {table}",
      "references": "Andere Zeilen verweisen darauf: {list}. Sie werden mit entfernt oder geändert, wie beim Löschen auf der Seite selbst."
    },
    "noneAble": "Nichts davon lässt sich machen",
    "checkAgain": "Erneut prüfen",
    "undoFailed": "{count, plural, one {# Änderung konnte} other {# Änderungen konnten}} nicht zurückgenommen werden. Versuch es noch einmal.",
    "parkedNoHome": "Geh zurück zu {page}, wo das gefragt wurde, um es zu nutzen."
  },
  "leftOut": {
    "title": "Was ich ausgelassen habe und warum",
    "nothing": "Nichts."
  }
} as const;
