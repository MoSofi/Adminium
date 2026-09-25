// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
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
      "missing": "Fehlt",
      "missingBody": "Seine Dateien liegen nicht auf diesem Server, daher wird nichts davon geladen.",
      "needsNewer": "Benötigt Adminium {version} oder neuer",
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
      "missing": "Fehlt",
      "missingBody": "Seine Dateien liegen nicht auf diesem Server, daher wird nichts davon geladen. Installieren Sie es erneut oder entfernen Sie es.",
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
      "shaHint": "Der mit dem Release veröffentlichte sha512-Wert, neben dem Download-Link auf adminium.dev/marketplace. Passen die Bytes nicht, wird der Upload abgelehnt.",
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
    "brokenEnumValues": "Jeder erlaubte Wert bei {columns} muss ausgefüllt und von den anderen verschieden sein.",
    "ceiling": {
      "authorise": "Dieses Neuschreiben autorisieren",
      "body": "{table} enthält über {rows} Zeilen — mehr, als Adminium von sich aus neu schreibt. Nur eine Super-Admin-Rolle kann das autorisieren, und die Tabelle bleibt für die Dauer des Neuschreibens gesperrt.",
      "hint": "Geben Sie den Tabellennamen genau so ein, wie er oben steht.",
      "notYours": "{table} enthält über {rows} Zeilen. Nur eine Super-Admin-Rolle kann ein Neuschreiben dieser Größe autorisieren — fragen Sie eine, oder führen Sie die Änderung in einem Wartungsfenster mit eigenen Werkzeugen durch.",
      "prompt": "Geben Sie {table} erneut ein, um das Neuschreiben zu autorisieren"
    },
    "column": {
      "default": "Startwert",
      "defaultValue": "Wert",
      "help": "Was bedeuten diese Einstellungen?",
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
    "default": {
      "autoincrement": "Vom letzten Datensatz aufwärts zählen",
      "false": "Nein",
      "literal": "Ein Wert",
      "none": "Nichts",
      "now": "Das aktuelle Datum und die Uhrzeit",
      "true": "Ja",
      "uuid": "Eine neue eindeutige ID"
    },
    "designer": "Tabellen-Designer",
    "discard": "Änderungen verwerfen",
    "discardTable": "Diese neue Tabelle verwerfen",
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
      "default": {
        "example": "Ein Feld „Erstellt am“, das mit dem aktuellen Datum und der Uhrzeit beginnt, muss nie getippt werden und kann nicht falsch sein.",
        "term": "Startwert",
        "what": "Was im Feld steht, wenn es niemand ausfüllt. Die Datenbank trägt den Wert selbst ein — auch bei Datensätzen, die außerhalb von Adminium entstehen."
      },
      "keyGeneration": {
        "example": "Nur PostgreSQL kann eine eindeutige ID erzeugen und direkt zurückgeben; auf den anderen Engines zählt der Schlüssel hoch.",
        "term": "Wie der Schlüssel gefüllt wird",
        "what": "Woher die ID jedes Datensatzes kommt. Aufwärtszählen ergibt 1, 2, 3 und passt für die meisten Tabellen; eine eindeutige ID ist lang und zufällig — schwerer zu erraten und schwerer vorzulesen."
      },
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
      },
      "values": {
        "example": "Ein Status: neu, in Arbeit oder erledigt. Niemand kann „in-arbet“ tippen und versehentlich einen vierten Status anlegen.",
        "term": "Erlaubte Werte",
        "what": "Die vollständige Liste der Antworten, die dieses Feld annimmt. Alles andere weist die Datenbank zurück, und Adminium zeigt die Liste als Schaltflächen oder Menü statt als Textfeld."
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
      "keyCounted": "Vom letzten Datensatz aufwärts zählen",
      "keyGeneration": "Wie der Schlüssel gefüllt wird",
      "keyGenerationHelp": "Adminium liest den neuen Datensatz nach jedem Einfügen über diesen Schlüssel zurück.",
      "keyGenerationOne": "Auf {dialect} muss ein Schlüssel eine hochgezählte Ganzzahl sein: eine von der Datenbank erzeugte ID lässt sich nach dem Einfügen nicht zurücklesen.",
      "keyUnique": "Eine neue eindeutige ID",
      "name": "Tabellenname",
      "nameHelp": "Kleinbuchstaben, Ziffern und Unterstriche.",
      "namePlaceholder": "reservations",
      "noKey": "Diese Tabelle hat keinen Primärschlüssel, daher behandelt Adminium sie als schreibgeschützt — Zeilen lassen sich auflisten, aber nicht bearbeiten.",
      "renameHelp": "Eine Änderung benennt die Tabelle in Ihrer Datenbank um."
    },
    "unnamed": "Benennen Sie jede Tabelle und Spalte, um die Änderungen zu prüfen.",
    "unrepresentableDefaults": "Diese Spalten behalten einen von der Datenbank erzeugten Standardwert, den Adminium hier nicht bearbeiten kann; er bleibt unverändert: {columns}",
    "valuelessEnum": "Geben Sie {columns} mindestens einen erlaubten Wert, um die Änderungen zu prüfen.",
    "values": {
      "add": "Wert hinzufügen",
      "addOnly": "Diese Liste ist ein Typ in Ihrer Datenbank, und Postgres kann einen vorhandenen Wert weder entfernen noch umbenennen. Hinzufügen können Sie weitere.",
      "down": "{value} nach unten verschieben",
      "empty": "Eine Auswahlspalte braucht mindestens einen Wert, bevor die Änderung geprüft werden kann.",
      "label": "Erlaubte Werte",
      "placeholder": "in_progress",
      "remove": "{value} entfernen",
      "up": "{value} nach oben verschieben",
      "value": "Wert {n}"
    }
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
    "unbound": "Noch auszufüllen: {slots}",
    "deleteConfirm": {
      "title": "Diese Zuordnung löschen?",
      "body": "Die Regel, die sie auslöst, wird ebenfalls gelöscht, und bereits daraus erstellte Dokumente verlieren ihre Verknüpfung. Dies kann nicht rückgängig gemacht werden.",
      "prompt": "Geben Sie {name} zur Bestätigung ein",
      "confirm": "Zuordnung löschen"
    },
    "deleteFailed": "Die Zuordnung wurde nicht gelöscht",
    "loadFailed": "Die Zuordnungen konnten nicht geladen werden"
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
    "noTablesBody": "Diese Datenbank hat noch keine Tabellen, daher gibt es nichts, was die KI beschriften oder gruppieren könnte. Fahren Sie fort — sobald Tabellen vorhanden sind, können Sie die KI-Anreicherung jederzeit unter Einstellungen → KI ausführen.",
    "noTablesTitle": "Keine Tabellen zum Anreichern",
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
    "title": "Generieren Sie Ihre App",
    "blankBody": "Es wurde nichts generiert, genau wie gewünscht. Bauen Sie Ihre erste Seite aus dieser Verbindung, wann immer Sie bereit sind.",
    "blankTitle": "Ihre Verbindung ist bereit",
    "createPage": "Seite erstellen"
  },
  "hostedApps": {
    "browse": {
      "title": "Apps, die Sie installieren können",
      "subtitle": "Fertige Apps, die mit diesem Build geliefert wurden. Eine Installation legt die benötigten Tabellen an und liefert die Oberflächen aus — bis Sie den Plan bestätigen, passiert nichts.",
      "search": "Apps suchen…",
      "clear": "Suche leeren",
      "all": "Alle",
      "by": "von {publisher}",
      "install": "Installieren",
      "installed": "Installiert",
      "missing": "Fehlt",
      "noMatch": "Keine App passt zu dieser Suche",
      "noMatchBody": "Versuchen Sie einen anderen Begriff oder eine andere Kategorie.",
      "emptyTitle": "Keine Apps zum Installieren verfügbar",
      "emptyBody": "Apps, die mit diesem Build geliefert werden, erscheinen hier. Lassen Sie ADMINIUM_BUNDLED_APPS auf ein Verzeichnis mit App-Paketen zeigen, oder laden Sie selbst eines hoch.",
      "unreadable": "Das Manifest dieses Pakets konnte nicht gelesen werden. Es lässt sich nicht installieren — verwerfen Sie es unten.",
      "subtitleOnline": "Apps, die mit diesem Build geliefert wurden, dazu die aus dem Online-Katalog. Eine Installation lädt die App bei Bedarf herunter und legt die benötigten Tabellen an — bis Sie den Plan bestätigen, passiert nichts.",
      "neverChecked": "Der Online-Katalog ist aktiv, wurde aber noch nicht geprüft. Suchen Sie nach Neuerem, um seine Apps aufzulisten.",
      "refresh": "Nach Neuerem suchen",
      "toggle": "Online-App-Katalog durchsuchen",
      "emptyOnlineBody": "Der Online-Katalog ist aktiv, aber noch ist nichts aufgelistet. Suchen Sie nach Neuerem, um ihn abzurufen.",
      "fromCatalog": "Online",
      "needsNewer": "Benötigt Adminium {version} oder neuer"
    },
    "domains": {
      "add": "Domain anhängen",
      "docsLink": "So richten Sie eine Domain ein",
      "hostLabel": "Host",
      "instanceLabel": "Instanz",
      "instanceOwn": "Die App selbst",
      "issuesTitle": "Die Domain-Zuordnung wurde abgelehnt",
      "none": "Keine Domains angehängt.",
      "remove": "Entfernen",
      "save": "Domains speichern",
      "savedBody": "Zuordnungen greifen innerhalb weniger Sekunden. Ein Host antwortet erst, wenn sein DNS und Ihr Proxy diese Instanz tatsächlich erreichen.",
      "savedTitle": "Gespeichert",
      "stepDns": "Richten Sie den Host in Ihrem DNS auf diesen Server — mit demselben Eintragstyp und Ziel wie die Adresse, über die Sie dieses Dashboard aufrufen.",
      "stepProxy": "Geben Sie dem Host einen eigenen Site-Block auf Ihrem Reverse-Proxy, der den Host-Header unverändert durchreicht — und laden Sie den Proxy anschließend neu. Das Bearbeiten der Konfigurationsdatei ändert nichts an einem bereits laufenden Prozess.",
      "stepSignIn": "Bei Mitarbeiter-Oberflächen müssen Sie sich erneut anmelden: Sitzungs-Cookies gehören zu genau einem Host, deshalb führt ein zugeordneter Host Sie zuerst auf seine eigene Anmeldeseite.",
      "subtitle": "Richten Sie das DNS einer Domain auf Ihren Proxy, reichen Sie den Host-Header an Adminium durch und hängen Sie sie hier an — dieser Host liefert dann die Oberfläche statt dieses Dashboards. Zertifikate bleiben auf Ihrem Proxy.",
      "surfaceLabel": "Oberfläche",
      "title": "Domains"
    },
    "emptyBody": "Setzen Sie ADMINIUM_SURFACES_DIR auf ein Verzeichnis gebauter Oberflächen — ein Ordner je App und Seite, jeweils mit index.html — und starten Sie neu. Sie werden dann unter /apps/ ausgeliefert und erscheinen hier.",
    "emptyTitle": "Es werden keine App-Oberflächen ausgeliefert",
    "error": "Etwas ist schiefgelaufen",
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
        "hint": "Die Release-Datei der App (.tgz) — sie enthält manifest.json und ein Verzeichnis staff/ oder customer/.",
        "file": "Paketdatei (.tgz)",
        "fileHint": "Es wird nichts angelegt, bevor Sie den Schemaplan bestätigen.",
        "integrity": "Prüfsumme (optional)",
        "integrityHint": "Fügen Sie die mit dem Release veröffentlichte sha512-Prüfsumme ein, damit der Server genau diese Bytes prüft. Bleibt das Feld leer, wird sie hier berechnet."
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
        "summary": "{created} angelegt · {reused} wiederverwendet",
        "pageWarnings": "Einige Seiten dieser App kommen ohne Tabelle an"
      },
      "done": {
        "body": "{key} wird jetzt ausgeliefert. Wählen Sie unten, wo die Mitarbeiterseite erscheint.",
        "titleApp": "{app} ist installiert",
        "tablesCreated": "In {connection} angelegte Tabellen",
        "tablesKept": "Unverändert verwendete Tabellen",
        "pages": "Erzeugte Seiten",
        "sampleNotAdded": "nicht hinzugefügt",
        "sampleAdding": "wird hinzugefügt…",
        "sampleAdded": "hinzugefügt",
        "sampleLater": "Sie können sie später auf der Seite der App hinzufügen."
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
      "downloaded": {
        "hint": "Aus dem Online-App-Katalog heruntergeladen und gegen seinen veröffentlichten Fingerabdruck geprüft. Es wird nichts angelegt, bevor Sie den Schemaplan bestätigen."
      },
      "uploaded": {
        "hint": "Aus der manifest.json im hochgeladenen Paket gelesen. Es wird nichts angelegt, bevor Sie den Schemaplan bestätigen.",
        "replace": "Anderes Paket hochladen"
      },
      "check": {
        "title": "Tabellen prüfen",
        "hint": "{app} legt diese in {connection} an. Nichts ändert sich, bevor Sie auf Installieren klicken.",
        "summaryNew": "{count} neu",
        "summaryEarlier": "{count} aus Ihrer früheren Installation",
        "summaryShared": "{count} mit einer anderen App geteilt",
        "summaryTaken": "{count, plural, one {# Name vergeben} other {# Namen vergeben}}",
        "altPrefixInUse": "Geprüft mit dem Präfix {prefix}.",
        "usualPrefix": "Das übliche Präfix verwenden",
        "badgeNew": "Neu",
        "badgeEarlier": "Ihre aus einer früheren Installation",
        "badgeShared": "Geteilt mit {app}",
        "badgeTaken": "Name vergeben",
        "columns": "{count, plural, one {# Spalte} other {# Spalten}}",
        "keep": "Verwenden und die Daten behalten",
        "sharedNote": "{app} nutzt diese Tabelle ebenfalls. Beide Apps lesen und schreiben weiterhin dieselben Zeilen.",
        "earlierNote": "Adminium hat diese Tabelle bei einer früheren Installation von {app} angelegt.",
        "createPreview": "Vorschau des Anlegens",
        "addsColumns": "{count, plural, one {Fügt # Spalte hinzu:} other {Fügt # Spalten hinzu:}}",
        "widens": "Macht {column} breiter, von {from} auf {to}.",
        "setIdentity": "{column} nummeriert neue Zeilen selbst.",
        "enumValues": "{column} akzeptiert zusätzlich {values}.",
        "noLoss": "Keine Spalte wird entfernt und keine Daten gehen verloren.",
        "reuseNote": "Die App liest und schreibt die vorhandenen Zeilen.",
        "renameTitle": "Die vorhandene Tabelle umbenennen, um Platz zu machen",
        "renameNote": "Für die App wird eine neue {table} angelegt.",
        "renameField": "Neuer Name für die vorhandene Tabelle",
        "renameFieldNote": "Adminium repariert seine eigenen Seiten und Regeln, die auf den alten Namen verwiesen.",
        "prefixTitle": "Ein anderes Präfix für diese App verwenden",
        "prefixNote": "Gilt für alle Tabellen der App auf einmal.",
        "prefixField": "Präfix",
        "prefixFieldNote": "{count, plural, one {Die Tabelle wird erneut geprüft.} other {Alle # Tabellen werden erneut geprüft.}}",
        "takenIntro": "{table} existiert bereits und wurde von Hand angelegt. Wählen Sie, was damit geschehen soll.",
        "takenIntroShort": "Was mit {table} geschehen soll",
        "pickFirst": "Wählen Sie vor der Installation, was mit {table} geschehen soll.",
        "checkFirst": "Prüfen Sie die Tabellen vor der Installation erneut.",
        "nothingYet": "Nichts ändert sich, bevor Sie auf Installieren klicken.",
        "again": "Erneut prüfen",
        "adoptedNote": "Eine frühere Installation von {app} hat diese Tabelle so verwendet, wie sie sie vorfand."
      },
      "running": {
        "title": "{app} wird installiert",
        "hint": "Schreibt in {connection}.",
        "tables": "Tabellen",
        "pages": "Seiten"
      },
      "stopped": {
        "failed": "fehlgeschlagen",
        "notStarted": "nicht gestartet",
        "atTables": "Das Anlegen der Tabellen ist fehlgeschlagen, daher lief danach nichts mehr.",
        "atIntrospect": "Die Tabellen wurden angelegt. Das erneute Einlesen ist fehlgeschlagen, daher lief danach nichts mehr.",
        "atPages": "Die Tabellen wurden angelegt. Das Anlegen der Seiten ist fehlgeschlagen, daher lief danach nichts mehr.",
        "atFinish": "Die Tabellen und Seiten wurden angelegt. Der Abschluss der Installation ist fehlgeschlagen.",
        "title": "Die Installation wurde mittendrin angehalten",
        "created": "{count} angelegt",
        "made": "angelegt",
        "said": "Was die Datenbank meldete",
        "saidAbout": "Was die Datenbank zu {table} meldete",
        "resume": "Nichts wurde entfernt. Ein erneuter Versuch macht dort weiter, wo es angehalten hat.",
        "retry": "Erneut versuchen",
        "back": "Zurück zum Schemaplan"
      }
    },
    "installed": {
      "title": "Installierte Apps",
      "install": "App installieren",
      "emptyTitle": "Noch keine Apps installiert",
      "emptyBody": "Laden Sie ein gebautes Oberflächenpaket hoch, um eine zu installieren. Hier installierte Apps werden sofort ausgeliefert — ohne Neustart, anders als bei einem Verzeichnis.",
      "uninstall": "Deinstallieren",
      "stagedTitle": "Hochgeladen, aber nicht installiert",
      "stagedHint": "Verwerfen Sie, wogegen Sie sich entschieden haben, oder laden Sie denselben Schlüssel erneut hoch, um ihn zu ersetzen.",
      "discard": "Verwerfen",
      "installedAt": "installiert {when}",
      "updatesAvailable": "{count, plural, one {# Update verfügbar} other {# Updates verfügbar}}",
      "updateTo": "Update auf v{version}",
      "needsNewer": "v{version} benötigt Adminium {minimum} oder neuer",
      "cannotUpdate": "v{version} kann diese Version nicht direkt aktualisieren. Deinstallieren Sie sie zuerst und installieren Sie dann v{version}.",
      "missing": "Fehlt",
      "missingBody": "Ihre Dateien liegen nicht auf diesem Server, daher wird sie nicht ausgeliefert. Installieren Sie dieselbe Version erneut oder deinstallieren Sie sie.",
      "update": "Aktualisieren",
      "discardFailed": "Der Upload wurde nicht verworfen",
      "renamed": "Tabellen in {prefix}… umbenannt",
      "oldNames": "Diese Installation verwendet die alten Tabellennamen.",
      "oldNamesWhy": "Sie wurden vor den Präfixen angelegt.",
      "renameTo": "In {prefix}… umbenennen"
    },
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
    "job": {
      "refreshTitle": "Online-App-Katalog wird geprüft",
      "downloadTitle": "{app} wird heruntergeladen",
      "body": "Wird geladen und geprüft. Installiert oder geändert wird erst auf Ihr Wort.",
      "failed": "Der Vorgang wurde nicht abgeschlossen. Es wurde nichts installiert oder geändert."
    },
    "names": {
      "label": "Name für {app}",
      "save": "Namen speichern",
      "subtitle": "Wie jede App heißt — in ihren eigenen Ansichten und in der Seitenleiste dieses Dashboards. Leer lassen, um den Namen zu verwenden, mit dem die App gebaut wurde.",
      "title": "App-Namen"
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
    "update": {
      "title": "{app} auf v{version} aktualisieren",
      "subtitle": "Diese Version braucht Tabellen, die die installierte nicht hatte.",
      "body": "Sie werden in der Datenbank angelegt, die diese App bereits nutzt. Bereits vorhandene Tabellen werden nicht verändert.",
      "cancel": "Abbrechen",
      "confirm": "Aktualisieren",
      "close": "Schließen",
      "done": "{app} auf v{version} aktualisiert",
      "missingColumns": "Es fehlen: {tables}.",
      "checkSubtitle": "Prüfen Sie die Tabellen, die diese Version verwendet.",
      "pickFirst": "Wählen Sie vor dem Update, was mit {table} geschehen soll.",
      "checkFirst": "Prüfen Sie die Tabellen vor dem Update erneut.",
      "nothingYet": "Nichts ändert sich, bevor Sie auf Aktualisieren klicken."
    },
    "veto": {
      "title": "Diese Installation kann nicht online suchen",
      "body": "Die Einstellung ist gespeichert, aber Netzwerkfunktionen sind für diesen Server aus, und das gilt. Installierte Apps laufen weiter, und Sie können selbst eine hochladen."
    },
    "columns": {
      "title": "{app} auf v{version} aktualisieren",
      "subtitle": "Diese Version braucht Spalten, die Tabellen in Ihrer Datenbank noch nicht haben.",
      "body": "Adminium kann sie für Sie hinzufügen. Sie sehen die genaue Anweisung, bevor etwas ausgeführt wird, nichts wird entfernt, und die App wird erst aktualisiert, wenn die Spalten existieren.",
      "alsoCreates": "Das Update legt außerdem diese Tabellen an:",
      "noDdl": "Adminium kann diese Spalten hier nicht hinzufügen",
      "failed": "Die Spalten konnten nicht hinzugefügt werden",
      "valuesFailed": "Die Spalten wurden hinzugefügt, aber ihre erlaubten Werte konnten nicht gespeichert werden",
      "confirm": "Spalten hinzufügen und aktualisieren"
    },
    "rename": {
      "title": "Tabellen in {prefix}… umbenennen",
      "subtitle": "{count, plural, one {# Tabelle in {connection}} other {# Tabellen in {connection}}}",
      "close": "Schließen",
      "body": "Diese Installation stammt aus der Zeit vor den Präfixen. Das Umbenennen gibt jeder Tabelle das Präfix der App, damit {app} seine eigenen Tabellen erkennt.",
      "planFailed": "Die Umbenennung konnte nicht geplant werden",
      "refused": "Diese Tabellen können hier nicht umbenannt werden",
      "failed": "Die Tabellen wurden nicht umbenannt",
      "repair": "Adminium aktualisiert auch seine eigenen Seiten und Regeln, die auf die alten Namen verweisen.",
      "cancel": "Abbrechen",
      "confirm": "Tabellen umbenennen"
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
      "timezoneGuessed": "von diesem Server",
      "timezoneNone": "nicht gesetzt — Datumsangaben erscheinen in {zone}, der Zeitzone dieses Servers"
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
      "title": "Verbindung löschen",
      "forbidden": "Ihre Rolle umfasst nicht die Verwaltung von Verbindungen, daher wurde diese nicht gelöscht.",
      "liveKeys": {
        "body": "Seiten, die auf diesen Schlüsseln aufbauen, würden nicht mehr funktionieren. Widerrufen Sie sie zuerst auf der Seite „Öffentliche API“ und löschen Sie dann die Verbindung.",
        "title": "Veröffentlichbare Schlüssel nutzen diese Verbindung noch"
      }
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
    "trust": "Wir lesen nur Ihr Schema — während der Einrichtung nie Ihre Zeilendaten.",
    "blank": {
      "description": "Nichts generieren. Verbinden Sie eine Datenbank und bauen Sie die Seiten, die Sie wollen, eine nach der anderen.",
      "title": "Leere Arbeitsfläche"
    }
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
      "title": "Diese Seite löschen?",
      "failed": "Die Seite wurde nicht gelöscht"
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
      "tableChoose": "Tabelle wählen…",
      "tableCreateHint": "Die Tabelle, aus der diese Seite liest.",
      "tableNeedsConnection": "Wählen Sie zuerst eine Datenquelle.",
      "tableNoConnection": "Verbinden Sie zuerst eine Datenbank — diese Seite wird aus einer ihrer Tabellen aufgebaut.",
      "tableNone": "Nicht verknüpft",
      "template": "Vorlage",
      "templateHint": "Bestimmt, was die Seite enthalten kann. Später änderbar.",
      "title": "Titel",
      "titleHint": "Wird in der Seitenleiste und in der Kopfzeile der Seite angezeigt.",
      "visible": "In der Seitenleiste anzeigen",
      "visibleHint": "Eine ausgeblendete Seite bleibt über ihre URL erreichbar, wenn man den Link kennt.",
      "width": "Inhaltsbreite",
      "widthHint": "Wie breit die Inhaltsspalte der Seite auf einem großen Bildschirm werden darf.",
      "groupApp": "Im eigenen Bereich seiner App"
    },
    "filters": {
      "add": "Filter hinzufügen",
      "control": "Steuerelement für {column}",
      "down": "{column} nach unten",
      "empty": "Diese Seite hat keine Filter. Fügen Sie unten einen hinzu.",
      "full": "Eine Seite zeigt höchstens {max} Filter.",
      "name": "Name für {column}",
      "remove": "Filter {column} entfernen",
      "reset": "Zurück zu den vorgeschlagenen Filtern",
      "subtitle": "Die Fragen, die die Symbolleiste zu dieser Tabelle stellen kann. Unverändert folgt sie der Tabelle.",
      "title": "Filter",
      "up": "{column} nach oben"
    },
    "fit": {
      "alternatives": {
        "title": "Eine Tabelle verwenden, die bereits passt",
        "help": "Es wird nichts in Ihre Datenbank geschrieben — die Seite zeigt dann einfach auf eine Tabelle, die schon alles Nötige hat.",
        "use": "Diese Tabelle verwenden"
      },
      "checkFailed": "Adminium konnte diese Tabelle nicht prüfen",
      "checkFailedBody": "Sie können die Seite trotzdem anlegen. Wenn die Tabelle sie nicht tragen kann, sagt das Anlegen es Ihnen.",
      "columns": {
        "title": "Fehlendes zu dieser Tabelle hinzufügen",
        "help": "Adminium fügt Ihrer Tabelle diese Spalten hinzu. Sie sehen die genaue Anweisung, bevor etwas ausgeführt wird, und es wird nichts entfernt.",
        "review": "Änderung ansehen",
        "confirm": "Ausführen",
        "failed": "Das hat nicht geklappt",
        "partial": "Eines, was diese Seite braucht, kann nicht für Sie angelegt werden — sie bleibt danach also unvollständig.",
        "cannot": "Das kann Adminium nicht für Sie anlegen",
        "cannotBody": "Diese Seite braucht eine Verknüpfung zu einer anderen Tabelle, die unter Studio → Schema eingerichtet werden muss.",
        "halfDone": "Die Spalten wurden angelegt, aber Adminium konnte ihre Bedeutung nicht festhalten",
        "halfDoneBody": "Es muss nichts erneut ausgeführt werden — die Spalten sind da. Legen Sie ihre Bedeutung unter Studio → Schema fest, oder bitten Sie eine Administratorin darum."
      },
      "needs": "Für diese Seite braucht die Tabelle:",
      "noDdl": "Adminium kann diese Tabelle nicht für Sie ändern",
      "role": {
        "eventDate": "ein Datum in jeder Zeile",
        "title": "eine Textspalte als Titel jeder Zeile",
        "status": "eine Statusspalte, deren Werte Arbeitsschritte benennen",
        "personFk": "eine Verknüpfung zu einer Personentabelle",
        "shiftType": "eine Spalte, die angibt, um welche Art von Schicht es sich handelt"
      },
      "slotOnly": "Nichts in dieser Tabelle kann den Bereich „{slot}“ füllen.",
      "tag": {
        "title": "Eine vorhandene Spalte verwenden",
        "help": "Damit wird nur festgehalten, was die Spalte bedeutet. Ihre Datenbank bleibt unverändert, und Sie können es unter Studio → Schema rückgängig machen.",
        "action": "Diese Spalte verwenden",
        "failed": "Diese Spalte konnte nicht markiert werden"
      },
      "title": "Diese Tabelle kann diese Seite noch nicht tragen",
      "table": {
        "title": "Eine neue Tabelle für diese Seite anlegen",
        "help": "Adminium legt eine Tabelle mit allem an, was diese Seite braucht. Sie sehen die genaue Anweisung, bevor etwas ausgeführt wird, und Ihre anderen Tabellen bleiben unberührt.",
        "open": "Oder eine neue Tabelle für diese Seite anlegen",
        "name": "Tabellenname",
        "nameTaken": "Eine Tabelle mit diesem Namen gibt es bereits.",
        "nameInvalid": "Verwenden Sie Kleinbuchstaben, Ziffern und Unterstriche, beginnend mit einem Buchstaben.",
        "people": "Jede Zeile jemandem zuordnen aus",
        "peopleNew": "Einer neuen Personentabelle",
        "peopleCreated": "Legt außerdem „{table}“ an, eine kleine Tabelle der Personen, denen Zeilen zugeordnet werden.",
        "noCompose": "Eine Tabelle unter diesem Namen würde für diese Seite nicht funktionieren. Versuchen Sie einen anderen Namen.",
        "confirm": "Tabelle anlegen",
        "noDdl": "Adminium kann hier keine Tabelle anlegen",
        "halfDone": "Die Tabelle wurde angelegt, aber Adminium konnte die Bedeutung ihrer Spalten nicht speichern",
        "halfDoneBody": "Nichts muss erneut ausgeführt werden — die Tabelle existiert. Legen Sie die Bedeutung ihrer Spalten unter Studio → Schema fest oder bitten Sie eine Administratorin bzw. einen Administrator darum.",
        "notReread": "Die Tabelle wurde angelegt, aber Adminium konnte sie noch nicht wieder einlesen",
        "notRereadBody": "Nichts muss erneut ausgeführt werden. Aktualisieren Sie das Schema unter Studio → Datenverbindungen und wählen Sie dann hier die neue Tabelle."
      },
      "related": {
        "title": "Die Daten einer verknüpften Tabelle verwenden",
        "help": "In Ihre Datenbank wird nichts geschrieben. Die Seite wird auf einer mit dieser verknüpften Tabelle aufgebaut, und jeder Eintrag zeigt einen Namen aus dieser Tabelle.",
        "reason": "Daten aus „{date}“, jeweils betitelt mit „{title}“ über „{via}“",
        "chosen": "Aufgebaut auf {table}, jeder Eintrag betitelt mit „{title}“ aus {from}",
        "undo": "Zurück zu {table}"
      }
    },
    "form": {
      "addLines": "{label} als Positionen",
      "dialog": {
        "cta": "Schaltfläche",
        "ctaIcon": "Symbol der Schaltfläche",
        "iconDefault": "Standard",
        "subtitle": "Untertitel",
        "title": "Dialogtitel",
        "titleHelp": "Leer verwendet die erzeugten Wörter."
      },
      "field": {
        "availability": "Belegt, wenn",
        "availabilityAny": "Irgendeine Zeile belegt diese Zeit",
        "availabilityHelp": "Eine andere Zeile belegt dieselbe Zeit. Wählen Sie eine Spalte, um auf einen Raum, eine Person, eine Maschine einzugrenzen. Ohne sie wird nichts als belegt angezeigt.",
        "availabilityOff": "Nicht prüfen",
        "control": "Steuerelement",
        "down": "{name} nach unten verschieben",
        "drag": "{name} umsortieren",
        "help": "Hilfetext",
        "initial": "Startwert",
        "initialHelp": "Womit ein NEUER Datensatz beginnt. Beim Bearbeiten wird er nie angewendet.",
        "initialLiteral": "Ein fester Wert",
        "initialNone": "Nichts",
        "initialNow": "Aktuelles Datum und Uhrzeit",
        "initialToday": "Heute",
        "initialUser": "Wer angemeldet ist",
        "initialValue": "Der Wert",
        "label": "Bezeichnung",
        "placeholder": "Platzhalter",
        "recap": "Zusammenfassung",
        "recapHelp": "Ein Übersichtsfeld. Sein Text wird vorerst im JSON der Seite bearbeitet.",
        "remove": "{name} entfernen",
        "required": "Danach fragen",
        "requiredHelp": "Das Formular speichert nicht ohne diesen Wert. Was die DATENBANK verlangt, wird im Schema festgelegt.",
        "ruleChecks": "zusätzliche Prüfungen gelten",
        "ruleDatabase": "die Datenbank füllt es aus",
        "ruleFilled": "Adminium füllt es aus",
        "ruleList": "nur Werte aus der Liste {key}",
        "ruleRequired": "die Datenbank verlangt es",
        "ruleValues": "nur eine feste Menge von Werten",
        "rules": "Diese Spalte: {rules}.",
        "rulesLink": "Im Schema ändern",
        "settings": "Einstellungen für {name}",
        "slotsEnd": "bis",
        "slotsEvery": "alle",
        "slotsHelp": "Lassen Sie die Zeiten leer für eine reine Tagesauswahl.",
        "slotsStart": "Zeiten von",
        "span": "Breite",
        "spanHelp": "Wie viele Spalten des Abschnitts dieses Feld einnimmt.",
        "up": "{name} nach oben verschieben"
      },
      "gallery": {
        "choice": {
          "body": "Auswählbare Auswahlkarten, ein Pill-Schalter und ein Schieberegler.",
          "title": "Auswahlkarten"
        },
        "multi": {
          "body": "E-Mail-Chips, Rollenauswahl, Berechtigungsliste.",
          "title": "Mehrfacheingabe"
        },
        "quick": {
          "body": "Ein Titelfeld mit Meta-Pills in einer Zeile. Ohne Abschnittsrahmen.",
          "title": "Schnell anlegen"
        },
        "repeater": {
          "body": "Eine Referenz, wiederholbare Positionen und laufende Summen.",
          "title": "Wiederholung und Summen"
        },
        "sectioned": {
          "body": "Langer Datensatz, aufgeteilt in beschriftete Abschnitte mit scrollendem Bereich.",
          "title": "Abschnitte"
        },
        "segmented": {
          "body": "Segmentierte Priorität, lange Beschreibung, Anhangsliste, zuständige Person.",
          "title": "Segmente und Dateien"
        },
        "split": {
          "body": "Zwei Bereiche: der erste Abschnitt neben dem Rest. Für einen Kalender gemacht.",
          "title": "Geteilte Ansicht"
        },
        "upload": {
          "body": "Medien-Dropzone, Währungsfelder, Tag-Chips und ein Veröffentlichen-Schalter.",
          "title": "Upload und Chips"
        },
        "wizard": {
          "body": "Schritt-für-Schritt-Assistent mit Fortschrittsleiste und Zurück/Weiter-Fußzeile.",
          "title": "Assistent"
        }
      },
      "missing": {
        "title": "Nicht in diesem Formular. Eine Spalte, die die Datenbank verlangt, wird beim Öffnen des Dialogs automatisch ergänzt."
      },
      "preview": "Vorschau",
      "previewEntity": "Datensatz",
      "reset": "Auf erzeugt zurücksetzen",
      "section": {
        "add": "Abschnitt hinzufügen",
        "columnCount": "{count} Spalten",
        "columns": "Spalten",
        "empty": "Noch keine Felder — verschieben Sie eines hierher oder fügen Sie unten eines hinzu.",
        "label": "Abschnittsname",
        "remove": "Diesen Abschnitt entfernen",
        "unnamed": "Unbenannter Abschnitt"
      },
      "subtitle": "Was die Dialoge „Neu“ und „Bearbeiten“ zeigen. Unberührt folgt es der Tabelle.",
      "title": "Formular zum Anlegen"
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
      "project": "Projektcode",
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
    "project": {
      "badge": {
        "changed": "Auf dem Server geändert",
        "conflict": "Konflikt",
        "outside": "Nicht im Projekt"
      },
      "changed": {
        "body": "Übernehmen Sie die Änderungen in Ihr Projekt und stellen Sie es bereit, sonst bleiben sie nur auf diesem Server:",
        "title": "{count, plural, one {# Seite wurde auf diesem Server geändert} other {# Seiten wurden auf diesem Server geändert}}"
      },
      "conflicts": {
        "body": "Dieser Server behält seine eigene Fassung, bis Sie eine auswählen.",
        "title": "{count, plural, one {# Seite wurde hier und im Projekt geändert} other {# Seiten wurden hier und im Projekt geändert}}"
      },
      "fromCode": "Diese Seite stammt aus {source}. Ändern Sie sie dort.",
      "invalid": {
        "body": "Korrigieren Sie diese Dateien. Bis dahin bleibt die letzte gültige Fassung in Gebrauch.",
        "title": "{count, plural, one {# Projektdatei wurde nicht übernommen} other {# Projektdateien wurden nicht übernommen}}"
      },
      "keepServer": "Server-Fassung behalten",
      "notConfigured": "Einige davon gehören zu einer Datenbank, die das Projekt nicht aufführt. Tragen Sie sie in adminium.config.ts ein, damit ihre Seiten im Projekt bleiben.",
      "outside": {
        "body": "Sie existieren nur auf diesem Server. Übernehmen Sie sie ins Projekt, um sie zu behalten:",
        "title": "{count, plural, one {# Seite ist nicht im Projekt} other {# Seiten sind nicht im Projekt}}"
      },
      "resolveFailed": "Das konnte nicht geändert werden.",
      "useProject": "Projekt-Fassung verwenden"
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
      },
      "apps": {
        "title": "In den Bereichen installierter Apps",
        "body": "Jede App hat ihre Seiten in einem eigenen Bereich der Seitenleiste."
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
    },
    "toggleFailed": "Die Seite wurde nicht geändert"
  },
  "project": {
    "actions": {
      "bulk": "Ein oder mehrere Datensätze",
      "empty": "Keine Aktionen. Eine Datei in actions/ fügt Datensätzen eine Schaltfläche hinzu.",
      "needs": "Erfordert: {permission}",
      "single": "Ein Datensatz",
      "title": "Aktionen"
    },
    "changes": {
      "empty": "Alle Seiten- und Schemadateien stimmen mit diesem Server überein.",
      "open": "Unter Seiten klären",
      "title": "Auf diesem Server geändert"
    },
    "code": {
      "disabled": "Nicht geladen: Die Desktop-App führt nie Projektcode aus",
      "label": "Projektcode",
      "loaded": "Geladen {when}",
      "none": "Nichts geladen"
    },
    "failures": {
      "empty": "Seit dem Serverstart ist kein Hook fehlgeschlagen.",
      "title": "Hook-Fehler"
    },
    "files": {
      "count": "{count, plural, one {# Datei} other {# Dateien}}",
      "pages": "Seitendateien",
      "schema": "Schemadateien",
      "title": "Dateien"
    },
    "folder": "Ordner",
    "hooks": {
      "empty": "Keine Hooks. Eine Datei in hooks/ führt Code aus, wenn sich Datensätze ändern.",
      "onImport": "Auch für CSV-Importe",
      "title": "Hooks"
    },
    "loadFailed": "Das Projekt konnte nicht geladen werden",
    "mode": {
      "dev": "Entwicklung: Ordner und Studio bleiben im Gleichschritt",
      "label": "Läuft als",
      "server": "Server: Der Ordner ändert sich nur mit einem Deployment"
    },
    "none": {
      "body": "Ein Projekt ist ein Ordner, der mit `npx @adminiumjs/adminium new` erstellt wurde. Seine Seiten, Hooks und Aktionen erscheinen hier, wenn der Server es ausführt.",
      "title": "Dieser Server führt kein Projekt aus"
    },
    "pages": {
      "empty": "Keine Seiten. Eine .tsx-Datei in pages/ fügt eine eigene Seite hinzu.",
      "hidden": "Nicht in der Seitenleiste",
      "title": "Seiten"
    },
    "permission": {
      "create": "Hinzufügen",
      "delete": "Löschen",
      "read": "Ansehen",
      "update": "Bearbeiten"
    },
    "problems": {
      "body": "Korrigieren Sie diese Dateien. Der übrige Projektcode läuft.",
      "title": "{count, plural, one {# Datei wurde nicht geladen} other {# Dateien wurden nicht geladen}}"
    },
    "status": {
      "changed": "Auf diesem Server geändert",
      "conflict": "Konflikt",
      "invalid": "Ungültig",
      "outside": "Nicht im Projekt",
      "pending": "Noch nicht übernommen"
    },
    "subtitle": "Der Projektordner, den dieser Server ausführt, und der Code, den er geladen hat.",
    "superAdminOnly": "Nur ein Super-Admin kann das Projekt sehen, das dieser Server ausführt.",
    "title": "Projekt",
    "version": "Adminium",
    "widgets": {
      "card": "Dashboard-Karte",
      "cell": "Tabellenzelle",
      "empty": "Keine Widgets. Eine Datei in widgets/ fügt eine Tabellenzelle oder eine Dashboard-Karte hinzu.",
      "title": "Widgets"
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
      "title": "Scopes",
      "deleteBodyKeys": "Ein Scope mit aktiven Schlüsseln kann nicht gelöscht werden. Widerrufen Sie zuerst seine Schlüssel. Bereits widerrufene oder abgelaufene Schlüssel werden mit dem Scope gelöscht.",
      "liveKeys": {
        "body": "Seiten, die auf diesen Schlüsseln aufbauen, würden nicht mehr funktionieren. Widerrufen Sie sie zuerst in der Schlüsselliste und löschen Sie dann den Scope.",
        "title": "Veröffentlichbare Schlüssel nutzen diesen Scope noch"
      }
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
    "rules": {
      "fill": "Startwert",
      "fillDb": "Die Datenbank füllt es (ein Trigger)",
      "fillDefault": "Der Datenbank überlassen",
      "fillHelp": "Was Adminium hier einträgt, wenn es niemand ausfüllt.",
      "fillImplicit": "Adminium füllt dies automatisch aus.",
      "fillLiteral": "Ein fester Wert",
      "fillNone": "Nichts — leer lassen",
      "fillNow": "Das aktuelle Datum und die Uhrzeit",
      "fillText": "Der Wert",
      "fillUser": "Wer angemeldet ist",
      "fillUuid": "Eine neue eindeutige ID",
      "format": "Format",
      "formatAny": "Beliebig",
      "formatEmail": "Eine E-Mail-Adresse",
      "formatPhone": "Eine Telefonnummer",
      "formatUrl": "Eine Webadresse",
      "help": "Diese gelten überall, wo ein Datensatz geschrieben wird — Formulare, Importe, Automatisierungen und die API —, nicht nur in dieser App.",
      "max": "Größter Wert",
      "maxLength": "Maximallänge",
      "min": "Kleinster Wert",
      "minLength": "Mindestlänge",
      "onUpdate": "Bei jeder Änderung neu eintragen",
      "optionsFromDatabase": "Ihre Datenbank legt die erlaubten Werte dieser Spalte fest. Ändern Sie sie unter Entwurf.",
      "optionsHelp": "Einer pro Zeile. Leer lassen, um alles zuzulassen.",
      "required": "Muss ausgefüllt werden",
      "requiredAlready": "Ihre Datenbank verlangt diese Spalte bereits.",
      "requiredHelp": "Das Formular fragt danach, und ein Schreibvorgang ohne diesen Wert wird abgelehnt.",
      "title": "Regeln",
      "optionsAnything": "Beliebig",
      "optionsInline": "Diese Werte",
      "optionsList": "Eine Liste",
      "optionsListHelp": "Die Listen selbst bearbeiten Sie unter Studio → Listen.",
      "optionsListLabel": "Liste",
      "optionsListUnavailable": "Die Listen konnten nicht gelesen werden.",
      "optionsMissingList": "{key} (nicht in diesem Arbeitsbereich)",
      "optionsPickList": "Liste wählen…",
      "optionsSource": "Erlaubte Werte",
      "optionsSourceHelp": "Eine Liste wird einmal in Studio geschrieben und von jeder Spalte verwendet, die sie nennt.",
      "optionsValues": "Die Werte",
      "decided": {
        "title": "Von Adminium festgelegt",
        "help": "Adminium füllt dies bei jedem Schreibvorgang aus, und ein öffentlicher Endpunkt kann es nie von Besuchern setzen lassen.",
        "copy": "Kopiert aus {from} der Zeile, auf die {via} verweist",
        "copyAlways": "immer, egal was der Schreibende angibt",
        "copyDefault": "sofern der Schreibende keinen Wert angibt",
        "sequence": "Die nächste Nummer der Reihe nach, ab {start}",
        "code": "Ein zufälliger Code wie {example}",
        "remove": "Diese Regel entfernen",
        "rollup": "Die Summe von {sum} über seine Zeilen in {from}",
        "rollupTimes": "Die Summe von {sum} × {times} über seine Zeilen in {from}",
        "stampCreate": "Wird beim Anlegen der Zeile auf {what} gesetzt",
        "stampChange": "Wird auf {what} gesetzt, wenn {column} zu {values} wird",
        "stampNow": "die Uhrzeit",
        "stampUserName": "den Namen der Person, die es tut",
        "stampUserId": "die ID der Person, die es tut",
        "stampByOrigin": "„{public}“ von der öffentlichen Seite, „{staff}“ vom Personal",
        "rollupWhere": "nur Zeilen, in denen {column} {value} ist",
        "rollupBalance": "und hält {balance} = {of} − {minus} − diese Summe",
        "rollupCap": "Eine Änderung, die den Saldo unter null bringen würde, wird abgelehnt.",
        "stampToday": "das Datum",
        "stampClaim": "{column} der angemeldeten Person",
        "stampAddDays": "{date} plus {days} Tage",
        "stampAddDaysColumn": "{date} plus die Tage, die {column} angibt",
        "stampHashOf": "ein Fingerabdruck der Zeile",
        "stampFilled": "Wird auf {what} gesetzt, wenn {column} zum ersten Mal ausgefüllt wird",
        "sequenceGapless": "Die nächste Nummer der Reihe nach, ohne Lücken und ohne Wiederholung",
        "sequenceScope": "für jedes {scope} getrennt gezählt",
        "formula": "Bei jedem Schreiben aus {columns} berechnet",
        "format": "Geschrieben als {example}, aus der Nummer in {from}",
        "scale": "Auf {places} Nachkommastellen gerundet",
        "scaleCurrency": "Auf die Nachkommastellen seiner Währung gerundet",
        "stampByOriginOwn": "„{public}“ von der öffentlichen Seite, vom Personal das, was es wählt",
        "stampCopy": "der Wert von {column}",
        "normalizeEmail": "Ohne Leerzeichen am Rand und in Kleinbuchstaben gespeichert",
        "normalizeTrim": "Ohne Leerzeichen am Anfang und Ende gespeichert"
      },
      "venueLocal": "Eine hier ohne Zeitzone geschriebene Zeit ist die Ortszeit des Lokals.",
      "fillFromCurrency": "Die Währung der Verbindung",
      "fillFromSetting": "Eine Einstellung: {setting}"
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
    "unavailableBody": "Dieser Build enthält den Editor zum Neuzuordnen noch nicht. Führen Sie die Generierung erneut aus, sobald er da ist, um Bezeichnungen, Typen und Beziehungen neu zuzuordnen.",
    "unavailableTitle": "Editor zum Neuzuordnen des Schemas nicht verfügbar"
  },
  "review": {
    "unavailableBody": "Dieser Build enthält die Anreicherungs-Prüfungsansicht noch nicht. Sie kommt mit dem Diff-und-Übernehmen-Ablauf.",
    "unavailableTitle": "Prüfungsansicht nicht verfügbar"
  },
  "settings": {
    "globalDefaultsNav": "Globale Standards",
    "title": "Einstellungen",
    "workspaceSection": "Workspace"
  },
  "settingsAi": {
    "assistant": {
      "name": {
        "label": "Name des Assistenten",
        "hint": "Wird auf der Fragen-Schaltfläche und im Assistenzfenster angezeigt."
      },
      "rowData": {
        "label": "{name} Tabellenzeilen lesen lassen",
        "hint": "Wenn aktiv, darf {name} Zeilen, die deine Rolle lesen kann, an den konfigurierten Anbieter senden — maskiert, höchstens 50 pro Anfrage und unter „Gelesene Quellen“ aufgeführt. Wenn aus, arbeitet es nur mit Dokumenten und Schema."
      },
      "save": "Speichern",
      "saveFailed": "Die Assistenteinstellungen konnten nicht gespeichert werden. Erneut versuchen.",
      "saved": "Assistenteinstellungen gespeichert",
      "subtitle": "Wie er hier heißt und was er lesen darf.",
      "title": "Assistent"
    },
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
    "apiCard": {
      "api": {
        "helper": "Stellt die Endpunkte bereit, auf die Ihre Schlüssel beschränkt sind. Ausgeschaltet funktioniert sofort kein Schlüssel mehr; gelöscht wird nichts.",
        "label": "Öffentliche API"
      },
      "docs": {
        "helper": "Eine öffentliche Seite unter /api-docs, die jedem, der diesen Server erreicht, die Endpunkte auflistet, die Ihre aktiven Schlüssel aufrufen können — auch solche auf Mitarbeiterebene — mit Pfaden, Methoden und Spaltennamen. Sie zeigt keine Daten und keine Schlüssel.",
        "label": "API-Dokumentationsseite"
      },
      "failed": "Der Schalter wurde nicht umgestellt. Versuchen Sie es erneut.",
      "heading": "Öffentliche API",
      "notRegistered": {
        "body": "Setzen Sie ADMINIUM_PUBLIC_API_ORIGINS und starten Sie neu. Bis dahin bewirken diese Schalter nichts.",
        "title": "Auf diesem Server nicht aktiviert"
      }
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
      "linkOrigin": {
        "error": "Geben Sie eine Adresse wie https://admin.example.com ohne Pfad ein.",
        "helper": "Links zum Zurücksetzen des Passworts und aus Einladungen öffnen diese Adresse. Ist sie leer, übernimmt Adminium sie vom nächsten Admin, der sich anmeldet oder eine Änderung speichert, außer er arbeitet über localhost.",
        "label": "Adresse in E-Mail-Links"
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
    "projectCard": {
      "body": "Der Projektordner, den dieser Server ausführt: seine Hooks, Aktionen und Seitendateien.",
      "cta": "Projekt öffnen",
      "heading": "Projekt"
    },
    "publicApiCard": {
      "body": "Erstellen Sie Endpunkte und die Schlüssel, die sie aufrufen dürfen.",
      "cta": "API-Schlüssel öffnen",
      "heading": "API-Schlüssel"
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
    },
    "listsCard": {
      "body": "Die Antworten, die eine Spalte annimmt — Länder, Phasen, Abteilungen — einmal benannt und überall verwendbar.",
      "cta": "Listen öffnen",
      "heading": "Listen"
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
    "emptyBody": "Diese Datenbank hat noch keine Tabellen. Sie können trotzdem fortfahren — sobald Sie Tabellen angelegt haben, holen Sie sie mit „Neu introspizieren“ für diese Verbindung herein.",
    "emptyFileBody": "Diese Schemadatei definiert keine Tabellen. Gehen Sie zurück und laden Sie eine andere Datei hoch, oder fahren Sie trotzdem fort.",
    "emptyFilter": "Keine Tabellen entsprechen Ihrem Filter.",
    "emptyTitle": "Keine Tabellen gefunden",
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
    "startOver": {
      "action": "Von vorn beginnen",
      "body": "Alle Eingaben werden verworfen und der Assistent kehrt zum ersten Schritt zurück.",
      "bodyCreated": "Alle Eingaben werden verworfen und der Assistent kehrt zum ersten Schritt zurück. Die bereits von Adminium angelegte Verbindung wird nicht gelöscht — sie bleibt unter „Datenverbindungen“.",
      "confirm": "Von vorn beginnen",
      "keep": "Weitermachen",
      "title": "Diesen Assistenten von vorn beginnen?"
    },
    "step": {
      "enrich": "Anreichern",
      "generate": "Generieren",
      "intent": "Zweck",
      "meta": "Meta-Speicher",
      "source": "Quelle",
      "tables": "Tabellen",
      "test": "Analysieren",
      "finish": "Abschließen"
    },
    "title": "Neue Verbindung"
  },
  "lists": {
    "addValue": "Wert hinzufügen",
    "andMore": "und {count} weitere",
    "builtin": "Eingebaut",
    "builtinCount": "{count} Werte",
    "builtinSubtitle": "Eine Liste, die Adminium mitliefert. Sie ist in jedem Arbeitsbereich dieselbe, und ihre Namen erscheinen in der Sprache der lesenden Person.",
    "cancel": "Abbrechen",
    "close": "Schließen",
    "copiedFrom": "eine Kopie von {key}",
    "copyTitle": "Eine Kopie von {name}",
    "create": "Liste erstellen",
    "delete": "Löschen",
    "deleteBody": "Die Liste verschwindet. Die bereits gespeicherten Werte in Ihren Zeilen bleiben genau so, wie sie sind — eine Liste sagt, was ein Formular anbietet, nicht, was eine Spalte enthält.",
    "deleteTitle": "{name} löschen?",
    "edit": "Bearbeiten",
    "editSubtitle": "Die Antworten, die eine Spalte mit dieser Liste annimmt, in der Reihenfolge, in der ein Formular sie anbietet.",
    "editTitle": "{name} bearbeiten",
    "emptyBody": "Eine Liste ist eine Menge von Antworten, die eine Spalte annimmt.",
    "emptyTitle": "Noch keine Listen",
    "errorUnknown": "Das hat nicht geklappt. Bitte erneut versuchen.",
    "inUseBody": "Entfernen Sie sie zuerst aus {columns}.",
    "inUseNone": "Entfernen Sie sie zuerst aus den Spalten, die sie verwenden.",
    "inUseTitle": "{name} wird von einer Spalte verwendet",
    "issueBlank": "Einer der Werte ist leer. Füllen Sie ihn aus oder entfernen Sie die Zeile.",
    "issueDuplicate": "„{value}“ steht zweimal in der Liste.",
    "issueEmpty": "Eine Liste braucht mindestens einen Wert.",
    "issueName": "Geben Sie der Liste einen Namen.",
    "key": "Schlüssel",
    "keyFixed": "Regeln nennen diese Liste",
    "keyHelper": "So nennen Regeln und Projektdateien diese Liste. Später nicht mehr änderbar.",
    "labelAt": "Bezeichnung {n}",
    "labelPlaceholder": "Was Menschen lesen",
    "makeCopy": "Kopie erstellen, die ich bearbeiten kann",
    "moveDown": "{value} nach unten verschieben",
    "moveUp": "{value} nach oben verschieben",
    "name": "Name",
    "namePlaceholder": "Abteilungen",
    "new": "Neue Liste",
    "removeValue": "{value} entfernen",
    "save": "Änderungen speichern",
    "storeLabel": "Stattdessen die Bezeichnung speichern",
    "storeLabelHelp": "Eine Kopie speichert den Code, z. B. DE. „Stattdessen die Bezeichnung speichern“ speichert, wie er hier heißt, z. B. Deutschland — in der Sprache dieses Arbeitsbereichs, ab jetzt.",
    "subtitle": "Die Antworten, die eine Spalte annimmt: einmal benannt, überall verwendbar.",
    "title": "Listen",
    "valueAt": "Wert {n}",
    "valueCount": "{count} Werte",
    "values": "Werte",
    "view": "Ansehen"
  },
  "apiKeys": {
    "banner": {
      "bodyOnce": "Kopieren Sie ihn jetzt — Sie können ihn später nicht mehr sehen. Beschränkt auf {summary}.",
      "bodyRevealable": "Kopieren Sie ihn jetzt — Sie können ihn in der Liste unten erneut anzeigen. Beschränkt auf {summary}.",
      "copied": "Kopiert",
      "copy": "Kopieren",
      "titleNamed": "{name} erstellt"
    },
    "builder": {
      "auth": {
        "anon": "Anon",
        "authenticated": "Authentifiziert",
        "label": "Authentifizierung",
        "service": "Service-Rolle"
      },
      "cancel": "Abbrechen",
      "columns": {
        "all": "Alle",
        "label": "Freigegebene Spalten",
        "none": "Keine"
      },
      "create": "Endpunkt erstellen",
      "delete": "Endpunkt löschen",
      "deleteRefused": "{count, plural, one {# Schlüssel nutzt} other {# Schlüssel nutzen}} diesen Endpunkt noch: {names}.",
      "filters": {
        "add": "Hinzufügen",
        "empty": "Keine Filter — jede Zeile der Quelle ist erreichbar.",
        "label": "Standardfilter",
        "remove": "Filter entfernen",
        "value": "Wert"
      },
      "footer": {
        "applyFirst": "Übernehmen oder verwerfen Sie zuerst die bearbeitete Definition."
      },
      "methodUnsupported": "Diese Quelle kann {method} nicht unterstützen: Sie hat keinen Primärschlüssel.",
      "methods": "Methoden",
      "op": {
        "between": "zwischen",
        "eq": "gleich",
        "gt": "größer als",
        "gte": "mindestens",
        "ilike": "enthält (Groß-/Kleinschreibung egal)",
        "in": "in Liste",
        "is_null": "ist leer",
        "like": "enthält",
        "lt": "kleiner als",
        "lte": "höchstens",
        "neq": "ungleich",
        "not_null": "ist nicht leer",
        "today": "ist heute",
        "fromToday": "ab heute"
      },
      "paging": {
        "asc": "Aufst.",
        "defaultLimit": "Standardlimit",
        "desc": "Abst.",
        "label": "Seitenumbruch & Sortierung",
        "maxLimit": "Höchstlimit",
        "orderBy": "Sortieren nach"
      },
      "pane": {
        "apply": "In Formular übernehmen",
        "dirty": "bearbeitet — nicht übernommen",
        "format": "Formatieren",
        "label": "Routendefinition, JSON",
        "more": "{first} (+{n} weitere)",
        "revert": "Verwerfen",
        "synced": "mit Formular synchron",
        "title": "Routendefinition"
      },
      "rate": {
        "hour": "Stunde",
        "label": "Anfragelimit & Antwort",
        "minute": "Minute",
        "per": "Pro",
        "requests": "Anfragen",
        "second": "Sekunde"
      },
      "refused": {
        "keys": "Das Speichern würde {count, plural, one {# Schlüssel} other {# Schlüssel}} unbrauchbar machen: {names}."
      },
      "route": "Route",
      "routePlaceholder": "customers",
      "routeRename": "Aufrufer müssen auf den neuen Pfad umstellen.",
      "save": "Änderungen speichern",
      "shape": {
        "array": "Reines Array",
        "label": "Antwortformat",
        "single": "Einzelnes Objekt",
        "wrapped": "Umschlossen von '{' data '}'"
      },
      "source": "Quelltabelle oder -ansicht",
      "subtitle": "Visuell konfigurieren — Adminium schreibt die Routendefinition für Sie",
      "titleEdit": "Endpunkt bearbeiten",
      "titleNew": "Neuer Endpunkt"
    },
    "connection": {
      "label": "Verbindung"
    },
    "create": "Schlüssel erstellen",
    "endpoints": {
      "col": {
        "auth": "Auth",
        "methods": "Methoden",
        "rate": "Anfragelimit",
        "route": "Route"
      },
      "custom": "EIGENER",
      "edit": "Endpunkt bearbeiten",
      "explore": "API erkunden",
      "new": "Neuer Endpunkt",
      "subtitle": "Aus Ihrem Schema erzeugt. Schlüssel werden auf diese beschränkt.",
      "title": "Endpunkte",
      "unavailable": "NICHT VERFÜGBAR"
    },
    "keys": {
      "col": {
        "access": "Zugriff",
        "actions": "Aktionen",
        "key": "Schlüssel",
        "lastUsed": "Zuletzt verwendet",
        "name": "Name"
      },
      "count": "{n, plural, one {# Schlüssel} other {# Schlüssel}}",
      "empty": "Keine aktiven Schlüssel. Erstellen Sie einen, um loszulegen.",
      "hide": "Schlüssel verbergen",
      "kind": {
        "browser": "BROWSER",
        "server": "SERVER"
      },
      "never": "Nie",
      "reveal": "Schlüssel anzeigen",
      "revoke": "Widerrufen",
      "revokeConfirm": {
        "body": "Alles, was diesen Schlüssel nutzt, funktioniert sofort nicht mehr. Dies kann nicht rückgängig gemacht werden.",
        "confirm": "Schlüssel widerrufen",
        "prompt": "Geben Sie „{name}“ ein, um zu bestätigen",
        "title": "{name} widerrufen?"
      },
      "revokeFailed": "Dieser Schlüssel konnte nicht widerrufen werden. Er ist weiterhin aktiv.",
      "title": "Aktive Schlüssel",
      "untitled": "Unbenannter Schlüssel",
      "staffOnly": "Nur Mitarbeiterbildschirm",
      "staffOnlyHint": "Antwortet nur auf einem Bildschirm, an dem ein Mitarbeiter mit {role} angemeldet ist."
    },
    "method": {
      "BATCH": {
        "desc": "Massenweises Einfügen oder Upsert, bis zu 500 Zeilen",
        "title": "Stapel"
      },
      "DELETE": {
        "desc": "Eine Zeile per Primärschlüssel entfernen",
        "title": "Löschen"
      },
      "GET": {
        "desc": "Zeilen auflisten und einen einzelnen Datensatz abrufen",
        "title": "Lesen"
      },
      "PATCH": {
        "desc": "Teilaktualisierung einer Zeile per Primärschlüssel",
        "title": "Aktualisieren"
      },
      "POST": {
        "desc": "Eine neue Zeile einfügen",
        "title": "Erstellen"
      },
      "PUT": {
        "desc": "Eine ganze Zeile per Primärschlüssel ersetzen",
        "title": "Ersetzen"
      }
    },
    "note": {
      "notRegistered": "Die öffentliche API ist auf diesem Server nicht aktiviert. Setzen Sie ADMINIUM_PUBLIC_API_ORIGINS und starten Sie neu — hier erstellte Schlüssel funktionieren ab dann.",
      "off": "Die öffentliche API ist ausgeschaltet, daher funktioniert derzeit kein Schlüssel.",
      "offLink": "Workspace-Einstellungen öffnen"
    },
    "quick": {
      "body": "Authentifizieren Sie Anfragen mit Ihrem Schlüssel im Authorization-Header.",
      "title": "Schnellstart"
    },
    "sheet": {
      "allMethods": "Alle Methoden auswählen",
      "app": {
        "label": "App",
        "none": "Keine"
      },
      "cancel": "Abbrechen",
      "clear": "Leeren",
      "close": "Schließen",
      "count": "{permissions, plural, one {Berechtigung} other {Berechtigungen}} auf {endpoints, plural, one {# Endpunkt} other {# Endpunkten}}",
      "deselectAll": "Alle abwählen",
      "edit": "Endpunkt bearbeiten",
      "expires": {
        "d30": "30 Tage",
        "d90": "90 Tage",
        "label": "Läuft ab",
        "never": "Nie"
      },
      "filter": "Endpunkte filtern",
      "focusMeta": "{source} · {rows} Zeilen · Limit {limit}, Sortierung {order}",
      "focusMetaNoRows": "{source} · Limit {limit}, Sortierung {order}",
      "footer": {
        "empty": "Wählen Sie mindestens eine Methode, um einen Schlüssel zu erstellen.",
        "more": "+{n} weitere",
        "refused": "Dieser Schlüssel kann noch nicht erstellt werden: {issue}",
        "summary": "Dieser Schlüssel kann {paths} aufrufen"
      },
      "kind": {
        "browser": "Browser",
        "label": "Verwendet von",
        "server": "Server"
      },
      "layout": {
        "label": "Layout",
        "list": "Liste",
        "panes": "Bereiche"
      },
      "name": {
        "label": "Schlüsselname",
        "placeholder": "z. B. Worker für Bestell-Sync"
      },
      "newEndpoint": "Neuer Endpunkt",
      "readOnly": "Vorgabe „Nur lesen“",
      "rowMeta": "{source} · {rows} Zeilen",
      "rowMetaNoRows": "{source}",
      "selectAll": "Alle auswählen",
      "selectAllShort": "Alle auswählen",
      "submit": "Schlüssel erstellen",
      "subtitle": "Wählen Sie die Endpunkte und Methoden, die dieser Schlüssel aufrufen darf",
      "title": "API-Schlüssel erstellen",
      "toggleAll": "Alle Methoden umschalten",
      "unsupported": "{count, plural, one {{methods} ist auf dieser Route nicht freigegeben. Bearbeiten Sie den Endpunkt, um die Methode zu aktivieren.} other {{methods} sind auf dieser Route nicht freigegeben. Bearbeiten Sie den Endpunkt, um die Methoden zu aktivieren.}}"
    },
    "stats": {
      "endpoints": "Endpunkte",
      "keys": "Aktive Schlüssel",
      "requests": "Anfragen · 24 h"
    },
    "subtitle": "Verwalten Sie den programmatischen Zugriff auf Ihren Workspace",
    "summary": "{endpoints, plural, one {# Endpunkt} other {# Endpunkte}} · {methods, plural, one {# Methode} other {# Methoden}}",
    "title": "API-Schlüssel & Tokens"
  },
  "surfacePages": {
    "guest": {
      "title": "{app} ist gerade nicht verfügbar.",
      "body": "Bitte versuchen Sie es später noch einmal."
    },
    "staff": {
      "appOff": "{app} ist vorübergehend ausgeschaltet.",
      "sideOff": "Die Mitarbeiterbildschirme von {app} sind ausgeschaltet.",
      "advice": "Bitten Sie Ihre Leitung, es unter {app} → Einstellungen einzuschalten.",
      "signOut": "Abmelden",
      "noAccess": "Dieses Konto kann {app} nicht öffnen.",
      "noAccessAdvice": "Bitten Sie Ihre Führungskraft um eine Rolle, die {app} öffnet."
    },
    "notFound": {
      "title": "Seite nicht gefunden",
      "body": "Unter dieser Adresse gibt es nichts. Prüfen Sie den Link und versuchen Sie es erneut."
    }
  },
  "appSettings": {
    "notInstalled": "Diese App ist nicht installiert",
    "backToApps": "Zurück zu den Apps",
    "statusDisabled": "Deaktiviert",
    "statusUpdate": "Update verfügbar · {version}",
    "statusActive": "Aktiv",
    "version": "Version {version} · von {publisher}",
    "open": "App öffnen",
    "upToDate": "Aktuell",
    "update": "Aktualisieren",
    "saveFailed": "Die Änderung wurde nicht gespeichert",
    "screens": "Bildschirmgruppen",
    "sideStaff": "Mitarbeiterbildschirme",
    "sideCustomer": "Kundenbildschirme",
    "sideAppOff": "Die ganze App ist ausgeschaltet.",
    "staffOnHelp": "Ihr Team meldet sich hier mit eigenen Konten an.",
    "customerOnHelp": "Kundinnen und Kunden nutzen diese Seiten. Sie sind öffentlich.",
    "staffOffHelp": "Diese Bildschirme werden nicht ausgeliefert. Nichts wurde gelöscht.",
    "customerOffHelp": "Kunden sehen „nicht verfügbar“. Nichts wurde gelöscht.",
    "sideSwitch": "{side}, an oder aus",
    "on": "An",
    "off": "Aus",
    "whereItLives": "Wo sie läuft",
    "ownAddress": "Unter eigener Adresse",
    "insideDashboard": "Im Dashboard",
    "copyAddress": "Adresse kopieren",
    "copied": "Kopiert",
    "copy": "Kopieren",
    "addDomain": "Domain hinzufügen",
    "preview": "Vorschau",
    "domainField": "Domain",
    "addDomainSave": "Hinzufügen",
    "data": "Daten",
    "noTables": "Diese App nutzt keine Tabellen.",
    "rows": "{count, plural, one {# Zeile} other {# Zeilen}}",
    "activity": {
      "staged": "Hochgeladen von {actor}",
      "installed": "Installiert von {actor}",
      "updated": "Aktualisiert von {actor}",
      "disabled": "Ausgeschaltet von {actor}",
      "enabled": "Eingeschaltet von {actor}",
      "settings": "Einstellungen geändert von {actor}",
      "domains": "Domains geändert von {actor}",
      "instances": "Instanzen geändert von {actor}",
      "renamed": "Tabellen umbenannt von {actor}",
      "title": "Aktivität",
      "none": "Noch nichts.",
      "sampleAdded": "Beispieldaten hinzugefügt von {actor}",
      "sampleRemoved": "Beispieldaten entfernt von {actor}"
    },
    "danger": "Gefahrenzone",
    "disabledNote": "Die App ist ausgeschaltet. Aktivieren stellt genau das wieder her, was da war.",
    "disableNote": "Blendet die App überall aus und stoppt ihre Endpunkte. Nichts wird gelöscht.",
    "enable": "Aktivieren",
    "disable": "Deaktivieren",
    "uninstallNote": "Entfernt die Dateien und Seiten der App. Tabellen und Daten bleiben.",
    "uninstall": "Deinstallieren",
    "disableTitle": "{app} deaktivieren?",
    "close": "Schließen",
    "nothingDeleted": "Nichts wird gelöscht.",
    "enableBrings": "Aktivieren stellt genau das wieder her, was da war.",
    "cancel": "Abbrechen",
    "disableLine1": "Ihr Bereich wird für alle ausgeblendet.",
    "disableLine2": "Ihre Bildschirme und eigenen Endpunkte antworten nicht mehr.",
    "disableLine3": "Tabellen, Datensätze und Einstellungen bleiben, wie sie sind.",
    "crumb": "Apps",
    "sampleLedger": "Adminiums Liste der Beispieldatensätze"
  },
  "uninstall": {
    "files": "Die Dateien der App",
    "pages": "{count, plural, one {# Seite} other {# Seiten}}",
    "keys": "{count, plural, one {Ihr Browser-Schlüssel} other {Ihre # Browser-Schlüssel}}",
    "settings": "Ihre Einstellungen",
    "hosts": "{count, plural, one {Ihre Domain} other {Ihre # Domains}}",
    "tables": "{count, plural, one {# Tabelle mit allen Datensätzen} other {# Tabellen mit allen Datensätzen}}",
    "editedPages": "Seiten, die Sie bearbeitet haben, bleiben als normale Seiten",
    "audit": "Ihre Einträge im Audit-Log",
    "title": "{app} deinstallieren?",
    "close": "Schließen",
    "planFailed": "Was entfernt würde, konnte nicht gelesen werden",
    "removed": "Entfernt",
    "kept": "Behalten",
    "roleCascade": "Das Entfernen dieser Rolle nimmt sie {members, plural, one {# Person} other {# Personen}} und löscht {keys, plural, one {# daran gebundenen API-Schlüssel} other {# daran gebundene API-Schlüssel}}. Diese Schlüssel funktionieren sofort nicht mehr.",
    "dropTitle": "Auch ihre Tabellen und Daten löschen",
    "dropBody": "{count, plural, one {Löscht die # Tabelle, die sie angelegt hat, mit allen Datensätzen.} other {Löscht die # Tabellen, die sie angelegt hat, mit allen Datensätzen.}} Das kann nicht rückgängig gemacht werden.",
    "typeKey": "Geben Sie zur Bestätigung den Schlüssel der App {key} ein.",
    "failed": "Die App wurde nicht deinstalliert",
    "cancel": "Abbrechen",
    "confirmDrop": "Deinstallieren und Daten löschen",
    "confirm": "Deinstallieren",
    "rules": "{count, plural, one {Ihre Spaltenregel} other {Ihre # Spaltenregeln}}"
  },
  "sampleData": {
    "title": "Beispieldaten",
    "add": "Beispieldaten hinzufügen",
    "installNote": "ein paar Beispieldatensätze in den Tabellen der App, damit es etwas zum Ausprobieren gibt. Sie lassen sich mit einem Klick wieder entfernen.",
    "remove": "Beispieldaten entfernen",
    "keptNotice": "{count, plural, one {# Beispieldatensatz bleibt: Ihre eigenen Datensätze nutzen ihn, oder Sie haben ihn geändert.} other {# Beispieldatensätze bleiben: Ihre eigenen Datensätze nutzen sie, oder Sie haben sie geändert.}}",
    "notLoaded": "Nicht geladen",
    "loadedCount": "Geladen · {count, plural, one {# Datensatz} other {# Datensätze}}",
    "loaded": "Geladen · {count, plural, one {# Datensatz} other {# Datensätze}} · {date}",
    "addSubtitle": "In {connection}",
    "close": "Schließen",
    "addBodyNoConnection": "Ein paar Beispieldatensätze in den Tabellen der App. Sonst wird nichts angetastet.",
    "addBody": "Ein paar Beispieldatensätze in den Tabellen der App. Sonst wird in {connection} nichts angetastet.",
    "images": "Bilder, abgelegt unter Dateien",
    "total": "Gesamt",
    "records": "{count, plural, one {# Datensatz} other {# Datensätze}}",
    "none": "Diese App bringt keine Beispieldaten mit",
    "adding": "Beispieldaten werden hinzugefügt",
    "addFailed": "Die Beispieldaten wurden nicht hinzugefügt",
    "addFailedBody": "Die Beispieldaten wurden nicht hinzugefügt. Es wurde nichts geschrieben.",
    "cancel": "Abbrechen",
    "removeSubtitle": "{count, plural, one {# Datensatz, hinzugefügt am {date}} other {# Datensätze, hinzugefügt am {date}}}",
    "removeBody": "Adminium hat eine Liste aller hinzugefügten Datensätze geführt und entfernt genau diese.",
    "planFailed": "Was entfernt würde, konnte nicht gelesen werden",
    "removes": "Wird entfernt",
    "kept": "Bleibt",
    "usedBy": "{count, plural, one {genutzt von # Ihrer eigenen Datensätze} other {genutzt von # Ihrer eigenen Datensätze}}",
    "keepChanged": "Die von mir geänderten behalten",
    "changedList": "{count, plural, one {# Beispieldatensatz, den Sie bearbeitet haben: {names}.} other {# Beispieldatensätze, die Sie bearbeitet haben: {names}.}}",
    "removeFailed": "Die Beispieldaten wurden nicht entfernt",
    "removeConfirm": "Entfernen",
    "banner": "Beispieldaten sind geladen",
    "bannerRemove": "Entfernen"
  },
  "appPublicAccess": {
    "title": "Öffentlicher Zugriff",
    "intro": "Die Kundenseiten der App müssen:",
    "availability": "Freie oder belegte Zeiten von {table} lesen",
    "claim": "Eigene {table} anhand von {fields} abrufen",
    "create": "Zu {table} hinzufügen",
    "update": "{table} ändern",
    "read": "{table} lesen",
    "later": "kommt in einer späteren Version",
    "allow": "Diesen öffentlichen Zugriff erlauben",
    "helper": "Sie können ihn später auf der Seite „API-Schlüssel“ einschränken.",
    "cannotGrant": "Nur wer API-Schlüssel verwalten darf, kann ihn erlauben – die App wird daher ohne ihn installiert.",
    "warning": {
      "apiOff": "Die öffentliche API ist ausgeschaltet, daher antwortet nichts davon, bis sie eingeschaltet ist.",
      "originSelf": "Die erlaubten Ursprünge enthalten „self“ nicht, daher können die eigenen Seiten der App auf diesem Server sie nicht aufrufen.",
      "timeZone": "Für diese Datenbank ist keine Zeitzone festgelegt, die die öffentliche API für Datums- und Zeitangaben braucht.",
      "noEmail": "E-Mail ist nicht eingerichtet, daher erhalten Gäste keine Bestätigung."
    },
    "createConfirmed": "Zu {table} hinzufügen und eine Bestätigungs-E-Mail erhalten"
  },
  "addOnNeeded": {
    "appDisabled": "Ausgeschaltet – braucht es trotzdem",
    "appInstalling": "Die Installation ist nicht abgeschlossen – braucht es trotzdem",
    "close": "Schließen",
    "confirm": {
      "switchOff": "Trotzdem ausschalten",
      "uninstall": "Trotzdem deinstallieren"
    },
    "lead": {
      "feature": "{features} in {app} wird ausgeschaltet.",
      "switchOff": "{addOn} kann für {app} nicht ausgeschaltet werden. {app} braucht es.",
      "uninstall": "{addOn} kann nicht deinstalliert werden. {count, plural, one {{apps} braucht es.} other {{apps} brauchen es.}}"
    },
    "note": {
      "feature": "Der Rest von {apps} funktioniert ohne es.",
      "switchOff": "Um es auszuschalten, deinstallieren Sie zuerst {app}.",
      "uninstall": "Um es zu deinstallieren, deinstallieren Sie zuerst {apps}."
    },
    "openApp": "{app} öffnen",
    "subtitle": "v{version}",
    "subtitleNamed": "{addOn} · v{version}",
    "title": {
      "switchOff": "Für {app} ausschalten",
      "switchOffAsk": "Für {app} ausschalten?",
      "uninstall": "{addOn} deinstallieren",
      "uninstallAsk": "{addOn} deinstallieren?"
    },
    "useFeature": "{app} (Benötigt für: {features})",
    "useRequired": "{app} (Erforderlich)",
    "useSuggested": "{app} (Empfohlen)",
    "usedBy": "Verwendet von",
    "usedByLine": "Verwendet von {apps}"
  },
  "appAddOns": {
    "alsoUsedBy": "Auch verwendet von {apps}",
    "block": {
      "download": "Laden Sie zuerst {addOn} herunter: Es ist im Add-on-Katalog, aber noch nicht auf diesem Server.",
      "noVersion": "{app} braucht {addOn} {version}, und eine solche Version ist hier nicht verfügbar.",
      "problem": "{addOn} kann nicht mit {app} installiert werden. Der Grund steht in seiner Zeile.",
      "tooOld": "{app} braucht {addOn} {version}.",
      "unavailable": "{app} braucht {addOn}, das hier nicht verfügbar ist.",
      "untick": "{addOn} kann hier nicht mit {app} verwendet werden. Entfernen Sie das Häkchen, um {app} ohne es zu installieren."
    },
    "card": {
      "connect": "Verbinden",
      "connected": "{addOn} mit {app} verbunden",
      "consentConnect": "Es wird mit {app} verbunden.",
      "featureOff": "{features} ist aus: Die Seiten stehen erst in der Seitenleiste, wenn {addOn} installiert und verbunden ist.",
      "install": "Installieren",
      "installed": "{addOn} installiert und mit {app} verbunden",
      "metaAbsent": "Nicht installiert · v{version} · {source}",
      "metaInstalled": "Installiert · v{version} · {source}",
      "metaOld": "Installiert · v{version}",
      "metaUnavailable": "Nicht installiert · {source}",
      "notConnected": "Nicht mit {app} verbunden",
      "openSettings": "Einstellungen öffnen"
    },
    "done": {
      "installed": "Ebenfalls installiert: {names}. {count, plural, one {Die Einstellungen finden Sie} other {Die Einstellungen finden Sie}} unter {addOns}.",
      "updated": "Ebenfalls aktualisiert: {names}. {count, plural, one {Die Einstellungen finden Sie} other {Die Einstellungen finden Sie}} unter {addOns}."
    },
    "download": "Herunterladen",
    "downloading": "Wird heruntergeladen … {pct} %",
    "grant": "{roles} kann seine Einstellungen ändern, die alle Apps teilen, für die es arbeitet.",
    "howTo": "So fügen Sie ein Add-on hinzu",
    "intro": "{app} arbeitet mit {count, plural, one {diesem Add-on} other {diesen Add-ons}}.",
    "meta": "v{version} · {source}",
    "needsFloor": "{app} braucht {version} oder neuer",
    "needsRange": "{app} braucht {range}",
    "orLater": "{version} oder neuer",
    "pill": {
      "feature": "Benötigt für: {features}",
      "required": "Erforderlich",
      "suggested": "Empfohlen"
    },
    "plan": {
      "creates": "Legt {count, plural, one {# Tabelle} other {# Tabellen}} in {connection} an: {tables}"
    },
    "running": {
      "attach": "{addOn} wird verbunden",
      "connected": "verbunden",
      "install": "{addOn} wird installiert",
      "update": "{addOn} wird aktualisiert"
    },
    "shared": "Add-ons werden geteilt. Jede andere App, die Sie installieren, kann sie ebenfalls nutzen.",
    "source": {
      "bundled": "Im Lieferumfang von Adminium",
      "catalog": "Aus dem Add-on-Katalog",
      "none": "Nicht in diesem Adminium enthalten, und der Add-on-Katalog hat keine passende Version",
      "off": "Nicht in diesem Adminium enthalten, und der Add-on-Katalog ist ausgeschaltet",
      "upload": "In dieses Adminium hochgeladen"
    },
    "status": {
      "attached": "Bereits mit {app} verbunden",
      "downloadFirst": "Wird installiert, sobald es aus dem Add-on-Katalog heruntergeladen ist",
      "tooOld": "Installiert v{installed} – {need}",
      "unavailable": "{addOn} ist in diesem Adminium nicht verfügbar",
      "willConnect": "Installiert · v{version} · wird mit {app} verbunden",
      "willInstall": "Wird installiert",
      "wontConnect": "Installiert · v{version} · wird nicht verbunden"
    },
    "stopped": {
      "atAddOns": "Die Installation der benötigten Add-ons ist fehlgeschlagen, daher lief nichts danach."
    },
    "title": "Add-ons",
    "uninstall": {
      "kept": "{addOn} bleibt installiert. Deinstallieren Sie es unter „Add-ons“, wenn nichts anderes es nutzt.",
      "link": "Die Verbindung zu {addOn}"
    },
    "updateToo": "Ebenfalls aktualisieren"
  },
  "featurePage": {
    "ask": "Jemand, der Apps verwaltet, kann es installieren.",
    "body": "Diese Seite funktioniert nur mit {count, plural, one {einem Add-on} other {Add-ons}}, das der App hier noch fehlt, daher steht sie nicht in der Seitenleiste. Sie kehrt zurück, sobald {count, plural, one {es} other {sie}} installiert und mit der App verbunden {count, plural, one {ist} other {sind}}.",
    "open": "Einstellungen der App öffnen",
    "title": "{page} braucht ein Add-on"
  }
} as const;
