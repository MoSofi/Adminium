// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "addOns": {
    "browse": {
      "all": "Alle",
      "bundled": "Enthalten",
      "categories": "Kategorien",
      "discard": "Verwerfen",
      "download": "Herunterladen",
      "emptyBody": "Diese Version enthält keine, und der Online-Katalog ist aus.",
      "emptyOnlineBody": "Der Online-Katalog ist aktiv, aber die letzte Prüfung fand nichts. Suchen Sie nach Neuerem.",
      "emptyTitle": "Keine Add-ons verfügbar",
      "install": "Installieren",
      "noMatchBody": "Kein Add-on hier passt zu dieser Suche und Kategorie.",
      "noMatchTitle": "Keine Treffer",
      "offline": "Zeigt die mit dieser Version gelieferten Add-ons. Das Online-Stöbern ist ausgeschaltet, und nichts hier hat das Internet kontaktiert.",
      "online": "Enthält Add-ons aus dem Online-Katalog. Die Suche nach neueren Versionen ist eine eigene Aktion.",
      "refresh": "Nach Neuerem suchen",
      "search": "Add-ons suchen",
      "title": "Verfügbar",
      "toggle": "Online-Katalog durchsuchen",
      "upgrade": "v{version} verfügbar",
      "upgradeAction": "Aktualisieren"
    },
    "card": {
      "needsApiKey": "Benötigt einen API-Schlüssel",
      "needsOauth": "Verbindet sich über OAuth"
    },
    "category": {
      "artwork": "Gestaltung",
      "data": "Daten",
      "delivery": "Versand",
      "email": "E-Mail",
      "payments": "Zahlungen"
    },
    "confirm": {
      "cancel": "Abbrechen",
      "close": "Schließen",
      "discard": "Verwerfen",
      "discardBody": "Die heruntergeladenen Dateien werden gelöscht. Es wurde nichts installiert, also ändert sich sonst nichts – Sie können es jederzeit erneut herunterladen.",
      "discardTitle": "Diesen Download verwerfen",
      "disconnect": "Trennen",
      "disconnectBody": "Seine Schlüssel werden gelöscht und es stellt seine Aufrufe ein. Jede Tabelle und jede Zeile, die es angelegt hat, bleibt unverändert, und Sie können es jederzeit wieder verbinden.",
      "disconnectTitle": "Dieses Add-on trennen",
      "uninstall": "Deinstallieren",
      "uninstallBody": "Seine Schlüssel werden gelöscht und seine Dateien von diesem Server entfernt. Jede Tabelle und jede Zeile, die es angelegt hat, bleibt unverändert. Sie können es später erneut installieren.",
      "uninstallTitle": "Dieses Add-on deinstallieren"
    },
    "connect": {
      "apiKey": "API-Schlüssel",
      "submit": "Verbinden"
    },
    "consent": {
      "cancel": "Abbrechen",
      "close": "Schließen",
      "confirm": "Installieren",
      "hosts": "Verbinden mit",
      "loading": "Wird ermittelt, was das bewirken würde …",
      "subtitle": "Was dieses Add-on tun wird, bevor es das tun kann.",
      "title": "{name} installieren"
    },
    "error": "Etwas ist schiefgelaufen",
    "installed": {
      "connected": "Verbunden",
      "disconnect": "Trennen",
      "egress": "Darf kontaktieren: {hosts}",
      "emptyBody": "Installieren Sie oben ein Add-on, dann erscheint es hier mit seinen Hosts und seiner Verbindung.",
      "emptyTitle": "Noch nichts installiert",
      "notConnected": "Nicht verbunden",
      "off": "aus",
      "on": "an",
      "title": "Installiert",
      "uninstall": "Deinstallieren"
    },
    "job": {
      "body": "Wird geladen und geprüft. Installiert wird erst auf Ihr Wort.",
      "failed": "Der Download wurde nicht abgeschlossen. Es wurde nichts installiert.",
      "title": "Wird heruntergeladen"
    },
    "plan": {
      "blocked": "Das kann hier nicht installiert werden",
      "needsColumns": "Dieses Add-on benötigt Spalten, die Sie nicht haben",
      "needsColumnsBody": "Adminium fügt Tabellen, die Ihnen bereits gehören, keine Spalten hinzu. Legen Sie sie selbst an, dann installieren Sie.",
      "noData": "Dieses Add-on liest und schreibt keine eigenen Tabellen.",
      "reuse": "Dieses Add-on verwendet Tabellen, die Sie bereits haben:",
      "willCreate": "Dadurch werden Tabellen in Ihrer Datenbank angelegt",
      "willCreateBody": "Bei der Installation werden diese Tabellen angelegt. Eine spätere Deinstallation lässt sie und ihre Daten unberührt."
    },
    "settings": {
      "badJson": "Das ist kein gültiges JSON und wurde nicht gespeichert.",
      "save": "Einstellungen speichern",
      "title": "Einstellungen"
    },
    "sideload": {
      "file": "Paketdatei (.tgz)",
      "hint": "Für einen Server ohne Internet. Wird genau wie ein Download geprüft und braucht daher den mitgelieferten Hash.",
      "sha": "Integrität (sha512-…)",
      "shaHint": "Der von `npm pack --json` ausgegebene `integrity`-Wert. Passen die Bytes nicht, wird abgelehnt.",
      "submit": "Hochladen",
      "title": "Paket hochladen",
      "uploaded": {
        "title": "{name} {version} hochgeladen",
        "body": "Installieren Sie es über die Liste oben."
      }
    },
    "subtitle": "Zusätzliche Funktionen für Ihre Apps – Versand, Grafik, Daten. Jedes sagt vor der Installation, was es benötigt.",
    "title": "Add-ons",
    "upgradeNote": "Beim Aktualisieren bleiben die Hosts, mit denen ein Add-on verbunden ist, und die bestehende Verbindung erhalten.",
    "veto": {
      "body": "Die Einstellung ist gespeichert, aber Netzwerkfunktionen sind für diesen Server aus, und das gilt. Geladene Add-ons laufen weiter, und Sie können eins hochladen.",
      "title": "Diese Installation kann nicht online suchen"
    }
  },
  "capability": {
    "importNoLiveHealth": "Keine Live-Datenbankverbindung — Health-Checks und Schema-Drift-Erkennung sind für diese Quelle nicht verfügbar.",
    "importNoRowCounts": "Schemadateien enthalten keine Zeilenzahlen — die Tabellenliste zeigt — statt erfundener Werte.",
    "mysqlApproxRows": "MySQL-Zeilenzahlen sind Schätzungen der Storage-Engine (Abweichungen bis ±40 % möglich) — sie werden mit ≈ angezeigt.",
    "mysqlFkEnum": "MySQL liefert schwächere FK-/Enum-Metadaten: MyISAM-Tabellen deklarieren keine Fremdschlüssel, Enums sind spaltengebundene enum(…)-Typen, und CHECK-Constraints erfordern MySQL 8.0.16+ / MariaDB 10.2+.",
    "rowsApproximate": "Schätzung der Storage-Engine — kann bei InnoDB um bis zu ±40 % abweichen.",
    "rowsNoEstimate": "Die Engine hat für diese Tabelle keine Schätzung gemeldet.",
    "rowsRunAnalyze": "Noch keine Schätzung — führen Sie ANALYZE auf der Datenbank aus, um Zeilenzahlen zu erhalten.",
    "rowsUnavailable": "Schemadateien haben keine Live-Datenbank — Zeilenzahlen sind unbekannt, bis Sie eine verbinden.",
    "sqliteCheckEnums": "SQLite hat keinen nativen Enum-Typ — Enums werden aus CHECK-(col IN (…))-Constraints abgeleitet.",
    "sqliteNoComments": "SQLite kennt keine Spaltenkommentare — verwenden Sie den Schema-Remap-Editor, um Beschriftungen zu vergeben."
  },
  "design": {
    "adopt": {
      "action": "Zur App hinzufügen",
      "done": "{created} Seiten erstellt, {updated} aktualisiert, {unchanged} bereits aktuell.",
      "everything": "Diese Verbindung zeigt bereits jede Tabelle, es musste nichts aufgenommen werden.",
      "forbidden": "Ihre Rolle darf das Schema ändern, aber keine Seiten erzeugen. Bitten Sie eine Administratorin oder einen Administrator mit Verbindungsverwaltung, diese Tabellen zur App hinzuzufügen.",
      "grants": "Keine Rolle erhält automatisch Zugriff — vergeben Sie ihn unter Einstellungen → Rollen.",
      "offer": "Eine neue Tabelle bewirkt nichts, solange sie keine Seite hat. {tables} zur App hinzufügen?",
      "skippedEdited": "Unangetastet gelassen, weil Sie sie bearbeitet haben: {pages}."
    },
    "apply": "Anwenden",
    "ceiling": {
      "authorise": "Dieses Neuschreiben autorisieren",
      "body": "{table} enthält über {rows} Zeilen — mehr, als Adminium von sich aus neu schreibt. Nur eine Super-Admin-Rolle kann das autorisieren, und die Tabelle bleibt für die Dauer des Neuschreibens gesperrt.",
      "hint": "Geben Sie den Tabellennamen genau so ein, wie er oben steht.",
      "notYours": "{table} enthält über {rows} Zeilen. Nur eine Super-Admin-Rolle kann ein Neuschreiben dieser Größe autorisieren — fragen Sie eine, oder führen Sie die Änderung in einem Wartungsfenster mit eigenen Werkzeugen durch.",
      "prompt": "Geben Sie {table} erneut ein, um das Neuschreiben zu autorisieren"
    },
    "column": {
      "help": "Was bedeuten diese Einstellungen?",
      "key": "Schlüssel",
      "length": "Länge",
      "link": "Verknüpft mit",
      "linkHelp": "Verknüpfen Sie dies mit einer Zeile in einer anderen Tabelle.",
      "linkTypeNote": "Der Typ entspricht dem Schlüssel der verknüpften Tabelle.",
      "name": "Name",
      "namePlaceholder": "client_id",
      "noLink": "Nichts",
      "onDelete": "Wenn die verknüpfte Zeile gelöscht wird",
      "precision": "Genauigkeit",
      "primaryKey": "Primärschlüssel",
      "remove": "{name} entfernen",
      "required": "Erforderlich",
      "type": "Typ",
      "unique": "Eindeutig"
    },
    "confirm": {
      "body": "Diese Änderung verwirft Daten oder entfernt ein Objekt. Adminium kann sie nicht rückgängig machen.",
      "cancel": "Abbrechen",
      "close": "Schließen",
      "confirm": "Änderungen anwenden",
      "prompt": "Geben Sie {word} ein, um zu bestätigen",
      "title": "Destruktive Änderung anwenden"
    },
    "designer": "Tabellen-Designer",
    "discard": "Änderungen verwerfen",
    "dropping": "Zum Löschen vorgemerkt",
    "empty": {
      "body": "Erstellen Sie eine Tabelle oder wählen Sie eine zum Bearbeiten. Nichts erreicht Ihre Datenbank, bevor Sie die Anweisungen geprüft und angewendet haben.",
      "title": "Entwerfen Sie Ihr Schema"
    },
    "error": {
      "atColumn": "Spalte {n}, {field}",
      "atTable": "Tabelle {field}",
      "empty": "Ein Name ist erforderlich.",
      "identifier": "Nur Kleinbuchstaben, Ziffern und Unterstriche, beginnend mit einem Buchstaben.",
      "tooLong": "Zu lang — {dialect} erlaubt {max} Zeichen."
    },
    "existing": "Vorhandene Tabellen",
    "hazard": {
      "irreversible": "Nicht umkehrbar",
      "locking": "Hält eine Sperre",
      "lossy": "Verwirft Daten",
      "refused": "Abgelehnt",
      "rewrite": "Schreibt die Tabelle neu",
      "safe": "Sicher"
    },
    "help": {
      "close": "Schließen",
      "link": {
        "example": "Eine Reservierung ist mit einem Kunden verknüpft. Adminium zeigt dann den Kunden bei der Reservierung und die Reservierungen beim Kunden.",
        "term": "Verknüpfung mit einer anderen Tabelle",
        "what": "Verbindet diese Zeile mit einer Zeile in einer anderen Tabelle und lässt die Datenbank darüber wachen, dass die Verknüpfung stimmt — Sie können nicht auf etwas zeigen, das es nicht gibt."
      },
      "primaryKey": {
        "example": "Ohne Primärschlüssel kann Adminium die Zeilen auflisten, aber keine einzelne bearbeiten oder löschen.",
        "term": "Primärschlüssel",
        "what": "Das Feld, das jede Zeile identifiziert — daran unterscheidet Adminium eine Zeile von der anderen. Jede Tabelle sollte genau eines haben, und fast immer ist es das Feld „id“, das für Sie angelegt wurde."
      },
      "required": {
        "example": "Eine Bestellung braucht einen Kunden, dieses Feld ist also erforderlich. Ein Lieferhinweis ist optional, dieses nicht.",
        "term": "Erforderlich",
        "what": "Das Feld muss ausgefüllt sein. Solange es leer ist, lässt sich die Zeile nicht speichern."
      },
      "subtitle": "Verständliche Beschreibungen jeder Einstellung und was sie für die Menschen ändert, die Ihre App nutzen.",
      "title": "Was diese Felder bedeuten",
      "type": {
        "example": "Eine Telefonnummer ist meist Text, keine Zahl — bei Zahlen fallen führende Nullen weg.",
        "term": "Typ",
        "what": "Welche Art von Information das Feld enthält — Wörter, ganze Zahlen, Geldbeträge, ein Datum, eine Ja/Nein-Antwort. Erst der richtige Typ lässt Adminium eine Datumsauswahl statt eines Textfelds zeigen und eine Spalte mit Geldbeträgen aufsummieren."
      },
      "unique": {
        "example": "Zwei Kunden sollten sich keine E-Mail-Adresse teilen — als eindeutig markiert, können sie es nicht.",
        "term": "Eindeutig",
        "what": "Keine zwei Zeilen dürfen denselben Wert enthalten. Die Datenbank weist die zweite ab."
      }
    },
    "keepTable": "{table} behalten",
    "newTable": "Neue Tabelle",
    "onDelete": {
      "cascade": "Diese Zeile ebenfalls löschen",
      "restrict": "Löschen verhindern",
      "setNull": "Dieses Feld leer lassen"
    },
    "plan": "Änderungen prüfen",
    "result": {
      "applied": "Angewendet. Adminium hat Ihr Schema neu eingelesen.",
      "failed": "Es wurde nichts angewendet — Ihre Datenbank ist unverändert. {error}",
      "partial": "Teilweise angewendet: {done} von {total} Schritten liefen. Dieselben Änderungen erneut anzuwenden schließt sie ab.",
      "repaired": "Die Umbenennung wurde auf {pages, plural, one {# Seite} other {# Seiten}}, {grants, plural, one {# Rollenrecht} other {# Rollenrechte}} und {overrides, plural, one {# Schema-Überschreibung} other {# Schema-Überschreibungen}} übertragen."
    },
    "review": {
      "noChanges": "Noch keine Schemaänderungen.",
      "pending": "Prüfen Sie Ihre Änderungen, um die genauen Anweisungen zu sehen, die Adminium ausführt.",
      "steps": "Geplante Schritte",
      "superAdmin": "Super-Administrator",
      "unfinished": "Eine frühere Anwendung auf dieser Verbindung hat nie ein Ergebnis gemeldet. Ihr Schema liegt möglicherweise zwischen zwei Formen — prüfen Sie den Änderungsverlauf, bevor Sie weitere anwenden."
    },
    "reviewPane": "Prüfung",
    "table": {
      "addColumn": "Spalte hinzufügen",
      "columns": "Spalten",
      "drop": "Diese Tabelle löschen",
      "dropHelp": "Die Tabelle und alle ihre Zeilen werden zerstört. Sie sehen genau, was dadurch kaputtgeht, bevor etwas ausgeführt wird.",
      "name": "Tabellenname",
      "nameHelp": "Kleinbuchstaben, Ziffern und Unterstriche.",
      "namePlaceholder": "reservations",
      "noKey": "Diese Tabelle hat keinen Primärschlüssel, daher behandelt Adminium sie als schreibgeschützt — Zeilen lassen sich auflisten, aber nicht bearbeiten.",
      "renameHelp": "Eine Änderung benennt die Tabelle in Ihrer Datenbank um.",
      "uuidKeyUnavailable": "Auf dieser Engine muss ein Schlüssel eine generierte Ganzzahl sein: eine von der Datenbank generierte UUID kann nach einem Insert nicht zurückgelesen werden."
    },
    "unnamed": "Benennen Sie jede Tabelle und Spalte, um die Änderungen zu prüfen.",
    "unrepresentableDefaults": "Diese Spalten behalten einen von der Datenbank erzeugten Standardwert, den Adminium hier nicht bearbeiten kann; er bleibt unverändert: {columns}"
  },
  "diagram": {
    "ceiling": "Es werden die {shown} am stärksten verbundenen Tabellen gezeigt. {omitted} weitere sind ausgeblendet — suchen Sie danach, um eine einzublenden.",
    "legend": {
      "declared": "Fremdschlüssel",
      "inferred": "Abgeleitet",
      "virtual": "In Adminium hinzugefügt"
    },
    "legendLabel": "Legende",
    "node": {
      "foreignKey": "Fremdschlüssel",
      "more": "+{count} weitere",
      "primaryKey": "Primärschlüssel"
    },
    "outline": {
      "intro": "{tables} Tabellen und {relations} Beziehungen, als Liste.",
      "more": " und {count} weitere",
      "referencedBy": "Referenziert von: {list}",
      "references": "Referenziert: {list}"
    },
    "saveLayout": "Anordnung speichern",
    "search": "Tabelle oder Spalte finden",
    "showDiagram": "Diagramm anzeigen",
    "showList": "Als Liste anzeigen"
  },
  "documents": {
    "cancel": "Abbrechen",
    "connectionLabel": "Verbindung",
    "delete": "Löschen",
    "delivery": {
      "email": "Senden an",
      "noEmail": "An niemanden — nur am Datensatz behalten",
      "noEmailSlot": "Diese Belegart hat kein Adressfeld und kann daher nicht versendet werden.",
      "noSmtp": "Für dieses Adminium ist noch kein E-Mail-Server eingerichtet, es kann also nichts versendet werden. Richten Sie einen unter Studio → Einstellungen → E-Mail ein.",
      "stored": "Bleibt immer am Datensatz."
    },
    "disabled": "ausgeschaltet",
    "edit": "Bearbeiten",
    "empty": "Noch keine Zuordnungen.",
    "grants": {
      "refused": "Diese Zuordnung liest {tables}, was Sie nicht lesen dürfen. Belege daraus schlagen für Sie fehl.",
      "title": "Sie dürfen nicht alles davon lesen"
    },
    "intro": "Eine Zuordnung sagt, welche Spalten welcher Tabelle eine Belegart ergeben, was sie auslöst und wohin sie geht.",
    "name": "Diese Zuordnung benennen",
    "newFrom": "Neue Zuordnung für:",
    "noProvider": "Noch kann kein installiertes Add-on Belege zeichnen. Installieren Sie eines unter Add-ons, dann erscheinen hier die möglichen Zuordnungen.",
    "pickTable": "Tabelle wählen…",
    "prefix": "Nummernpräfix",
    "render": {
      "failedRow": "Es wurde nichts gezeichnet: {reason}",
      "intro": "Zeichnen Sie jetzt einen, aus einer Zeile Ihrer Wahl. Es wird nichts versendet – er bleibt am Datensatz wie jeder andere.",
      "noRows": "Noch keine Zeilen zum Zeichnen.",
      "open": "Öffnen",
      "pending": "Wird gezeichnet…",
      "pick": "Diese zeichnen",
      "ready": "Gezeichnet.",
      "saveFirst": "Speichern Sie die Zuordnung zuerst. Gezeichnet wird aus einer gespeicherten – so sehen Sie das Ergebnis, bevor es jemand anderes sieht.",
      "search": "Zeilen durchsuchen",
      "slow": "Es ist noch kein Beleg erschienen. Vielleicht wartet er noch – oder diese Installation führt keine Hintergrundaufträge aus; dann wird nichts gezeichnet, bis sie es tut.",
      "slowTitle": "Immer noch nichts"
    },
    "save": "Zuordnung speichern",
    "slot": {
      "byDefault": "Von Adminium gefüllt",
      "lineColumnOf": "{column} jeder Position",
      "lineColumns": "Was jede Spalte einer Position füllt",
      "looksLikeLines": "sieht nach Positionen aus",
      "noChildren": "Nichts in Ihrer Datenbank verweist auf diese Tabelle, es gibt also keine Positionen zu zeichnen. Ein Beleg braucht eine untergeordnete Tabelle mit einem Fremdschlüssel zurück auf diese.",
      "noLines": "Keine Positionen",
      "pii": "verborgene Daten",
      "typed": "Ein Wert, den ich eintrage",
      "typedHint": "Hier eingetragen, nicht aus Ihren Daten gelesen – jeder Beleg aus dieser Zuordnung bekommt denselben Wert.",
      "typedValue": "Wert für {slot}",
      "unmapped": "Nicht gefüllt"
    },
    "step": {
      "delivery": "Wohin er geht",
      "kind": "Art",
      "mapping": "Was jedes Feld füllt",
      "mappingHelp": "Jedes Feld liest eine Spalte – oder nimmt einen Wert, den Sie hier eintragen.",
      "render": "An einer Zeile ausprobieren",
      "table": "Verbindung und Tabelle",
      "trigger": "Was ihn auslöst"
    },
    "tableLabel": "Tabelle",
    "title": "Beleg-Zuordnungen",
    "trigger": {
      "created": "Wenn eine Zeile hinzukommt",
      "manual": "Nur auf Anforderung",
      "manualShort": "auf Anforderung",
      "note": "Zeilen aus einem Import oder direkt in die Datenbank geschriebene Zeilen lösen nichts aus — nur Schreibvorgänge über Adminium.",
      "noteTitle": "Was als Änderung zählt",
      "updated": "Wenn sich eine Zeile ändert"
    },
    "unbound": "Noch auszufüllen: {slots}"
  },
  "enrich": {
    "byo": {
      "cardDescription": "Kopieren Sie einen eigenständigen Prompt in Claude Code, ChatGPT oder ein beliebiges Tool — und fügen Sie das JSON zurück ein. Kein Schlüssel nötig, nichts verlässt diesen Rechner automatisch.",
      "cardTitle": "Einen Prompt in mein eigenes KI-Tool kopieren",
      "cardTitleRecommended": "Prompt in mein eigenes KI-Tool kopieren — empfohlen",
      "chunkTab": "Prompt {index}",
      "chunkTabs": "Prompt-Abschnitte",
      "chunkValid": "Abschnitt {index} validiert",
      "continueReview": "Weiter zur Prüfung",
      "copyErrors": "Fehler für Ihr KI-Tool kopieren",
      "copyErrorsDone": "Fehler kopiert",
      "copyErrorsHint": "Fügen Sie dies in Ihr KI-Tool zurück ein, um eine korrigierte Antwort zu erhalten.",
      "copyPrompt": "Prompt kopieren",
      "copyPromptDone": "Prompt kopiert",
      "download": ".md herunterladen",
      "droppedItems": "{count} Vorschläge wurden bei der Validierung verworfen — die Prüfung zeigt die übrigen.",
      "errorsTitle": "Die Validierung fand {count} Probleme",
      "guidance": "Führen Sie dies in einem beliebigen KI-Tool aus — Claude Code, ChatGPT, egal. Fügen Sie das zurückgegebene JSON unten ein.",
      "mergedBody": "Die Vorschläge können nun gegen die heuristische Grundlage geprüft werden.",
      "mergedTitle": "Alle {count} Abschnitte validiert und zusammengeführt",
      "mergedTitleSingle": "Antwort validiert",
      "pasteLabel": "JSON-Antwort einfügen",
      "pastePlaceholder": "JSON-Antwort hier einfügen…",
      "pendingBody": "Fügen Sie die JSON-Antwort oben ein und validieren Sie sie, um zur Prüfung fortzufahren.",
      "pendingBodyChunked": "Jeder Abschnitt muss validiert werden, bevor die Vorschläge zusammengeführt werden. Fügen Sie jeden Prompt oben ein und validieren Sie ihn.",
      "pendingTitle": "Validieren Sie jeden Prompt, um fortzufahren",
      "promptLabel": "Anreicherungs-Prompt",
      "promptLabelN": "Anreicherungs-Prompt {index} von {total}",
      "requestFailed": "Der Server war für die Validierung nicht erreichbar — erneut versuchen.",
      "tokenChip": "≈ {tokens} Tokens",
      "valid": "Antwort validiert",
      "validate": "Validieren",
      "wholeDocument": "gesamtes Dokument"
    },
    "copied": "Kopiert",
    "createFailed": "Der Anreicherungs-Prompt konnte nicht erstellt werden — erneut versuchen.",
    "createFailedTitle": "Konnte nicht starten",
    "direct": {
      "back": "Zurück zu den Optionen",
      "building": "Prompt wird erstellt…",
      "cancel": "Abbrechen",
      "continueReview": "Weiter zur Prüfung",
      "done": "Anreicherung abgeschlossen — prüfen Sie die Vorschläge.",
      "errorTitle": "Anreicherung fehlgeschlagen",
      "failed": "Der Anbieterlauf ist fehlgeschlagen. Prüfen Sie Ihre KI-Einstellungen und versuchen Sie es erneut.",
      "jobFailed": "Der Anreicherungslauf wurde nicht abgeschlossen.",
      "logLabel": "Anreicherungsprotokoll",
      "retry": "Erneut versuchen",
      "startFailed": "Der Lauf konnte nicht gestartet werden — erneut versuchen.",
      "subtitle": "Ihr Schema wird gesendet an",
      "title": "Anreicherung mit KI"
    },
    "fileBody": "Schema-Datei-Quellen haben noch keinen Snapshot zum Anreichern. Verbinden Sie eine aktive Datenbank für die KI-Anreicherung, oder fahren Sie fort — die heuristische Grundlage erzeugt weiterhin eine vollständige App.",
    "fileTitle": "KI-Anreicherung benötigt eine aktive Datenbank",
    "generatePrompt": "Prompt erzeugen",
    "intentLabel": "Wie möchten Sie anreichern?",
    "localeLocked": "(erforderlich)",
    "localesLegend": "Bezeichnungen übersetzen in",
    "noSections": "Wählen Sie mindestens eine Entscheidungsgruppe zum Anreichern.",
    "provider": {
      "configError": "Die Anbietereinstellungen konnten nicht geladen werden — konfigurieren Sie einen Anbieter unter Einstellungen → KI und kehren Sie dann zu diesem Schritt zurück.",
      "description": "Führen Sie die Anreicherung jetzt mit Ihrem konfigurierten Anbieter aus. Sie prüfen jeden Vorschlag als Diff.",
      "networkDisabled": "Dieses Adminium hat keinen ausgehenden Internetzugang und kann keine Anbieter-API erreichen. Nutzen Sie stattdessen den Kopieren-und-Einfügen-Weg — gleicher Prompt, gleiche Prüfung.",
      "readyBody": "Wählen Sie oben „Meinen KI-Anbieter verwenden“, um die Anreicherung jetzt für diese Verbindung auszuführen.",
      "readyTitle": "KI-Anbieter konfiguriert",
      "setUpHere": "Anbieter hier einrichten",
      "setUpHide": "Anbietereinrichtung ausblenden",
      "settingsHint": "Möchten Sie es direkt ausführen?",
      "settingsLink": "Anbieter in Einstellungen → KI konfigurieren",
      "title": "Meinen KI-Anbieter verwenden",
      "unconfigured": "Es ist noch kein KI-Anbieter konfiguriert — richten Sie unten einen ein, oder kopieren Sie einen Prompt in Ihr eigenes KI-Tool."
    },
    "providerFallback": "Ihr KI-Anbieter",
    "samplingHint": "Nimmt bis zu 20 echte Werte pro Nicht-PII-Spalte in den Prompt auf.",
    "samplingPreviewBody": "Bis zu 20 häufigste Werte pro Nicht-PII-Spalte, plus Min/Max für numerische und Datumsspalten. Als PII markierte Spalten werden nie beprobt. Alles Übrige bleibt rein aggregiert. Prüfen Sie den genauen Prompt vor dem Kopieren (BYO) — ohne Ihr Zutun wird nichts gesendet.",
    "samplingPreviewTitle": "Was diesen Rechner verlässt",
    "samplingTitle": "Beispielwerte einbeziehen",
    "section": {
      "enums": "Enum-Semantik",
      "groups": "Navigationsgruppen",
      "icons": "Symbole",
      "keys": "Schlüsselspalten",
      "labels": "Bezeichnungen & Beschreibungen",
      "microcopy": "Mikrotexte",
      "pii": "PII & Maskierung",
      "relations": "Beziehungen",
      "templates": "Seitenvorlagen",
      "widgets": "Dashboard-Widgets"
    },
    "sectionsLegend": "Worüber soll die KI entscheiden?",
    "skip": {
      "confirmBody": "Die generierte App verwendet die heuristischen Bezeichnungen, Gruppen und Dashboards. Fahren Sie mit dem Generieren fort — Sie können die KI-Anreicherung jederzeit über Einstellungen → KI ausführen.",
      "confirmTitle": "Weiter mit Heuristik",
      "description": "Aus der heuristischen Grundlage generieren. Sie können später über Einstellungen → KI anreichern — Überspringen wird nie bestraft.",
      "title": "Überspringen — nur Heuristik verwenden"
    },
    "startOver": "Von vorn beginnen",
    "startProvider": "Anreicherung starten",
    "subtitle": "Verfeinern Sie die generierten Bezeichnungen, Gruppen, Enums und Dashboards optional mit einem LLM. Die heuristische Grundlage funktioniert auch ohne — dies fügt nur Vorschläge hinzu, die Sie prüfen, bevor etwas angewendet wird.",
    "title": "Mit KI anreichern"
  },
  "generate": {
    "errorTitle": "Generierung fehlgeschlagen",
    "failed": "Generierung fehlgeschlagen — versuchen Sie es erneut oder führen Sie zuerst die Introspektion erneut aus.",
    "fileBody": "Ihr Schema wurde sauber geparst und die Vorschau oben ist echt. Eine laufende App direkt aus einer Schemadatei (mit Platzhalterzeilen) zu generieren ist noch nicht verfügbar — verbinden Sie eine Live-Datenbank, um heute zu generieren.",
    "fileTitle": "Schemadatei geparst — die Generierung benötigt eine Live-Datenbank",
    "log": {
      "classifying": "Schema wird klassifiziert…",
      "composing": "Vorlagen werden zusammengestellt…",
      "done": "{pages} Seiten in {groups} Navigationsgruppen generiert",
      "writing": "Seiten werden geschrieben…"
    },
    "logLabel": "Generierungsprotokoll",
    "openApp": "App öffnen",
    "run": "Dashboard generieren",
    "subtitle": "Eine Seite pro einbezogener Tabelle plus Dashboards je Domäne — Zweck:",
    "successBody": "{pages} Seiten in {groups} Navigationsgruppen — aus Ihrem Schema generiert, im Studio bearbeitbar.",
    "successTitle": "Ihr Dashboard ist bereit",
    "title": "Generieren Sie Ihre App"
  },
  "hostedApps": {
    "domains": {
      "add": "Domain anhängen",
      "hostLabel": "Host",
      "instanceLabel": "Instanz",
      "instanceOwn": "Die App selbst",
      "issuesTitle": "Die Domain-Zuordnung wurde abgelehnt",
      "none": "Keine Domains angehängt.",
      "remove": "Entfernen",
      "save": "Domains speichern",
      "savedBody": "Zuordnungen greifen innerhalb weniger Sekunden. Ein Host antwortet erst, wenn sein DNS und Ihr Proxy diese Instanz tatsächlich erreichen.",
      "savedTitle": "Gespeichert",
      "subtitle": "Richten Sie das DNS einer Domain auf Ihren Proxy, reichen Sie den Host-Header an Adminium durch und hängen Sie sie hier an — dieser Host liefert dann die Oberfläche statt dieses Dashboards. Zertifikate bleiben auf Ihrem Proxy.",
      "surfaceLabel": "Oberfläche",
      "title": "Domains"
    },
    "emptyBody": "Setzen Sie ADMINIUM_SURFACES_DIR auf ein Verzeichnis gebauter Oberflächen — ein Ordner je App und Seite, jeweils mit index.html — und starten Sie neu. Sie werden dann unter /apps/ ausgeliefert und erscheinen hier.",
    "emptyTitle": "Es werden keine App-Oberflächen ausgeliefert",
    "error": "Etwas ist schiefgelaufen",
    "instances": {
      "add": "Instanz hinzufügen",
      "appLabel": "App",
      "body": "Dieselbe App über mehrere Datenbanken bereitstellen. Jede Instanz ist unter /apps/<app>/<segment>/<side>/ erreichbar und liest nur die Verbindung, die Sie ihr geben.",
      "empty": "Keine weiteren Instanzen.",
      "failed": "Instanzen wurden nicht gespeichert",
      "readsLabel": "Liest",
      "remove": "Entfernen",
      "save": "Instanzen speichern",
      "slugLabel": "URL-Segment",
      "title": "Instanzen"
    },
    "subtitle": "Die App-Oberflächen, die diese Instanz ausliefert — wo jede erscheint und welche Domains auf sie zeigen.",
    "surfaces": {
      "boundKey": "Liefert Schlüssel",
      "connectionLabel": "Liest",
      "connectionUnset": "Was gerade bedient",
      "customer": "Kunden",
      "mintLink": "Unter „Öffentliche API“ erstellen",
      "noKey": "Kein Schlüssel gebunden — diese Oberfläche kann keine Daten lesen, bis einer für sie erstellt wird.",
      "noNav": "Interne Platzierung nicht verfügbar — bauen Sie diese Oberfläche mit dem aktuellen Toolkit neu, damit sie surface.json ausgibt.",
      "placementExternal": "Extern (nur eigene URL)",
      "placementInternal": "In der Seitenleiste (eingebettet)",
      "placementLabel": "Platzierung",
      "staff": "Mitarbeiter",
      "subtitle": "Eine Mitarbeiter-Oberfläche kann sich in die Seitenleiste dieses Dashboards einfügen oder für sich stehen; eine Kunden-Oberfläche ist öffentlich und liest über ihren gebundenen Schlüssel.",
      "title": "Oberflächen"
    },
    "title": "Gehostete Apps",
    "install": {
      "steps": {
        "bundle": "Paket",
        "database": "Datenbank",
        "plan": "Schemaplan",
        "done": "Fertig"
      },
      "progress": "Installationsfortschritt",
      "failed": "Installation fehlgeschlagen",
      "bundle": {
        "title": "App-Paket hochladen",
        "hint": "Die .tgz-Datei, die `npm pack` für eine gebaute Oberfläche erzeugt — sie enthält manifest.json und ein Verzeichnis staff/ oder customer/.",
        "file": "Paketdatei (.tgz)",
        "fileHint": "Es wird nichts angelegt, bevor Sie den Schemaplan bestätigen.",
        "integrity": "Prüfsumme (optional)",
        "integrityHint": "Fügen Sie den sha512-Wert aus `npm pack --json` ein, damit der Server genau diese Bytes prüft. Bleibt das Feld leer, wird er hier berechnet."
      },
      "database": {
        "title": "In welche Datenbank installieren?",
        "hint": "Wählen Sie eine beschreibbare Verbindung. Dort werden die Tabellen angelegt, und daraus liest die App anschließend.",
        "tables": "Tabellen: {count}",
        "readOnly": "Nur lesend",
        "writable": "Beschreibbar",
        "noWritable": "Keine beschreibbare Verbindung",
        "allReadOnly": "Alle Verbindungen hier verwenden eine nur lesende Rolle, daher kann keine App ihre Tabellen anlegen. Verbinden Sie zuerst eine, die DDL ausführen darf."
      },
      "plan": {
        "title": "Schemaplan prüfen",
        "hint": "Genau das wird in Ihrer Datenbank angelegt. Bisher wurde nichts geschrieben.",
        "refused": "Diese App kann hier nicht installiert werden",
        "create": "Anlegen",
        "reuse": "Vorhandene nutzen",
        "toggleDdl": "DDL-Vorschau anzeigen",
        "ddl": "DDL-Vorschau",
        "ddlNote": "Beispielhaft. Der Server erzeugt die exakte Anweisung für Ihre Engine, inklusive Fremdschlüsseln.",
        "summary": "{created} angelegt · {reused} wiederverwendet"
      },
      "done": {
        "title": "Installiert",
        "body": "{key} wird jetzt ausgeliefert. Wählen Sie unten, wo die Mitarbeiterseite erscheint.",
        "schema": "Tabellen angelegt: {created} · wiederverwendet: {reused}"
      },
      "cancel": "Abbrechen",
      "back": "Zurück",
      "upload": "Hochladen",
      "continue": "Weiter",
      "confirm": "Installieren",
      "finish": "Apps verwalten",
      "staged": "Entpackte Dateien: {files}",
      "footerStep": "Schritt {n} von {total}",
      "footerStepApp": "Schritt {n} von {total} · {app}",
      "chosen": {
        "title": "{app} installieren",
        "hint": "Diese App kam mit Ihrem Build und liegt bereits auf der Festplatte. Es wird nichts angelegt, bevor Sie den Schemaplan bestätigen."
      },
      "uploaded": {
        "hint": "Aus der manifest.json im hochgeladenen Paket gelesen. Es wird nichts angelegt, bevor Sie den Schemaplan bestätigen.",
        "replace": "Anderes Paket hochladen"
      }
    },
    "installed": {
      "title": "Installierte Apps",
      "install": "App installieren",
      "emptyTitle": "Noch keine Apps installiert",
      "emptyBody": "Laden Sie ein gebautes Oberflächenpaket hoch, um eine zu installieren. Hier installierte Apps werden sofort ausgeliefert — ohne Neustart, anders als bei einem Verzeichnis.",
      "uninstall": "Deinstallieren",
      "confirmTitle": "Diese App deinstallieren?",
      "confirmBody": "Ihre Oberflächen werden nicht mehr ausgeliefert und das Paket wird gelöscht. Tabellen, die sie in Ihrer Datenbank angelegt hat, bleiben unangetastet.",
      "confirmPrompt": "Geben Sie zur Bestätigung {key} ein",
      "confirmCancel": "Abbrechen",
      "confirmClose": "Schließen",
      "stagedTitle": "Hochgeladen, aber nicht installiert",
      "stagedHint": "Verwerfen Sie, wogegen Sie sich entschieden haben, oder laden Sie denselben Schlüssel erneut hoch, um ihn zu ersetzen.",
      "discard": "Verwerfen",
      "installedAt": "installiert {when}"
    },
    "browse": {
      "title": "Apps, die Sie installieren können",
      "subtitle": "Fertige Apps, die mit diesem Build geliefert wurden. Eine Installation legt die benötigten Tabellen an und liefert die Oberflächen aus — bis Sie den Plan bestätigen, passiert nichts.",
      "search": "Apps suchen…",
      "clear": "Suche leeren",
      "all": "Alle",
      "by": "von {publisher}",
      "install": "Installieren",
      "installed": "Installiert",
      "noMatch": "Keine App passt zu dieser Suche",
      "noMatchBody": "Versuchen Sie einen anderen Begriff oder eine andere Kategorie.",
      "emptyTitle": "Keine Apps zum Installieren verfügbar",
      "emptyBody": "Apps, die mit diesem Build geliefert werden, erscheinen hier. Lassen Sie ADMINIUM_BUNDLED_APPS auf ein Verzeichnis mit App-Paketen zeigen, oder laden Sie selbst eines hoch.",
      "unreadable": "Das Manifest dieses Pakets konnte nicht gelesen werden. Es lässt sich nicht installieren — verwerfen Sie es unten."
    }
  },
  "hub": {
    "action": {
      "delete": "Löschen",
      "pause": "Pausieren",
      "pausedHint": "Diese Verbindung ist pausiert – setzen Sie sie fort, um die Datenbank zu erreichen.",
      "regional": "Regionale Einstellungen",
      "reintrospect": "Neu introspizieren",
      "reintrospectFile": "Schemadatei-Quellen haben keine Live-Datenbank — laden Sie stattdessen die Datei erneut hoch.",
      "remap": "Schema neu zuordnen",
      "rename": "Umbenennen",
      "resume": "Fortsetzen",
      "test": "Testen"
    },
    "card": {
      "lastIntrospected": "Zuletzt introspiziert",
      "latency": "Latenz",
      "latencyMs": "{latency, number} ms",
      "never": "Nie",
      "pages": "Seiten",
      "paused": "Adminium stellt keine Verbindung zu dieser Datenbank her. Ihre Seiten laden wieder, sobald Sie sie fortsetzen.",
      "pausedSince": "Pausiert {when} – Adminium stellt keine Verbindung zu dieser Datenbank her. Ihre Seiten laden wieder, sobald Sie sie fortsetzen.",
      "readOnly": "Schreibgeschützt",
      "tables": "Tabellen",
      "timezone": "Zeitzone",
      "timezoneGuessed": "von diesem Server"
    },
    "connectNew": "Neue Verbindung",
    "delete": {
      "body": "Dies löscht „{name}“ und die daraus generierten Seiten. Ihre Datenbank selbst bleibt unangetastet.",
      "cancel": "Abbrechen",
      "close": "Schließen",
      "confirm": "Verbindung löschen",
      "failed": "Die Verbindung konnte nicht gelöscht werden. Versuchen Sie es erneut.",
      "prompt": "Geben Sie {name} zur Bestätigung ein",
      "success": "Verbindung „{name}“ gelöscht",
      "title": "Verbindung löschen"
    },
    "empty": {
      "body": "Verbinden Sie eine Datenbank — Adminium generiert Ihr Admin-Panel aus deren Schema.",
      "cta": "Datenbank verbinden",
      "title": "Noch keine Datenquellen"
    },
    "hostedApps": "Gehostete Apps",
    "introspect": {
      "failed": "Introspektion fehlgeschlagen. Versuchen Sie es erneut.",
      "masksProposed": "{count, plural, one {# Spalte} other {# Spalten}} zur Maskierung vorgeschlagen — im Remap-Editor prüfen.",
      "noChanges": "Schema unverändert — kein neuer Snapshot.",
      "updated": "Schema neu introspiziert"
    },
    "pause": {
      "body": "Adminium baut keine Verbindung mehr zu „{name}“ auf. {pages, plural, one {# Seite} other {# Seiten}}, geplante Berichte und gehostete Apps laden keine Daten mehr, bis Sie sie fortsetzen.",
      "confirm": "Verbindung pausieren",
      "keeps": "Nichts wird gelöscht – die Verbindung, ihr Schema und {pages, plural, one {ihre # Seite} other {ihre # Seiten}} bleiben erhalten, und ein Klick holt sie zurück.",
      "pauseFailed": "Die Verbindung konnte nicht pausiert werden. Versuchen Sie es erneut.",
      "pausedToast": "Verbindung „{name}“ pausiert",
      "resumeFailed": "Die Verbindung konnte nicht fortgesetzt werden. Versuchen Sie es erneut.",
      "resumedToast": "Verbindung „{name}“ fortgesetzt",
      "title": "Diese Verbindung pausieren?"
    },
    "regional": {
      "currency": "Währung",
      "currencyHelper": "Dient der Formatierung von Beträgen. Optional – ohne Angabe ändert sich nur die Formatierung.",
      "currencyPlaceholder": "ISO-4217-Code",
      "failed": "Regionale Einstellungen konnten nicht gespeichert werden",
      "guessedBody": "Adminium hat sie von der Maschine übernommen, auf der es läuft — niemand hier hat sie gewählt. Zum Bestätigen speichern oder die Zeitzone wählen, in der dieses Unternehmen tatsächlich arbeitet.",
      "guessedTitle": "Diese Zeitzone stammt vom Server",
      "intro": "Sie beschreiben das Unternehmen, zu dem diese Datenbank gehört, nicht die lesende Person. Von Adminium ausgelieferte Apps lesen sie hier.",
      "noMatch": "Keine passende Zone",
      "noMatchCurrency": "Keine passende Währung",
      "notSet": "Nicht gesetzt",
      "save": "Speichern",
      "saved": "Regionale Einstellungen aktualisiert",
      "timezone": "Zeitzone",
      "timezoneHelper": "Datum und Uhrzeit werden in dieser Zeitzone dargestellt. Von Adminium gehostete Apps weichen ohne Angabe auf UTC aus und weisen im Bildschirm darauf hin.",
      "timezonePlaceholder": "Region/Stadt",
      "title": "Regionale Einstellungen"
    },
    "rename": {
      "failed": "Die Verbindung konnte nicht umbenannt werden",
      "helper": "Wie diese Datenbank in Adminium überall heißt — die Karte, die Seitenleisten-Gruppe über ihren Seiten und jede Auswahl, die sie anbietet. Die Datenbank selbst wird nicht umbenannt.",
      "label": "Name",
      "save": "Umbenennen",
      "saved": "Verbindung umbenannt",
      "title": "Verbindung umbenennen"
    },
    "stats": {
      "connections": "Verbindungen",
      "healthy": "Fehlerfrei",
      "pages": "Generierte Seiten",
      "tables": "Einbezogene Tabellen"
    },
    "status": {
      "connected": "Verbunden",
      "error": "Fehler",
      "paused": "Pausiert",
      "testing": "Wird getestet…",
      "unconfigured": "Entwurf"
    },
    "subtitle": "{healthy, number} von {total, plural, one {# Verbindung} other {# Verbindungen}} fehlerfrei",
    "subtitlePaused": "{healthy, number} von {total, plural, one {# Verbindung} other {# Verbindungen}} fehlerfrei · {paused, number} pausiert",
    "test": {
      "failed": "Verbindungstest fehlgeschlagen",
      "ok": "Verbindung fehlerfrei · {latency, number} ms"
    },
    "title": "Datenverbindungen"
  },
  "intent": {
    "analytics": {
      "description": "Dashboards, Diagramme und schreibgeschützte Tabellen. Keine Formulare, keine Schreibvorgänge — jede Rolle auf Betrachter begrenzt.",
      "title": "Schreibgeschützte Analysen"
    },
    "crud": {
      "description": "Eine Bearbeitungsseite pro Tabelle plus Suche und Import/Export — ein minimales Zuhause, keine Dashboards.",
      "title": "CRUD-Tabellen"
    },
    "fullAdmin": {
      "description": "Dashboards, CRUD-Seiten, Suche, Importe und Exporte — alles, was Ihr Schema unterstützt.",
      "title": "Vollständiges Admin-Panel"
    },
    "subtitle": "Der Zweck bestimmt, welche Seiten generiert werden. Sie können ihn später ändern — eine Änderung schlägt eine Neugenerierung vor, nie ein stilles Überschreiben.",
    "support": {
      "description": "Zuerst Warteschlangen, Ticket- und Kundendetailseiten. Löschen standardmäßig aus. (Queue-Vorlagen kommen mit M7 — der v1-Seitensatz entspricht dem vollständigen Admin.)",
      "title": "Support-Konsole"
    },
    "title": "Was brauchen Sie?",
    "trust": "Wir lesen nur Ihr Schema — während der Einrichtung nie Ihre Zeilendaten."
  },
  "llmRuns": {
    "review": {
      "applied": {
        "body": "Die übernommenen Vorschläge unten sind schreibgeschützt.",
        "title": "Dieser Lauf wurde angewendet"
      },
      "apply": {
        "confirm": "Änderungen übernehmen",
        "empty": "Nichts zum Übernehmen ausgewählt.",
        "subtitle": "Diese Änderungen werden in einer Transaktion geschrieben und können rückgängig gemacht werden.",
        "title": "{n} Vorschläge übernehmen"
      },
      "applyFailed": "Es wurde nichts übernommen",
      "applyUnknown": "Der Server hat nicht gesagt, warum.",
      "bulk": {
        "acceptAll": "Alle ≥ {pct}% übernehmen",
        "clear": "Auswahl aufheben",
        "thresholdAria": "Konfidenzschwelle für „Alle übernehmen“",
        "thresholdLabel": "Konfidenzschwelle"
      },
      "cat": {
        "copy": "Mikrotext",
        "dashboard": "Dashboard",
        "enum": "Enum",
        "group": "Navigationsgruppe",
        "key": "Schlüsselspalten",
        "label": "Bezeichnung",
        "pii": "PII",
        "relation": "Beziehung",
        "template": "Seitenvorlage",
        "widget": "Widget"
      },
      "empty": {
        "body": "Dieser Lauf hat keine Vorschläge zur Prüfung erzeugt.",
        "title": "Keine Vorschläge"
      },
      "error": {
        "title": "Dieser Lauf konnte nicht geladen werden"
      },
      "footer": {
        "apply": "{n} übernommene Vorschläge anwenden",
        "count": "{n} Vorschläge ausgewählt",
        "failed": "Anwenden fehlgeschlagen"
      },
      "group": {
        "dashboards": "Dashboards & Widgets",
        "enums": "Enum-Semantik",
        "icons": "Symbole",
        "keys": "Schlüsselspalten",
        "labels": "Bezeichnungen & Übersetzungen",
        "microcopy": "Mikrotexte",
        "navigation": "Navigation & Domänen",
        "pii": "PII & Maskierung",
        "relations": "Beziehungen",
        "templates": "Seitenvorlagen"
      },
      "header": {
        "agree": "{n} übereinstimmend",
        "byo": "BYO",
        "conflict": "{n} Konflikt",
        "countsAria": "Anzahl der Vorschläge",
        "model": "Modell",
        "new": "{n} neu",
        "pathByo": "Kopieren & Einfügen",
        "pathDirect": "Direkte API",
        "rejects": "{n} Ablehnungen",
        "snapshot": "Schnappschuss",
        "title": "KI-Vorschläge prüfen"
      },
      "notReady": {
        "body": "Ein Lauf muss validiert sein, bevor seine Vorschläge geprüft werden können. Erzeugen oder fügen Sie zuerst eine Antwort ein.",
        "title": "Dieser Lauf hat noch keine Vorschläge zur Prüfung"
      },
      "row": {
        "acceptAria": "{noun}-Vorschlag für {target} übernehmen",
        "confidenceAria": "Konfidenz {pct}%",
        "hideTranslations": "Übersetzungen ausblenden",
        "keptEdited": "beibehalten – von Ihnen bearbeitet",
        "noAi": "Kein KI-Vorschlag",
        "rejectsCallout": "Die KI lehnt eine heuristische Entscheidung ab – vor dem Übernehmen bestätigen.",
        "showTranslations": "Übersetzungen anzeigen"
      },
      "section": {
        "acceptedCount": "{n} übernommen",
        "selectAllAria": "Alle in {group} auswählen"
      },
      "status": {
        "agree": "Stimmt überein",
        "conflict": "Konflikt",
        "heuristicOnly": "Nur Heuristik",
        "locked": "Gesperrt",
        "new": "Neu",
        "rejects": "Lehnt Heuristik ab"
      },
      "toast": {
        "applied": "{n} Vorschläge übernommen",
        "appliedPartial": "{n} Vorschläge übernommen (einige übersprungen)",
        "applyFailed": "Vorschläge konnten nicht übernommen werden",
        "undoFailed": "Diese Änderung konnte nicht rückgängig gemacht werden"
      },
      "value": {
        "absent": "Keiner",
        "dash": "—",
        "description": "Beschreibung",
        "display": "Anzeige",
        "enumCategory": "Kategorie",
        "enumWorkflow": "Workflow",
        "guidance": "Hinweis für leeren Zustand",
        "headline": "Überschrift für leeren Zustand",
        "key": "Schlüssel",
        "label": "Bezeichnung",
        "none": "Kein Wert",
        "notPii": "Keine PII",
        "rank": "Rang {n}",
        "span": "Breite {n}",
        "subtitle": "Seitenuntertitel",
        "tableCount": "{n} Tabellen",
        "widgetCount": "{n} Widgets"
      }
    }
  },
  "meta": {
    "move": {
      "copying": "Adminiums Tabellen werden verschoben …",
      "copyingBody": "Jede adminium_-Tabelle wird in die neue Datenbank kopiert. Ihre Quelldaten bleiben unberührt, und es wird erst umgeschaltet, wenn die Kopie geprüft ist.",
      "failed": "Adminiums Tabellen konnten nicht verschoben werden — erneut versuchen.",
      "restarting": "Neustart …",
      "restartingBody": "Die Kopie ist fertig. Adminium startet auf der neuen Datenbank neu — diese Seite fährt in wenigen Sekunden von selbst fort.",
      "timeout": "Adminium hat seine Tabellen verschoben, ist aber noch nicht zurück. Ihre Daten liegen sicher in der neuen Datenbank — laden Sie diese Seite gleich neu.",
      "title": "Adminiums Tabellen werden verschoben"
    },
    "sameDb": {
      "description": "adminium_*-Tabellen werden neben Ihren Quelltabellen angelegt. Einfachste Einrichtung — benötigt eine Rolle mit Schreib- und CREATE-TABLE-Rechten.",
      "disabledFile": "Eine Schemadatei hat keine Live-Datenbank — wählen Sie für Adminiums eigene Tabellen eine separate Datenbank.",
      "disabledNoDdl": "Diese Rolle darf kein DDL ausführen — Adminium-Migrationen benötigen CREATE TABLE. Wählen Sie für Adminiums eigene Tabellen eine separate Datenbank.",
      "disabledReadOnly": "Ihre Rolle ist schreibgeschützt — Adminium schreibt nie in diese Datenbank. Wählen Sie für Adminiums eigene Tabellen eine separate Datenbank.",
      "title": "Gleiche Datenbank"
    },
    "separate": {
      "description": "Adminium hält seine Tabellen in einer anderen Datenbank. Ihre Quelle bleibt unangetastet — erforderlich für schreibgeschützte Quellen.",
      "dsn": "Verbindungszeichenfolge der Meta-Datenbank",
      "errorTitle": "Meta-Store nicht kompatibel",
      "helper": "Benötigt Schreib- und DDL-Rechte — Adminium führt dort seine eigenen Migrationen aus.",
      "insufficient": "Diese Rolle kann den Meta-Store nicht aufnehmen — Adminium benötigt dort Schreib- und CREATE-TABLE-Rechte.",
      "ok": "Kompatibel — Schreiben ✓ · DDL ✓",
      "test": "Verbindung testen",
      "title": "Separate Datenbank"
    },
    "subtitle": "Seiten, Rollen, Audit-Log und Einstellungen liegen in Tabellen mit adminium_-Präfix — nie mit Ihren Daten vermischt.",
    "testFailed": "Verbindung fehlgeschlagen.",
    "title": "Wo soll Adminium seine eigenen Tabellen ablegen?",
    "v1Note": {
      "body": "Dieser Server hält seine eigenen Tabellen bereits in einer konfigurierten Datenbank, und dieser Schritt verschiebt sie nicht. Er prüft, ob Ihre Wahl mit dieser Verbindung kompatibel ist — der Server erzwingt dieselbe Regel unabhängig (409 META_PLACEMENT_INVALID).",
      "title": "Über diese Installation"
    },
    "willMove": {
      "body": "Adminium nutzt derzeit seinen integrierten SQLite-Speicher. „Weiter“ kopiert diesen Speicher in die gewählte Datenbank und startet darauf neu — Konten, Seiten und Einstellungen kommen mit, Sie bleiben angemeldet.",
      "title": "Dies verschiebt Adminiums Tabellen"
    }
  },
  "pages": {
    "action": {
      "delete": "Seite löschen",
      "duplicate": "Duplizieren",
      "edit": "Seite bearbeiten",
      "hide": "In der Seitenleiste ausblenden",
      "show": "In der Seitenleiste anzeigen"
    },
    "attachments": {
      "accept": "Zulässige Dateitypen",
      "acceptHint": "Keine Auswahl akzeptiert alles, was dieser Workspace erlaubt. Eine Auswahl hier kann diese Liste nur einschränken, nie erweitern.",
      "column": {
        "adoptHint": "Diese Tabelle hat die Spalte bereits, es wird also nichts angelegt — sie wird so verwendet, wie sie ist.",
        "bound": "Dateien liegen in der Spalte {column} dieser Tabelle.",
        "boundHint": "Wenn Sie Anhänge später abschalten, wird nur diese Seite gelöst. Die Spalte und ihre Dateien bleiben unangetastet.",
        "confirm": "Ausführen",
        "create": "Spalte anlegen",
        "createHint": "Adminium fügt dieser Tabelle eine Textspalte hinzu. Sie sehen die genaue Anweisung, bevor etwas läuft.",
        "createdHint": "Die Spalte existiert jetzt. Speichern Sie diese Seite, um die Verknüpfung abzuschließen.",
        "failed": "Das hat nicht funktioniert",
        "invalid": "Ein Spaltenname muss mit einem Buchstaben beginnen und darf nur Kleinbuchstaben, Ziffern und Unterstriche enthalten.",
        "label": "Spalte, die die Dateien enthält",
        "required": "Geben Sie der Spalte einen Namen.",
        "tooLong": "Dieser Name ist zu lang für eine Spalte.",
        "use": "Diese Spalte verwenden",
        "wrongType": "Diese Tabelle hat bereits eine Spalte mit diesem Namen, und sie kann keine Dateireferenz aufnehmen. Wählen Sie einen anderen Namen."
      },
      "destination": "Wohin die Dateien gehen",
      "destinationDefault": "Das Standard-Speicherziel",
      "destinationHint": "Belassen Sie dies beim Standard, es sei denn, die Dateien dieser Tabelle gehören woandershin.",
      "destinationIsDefault": "{name} (Standard)",
      "destinationLocal": "Die Festplatte dieses Servers",
      "enable": "Anhänge an den Datensätzen dieser Tabelle erlauben",
      "enableHint": "Dateien werden auf Adminiums Seite verknüpft, diese Tabelle braucht also keine neue Spalte — es funktioniert auf einer schreibgeschützten Verbindung und auf einer Tabelle, die Sie lieber nicht ändern möchten.",
      "enableHintColumn": "Dateien liegen in einer Spalte dieser Tabelle und erscheinen deshalb sowohl in den Dialogen „Neu“ und „Bearbeiten“ als auch bei jedem Datensatz.",
      "enableHintSidecar": "Dateien werden stattdessen auf Adminium-Seite verknüpft. Sie erscheinen auf der Seite jedes Datensatzes, nicht im Dialog „Neu“.",
      "maxBytes": "Größte Datei (MB)",
      "maxBytesHint": "Leer lassen, um dem Limit des Workspace zu folgen. Eine Zahl hier kann es nur senken.",
      "maxCount": "Höchstzahl an Dateien pro Datensatz",
      "maxCountHint": "Leer lassen, um so viele zu akzeptieren, wie ein Datensatz braucht.",
      "sidecar": {
        "noPrivilege": "Die Rolle dieser Verbindung kann keine Tabellen ändern, deshalb kann Adminium ihr keine Spalte hinzufügen.",
        "readOnlyIntent": "Diese Verbindung ist für reine Auswertung eingerichtet, deshalb kann Adminium ihr keine Spalte hinzufügen.",
        "readOnlyRole": "Diese Verbindung meldet sich mit einer schreibgeschützten Rolle an, deshalb kann Adminium ihr keine Spalte hinzufügen.",
        "schemaFile": "Diese Verbindung wurde aus einer Schemadatei erstellt, deshalb kann Adminium ihr keine Spalte hinzufügen."
      },
      "type": {
        "office": "Office-Dokumente",
        "text": "Reiner Text"
      }
    },
    "columns": {
      "addFromLinked": "Aus verknüpften Tabellen",
      "addFromTable": "Aus {table}",
      "addLinkedFrom": "Tabellen, die hierher verweisen",
      "addLinkedFromHelp": "Zählen Sie die Zeilen, die auf jeden Datensatz verweisen, oder addieren Sie eine ihrer Zahlen.",
      "addLinkedHelp": "Zeigt einen Wert aus der Tabelle, auf die eine Verknüpfungsspalte verweist.",
      "addNoMatches": "Keine Spalten passen zu „{query}“.",
      "addOpen": "Spalte hinzufügen",
      "addSearch": "Spalten durchsuchen…",
      "addTitle": "Spalte hinzufügen",
      "addVia": "über {column}",
      "avatar": "Avatar",
      "avatarToggle": "Monogramm neben {name} anzeigen",
      "countBadge": "Anzahl",
      "dragHandle": "{name} verschieben",
      "empty": "Noch keine Spalten — fügen Sie unten welche hinzu.",
      "file": {
        "acceptHelp": "Lassen Sie alle Typen aus, um alles zu akzeptieren, was dieser Workspace akzeptiert. Eine Auswahl kann diese Liste nur einschränken — eine Spalte akzeptiert nie einen Typ, den der Workspace ablehnt.",
        "acceptLabel": "Zulässige Typen",
        "badge": "Datei",
        "destinationDefault": "Das Standard-Speicherziel",
        "destinationHelp": "Wo die über diese Spalte hochgeladenen Bytes abgelegt werden.",
        "destinationLabel": "Speicherziel",
        "inlineHelp": "Nur Bilder werden in der Zelle dargestellt. Alles andere bleibt ein Chip mit Name und Größe, ganz gleich, wie dies eingestellt ist.",
        "inlineLabel": "In der Tabelle anzeigen",
        "maxCountHelp": "Leer lassen, um so viele zu akzeptieren, wie ein Datensatz braucht.",
        "maxCountLabel": "Höchstzahl Dateien pro Datensatz",
        "maxCountToggle": "Höchstzahl Dateien für {name}",
        "maxHelp": "Leer lassen, um das Limit des Workspace zu verwenden. Eine Spalte kann nur weniger verlangen.",
        "maxLabel": "Größte Datei (MB)",
        "maxToggle": "Größte von {name} akzeptierte Datei, in MB",
        "multipleHelp": "Die Spalte speichert eine Liste von Dateien statt einer einzelnen. Vorhandene Einzelwerte funktionieren weiter — sie werden als Liste mit einem Eintrag gelesen.",
        "multipleLabel": "Mehr als eine Datei aufnehmen",
        "ref": {
          "id": "Adminiums Datei-ID",
          "key": "Der Schlüssel im Speicherziel",
          "url": "Ein Link zur Datei"
        },
        "refHelp": "Was in diese Spalte geschrieben wird, wenn eine Datei hochgeladen wird. Bereits gespeicherte Werte funktionieren weiter — dies ändert nur den nächsten.",
        "refLabel": "Gespeicherter Wert",
        "refTooNarrow": "Diese Spalte ist zu kurz für diesen Wert. Wählen Sie einen, den sie aufnehmen kann, oder erweitern Sie die Spalte in der Datenbank.",
        "refWidth": "{shape} — braucht {needs} Zeichen, diese Spalte fasst {holds}",
        "switch": "Datei",
        "switchToggle": "{name} speichert eine Datei",
        "type": {
          "csv": "CSV",
          "gif": "GIF",
          "heic": "HEIC",
          "jpeg": "JPEG",
          "json": "JSON",
          "markdown": "Markdown",
          "mp3": "MP3-Audio",
          "mp4": "MP4-Video",
          "office": "Office-Dokumente",
          "ogg": "Ogg",
          "pdf": "PDF",
          "png": "PNG",
          "svg": "SVG",
          "text": "Reiner Text",
          "wav": "WAV-Audio",
          "webm": "WebM",
          "webp": "WebP",
          "zip": "ZIP"
        }
      },
      "fold": {
        "avg": "Durchschnitt",
        "max": "Max",
        "min": "Min",
        "sum": "Summe"
      },
      "foldAdd": "Hinzufügen",
      "foldLabel": "Aggregat",
      "followColumn": "{name} folgen",
      "header": "Überschrift für {name}",
      "help": "Spalten per Ziehen umsortieren, ihre Überschriften umbenennen und auswählen, welche in der Tabelle erscheinen.",
      "lookupBack": "Zurück",
      "lookupBadge": "Verknüpft",
      "lookupBroken": "Diese Verknüpfung lässt sich nicht mehr auflösen",
      "lookupBrokenBody": "Das Schema hat sich währenddessen geändert. Beginnen Sie die Verknüpfung erneut.",
      "lookupBrowse": "Wählen Sie, was aus {table} angezeigt wird",
      "mask": "Maskieren",
      "maskHelp": "Maskieren verbirgt einen Wert hinter einer Anzeigen-Schaltfläche für Lesende, die ihn sehen dürfen. Ob die Daten die Datenbank überhaupt verlassen, wird an der Verbindung festgelegt, nicht hier.",
      "maskToggle": "{name} hinter einer Anzeigen-Schaltfläche verbergen",
      "masked": "Maskiert",
      "none": {
        "body": "Spalten werden bei der Generierung aus der Tabelle gelesen. Binden Sie diese Seite an eine Tabelle und generieren Sie neu, um sie zu füllen.",
        "title": "Diese Seite hat noch keine Spalten"
      },
      "pk": "Schlüssel",
      "remove": "{name} entfernen",
      "schemaUnavailable": "Die Datenbankspalten konnten nicht geladen werden, daher lassen sich hier keine Spalten hinzufügen.",
      "shown": "Sichtbar",
      "toggle": "{name} in der Tabelle anzeigen"
    },
    "create": {
      "failed": "Die Seite konnte nicht erstellt werden",
      "submit": "Seite erstellen",
      "subtitle": "Legen Sie fest, was diese Seite zeigt und wie sie aussieht. Die Vorschau folgt Ihrer Auswahl.",
      "title": "Neue Seite"
    },
    "createButton": "Neue Seite",
    "delete": {
      "body": "Das lässt sich nicht rückgängig machen. Gespeicherte Ansichten und persönliche Layouts dieser Seite werden für alle gelöscht.",
      "bodyGenerated": "Diese Seite stammt aus der Schema-Generierung und kehrt beim nächsten Generierungslauf zurück. Gespeicherte Ansichten und persönliche Layouts werden für alle gelöscht.",
      "confirm": "Seite löschen",
      "prompt": "Geben Sie zur Bestätigung {slug} ein",
      "title": "Diese Seite löschen?"
    },
    "derived": {
      "add": "Spalte hinzufügen",
      "atLeast": "ist mindestens",
      "cancel": "Abbrechen",
      "emptyBody": "Fassen Sie zuerst eine verknüpfte Tabelle in der Spalten-Karte zusammen — die Regeln hier bauen auf diesen Zahlen auf.",
      "emptyTitle": "Noch keine berechneten Zahlen",
      "fieldBadge": "Berechnet",
      "foldBadge": "Zusammenfassung",
      "help": "Berechnen Sie Zahlen aus den Zusammenfassungen oben und den eigenen Spalten dieses Datensatzes. Sie werden beim Laden der Seite berechnet und lassen sich nicht sortieren.",
      "label": "Spaltenüberschrift",
      "minus": "minus",
      "numberHelp": "Zahlen sind einfache Dezimalzahlen — 500 oder 12.50, nie 1,000 oder 5e3.",
      "operandA": "Zahl",
      "operandB": "Zahl",
      "operator": "Operator",
      "otherwise": "sonst",
      "percentOf": "Prozent aus diesem Datensatz",
      "plus": "plus",
      "preset": {
        "combine": "Zwei Zahlen addieren oder subtrahieren",
        "percent": "Prozentsatz einer Zahl",
        "rule": "Regel mit einem Schwellenwert"
      },
      "previewHelp": "Beispielwerte, berechnet mit demselben Code, den die Seite verwendet.",
      "previewTitle": "Vorschau",
      "remove": "{name} entfernen",
      "thenShow": "dann zeigen"
    },
    "duplicate": {
      "failed": "Die Seite konnte nicht dupliziert werden",
      "submit": "Duplizieren",
      "title": "Seite duplizieren"
    },
    "editor": {
      "appearance": "Darstellung",
      "attachments": "Anhänge",
      "columns": "Spalten",
      "contentInvalid": "Die Konfiguration dieser Seite ist nicht lesbar",
      "contentInvalidBody": "Sie stammt aus einer neueren Version oder ist fehlerhaft. Erzeugen Sie die Seite neu oder löschen Sie sie.",
      "contentUnavailable": "Seiteninhalt konnte nicht geladen werden",
      "contentUnavailableBody": "Die Angaben oben lassen sich trotzdem speichern.",
      "data": "Daten",
      "derived": "Abgeleitete Zahlen",
      "details": "Details",
      "generated": {
        "body": "Ihre Änderungen bleiben bei einer erneuten Generierung erhalten – die Seite wird als bearbeitet markiert und unangetastet gelassen. Ein Löschen hält allerdings nur, bis der nächste Generierungslauf sie neu anlegt.",
        "title": "Diese Seite wurde aus Ihrem Schema erzeugt"
      },
      "itemsPending": "Speichern Sie zuerst die Änderung oben – der Seiteninhalt wird aus der neuen Vorlage und Tabelle neu aufgebaut.",
      "missing": "Diese Seite existiert nicht mehr",
      "missingBody": "Sie wurde möglicherweise gelöscht oder von einem Generierungslauf entfernt.",
      "notBindable": "Diese Vorlage ist nicht an eine einzelne Tabelle gebunden",
      "notBindableBody": "Ihr Inhalt wird stattdessen Widget für Widget aufgebaut. Öffnen Sie die Seite und fügen Sie sie über „Bearbeiten“ hinzu.",
      "openPage": "Seite öffnen",
      "recompose": "Diese Seite wird neu aufgebaut",
      "recomposeBody": "Beim Speichern wird der Inhalt durch ein frisches Layout für Vorlage und Tabelle oben ersetzt. Spaltenanpassungen und Widget-Änderungen dieser Seite gehen verloren.",
      "save": "Änderungen speichern",
      "saveFailed": "Änderungen konnten nicht gespeichert werden",
      "schemaFailed": "Tabellen konnten nicht aufgelistet werden",
      "schemaFailedBody": "Diese Verbindung wurde möglicherweise noch nicht analysiert. Starten Sie die Introspektion unter Studio → Datenverbindungen.",
      "title": "Seite bearbeiten"
    },
    "empty": {
      "body": "Verbinden Sie eine Datenbank, um Seiten automatisch zu erzeugen, oder legen Sie eine von Hand an.",
      "title": "Noch keine Seiten"
    },
    "field": {
      "connection": "Datenquelle",
      "connectionNone": "Keine",
      "group": "Gruppe der Seitenleiste",
      "groupHint": "In welchem Abschnitt der Seitenleiste sie erscheint.",
      "icon": "Symbol",
      "iconHint": "Wird neben dem Seitennamen in der Seitenleiste angezeigt.",
      "iconPick": "Seitensymbol auswählen",
      "newRowLabel": "Schaltfläche zum Hinzufügen",
      "newRowLabelHint": "Was auf der Schaltfläche steht, die einen Datensatz hinzufügt. Leer lassen für die Standardbeschriftung, die übersetzt wird.",
      "padding": "Seitenabstand",
      "slug": "Seitenadresse",
      "slugHint": "Kleinbuchstaben, Ziffern und Bindestriche. Nur der letzte Teil – den Rest der Adresse ergänzen wir.",
      "slugTaken": "Diese Adresse wird bereits von einer anderen Seite verwendet.",
      "slugWarning": "Eine geänderte Adresse macht bestehende Links und Lesezeichen zu dieser Seite ungültig.",
      "table": "Tabelle",
      "tableCreateHint": "Die Tabelle, aus der diese Seite liest. Wählen Sie jetzt eine, dann ist die Seite sofort nutzbar; ohne Auswahl können Sie sie später verknüpfen.",
      "tableNeedsConnection": "Wählen Sie zuerst eine Datenquelle.",
      "tableNone": "Nicht verknüpft",
      "template": "Vorlage",
      "templateHint": "Bestimmt, was die Seite enthalten kann. Später änderbar.",
      "title": "Titel",
      "titleHint": "Wird in der Seitenleiste und in der Kopfzeile der Seite angezeigt.",
      "visible": "In der Seitenleiste anzeigen",
      "visibleHint": "Eine ausgeblendete Seite bleibt über ihre URL erreichbar, wenn man den Link kennt.",
      "width": "Inhaltsbreite",
      "widthHint": "Wie breit die Inhaltsspalte der Seite auf einem großen Bildschirm werden darf."
    },
    "icon": {
      "noMatches": "Keine Symbole passen zu dieser Suche.",
      "none": "Symbol auswählen",
      "search": "Symbole suchen"
    },
    "list": {
      "count": "{count, plural, one {# Seite} other {# Seiten}}",
      "title": "Seiten"
    },
    "loadFailed": {
      "body": "Für die Seitenverwaltung wird die Berechtigung „Seiten verwalten“ benötigt. Bitten Sie eine Administratorin oder einen Administrator, sie einer Ihrer Rollen zuzuweisen.",
      "title": "Seiten konnten nicht geladen werden"
    },
    "origin": {
      "generated": "Erzeugt",
      "llm": "Assistent",
      "manifest": "Add-on",
      "system": "System",
      "user": "Eigene"
    },
    "padding": {
      "custom": "Benutzerdefiniert …",
      "default": "Standard dieser Vorlage",
      "none": "Kein Abstand",
      "standard": "Standard (28 × 24)",
      "x": "Seiten (px)",
      "y": "Oben und unten (px)"
    },
    "preview": {
      "note": "Eine Darstellung des Layouts, nicht Ihrer Daten. Die echte Seite füllt sich nach dem Speichern.",
      "untitled": "Unbenannte Seite"
    },
    "row": {
      "menu": "Aktionen für {title}"
    },
    "sidebar": {
      "discard": "Verwerfen",
      "emptyGroup": "Keine Seiten in dieser Gruppe.",
      "help": "Seiten innerhalb einer Gruppe umsortieren oder in eine andere Gruppe verschieben. Die Änderungen gelten für alle Benutzerinnen und Benutzer.",
      "moveDown": "{title} nach unten verschieben",
      "moveTo": "{title} in eine Gruppe verschieben",
      "moveUp": "{title} nach oben verschieben",
      "save": "Reihenfolge speichern",
      "saveFailed": "Die neue Reihenfolge konnte nicht gespeichert werden",
      "ungrouped": {
        "body": "Diese Seiten funktionieren unter ihrer URL, erscheinen aber nirgends in der Seitenleiste. Öffnen Sie jede einzeln und wählen Sie eine Gruppe.",
        "title": "Einige Seiten gehören zu keiner Gruppe der Seitenleiste"
      }
    },
    "status": {
      "hidden": "Ausgeblendet",
      "live": "Aktiv"
    },
    "subtitle": "Seiten Ihrer App hinzufügen, bearbeiten und ordnen – samt ihrer Reihenfolge in der Seitenleiste.",
    "tab": {
      "pages": "Alle Seiten",
      "sidebar": "Reihenfolge der Seitenleiste"
    },
    "title": "Seiten",
    "width": {
      "content": "Inhalt (900 px)",
      "dash": "Dashboard (1320 px)",
      "default": "Standard für diese Vorlage",
      "full": "Volle Breite (kein Limit)",
      "narrow": "Schmal (720 px)",
      "page": "Seite (1080 px)",
      "wide": "Breit (1800 px)"
    }
  },
  "publicApi": {
    "cancel": "Abbrechen",
    "close": "Schließen",
    "error": "Etwas ist schiefgelaufen",
    "keys": {
      "appHint": "Die Kunden-Oberfläche der App liefert diesen Schlüssel dann selbst aus — eine Rotation braucht keinen Rebuild.",
      "appLabel": "An eine gehostete App-Oberfläche binden (optional)",
      "appNone": "Nicht gebunden",
      "create": "Schlüssel erstellen",
      "emptyBody": "Erstellen Sie zuerst einen Scope und dann einen Schlüssel dafür.",
      "emptyTitle": "Noch keine Schlüssel",
      "formLabel": "Einen Schlüssel erstellen",
      "nameLabel": "Name",
      "reveal": "Schlüssel anzeigen",
      "revoke": "Widerrufen",
      "rotate": "Rotieren",
      "scopeIsAuthBody": "Ein Schlüssel erreicht genau das, was sein Scope auflistet, und sonst nichts. Er nutzt weder Rollen noch Tabellenberechtigungen und kann über die übrige API nichts lesen.",
      "scopeIsAuthTitle": "Der Scope ist die einzige Berechtigung",
      "scopeLabel": "Scope",
      "scopePlaceholder": "Scope wählen",
      "subtitle": "Diese landen im JavaScript Ihrer Seite, jeder kann sie also lesen. Das ist so gewollt — ein Schlüssel kann immer nur das, was sein Scope erlaubt.",
      "title": "Schlüssel"
    },
    "notRegistered": {
      "body": "Setzen Sie ADMINIUM_PUBLIC_API_ORIGINS auf genau die Origins, die diese API aufrufen dürfen, und starten Sie neu. Bis dahin werden diese Routen überhaupt nicht ausgeliefert.",
      "title": "Auf diesem Server nicht aktiviert"
    },
    "origins": {
      "label": "Origins, die sie aufrufen dürfen"
    },
    "scopes": {
      "connectionLabel": "Verbindungs-ID",
      "create": "Scope erstellen",
      "delete": "Löschen",
      "deleteBody": "Jede Seite, die einen an diesen Scope gebundenen Schlüssel verwendet, lädt keine Daten mehr. Schlüssel werden nicht gelöscht — widerrufen Sie sie zuerst, falls Sie das gemeint haben.",
      "deleteConfirm": "Scope löschen",
      "deletePrompt": "Geben Sie den Scope-Namen ein, um zu bestätigen",
      "deleteTitle": "Diesen Scope löschen",
      "documentHint": "Wird beim Speichern gegen Ihr Schema kompiliert. Jede Spalte, die eine aufrufende Seite erreichen kann, steht hier und sonst nirgends. Ein Standardwert kann '{'\"$generate\": \"uuid\"'}' oder '{'\"$generate\": \"now\"'}' sein — der Server füllt diese beim Anlegen aus, damit Besucher eine Zeile hinzufügen können, ohne deren id zu wählen.",
      "documentLabel": "Scope-Dokument",
      "emptyBody": "Erstellen Sie unten einen. Er wird vor dem Speichern gegen Ihr Live-Schema geprüft.",
      "emptyTitle": "Noch keine Scopes",
      "formLabel": "Einen Scope erstellen",
      "issuesTitle": "Dieser Scope ließ sich nicht kompilieren",
      "keyCount": "{count, plural, =0 {keine Schlüssel} one {# Schlüssel} other {# Schlüssel}}",
      "nameLabel": "Name",
      "subtitle": "Ein Scope ist alles, was ein Schlüssel erreichen darf — die Tabellen, die genauen Spalten und ein Filter, den die aufrufende Seite enger fassen, aber nie entfernen kann.",
      "title": "Scopes"
    },
    "status": {
      "heading": "Status"
    },
    "subtitle": "Lassen Sie Ihre eigenen kunden- oder mitarbeiterseitigen Seiten diese Datenbank über einen von Ihnen definierten Scope lesen.",
    "title": "Öffentliche API",
    "toggle": {
      "hint": "Wenn Sie dies abschalten, endet jede öffentliche Anfrage sofort. Es wird nichts gelöscht — Schlüssel, Scopes und Daten bleiben alle erhalten.",
      "label": "Öffentliche API ausliefern"
    }
  },
  "remap": {
    "badge": {
      "fk": "FK",
      "masked": "Maskiert",
      "pii": "PII",
      "pk": "PK",
      "unique": "UNIQUE"
    },
    "column": {
      "currency": "Währung",
      "currencyHelper": "ISO-4217-Code für die Formatierung von Geldbeträgen.",
      "enum": "Enum-Semantik",
      "enumCategory": "Kategorie",
      "enumHelper": "Workflow-Enums steuern Status-Pills und Board-Spalten; Farbtöne ordnen Werte der semantischen Farbtonskala zu.",
      "enumKind": "Enum-Art",
      "enumLabelFor": "Bezeichnung für {value}",
      "enumToneAuto": "automatisch",
      "enumToneFor": "Farbton für {value}",
      "enumWorkflow": "Workflow",
      "labelHelper": "Abgeleitet: {name}",
      "labelOverride": "Anzeigebezeichnung",
      "logicalType": "Logischer Typ",
      "logicalTypeHelper": "Abgeleitet: {type} (aus {dbType}) — vom Adapter zugeordnet; in v1 nicht überschreibbar.",
      "nullable": "NULL erlaubt",
      "pii": "Standardmäßig maskieren",
      "piiHelper": "Maskierte Werte werden geschwärzt dargestellt; das Aufheben der Maskierung erfordert die Berechtigung data.unmask_pii und wird im Audit-Log protokolliert.",
      "semantic": "Semantischer Typ",
      "semanticHelper": "Klassifizierer: {tag} · {confidence}% Konfidenz · Quelle: {source}",
      "semanticInferred": "abgeleitet: {tag}",
      "unclassified": "Noch nicht klassifiziert."
    },
    "diff": {
      "count": "{count} Änderungen",
      "one": "1 Änderung",
      "regenerate": "Seiten neu generieren",
      "revertAll": "Alle verwerfen",
      "revertOne": "{change} verwerfen",
      "save": "Überschreibungen speichern",
      "saved": "Überschreibungen gespeichert."
    },
    "empty": {
      "description": "Wählen Sie etwas im Schemabaum aus, um Bezeichnung, Typ, Beziehungen oder Maskierung neu zuzuordnen.",
      "title": "Wählen Sie eine Tabelle oder Spalte"
    },
    "inspector": "Inspektor",
    "loadFailed": "Das Schema für diese Verbindung konnte nicht geladen werden.",
    "mode": {
      "design": "Entwurf",
      "diagram": "Diagramm",
      "remap": "Bezeichnungen und Beziehungen"
    },
    "modeLabel": "Bearbeitungsmodus",
    "noDesign": {
      "noPrivilege": "Die Rolle dieser Verbindung kann keine Tabellen anlegen oder ändern. Erteilen Sie ihr Schemarechte oder verbinden Sie eine Rolle, die sie hat.",
      "readOnlyIntent": "Diese Verbindung wurde für reine Lese-Analysen eingerichtet. Ändern Sie ihre Absicht in den Einstellungen, um ihr Schema zu bearbeiten.",
      "readOnlyRole": "Diese Verbindung meldet sich mit einer Nur-Lese-Rolle an, daher kann Adminium ihr Schema nicht ändern.",
      "schemaFile": "Diese Verbindung wurde aus einer Schemadatei erstellt, es gibt also keine Datenbank zu ändern. Bezeichnungen und Beziehungen funktionieren weiterhin."
    },
    "relations": {
      "accept": "Übernehmen",
      "accepted": "Übernommen",
      "add": "Virtuelle Beziehung hinzufügen",
      "addButton": "Beziehung hinzufügen",
      "cardinality": "Kardinalität",
      "confidence": "abgeleitet · {pct}%",
      "declared": "Deklarierte Fremdschlüssel",
      "fromColumn": "Quellspalte",
      "fromPlaceholder": "customer_id",
      "inferred": "Abgeleitete Beziehungen",
      "noColumns": "Keine passende Spalte",
      "noTables": "Keine passende Tabelle",
      "noneDeclared": "Keine deklarierten Fremdschlüssel berühren diese Tabelle.",
      "noneInferred": "Für diese Tabelle wurde nichts abgeleitet.",
      "overrideBadge": "Überschreibung",
      "overrides": "Beziehungs-Überschreibungen (angewendet)",
      "suppress": "Unterdrücken",
      "suppressed": "Unterdrückt",
      "toColumn": "Zielspalte",
      "toTable": "Zieltabelle"
    },
    "saveFailed": "Speichern fehlgeschlagen: {message}",
    "subtitle": "{tables} Tabellen · {applied} Überschreibungen angewendet",
    "table": {
      "hierarchy": "Hierarchie",
      "icon": "Symbol",
      "iconPicker": "Tabellensymbol",
      "include": "In die generierte App einbeziehen",
      "includeHelper": "Ausgeschlossene Tabellen erhalten keine Seiten und verschwinden aus der Navigation.",
      "kind": "Art",
      "labelHelper": "Abgeleitet: {name}",
      "labelOverride": "Anzeigebezeichnung",
      "navGroup": "Navigationsgruppe",
      "navGroupHelper": "Die Platzierung in der Navigation entscheidet der Generator — eine table.navGroup-Überschreibung ist nicht Teil des v1-Vokabulars.",
      "polymorphic": "Polymorphe Paare",
      "role": "Rolle",
      "rows": "Geschätzte Zeilenzahl",
      "selfFk": "Selbstreferenz über {column}",
      "shape": "Tabellenform (klassifiziert)",
      "shapeHelper": "Die Klassifikation wird bei jeder Introspektion neu berechnet; Überschreibungen liegen darüber und überstehen die Neugenerierung.",
      "system": "System",
      "unclassified": "Nicht klassifiziert"
    },
    "tabs": {
      "details": "Details",
      "relations": "Beziehungen"
    },
    "title": "Schema",
    "toast": {
      "regenerateFailed": "Neugenerierung fehlgeschlagen",
      "regenerated": "{created} erstellt · {updated} aktualisiert · {unchanged} unverändert",
      "regeneratedDetail": "Von Hand bearbeitete Seiten bleiben erhalten — nur Seiten mit unangetastetem generated_hash wurden an Ort und Stelle neu generiert.",
      "saved": "Schema-Überschreibungen gespeichert",
      "savedDetail": "Das angewendete Schema unten spiegelt Ihre Änderungen wider."
    },
    "tree": {
      "collapse": "Tabelle einklappen",
      "excluded": "Ausgeschlossen",
      "expand": "Tabelle ausklappen",
      "label": "Schema",
      "noMatches": "Keine Tabellen entsprechen Ihrer Suche.",
      "search": "Tabellen und Spalten durchsuchen",
      "searchPlaceholder": "Tabellen durchsuchen…",
      "unsaved": "Ungespeicherte Änderung"
    },
    "unavailableBody": "Dieser Build enthält den Editor zum Neuzuordnen noch nicht (09-T12). Führen Sie die Generierung erneut aus, sobald er da ist, um Bezeichnungen, Typen und Beziehungen neu zuzuordnen.",
    "unavailableTitle": "Editor zum Neuzuordnen des Schemas nicht verfügbar"
  },
  "review": {
    "unavailableBody": "Dieser Build enthält die Anreicherungs-Prüfungsansicht noch nicht (06-T14). Sie kommt mit dem Diff-und-Übernehmen-Ablauf.",
    "unavailableTitle": "Prüfungsansicht nicht verfügbar"
  },
  "settings": {
    "globalDefaultsNav": "Globale Standards",
    "title": "Einstellungen",
    "workspaceSection": "Workspace"
  },
  "settingsAi": {
    "byo": {
      "body": "Studio kann aus Ihrem Schema einen eigenständigen Prompt erzeugen. Führen Sie ihn in Claude Code, ChatGPT oder einem beliebigen Tool aus und fügen Sie das zurückgegebene JSON wieder in den Verbindungsassistenten ein. Gleiche Validierung, gleiche Prüfung, gleiches Ergebnis wie der direkte Weg.",
      "guarantee1": "Der Prompt enthält nur Ihr Schema und aggregierte Statistiken — standardmäßig nie Zeilendaten.",
      "guarantee2": "Keine Anmeldedaten, keine Instanz-URL, keine Kennungen sind eingebettet.",
      "guarantee3": "BYO-Läufe machen keinerlei Netzwerkaufrufe.",
      "guaranteeTitle": "Telemetriefreie Garantie",
      "heading": "Kein Schlüssel? Nutzen Sie Ihr eigenes KI-Tool",
      "headingRecommended": "Eigenes KI-Tool verwenden — kein Schlüssel nötig",
      "promptVersion": "Prompt {version}",
      "recommended": "Empfohlen",
      "schemaVersion": "Schema {version}",
      "subtitle": "Der Kopieren-Einfügen-Umlauf — nichts verlässt diesen Rechner."
    },
    "configure": {
      "heading": "{provider} konfigurieren"
    },
    "field": {
      "baseUrl": "Basis-URL",
      "baseUrlHelper": "Die Endpunkt-Wurzel, die /chat/completions bereitstellt.",
      "baseUrlOptional": "Unverändert lassen, außer Ollama läuft auf einem anderen Host.",
      "key": "API-Schlüssel",
      "keyMask": "sk-…{last4}",
      "keyOptional": "Optional — manche Endpunkte brauchen keinen Schlüssel.",
      "keyReplace": "Schlüssel ersetzen",
      "keyStored": "Verschlüsselt gespeichert. Ersetzen Sie ihn, um einen anderen Schlüssel zu verwenden.",
      "keyWriteOnly": "Nur schreibend: einmal gespeichert, wird er nie wieder angezeigt.",
      "model": "Modell",
      "modelFreeText": "Geben Sie die genaue Modell-ID ein, die Ihr Endpunkt bereitstellt.",
      "modelLive": "Live vom Anbieter geladen.",
      "modelLoading": "Wird geladen…",
      "modelPlaceholder": "Modell auswählen…",
      "modelStatic": "Eine bewährte Liste; geben Sie nach dem Speichern eine eigene ID ein, um sie zu aktualisieren.",
      "noKeyBody": "Ollama läuft lokal, es verlässt also nichts diesen Rechner.",
      "noKeyTitle": "Kein API-Schlüssel nötig"
    },
    "history": {
      "byo": "BYO",
      "colChunks": "Blöcke",
      "colDate": "Datum",
      "colSource": "Quelle",
      "colStatus": "Status",
      "connection": "Verbindung",
      "directPath": "Direkt",
      "empty": "Noch keine Anreicherungsläufe. Reichern Sie ein Schema im Verbindungsassistenten an, um hier Verlauf zu sehen.",
      "errorBody": "Laden Sie die Seite neu, um es erneut zu versuchen.",
      "errorTitle": "Läufe konnten nicht geladen werden",
      "heading": "Laufverlauf",
      "noConnections": "Verbinden Sie zuerst eine Datenbank — Anreicherungsläufe werden pro Verbindung erfasst.",
      "openReview": "Prüfung für den Lauf vom {date} öffnen",
      "subtitle": "Frühere Anreicherungsläufe. Öffnen Sie einen, um seine Vorschläge zu prüfen.",
      "tableLabel": "Anreicherungsläufe"
    },
    "provider": {
      "active": "Aktiv",
      "anthropic": {
        "desc": "Claude-Modelle über die Anthropic-API.",
        "label": "Anthropic"
      },
      "heading": "KI-Anbieter",
      "networkDisabledBody": "Dieses Adminium ist ohne ausgehenden Internetzugang konfiguriert und kann keine Anbieter-API erreichen. Nutzen Sie unten den Kopieren-und-Einfügen-Weg — er braucht weder Schlüssel noch Netzwerk.",
      "networkDisabledTitle": "Direkte KI-Anbieter sind in dieser Installation deaktiviert",
      "ollama": {
        "desc": "Modelle laufen lokal über Ollama — kein Schlüssel, keine Cloud.",
        "label": "Ollama (lokal)"
      },
      "openai": {
        "desc": "GPT-Modelle über die OpenAI-API.",
        "label": "OpenAI"
      },
      "openaiCompatible": {
        "desc": "Jeder Endpunkt, der das OpenAI-Format spricht — Groq, Together, vLLM, LM Studio.",
        "label": "OpenAI-kompatibel"
      },
      "requiresNetwork": "Erfordert Internet und einen API-Schlüssel",
      "subtitle": "Wählen Sie, wie Adminium ein Modell zur Anreicherung Ihres Schemas erreicht. Schlüssel werden verschlüsselt gespeichert und nie wieder angezeigt."
    },
    "runStatus": {
      "applied": "Übernommen",
      "awaitingResponse": "Wartet auf Antwort",
      "discarded": "Verworfen",
      "draft": "Entwurf",
      "failed": "Fehlgeschlagen",
      "partiallyApplied": "Teilweise übernommen",
      "running": "Läuft",
      "validated": "Validiert"
    },
    "save": "Anbieter speichern",
    "saveFailed": "Der KI-Anbieter konnte nicht gespeichert werden. Erneut versuchen.",
    "saved": "KI-Anbieter gespeichert",
    "subtitle": "Verbinden Sie ein Modell, damit Adminium Bezeichnungen, Gruppen, Beziehungen und mehr vorschlägt — immer als Diff geprüft, bevor etwas übernommen wird.",
    "test": "Verbindung testen",
    "testError": "Test fehlgeschlagen",
    "testErrorBody": "Der Anbieter war nicht erreichbar. Prüfen Sie Schlüssel und Basis-URL.",
    "testHintDirty": "Speichern Sie Ihre Änderungen vor dem Test.",
    "testOk": "Verbunden mit {model} in {latency} ms",
    "testUnknownModel": "dem Anbieter",
    "testing": "Anbieter wird angepingt…",
    "title": "KI-Anreicherung"
  },
  "settingsHub": {
    "addOnsCard": {
      "body": "Add-ons durchsuchen, installieren und verbinden — zusätzliche Blöcke, Datenpakete und Integrationen — oder selbst eines hochladen.",
      "cta": "Add-ons öffnen",
      "heading": "Add-ons"
    },
    "aiCard": {
      "body": "Konfigurieren Sie einen KI-Anbieter (oder den Kopieren-Einfügen-Umlauf), um Bezeichnungen, Gruppen und Beziehungen anzureichern.",
      "cta": "KI-Einstellungen öffnen",
      "heading": "KI-Anreicherung"
    },
    "danger": {
      "deleteCta": "Verbindung löschen",
      "deleteDesc": "Löscht die Verbindung und die daraus generierten Seiten. Ihre Datenbank bleibt unangetastet. Kann nicht rückgängig gemacht werden.",
      "empty": "Nichts zu löschen — noch keine Verbindungen.",
      "heading": "Gefahrenzone",
      "subtitle": "Unumkehrbare Aktionen."
    },
    "defaultsCard": {
      "body": "Workspace-weite Einstellungen für Theme, Akzentfarbe, Dichte und Sprache finden Sie unter „Globale Standards“.",
      "cta": "Globale Standards öffnen",
      "heading": "Standards für Darstellung & Sprache"
    },
    "email": {
      "attachmentCap": {
        "error": "Zwischen {min, number} und {max, number} MB.",
        "helper": "Die maximale Größe der Anhänge einer einzelnen Nachricht.",
        "label": "Anhangslimit (MB)"
      },
      "from": {
        "error": "Geben Sie eine E-Mail-Adresse ein.",
        "helper": "Nur die Adresse oder ein Anzeigename davor.",
        "label": "Absenderadresse"
      },
      "heading": "E-Mail (SMTP)",
      "host": {
        "error": "Nur ein Hostname oder eine IP-Adresse — ohne Schema, Port oder Zugangsdaten.",
        "label": "SMTP-Host"
      },
      "pass": {
        "error": "Zu diesem Benutzernamen gehört ein Passwort.",
        "helper": "Verschlüsselt gespeichert und nie wieder angezeigt. Leer lassen, um das aktuelle zu behalten.",
        "label": "Passwort"
      },
      "port": {
        "error": "Zwischen {min, number} und {max, number}.",
        "label": "Port"
      },
      "remove": "Mailserver entfernen",
      "review": {
        "password": "Ersetzt",
        "removed": "Entfernt"
      },
      "secure": {
        "helper": "An für Port 465. Aus beginnt unverschlüsselt und wechselt per STARTTLS — so erwartet es Port 587.",
        "label": "Implizites TLS"
      },
      "senders": {
        "add": "Absender hinzufügen",
        "address": "Adresse",
        "error": "Gib eine E-Mail-Adresse ein.",
        "heading": "Absender",
        "helper": "Adressen, von denen eine E-Mail gesendet werden darf. Die SMTP-Absenderadresse ist immer verfügbar.",
        "implicit": "SMTP-Absenderadresse",
        "name": "Anzeigename",
        "remove": "Absender entfernen",
        "review": "Absender"
      },
      "unconfigured": "Es ist kein Mailserver eingerichtet, daher kann Adminium keine Passwort-Zurücksetzungen, Einladungen oder geplanten Berichte versenden.",
      "user": {
        "helper": "Leer lassen, wenn das Relay keine Anmeldung verlangt.",
        "label": "Benutzername"
      }
    },
    "identity": {
      "appName": {
        "error": "Geben Sie einen Namen mit höchstens 60 Zeichen ein.",
        "helper": "Erscheint in der Seitenleiste, im Browser-Titel und in E-Mails.",
        "label": "Anwendungsname"
      },
      "heading": "Workspace-Identität",
      "logo": {
        "badType": "Wählen Sie ein PNG-, JPEG-, WebP-, GIF- oder SVG-Bild.",
        "drop": "Bild hierher ziehen",
        "helper": "PNG, JPEG, WebP, GIF oder SVG bis 1 MB. Ersetzt die eingebaute Marke überall.",
        "label": "Logo",
        "remove": "Entfernen",
        "removed": "Logo entfernt",
        "replace": "Logo ersetzen",
        "tooLarge": "Dieses Bild ist größer als 1 MB.",
        "undo": "Rückgängig",
        "upload": "Logo hochladen",
        "uploaded": "Logo aktualisiert"
      },
      "showVersion": {
        "helper": "Die Build-Nummer neben dem Logo. Aus verbirgt, welche Version Sie einsetzen.",
        "label": "Version in der Seitenleiste"
      }
    },
    "pagesCard": {
      "body": "Seiten hinzufügen, bearbeiten und löschen, ihre Inhalte ändern und die Seitenleiste neu ordnen.",
      "cta": "Seiten verwalten",
      "heading": "Seiten"
    },
    "publicApiCard": {
      "body": "Lassen Sie Ihre eigenen kunden- oder mitarbeiterseitigen Seiten diese Datenbank über einen von Ihnen definierten Scope lesen.",
      "cta": "Öffentliche API öffnen",
      "heading": "Öffentliche API"
    },
    "review": {
      "cancel": "Abbrechen",
      "change": "{before} → {after}",
      "close": "Schließen",
      "confirm": "Änderungen speichern",
      "hidden": "Verborgen",
      "off": "Aus",
      "on": "An",
      "shown": "Sichtbar",
      "subtitle": "Prüfen Sie Ihre Änderungen vor dem Speichern.",
      "title": "Workspace-Einstellungen speichern"
    },
    "save": "Änderungen speichern",
    "saveFailed": "Die Workspace-Einstellungen konnten nicht gespeichert werden. Versuchen Sie es erneut.",
    "saved": "Workspace-Einstellungen aktualisiert",
    "security": {
      "allowSignup": {
        "desc": "Jeder kann ein Konto erstellen — deaktiviert bleibt der Workspace nur per Einladung zugänglich.",
        "label": "Selbstregistrierung erlauben"
      },
      "heading": "Sicherheit",
      "passwordMin": {
        "error": "Zwischen {min, number} und {max, number} Zeichen.",
        "label": "Minimale Passwortlänge"
      },
      "require2fa": {
        "desc": "Jedes Mitglied muss 2FA aktivieren, um sich anzumelden.",
        "label": "Zwei-Faktor-Authentifizierung verlangen",
        "note": "Hinweis, keine Sperre: Mitglieder ohne 2FA werden zur Einrichtung geleitet und können sie danach nicht mehr abschalten, ihre Anmeldung wird aber nie blockiert, und API-Schlüssel sind nicht betroffen."
      },
      "sessionTtl": {
        "error": "Zwischen {min, number} und {max, number} Stunden.",
        "label": "Sitzungsdauer (Stunden)"
      }
    },
    "storageCard": {
      "body": "Wählen Sie, wo hochgeladene Dateien, Exporte und andere gespeicherte Bytes liegen — dieser Server, ein Bucket oder Ihr eigener Server.",
      "cta": "Speicher öffnen",
      "heading": "Speicher"
    },
    "subtitle": "Identität, Sicherheit und destruktive Aktionen für diesen Workspace.",
    "superAdminOnly": "Nur ein Super-Admin kann Identität und Sicherheitseinstellungen des Workspace ändern.",
    "superAdminOnlyTitle": "Super-Admin erforderlich",
    "title": "Workspace-Einstellungen",
    "translationsCard": {
      "body": "Formulieren Sie beliebige Texte in Adminium neu, legen Sie fest, welche Sprachen zur Auswahl stehen, und fügen Sie eigene hinzu.",
      "cta": "Übersetzungen öffnen",
      "heading": "Sprachen & Übersetzungen"
    }
  },
  "source": {
    "dsn": {
      "helper": "postgres://benutzer:passwort@host:5432/datenbank — mysql:// und sqlite: funktionieren ebenfalls.",
      "incomplete": "Host und Datenbank ergänzen, z. B. postgres://user@host:5432/db",
      "invalidScheme": "Unbekanntes Schema — erwartet werden postgres://, mysql://, mariadb:// oder sqlite:",
      "label": "Verbindungszeichenfolge",
      "quickFill": "Schnellausfüllen:"
    },
    "engine": {
      "label": "Datenbank-Engine",
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "fields": {
      "database": "Datenbank",
      "host": "Host",
      "password": "Passwort",
      "port": "Port",
      "preview": "Vorschau der Verbindungszeichenfolge:",
      "ssl": "SSL-Modus",
      "user": "Benutzer"
    },
    "file": {
      "columns": "Spalten",
      "detectedAs": "Erkannt: {format}",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django-Modelle, Adminium JSON",
      "dropTitle": "Schemadatei hier ablegen oder durchsuchen",
      "errorTitle": "Datei konnte nicht geparst werden",
      "moreWarnings": "+{count} weitere Warnungen — die vollständige Liste erscheint im Analyse-Schritt.",
      "parseFailed": "Diese Datei konnte nicht geparst werden. Falls die automatische Erkennung falsch lag, wählen Sie das Format explizit und versuchen Sie es erneut.",
      "parsing": "Hochgeladene Schemadatei wird gelesen…",
      "pitch": "Keine Datenbankverbindung nötig — wir parsen Ihre Schemadatei und bauen dieselben Dashboards.",
      "requestFailed": "Upload fehlgeschlagen — prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
      "tables": "Tabellen",
      "unsupported": "Dieses Format wird nicht erkannt — unterstützt werden SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django-Modelle und Adminium JSON. Wählen Sie eines explizit und versuchen Sie es erneut.",
      "warnings": "Warnungen"
    },
    "format": {
      "auto": "Automatisch erkennen",
      "django": "Django models.py",
      "drizzle": "Drizzle ORM",
      "helper": "Bei automatischer Erkennung belassen, sofern sie nicht danebenliegt.",
      "json": "Adminium-JSON",
      "label": "Schemaformat",
      "prisma": "Prisma-Schema",
      "rails": "Rails schema.rb",
      "sequelize": "Sequelize-Modelle",
      "sql": "SQL-DDL / pg_dump",
      "typeorm": "TypeORM-Entitäten"
    },
    "mode": {
      "dsn": "Verbindungszeichenfolge",
      "fields": "Einzelne Felder",
      "file": "Schemadatei"
    },
    "modeLabel": "Eingabemodus der Quelle",
    "name": "Verbindungsname",
    "namePlaceholder": "Produktions-Postgres",
    "readOnlyRole": {
      "body": "Bei der Einrichtung liest Adminium ausschließlich Schema-Metadaten — niemals Ihre Zeilen. Wir empfehlen einen eigenen Benutzer mit reinen SELECT-Rechten; wo Adminium seine eigenen Tabellen ablegt, entscheiden Sie im Schritt zur Meta-Speicherung.",
      "title": "Verwenden Sie eine schreibgeschützte Rolle"
    },
    "sqlite": {
      "file": "Pfad zur Datenbankdatei",
      "helper": "SQLite ist eine Datei, kein Server — geben Sie den absoluten Pfad auf der Maschine an, auf der Adminium läuft."
    },
    "subtitle": "Richten Sie Adminium auf eine Datenbank — wir generieren aus ihrem Schema ein Admin-Dashboard.",
    "title": "Verbinden Sie Ihre Datenbank"
  },
  "storage": {
    "actionFailed": "Das hat nicht funktioniert",
    "add": "Speicherziel hinzufügen",
    "availableOnDisk": "{size} auf dieser Festplatte verfügbar",
    "default": "Standard",
    "defaultBlockedByDisabled": "Ein deaktiviertes Speicherziel kann nicht das Standardziel sein. Aktivieren Sie es zuerst.",
    "delete": {
      "blockedBody": "{name} enthält noch {count, plural, one {# Datei} other {# Dateien}}. Verschieben Sie sie zuerst in ein anderes Speicherziel und löschen Sie es dann.",
      "blockedTitle": "Dieses Speicherziel enthält noch Dateien",
      "body": "Adminium vergisst {name} und seine Zugangsdaten. Nichts, was darin gespeichert ist, wird angetastet — der Bucket oder der Server gehört Ihnen, und Dateien, die noch darauf verzeichnet sind, weisen das Löschen zurück.",
      "confirm": "Speicherziel löschen",
      "title": "Dieses Speicherziel löschen"
    },
    "deleteButton": "Löschen",
    "disable": "Deaktivieren",
    "disabled": "Deaktiviert",
    "driver": {
      "local": "Ein Pfad auf dieser Maschine",
      "s3": "S3-kompatibler Bucket",
      "webdav": "WebDAV-Server"
    },
    "edit": "Bearbeiten",
    "editor": {
      "createTitle": "Speicherziel hinzufügen",
      "editTitle": "Speicherziel bearbeiten",
      "subtitle": "Adminium liest und schreibt in Ihrem Auftrag über dieses Speicherziel; es ist Infrastruktur, die Sie kontrollieren."
    },
    "enable": "Aktivieren",
    "field": {
      "accessKeyId": "Zugriffsschlüssel-ID",
      "bucket": "Bucket",
      "driver": "Art",
      "driverLocked": "Die Art eines Speicherziels zu ändern, das bereits Dateien enthält, würde diese Dateien unerreichbar machen.",
      "endpoint": "Endpunkt",
      "endpointDerived": "Für AWS selbst leer lassen — der Endpunkt ergibt sich aus der Region.",
      "name": "Name",
      "namePlaceholder": "Uploads-Bucket",
      "password": "Passwort",
      "pathStyle": "Pfadbasierte Adressierung",
      "pathStyleToggle": "Den Bucket als Pfad statt als Hostnamen adressieren",
      "prefix": "Präfix",
      "prefixHelper": "Ein Ordner innerhalb des Speicherziels. Zwei Speicherziele auf demselben Bucket, die sich nur hier unterscheiden, teilen sich den Bucket, ohne sich einen Namensraum zu teilen.",
      "preset": "Anbieter",
      "presetHelper": "Füllt Endpunkt, Region und Adressierungsstil aus. Alles, was der Anbieter über Ihr Konto nicht wissen kann, bleibt leer und wird von Ihnen eingetragen.",
      "publicBaseUrl": "Öffentliche Basis-URL",
      "publicBaseUrlHelper": "Optional. Wo diese Objekte ohne Adminium lesbar sind — ein CDN vor einem öffentlichen Bucket. Wird nur verwendet, wenn eine Spalte einen Link speichert.",
      "region": "Region",
      "root": "Verzeichnis",
      "rootHelper": "Ein absoluter Pfad, in den dieser Server schreiben kann — ein eingehängtes Volume oder eine Netzwerkfreigabe. Nicht das Standardverzeichnis, das bereits der erste Eintrag der Liste ist.",
      "secretAccessKey": "Geheimer Zugriffsschlüssel",
      "secretKept": "Ein Schlüssel ist gespeichert. Lassen Sie beide Felder leer, um ihn zu behalten; füllen Sie beide aus, um ihn zu ersetzen.",
      "url": "Sammlungs-URL",
      "urlHelper": "Die Sammlung, in die Adminium schreibt — so, wie Ihr Server sie bereitstellt.",
      "username": "Benutzername"
    },
    "fileCount": "{count, plural, one {# Datei} other {# Dateien}}",
    "kind": {
      "archive": "Archivierte Audit-Log-Stapel",
      "branding": "Das Logo des Workspace",
      "export": "Dateien aus Datenexporten",
      "import": "Hochgeladene CSV-Dateien und ihre Fehlerberichte",
      "schema": "Importierte Schemadateien",
      "upload": "An Datensätze angehängte Dateien"
    },
    "list": {
      "subtitle": "Neue Dateien gehen an das Standard-Speicherziel. Vorhandene Dateien bleiben, wo sie sind, bis Sie sie verschieben.",
      "title": "Speicherziele"
    },
    "loadFailed": {
      "forbidden": "Um zu ändern, wo Dateien gespeichert werden, wird die Berechtigung „Speicher verwalten“ benötigt. Bitten Sie eine Administratorin oder einen Administrator, sie einer Ihrer Rollen zuzuweisen.",
      "title": "Speicherziele konnten nicht geladen werden"
    },
    "localDisk": "Die Festplatte dieses Servers",
    "move": {
      "from": "Von",
      "kinds": "Beschränken auf",
      "kindsHelp": "Lassen Sie alle Häkchen weg, um alle zu verschieben. Uploads sind die Dateien, die Nutzerinnen und Nutzer anhängen; der Rest sind Artefakte, die Adminium selbst erzeugt hat.",
      "open": "Dateien verschieben…",
      "start": "Verschieben starten",
      "startedBody": "Es läuft im Hintergrund als Job {jobId} und läuft weiter, wenn Sie diese Seite verlassen. Die Zahlen unten ändern sich, während Dateien ankommen — laden Sie die Seite neu, um sie zu sehen.",
      "startedTitle": "Das Verschieben hat begonnen",
      "subtitle": "Kopiert jede Datei von einem Speicherziel in ein anderes und vergisst danach die alte Kopie. Downloads funktionieren durchgehend weiter.",
      "title": "Dateien verschieben",
      "to": "Nach"
    },
    "preset": {
      "aws": "AWS S3",
      "b2": "Backblaze B2",
      "minio": "MinIO oder ein anderer S3-kompatibler Server",
      "r2": "Cloudflare R2",
      "spaces": "DigitalOcean Spaces",
      "tigris": "Tigris",
      "wasabi": "Wasabi"
    },
    "save": "Speicherziel speichern",
    "secret": {
      "partialBody": "Füllen Sie beide Felder aus, um die gespeicherten Zugangsdaten zu ersetzen, oder leeren Sie beide, um sie zu behalten. Nur eines davon zu speichern würde stillschweigend die alten behalten.",
      "partialTitle": "Halbe Zugangsdaten sind keine Zugangsdaten"
    },
    "setDefault": "Als Standard festlegen",
    "status": {
      "error": "Nicht erreichbar",
      "ok": "Erreichbar",
      "untested": "Nicht getestet"
    },
    "subtitle": "Wo diese Instanz hochgeladene Dateien, Exporte und andere gespeicherte Bytes ablegt.",
    "test": {
      "button": "Testen",
      "failed": "Dieses Speicherziel war nicht erreichbar",
      "ok": "In {ms} ms erreicht",
      "unreachable": "Der Test konnte nicht ausgeführt werden"
    },
    "title": "Speicher",
    "usedBytes": "{size} belegt"
  },
  "tables": {
    "emptyFilter": "Keine Tabellen entsprechen Ihrem Filter.",
    "highVolume": "hohes Volumen",
    "highVolumeNote": "Tabellen mit über 100.000 Zeilen sind anfangs abgewählt — Ops-Tabellen gehören selten in ein Dashboard.",
    "importNoCounts": "Schemadateien enthalten keine Zeilenzahlen — die Spalte zeigt —, bis eine Live-Datenbank verbunden ist.",
    "joinHidden": "{count} Join-/Systemtabellen sind vorab ausgeblendet — sie treiben weiterhin m:n-Beziehungen an.",
    "listLabel": "Einbeziehbare Tabellen",
    "pii": "PII",
    "search": "Tabellen filtern…",
    "subtitle": "Wählen Sie, welche enthalten sein sollen. Sie können das jederzeit ändern.",
    "title": "Wählen Sie Ihre Tabellen"
  },
  "test": {
    "errorTitle": "Verbindung fehlgeschlagen",
    "hint": {
      "auth": "Authentifizierung fehlgeschlagen — prüfen Sie Benutzername und Passwort in Ihrer DSN.",
      "hostUnreachable": "Host nicht erreichbar — prüfen Sie Hostname und Port und dass die Datenbank Verbindungen von dieser Maschine akzeptiert (unsere IPs freigeben).",
      "metaPlacement": "Diese Quelle kann Adminiums Meta-Tabellen nicht aufnehmen — fahren Sie mit einer separaten Meta-Datenbank fort.",
      "permission": "Die Rolle hat sich verbunden, darf das Schema aber nicht lesen — erteilen Sie Ihrer Introspektionsrolle USAGE auf dem Schema.",
      "timeout": "Die Datenbank hat nicht rechtzeitig geantwortet — prüfen Sie Netzwerkpfad und Auslastung und versuchen Sie es erneut.",
      "tls": "TLS-Aushandlung fehlgeschlagen — versuchen Sie sslmode=require oder laden Sie das CA-Zertifikat hoch, das Ihr Server erwartet.",
      "unknown": "Verbindung fehlgeschlagen — prüfen Sie die DSN und versuchen Sie es erneut."
    },
    "log": {
      "connectFailed": "Verbindung fehlgeschlagen.",
      "connected": "Verbunden ({latency} ms) · schreibgeschützte Introspektion",
      "connecting": "Sichere Verbindung wird aufgebaut…",
      "detected": "{tables} Tabellen · {columns} Spalten erkannt",
      "found": "{tables} Tabellen · {columns} Spalten gefunden",
      "jobFailed": "Introspektion fehlgeschlagen.",
      "mapping": "Spaltentypen → Eingabe-Widgets werden zugeordnet",
      "moreWarnings": "+{count} weitere Parser-Warnungen",
      "networkFailed": "Anfrage fehlgeschlagen — prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
      "parsingFile": "{file} wird geparst…",
      "piiDone": "PII-Scan abgeschlossen — {count} Spalten standardmäßig maskiert",
      "piiDoneUnknown": "PII-Scan abgeschlossen",
      "piiScan": "Suche nach PII-Spalten…",
      "readingFile": "Hochgeladene Schemadatei wird gelesen…",
      "readingSchema": "Schema wird gelesen: public",
      "ready": "Bereit",
      "relations": "Beziehungen werden erkannt…"
    },
    "logLabel": "Introspektionsprotokoll",
    "retry": "Erneut versuchen",
    "subtitle": "Tabellen, Spalten und Beziehungen werden introspiziert. Das dauert ein paar Sekunden.",
    "title": "Ihr Schema wird analysiert",
    "trust": "Wir lesen nur Ihr Schema und Ihre Daten. Nichts wird verändert."
  },
  "title": "Studio",
  "wizard": {
    "back": "Zurück",
    "bridgeAppliedBody": "Von adminium.dev durch Ihren Browser übergeben — sie ging direkt an diesen Rechner und wurde nie hochgeladen. Prüfen Sie sie unten und fahren Sie fort.",
    "bridgeAppliedTitle": "Verbindungszeichenfolge empfangen",
    "bridgeFailedBody": "Sie wurde bereits verwendet oder ist abgelaufen. Fügen Sie Ihre Verbindungszeichenfolge stattdessen unten ein.",
    "bridgeFailedTitle": "Diese Übergabe konnte nicht verwendet werden",
    "continue": "Weiter",
    "persistFailed": "Ihre Tabellenauswahl konnte nicht gespeichert werden — versuchen Sie es erneut.",
    "persistFailedTitle": "Speichern fehlgeschlagen",
    "progress": "Einrichtungsfortschritt",
    "step": {
      "enrich": "Anreichern",
      "generate": "Generieren",
      "intent": "Zweck",
      "meta": "Meta-Speicher",
      "source": "Quelle",
      "tables": "Tabellen",
      "test": "Analysieren"
    },
    "title": "Neue Verbindung"
  }
} as const;
