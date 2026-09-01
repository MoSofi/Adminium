// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/common.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "common": {
    "dismiss": "Schließen",
    "notifications": "Benachrichtigungen",
    "retry": "Erneut versuchen",
    "undo": "Rückgängig",
    "close": "Schließen",
    "cancel": "Abbrechen",
    "back": "Zurück",
    "loading": "Wird geladen",
    "clearSearch": "Suche löschen",
    "clear": "Leeren",
    "save": "Speichern"
  },
  "auth": {
    "headline": "Machen Sie aus jeder Datenbank ein Dashboard.",
    "description": "Verbinden Sie PostgreSQL, und Adminium erzeugt eine gestaltbare, rechtebewusste Admin-App — ganz ohne Code.",
    "trust": "AGPL-Kern · Selbst gehostet · Ihre Daten bleiben Ihre",
    "signIn": {
      "title": "Willkommen zurück",
      "subtitle": "Melden Sie sich in Ihrem Adminium-Workspace an.",
      "email": "E-Mail",
      "emailInvalid": "Geben Sie eine gültige E-Mail-Adresse ein.",
      "password": "Passwort",
      "passwordRequired": "Geben Sie Ihr Passwort ein.",
      "showPassword": "Passwort anzeigen",
      "hidePassword": "Passwort verbergen",
      "remember": "Angemeldet bleiben",
      "forgot": "Vergessen?",
      "submit": "Anmelden",
      "invalid": "E-Mail oder Passwort ist ungültig.",
      "rateLimited": "Zu viele Versuche — versuchen Sie es in einer Minute erneut.",
      "failed": "Anmeldung fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut."
    },
    "forgot": {
      "title": "Passwort zurücksetzen",
      "email": "E-Mail",
      "emailInvalid": "Geben Sie eine gültige E-Mail-Adresse ein.",
      "submit": "Link zum Zurücksetzen senden",
      "sentTitle": "Prüfen Sie Ihr E-Mail-Postfach",
      "resend": "Erneut senden",
      "back": "Zurück zur Anmeldung",
      "done": "Zurück zur Anmeldung",
      "rateLimited": "Zu viele Anfragen — versuchen Sie es später erneut.",
      "failed": "Etwas ist schiefgelaufen. Versuchen Sie es erneut.",
      "smtpUnconfigured": "Für dieses Adminium ist kein E-Mail-Server konfiguriert, daher kann kein Link zum Zurücksetzen gesendet werden. Bitten Sie eine Administratorin oder einen Administrator, Ihr Passwort zurückzusetzen.",
      "subtitle": "Geben Sie Ihre E-Mail-Adresse ein, und wir senden Ihnen einen Link zum Zurücksetzen.",
      "sentBody": "Wir haben einen Link zum Zurücksetzen an {email} gesendet. Er ist 15 Minuten lang gültig.",
      "resendHint": "Nicht erhalten?"
    },
    "reset": {
      "title": "Neues Passwort festlegen",
      "subtitle": "Mindestens 8 Zeichen.",
      "password": "Neues Passwort",
      "confirm": "Passwort bestätigen",
      "showPassword": "Passwort anzeigen",
      "hidePassword": "Passwort verbergen",
      "strength": "Passwortstärke",
      "weak": "Schwach",
      "fair": "Ausreichend",
      "good": "Gut",
      "strong": "Stark",
      "tooShort": "Verwenden Sie mindestens 8 Zeichen.",
      "submit": "Passwort zurücksetzen",
      "failed": "Zurücksetzen fehlgeschlagen. Versuchen Sie es erneut.",
      "mismatch": "Die Passwörter stimmen nicht überein."
    },
    "otp": {
      "title": "Zwei-Faktor-Authentifizierung",
      "subtitle": "Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.",
      "code": "Einmalcode",
      "recoveryCode": "Wiederherstellungscode",
      "useRecovery": "Gerät verloren? Wiederherstellungscode verwenden",
      "useAuthenticator": "Stattdessen die Authenticator-App verwenden",
      "submit": "Bestätigen",
      "invalid": "Dieser Code hat nicht funktioniert. Versuchen Sie es erneut.",
      "failed": "Bestätigung fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut."
    }
  },
  "nav": {
    "home": "Start",
    "primary": "Hauptbereich",
    "account": "Konto",
    "signOut": "Abmelden",
    "empty": "Sobald eine Datenbank verbunden ist, erscheinen hier Seiten.",
    "connection": {
      "shared": "Gemeinsam",
      "unnamed": "Verbindung"
    },
    "imports": "Daten importieren",
    "exports": "Datenexporte",
    "emailTemplates": "E-Mail-Vorlagen",
    "notificationSettings": "Benachrichtigungseinstellungen",
    "scheduledReports": "Geplante Berichte",
    "group": {
      "workspace": "Arbeitsbereich",
      "library": "Bibliothek",
      "planning": "Planung",
      "people": "Personen",
      "account": "Konto"
    },
    "back": "Zurück",
    "team": "Team",
    "roles": "Rollen & Berechtigungen",
    "audit": "Audit-Log",
    "security": "Passwort & Sitzungen"
  },
  "apps": {
    "frame": {
      "noFrames": "Diese App benötigt einen Browser, der Frames unterstützt."
    }
  },
  "topbar": {
    "search": "Suchen…",
    "notifications": "Benachrichtigungen",
    "notificationsLoading": "Benachrichtigungen werden geladen",
    "notificationsError": "Benachrichtigungen konnten nicht geladen werden.",
    "notificationsEmpty": "Alles erledigt.",
    "theme": "Hell / Dunkel umschalten",
    "userMenu": "Kontomenü",
    "profile": "Profil",
    "preferences": "Einstellungen",
    "studio": "Studio",
    "dataConnections": "Datenverbindungen",
    "workspaceSettings": "Workspace-Einstellungen",
    "signOut": "Abmelden"
  },
  "palette": {
    "dialog": "Befehlspalette",
    "placeholder": "Befehl eingeben oder suchen…",
    "navigate": "Navigation",
    "actions": "Aktionen",
    "askAi": "KI fragen",
    "shortcuts": "Tastaturkürzel",
    "signOut": "Abmelden",
    "themeDark": "Dunkler Modus",
    "themeLight": "Heller Modus",
    "footerNavigate": "navigieren",
    "footerOpen": "auswählen",
    "footerClose": "schließen",
    "recent": "Zuletzt verwendet",
    "searching": "Datensätze werden durchsucht…",
    "records": "Datensätze",
    "empty": "Keine Ergebnisse für „{query}“"
  },
  "shortcuts": {
    "title": "Tastaturkürzel",
    "subtitle": "Schneller arbeiten in ganz Adminium",
    "close": "Schließen",
    "dismiss": "Schließen oder verwerfen",
    "palette": "Befehlspalette öffnen",
    "panel": "Kürzel-Übersicht anzeigen",
    "search": "Suche fokussieren",
    "sidebar": "Seitenleiste umschalten",
    "studio": "Zu Studio wechseln",
    "theme": "Hell / Dunkel umschalten",
    "then": "dann",
    "footerPre": "Drücken Sie",
    "footerPost": ", um diese Übersicht jederzeit zu öffnen."
  },
  "states": {
    "checked": "vor 8 s geprüft",
    "diagnostics": "Diagnose",
    "reference": {
      "label": "Referenz",
      "copy": "Referenz kopieren",
      "copied": "Kopiert",
      "hint": "Geben Sie sie an, wenn Sie das Problem melden — Ihr Server-Log enthält dieselbe ID."
    },
    "notFound": {
      "title": "Seite nicht gefunden",
      "body": "Wir konnten diese Seite nicht finden. Möglicherweise wurde sie verschoben oder der Link ist ungültig.",
      "primary": "Zurück zum Dashboard",
      "secondary": "Support kontaktieren"
    },
    "forbidden": {
      "title": "Sie haben keinen Zugriff",
      "body": "Dieses Dashboard ist eingeschränkt. Bitten Sie eine Administratorin oder einen Administrator des Workspace, Ihnen Zugriff zu gewähren.",
      "primary": "Zugriff anfordern",
      "secondary": "Zurück"
    },
    "error": {
      "title": "Etwas ist schiefgelaufen",
      "body": "Adminium ist bei der Verarbeitung dieser Anfrage auf einen unerwarteten Fehler gestoßen. Die Details stehen im Server-Log.",
      "primary": "Erneut versuchen"
    },
    "dbUnreachable": {
      "title": "Datenbank nicht erreichbar",
      "body": "Wir konnten keine Verbindung zu prod-db herstellen. Ihre Dashboards laufen weiter, sobald die Verbindung wiederhergestellt ist.",
      "primary": "Verbindung erneut versuchen",
      "secondary": "Verbindung bearbeiten",
      "diag": {
        "status": "keine Verbindung (Timeout 10s)",
        "hint": "52.9.14.2 freigeben, dann erneut versuchen"
      }
    },
    "maintenance": {
      "title": "Geplante Wartung",
      "body": "Adminium wird gerade gewartet und ist in Kürze wieder da. Danke für Ihre Geduld.",
      "primary": "Status ansehen"
    },
    "rateLimited": {
      "title": "Anfragelimit erreicht",
      "body": "Zu viele Anfragen in kurzer Zeit. Warten Sie ein paar Minuten und versuchen Sie es erneut.",
      "primary": "Erneut versuchen",
      "secondary": "Zurück"
    },
    "offline": {
      "title": "Sie sind offline",
      "body": "Prüfen Sie Ihre Internetverbindung. Adminium verbindet sich automatisch wieder, sobald Sie online sind.",
      "primary": "Jetzt erneut versuchen",
      "banner": "Sie sind offline — Wiederverbindung läuft…"
    },
    "expiredLink": {
      "title": "Dieser Link ist abgelaufen",
      "body": "Magic-Links zur Anmeldung laufen nach 10 Minuten ab. Fordern Sie einen neuen an, um fortzufahren.",
      "primary": "Neuen Link senden",
      "secondary": "Zurück zur Anmeldung"
    },
    "expiredSession": {
      "title": "Ihre Sitzung ist abgelaufen",
      "body": "Zu Ihrer Sicherheit wurden Sie nach einer Zeit ohne Aktivität abgemeldet. Melden Sie sich an, um dort weiterzumachen, wo Sie aufgehört haben.",
      "primary": "Erneut anmelden"
    },
    "emptyNoSources": {
      "title": "Noch keine Datenquellen",
      "body": "Verbinden Sie eine PostgreSQL-Datenbank und Adminium generiert Ihr erstes Admin-Dashboard.",
      "primary": "Datenbank verbinden",
      "secondary": "Beispieldaten importieren"
    },
    "readOnly": {
      "title": "Nur-Lese-Modus",
      "body": "Sie haben Viewer-Zugriff auf diesen Workspace. Sie können Dashboards erkunden, Bearbeiten und löschende Aktionen sind jedoch deaktiviert.",
      "primary": "Bearbeitungszugriff anfordern",
      "secondary": "Verstanden"
    },
    "suspended": {
      "title": "Dieser Workspace ist gesperrt",
      "body": "Dieser Workspace wurde von einer Administratorin oder einem Administrator gesperrt. Ihre Daten bleiben erhalten — wenden Sie sich an die Inhaberin oder den Inhaber des Workspace, um den Zugriff wiederherzustellen.",
      "primary": "Inhaber kontaktieren",
      "secondary": "Zurück"
    },
    "connectionPaused": {
      "title": "Diese Verbindung ist pausiert",
      "body": "Ein Administrator hat die Datenbank hinter dieser Seite pausiert, deshalb werden gerade keine Daten geladen. Es wurde nichts gelöscht – alles ist wieder da, sobald die Verbindung unter Studio → Datenverbindungen fortgesetzt wird.",
      "secondary": "Zurück"
    }
  },
  "notFound": {
    "title": "Diese Seite ist verschwunden",
    "body": "Die gesuchte Seite existiert nicht oder wurde verschoben. Prüfen Sie die URL oder kehren Sie zu Ihrem Dashboard zurück.",
    "errorLine": "Fehler 404",
    "searchPlaceholder": "Nach einer Seite suchen…",
    "matches": "Passende Seiten",
    "popular": "Beliebte Ziele",
    "goBack": "Zurück",
    "backToDashboard": "Zurück zum Dashboard",
    "noMatches": "Keine Seiten entsprechen „{query}“"
  },
  "page": {
    "invalid": {
      "title": "Die Konfiguration dieser Seite ist ungültig",
      "body": "Das gespeicherte Seitendokument hat die Validierung nicht bestanden und kann nicht dargestellt werden."
    },
    "renderError": {
      "title": "Diese Seite konnte nicht dargestellt werden"
    },
    "tooNew": {
      "title": "Diese Seite benötigt ein neueres Adminium",
      "body": "Diese Seite wurde mit Konfigurationsversion {version} gespeichert, dieser Build versteht aber höchstens Version {latest}. Aktualisieren Sie Adminium, um sie zu öffnen."
    },
    "unknownTemplate": {
      "title": "Unbekannte Seitenvorlage",
      "body": "Diese Seite verwendet eine Vorlage, die dieser Build nicht kennt. Sie stammt womöglich aus einem neueren Adminium oder aus einer nicht installierten Erweiterung."
    }
  },
  "mutation": {
    "created": "Datensatz erstellt",
    "updated": "Datensatz aktualisiert",
    "deleted": "Datensatz gelöscht"
  },
  "undo": {
    "done": "Änderung rückgängig gemacht",
    "failed": "Diese Änderung konnte nicht rückgängig gemacht werden"
  },
  "prefs": {
    "theme": {
      "label": "Design",
      "light": "Hell",
      "dark": "Dunkel",
      "system": "System"
    },
    "accent": {
      "label": "Akzentfarbe",
      "indigo": "Indigo",
      "blue": "Blau",
      "teal": "Petrol",
      "violet": "Violett",
      "rose": "Rosé",
      "red": "Rot",
      "orange": "Orange",
      "black": "Schwarz"
    },
    "density": {
      "label": "Dichte",
      "comfortable": "Komfortabel",
      "compact": "Kompakt"
    },
    "locale": {
      "label": "Sprache",
      "directionNote": "Textrichtung: rechts nach links (wird automatisch durch die Sprache festgelegt)",
      "communityDraft": "Diese Übersetzung ist ein Community-Entwurf — sie wurde noch nicht von einem Muttersprachler geprüft."
    }
  },
  "account": {
    "title": "Konto",
    "subtitle": "Die Identität Ihrer aktuellen Sitzung. Anzeigeeinstellungen und Benachrichtigungen verwalten Sie auf ihren eigenen Seiten.",
    "preferencesLink": "Einstellungen",
    "notificationsLink": "Benachrichtigungseinstellungen",
    "name": "Name",
    "email": "E-Mail",
    "roles": "Rollen",
    "twoFactor": "Zwei-Faktor",
    "on": "Aktiviert",
    "off": "Aus",
    "nameRequired": "Geben Sie Ihren Namen ein.",
    "emailHelper": "Dient zur Anmeldung. Für eine Änderung ist Ihr Passwort erforderlich.",
    "confirmPassword": "Aktuelles Passwort",
    "confirmPasswordHelper": "Bestätigen Sie, dass Sie es sind, bevor sich Ihre Anmeldeadresse ändert.",
    "save": "Änderungen speichern",
    "saveFailed": "Ihr Profil konnte nicht gespeichert werden",
    "saved": "Profil aktualisiert",
    "savedBody": "Ihre neuen Angaben gelten ab sofort im gesamten Workspace. Wenn Sie Ihre E-Mail-Adresse geändert haben, melden Sie sich künftig mit der neuen Adresse an.",
    "accessTitle": "Zugriff",
    "accessSubtitle": "Was dieses Konto darf und wie es seine Identität nachweist.",
    "rolesHelper": "Rollen werden von einer Administratorin oder einem Administrator vergeben und lassen sich nicht im eigenen Konto ändern.",
    "manageTwoFactor": "Verwalten",
    "setUpTwoFactor": "Einrichten",
    "securityLink": "Passwort & Sitzungen",
    "preferences": {
      "title": "Einstellungen",
      "subtitle": "Wie Adminium für Sie aussieht und sich liest — auf diesem und jedem anderen Gerät, an dem Sie sich anmelden.",
      "workspaceDefault": "Workspace-Standard",
      "personal": "Persönlich",
      "usingDefault": "Workspace-Standard wird verwendet ({value})",
      "reset": "Auf Workspace-Standard zurücksetzen",
      "resetFailed": "Diese Einstellung konnte nicht zurückgesetzt werden. Versuchen Sie es erneut.",
      "appliesInstantly": "Änderungen gelten sofort und werden in Ihrem Profil gespeichert."
    }
  },
  "settings": {
    "defaults": {
      "title": "Globale Standards",
      "subtitle": "Workspace-weite Standards für Darstellung und Sprache.",
      "explainer": "Diese Standards gelten für alle Benutzer, sofern sie sie nicht überschreiben. Jeder kann unter Profil → Einstellungen eigene Werte festlegen — persönliche Einstellungen haben für diesen Benutzer immer Vorrang.",
      "appearanceHeading": "Darstellungs-Standards",
      "languageHeading": "Standards für Sprache & Region",
      "adoption": "{following, number} von {total, plural, one {# Benutzer} other {# Benutzern}} folgen diesem Standard.",
      "weekStartNote": "Wochenbeginn und Zahlenformate richten sich nach der Sprache.",
      "save": "Standards speichern",
      "saved": "Workspace-Standards aktualisiert",
      "saveFailed": "Die Workspace-Standards konnten nicht gespeichert werden. Versuchen Sie es erneut.",
      "liveNote": "Beim Speichern wird die Änderung live übertragen — angemeldete Benutzer, die einem Standard folgen, sehen sie ohne Neuladen."
    },
    "notifications": {
      "subtitle": "Wählen Sie, worüber und wie Sie benachrichtigt werden",
      "matrixLabel": "Benachrichtigen bei",
      "rowHeader": "Ereignis",
      "saving": "Wird gespeichert…",
      "saved": "Gespeichert",
      "unavailable": "Noch nicht verfügbar",
      "loading": "Einstellungen werden geladen",
      "errorTitle": "Diese Einstellungen konnten nicht geladen werden",
      "emptyTitle": "Noch nichts zu konfigurieren",
      "emptyBody": "Benachrichtigungsereignisse erscheinen hier, sobald ihre Produzenten ausgeliefert werden.",
      "saveFailed": "Diese Änderung konnte nicht gespeichert werden."
    },
    "translations": {
      "title": "Sprachen & Übersetzungen",
      "subtitle": "Ändern Sie jede Formulierung in Adminium, legen Sie fest, welche Sprachen zur Auswahl stehen, und fügen Sie eigene hinzu.",
      "warning": "Fehlermeldungen und Anmeldetexte lassen sich ebenfalls bearbeiten. Genau die liest man, wenn etwas schiefgeht — ändern Sie sie also mit Bedacht.",
      "editor": {
        "heading": "Übersetzungen bearbeiten"
      },
      "localeLabel": "Sprache",
      "groupLabel": "Bereich",
      "allAreas": "Alle Bereiche",
      "stateLabel": "Anzeigen",
      "state": {
        "all": "Alles",
        "overridden": "Nur angepasste",
        "untranslated": "Nur unübersetzte",
        "stale": "Englisch seitdem geändert"
      },
      "searchLabel": "Suchen",
      "searchPlaceholder": "Schlüssel oder englischer Text",
      "loading": "Texte werden geladen…",
      "noMatches": "Keine Texte entsprechen diesen Filtern.",
      "count": "{total, plural, one {# Text} other {# Texte}}",
      "badge": {
        "custom": "Angepasst",
        "stale": "Englisch geändert",
        "a11y": "Barrierefreier Name"
      },
      "sourceLabel": "Englisches Original",
      "valueLabel": "Übersetzung",
      "save": "Speichern",
      "saved": "Übersetzung gespeichert",
      "resetAction": "Auf eingebauten Text zurücksetzen",
      "reset": "Auf den eingebauten Text zurückgesetzt",
      "locales": {
        "heading": "Verfügbare Sprachen",
        "help": "Schalten Sie eine Sprache aus, um sie aus allen Sprachauswahlen zu entfernen. Wer sie bereits nutzt, behält sie, bis er eine andere wählt."
      },
      "locale": {
        "builtin": "Eingebaut",
        "custom": "Eigene",
        "overrides": "{count, plural, =0 {kein eigener Text} one {# eigener Text} other {# eigene Texte}}",
        "enable": "Einschalten",
        "disable": "Ausschalten",
        "delete": "Löschen",
        "deleted": "Sprache entfernt",
        "deletedDetail": "{users, plural, one {# Person wurde} other {# Personen wurden}} auf den Workspace-Standard zurückgesetzt; {strings, plural, one {# Übersetzung} other {# Übersetzungen}} gelöscht.",
        "deleteFailed": "Diese Sprache konnte nicht entfernt werden",
        "add": "Sprache hinzufügen",
        "added": "Sprache hinzugefügt",
        "create": "Sprache anlegen",
        "id": "Sprachcode",
        "intlTag": "Formatierungsregeln von",
        "native": "Name in der Sprache selbst",
        "english": "Name auf Englisch",
        "dir": "Textrichtung",
        "ltr": "Links nach rechts",
        "rtl": "Rechts nach links",
        "font": "Schrift",
        "latin": "Lateinisch",
        "arabic": "Arabisch",
        "cjk": "Chinesisch / Japanisch / Koreanisch",
        "intlHelp": "Die Formatierungsregeln bestimmen, wie Zahlen, Datumsangaben und Pluralformen behandelt werden. Wählen Sie die nächstliegende Sprache, die sie bereits hat — sie muss nicht zu Ihrem Sprachcode passen."
      }
    }
  },
  "onboarding": {
    "title": "Erste Schritte",
    "subtitle": "Ein paar Schritte, um Ihren Workspace einzurichten.",
    "loading": "Setup-Checkliste wird geladen…",
    "welcome": "Willkommen bei Adminium, {name} 👋",
    "progressBody": "Sie haben {done} von {total} Einrichtungsschritten abgeschlossen. Schließen Sie die übrigen ab, um den vollen Workspace freizuschalten.",
    "completeBody": "Alles erledigt — Ihr Workspace ist vollständig eingerichtet.",
    "ringLabel": "{done} von {total} Schritten abgeschlossen",
    "done": "Erledigt",
    "skip": "Später",
    "goToWorkspace": "Zum Workspace",
    "help": {
      "title": "Brauchen Sie Hilfe?",
      "body": "Wir helfen Ihnen gern beim schnellen Einrichten."
    },
    "steps": {
      "connectDatabase": {
        "title": "Datenbank verbinden",
        "desc": "Verbinden Sie Adminium mit Ihrer Postgres-, MySQL- oder SQLite-Datenbank — eine Nur-Lese-Rolle genügt.",
        "time": "5 Min.",
        "action": "Verbinden"
      },
      "chooseTables": {
        "title": "Tabellen auswählen",
        "desc": "Wählen Sie, welche Tabellen zu Seiten werden — PII wird standardmäßig maskiert.",
        "time": "2 Min.",
        "action": "Auswählen"
      },
      "inviteTeammates": {
        "title": "Teammitglieder einladen",
        "desc": "Holen Sie Ihr Team zum Erkunden und Zusammenarbeiten dazu.",
        "time": "2 Min.",
        "action": "Einladen"
      },
      "workspaceDefaults": {
        "title": "Workspace-Standards festlegen",
        "desc": "Design, Akzent, Dichte und Sprache für alle.",
        "time": "1 Min.",
        "action": "Festlegen"
      }
    },
    "entry": {
      "wayBack": "Erste Schritte · {done}/{total}",
      "dismiss": "Setup-Checkliste ausblenden",
      "continue": "Setup fortsetzen",
      "banner": "Richten Sie Ihren Workspace fertig ein — {done} von {total} Schritten erledigt."
    }
  },
  "views": {
    "baseView": "Alle Datensätze",
    "menuLabel": "Gespeicherte Ansichten",
    "saveAs": "Aktuelle als Ansicht speichern…",
    "updateActive": "„{name}“ aktualisieren",
    "rename": "Umbenennen…",
    "setDefault": "Als Standard festlegen",
    "delete": "Löschen…",
    "saveTitle": "Ansicht speichern",
    "save": "Ansicht speichern",
    "renameTitle": "Ansicht umbenennen",
    "saveName": "Namen speichern",
    "nameLabel": "Ansichtsname",
    "namePlaceholder": "z. B. Diesen Monat aktiv",
    "nameRequired": "Geben Sie einen Namen für diese Ansicht ein.",
    "saveFailed": "Ansicht konnte nicht gespeichert werden.",
    "deleteTitle": "Ansicht löschen",
    "deleteBody": "Dies entfernt die gespeicherte Ansicht. Ihre Daten sind nicht betroffen.",
    "deletePrompt": "Zum Bestätigen den Ansichtsnamen eingeben",
    "deleteConfirm": "Ansicht löschen",
    "savedToast": "Ansicht „{name}“ gespeichert.",
    "updatedToast": "Ansicht „{name}“ aktualisiert.",
    "defaultToast": "„{name}“ ist jetzt die Standardansicht.",
    "deletedToast": "Ansicht „{name}“ gelöscht."
  },
  "builder": {
    "view": "Ansicht",
    "edit": "Bearbeiten",
    "done": "Fertig",
    "addWidget": "Widget hinzufügen",
    "saveLayout": "Layout speichern",
    "saving": "Wird gespeichert …",
    "savedShort": "Gespeichert",
    "options": "Dashboard-Optionen",
    "resetLayout": "Layout zurücksetzen",
    "resetTitle": "Auf das geteilte Layout zurücksetzen?",
    "resetBody": "Dadurch werden deine persönlichen Änderungen entfernt und das Dashboard wiederhergestellt, das alle sehen. Deine Daten sind nicht betroffen.",
    "resetConfirm": "Layout zurücksetzen",
    "resetDone": "Layout auf die geteilte Standardansicht zurückgesetzt.",
    "sharedNote": "Du bearbeitest das geteilte Dashboard, das alle sehen.",
    "personalNote": "Du bearbeitest dein persönliches Layout – nur du siehst diese Änderungen.",
    "savedShared": "Dashboard für alle mit Zugriff gespeichert.",
    "empty": "Dieses Dashboard enthält noch keine Widgets.",
    "emptyAction": "Widget hinzufügen",
    "palette": {
      "title": "Widget hinzufügen",
      "count": "{count} Widgets",
      "searchLabel": "Widgets durchsuchen",
      "searchPlaceholder": "Widgets durchsuchen …",
      "clear": "Suche löschen",
      "noResults": "Keine Widgets passen zu „{query}“.",
      "add": "{name} hinzufügen",
      "added": "{name} hinzugefügt."
    },
    "inspector": {
      "title": "Widget konfigurieren",
      "empty": "Dieses Widget hat keine konfigurierbaren Optionen.",
      "locked": "Gesperrt",
      "lockedHint": "Dieses Feld wird von der Quelle festgelegt und kann hier nicht bearbeitet werden.",
      "selectPlaceholder": "Auswählen …",
      "increment": "Erhöhen",
      "decrement": "Verringern",
      "done": "Fertig"
    },
    "item": {
      "configure": "{name} konfigurieren",
      "duplicate": "{name} duplizieren",
      "remove": "{name} entfernen",
      "removed": "{name} entfernt.",
      "duplicated": "{name} dupliziert.",
      "unboundHint": "Dieses Widget zeigt hier und auf der Live-Seite Beispieldaten. Öffnen Sie „Konfigurieren“, um es mit einer Tabelle zu verbinden.",
      "unbound": "Beispieldaten"
    },
    "families": {
      "kpi": "Kennzahlen",
      "charts": "Diagramme",
      "tables": "Tabellen",
      "feeds": "Feeds",
      "calendar": "Kalender",
      "boards": "Boards",
      "geo": "Karten",
      "media": "Medien",
      "communication": "Kommunikation",
      "forms": "Formulare",
      "chrome": "Navigation",
      "system": "System",
      "domain": "Domäne"
    },
    "versions": "Versionen",
    "versionsEmpty": "Noch keine gespeicherten Versionen",
    "saveAsVersion": "Als Version speichern",
    "saveVersionTitle": "Version speichern",
    "saveVersionBody": "Erstellt einen Schnappschuss des aktuellen Dokuments. Über „Versionen“ jederzeit wiederherstellbar.",
    "versionName": "Versionsname",
    "versionNamePlaceholder": "z. B. Vor der Q3-Preisänderung",
    "discard": "Änderungen verwerfen",
    "discardTitle": "Änderungen verwerfen?",
    "discardBody": "Das Dashboard sieht wieder so aus wie beim Öffnen des Editors. Deine Daten sind nicht betroffen.",
    "discardConfirm": "Änderungen verwerfen",
    "keepEditing": "Weiter bearbeiten",
    "discarded": "Änderungen verworfen.",
    "binding": {
      "addFilter": "Filter hinzufügen",
      "brokenBody": "Sie entspricht keiner Abfrage mehr, die diese Version versteht — das Widget zeigt auf der Live-Seite einen Fehler.",
      "brokenTitle": "Die Abfrage dieses Widgets ist fehlerhaft",
      "bucketColumn": "Datumsspalte",
      "bucketRequired": "Wählen Sie die Spalte, die das Datum enthält.",
      "bucketUnit": "Zeit gruppieren nach",
      "columnNone": "Keine",
      "columnPlaceholder": "Spalte wählen …",
      "connect": "Mit Daten verbinden",
      "edit": "Abfrage bearbeiten",
      "event": {
        "category": "Kategoriespalte (optional)",
        "date": "Startdatum-Spalte",
        "end": "Enddatum-Spalte (optional)",
        "title": "Titelspalte"
      },
      "filterColumnRequired": "Wählen Sie eine Spalte.",
      "filterColumn": "Spalte",
      "filterListHelper": "Werte durch Kommas trennen.",
      "filterOp": "Bedingung",
      "filterValue": "Wert",
      "fn": {
        "avg": "Durchschnitt",
        "countDistinct": "Anzahl eindeutiger Werte",
        "count": "Anzahl der Zeilen",
        "max": "Maximum",
        "min": "Minimum",
        "sum": "Summe"
      },
      "groupByColumns": "Spalten",
      "groupByRequired": "Diese Ansicht benötigt eine Spalte für die Aufschlüsselung.",
      "groupByRows": "Zeilen",
      "groupBy": "Gruppieren nach",
      "incompleteBody": "Füllen Sie die hervorgehobenen Felder aus — eine halbfertige Abfrage würde auf dem Live-Dashboard fehlschlagen.",
      "incompleteTitle": "Diese Abfrage ist nicht fertig",
      "limit": "Maximal abzurufende Zeilen",
      "loadingSchema": "Tabellen werden geladen …",
      "lossyBody": "Teile davon — zusätzliche Messwerte, Sortierungen oder Verknüpfungen mit Seitenfiltern — werden hier nicht angezeigt und gehen beim Speichern verloren.",
      "lossyTitle": "Diese Abfrage geht über diesen Editor hinaus",
      "measureColumnRequired": "Diese Berechnung benötigt eine Spalte.",
      "measureColumn": "Über Spalte",
      "measureFn": "Berechnen",
      "noConnectionBody": "Widgets lassen sich nur auf einer Seite binden, die zu einer Verbindung gehört.",
      "noConnectionTitle": "Diese Seite hat keine Datenbankverbindung",
      "noDateColumns": "Diese Tabelle hat keine Datums- oder Zeitstempelspalte.",
      "noFilters": "Keine Filter — jede Zeile der Tabelle wird gezählt.",
      "noSnapshotBody": "Tabellen und Spalten stammen aus der letzten Introspektion der Verbindung. Führen Sie die Introspektion in Studio aus und öffnen Sie diesen Editor dann erneut.",
      "noSnapshotTitle": "Kein Schema-Schnappschuss für diese Verbindung",
      "op": {
        "between": "liegt zwischen",
        "ilike": "enthält (Groß-/Kleinschreibung egal)",
        "in": "ist eines von",
        "isNull": "ist leer",
        "like": "enthält",
        "notNull": "ist nicht leer"
      },
      "orderAsc": "Älteste / niedrigste zuerst",
      "orderBy": "Sortieren nach",
      "orderDesc": "Neueste / höchste zuerst",
      "orderDir": "Richtung",
      "orderNone": "Datenbankreihenfolge",
      "pickTableFirst": "Wählen Sie eine Tabelle, um ihre Spalten auszuwählen.",
      "removeFilter": "Filter entfernen",
      "remove": "Datenquelle entfernen",
      "save": "Diese Abfrage verwenden",
      "sectionBreakdown": "Aufschlüsselung",
      "sectionColumns": "Spalten",
      "sectionFilters": "Filter",
      "sectionMeasure": "Messwert",
      "sectionRows": "Zeilen",
      "sectionSource": "Quelle",
      "sectionTime": "Zeitachse",
      "sectionWindow": "Zeitraum",
      "selectColumns": "Anzuzeigende Spalten",
      "selectRequired": "Wählen Sie mindestens eine Spalte zum Anzeigen.",
      "shape": {
        "calendarEvents": "Termine mit Datum",
        "categorical": "Ein Wert je Kategorie",
        "distribution": "Die Verteilung einer Spalte",
        "matrix": "Ein Raster aus Zeilen und Spalten",
        "metricDelta": "Eine Zahl, verglichen mit dem Zeitraum davor",
        "multiTimeseries": "Eine Linie pro Kategorie im Zeitverlauf",
        "recordList": "Eine Liste von Zeilen",
        "record": "Eine Zeile",
        "singleMetric": "Eine einzelne Zahl",
        "stream": "Ein Live-Feed aktueller Zeilen",
        "timeseries": "Ein Wert im Zeitverlauf",
        "tree": "Ein Wert je Kategorie, auf zwei Ebenen aufgeteilt",
        "geoPoints": "Ein Wert je Ort oder Region",
        "flows": "Wie viel von einer Kategorie in eine andere fließt",
        "ohlc": "Eröffnung, Hoch, Tief und Schluss je Zeitraum",
        "booleanMap": "Ein An/Aus-Kennzeichen je Schlüssel"
      },
      "shapeHelper": "Eine Änderung hier ändert, welche Abfrageoptionen gelten.",
      "shapeLabel": "Was dieses Widget zeigt",
      "summaryColumns": "{count, plural, one {# Spalte} other {# Spalten}}",
      "summaryFilters": "{count, plural, one {# Filter} other {# Filter}}",
      "tableEmpty": "Keine passende Tabelle.",
      "tablePlaceholder": "Tabellen durchsuchen …",
      "tableRequired": "Wählen Sie eine Tabelle für die Abfrage.",
      "table": "Tabelle oder View",
      "title": "Datenquelle",
      "unbindableBody": "Es zeigt eine Datenform, die die Abfrage-Engine noch nicht erzeugt, und stellt deshalb eigene Beispielinhalte dar.",
      "unbindableTitle": "Dieses Widget kann noch keine Daten abfragen",
      "unboundBody": "Es zeigt Beispielzahlen hier UND auf der Live-Seite. Verbinden Sie es mit einer Tabelle, um echte Daten zu zeigen.",
      "unboundTitle": "Nicht mit Ihren Daten verbunden",
      "unit": {
        "day": "Täglich",
        "hour": "Stündlich",
        "month": "Monatlich",
        "quarter": "Vierteljährlich",
        "week": "Wöchentlich",
        "year": "Jährlich"
      },
      "valueColumnRequired": "Wählen Sie die Spalte, die gemessen werden soll.",
      "valueColumn": "Wertspalte",
      "windowColumn": "Datumsspalte",
      "windowLast": "Letzte",
      "windowNone": "Gesamter Zeitraum",
      "windowRequired": "Für den Vergleich mit dem vorherigen Zeitraum wird eine Datumsspalte benötigt.",
      "windowUnit": {
        "day": "Tage",
        "hour": "Stunden",
        "month": "Monate",
        "quarter": "Quartale",
        "week": "Wochen",
        "year": "Jahre"
      },
      "windowUnitLabel": "Einheit",
      "role": {
        "flagKey": "Schlüsselspalte",
        "flagValue": "An/Aus-Spalte"
      },
      "roleColumnsRequired": "Füllen Sie jede erforderliche Spalte aus und lassen Sie keine Lücke vor einer bereits gefüllten Spalte — diese Spalten werden der Reihe nach gelesen."
    }
  },
  "setup": {
    "title": "Adminium einrichten",
    "subtitle": "Legen Sie den ersten Administrator an. Das geschieht nur einmal.",
    "progress": "Einrichtungsfortschritt",
    "steps": {
      "account": "Administratorkonto",
      "consent": "Datenschutz"
    },
    "account": {
      "name": "Ihr Name",
      "email": "E-Mail",
      "emailInvalid": "Geben Sie eine gültige E-Mail-Adresse ein.",
      "password": "Passwort",
      "passwordHelper": "Mindestens {min} Zeichen.",
      "passwordTooShort": "Verwenden Sie mindestens {min} Zeichen.",
      "confirm": "Passwort bestätigen",
      "passwordMismatch": "Die Passwörter stimmen nicht überein.",
      "continue": "Weiter",
      "strength": "Passwortstärke",
      "strengthLevels": {
        "weak": "Schwach",
        "fair": "Mittel",
        "good": "Gut",
        "strong": "Stark"
      }
    },
    "consent": {
      "telemetry": {
        "title": "Anonyme Nutzungsdaten teilen",
        "description": "Hilft uns zu erkennen, welche Datenbank-Engines Priorität haben. Standardmäßig aus, bis Sie es aktivieren."
      },
      "updates": {
        "title": "Nach neuen Versionen suchen",
        "description": "Zeigt einen Hinweis, wenn eine neue Version — auch ein Sicherheitsfix — verfügbar ist. Dabei wird GitHub nach dem neuesten Release gefragt, wodurch GitHub die IP-Adresse und Version dieser Instanz erfährt. Mehr wird nicht gesendet."
      },
      "sentTitle": "Genau das wird gesendet:",
      "sent": {
        "instanceId": "Eine zufällige Instanz-ID (eine hier erzeugte UUID; nicht aus Ihrem Namen, Host oder Ihrer Datenbank abgeleitet)",
        "version": "Die Adminium-Version dieser Instanz",
        "engines": "Welche Datenbank-Engine-Typen verbunden sind (z. B. „postgres“) — nur die Typen"
      },
      "neverTitle": "Wird niemals gesendet:",
      "never": {
        "schema": "Ihr Schema — keine Tabellen-, Spalten- oder Enum-Namen",
        "rows": "Ihre Daten — niemals auch nur eine Zeile",
        "connections": "Verbindungszeichenfolgen, Hostnamen oder Zugangsdaten",
        "people": "E-Mail-Adressen, Namen oder IDs von Benutzern",
        "llm": "KI-Prompts oder Lauf-Inhalte"
      },
      "reversible": "Beides ist standardmäßig aus und lässt sich später jederzeit in den Einstellungen ändern.",
      "back": "Zurück",
      "finish": "Administratorkonto anlegen"
    },
    "error": {
      "alreadyCompleted": "Diese Instanz wurde bereits eingerichtet. Melden Sie sich mit dem vorhandenen Administratorkonto an.",
      "rejected": "Der Server hat diese Angaben abgelehnt. Prüfen Sie E-Mail und Passwort und versuchen Sie es erneut.",
      "failed": "Einrichtung fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut."
    }
  },
  "about": {
    "title": "Über Adminium",
    "subtitle": "Version, Lizenz und wo der Quellcode dieser Instanz liegt.",
    "version": "Version",
    "license": "Lizenz",
    "metaStore": "Meta-Speicher",
    "node": "Node.js",
    "engine": {
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "licenseCard": {
      "title": "Frei und quelloffen",
      "body": "Adminium steht unter der GNU Affero General Public License v3.0. Sie dürfen es ausführen, untersuchen, verändern und weitergeben. Wenn Sie eine veränderte Fassung anderen über ein Netzwerk anbieten, verlangt die AGPL, dass Sie ihnen auch deren Quellcode anbieten."
    },
    "viewLicense": "Lizenz lesen",
    "viewSource": "Quellcode herunterladen",
    "updates": {
      "title": "Aktualisierungen",
      "description": "Ob diese Instanz nach neuen Versionen sucht."
    },
    "update": {
      "disabled": "Die Update-Prüfung ist aus, daher kontaktiert diese Instanz GitHub nie. Aktivieren Sie sie in den Einstellungen, um von neuen Versionen zu erfahren.",
      "current": "Sie nutzen die neueste Version.",
      "available": "Adminium {version} ist verfügbar",
      "availableBody": "Sie nutzen derzeit {version}.",
      "viewRelease": "Release-Notes ansehen"
    },
    "desktop": {
      "unknown": "Unbekannt",
      "appVersion": "App-Version",
      "serverVersion": "Server-Version",
      "migration": "Meta-Store-Migration",
      "electron": "Electron",
      "chromium": "Chromium",
      "runtimeNode": "Node-Laufzeit",
      "system": {
        "title": "System"
      },
      "dataDir": "Datenverzeichnis",
      "reveal": "Im Ordner anzeigen",
      "secret": {
        "title": "Geheimnisspeicher",
        "safe": "Von Ihrem Betriebssystem verschlüsselt",
        "plainWarning": "Auf diesem Computer ist kein System-Schlüsselbund verfügbar, daher wird Ihr Adminium-Geheimnis unverschlüsselt auf der Festplatte gespeichert. Jeder, der die Dateien dieses Rechners lesen kann, kann es lesen. Richten Sie einen Anmelde-Schlüsselbund (oder einen Linux-Secret-Service) ein und starten Sie Adminium neu, um es zu schützen."
      },
      "updates": {
        "title": "Updates",
        "mode": {
          "notify": "Über neue Versionen benachrichtigen",
          "manual": "Nur wenn ich prüfe",
          "disabled": "Aus (offline)"
        },
        "disabledBody": "Automatische Updates sind aus (offline). Installieren Sie neue Versionen manuell.",
        "check": "Nach Updates suchen",
        "checking": "Wird geprüft…",
        "lastChecked": "Zuletzt geprüft {when}",
        "available": "Version {version} ist verfügbar",
        "none": "Sie verwenden die neueste Version.",
        "unavailable": "Updates sind in dieser Installation deaktiviert.",
        "error": "Nach Updates konnte nicht gesucht werden.",
        "download": "Update herunterladen",
        "downloading": "Wird heruntergeladen… {percent} %",
        "downloaded": "Version {version} ist installationsbereit",
        "restart": "Zum Installieren neu starten",
        "downloadError": "Der Download wurde nicht abgeschlossen. Sie können es erneut versuchen.",
        "toast": {
          "available": "Eine neue Version von Adminium ist verfügbar",
          "view": "Anzeigen",
          "downloaded": "Update installationsbereit",
          "restart": "Jetzt neu starten"
        }
      },
      "legal": {
        "title": "Lizenzen",
        "agpl": "Adminium Desktop ist freie Software unter der GNU Affero General Public License v3.0.",
        "viewLicense": "Lizenz anzeigen",
        "licenseTitle": "GNU Affero General Public License v3.0",
        "licenseUnavailable": "Die mitgelieferte Lizenzdatei ist in diesem Build nicht verfügbar.",
        "viewNotices": "Drittanbieter-Lizenzen",
        "noticesTitle": "Drittanbieter-Hinweise",
        "noticesUnavailable": "Drittanbieter-Hinweise werden beim Paketieren der App erzeugt und sind in diesem Build nicht verfügbar.",
        "source": "Quellcode",
        "close": "Schließen"
      },
      "telemetry": {
        "title": "Anonyme Nutzungsdaten",
        "label": "Anonyme Nutzungsdaten teilen",
        "description": "Hilft uns zu entscheiden, welche Datenbank-Engines wir priorisieren. Aus, sofern Sie es nicht aktivieren; es werden niemals Schema, Daten oder personenbezogene Informationen gesendet.",
        "saveFailed": "Diese Einstellung konnte nicht gespeichert werden. Bitte erneut versuchen."
      },
      "diagnostics": {
        "title": "Diagnose",
        "description": "Details, die bei einer Problemmeldung helfen. Kein Schema und keine Daten sind enthalten.",
        "copy": "Diagnoseinfo kopieren",
        "copied": "Kopiert",
        "showLogs": "Protokolle anzeigen",
        "dataSize": "Datengröße: {size}"
      }
    }
  },
  "apiKeys": {
    "title": "API-Schlüssel & Tokens",
    "subtitle": "Programmatischen Zugriff auf Ihren Workspace verwalten.",
    "createButton": "Schlüssel erstellen",
    "copy": "Kopieren",
    "copied": "Kopiert",
    "revoke": "Schlüssel widerrufen",
    "neverUsed": "Nie verwendet",
    "lastUsed": "Zuletzt verwendet {since}",
    "scopesOverflow": "+{count} weitere",
    "status": {
      "active": "Aktiv",
      "revoked": "Widerrufen",
      "expired": "Abgelaufen"
    },
    "list": {
      "title": "Schlüssel",
      "activeCount": "{count, plural, one {# aktiver Schlüssel} other {# aktive Schlüssel}}"
    },
    "empty": {
      "title": "Noch keine API-Schlüssel",
      "body": "Erstellen Sie einen, um die Adminium-API aus eigenem Code aufzurufen."
    },
    "revealed": {
      "title": "Neuer Schlüssel erstellt",
      "body": "Kopieren Sie ihn jetzt — Sie werden ihn nie wieder sehen können."
    },
    "rolesUnavailable": {
      "title": "Rollen sind für Sie nicht sichtbar",
      "body": "Einen Schlüssel zu erstellen heißt, die Rolle zu wählen, mit der er handelt — und Ihr Konto darf die Rollenliste nicht lesen. Bitten Sie eine Administratorin um die Berechtigung „Rollen verwalten“."
    },
    "quickStart": {
      "title": "Schnellstart",
      "body": "Authentifizieren Sie Anfragen mit Ihrem Schlüssel im Authorization-Header."
    },
    "create": {
      "title": "API-Schlüssel erstellen",
      "description": "Der Schlüssel handelt mit den Berechtigungen der gewählten Rolle.",
      "name": "Name",
      "namePlaceholder": "z. B. Analytics-Pipeline",
      "role": "Rolle",
      "roleHelper": "Wählen Sie die Rolle mit den geringsten Rechten, die ausreicht.",
      "expires": "Läuft ab",
      "expiresHelper": "Leer lassen für einen Schlüssel, der nie abläuft.",
      "submit": "Schlüssel erstellen",
      "failed": "Schlüssel konnte nicht erstellt werden"
    },
    "revokeConfirm": {
      "title": "API-Schlüssel widerrufen",
      "body": "Jeder Code, der die API noch mit „{name}“ aufruft, schlägt ab sofort fehl. Das lässt sich nicht rückgängig machen.",
      "prompt": "Geben Sie „{name}“ ein, um zu bestätigen",
      "confirm": "Schlüssel widerrufen"
    }
  },
  "changelog": {
    "title": "Änderungsprotokoll",
    "subtitle": "Produkt-Updates & Releases.",
    "allReleases": "Alle Releases",
    "tag": {
      "new": "Neu",
      "improved": "Verbessert",
      "fixed": "Behoben",
      "security": "Sicherheit"
    },
    "filter": {
      "all": "Alle",
      "label": "Änderungen nach Typ filtern"
    },
    "empty": {
      "title": "Nichts unter diesem Filter",
      "body": "Bisher enthielt kein Release eine Änderung dieser Art.",
      "clear": "Alle Änderungen anzeigen"
    }
  },
  "kb": {
    "title": "Wissensdatenbank",
    "subtitle": "{count, plural, one {# Anleitung} other {# Anleitungen}} · vollständige Doku unter docs.adminium.dev",
    "openDocs": "Doku öffnen",
    "browse": "Nach Thema stöbern",
    "hero": {
      "title": "Wie können wir helfen?",
      "subtitle": "Anleitungen, API-Doku und Fehlerbehebung durchsuchen.",
      "placeholder": "Wissensdatenbank durchsuchen…",
      "label": "Wissensdatenbank durchsuchen",
      "clear": "Suche leeren"
    },
    "category": {
      "start": "Erste Schritte",
      "connect": "Daten verbinden",
      "api": "API & Entwicklung",
      "security": "Sicherheit & Zugriff",
      "selfhost": "Self-Hosting",
      "trouble": "Fehlerbehebung",
      "count": "{count, plural, one {# Artikel} other {# Artikel}}",
      "selected": "Gefiltert"
    },
    "list": {
      "all": "Alle Anleitungen",
      "clear": "Filter zurücksetzen"
    },
    "empty": {
      "title": "Keine Anleitung passt zu Ihrer Suche",
      "body": "Versuchen Sie ein anderes Wort oder durchsuchen Sie die vollständige Dokumentation auf docs.adminium.dev.",
      "openDocs": "Doku öffnen"
    },
    "article": {
      "install": {
        "title": "Adminium installieren",
        "excerpt": "Aus einem Quell-Checkout oder per docker run starten und in einer Minute beim Ersteinrichtungs-Assistenten sein."
      },
      "firstAdmin": {
        "title": "Ersten Super-Admin anlegen",
        "excerpt": "Was der Ersteinrichtungs-Assistent abfragt und warum er nur einmal laufen kann."
      },
      "connectDb": {
        "title": "Ihre erste Datenbank verbinden",
        "excerpt": "Adminium auf PostgreSQL, MySQL oder SQLite richten und eine Admin-App generieren."
      },
      "schemaFile": {
        "title": "Aus einer Schemadatei generieren",
        "excerpt": "Ein Prisma-Schema, eine Django-models.py, eine Rails-schema.rb oder einen .sql-Dump hochladen — ganz ohne Verbindung."
      },
      "readOnly": {
        "title": "Eine Nur-Lese-Rolle verwenden",
        "excerpt": "Die Introspektion liest nur Schema-Metadaten. Geben Sie Adminium so wenig Rechte wie möglich."
      },
      "apiKeys": {
        "title": "Authentifizierung mit API-Schlüsseln",
        "excerpt": "Schlüssel erstellen und widerrufen — und warum ein Schlüssel Ihnen nur ein einziges Mal gezeigt wird."
      },
      "rest": {
        "title": "REST-API-Referenz",
        "excerpt": "Jeder Endpunkt der generierten App, mit Request- und Response-Formaten."
      },
      "manifest": {
        "title": "Das Seiten-Manifest",
        "excerpt": "Wie eine Seite als Konfiguration beschrieben wird und wie Sie eine von Hand bearbeiten."
      },
      "roles": {
        "title": "Rollen & Berechtigungen",
        "excerpt": "Viewer, Editor und Admin vergeben — und eigene Rollen aus der Berechtigungsmatrix bauen."
      },
      "audit": {
        "title": "Das Audit-Log lesen",
        "excerpt": "Wer hat was geändert, wann und von wo."
      },
      "secrets": {
        "title": "Wie Adminium Ihre Geheimnisse speichert",
        "excerpt": "Verbindungsdaten werden mit ADMINIUM_SECRET verschlüsselt gespeichert. API-Schlüssel werden gehasht."
      },
      "docker": {
        "title": "Self-Hosting mit Docker",
        "excerpt": "Das offizielle Image, docker-compose und der Betrieb einer separaten Meta-Datenbank."
      },
      "backup": {
        "title": "Eine Instanz sichern und umziehen",
        "excerpt": "export-zip bündelt Ihre Serverkonfiguration; beim Import wird dieselbe Einrichtung andernorts nachgespielt."
      },
      "telemetry": {
        "title": "Telemetrie und Update-Prüfungen",
        "excerpt": "Beides ist opt-in und standardmäßig aus. Was gesendet wird, wenn Sie es einschalten."
      },
      "connectionFails": {
        "title": "Eine Datenbankverbindung schlägt fehl",
        "excerpt": "Lesen Sie die Diagnosekarte: Host, Port, TLS — und die IP, die Ihre Datenbank zulassen muss."
      },
      "missingTables": {
        "title": "Nach der Introspektion fehlen Tabellen",
        "excerpt": "Schema-Sichtbarkeit, ausgeschlossene Tabellen und ein erneuter Generierungslauf."
      }
    }
  },
  "desktop": {
    "menu": {
      "file": "Datei",
      "fileNewDatabase": "Neue lokale Datenbank…",
      "fileOpenSqlite": "SQLite-Datei öffnen…",
      "fileBackupNow": "Jetzt sichern…",
      "fileRestore": "Aus Sicherung wiederherstellen…",
      "edit": "Bearbeiten",
      "view": "Ansicht",
      "window": "Fenster",
      "help": "Hilfe",
      "helpDocs": "Adminium-Dokumentation",
      "helpShortcuts": "Tastaturkürzel",
      "helpLogs": "Protokolle anzeigen",
      "helpCheckForUpdates": "Nach Updates suchen…",
      "helpAbout": "Über Adminium"
    },
    "settings": {
      "explainer": "Diese Einstellungen gelten nur für die Adminium-App auf diesem Computer. Sie werden auf diesem Gerät gespeichert, nicht in Ihrem Workspace.",
      "title": "Desktop-Einstellungen"
    },
    "security": {
      "heading": "Anmeldung"
    },
    "requireLogin": {
      "label": "Anmeldung auf diesem Gerät verlangen",
      "description": "Adminium meldet Sie auf diesem Computer normalerweise automatisch an. Aktivieren Sie diese Option, um bei jedem Start nach Ihrem Passwort zu fragen — sinnvoll, wenn andere Personen diesen Computer nutzen können. Die Änderung gilt ab dem nächsten Start von Adminium.",
      "savedOn": "Beim nächsten Start ist eine Anmeldung erforderlich",
      "savedOff": "Adminium überspringt die Anmeldung auf diesem Computer",
      "saveFailed": "Einstellung konnte nicht gespeichert werden. Bitte erneut versuchen."
    },
    "chip": {
      "local": "Lokal",
      "lanShare": "Lokal · Im Netzwerk freigegeben",
      "remoteDb": "Lokal + Remote-Datenbank",
      "remoteDbOffline": "Remote-Datenbank offline",
      "remoteDbOfflineDetail": "{names} ist nicht erreichbar. Seiten dieser Verbindungen zeigen einen Wiederverbindungs-Status."
    },
    "lan": {
      "heading": "Im lokalen Netzwerk freigeben",
      "label": "Anderen Geräten in diesem Netzwerk die Nutzung von Adminium erlauben",
      "description": "Andere Computer, Tablets und Telefone im selben Netzwerk können Adminium im Browser öffnen und sich mit ihrem eigenen Konto anmelden. Adminium muss auf diesem Computer geöffnet bleiben, damit sie es erreichen.",
      "savedOn": "Im lokalen Netzwerk freigegeben",
      "savedOff": "Freigabe beendet — Adminium läuft wieder nur auf diesem Computer",
      "saveFailed": "Netzwerkfreigabe konnte nicht geändert werden",
      "noUsers": "Sie sind die einzige Person mit einem Konto, deshalb kann sich sonst noch niemand anmelden. Die Freigabe funktioniert trotzdem — Sie müssen nur Personen einladen, bevor sie sie nutzen können.",
      "usersUnknown": "Adminium konnte nicht prüfen, wer sonst noch ein Konto auf diesem Computer hat. Die Freigabe funktioniert weiterhin, und jede Person mit einem Konto kann sich anmelden — nur diese Prüfung ist fehlgeschlagen.",
      "acknowledge": "Verstanden — ich lade als Nächstes Personen ein",
      "port": "Port",
      "portHelper": "Standard {port}",
      "portInvalid": "Verwenden Sie eine Zahl zwischen 1024 und 65535.",
      "applyPort": "Port ändern",
      "portInUse": "Port {port} wird bereits von einem anderen Programm verwendet.",
      "portInUseHint": "Es wurde nichts geändert — die Freigabe ist weiterhin aus.",
      "portInUseNoSuggestion": "Es wurde nichts geändert. Versuchen Sie einen anderen Port.",
      "tryPort": "{port} versuchen",
      "urlsHeading": "Auf einem anderen Gerät öffnen",
      "noUrls": "Dieser Computer ist gerade mit keinem Netzwerk verbunden, deshalb gibt es keine Adresse zum Teilen. Verbinden Sie sich mit dem WLAN oder stecken Sie ein Kabel ein, dann füllt sich diese Liste.",
      "copyUrl": "Kopieren",
      "sessions": "{count, plural, =0 {Keine Geräte aus diesem Netzwerk angemeldet} one {# Gerät aus diesem Netzwerk angemeldet} other {# Geräte aus diesem Netzwerk angemeldet}}",
      "sessionsUnknown": "Verbundene Geräte werden geprüft…",
      "pending": "Freigabe wird gestartet…",
      "mismatch": "Adminium ist in diesem Netzwerk weiterhin erreichbar",
      "mismatchBody": "Die Freigabe ist ausgeschaltet, aber der Server hat das Netzwerk noch nicht freigegeben. Starten Sie Adminium neu, um sie zu schließen.",
      "transportTitle": "Der Datenverkehr in Ihrem lokalen Netzwerk ist nicht verschlüsselt.",
      "transportBody": "Geben Sie nur in Netzwerken frei, denen Sie vertrauen. Nutzen Sie für den Fernzugriff Adminium self-host hinter HTTPS.",
      "firewall": "Beim ersten Freigeben fragt Ihr Betriebssystem, ob eingehende Verbindungen erlaubt werden sollen — wählen Sie Zulassen, sonst können andere Geräte Adminium nicht erreichen.",
      "manageTeam": "Benutzer & Rollen verwalten"
    },
    "setup": {
      "title": "Willkommen bei Adminium",
      "subtitle": "Vier kurze Schritte und Adminium hat aus Ihrer Datenbank eine Admin-App gebaut. Alles bleibt auf diesem Computer.",
      "progress": "Einrichtungsfortschritt",
      "back": "Zurück",
      "continue": "Weiter",
      "createAccount": "Konto erstellen und fortfahren",
      "step": {
        "location": "Willkommen",
        "database": "Ihre erste Datenbank",
        "account": "Ihr Konto",
        "generate": "Generieren"
      },
      "dataDir": {
        "heading": "Wo soll Adminium Ihre Daten speichern?",
        "description": "Ihre Datenbanken, Einstellungen und Backups liegen alle in diesem Ordner. Alles bleibt auf diesem Computer — nichts wird irgendwohin hochgeladen.",
        "label": "Datenordner",
        "loading": "Aktueller Speicherort wird gelesen…",
        "pending": "Adminium startet beim Fortfahren neu, um in diesen Ordner zu wechseln.",
        "change": "Ändern…",
        "revert": "Rückgängig",
        "dialogTitle": "Wählen Sie, wo Adminium Ihre Daten speichert",
        "cloudSyncTitle": "Dieser Ordner wird mit der Cloud synchronisiert",
        "cloudSyncWarning": "Adminium speichert seine Daten in SQLite-Dateien. {provider} synchronisiert Dateien in „{folder}“, indem es sie im Hintergrund kopiert — das kann eine geöffnete Datenbank beschädigen und ohne Warnung Daten vernichten. Wählen Sie einen Ordner außerhalb von {provider}.",
        "chooseAnother": "Anderen Ordner wählen",
        "useAnyway": "Trotzdem verwenden — ich akzeptiere das Risiko",
        "unusableTitle": "Adminium kann diesen Ordner nicht verwenden",
        "failed": "Adminium konnte diesen Ordner nicht verwenden."
      },
      "source": {
        "heading": "Woraus soll Adminium bauen?",
        "description": "Adminium liest das Schema einer Datenbank und generiert daraus eine Admin-App. Weitere Datenbanken können Sie später hinzufügen.",
        "groupLabel": "Datenbankquelle",
        "local": {
          "title": "Neue lokale Datenbank erstellen",
          "description": "Beginnen Sie bei null oder mit einer Schemadatei, die Sie bereits haben. Die Datenbank wird in Ihrem Datenordner angelegt.",
          "name": "Datenbankname",
          "namePlaceholder": "Betrieb",
          "nameUnusable": "Verwenden Sie mindestens einen Buchstaben oder eine Ziffer — daraus wird der Dateiname gebildet.",
          "fileHelper": "Erstellt {file}",
          "schemaLabel": "Beginnen mit",
          "blank": "Leer",
          "fromFile": "Einer Schemadatei",
          "schemaFile": "Schemadatei",
          "schemaFileHelper": ".sql, pg_dump, Prisma, Drizzle, TypeORM, Sequelize, schema.rb, Django oder Adminium-JSON. Adminium übersetzt es nach SQLite.",
          "placeholder": "Platzhaltereinträge automatisch erzeugen",
          "placeholderHelper": "Sie haben ein Schema ohne Zeilen importiert. Befüllen Sie jede Tabelle mit realistischen Beispieldaten, damit Ihre Dashboards und Diagramme sofort etwas anzeigen."
        },
        "openSqlite": {
          "title": "Vorhandene SQLite-Datei öffnen",
          "description": "Richten Sie Adminium auf eine .sqlite-Datei auf diesem Computer. Sie wird dort geöffnet, wo sie liegt — nichts wird kopiert oder verschoben.",
          "browse": ".sqlite-Datei auswählen…",
          "change": "Andere Datei auswählen…",
          "networkTitle": "Diese Datei liegt auf einer Netzwerkfreigabe",
          "networkBody": "Die Sperrmechanik von SQLite ist über Netzwerkfreigaben unzuverlässig, und eine abbrechende Verbindung mitten im Schreibvorgang kann die Datenbank beschädigen. Eine Kopie auf der lokalen Festplatte dieses Computers ist sicherer."
        },
        "remote": {
          "title": "Mit einer Server-Datenbank verbinden",
          "description": "PostgreSQL oder MySQL. Erfordert eine erreichbare Netzwerkdatenbank; Adminiums eigene Tabellen bleiben trotzdem auf diesem Computer.",
          "networkNote": "Erfordert eine erreichbare Netzwerkdatenbank",
          "metaNote": "Adminiums eigene Tabellen — Ihre Seiten, Einstellungen und Anmeldung — bleiben in jedem Fall im Datenordner auf diesem Computer.",
          "engine": "Engine",
          "name": "Verbindungsname",
          "namePlaceholder": "Produktion",
          "dsn": "Verbindungszeichenfolge",
          "dsnHelper": "Adminium testet dies beim Verbinden. Verwenden Sie eine Nur-Lese-Rolle, wenn Sie nur Dashboards möchten."
        },
        "demo": {
          "title": "Demo-Datenbank erkunden",
          "description": "Eine fertige Team-Betriebsdatenbank, damit Sie sehen, was Adminium baut, bevor Sie es auf Ihre eigenen Daten richten. Löschen Sie sie, wann immer Sie möchten.",
          "unavailable": "Dieses Build enthält die Demodaten nicht, es gibt also nichts zu laden. Wählen Sie eine der Optionen oben."
        }
      },
      "account": {
        "heading": "Konto erstellen",
        "description": "Dies ist das Administratorkonto für diese Adminium-Installation. Das Passwort schützt Ihre Backups und alle, mit denen Sie im Netzwerk teilen — bei jedem Start wird es nicht abgefragt.",
        "name": "Ihr Name",
        "email": "E-Mail",
        "password": "Passwort",
        "passwordHelper": "Mindestens {min} Zeichen.",
        "confirm": "Passwort bestätigen",
        "strength": "Passwortstärke",
        "strengthLevels": {
          "weak": "Schwach",
          "fair": "Mittel",
          "good": "Gut",
          "strong": "Stark"
        },
        "singleUser": "Anmeldung auf diesem Computer überspringen",
        "singleUserHelper": "Adminium meldet Sie hier automatisch an. Schalten Sie dies aus, wenn andere Personen diesen Computer nutzen. Sie können es später unter Einstellungen → Desktop ändern.",
        "locale": "Sprache",
        "theme": "Darstellung",
        "alreadyExists": "Diese Adminium-Installation hat bereits ein Konto. Melden Sie sich stattdessen damit an.",
        "failed": "Adminium konnte dieses Konto nicht erstellen."
      },
      "generate": {
        "creating": "Ihre Datenbank wird eingerichtet…",
        "introspecting": "Ihr Schema wird gelesen — Tabellen, Spalten und Beziehungen…",
        "working": "Wird ausgeführt…",
        "offlineNote": "All dies geschieht auf diesem Computer.",
        "failedTitle": "Adminium konnte diese Datenbank nicht einrichten",
        "failedBody": "Etwas ist schiefgelaufen. Versuchen Sie es erneut.",
        "retry": "Erneut versuchen"
      }
    }
  },
  "capabilities": {
    "heading": "App-Berechtigungen",
    "description": "Von Ihnen installierte Apps können den Zugriff auf die Hardware dieses Computers anfordern. Sie genehmigen jede einzeln und können den Zugriff jederzeit widerrufen.",
    "grantedTo": "Erlaubt für {app}",
    "status": {
      "available": "Verfügbar",
      "stub": "Noch nicht verfügbar",
      "unavailable": "Nicht verfügbar"
    },
    "allow": {
      "action": "Erlauben…"
    },
    "revoke": {
      "action": "Widerrufen",
      "saved": "Zugriff widerrufen",
      "failed": "Zugriff konnte nicht widerrufen werden. Bitte erneut versuchen."
    },
    "grant": {
      "saved": "Zugriff erlaubt",
      "failed": "Zugriff konnte nicht erlaubt werden. Bitte erneut versuchen."
    },
    "catalog": {
      "printerEscpos": {
        "name": "Bondrucker (ESC/POS)",
        "scope": "Auf Bondruckern drucken und eine angeschlossene Kassenschublade öffnen"
      }
    },
    "consent": {
      "title": "{app} erlauben?",
      "subtitle": "{app} möchte die Hardware dieses Computers verwenden.",
      "willAllow": "Dies erlaubt {app}:",
      "revokeNote": "Sie können dies jederzeit unter Einstellungen → Desktop widerrufen. Erlauben Sie nur Apps, denen Sie vertrauen.",
      "deny": "Nicht jetzt",
      "approve": "Erlauben"
    }
  },
  "emailTemplates": {
    "title": "E-Mail-Vorlagen",
    "subtitle": "Transaktions- und Lifecycle-E-Mails, die dieser Workspace versendet.",
    "search": "Vorlagen durchsuchen…",
    "loadFailed": "Vorlagen konnten nicht geladen werden",
    "empty": "Noch keine E-Mail-Vorlagen",
    "emptyBody": "Vorlagen erscheinen hier, sobald der Server welche anlegt oder Sie welche erstellen.",
    "noMatches": "Keine passenden Vorlagen",
    "noMatchesBody": "Versuchen Sie eine andere Suche.",
    "live": "Aktiv",
    "disabled": "Deaktiviert",
    "name": "Vorlagenname",
    "subject": "Betreff",
    "enabled": "Aktiviert"
  },
  "board": {
    "addCard": "Karte hinzufügen",
    "compose": {
      "placeholder": "Kartentitel…",
      "add": "Hinzufügen",
      "cancel": "Abbrechen"
    },
    "empty": {
      "title": "Keine Board-Spalten",
      "body": "Fügen Sie ein Statusfeld hinzu, um Karten in Spalten zu gruppieren."
    }
  },
  "calendar": {
    "dateRange": "Zeitraum",
    "compose": {
      "placeholder": "Termintitel…",
      "add": "Hinzufügen",
      "cancel": "Abbrechen",
      "open": "Termin hinzufügen"
    },
    "agenda": {
      "empty": "Nichts geplant"
    }
  },
  "scheduler": {
    "prevWeek": "Vorherige Woche",
    "nextWeek": "Nächste Woche",
    "week": "Woche",
    "month": "Monat",
    "resource": "Ressource",
    "coverage": "Abdeckung",
    "addShift": "Schicht hinzufügen",
    "shiftCount": "{n} Schichten"
  },
  "planning": {
    "drawer": {
      "close": "Schließen",
      "loading": "Datensatz wird geladen",
      "error": "Dieser Datensatz konnte nicht geladen werden."
    }
  },
  "files": {
    "uploadsUnavailable": "Uploads sind auf dieser Seite noch nicht verfügbar."
  },
  "chat": {
    "messageSent": "Nachricht gesendet",
    "sendFailed": "Die Nachricht konnte nicht gesendet werden."
  },
  "templates": {
    "crud": {
      "title": "Datensätze",
      "description": "Eine durchsuchbare Tabelle mit Anlegen, Bearbeiten und Löschen."
    },
    "dashboard": {
      "title": "Dashboard",
      "description": "Ein Raster aus Diagrammen und Kennzahlen, das Sie selbst anordnen."
    },
    "board": {
      "title": "Board",
      "description": "Karten in Spalten nach Status, per Drag-and-drop verschiebbar."
    },
    "calendar": {
      "title": "Kalender",
      "description": "Datensätze nach Datum in einem Monats- oder Wochenraster."
    },
    "scheduler": {
      "title": "Dienstplan",
      "description": "Wer was tut – als Zeitleiste pro Person."
    },
    "logViewer": {
      "title": "Protokolle",
      "description": "Dichte, filterbare Ereigniszeilen mit Detail-Trace."
    },
    "files": {
      "title": "Dateien",
      "description": "Dateien und Ordner als durchsuchbare Bibliothek."
    },
    "chat": {
      "title": "Chat",
      "description": "Unterhaltungen in Threads mit Nachrichtenverlauf."
    },
    "builder": {
      "title": "Editor",
      "description": "Eine Drag-and-drop-Fläche für Dokumente und Vorlagen."
    },
    "wizard": {
      "title": "Assistent",
      "description": "Eine geführte Schrittfolge für eine Aufgabe."
    },
    "settings": {
      "title": "Einstellungen",
      "description": "Gruppierte Einstellungszeilen mit Schaltern und Feldern."
    },
    "directory": {
      "title": "Verzeichnis",
      "searchPlaceholder": "Personen suchen…",
      "allFilter": "Alle",
      "clearFilters": "Filter zurücksetzen",
      "detailTitle": "Person",
      "emptyTitle": "Noch keine Personen",
      "emptyBody": "Personen erscheinen hier, sobald Zeilen in der Tabelle ankommen.",
      "noMatchesTitle": "Keine passenden Personen",
      "noMatchesBody": "Versuchen Sie eine andere Suche oder entfernen Sie einen Filter.",
      "errorTitle": "Dieses Verzeichnis konnte nicht geladen werden",
      "loading": "Personen werden geladen",
      "memberCount": "{count} Personen",
      "description": "Personen als Karten, mit Organigramm der Berichtswege."
    },
    "masterDetail": {
      "title": "Liste & Detail",
      "allFilter": "Alle",
      "clearFilters": "Filter zurücksetzen",
      "emptyTitle": "Noch nichts vorhanden",
      "emptyBody": "Datensätze erscheinen hier, sobald Zeilen in der Tabelle ankommen.",
      "noMatchesTitle": "Keine passenden Datensätze",
      "noMatchesBody": "Entfernen Sie einen Filter.",
      "errorTitle": "Diese Liste konnte nicht geladen werden",
      "loading": "Datensätze werden geladen",
      "selectPrompt": "Datensatz auswählen",
      "description": "Eine Liste links, der gewählte Datensatz daneben."
    },
    "queueInbox": {
      "title": "Warteschlange",
      "approve": "Genehmigen",
      "reject": "Ablehnen",
      "allSegment": "Alle",
      "approvedToast": "{count} genehmigt.",
      "rejectedToast": "{count} abgelehnt.",
      "undoneToast": "Entscheidung rückgängig gemacht.",
      "failedToast": "Entscheidung fehlgeschlagen.",
      "bulkFailed": "{failed} von {total} ausgewählten Zeilen konnten nicht aktualisiert werden.",
      "undoFailedToast": "Diese Entscheidung konnte nicht rückgängig gemacht werden.",
      "rejectTitle": "Anfragen ablehnen",
      "rejectCount": "Ausgewählt · {count}",
      "rejectNote": "Der Antragsteller wird mit Ihrer Notiz benachrichtigt.",
      "rejectPlaceholder": "Notiz für den Antragsteller hinzufügen…",
      "rejectConfirm": "Ablehnen",
      "emptyTitle": "Nichts in der Warteschlange",
      "emptyBody": "Neue Anfragen erscheinen hier, sobald sie eintreffen.",
      "caughtUpTitle": "Alles erledigt",
      "caughtUpBody": "Derzeit keine Anfragen in diesem Tab.",
      "errorTitle": "Diese Warteschlange konnte nicht geladen werden",
      "loading": "Warteschlange wird geladen",
      "selectPrompt": "Anfrage auswählen",
      "daysUnit": "{count} Tage",
      "description": "Eine Arbeitsliste mit Genehmigen und Ablehnen je Eintrag."
    }
  },
  "dataio": {
    "back": "Zurück",
    "import": {
      "title": "Daten importieren",
      "stepUpload": "Hochladen",
      "stepMap": "Spalten zuordnen",
      "stepValidate": "Prüfen",
      "stepRun": "Importieren & prüfen",
      "targetLabel": "Zieltabelle",
      "targetPlaceholder": "Tabellenseite wählen…",
      "notATable": "Diese Seite ist keine Tabelle — wählen Sie eine Tabellenseite als Ziel.",
      "dropTitle": "CSV-Datei zum Import hier ablegen",
      "dropHint": "CSV bis 32 MB — die erste Zeile muss die Kopfzeile sein",
      "skipTarget": "Nicht importieren",
      "mapHint": "{count} Datenzeilen in {file} — wählen Sie für jede Spalte ein Ziel.",
      "validating": "Wird geprüft…",
      "toValidate": "Prüfen",
      "validateFailed": "Prüfung fehlgeschlagen.",
      "validationSummary": "{valid} von {total} Zeilen bereit zum Import — {invalid} werden übersprungen.",
      "allValid": "Alle Zeilen haben die Prüfung bestanden",
      "run": "Import starten",
      "runSkipping": "{valid} Zeilen importieren ({invalid} überspringen)",
      "progressLabel": "Importfortschritt",
      "running": "Wird importiert…",
      "kpiTotal": "Zeilen in der Datei",
      "kpiCreated": "Erstellt",
      "kpiUpdated": "Aktualisiert",
      "kpiSkipped": "Übersprungen",
      "inconsistent": "Importzahlen sind inkonsistent — Gesamt muss Erstellt + Aktualisiert + Übersprungen entsprechen.",
      "downloadErrors": "Bericht der übersprungenen Zeilen herunterladen (CSV)",
      "runFailed": "Der Import ist fehlgeschlagen."
    },
    "exports": {
      "title": "Datenexporte",
      "tableLabel": "Tabelle",
      "tablePlaceholder": "Tabelle wählen…",
      "notATable": "Diese Seite ist keine Tabelle — wählen Sie eine Tabellenseite zum Export.",
      "formatLabel": "Format",
      "create": "Exportieren",
      "createFailed": "Der Export konnte nicht angefordert werden.",
      "retention": "Exporte werden 30 Tage aufbewahrt und laufen dann ab.",
      "statusProcessing": "Wird verarbeitet…",
      "statusReady": "Fertig — {rows} Zeilen · zum Herunterladen klicken",
      "statusFailed": "Fehlgeschlagen — {error}",
      "statusCancelled": "Abgebrochen",
      "statusExpired": "Abgelaufen",
      "emptyTitle": "Noch keine Exporte",
      "emptyBody": "Oben einen anfordern — Artefakte erscheinen hier mit ihrem Status."
    }
  },
  "reports": {
    "title": "Geplante Berichte",
    "subtitle": "Wiederkehrende Daten-Schnappschüsse einer Seite, zugestellt als In-App-Benachrichtigungen.",
    "new": "Neuer Bericht",
    "loadFailed": "Geplante Berichte konnten nicht geladen werden.",
    "saveFailed": "Dieser Bericht konnte nicht gespeichert werden.",
    "nextRun": "Nächste Ausführung",
    "emptyTitle": "Noch keine geplanten Berichte",
    "emptyBody": "Erstellen Sie einen, um wiederkehrende Daten-Schnappschüsse einer Tabellenseite zu erhalten.",
    "createTitle": "Neuer geplanter Bericht",
    "editTitle": "Geplanten Bericht bearbeiten",
    "nameLabel": "Name",
    "namePlaceholder": "z. B. Wöchentlicher Umsatz",
    "pageLabel": "Seite",
    "pagePlaceholder": "Seite wählen…",
    "frequencyLabel": "Häufigkeit",
    "frequency": {
      "daily": "Täglich",
      "weekly": "Wöchentlich",
      "monthly": "Monatlich"
    },
    "dayOfWeekLabel": "Tag",
    "dayOfMonthLabel": "Tag im Monat",
    "timeLabel": "Uhrzeit",
    "timezoneLabel": "Zeitzone",
    "formatLabel": "Zustellung",
    "formatHint": "Daten-Schnappschuss (PDF/PNG-Rendering folgt in einer späteren Version) — jede Ausführung erzeugt einen CSV-Schnappschuss und eine In-App-Benachrichtigung.",
    "recipientsLabel": "Empfänger",
    "recipientsHint": "Wird mit dem Bericht gespeichert. E-Mail-Zustellung folgt in einer späteren Version — Ausführungen benachrichtigen vorerst in der App.",
    "deliveryBadge": "CSV-Schnappschuss",
    "delete": "Löschen",
    "create": "Erstellen",
    "cadence": {
      "daily": "Täglich um {time} ({zone})",
      "weekly": "Wöchentlich · {day} um {time} ({zone})",
      "monthly": "Monatlich · Tag {day} um {time} ({zone})"
    }
  },
  "notifications": {
    "channel": {
      "inApp": "In der App",
      "email": "E-Mail",
      "push": "Push"
    },
    "event": {
      "reportReady": "Geplanter Bericht fertig",
      "reportFailed": "Geplanter Bericht fehlgeschlagen",
      "backupCompleted": "Sicherung abgeschlossen"
    }
  },
  "theme": {
    "toLight": "Heller Modus",
    "toDark": "Dunkler Modus"
  },
  "audit": {
    "action": {
      "view": "Anzeigen"
    },
    "actor": {
      "apiKey": "API-Schlüssel",
      "automation": "Automatisierung",
      "system": "System",
      "user": "Benutzer"
    },
    "category": {
      "auth": "Anmeldung & Konten",
      "automation": "Automatisierungen",
      "connection": "Verbindungen",
      "data": "Datensätze",
      "export": "Importe & Exporte",
      "llm": "KI-Assistenz",
      "rbac": "Rollen & Berechtigungen",
      "schema": "Schema",
      "settings": "Einstellungen",
      "system": "System"
    },
    "column": {
      "action": "Aktion",
      "actor": "Akteur",
      "category": "Kategorie",
      "details": "Details",
      "when": "Zeitpunkt"
    },
    "drawer": {
      "actorId": "Akteur-ID",
      "actorKind": "Akteurstyp",
      "after": "Nachher",
      "before": "Vorher",
      "category": "Kategorie",
      "changes": "Änderungen",
      "connection": "Verbindung",
      "field": "Feld",
      "ip": "IP-Adresse",
      "noChanges": "Für diese Aktion wurden keine Vorher-/Nachher-Stände erfasst.",
      "none": "Keine",
      "requestId": "Anfrage-ID",
      "resource": "Ressource",
      "subtitle": "{actor} · {when}",
      "truncated": "Bei 16 KB abgeschnitten",
      "userAgent": "User-Agent"
    },
    "empty": {
      "body": "Änderungen an Daten, Schema, Einstellungen und Berechtigungen erscheinen hier, sobald sie geschehen.",
      "filtered": {
        "body": "Erweitern Sie den Zeitraum oder setzen Sie den Kategoriefilter zurück.",
        "title": "Nichts entspricht diesen Filtern"
      },
      "title": "Es wurde noch nichts protokolliert"
    },
    "filterActor": "Akteur-ID",
    "filterCategoryAny": "Beliebige Kategorie",
    "filterCategory": "Nach Kategorie filtern",
    "filterFrom": "Von",
    "filterTo": "Bis",
    "listFailed": {
      "title": "Das Audit-Log konnte nicht geladen werden"
    },
    "loadMore": "Ältere Einträge laden",
    "subtitle": "Jede Änderung in diesem Workspace, wer sie vorgenommen hat und was sie geändert hat.",
    "title": "Audit-Log"
  },
  "roles": {
    "action": {
      "delete": "Löschen",
      "rename": "Umbenennen"
    },
    "builtinLocked": "Integrierte Rollen können nicht gelöscht werden.",
    "category": {
      "access": "Zugriff",
      "data": "Daten",
      "operations": "Betrieb",
      "workspace": "Workspace"
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
      "manifestsManage": "Add-ons installieren und verbinden",
      "jobsRead": "Alle Hintergrundjobs sehen",
      "llmRun": "KI-Assistenz ausführen",
      "pagesManage": "Seiten erstellen und ordnen",
      "reportsManage": "Geplante Berichte verwalten",
      "rolesManage": "Rollen und Berechtigungen verwalten",
      "schemaRemap": "Schema-Bezeichnungen und -Überschreibungen bearbeiten",
      "settingsManage": "Workspace-Einstellungen verwalten",
      "usersManage": "Benutzer verwalten"
    },
    "rename": {
      "failed": "Die Rolle konnte nicht umbenannt werden",
      "title": "Rolle umbenennen"
    },
    "saveFailed": {
      "title": "Es konnten nicht alle Rollen gespeichert werden"
    },
    "subtitle": "Was jede Rolle darf. Ein Benutzer erhält die Vereinigung aller Rollen, die er innehat.",
    "title": "Rollen & Berechtigungen"
  },
  "security": {
    "password": {
      "changedBody": "Verwenden Sie das neue Passwort bei Ihrer nächsten Anmeldung. Andere Geräte bleiben angemeldet — beenden Sie diese Sitzungen, wenn Sie das nicht möchten.",
      "changed": "Passwort geändert",
      "confirm": "Neues Passwort bestätigen",
      "current": "Aktuelles Passwort",
      "failed": "Ihr Passwort konnte nicht geändert werden",
      "helper": "Mindestens 8 Zeichen.",
      "mismatch": "Die beiden Passwörter stimmen nicht überein.",
      "new": "Neues Passwort",
      "submit": "Passwort ändern",
      "title": "Passwort"
    },
    "sessions": {
      "expires": "Läuft {at} ab",
      "failedBody": "Diese Liste ist die einzige Stelle, die zeigt, wo Ihr Konto angemeldet ist — behandeln Sie eine leere Liste daher als unbekannt und nicht als „nirgendwo angemeldet“.",
      "failed": "Ihre Sitzungen konnten nicht gelesen werden",
      "ip": "IP {ip}",
      "loading": "Es wird nach anderen angemeldeten Geräten gesucht…",
      "noIp": "Keine IP erfasst",
      "revokeBody": "Die Sitzung endet sofort, und wer sie gerade nutzt, muss sich erneut anmelden.",
      "revokeFailed": "Dieses Gerät konnte nicht abgemeldet werden",
      "revokeTitle": "Dieses Gerät abmelden",
      "revoke": "Abmelden",
      "seenUnknown": "Zuletzt aktiv: unbekannt",
      "seen": "Zuletzt aktiv {since}",
      "thisDevice": "Dieses Gerät",
      "title": "Angemeldet",
      "unknownDevice": "Unbekanntes Gerät"
    },
    "subtitle": "Ihr Passwort, Ihr zweiter Faktor und überall dort, wo Sie angemeldet sind.",
    "title": "Sicherheit",
    "twoFactor": {
      "activateFailed": "Dieser Code wurde nicht akzeptiert",
      "activate": "Zwei-Faktor aktivieren",
      "body": "Eine Authenticator-App erzeugt einen 6-stelligen Code, nach dem Adminium nach Ihrem Passwort fragt.",
      "code": "Code aus Ihrer App",
      "copyKey": "Einrichtungsschlüssel kopieren",
      "copyLink": "Einrichtungslink kopieren",
      "disableBody": "Ihr Konto verwendet dann wieder nur das Passwort, und Ihre Wiederherstellungscodes funktionieren nicht mehr.",
      "disableConfirm": "Deaktivieren",
      "disableFailed": "Zwei-Faktor konnte nicht deaktiviert werden",
      "disablePassword": "Ihr Passwort",
      "disableTitle": "Zwei-Faktor-Authentifizierung deaktivieren",
      "disable": "Zwei-Faktor deaktivieren",
      "enrollFailed": "Die Einrichtung konnte nicht gestartet werden",
      "enroll": "Zwei-Faktor einrichten",
      "hide": "Einrichtungsschlüssel verbergen",
      "off": "Aus",
      "on": "An",
      "recovery": {
        "body": "Jeder Code meldet Sie einmal an, falls Sie Ihren Authenticator verlieren. Sie werden nur jetzt angezeigt.",
        "copy": "Codes kopieren",
        "title": "Speichern Sie Ihre Wiederherstellungscodes"
      },
      "reveal": "Einrichtungsschlüssel anzeigen",
      "secretHelper": "Fügen Sie den Einrichtungslink in Ihre Authenticator-App ein oder tippen Sie den Schlüssel von Hand ein.",
      "secret": "Einrichtungsschlüssel",
      "title": "Zwei-Faktor-Authentifizierung"
    }
  },
  "team": {
    "action": {
      "reactivate": "Reaktivieren",
      "remove": "Löschen",
      "resend": "Neuer Link",
      "roles": "Rollen",
      "suspend": "Sperren"
    },
    "column": {
      "actions": "Aktionen",
      "lastSeen": "Zuletzt aktiv",
      "person": "Person",
      "roles": "Rollen",
      "status": "Status"
    },
    "counts": "{active} aktiv · {invited} eingeladen · {suspended} gesperrt",
    "empty": {
      "body": "Laden Sie ein Teammitglied ein, damit es eine eigene Anmeldung und Rolle erhält.",
      "filtered": {
        "body": "Setzen Sie die Filter zurück, um das ganze Verzeichnis zu sehen.",
        "title": "Niemand entspricht diesen Filtern"
      },
      "title": "Nur Sie haben ein Konto"
    },
    "filterRoleAny": "Beliebige Rolle",
    "filterRole": "Nach Rolle filtern",
    "filterStatusAny": "Beliebiger Status",
    "filterStatus": "Nach Status filtern",
    "invite": {
      "copied": "Kopiert",
      "copyLink": "Link kopieren",
      "created": {
        "body": "Senden Sie diesen Link selbst an {email}. Er wird nur ein einziges Mal angezeigt — Adminium speichert davon nur einen Hash, und wenn Sie ihn verlieren, müssen Sie die Einladung löschen und eine neue ausstellen.",
        "title": "Einladung erstellt"
      },
      "emailIt": "Einladung per E-Mail senden",
      "expiresRelative": "Der Link läuft {at} ab ({relative}).",
      "expires": "Der Link läuft {at} ab.",
      "noEmail": {
        "smtp": "Für diese Instanz ist kein SMTP-Server konfiguriert, es gibt also nichts, womit E-Mails versendet werden könnten. Teilen Sie den Link über einen Kanal, dem Sie bereits vertrauen.",
        "title": "Adminium hat diesen Link nicht per E-Mail versendet",
        "unknown": "Adminium konnte nicht prüfen, ob diese Instanz E-Mails versenden kann. Teilen Sie den Link über einen Kanal, dem Sie bereits vertrauen."
      }
    },
    "inviteButton": "Teammitglied einladen",
    "inviteDialog": {
      "description": "Adminium erstellt das Konto und gibt Ihnen einen einmaligen Aktivierungslink zum Weitergeben.",
      "emailPlaceholder": "name@example.com",
      "email": "E-Mail",
      "failed": "Die Einladung konnte nicht erstellt werden",
      "namePlaceholder": "z. B. Dana Osei",
      "name": "Name",
      "rolesHelper": "Wählen Sie die Rolle mit den geringsten Rechten, die für die Arbeit ausreicht. Sie können das später ändern.",
      "roles": "Rollen",
      "submit": "Einladung erstellen",
      "title": "Teammitglied einladen"
    },
    "listFailed": {
      "title": "Das Verzeichnis konnte nicht geladen werden"
    },
    "loadMore": "Mehr laden",
    "neverSignedIn": "Nie angemeldet",
    "noRoles": "Keine Rollen",
    "remove": {
      "body": "Dies löscht das Konto von {name} samt Einstellungen und Anmeldesitzungen und entfernt den Namen aus dem Nachweis der von dieser Person geänderten Einstellungen. Ein Sperren behält all das und verhindert lediglich die Anmeldung. Das lässt sich nicht rückgängig machen.",
      "confirm": "Endgültig löschen",
      "prompt": "Geben Sie „{email}“ zur Bestätigung ein",
      "title": "Konto endgültig löschen"
    },
    "roles": {
      "unavailable": "Rollen sind für Ihr Konto nicht sichtbar, daher können hier keine zugewiesen werden."
    },
    "rolesDialog": {
      "description": "Ein Benutzer erhält die Vereinigung aller Rollen, die er innehat.",
      "failed": "Die Rollen konnten nicht geändert werden",
      "title": "Rollen für {name}"
    },
    "rolesLocked": "Zum Ändern von Rollen wird die Berechtigung „Rollen verwalten“ benötigt.",
    "search": "Name oder E-Mail suchen",
    "status": {
      "active": "Aktiv",
      "invited": "Eingeladen",
      "suspended": "Gesperrt"
    },
    "subtitle": "Wer ein Konto in diesem Adminium hat und was die einzelnen Personen dürfen.",
    "title": "Team",
    "twoFactorOn": "Zwei-Faktor-Authentifizierung ist aktiviert",
    "twoFactorShort": "2FA"
  },
  "email": {
    "linkFallback": "Wenn die Schaltfläche nicht funktioniert, fügen Sie diesen Link in Ihren Browser ein: {url}",
    "notification": {
      "action": "{appName} öffnen",
      "footer": "Sie erhalten diese E-Mail, weil E-Mail-Benachrichtigungen für Ihr Konto bei {appName} aktiviert sind. Sie können sie in Ihren Benachrichtigungseinstellungen deaktivieren.",
      "name": "Benachrichtigung"
    },
    "passwordReset": {
      "action": "Neues Passwort festlegen",
      "heading": "Setzen Sie Ihr Passwort zurück",
      "intro": "Hallo {name}, wir haben eine Anfrage erhalten, das Passwort für {email} zurückzusetzen.",
      "name": "Passwort zurücksetzen",
      "notice": "Dieser Link funktioniert nur ein einziges Mal und läuft in {expiresInMinutes} Minuten ab. Wenn Sie kein Zurücksetzen Ihres Passworts angefordert haben, können Sie diese E-Mail ignorieren — Ihr aktuelles Passwort bleibt gültig.",
      "subject": "Ihr Passwort für {appName} zurücksetzen"
    },
    "userInvite": {
      "action": "Einladung annehmen",
      "heading": "Sie wurden eingeladen",
      "intro": "{inviterName} hat Sie zu {appName} eingeladen. Nehmen Sie die Einladung an, um ein Passwort für {email} festzulegen und sich anzumelden.",
      "name": "Team-Einladung",
      "notice": "Diese Einladung funktioniert nur ein einziges Mal und läuft in {expiresInDays} Tagen ab. Wenn Sie sie nicht erwartet haben, können Sie diese E-Mail ignorieren.",
      "subject": "Sie wurden zu {appName} eingeladen",
      "inviterFallback": "Eine Administratorin oder ein Administrator"
    }
  }
} as const;
