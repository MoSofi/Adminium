/**
 * GENERATED MIRROR of ../../../locales/de-DE/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "Schließen",
    "cancel": "Abbrechen",
    "confirm": "Bestätigen",
    "save": "Speichern",
    "apply": "Anwenden",
    "delete": "Löschen",
    "edit": "Bearbeiten",
    "copy": "Kopieren",
    "copied": "Kopiert",
    "undo": "Rückgängig",
    "retry": "Erneut versuchen",
    "clear": "Leeren",
    "selectAll": "Alle auswählen",
    "clearSelection": "Auswahl aufheben",
    "showPassword": "Passwort anzeigen",
    "hidePassword": "Passwort verbergen",
    "reveal": "Einblenden",
    "hide": "Ausblenden"
  },
  "state": {
    "loading": "Wird geladen…",
    "empty": "Noch nichts vorhanden",
    "noResults": "Keine Ergebnisse",
    "optional": "Optional",
    "required": "Erforderlich",
    "error": "Etwas ist schiefgelaufen"
  },
  "pagination": {
    "previous": "Zurück",
    "next": "Weiter",
    "pageOf": "Seite {page, number} von {pages, number}",
    "rowsPerPage": "Zeilen pro Seite",
    "range": "{from, number}–{to, number} von {total, number}"
  },
  "table": {
    "sortAscending": "Aufsteigend sortieren",
    "sortDescending": "Absteigend sortieren",
    "rowActions": "Zeilenaktionen",
    "selectRow": "Zeile auswählen",
    "selectAllRows": "Alle Zeilen auswählen"
  },
  "dialog": {
    "close": "Dialog schließen",
    "confirmTitle": "Sind Sie sicher?"
  },
  "combobox": {
    "placeholder": "Auswählen…",
    "search": "Suchen…",
    "noMatches": "Keine Treffer"
  },
  "toast": {
    "dismiss": "Benachrichtigung schließen"
  },
  "widgets": {
    "kpi": {
      "statCard": {
        "description": "Die Standard-Kennzahlenkarte: ein Hauptwert mit optionaler Trendplakette und Mini-Sparkline."
      },
      "usageMeter": {
        "description": "Kontingentverbrauch gegen ein Limit; der Balken wechselt ab Ihren Schwellenwerten zu Gelb und dann zu Rot."
      },
      "statTileCompact": {
        "description": "Eine schmale Kennzahlenkachel mit Mikro-Label, Trend-Chip und 6-Balken-Spark – für dichte Reihen von 4 bis 6."
      },
      "metricHero": {
        "description": "Eine übergroße Kennzahl, die beim Laden hochzählt – mit Trendplakette, Spark und Zielfortschritt.",
        "goalLabel": "Ziel"
      },
      "statPairCard": {
        "description": "Zwei Kennzahlen nebeneinander; die zweite kann aus der ersten abgeleitet werden."
      },
      "gaugeRing": {
        "description": "Eine Ringanzeige für einen Wert oder Prozentsatz, eingefärbt nach dem Bereich, in den der Wert fällt."
      },
      "gaugeArc": {
        "description": "Ein Tachobogen mit qualitativen Bereichen und Zeiger; stellt auch ein Raster aus Anzeigen dar."
      },
      "periodComparison": {
        "description": "Dieser Zeitraum gegen den letzten als zwei Balken, mit der Differenz darunter.",
        "higherLabel": "höher",
        "lowerLabel": "niedriger",
        "flatLabel": "unverändert"
      },
      "microKpiSubtitle": {
        "description": "Eine einzeilige Kopfzeilen-Kennzahl aus einer Vorlage, live neu berechnet."
      },
      "autoInsights": {
        "description": "Bewertete Erkenntnisse – Hauptwert, Satz und Spark – mit Aktualisierungsrotation.",
        "emptyTitle": "Noch keine Erkenntnisse",
        "emptyBody": "Erkenntnisse erscheinen, sobald genug Daten für ein Muster vorliegen.",
        "refreshLabel": "Aktualisieren"
      }
    },
    "charts": {
      "boxplot": {
        "description": "Box-Whisker-Zusammenfassung der Streuung einer numerischen Spalte je Kategorie – Minimum, Quartile, Median und Maximum.",
        "emptyTitle": "Keine Verteilung darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern für Box-Plots."
      },
      "violin": {
        "description": "Gespiegelte Dichtekurven, die die Verteilung einer numerischen Spalte über Gruppen vergleichen.",
        "emptyTitle": "Keine Verteilung darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern für Dichteprofile."
      },
      "ridgeline": {
        "description": "Überlappende Dichtekämme, die eine numerische Spalte über geordnete Gruppen vergleichen.",
        "emptyTitle": "Keine Kämme darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern für Dichteprofile."
      },
      "scatterBubble": {
        "description": "Zwei numerische Spalten als Punkte, mit optionaler Blasengröße und Trendlinie.",
        "emptyTitle": "Keine Punkte darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern für die gewählten Spalten."
      },
      "hexbin": {
        "description": "Hex-gebinnte Dichte zweier numerischer Spalten, eingefärbt nach Zeilen je Kachel.",
        "emptyTitle": "Keine Dichte darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern zum Gruppieren."
      },
      "correlationMatrix": {
        "description": "Pearson-Korrelation zwischen gewählten numerischen Spalten, von stark positiv bis stark negativ.",
        "emptyTitle": "Nichts zu korrelieren",
        "emptyBody": "Wähle mindestens zwei numerische Spalten mit passenden Zeilen."
      },
      "parallelCoordinates": {
        "description": "Jeder Datensatz als Linie über mehrere normierte numerische Achsen, eingefärbt nach Kategorie.",
        "emptyTitle": "Keine Datensätze darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern über die gewählten Achsen."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "Ein fortlaufender Feed, wer was in Ihrem Workspace getan hat – neueste zuerst.",
        "emptyTitle": "Keine aktuelle Aktivität",
        "emptyBody": "Aktionen in Ihrem Workspace erscheinen hier."
      },
      "notificationFeed": {
        "description": "Gruppierte Benachrichtigungen mit Ungelesen-Status, Filtern und Inline-Aktionen.",
        "emptyTitle": "Keine Benachrichtigungen",
        "emptyBody": "Neue Benachrichtigungen erscheinen hier."
      },
      "realtimeFeed": {
        "description": "Ein Live-Ereignisstrom, der neue Einträge beim Eintreffen voranstellt.",
        "emptyTitle": "Warten auf Ereignisse",
        "emptyBody": "Live-Ereignisse erscheinen hier, sobald sie eintreten."
      },
      "timelineVertical": {
        "description": "Eine vertikale Zeitachse von Ereignissen, Releases, Vorfällen oder Ausführungsschritten.",
        "emptyTitle": "Noch nichts vorhanden",
        "emptyBody": "Ereignisse erscheinen auf dieser Zeitachse, sobald sie eintreten."
      },
      "unreadBadge": {
        "description": "Ein Zähler-Chip für ungelesene Elemente, synchron mit dem Feed-Status.",
        "unitLabel": "ungelesen"
      },
      "loadOlderPaginator": {
        "description": "Eine Schaltfläche im Fuß, die ältere Einträge stapelweise lädt, bis der Feed erschöpft ist.",
        "label": "Ältere laden",
        "loadingLabel": "Wird geladen …",
        "exhaustedLabel": "Nichts Älteres",
        "ofLabel": "von"
      },
      "toastStack": {
        "description": "Der Overlay-Host für Toasts: kurze Bestätigungen mit optionalem Rückgängig.",
        "undoLabel": "Rückgängig",
        "dismissLabel": "Schließen",
        "regionLabel": "Benachrichtigungen"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "Ein Monatsraster geplanter Termine mit Tages-Chips und Monatsnavigation.",
        "emptyTitle": "Nichts geplant",
        "emptyBody": "Geplante Termine erscheinen in diesem Kalender."
      },
      "dayAgenda": {
        "description": "Die Termine des ausgewählten Tages als zeitlich geordnete Agenda.",
        "emptyTitle": "Nichts geplant",
        "emptyBody": "Termine für den ausgewählten Tag erscheinen hier."
      },
      "scheduleMatrix": {
        "description": "Ein Schichtraster nach Ressource und Tag mit Abdeckung pro Tag und Legende.",
        "emptyTitle": "Keine Schichten geplant",
        "emptyBody": "Zugewiesene Schichten erscheinen in diesem Plan."
      },
      "capacityBoard": {
        "description": "Auslastungsbalken pro Mitglied mit Projektaufschlüsselung und Laststatus.",
        "emptyTitle": "Keine Auslastungsdaten",
        "emptyBody": "Die Auslastung der Mitglieder erscheint hier, sobald Zuweisungen bestehen."
      },
      "calendarLegendFilter": {
        "description": "Ereigniskategorien mit Anzahl; ein Klick filtert den Kalender daneben.",
        "emptyTitle": "Noch keine Kategorien",
        "emptyBody": "Ereigniskategorien erscheinen hier, sobald Termine vorhanden sind.",
        "uncategorizedLabel": "Ohne Kategorie"
      },
      "upcomingEventsList": {
        "description": "Die nächsten Termine in zeitlicher Reihenfolge, mit Verantwortlichen und Status.",
        "emptyTitle": "Nichts anstehend",
        "emptyBody": "Geplante Termine erscheinen hier, sobald sie angelegt werden."
      },
      "dateRangePicker": {
        "description": "Ein Datumsbereich mit Schnellauswahl, der die übrige Seite filtert.",
        "previousLabel": "Voriger Monat",
        "nextLabel": "Nächster Monat",
        "summaryLabel": "{n} Tage ausgewählt",
        "presets": {
          "7d": "Letzte 7 Tage",
          "30d": "Letzte 30 Tage",
          "90d": "Letzte 90 Tage",
          "mtd": "Laufender Monat",
          "qtd": "Laufendes Quartal",
          "ytd": "Laufendes Jahr"
        }
      },
      "scheduledJobsList": {
        "description": "Wiederkehrende Berichte und Exporte mit Rhythmus, nächster Ausführung und Ein/Aus-Schalter.",
        "emptyTitle": "Keine geplanten Aufgaben",
        "emptyBody": "Wiederkehrende Berichte und Exporte erscheinen hier, sobald sie geplant sind.",
        "nextRunLabel": "Nächste Ausführung",
        "toggleLabel": "Zeitplan aktivieren",
        "recipientsLabel": "Empfänger"
      }
    },
    "tables": {
      "masterList": {
        "description": "Eine auswählbare Liste von Datensätzen, die einen Detailbereich steuert.",
        "emptyTitle": "Keine Einträge",
        "emptyBody": "Einträge erscheinen hier, sobald sie vorhanden sind."
      },
      "logTable": {
        "description": "Ein Ereignisprotokoll mit Suche, Fehlerfilter und Zeilenaktionen.",
        "emptyTitle": "Keine Protokolleinträge",
        "emptyBody": "Ereignisse werden hier protokolliert, sobald sie eintreten."
      },
      "cardGallery": {
        "description": "Eine responsive Galerie von Objektkarten mit Status und Schnellaktionen.",
        "emptyTitle": "Nichts anzuzeigen",
        "emptyBody": "Einträge erscheinen hier als Karten."
      },
      "groupedSummaryTable": {
        "description": "Gruppierte Zeilen mit Aggregatspalten, aufklappbaren Details und Summen.",
        "emptyTitle": "Keine Zusammenfassung",
        "emptyBody": "Gruppierte Summen erscheinen hier, sobald Daten vorliegen."
      },
      "schemaTree": {
        "description": "Ein Explorer für Schemas, Tabellen und Spalten mit Typ- und Schlüssel-Badges.",
        "emptyTitle": "Kein Schema eingelesen",
        "emptyBody": "Verbinden Sie eine Datenbank, um ihr Schema hier zu erkunden."
      },
      "toggleMatrix": {
        "description": "Ein interaktives Raster boolescher Schalter für Rollen, Richtlinien oder Kanäle.",
        "emptyTitle": "Keine Matrix konfiguriert",
        "emptyBody": "Zeilen und Spalten erscheinen hier nach der Konfiguration."
      },
      "sparklineTable": {
        "description": "Metrikzeilen mit Mini-Sparkline, aktuellem Wert und einer Änderungs-Pille, die Gut/Schlecht berücksichtigt.",
        "emptyTitle": "Keine Metriken vorhanden",
        "emptyBody": "Metriken erscheinen hier, sobald Daten zum Auswerten vorliegen."
      },
      "topMoversList": {
        "description": "Die Metriken mit der stärksten Veränderung — je Metrik als gut oder schlecht bewertet.",
        "emptyTitle": "Keine Veränderungen",
        "emptyBody": "Metriken mit der stärksten Veränderung erscheinen hier."
      },
      "rankedEntityList": {
        "description": "Top-Einträge nach einer Metrik, jeweils mit Rang und proportionalem Balken.",
        "emptyTitle": "Noch keine Rangliste",
        "emptyBody": "Top-Einträge erscheinen hier, sobald Daten zum Sortieren vorliegen."
      },
      "accordionList": {
        "description": "Aufklappbare Zeilen mit Badge und Detailbereich, einzeln oder mehrfach geöffnet.",
        "emptyTitle": "Nichts zum Aufklappen",
        "emptyBody": "Einträge erscheinen hier, sobald welche vorhanden sind."
      },
      "comparisonMatrix": {
        "description": "Eine Funktionsmatrix zum Vergleich von Tarifen, mit einer hervorgehobenen Spalte.",
        "includedLabel": "Enthalten",
        "notIncludedLabel": "Nicht enthalten",
        "promotedLabel": "Empfohlen"
      },
      "chipCloud": {
        "description": "Umbrechende Chips für gefundene Tabellen, Platzhalter oder Vorschläge.",
        "emptyTitle": "Noch nichts gefunden",
        "emptyBody": "Tabellen und Variablen erscheinen hier als Chips, sobald sie gefunden werden.",
        "moreLabel": "+{n} weitere"
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "Feste Statusspalten mit ziehbaren Karten; ziehen Sie eine Karte in eine andere Spalte, um ihren Status zu ändern.",
        "emptyTitle": "Noch keine Karten",
        "emptyBody": "Karten erscheinen in ihren Statusspalten, sobald Datensätze angelegt werden."
      },
      "kanbanSwimlaneGrid": {
        "description": "Ein Raster aus Bahnen × Spalten; das Ziehen einer Karte weist ihr sowohl Bahn als auch Status neu zu.",
        "emptyTitle": "Keine Swimlanes vorhanden",
        "emptyBody": "Gruppieren Sie Datensätze nach einem Bahnen- und einem Statusfeld, um das Raster zu erstellen."
      },
      "addCard": "Karte hinzufügen",
      "grip": "Zum Verschieben ziehen",
      "pointsUnit": "Pkt.",
      "laneSummary": "Σ{points} Pkt. · {count}",
      "a11y": {
        "grabbed": "{title} aufgenommen. Mit den Pfeiltasten bewegen, Enter zum Ablegen, Escape zum Abbrechen.",
        "over": "{title} befindet sich über {cell}.",
        "moved": "{title} nach {cell} verschoben.",
        "returned": "{title} an die ursprüngliche Position zurückgesetzt.",
        "failed": "{title} konnte nicht verschoben werden; die Karte wurde zurückgesetzt."
      },
      "boardCard": {
        "description": "Eine einzelne Board-Karte: Tag, Titel, Fortschritt, Verantwortliche und Fälligkeit.",
        "emptyTitle": "Keine Karte",
        "emptyBody": "Dieser Karte ist noch kein Datensatz zugeordnet."
      },
      "inlineComposeCard": {
        "description": "Schnellerfassung, die einen neuen Datensatz mit den Standardwerten der Spalte anlegt.",
        "placeholder": "Kartentitel…",
        "addLabel": "Hinzufügen",
        "cancelLabel": "Abbrechen",
        "openLabel": "Karte hinzufügen"
      }
    },
    "communication": {
      "conversationInbox": {
        "description": "Eine auswählbare Liste von Unterhaltungen mit Ungelesen-Zählern, Präsenz und Vorschau der letzten Nachricht.",
        "emptyTitle": "Keine Unterhaltungen",
        "emptyBody": "Unterhaltungen erscheinen hier, sobald Nachrichten eintreffen.",
        "noMatchesTitle": "Keine passenden Unterhaltungen",
        "searchLabel": "Unterhaltungen durchsuchen",
        "searchPlaceholder": "Unterhaltungen durchsuchen…"
      },
      "chatThread": {
        "description": "Nachrichtenblasen, gruppiert nach Absender und Tag, mit Anhängen und Eingabefeld.",
        "emptyTitle": "Noch keine Nachrichten",
        "emptyBody": "Nachrichten dieser Unterhaltung erscheinen hier.",
        "composerPlaceholder": "Nachricht schreiben…",
        "sendLabel": "Senden",
        "attachLabel": "Anhang hinzufügen",
        "typingLabel": "tippt…"
      },
      "aiChatPanel": {
        "description": "Ein Assistenz-Panel für Fragen zu Ihrem Schema und Ihren Daten.",
        "emptyTitle": "Fragen Sie zu Ihren Daten",
        "emptyBody": "Stellen Sie eine Frage zu Ihrem Schema, Ihren Tabellen oder Kennzahlen, um zu beginnen.",
        "composerPlaceholder": "Frage stellen…",
        "sendLabel": "Senden",
        "pendingLabel": "Denkt nach…",
        "configureTitle": "Kein KI-Anbieter konfiguriert",
        "configureBody": "Fügen Sie einen Anthropic- oder OpenAI-Schlüssel hinzu — oder verweisen Sie Adminium auf Ihren eigenen Endpunkt —, um Fragen zu Ihrem Schema zu stellen.",
        "configureCtaLabel": "Anbieter konfigurieren"
      },
      "typingIndicator": {
        "description": "Ein Avatar und eine kursive Zeile „tippt …“, gebunden an einen Live-Status pro Unterhaltung.",
        "label": "tippt …",
        "emptyTitle": "Keine Tippaktivität",
        "emptyBody": "Der Tippstatus erscheint hier, sobald die Unterhaltung aktiv ist."
      },
      "callWidget": {
        "description": "Ein eingehender Sprach- oder Videoanruf: Avatar des Anrufers, Anrufstatus sowie Aktionen zum Annehmen oder Ablehnen.",
        "voiceLabel": "Sprachanruf",
        "videoLabel": "Videoanruf",
        "ringingLabel": "Klingelt …",
        "connectingLabel": "Verbindung wird hergestellt …",
        "activeLabel": "Im Gespräch",
        "endedLabel": "Anruf beendet",
        "acceptLabel": "Annehmen",
        "declineLabel": "Ablehnen",
        "endLabel": "Anruf beenden",
        "emptyTitle": "Kein aktiver Anruf",
        "emptyBody": "Ein eingehender Anruf erscheint hier."
      }
    },
    "geo": {
      "mapBubble": {
        "description": "Eine Karte, deren Kreismarkierungen sich nach der gewählten Kennzahl skalieren, samt Rangliste der wichtigsten Orte.",
        "emptyTitle": "Keine Standorte",
        "emptyBody": "Zeilen mit Breiten- und Längengrad erscheinen hier als Kartenmarkierungen.",
        "mapUnavailableLabel": "Die Karte konnte nicht geladen werden. Die Rangliste zeigt dieselben Daten.",
        "regionsLabel": "Top-Regionen",
        "metricLabel": "Kennzahl"
      },
      "mapChoroplethGrid": {
        "description": "Nach Wert eingefärbte Regionskacheln – für Tabellen mit Regionscodes, aber ohne Koordinaten.",
        "emptyTitle": "Keine Regionen",
        "emptyBody": "Zeilen mit Regionscode und numerischem Wert erscheinen hier als eingefärbte Kacheln.",
        "legendLowLabel": "Niedrig",
        "legendHighLabel": "Hoch"
      }
    },
    "domain": {
      "orgChart": {
        "description": "Der Berichtsbaum aus dem Vorgesetzten-Verweis einer Personentabelle, mit einklappbaren Zweigen.",
        "emptyTitle": "Keine Berichtsstruktur",
        "emptyBody": "Das Organigramm erscheint, sobald Personenzeilen auf eine Führungskraft verweisen.",
        "reportsLabel": "Unterstellte · {count}",
        "a11yLabel": "Organigramm"
      },
      "ganttChart": {
        "description": "Aufgabenbalken auf einer Zeitachse, nach Phase gruppiert, mit Fortschritt, Meilensteinen und Heute-Markierung.",
        "emptyTitle": "Nichts geplant",
        "emptyBody": "Aufgaben erscheinen hier, sobald sie ein Start- und Enddatum haben.",
        "ungroupedLabel": "Aufgaben"
      },
      "documentCanvas": {
        "description": "Eine Dokumentfläche im Papierstil — Rechnung, Bericht oder E-Mail — deren Blöcke ausgewählt, umsortiert und entfernt werden können.",
        "emptyTitle": "Nichts in diesem Dokument",
        "emptyBody": "Fügen Sie einen Block aus der Palette hinzu, um das Dokument aufzubauen.",
        "addBlockLabel": "Block hinzufügen",
        "removeBlockLabel": "Block entfernen",
        "moveUpLabel": "Block nach oben verschieben",
        "moveDownLabel": "Block nach unten verschieben",
        "blockListLabel": "Dokumentblöcke",
        "billedToLabel": "Rechnung an",
        "issuedLabel": "Ausgestellt",
        "dueLabel": "Fällig"
      },
      "blockTotalsSummary": {
        "description": "Die Dokumentsummen — Zwischensumme, Rabatt, Steuer und Gesamtbetrag, neu berechnet aus den Positionen.",
        "emptyTitle": "Noch keine Summen",
        "emptyBody": "Summen erscheinen, sobald das Dokument Positionen enthält.",
        "subtotalLabel": "Zwischensumme",
        "discountLabel": "Rabatt",
        "taxLabel": "Steuer",
        "totalLabel": "Gesamtbetrag"
      },
      "blockLineItems": {
        "description": "Bearbeitbare Zeilen für Beschreibung, Menge und Satz, die in die Dokumentsummen einfließen.",
        "emptyTitle": "Keine Positionen",
        "emptyBody": "Fügen Sie eine Position hinzu, um Leistungen abzurechnen.",
        "descHeader": "Beschreibung",
        "qtyHeader": "Menge",
        "rateHeader": "Satz",
        "amountHeader": "Betrag"
      },
      "blockKpiRow": {
        "description": "Eine Reihe von Kennzahlkacheln mit vorzeichenabhängiger Delta-Färbung.",
        "emptyTitle": "Keine Kennzahlen",
        "emptyBody": "Kennzahlen erscheinen hier, sobald der Bericht Werte enthält."
      },
      "blockBarChart": {
        "description": "Ein Mini-Balkendiagramm in der Dokumentfarbe, passend für einen Dokumentblock.",
        "emptyTitle": "Keine Daten für das Diagramm",
        "emptyBody": "Die Balken erscheinen, sobald der Bericht eine Datenreihe enthält."
      },
      "blockLineChart": {
        "description": "Ein Mini-Liniendiagramm mit optionaler Flächenfüllung, passend für einen Dokumentblock.",
        "emptyTitle": "Keine Daten für das Diagramm",
        "emptyBody": "Die Linie erscheint, sobald der Bericht eine Datenreihe enthält."
      },
      "blockTwoColTable": {
        "description": "Eine zweispaltige Tabelle mit gestalteter Kopfzeile und Wertespalte in Monospace.",
        "emptyTitle": "Keine Zeilen",
        "emptyBody": "Zeilen erscheinen hier, sobald der Bericht Werte enthält."
      },
      "blockTaxBreakdown": {
        "description": "Steuerzeilen mit Bezeichnung, Satz und Betrag, angewendet auf die Zwischensumme.",
        "emptyTitle": "Keine Steuerzeilen",
        "emptyBody": "Steuerzeilen erscheinen, sobald das Dokument Sätze enthält."
      },
      "blockMultiCurrency": {
        "description": "Der Dokumentbetrag, je Währung zum angegebenen Kurs umgerechnet.",
        "emptyTitle": "Keine Umrechnungen",
        "emptyBody": "Umrechnungen erscheinen, sobald das Dokument Wechselkurse enthält.",
        "footnote": "Die Kurse sind unverbindlich und können bei der Abrechnung abweichen."
      },
      "blockPaymentHistory": {
        "description": "Frühere Zahlungen mit Datum, maskierter Zahlungsart, Betrag und Statuskennzeichen.",
        "emptyTitle": "Noch keine Zahlungen",
        "emptyBody": "Zahlungen zu diesem Dokument erscheinen hier."
      },
      "blockDiscountCodes": {
        "description": "Eingelöste Rabattcodes mit Bezeichnung und gutgeschriebenem Betrag.",
        "emptyTitle": "Keine Rabatte eingelöst",
        "emptyBody": "Auf dieses Dokument angewendete Rabattcodes erscheinen hier."
      },
      "blockLoyaltyBanner": {
        "description": "Ein Treuebanner mit Punktestand, Stufe und den mit dieser Bestellung erworbenen Punkten.",
        "emptyTitle": "Kein Punktestand",
        "emptyBody": "Das Treuebanner erscheint, sobald die Kundin oder der Kunde Punkte hat.",
        "balanceLabel": "{balance} Pkt. · {tier}",
        "earnedLabel": "+{earned} mit dieser Bestellung erworben"
      },
      "blockRecurringBanner": {
        "description": "Ein Banner mit Abrechnungsintervall, nächstem Abbuchungsdatum und verbleibenden Zyklen.",
        "emptyTitle": "Nicht wiederkehrend",
        "emptyBody": "Dieses Banner erscheint, sobald das Dokument wiederkehrend abgerechnet wird.",
        "template": "Wiederkehrend — {freq} · Nächste am {next} · {count} Zyklen"
      },
      "blockQrPay": {
        "description": "Eine Scan-und-zahlen-Kachel mit Bildunterschrift und fälligem Betrag.",
        "emptyTitle": "Nichts zu zahlen",
        "emptyBody": "Der Zahlcode erscheint, sobald das Dokument einen fälligen Betrag hat.",
        "amountLabel": "Fälliger Betrag"
      },
      "blockDeliveryStepper": {
        "description": "Waagerechte Lieferschritte, markiert als erledigt, aktuell oder ausstehend.",
        "emptyTitle": "Keine Lieferschritte",
        "emptyBody": "Schritte erscheinen, sobald die Bestellung einen Lieferweg hat."
      },
      "blockSignature": {
        "description": "Unterschriftslinien für Name und Funktion, mit Unterschriftsdatum.",
        "emptyTitle": "Keine Unterschrift",
        "emptyBody": "Die Unterschriftslinien erscheinen, sobald das Dokument eine unterzeichnende Person nennt.",
        "namePlaceholder": "Vollständiger Name",
        "titlePlaceholder": "Funktion",
        "dateLabel": "Datum"
      },
      "blockTermsCheckbox": {
        "description": "Ein Schalter für die Bedingungen mit bearbeitbarer Beschriftung.",
        "defaultLabel": "Ich akzeptiere die Allgemeinen Geschäftsbedingungen"
      },
      "blockApproval": {
        "description": "Eine Freigabekarte mit statusgefärbtem Kennzeichen und optionalen Aktionen zum Genehmigen oder Ablehnen.",
        "emptyTitle": "Keine freigebende Person",
        "emptyBody": "Die Freigabekarte erscheint, sobald das Dokument eine freigebende Person nennt.",
        "approveLabel": "Genehmigen",
        "rejectLabel": "Ablehnen",
        "pendingLabel": "Ausstehend",
        "approvedLabel": "Genehmigt",
        "rejectedLabel": "Abgelehnt"
      },
      "blockAttachments": {
        "description": "Angehängte Dateien mit Namen und Größe.",
        "emptyTitle": "Keine Anhänge",
        "emptyBody": "An dieses Dokument angehängte Dateien erscheinen hier."
      },
      "blockLateFees": {
        "description": "Ein Warnhinweis mit der Mahngebühr und der Zahlungsfrist.",
        "emptyTitle": "Keine Mahngebühr",
        "emptyBody": "Dieser Hinweis erscheint, sobald das Dokument eine Mahngebühr festlegt.",
        "template": "Nach {days} Tagen fällt eine Mahngebühr von {rate} an."
      },
      "blockImagePlaceholder": {
        "description": "Ein gestrichelter Platzhalter für ein Bild, mit Bildunterschrift.",
        "emptyTitle": "Kein Bild",
        "emptyBody": "Der Platzhalter erscheint, sobald der Block eine Bildunterschrift hat."
      },
      "blockContact": {
        "description": "Kontaktzeilen für Name, E-Mail-Adresse und Telefonnummer.",
        "emptyTitle": "Kein Kontakt",
        "emptyBody": "Kontaktdaten erscheinen, sobald das Dokument einen Kontakt nennt."
      },
      "blockHighlightBox": {
        "description": "Ein Hinweisfeld, das eine Beschriftung mit einem großen Wert in Monospace verbindet.",
        "emptyTitle": "Nichts hervorzuheben",
        "emptyBody": "Das Hinweisfeld erscheint, sobald der Block einen Wert hat."
      }
    },
    "media": {
      "fileBrowser": {
        "description": "Durchsuchen Sie Dateien und Ordner als Kachelraster oder Liste – mit Brotkrumenpfad, Typsymbolen und Favoriten.",
        "emptyTitle": "Dieser Ordner ist leer",
        "emptyBody": "Laden Sie Dateien hoch oder legen Sie einen Ordner an, um zu beginnen."
      },
      "uploadDropzone": {
        "description": "Ein Drag-and-drop-Ziel zum Hochladen von Dateien, mit Format- und Größenbeschränkungen.",
        "dropTitle": "Dateien zum Hochladen ablegen",
        "browsePrefix": "oder",
        "browseLabel": "durchsuchen"
      },
      "uploadProgressList": {
        "description": "Zeilen pro Datei mit Fortschrittsbalken und Status; steuert auch Aufträge der Exportwarteschlange.",
        "emptyTitle": "Keine Uploads im Gange",
        "emptyBody": "Hochgeladene Dateien zeigen hier ihren Fortschritt."
      },
      "attachmentList": {
        "description": "An einen Datensatz angehängte Dateien, mit Typsymbolen, Größen sowie Aktionen zum Herunterladen oder Löschen.",
        "emptyTitle": "Keine Anhänge",
        "emptyBody": "An diesen Datensatz angehängte Dateien erscheinen hier."
      },
      "imageBoard": {
        "description": "Ein Moodboard-Raster aus Bildplätzen mit Bildunterschriften, für Tabellen mit Bild-URLs.",
        "emptyTitle": "Noch keine Bilder",
        "emptyBody": "Referenzbilder erscheinen auf diesem Board."
      },
      "linkList": {
        "description": "Referenzlinks mit Titeln und URLs, die in einem neuen Tab geöffnet werden.",
        "emptyTitle": "Noch keine Links",
        "emptyBody": "Referenzlinks erscheinen hier."
      },
      "root": "Dateien",
      "breadcrumb": "Brotkrumenpfad",
      "gridView": "Rasteransicht",
      "listView": "Listenansicht",
      "nameHeader": "Name",
      "sizeHeader": "Größe",
      "modifiedHeader": "Geändert",
      "star": "Favorit",
      "items": "Elemente",
      "done": "Fertig",
      "failed": "Fehlgeschlagen",
      "queued": "In Warteschlange",
      "retry": "Wiederholen",
      "download": "Herunterladen",
      "cancel": "Abbrechen",
      "delete": "Löschen",
      "remove": "Entfernen",
      "addImage": "Bild hinzufügen",
      "caption": "Bildunterschrift",
      "addLink": "Link hinzufügen",
      "linkTitlePlaceholder": "Titel",
      "linkUrlPlaceholder": "https://…",
      "add": "Hinzufügen"
    },
    "forms": {
      "modalWizard": {
        "description": "Ein modales Anlageformular mit Erfolgsbestätigung — der Standardablauf für neue Datensätze.",
        "trigger": "Anlegen",
        "submit": "Anlegen",
        "cancel": "Abbrechen",
        "done": "Fertig",
        "successTitle": "Datensatz angelegt",
        "successBody": "Der Datensatz wurde gespeichert.",
        "required": "Dieses Feld ist erforderlich."
      },
      "drawerForm": {
        "description": "Ein seitliches Formular zum Anlegen oder Bearbeiten von Datensätzen mit vielen Feldern.",
        "trigger": "Neu",
        "submit": "Speichern",
        "cancel": "Abbrechen"
      },
      "stepper": {
        "description": "Eine Fortschrittsanzeige, die den Stand eines mehrstufigen Ablaufs zeigt.",
        "a11yLabel": "Fortschritt"
      },
      "progressBar": {
        "description": "Ein Fortschrittsbalken mit Prozentangabe.",
        "label": "Fortschritt"
      },
      "otpInput": {
        "description": "Ein Eingabefeld für Einmalcodes.",
        "label": "Einmalcode"
      },
      "chipInput": {
        "description": "Eine Tag-Eingabe: entfernbare Chips plus Freitext, der mit Enter übernommen wird.",
        "remove": "Entfernen",
        "placeholder": "Tippen und Enter drücken…"
      },
      "segmentedControl": {
        "description": "Eine Einfachauswahl für Zeiträume, Umgebungen und Filter.",
        "a11yLabel": "Option wählen"
      },
      "filterChipBar": {
        "description": "Filter-Chips mit Live-Zählern, berechnet aus der gefilterten Liste.",
        "all": "Alle",
        "a11yLabel": "Filter",
        "meta": "{shown} von {total}"
      },
      "toggleSwitchList": {
        "description": "Eine Liste von Einstellungszeilen mit jeweils einem Schalter.",
        "save": "Speichern",
        "dirty": "Sie haben ungespeicherte Änderungen",
        "emptyTitle": "Keine Einstellungen",
        "emptyBody": "Einstellungen erscheinen hier, sobald sie konfiguriert sind."
      },
      "optionCards": {
        "description": "Eine Kartenauswahl für Quellen, Vorlagen und Tarife.",
        "a11yLabel": "Option wählen"
      },
      "ruleBuilder": {
        "description": "Ein Bedingungs-Editor, dessen Regeln zu einem Filter werden — der Segment-Editor.",
        "add": "Bedingung hinzufügen",
        "remove": "Bedingung entfernen",
        "all": "ALLE",
        "any": "BELIEBIGE",
        "field": "Feld",
        "operator": "Operator",
        "value": "Wert",
        "valuePlaceholder": "Wert…",
        "emptyBody": "Noch keine Bedingungen — fügen Sie eine hinzu, um dieses Segment zu definieren."
      },
      "flowBuilder": {
        "description": "Eine vertikale Workflow-Fläche aus Auslöser-, Bedingungs- und Aktionsschritten.",
        "add": "Schritt hinzufügen",
        "remove": "Schritt entfernen",
        "paletteTitle": "Schritt hinzufügen",
        "stats": "{runs} Durchläufe · {rate} % erfolgreich",
        "emptyBody": "Noch keine Schritte — fügen Sie einen Auslöser hinzu, um den Workflow zu starten."
      },
      "connectionStringField": {
        "description": "Ein Verbindungszeichenfolgen-Feld, das die Datenbank-Engine beim Tippen erkennt.",
        "label": "Verbindungszeichenfolge",
        "helper": "postgres://user:passwort@host:5432/datenbank — mysql:// und sqlite: gehen auch.",
        "quickFill": "Schnell ausfüllen:",
        "host": "Host: {host}",
        "invalidScheme": "Unbekanntes Schema in der Verbindungszeichenfolge.",
        "incomplete": "Ergänzen Sie Host und Datenbank in der Verbindungszeichenfolge."
      },
      "tableInclusionChecklist": {
        "description": "Die einzubeziehenden Tabellen, mit Zeilenzahlen und PII-Warnungen.",
        "pii": "PII",
        "highVolume": "hohes Volumen",
        "a11yLabel": "Einzubeziehende Tabellen",
        "emptyTitle": "Keine Tabellen gefunden",
        "emptyBody": "Verbinden Sie eine Datenbank, dann erscheinen hier ihre Tabellen."
      },
      "columnMappingTable": {
        "description": "Ordnet die Spalten einer hochgeladenen Datei den Feldern einer Tabelle zu.",
        "skip": "Nicht importieren",
        "sourceHeader": "Quellspalte",
        "sampleHeader": "Beispiel",
        "targetHeader": "Zielfeld",
        "emptyTitle": "Keine Spalten zuzuordnen",
        "emptyBody": "Laden Sie eine Datei hoch, dann erscheinen hier ihre Spalten."
      },
      "validationIssuesList": {
        "description": "Import- und Validierungsprobleme, schwerwiegendste zuerst, mit Zeilenanzahl.",
        "emptyTitle": "Keine Probleme gefunden",
        "emptyBody": "Alles in Ordnung — der Import kann starten."
      },
      "exportBuilder": {
        "description": "Erstellt einen Datenexport: Format, Zeitraum und Inhalt.",
        "format": "Format",
        "from": "Von",
        "to": "Bis",
        "groupBy": "Gruppieren nach",
        "includeCharts": "Diagramme einschließen",
        "email": "Export per E-Mail senden",
        "submit": "Exportieren",
        "running": "Export wird vorbereitet…",
        "done": "Export bereit",
        "failed": "Der Export ist fehlgeschlagen. Bitte erneut versuchen.",
        "download": "Herunterladen"
      },
      "questionBuilder": {
        "description": "Ein Umfrage-Editor: Fragetypen hinzufügen und Fragen umsortieren.",
        "paletteTitle": "Frage hinzufügen",
        "add": "Frage hinzufügen",
        "remove": "Frage entfernen",
        "moveUp": "Nach oben",
        "moveDown": "Nach unten",
        "required": "Pflichtfeld",
        "questionPlaceholder": "Stellen Sie eine Frage…",
        "emptyTitle": "Noch keine Fragen",
        "emptyBody": "Wählen Sie einen Fragetyp, um Ihre Umfrage zu erstellen."
      },
      "inlineEditableField": {
        "description": "Ein per Klick bearbeitbarer Wert in einem Dokument oder auf einer Fläche.",
        "edit": "Bearbeiten",
        "save": "Speichern",
        "cancel": "Abbrechen",
        "empty": "Leer"
      },
      "passwordStrengthMeter": {
        "description": "Eine vierstufige Anzeige der Passwortstärke.",
        "label": "Passwortstärke",
        "weak": "Schwach",
        "fair": "Mäßig",
        "good": "Gut",
        "strong": "Stark"
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "Die gruppierte Navigationsleiste der App mit Live-Zählern.",
        "a11yLabel": "Hauptnavigation",
        "emptyTitle": "Noch keine Navigation",
        "emptyBody": "Einbezogene Tabellen erscheinen hier, sobald eine Verbindung generiert wurde."
      },
      "commandPalette": {
        "description": "Die ⌘K-Palette: Aktionen, Seiten und Datensätze von überall suchen.",
        "title": "Befehlspalette",
        "placeholder": "Aktionen, Seiten und Datensätze suchen…",
        "navigate": "Navigieren",
        "select": "Öffnen",
        "close": "Schließen",
        "emptyTitle": "Keine Treffer",
        "emptyBody": "Zum Suchen tippen.",
        "groupActions": "Aktionen",
        "groupNavigate": "Navigieren",
        "groupRecent": "Zuletzt",
        "groupPages": "Seiten",
        "groupMetrics": "Kennzahlen",
        "groupPeople": "Personen",
        "groupRecords": "Datensätze"
      },
      "globalSearch": {
        "description": "Suche über alle Entitäten, mit Typ-Facetten und Ergebnisauszügen.",
        "placeholder": "Alles durchsuchen…",
        "all": "Alle",
        "summary": "{count} Treffer für „{query}“",
        "emptyTitle": "Keine Treffer",
        "emptyBody": "Versuchen Sie einen anderen Suchbegriff."
      },
      "breadcrumb": {
        "description": "Der Pfad zum aktuellen Datensatz oder Ordner.",
        "a11yLabel": "Navigationspfad"
      },
      "tabBar": {
        "description": "Tabs zum Wechseln von Bereichen oder Navigieren, optional mit Zählern.",
        "a11yLabel": "Tabs"
      },
      "navCard": {
        "description": "Ein Raster aus Link-Karten für Übersichts- und Startseiten.",
        "emptyTitle": "Nichts anzuzeigen",
        "emptyBody": "Links erscheinen hier, sobald Seiten generiert wurden."
      },
      "shortcutsPanel": {
        "description": "Die Übersicht der Tastenkürzel.",
        "footerHint": "Jederzeit ? drücken",
        "then": "dann",
        "emptyTitle": "Keine Tastenkürzel registriert."
      },
      "avatarStack": {
        "description": "Überlappende Avatare mit „+N“-Überlauf und optionaler Präsenz.",
        "online": "{count} online"
      }
    },
    "system": {
      "stateHero": {
        "description": "Eine ganzseitige Statusanzeige für 404, 500, Offline, Kein-Zugriff und Wartung.",
        "notFoundTitle": "Diese Seite hat sich verlaufen",
        "notFoundBody": "Die gesuchte Seite wurde verschoben, umbenannt oder existierte nie.",
        "serverErrorTitle": "Bei uns ist etwas schiefgelaufen",
        "serverErrorBody": "Der Fehler wurde protokolliert und das Team benachrichtigt. Ein erneuter Versuch hilft oft.",
        "offlineTitle": "Sie sind offline",
        "offlineBody": "Prüfen Sie Ihre Verbindung — das Dashboard verbindet sich automatisch neu.",
        "forbiddenTitle": "Sie haben keinen Zugriff",
        "forbiddenBody": "Bitten Sie eine Workspace-Administration um die Berechtigung für diese Seite.",
        "maintenanceTitle": "Wartungsarbeiten",
        "maintenanceBody": "Wir verbessern gerade etwas. Das dauert meist nur wenige Minuten.",
        "connErrorTitle": "Datenbank nicht erreichbar",
        "connErrorBody": "Die Verbindung wurde abgelehnt oder lief ab. Prüfen Sie die Verbindungseinstellungen.",
        "backToDashboard": "Zurück zum Dashboard",
        "tryAgain": "Erneut versuchen",
        "retry": "Wiederholen",
        "testConnection": "Verbindung testen"
      },
      "emptyState": {
        "description": "Ein zentriertes „Noch nichts da“-Panel mit optionalen Aktionen."
      },
      "statusPill": {
        "description": "Ein farbcodiertes Badge für Enum-Spalten — die universelle Statusanzeige."
      },
      "alertBanner": {
        "description": "Ein Inline-Hinweis für Kontingent-, Freeze- und Zeitplanmeldungen.",
        "dismiss": "Schließen"
      },
      "statusBannerHero": {
        "description": "Ein Service-Status-Hero, dessen Zustand sich aus dem schlechtesten Dienst der Liste ergibt.",
        "upTitle": "Alle Systeme betriebsbereit",
        "upBody": "Alle überwachten Dienste antworten normal.",
        "degradedTitle": "Eingeschränkte Leistung",
        "degradedBody": "Einige Dienste sind langsamer als üblich. Wir untersuchen das.",
        "downTitle": "Schwerwiegende Störung",
        "downBody": "Ein oder mehrere Dienste sind nicht verfügbar. Wir arbeiten daran."
      },
      "connectionStatus": {
        "description": "Das Verbindungs- bzw. Testergebnis einer Datenbankverbindung.",
        "idle": "Nicht verbunden",
        "connecting": "Verbindung wird hergestellt…",
        "connected": "Verbunden",
        "failed": "Verbindung fehlgeschlagen",
        "test": "Testen"
      },
      "autosaveIndicator": {
        "description": "Die Anzeige „ungespeichert → speichert → gespeichert“ für automatisch gespeicherte Dokumente.",
        "dirty": "Ungespeicherte Änderungen",
        "saving": "Speichert…",
        "saved": "Alle Änderungen gespeichert",
        "error": "Speichern fehlgeschlagen"
      },
      "progressLogConsole": {
        "description": "Eine Streaming-Logkonsole mit Fortschrittsbalken für lang laufende Aufgaben.",
        "a11yLabel": "Fortschrittsprotokoll",
        "progressLabel": "Fortschritt",
        "emptyTitle": "Noch nichts zu berichten",
        "emptyBody": "Logzeilen erscheinen hier, sobald die Aufgabe startet."
      },
      "diagnosticsReadout": {
        "description": "Ergebnisse der Verbindungsprüfung als farbcodierte Schlüssel/Wert-Zeilen mit Zeitstempel.",
        "checkedAt": "Zuletzt geprüft",
        "host": "Host",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "Authentifizierung",
        "latency": "Latenz"
      }
    }
  },
  "grid": {
    "dragHandle": "{title} zum Verschieben ziehen",
    "resizeHandle": "Größe von {title} ändern",
    "a11y": {
      "grabbed": "{title} aufgenommen. Mit den Pfeiltasten verschieben, Umschalt halten zum Ändern der Größe, Eingabe zum Speichern, Escape zum Abbrechen.",
      "moved": "{title} in Spalte {col}, Zeile {row} verschoben.",
      "resized": "Größe von {title} auf {w} Spalten mal {h} Zeilen geändert.",
      "committed": "{title} in Spalte {col}, Zeile {row} platziert.",
      "reverted": "{title} an die ursprüngliche Position zurückgesetzt."
    }
  }
} as const;
