// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/xChat.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "asked": "Sie haben nach einer Person gefragt.",
  "automatic": "Automatische Antwort",
  "automaticIn": "Automatische Antwort · auf {language}",
  "away": {
    "again": "Schreiben Sie uns dann wieder.",
    "later": "Schreiben Sie uns später wieder.",
    "leave": "Hinterlassen Sie Ihre Frage und Ihre E-Mail-Adresse, dann antworten wir per E-Mail.",
    "now": "Wir sind gerade nicht da.",
    "opens": "{day, select, today {heute um {time}} tomorrow {morgen um {time}} date {am {date} um {time}} other {am {weekday} um {time}}}",
    "sent": "{day, select, today {Danke. Wir antworten an {email} ab {time}.} tomorrow {Danke. Wir antworten an {email} ab {time}.} date {Danke. Wir antworten an {email} am {date} ab {time}.} other {Danke. Wir antworten an {email} am {weekday} ab {time}.}}",
    "sentNone": "Danke. Wir antworten an {email}.",
    "until": "{day, select, today {Wir sind heute ab {time} wieder da.} tomorrow {Wir sind morgen ab {time} wieder da.} date {Wir sind am {date} ab {time} wieder da.} other {Wir sind am {weekday} ab {time} wieder da.}}"
  },
  "card": {
    "badEmail": "Geben Sie eine E-Mail-Adresse wie name@company.example ein",
    "badName": "Schreiben Sie Ihren Namen ohne Webadresse.",
    "change": "Ändern",
    "email": "Ihre E-Mail-Adresse",
    "emailOptional": "Ihre E-Mail-Adresse (optional)",
    "helper": "Damit wir antworten können, wenn Sie diese Seite schließen.",
    "name": "Ihr Name (optional)",
    "needEmail": "Geben Sie Ihre E-Mail-Adresse ein, damit wir antworten können.",
    "needOne": "Geben Sie zuerst Ihren Namen oder Ihre E-Mail-Adresse ein.",
    "needQuestion": "Schreiben Sie zuerst Ihre Frage.",
    "question": "Ihre Frage",
    "save": "Speichern",
    "send": "Senden"
  },
  "close": "Chat schließen",
  "closed": "Dieser Chat wurde geschlossen · {time}",
  "closedBy": "{name} hat diesen Chat geschlossen · {time}",
  "done": {
    "leave": "Wenn Sie die Seite verlassen, antworten wir an {email}.",
    "named": "Danke, {name}.",
    "stay": "Lassen Sie diese Seite offen, um die Antwort zu sehen.",
    "thanks": "Danke."
  },
  "first": {
    "automatic": "Einige Antworten hier sind automatisch, ausgewählt aus Antworten, die {business} geschrieben hat. Eine Person kann jederzeit übernehmen. Ihre Nachrichten werden von einem KI-Dienst ({service}) gelesen.",
    "drafts": "Hier antwortet eine Person. Mitarbeitende nutzen eventuell einen KI-Dienst ({service}), um Antworten zu schreiben.",
    "person": "Hier antwortet eine Person."
  },
  "from": "{name} von {business}",
  "hand": {
    "info": "Hier antwortet Ihnen eine Person. Lassen Sie diese Seite offen, um die Antwort zu sehen.",
    "text": "Hier antwortet Ihnen eine Person."
  },
  "hide": "Chat ausblenden",
  "hours": {
    "openUntil": "Heute geöffnet bis {time}",
    "opens": "{day, select, today {Öffnet heute um {time}} tomorrow {Öffnet morgen um {time}} date {Öffnet am {date} um {time}} other {Öffnet am {weekday} um {time}}}"
  },
  "hoursEnded": {
    "next": "{day, select, today {Die Öffnungszeit von {business} endete um {closing}. Vielleicht antwortet trotzdem noch jemand; sonst antworten wir heute ab {time}.} tomorrow {Die Öffnungszeit von {business} endete um {closing}. Vielleicht antwortet trotzdem noch jemand; sonst antworten wir morgen ab {time}.} date {Die Öffnungszeit von {business} endete um {closing}. Vielleicht antwortet trotzdem noch jemand; sonst antworten wir am {date} ab {time}.} other {Die Öffnungszeit von {business} endete um {closing}. Vielleicht antwortet trotzdem noch jemand; sonst antworten wir am {weekday} ab {time}.}}",
    "none": "Die Öffnungszeit von {business} endete um {closing}. Vielleicht antwortet trotzdem noch jemand."
  },
  "language": "Sprache",
  "languageOf": "Sprache: {name}",
  "log": "Nachrichten",
  "lost": "Wir konnten Ihren früheren Chat nicht finden. Starten Sie unten einen neuen.",
  "newChat": "Neuen Chat starten",
  "newMessages": "{count, plural, one {{n} neue Nachricht von {business}} other {{n} neue Nachrichten von {business}}}",
  "newTab": "(öffnet in neuem Tab)",
  "offline": "{business} ist nicht erreichbar. Neuer Versuch läuft…",
  "privacy": "Datenschutzhinweis.",
  "rate": {
    "chat": "Sie haben in diesem Chat sehr viele Nachrichten gesendet.",
    "minute": "Sie haben sehr viele Nachrichten gesendet. Warten Sie eine Minute und versuchen Sie es dann erneut.",
    "wait": "Sie haben sehr viele Nachrichten gesendet. Warten Sie {minutes, plural, one {{n} Minute} other {{n} Minuten}} und versuchen Sie es dann erneut."
  },
  "reopened": "Dieser Chat wurde wieder geöffnet · {time}",
  "reopenedBy": "{name} hat diesen Chat wieder geöffnet · {time}",
  "resumed": "Ihr Chat von {time}",
  "send": "Senden",
  "status": {
    "checking": "Wir prüfen, ob Sie ein Mensch sind…",
    "failed": "Wir konnten nicht prüfen, ob Sie ein Mensch sind.",
    "notSent": "Nicht gesendet.",
    "queued": "Wartet auf Versand",
    "retry": "Erneut versuchen"
  },
  "talk": "Mit einer Person sprechen",
  "waiting": "Wir warten noch auf jemanden von {business}.",
  "waitingMail": "Wir warten noch auf jemanden von {business}. Sie können Ihre E-Mail-Adresse hinterlassen und diese Seite schließen.",
  "with": "Chat mit {business}",
  "withNew": "Chat mit {business}, {count, plural, one {{n} neue Nachricht} other {{n} neue Nachrichten}}",
  "write": "Nachricht schreiben…"
} as const;
