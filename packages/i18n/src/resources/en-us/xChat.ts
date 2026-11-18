// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/xChat.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "asked": "You asked for a person.",
  "automatic": "Automatic answer",
  "automaticIn": "Automatic answer · in {language}",
  "away": {
    "again": "Write to us again then.",
    "later": "Write to us again later.",
    "leave": "Leave your question and your e-mail, and we’ll reply by e-mail.",
    "now": "We’re away for now.",
    "opens": "{day, select, today {{time} today} tomorrow {{time} tomorrow} date {{date} at {time}} other {{weekday} at {time}}}",
    "sent": "{day, select, today {Thanks. We’ll reply to {email} after {time}.} tomorrow {Thanks. We’ll reply to {email} after {time}.} date {Thanks. We’ll reply to {email} on {date} after {time}.} other {Thanks. We’ll reply to {email} on {weekday} after {time}.}}",
    "sentNone": "Thanks. We’ll reply to {email}.",
    "until": "{day, select, today {We’re away until {time} today.} tomorrow {We’re away until {time} tomorrow.} date {We’re away until {date} at {time}.} other {We’re away until {weekday} at {time}.}}"
  },
  "card": {
    "badEmail": "Enter an e-mail like name@company.example",
    "badName": "Write your name without a web address.",
    "change": "Change",
    "email": "Your e-mail",
    "emailOptional": "Your e-mail (optional)",
    "helper": "So we can reply if you close this page.",
    "name": "Your name (optional)",
    "needEmail": "Enter your e-mail so we can reply.",
    "needOne": "Add your name or e-mail first.",
    "needQuestion": "Write your question first.",
    "question": "Your question",
    "save": "Save",
    "send": "Send"
  },
  "close": "Close chat",
  "closed": "This chat was closed · {time}",
  "closedBy": "{name} closed this chat · {time}",
  "done": {
    "leave": "If you leave, we’ll reply to {email}.",
    "named": "Thanks, {name}.",
    "stay": "Keep this page open to see the reply.",
    "thanks": "Thanks."
  },
  "first": {
    "automatic": "Some answers here are automatic, picked from answers {business} wrote. A person can take over at any time. Your messages are read by an AI service ({service}).",
    "drafts": "A person answers here. Staff may use an AI service ({service}) to help write replies.",
    "person": "A person answers here."
  },
  "from": "{name} from {business}",
  "hand": {
    "info": "A person will answer here. Keep this page open to see the reply.",
    "text": "A person will answer here."
  },
  "hide": "Hide chat",
  "hours": {
    "openUntil": "Open today until {time}",
    "opens": "{day, select, today {Opens today at {time}} tomorrow {Opens tomorrow at {time}} date {Opens on {date} at {time}} other {Opens {weekday} at {time}}}"
  },
  "hoursEnded": {
    "next": "{day, select, today {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply after {time} today.} tomorrow {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply after {time} tomorrow.} date {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply on {date} after {time}.} other {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply on {weekday} after {time}.}}",
    "none": "{business}’s hours ended at {closing}. A person may still answer."
  },
  "language": "Language",
  "languageOf": "Language: {name}",
  "log": "Messages",
  "lost": "We couldn’t find your earlier chat. Start a new one below.",
  "newChat": "Start a new chat",
  "newMessages": "{count, plural, one {{n} new message from {business}} other {{n} new messages from {business}}}",
  "newTab": "(opens in a new tab)",
  "offline": "Can’t reach {business}. Trying again…",
  "privacy": "Privacy notice.",
  "rate": {
    "chat": "You’ve sent a lot of messages in this chat.",
    "minute": "You’ve sent a lot of messages. Wait a minute, then try again.",
    "wait": "You’ve sent a lot of messages. Wait {minutes, plural, one {{n} minute} other {{n} minutes}}, then try again."
  },
  "reopened": "This chat was reopened · {time}",
  "reopenedBy": "{name} reopened this chat · {time}",
  "resumed": "Your chat from {time}",
  "send": "Send",
  "status": {
    "checking": "Checking you’re a person…",
    "failed": "We couldn’t check that you’re a person.",
    "notSent": "Not sent.",
    "queued": "Waiting to send",
    "retry": "Try again"
  },
  "talk": "Talk to a person",
  "waiting": "Still waiting for someone at {business}.",
  "waitingMail": "Still waiting for someone at {business}. You can leave your e-mail and close this page.",
  "with": "Chat with {business}",
  "withNew": "Chat with {business}, {count, plural, one {{n} new message} other {{n} new messages}}",
  "write": "Write a message…"
} as const;
