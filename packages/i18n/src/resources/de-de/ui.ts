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
    "hide": "Ausblenden",
    "clearSearch": "Clear search"
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
        "description": "Kontingentverbrauch gegen ein Limit; der Balken wechselt ab Ihren Schwellenwerten zu Gelb und dann zu Rot.",
        "usageLabel": "Usage",
        "ofLabel": "of"
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
        "description": "Ein Tachobogen mit qualitativen Bereichen und Zeiger; stellt auch ein Raster aus Anzeigen dar.",
        "emptyTitle": "No gauges to show",
        "emptyBody": "Services appear here as gauges once there is a reading for them."
      },
      "periodComparison": {
        "description": "Dieser Zeitraum gegen den letzten als zwei Balken, mit der Differenz darunter.",
        "higherLabel": "höher",
        "lowerLabel": "niedriger",
        "flatLabel": "unverändert",
        "periodALabel": "This period",
        "periodBLabel": "Last period"
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
        "emptyBody": "Keine Zeilen entsprachen den Filtern für Box-Plots.",
        "chartLabel": "Box plot"
      },
      "violin": {
        "description": "Gespiegelte Dichtekurven, die die Verteilung einer numerischen Spalte über Gruppen vergleichen.",
        "emptyTitle": "Keine Verteilung darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern für Dichteprofile.",
        "chartLabel": "Violin plot"
      },
      "ridgeline": {
        "description": "Überlappende Dichtekämme, die eine numerische Spalte über geordnete Gruppen vergleichen.",
        "emptyTitle": "Keine Kämme darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern für Dichteprofile.",
        "chartLabel": "Ridgeline"
      },
      "scatterBubble": {
        "description": "Zwei numerische Spalten als Punkte, mit optionaler Blasengröße und Trendlinie.",
        "emptyTitle": "Keine Punkte darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern für die gewählten Spalten.",
        "chartLabel": "Scatter plot"
      },
      "hexbin": {
        "description": "Hex-gebinnte Dichte zweier numerischer Spalten, eingefärbt nach Zeilen je Kachel.",
        "emptyTitle": "Keine Dichte darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern zum Gruppieren.",
        "chartLabel": "Density hexbin"
      },
      "correlationMatrix": {
        "description": "Pearson-Korrelation zwischen gewählten numerischen Spalten, von stark positiv bis stark negativ.",
        "emptyTitle": "Nichts zu korrelieren",
        "emptyBody": "Wähle mindestens zwei numerische Spalten mit passenden Zeilen.",
        "chartLabel": "Correlation matrix"
      },
      "parallelCoordinates": {
        "description": "Jeder Datensatz als Linie über mehrere normierte numerische Achsen, eingefärbt nach Kategorie.",
        "emptyTitle": "Keine Datensätze darstellbar",
        "emptyBody": "Keine Zeilen entsprachen den Filtern über die gewählten Achsen.",
        "chartLabel": "Parallel coordinates"
      },
      "unexpectedShape": "Unexpected data shape.",
      "lineArea": {
        "chartLabel": "Line chart",
        "description": "A metric over time as a line with a soft area fill, with an optional dashed prior-period comparison."
      },
      "bar": {
        "chartLabel": "Bar chart",
        "description": "Categorical or time-bucketed values as vertical bars, with an optional highlight on the largest or current bar."
      },
      "donut": {
        "chartLabel": "Donut chart",
        "otherLabel": "Other",
        "description": "Category shares as donut slices with a legend and centre total, folding small slices into an Other bucket."
      },
      "bullet": {
        "chartLabel": "Bullet chart",
        "description": "Progress toward a goal as a measure bar over qualitative bands, with a target tick per row.",
        "emptyTitle": "No goals to track",
        "emptyBody": "Add measures with targets to compare against."
      },
      "rankingBars": {
        "chartLabel": "Ranking",
        "description": "A top-N ranking as horizontal bars — the leader at full strength, the rest dimmed — with values alongside.",
        "emptyTitle": "Nothing to rank",
        "emptyBody": "No records matched this breakdown yet."
      },
      "pareto": {
        "chartLabel": "Pareto chart",
        "description": "Sorted category bars under a cumulative-percent line, with an optional 80% cutline.",
        "emptyTitle": "No categories to chart",
        "emptyBody": "No grouped counts were returned for this range."
      },
      "waterfall": {
        "chartLabel": "Waterfall chart",
        "description": "A floating-bar bridge from a start total through positive and negative steps to a net total.",
        "emptyTitle": "No movement to bridge",
        "emptyBody": "No start, change, or total steps were found."
      },
      "marimekko": {
        "chartLabel": "Marimekko chart",
        "description": "A two-level mix as variable-width stacked columns — width for the outer share, segments for the inner split.",
        "emptyTitle": "No mix to break down",
        "emptyBody": "No two-level breakdown was returned for this range."
      },
      "stackedBar100": {
        "chartLabel": "100% stacked bar",
        "description": "One 100% bar split into proportional segments with a legend, comparing shares of a whole.",
        "emptyTitle": "No shares to split",
        "emptyBody": "No parts were returned for this breakdown."
      },
      "slope": {
        "chartLabel": "Slope chart",
        "description": "Two periods joined by one line per record, coloured by whether the value rose or fell.",
        "emptyTitle": "No period shift to show",
        "emptyBody": "No before/after values were returned to compare."
      },
      "multiline": {
        "chartLabel": "Multi-line chart",
        "description": "Several series as overlaid lines with end labels, comparing trends over the same time span.",
        "emptyTitle": "No series to plot",
        "emptyBody": "No time series matched the filters for this range."
      },
      "stream": {
        "chartLabel": "Stream chart",
        "description": "Stacked bands flowing around a centre line, showing how a total's composition shifts over time.",
        "emptyTitle": "No flow to chart",
        "emptyBody": "No stacked series were returned for this range."
      },
      "forecast": {
        "chartLabel": "Forecast chart",
        "nowLabel": "Now",
        "forecastLabel": "Forecast",
        "actualLabel": "Actual",
        "description": "A history line extended by a dashed projection inside a widening confidence band, split at a now divider.",
        "emptyTitle": "No history to project",
        "emptyBody": "No past points were returned to forecast from."
      },
      "anomaly": {
        "chartLabel": "Anomaly chart",
        "description": "A value line over its expected range, flagging points that fall outside it with halo dots.",
        "emptyTitle": "No signal to scan",
        "emptyBody": "No points were returned to check for anomalies."
      },
      "candlestick": {
        "chartLabel": "Candlestick chart",
        "livePillLabel": "Live",
        "description": "Open-high-low-close candles coloured by direction, with a dashed last-price line and an optional live pill.",
        "emptyTitle": "No candles to chart",
        "emptyBody": "No open-high-low-close rows matched this range."
      },
      "bump": {
        "chartLabel": "Bump chart",
        "description": "Rank-over-time lines showing how competitors trade places between periods.",
        "emptyTitle": "No ranks to trace",
        "emptyBody": "No period-over-period rankings were returned."
      },
      "timelineLanes": {
        "chartLabel": "Timeline lanes",
        "laneLabel": "Events",
        "description": "Dated events as pills on horizontal swimlanes sharing one time axis.",
        "emptyTitle": "No events to place",
        "emptyBody": "No events matched the filters for this range."
      },
      "treemap": {
        "chartLabel": "Treemap",
        "otherLabel": "Other",
        "description": "A part-to-whole breakdown as squarified tiles sized by value, folding small slices into an Other tile.",
        "emptyTitle": "No slices to tile",
        "emptyBody": "No categories were returned for this breakdown."
      },
      "sunburst": {
        "chartLabel": "Sunburst",
        "description": "A two-level hierarchy as nested rings — parents inside, their children outside — with a parent legend.",
        "emptyTitle": "No rings to draw",
        "emptyBody": "No grouped categories were returned to nest."
      },
      "funnel": {
        "chartLabel": "Funnel",
        "description": "Ordered shrinking stages with per-step continuation rates and an overall-conversion footer.",
        "emptyTitle": "No stages to funnel",
        "emptyBody": "No step counts were returned for this range."
      },
      "radialBar": {
        "chartLabel": "Radial bar",
        "description": "Up to four percentages as concentric progress rings with a dot legend.",
        "emptyTitle": "No rings to fill",
        "emptyBody": "No categories matched this breakdown yet."
      },
      "radar": {
        "chartLabel": "Radar",
        "description": "Several named axes on a polygon with one filled shape per series, against an optional target overlay.",
        "emptyTitle": "No axes to compare",
        "emptyBody": "No matrix of series and axes was returned."
      },
      "chord": {
        "chartLabel": "Chord",
        "description": "Pairwise flows as ribbons between nodes on a ring, with ribbon opacity weighted by volume.",
        "emptyTitle": "No flows to link",
        "emptyBody": "No connections between groups were returned."
      },
      "wordcloud": {
        "chartLabel": "Word cloud",
        "description": "Terms sized by frequency and flowed into rows, for a glanceable view of what dominates.",
        "emptyTitle": "No terms to cloud",
        "emptyBody": "No weighted terms matched the filters."
      },
      "cohortMatrix": {
        "chartLabel": "Cohort retention",
        "description": "Cohort rows against period columns, each cell shaded by retention or revenue."
      },
      "heatmapCalendar": {
        "chartLabel": "Activity calendar",
        "legendLessLabel": "Less",
        "legendMoreLabel": "More",
        "description": "A year of daily activity as a week-by-day grid shaded by intensity."
      },
      "heatMonth": {
        "chartLabel": "Monthly activity",
        "description": "One calendar month as a day grid shaded by each day's value."
      },
      "choroplethGrid": {
        "chartLabel": "Regional breakdown",
        "legendLowLabel": "Low",
        "legendHighLabel": "High",
        "description": "Regional values as a tinted US tilegram or compact grid, with an optional top-N ranking list."
      },
      "sankey": {
        "chartLabel": "Flow",
        "description": "Layered source-to-target flows as ribbons whose thickness encodes volume."
      },
      "sparkline": {
        "description": "An inline micro-trend of recent values — no axes or labels — for KPI cards, table cells and list rows."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "Ein fortlaufender Feed, wer was in Ihrem Workspace getan hat – neueste zuerst.",
        "emptyTitle": "Keine aktuelle Aktivität",
        "emptyBody": "Aktionen in Ihrem Workspace erscheinen hier.",
        "viewAllLabel": "View all"
      },
      "notificationFeed": {
        "description": "Gruppierte Benachrichtigungen mit Ungelesen-Status, Filtern und Inline-Aktionen.",
        "emptyTitle": "Keine Benachrichtigungen",
        "emptyBody": "Neue Benachrichtigungen erscheinen hier.",
        "allLabel": "All",
        "unreadLabel": "Unread",
        "mentionsLabel": "Mentions",
        "filterLabel": "Notification filter",
        "markAllReadLabel": "Mark all read",
        "todayLabel": "Today",
        "yesterdayLabel": "Yesterday",
        "earlierLabel": "Earlier",
        "dismissLabel": "Dismiss",
        "emptyUnreadTitle": "You're all caught up",
        "emptyMentionsTitle": "No mentions"
      },
      "realtimeFeed": {
        "description": "Ein Live-Ereignisstrom, der neue Einträge beim Eintreffen voranstellt.",
        "emptyTitle": "Warten auf Ereignisse",
        "emptyBody": "Live-Ereignisse erscheinen hier, sobald sie eintreten.",
        "liveLabel": "Live",
        "pausedLabel": "Paused",
        "pauseLabel": "Pause",
        "resumeLabel": "Resume"
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
        "emptyBody": "Geplante Termine erscheinen in diesem Kalender.",
        "previousLabel": "Previous month",
        "nextLabel": "Next month",
        "overflowLabel": "+{count} more"
      },
      "dayAgenda": {
        "description": "Die Termine des ausgewählten Tages als zeitlich geordnete Agenda.",
        "emptyTitle": "Nichts geplant",
        "emptyBody": "Termine für den ausgewählten Tag erscheinen hier.",
        "countLabel": "{count, plural, one {{n} event} other {{n} events}}"
      },
      "scheduleMatrix": {
        "description": "Ein Schichtraster nach Ressource und Tag mit Abdeckung pro Tag und Legende.",
        "emptyTitle": "Keine Schichten geplant",
        "emptyBody": "Zugewiesene Schichten erscheinen in diesem Plan.",
        "resourceLabel": "Resource",
        "coverageLabel": "Coverage",
        "hoursLabel": "{hours}h"
      },
      "capacityBoard": {
        "description": "Auslastungsbalken pro Mitglied mit Projektaufschlüsselung und Laststatus.",
        "emptyTitle": "Keine Auslastungsdaten",
        "emptyBody": "Die Auslastung der Mitglieder erscheint hier, sobald Zuweisungen bestehen.",
        "status": {
          "overloaded": "Overloaded",
          "balanced": "Balanced",
          "available": "Available"
        },
        "utilizationLabel": "{name}: {util}%",
        "assignmentLabel": "{project} · {hours}h",
        "periodLabel": "h · {period}",
        "period": {
          "week": "week",
          "month": "month"
        }
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
        "emptyBody": "Einträge erscheinen hier, sobald sie vorhanden sind.",
        "allLabel": "All",
        "toggleLabel": "Toggle {title}",
        "progressLabel": "{title} progress"
      },
      "logTable": {
        "description": "Ein Ereignisprotokoll mit Suche, Fehlerfilter und Zeilenaktionen.",
        "emptyTitle": "Keine Protokolleinträge",
        "emptyBody": "Ereignisse werden hier protokolliert, sobald sie eintreten.",
        "liveLabel": "Live",
        "placeholder": "Search logs…",
        "filterLabel": "Log filter",
        "allLabel": "All",
        "errorsLabel": "Errors",
        "noMatchesLabel": "No matching entries",
        "todayLabel": "Today",
        "yesterdayLabel": "Yesterday",
        "action": {
          "retry": "retry",
          "download": "download",
          "inspect": "inspect"
        }
      },
      "cardGallery": {
        "description": "Eine responsive Galerie von Objektkarten mit Status und Schnellaktionen.",
        "emptyTitle": "Nichts anzuzeigen",
        "emptyBody": "Einträge erscheinen hier als Karten."
      },
      "groupedSummaryTable": {
        "description": "Gruppierte Zeilen mit Aggregatspalten, aufklappbaren Details und Summen.",
        "emptyTitle": "Keine Zusammenfassung",
        "emptyBody": "Gruppierte Summen erscheinen hier, sobald Daten vorliegen.",
        "groupLabel": "Group",
        "totalsLabel": "Total"
      },
      "schemaTree": {
        "description": "Ein Explorer für Schemas, Tabellen und Spalten mit Typ- und Schlüssel-Badges.",
        "emptyTitle": "Kein Schema eingelesen",
        "emptyBody": "Verbinden Sie eine Datenbank, um ihr Schema hier zu erkunden.",
        "treeLabel": "Schema",
        "viewLabel": "view"
      },
      "toggleMatrix": {
        "description": "Ein interaktives Raster boolescher Schalter für Rollen, Richtlinien oder Kanäle.",
        "emptyTitle": "Keine Matrix konfiguriert",
        "emptyBody": "Zeilen und Spalten erscheinen hier nach der Konfiguration.",
        "matrixLabel": "Permissions matrix",
        "rowHeaderLabel": "Permission"
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
      },
      "dataGrid": {
        "selectAllLabel": "Select all rows",
        "selectRowLabel": "Select row",
        "sortByLabel": "Sort by {column}",
        "description": "The canonical CRUD grid with sortable columns, row selection, and type-aware cells."
      },
      "paginationFooter": {
        "emptyLabel": "0 rows",
        "ofLabel": "of",
        "pageSizeLabel": "Rows",
        "a11y": {
          "pageSize": "Rows per page"
        },
        "prevLabel": "Previous page",
        "nextLabel": "Next page",
        "description": "A footer with the visible row range, prev/next paging, and a page-size select."
      },
      "bulkActionToolbar": {
        "selectedLabel": "selected",
        "clearLabel": "Clear selection",
        "toolbarLabel": "Bulk actions",
        "description": "A selection-aware toolbar showing the selected count and bulk actions."
      },
      "miniTable": {
        "viewAllLabel": "View all",
        "description": "A compact dashboard row list with mapped columns and a view-all link."
      },
      "revealLabel": "Reveal value",
      "hideLabel": "Hide value",
      "trueLabel": "true",
      "falseLabel": "false",
      "detailKeyValue": {
        "description": "A record's fields as label/value rows with type-aware values."
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
        "typingLabel": "tippt…",
        "composerLabel": "Message"
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
        "configureCtaLabel": "Anbieter konfigurieren",
        "assistantLabel": "Assistant",
        "composerLabel": "Ask a question"
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
        "legendHighLabel": "Hoch",
        "chartLabel": "Regional breakdown"
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
        "dueLabel": "Fällig",
        "noDocumentTitle": "No document yet",
        "noDocumentBody": "Pick a starter template or add a block to begin."
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
        "emptyBody": "Die Balken erscheinen, sobald der Bericht eine Datenreihe enthält.",
        "a11yLabel": "Bar chart"
      },
      "blockLineChart": {
        "description": "Ein Mini-Liniendiagramm mit optionaler Flächenfüllung, passend für einen Dokumentblock.",
        "emptyTitle": "Keine Daten für das Diagramm",
        "emptyBody": "Die Linie erscheint, sobald der Bericht eine Datenreihe enthält.",
        "a11yLabel": "Line chart"
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
        "dateLabel": "Datum",
        "nameInputLabel": "Signature name"
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
      },
      "starterTemplatePicker": {
        "description": "Ein Raster vordefinierter Vorlagen mit generierten Miniaturansichten; die Auswahl erzeugt ein vollständiges Dokument.",
        "emptyTitle": "Keine Vorlagen",
        "emptyBody": "Definiere Vorlagen in der Konfiguration oder binde eine Vorlagentabelle ein.",
        "blankLabel": "Blank",
        "kicker": {
          "invoice": "Invoice",
          "report": "Report",
          "email": "Email"
        }
      },
      "sloMonitorCard": {
        "description": "SLA-Karte je Dienst mit Status, Verfügbarkeit gegenüber dem Ziel, täglichem Uptime-Streifen, Fehlerbudget und p95-Latenz.",
        "emptyTitle": "Kein Monitor",
        "emptyBody": "Binde eine Monitor-Tabelle mit einer Status- und einer Verfügbarkeitsspalte ein.",
        "targetLabel": "Target",
        "budgetLabel": "Error budget",
        "latencyLabel": "p95 latency",
        "status": {
          "operational": "Operational",
          "degraded": "Degraded",
          "down": "Down",
          "unknown": "Unknown"
        }
      },
      "uptimeSegmentBar": {
        "description": "Tagesstreifen im Statuspage-Stil, eingefärbt nach Tagesstatus, mit Umschalter für 30/90 Tage.",
        "emptyTitle": "Kein Uptime-Verlauf",
        "emptyBody": "Tägliche Statuszeilen erscheinen hier als Uptime-Streifen.",
        "daysAgoLabel": "{days} days ago",
        "todayLabel": "Today",
        "uptimeLabel": "uptime",
        "period30Label": "30d",
        "period90Label": "90d",
        "status": {
          "operational": "Operational",
          "degraded": "Degraded",
          "down": "Down",
          "unknown": "No data"
        }
      },
      "experimentVariantCompare": {
        "description": "Konversionsbalken je Variante mit Steigerung gegenüber der Kontrolle und einer Signifikanzanzeige.",
        "emptyTitle": "Keine Varianten",
        "emptyBody": "Binde eine Varianten-Tabelle mit Konversionszahlen ein.",
        "controlLabel": "CONTROL",
        "winnerLabel": "WINNER",
        "significanceLabel": "Confidence",
        "verdictSignificantLabel": "Statistically significant — safe to call.",
        "verdictInconclusiveLabel": "Not yet significant — keep the test running.",
        "countsLabel": "{users} participants · {conversions} conversions"
      },
      "creditCardTile": {
        "description": "Eine gespeicherte Zahlungsmethode als Markenkarte mit maskierter Nummer, Inhaber und Ablaufdatum.",
        "emptyTitle": "Keine Zahlungsmethode",
        "emptyBody": "Füge eine Karte hinzu, um sie hier zu sehen.",
        "defaultLabel": "Default",
        "setDefaultLabel": "Set default",
        "manageLabel": "Manage",
        "addLabel": "Add payment method",
        "expiresLabel": "Expires"
      },
      "planPricingCards": {
        "description": "Preisstufen mit Umschalter monatlich/jährlich, Funktionslisten und einem hervorgehobenen Tarif.",
        "emptyTitle": "Keine Tarife",
        "emptyBody": "Binde eine Tarif-Tabelle mit Name und Monatspreis ein.",
        "monthlyLabel": "Monthly",
        "annualLabel": "Annual",
        "popularLabel": "POPULAR",
        "perMonthLabel": "/ month",
        "billedAnnuallyLabel": "Billed {total} yearly",
        "currentLabel": "Current plan",
        "ctaLabel": "Choose plan"
      },
      "apiKeysPanel": {
        "description": "API-Schlüssel mit Umgebungs-Badges, maskierten Werten, Geltungsbereichen, letzter Nutzung sowie Kopier-, Erneuerungs- und Widerrufsaktionen.",
        "emptyTitle": "Keine API-Schlüssel",
        "emptyBody": "Erstelle einen Schlüssel, um die API aufzurufen.",
        "revealedTitle": "Key created",
        "revealedBody": "Copy it now — it is never shown again.",
        "copyLabel": "Copy",
        "copiedLabel": "Copied",
        "revealLabel": "Reveal key",
        "hideLabel": "Hide key",
        "rollLabel": "Roll key",
        "revokeLabel": "Revoke key",
        "neverUsedLabel": "Never used",
        "lastUsedLabel": "Last used {since}"
      },
      "apiPlayground": {
        "description": "Ein Anfrage-Editor mit Parametern und Antwortbereich. Er stellt Anfragen nur zusammen und sendet nie eine echte Anfrage.",
        "emptyTitle": "Kein Endpunkt ausgewählt",
        "emptyBody": "Wähle einen Endpunkt, um eine Anfrage dafür zusammenzustellen.",
        "sendLabel": "Send",
        "requestLabel": "Request",
        "responseLabel": "Response",
        "paramsLabel": "Parameters",
        "responsePlaceholder": "Send the request to see the response."
      },
      "codeSnippetBlock": {
        "description": "Ein kopierbarer Code-Ausschnitt mit Sprach-Chip und optionalen Registerkarten je Sprache.",
        "emptyTitle": "Kein Ausschnitt",
        "emptyBody": "Binde eine Code-Spalte ein oder hinterlege einen festen Ausschnitt in der Konfiguration.",
        "copyLabel": "Copy",
        "copiedLabel": "Copied"
      },
      "webhookEndpointsList": {
        "description": "Webhook-Endpunkte mit Ereignis, Ziel-URL, letzter Auslösung und Aktivierungsschalter.",
        "emptyTitle": "Keine Endpunkte",
        "emptyBody": "Füge einen Webhook-Endpunkt hinzu, um Tabellenereignisse zu empfangen.",
        "neverFiredLabel": "Never fired",
        "lastFiredLabel": "Last fired {since}"
      },
      "resourceApiCard": {
        "description": "Die generierte API-Oberfläche einer Tabelle: Zeilenanzahl, Sicherheits-Badge, Methoden-Chips und Anfragevolumen.",
        "emptyTitle": "Keine Ressource",
        "emptyBody": "Binde eine Tabelle ein, um ihre generierte API-Oberfläche zu zeigen.",
        "rlsLabel": "RLS",
        "publicLabel": "Public",
        "rowsLabel": "rows",
        "perDayLabel": "{count}/day"
      },
      "liveTimer": {
        "description": "Eine Stoppuhr mit Start und Stopp für eine Aufgabe; das Stoppen erfasst einen Zeiteintrag.",
        "emptyTitle": "Kein Timer",
        "emptyBody": "Binde eine Zeiteintragszeile mit Aufgabe und Dauer-Spalte ein.",
        "startLabel": "Start",
        "stopLabel": "Stop",
        "taskPlaceholder": "Untitled task"
      },
      "syncStatusCard": {
        "description": "Verbindungsidentität, Latenz, synchronisierte Zeilen und Zeitplan, mit einer Aktion zum sofortigen Synchronisieren.",
        "emptyTitle": "Keine Verbindung",
        "emptyBody": "Binde eine Verbindungszeile ein, um ihren Sync-Status zu zeigen.",
        "connectedLabel": "Connected",
        "disconnectedLabel": "Disconnected",
        "rowsSyncedLabel": "Rows synced",
        "tablesLabel": "Tables",
        "lastSyncLabel": "Last sync",
        "nextSyncLabel": "Next sync",
        "syncingLabel": "Syncing…",
        "syncActionLabel": "Sync now"
      },
      "ipAllowlistCard": {
        "description": "Feste ausgehende IP-Adressen zur Freigabe in einer Firewall, jeweils mit Kopierschaltfläche.",
        "emptyTitle": "Keine ausgehenden IPs",
        "emptyBody": "Ausgehende Adressen erscheinen hier, sobald die Verbindung bereitgestellt ist.",
        "copyLabel": "Copy",
        "copiedLabel": "Copied"
      },
      "onboardingChecklist": {
        "description": "Einrichtungsschritte mit Zeitschätzungen und Aktionen über einem live berechneten Fortschrittsring und -balken.",
        "emptyTitle": "Nichts einzurichten",
        "emptyBody": "Hinterlege Onboarding-Schritte in der Konfiguration oder binde eine Schritt-Tabelle ein.",
        "progressLabel": "{done} of {total} done",
        "celebrateTitle": "All done"
      },
      "testimonialCard": {
        "description": "Ein Kundenzitat mit Avatar und Quellenangabe.",
        "emptyTitle": "Kein Kundenzitat",
        "emptyBody": "Binde eine Zitatzeile ein, um ein Kundenzitat zu zeigen."
      },
      "trustBadges": {
        "description": "Eine durch Punkte getrennte Reihe von Compliance- und Vertrauensaussagen.",
        "emptyTitle": "Keine Badges",
        "emptyBody": "Hinterlege Compliance-Aussagen in der Konfiguration oder binde eine Badge-Tabelle ein."
      },
      "policyList": {
        "description": "Sicherheitsrichtlinien auf Zeilenebene je Tabelle mit Befehl, Rolle und Aktivierungsschalter.",
        "emptyTitle": "Keine Richtlinien",
        "emptyBody": "Diese Tabelle hat noch keine Sicherheitsrichtlinien auf Zeilenebene."
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
        "emptyBody": "Referenzbilder erscheinen auf diesem Board.",
        "placeholder": "Drop reference"
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
        "required": "Dieses Feld ist erforderlich.",
        "titleLabel": "Create record",
        "closeLabel": "Close"
      },
      "drawerForm": {
        "description": "Ein seitliches Formular zum Anlegen oder Bearbeiten von Datensätzen mit vielen Feldern.",
        "trigger": "Neu",
        "submit": "Speichern",
        "cancel": "Abbrechen",
        "titleLabel": "New record",
        "closeLabel": "Close"
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
        "emptyBody": "Noch keine Bedingungen — fügen Sie eine hinzu, um dieses Segment zu definieren.",
        "op": {
          "eq": "is",
          "neq": "is not",
          "gt": "is greater than",
          "gte": "is at least",
          "lt": "is less than",
          "lte": "is at most",
          "contains": "contains",
          "not-contains": "does not contain",
          "starts-with": "starts with",
          "in": "is one of",
          "before": "is before",
          "after": "is after",
          "is-null": "is empty",
          "is-not-null": "is not empty"
        }
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
        "emptyBody": "Wählen Sie einen Fragetyp, um Ihre Umfrage zu erstellen.",
        "questionLabel": "Question",
        "dropdownPlaceholder": "Choose…",
        "kind": {
          "single-choice": "Single choice",
          "multi-choice": "Multiple choice",
          "dropdown": "Dropdown",
          "short-text": "Short text",
          "long-text": "Long text",
          "rating": "Star rating",
          "nps": "NPS 0–10",
          "date": "Date"
        }
      },
      "inlineEditableField": {
        "description": "Ein per Klick bearbeitbarer Wert in einem Dokument oder auf einer Fläche.",
        "edit": "Bearbeiten",
        "save": "Speichern",
        "cancel": "Abbrechen",
        "empty": "Leer",
        "valueLabel": "Value"
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
        "emptyTitle": "No results for \"{query}\"",
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
        "emptyBody": "Versuchen Sie einen anderen Suchbegriff.",
        "searchLabel": "Search",
        "facetRailLabel": "Filter by type"
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
        "emptyTitle": "Keine Tastenkürzel registriert.",
        "generalGroupLabel": "General",
        "navigationGroupLabel": "Navigation",
        "recordsGroupLabel": "Records",
        "openCommandPaletteLabel": "Open command palette",
        "searchLabel": "Search",
        "showShortcutsLabel": "Show shortcuts",
        "goToDashboardLabel": "Go to dashboard",
        "goToOrdersLabel": "Go to orders",
        "newRecordLabel": "New record",
        "saveLabel": "Save",
        "undoLabel": "Undo"
      },
      "avatarStack": {
        "description": "Überlappende Avatare mit „+N“-Überlauf und optionaler Präsenz.",
        "online": "{count} online",
        "a11yLabel": "People"
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
      },
      "widgetMissing": {
        "description": "The fallback card shown when a stored page references a widget that is not installed.",
        "title": "Widget unavailable",
        "bodyLead": "No widget is registered as",
        "bodyTail": "It may belong to a newer version or an uninstalled extension."
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
    },
    "draggableRole": "draggable widget"
  },
  "templates": {
    "crud": {
      "newRow": "New row",
      "exportAction": "Export",
      "searchPlaceholder": "Search {table}…",
      "removeFilter": "Remove {column} filter",
      "queryFailed": "Query failed",
      "loadingRows": "Loading rows",
      "noMatchesTitle": "No matching rows",
      "emptyTitle": "{count, plural, one {No {entity} yet} other {No {entity}s yet}}",
      "createTitle": "Add {entity}",
      "createSubtitle": "Creates one row in {table}.",
      "createSubmit": "Add {entity}",
      "createSuccessTitle": "{name} added",
      "createSuccessBody": "You can undo this from the toast.",
      "editTitle": "Edit {entity}",
      "saveSubmit": "Save changes",
      "deleteTitle": "Delete {entity}",
      "deletePreflight": "Checking references…",
      "deleteNoReferences": "This row has no inbound references.",
      "deleteConsequencesIntro": "Deleting this row also affects:",
      "referenceRows": "{count, plural, one {{n} row} other {{n} rows}}",
      "confirmPrompt": "Type {value} to confirm",
      "bulkDeleteTitle": "{count, plural, one {Delete {n} row} other {Delete {n} rows}}",
      "bulkDeleteBody": "Referential consequences apply to every selected row.",
      "bulkDeleteConfirm": "Delete rows",
      "uniqueHelper": "Must be unique in {table}.",
      "uniqueHelperCounted": "{count, plural, one {Checked against {n} row.} other {Checked against {n} rows.}}",
      "toast": {
        "created": "{entity} created.",
        "createFailed": "Create failed.",
        "saved": "Changes saved.",
        "updateFailed": "Update failed.",
        "deleted": "{name} deleted.",
        "deleteFailed": "Delete failed.",
        "bulkDeleted": "{count, plural, one {{n} row deleted.} other {{n} rows deleted.}}",
        "bulkDeleteFailed": "Bulk delete failed.",
        "undone": "Change undone.",
        "undoFailed": "Undo failed."
      },
      "detail": {
        "fields": "Fields",
        "inboundReferences": "inbound references",
        "relatedCount": "{count, plural, one {{n} related record in {table}} other {{n} related records in {table}}}",
        "loadError": "Failed to load the record."
      }
    },
    "queue": {
      "allSegment": "All",
      "daysUnit": "{count, plural, one {{count} day} other {{count} days}}",
      "approvedToast": "{count} approved.",
      "rejectedToast": "{count} rejected.",
      "undoneToast": "Decision undone.",
      "undoFailedToast": "Could not undo this decision.",
      "failedToast": "Decision failed.",
      "invalidConfig": "This queue’s stored configuration is invalid. Regenerate the page to restore it.",
      "queueLabel": "Queue",
      "statusFilterLabel": "Status filter",
      "errorTitle": "This queue failed to load",
      "loading": "Loading queue",
      "emptyTitle": "Nothing in the queue",
      "emptyBody": "New requests appear here as they arrive.",
      "caughtUpTitle": "You're all caught up",
      "caughtUpBody": "No requests in this tab right now.",
      "selectItem": "Select {title}",
      "selectPrompt": "Select a request",
      "selectBody": "Choose an item to review its details.",
      "rejectTitle": "Reject requests",
      "rejectCount": "Selected · {count}",
      "rejectPlaceholder": "Add a note for the requester…",
      "rejectReasonLabel": "Rejection reason",
      "rejectNote": "The requester will be notified with your note."
    },
    "dashboard": {
      "invalidLayout": "This dashboard’s stored layout is invalid. Regenerate the page or reset its layout."
    },
    "builder": {
      "publish": "Publish",
      "paletteTitle": "Blocks",
      "inspectorTitle": "Inspector",
      "startFromTemplate": "Start from a template",
      "untitledDoc": "Untitled document",
      "invalidConfig": "This builder page’s stored config is invalid. Regenerate the page or reset it.",
      "starterPicker": {
        "subtitle": "Selection replaces the current draft."
      },
      "inspector": {
        "titleLabel": "Title",
        "numberLabel": "Number",
        "currencyLabel": "Currency",
        "taxRateLabel": "Tax rate %",
        "modulesLabel": "Modules"
      },
      "summary": {
        "questions": "Questions",
        "estLength": "Est. length",
        "estMinutes": "~{minutes} min",
        "steps": "Steps",
        "triggers": "Triggers",
        "conditions": "Conditions",
        "actions": "Actions",
        "triggerLocked": "The trigger step can’t be removed."
      },
      "publishModal": {
        "confirmTitle": "Publish survey?",
        "confirmSubtitle": "Review before it goes live.",
        "confirmCta": "Publish survey",
        "publishedTitle": "Survey published",
        "publishedSubtitle": "Your survey is live and collecting responses right now."
      },
      "blocks": {
        "block-totals-summary": "Totals summary",
        "block-line-items": "Line items",
        "block-kpi-row": "KPI row",
        "block-bar-chart": "Bar chart",
        "block-line-chart": "Line chart",
        "block-two-col-table": "Two-column table",
        "block-tax-breakdown": "Tax breakdown",
        "block-multi-currency": "Multi-currency",
        "block-payment-history": "Payment history",
        "block-discount-codes": "Discount codes",
        "block-loyalty-banner": "Loyalty points",
        "block-recurring-banner": "Recurring",
        "block-qr-pay": "Payment QR",
        "block-delivery-stepper": "Delivery timeline",
        "block-signature": "Signature",
        "block-terms-checkbox": "Terms",
        "block-approval": "Approval",
        "block-attachments": "Attachments",
        "block-late-fees": "Late fees",
        "block-image-placeholder": "Image",
        "block-contact": "Contact",
        "block-highlight-box": "Highlight box"
      },
      "starters": {
        "titles": {
          "st-standard": "Standard invoice",
          "st-recurring": "Recurring subscription",
          "st-deposit": "Deposit request",
          "st-credit-note": "Credit note",
          "st-late-reminder": "Late-payment reminder",
          "st-quote": "Quote / estimate",
          "st-proforma": "Pro forma",
          "st-receipt": "Payment receipt",
          "st-retainer": "Retainer",
          "st-usage": "Usage-based invoice",
          "st-milestone": "Project milestone",
          "st-donation": "Donation receipt (Tax ID)",
          "st-monthly": "Monthly summary",
          "st-quarterly": "Quarterly review",
          "st-usage-report": "Usage breakdown",
          "st-exec": "Executive one-pager",
          "st-welcome": "Welcome email",
          "st-receipt-email": "Invoice receipt",
          "st-digest": "Weekly digest",
          "st-dunning": "Payment reminder"
        },
        "categories": {
          "billing": "Billing",
          "sales": "Sales",
          "nonProfit": "Non-profit",
          "reports": "Reports",
          "lifecycle": "Lifecycle",
          "transactional": "Transactional",
          "marketing": "Marketing"
        }
      }
    },
    "common": {
      "clearFilters": "Clear filters",
      "noMatchesBody": "Try a different search or remove a filter.",
      "detailLabel": "Detail",
      "loadingRecord": "Loading record"
    },
    "directory": {
      "invalidConfig": "This directory’s stored configuration is invalid. Regenerate the page to restore it.",
      "searchPlaceholder": "Search people…",
      "memberCount": "{count, plural, one {{n} person} other {{n} people}}",
      "errorTitle": "This directory failed to load",
      "loading": "Loading people",
      "emptyTitle": "No people yet",
      "emptyBody": "People appear here as rows land in the table.",
      "noMatchesTitle": "No matching people",
      "detailTitle": "Person"
    },
    "masterDetail": {
      "invalidConfig": "This page’s stored configuration is invalid. Regenerate the page to restore it.",
      "railTitle": "Records",
      "errorTitle": "This list failed to load",
      "loading": "Loading records",
      "emptyBody": "Records appear here as rows land in the table.",
      "noMatchesTitle": "No matching records",
      "noMatchesBody": "Try removing a filter.",
      "selectPrompt": "Select a record",
      "selectBody": "Choose an item from the list to see its details."
    },
    "chat": {
      "invalidLayout": "This chat page’s stored layout is invalid. Regenerate the page or reset its layout.",
      "noInboxTitle": "No inbox on this page",
      "noInboxBody": "Regenerate the page.",
      "conversationsFailed": "The conversation query failed",
      "messagesFailed": "The messages query failed",
      "loadingConversations": "Loading conversations",
      "loadingMessages": "Loading messages",
      "selectTitle": "Select a conversation",
      "selectBody": "Pick a conversation from the inbox to read its messages."
    },
    "files": {
      "allFiles": "All files",
      "recent": "Recent",
      "starred": "Starred",
      "invalidLayout": "This files page’s stored layout is invalid. Regenerate the page or reset its layout.",
      "missingSlotTitle": "No file browser on this page",
      "missingSlotBody": "The stored layout has no browser slot. Regenerate the page.",
      "loadFailed": "The file query failed",
      "loading": "Loading files",
      "uploadsUnavailable": "Uploads are not available on this page yet.",
      "previewTitle": "File",
      "kindLabel": "Kind",
      "linkLabel": "Link"
    },
    "logViewer": {
      "invalidLayout": "This log page’s stored layout is invalid. Regenerate the page or reset its layout.",
      "levelFilterLabel": "Log level filter",
      "timeFilterLabel": "Time window filter",
      "window": {
        "1h": "1h",
        "24h": "24h",
        "7d": "7d"
      },
      "heldCount": "+{count}",
      "missingSlotTitle": "No log widget on this page",
      "missingSlotBody": "The stored layout has no log slot. Regenerate the page.",
      "loadFailed": "The log query failed",
      "loading": "Loading log entries",
      "traceTitle": "Trace",
      "latestTitle": "Latest activity",
      "backToLatest": "Back to latest",
      "eventFallback": "Event"
    },
    "calendar": {
      "eventCount": "{count, plural, one {{n} event} other {{n} events}}",
      "composePlaceholder": "Event title…",
      "addEvent": "Add event",
      "dateRange": "Date range",
      "agendaTitle": "Agenda",
      "categoriesTitle": "Categories",
      "upcomingTitle": "Upcoming",
      "invalidLayout": "This calendar’s stored layout is invalid. Regenerate the page or reset its layout."
    },
    "scheduler": {
      "previousWeek": "Previous week",
      "nextWeek": "Next week",
      "week": "Week",
      "month": "Month",
      "invalidLayout": "This schedule’s stored layout is invalid. Regenerate the page or reset its layout.",
      "shiftCount": "{count, plural, one {{n} shift} other {{n} shifts}}",
      "addShift": "Add shift"
    },
    "settings": {
      "title": "Notification settings",
      "subtitle": "Choose what you're notified about and how",
      "matrixLabel": "Notify me about",
      "rowHeader": "Event",
      "saved": "Saved",
      "unavailableTag": "Not available yet",
      "loading": "Loading preferences",
      "errorTitle": "These settings failed to load",
      "emptyTitle": "Nothing to configure yet",
      "emptyBody": "Notification events appear here as producers ship."
    },
    "pageCrud": {
      "description": "The canonical table page: searchable data grid, create/edit forms, safe deletes with reference checks, and undoable changes."
    },
    "pageDashboard": {
      "description": "A widget dashboard over your data: KPI cards, charts, and lists on an editable grid."
    },
    "pageBoard": {
      "description": "A kanban board grouped by a status field — drag cards between columns to update records."
    },
    "pageCalendar": {
      "description": "A month calendar with agenda, category filters, and quick event capture from a date field."
    },
    "pageScheduler": {
      "description": "A week-by-resource shift matrix with capacity tracking and coverage totals."
    },
    "pageDirectory": {
      "description": "A people directory with search, group filters, and a profile drawer."
    },
    "pageMasterDetail": {
      "description": "A list-beside-detail layout: pick a record on the left, work with it on the right."
    },
    "pageQueueInbox": {
      "description": "A review queue with approve/reject decisions, bulk actions, and undo."
    },
    "pageLogViewer": {
      "description": "A live-tailing log table with level and time filters and a trace side panel."
    },
    "pageFiles": {
      "description": "A file browser with smart folders, uploads, and a preview drawer."
    },
    "pageChat": {
      "description": "A conversation inbox beside a message thread, bound to your messages tables."
    },
    "pageBuilder": {
      "description": "A drag-and-drop document builder with block palette, inspector, and publish flow."
    },
    "pageWizard": {
      "description": "A multi-step guided flow that walks users through a structured process."
    },
    "pageSettings": {
      "description": "A notification-preferences matrix with per-channel toggles and autosave."
    }
  },
  "frame": {
    "noResult": "No result for widget",
    "emptyTitle": "No data for range",
    "loadError": "Something went wrong loading this widget.",
    "renderError": "This widget failed to render.",
    "refreshing": "Refreshing",
    "infoLabel": "Widget info",
    "menuLabel": "Widget menu"
  },
  "charts": {
    "livePillLabel": "Live",
    "forecast": {
      "nowLabel": "Now",
      "forecastLabel": "Forecast",
      "actualLabel": "Actual"
    },
    "otherLabel": "Other",
    "heat": {
      "lessLabel": "Less",
      "moreLabel": "More"
    },
    "choropleth": {
      "lowLabel": "Low",
      "highLabel": "High"
    },
    "funnel": {
      "stepConversion": "{pct}% continue",
      "overallConversion": "{pct}% overall"
    }
  }
} as const;
