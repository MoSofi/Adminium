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
