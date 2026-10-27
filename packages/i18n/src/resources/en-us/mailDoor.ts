// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/mailDoor.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "language": "Language",
  "questions": "Questions? Write to",
  "privacyNotice": "Privacy notice",
  "optional": "Optional",
  "why": "Why?",
  "reason": {
    "tooMany": "Too many e-mails",
    "notUseful": "Not useful to me",
    "neverSignedUp": "I never signed up",
    "other": "Something else"
  },
  "unsubscribe": {
    "titleNewsletter": "Unsubscribe {address} from {business}’s newsletter?",
    "titleSurveys": "Unsubscribe {address} from {business}’s surveys?",
    "titleAll": "Unsubscribe {address} from all {business} marketing mail?",
    "one": "Unsubscribe",
    "all": "Unsubscribe from all {business} marketing mail",
    "done": "You’re unsubscribed.",
    "doneNewsletter": "You won’t get {business}’s newsletter again.",
    "doneSurveys": "You won’t get {business}’s surveys again.",
    "doneAll": "You won’t get {business}’s marketing mail again.",
    "stillService": "Mails about your own orders and visits still reach you.",
    "already": "You’re already unsubscribed.",
    "dead": "This link doesn’t work.",
    "deadWrite": "Write to {email} and we’ll take you off the list.",
    "deadAsk": "Write to {business} and they’ll take you off the list."
  },
  "unavailable": {
    "title": "This page isn’t available."
  }
} as const;
