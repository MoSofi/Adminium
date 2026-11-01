// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/x.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "language": {
    "menu": "Language",
    "button": "Language: {name}"
  },
  "footer": {
    "questions": "Questions? Write to",
    "privacyNotice": "Privacy notice"
  },
  "required": "Required",
  "optional": "Optional",
  "send": "Send",
  "sendAnswers": "Send answers",
  "sending": "Sending…",
  "keeps": "{business} keeps what you send to answer you.",
  "summary": "Check the answers marked below.",
  "proofFailed": "The check that you are a person did not pass. Try again.",
  "honeypot": "Leave this field empty",
  "anonymous": "Your answers are not linked to your name.",
  "error": {
    "required": "Answer this question.",
    "name": "Enter your name",
    "tooLong": "Keep this to {max, plural, one {# character} other {# characters}}.",
    "email": "Enter an e-mail address like name@company.com",
    "phone": "Enter a phone number with 6 to 15 digits.",
    "choice": "Pick one of the choices.",
    "tooFew": "Pick at least {min}.",
    "tooMany": "Pick at most {max}.",
    "date": "Enter a day.",
    "fromToday": "Pick a day from today on",
    "fromTomorrow": "Pick a day from tomorrow on",
    "number": "Enter a number.",
    "whole": "Enter a whole number.",
    "tooSmall": "Enter {min} or more.",
    "tooLarge": "Enter {max} or less.",
    "score": "Pick a score from 0 to 10.",
    "stars": "Pick from 1 to 5 stars.",
    "file": "This file can’t be taken.",
    "tick": "Tick the box, or leave it empty.",
    "answer": "Something in the answers was not taken. Check them and send again."
  },
  "file": {
    "chooseOne": "Choose a file",
    "chooseMany": "Choose files",
    "hint": "{kinds}, up to {mb} MB",
    "kind": {
      "pdf": "PDF",
      "jpg": "JPG",
      "png": "PNG",
      "text": "plain text"
    }
  },
  "score": {
    "low": "Not likely",
    "high": "Very likely",
    "ends": "0 is not likely, 10 is very likely."
  },
  "stars": {
    "of": "{n} of 5",
    "star": "{n, plural, one {# star} other {# stars}}"
  },
  "ending": {
    "thanksName": "Thanks, {name}.",
    "thanks": "Thank you.",
    "confirmNewsletter": "One more step for the newsletter: check your e-mail and press Confirm.",
    "confirmSurveys": "One more step for the surveys: check your e-mail and press Confirm.",
    "surveyThanksName": "Thank you, {name}.",
    "surveyHelps": "Your answers help us.",
    "already": "You’ve already answered this survey. Thank you.",
    "dead": "This link doesn’t work.",
    "write": "Write to {email}.",
    "closed": "This form is closed.",
    "tooMany": "Too many sends from here. Please try again {when}, or write to {email}.",
    "tooManyPlain": "Too many sends from here. Please try again {when}.",
    "unavailable": "This page isn’t available.",
    "noScript": "This form needs JavaScript.",
    "noScriptWrite": "You can also write to {email}.",
    "offline": "This page could not be reached.",
    "offlineBody": "Check your connection and try again.",
    "retry": "Try again",
    "continue": "Continue"
  }
} as const;
