// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What of a visitor's words the chat's automatic answerer never sends to the
 * AI service: e-mail addresses and phone numbers, each replaced by a
 * placeholder (`[email]`, `[phone]`) before the words leave this server.
 *
 * The answerer only has to pick one of the owner's answers, and neither an
 * address nor a number helps it pick; both are a person's own. A phone number
 * is any run of 7 or more digits, which may be split by spaces, dots, dashes
 * or brackets, with a leading `+`: an order or a long date written that way
 * is masked too, which costs nothing, since an order is handed to a person
 * anyway.
 *
 * Pure: the same words always give the same masked words.
 */

/** An e-mail address: something, an `@`, a domain with a dot in it. */
const EMAIL_RE = /[^\s@<>()[\]{}"',;:]+@[^\s@<>()[\]{}"',;:]+\.[^\s@<>()[\]{}"',;:]*[\p{L}\p{N}]/gu;

/**
 * 7 or more digits of any script (Arabic-Indic and full-width ones too), each pair at most two separators apart (a
 * space, dot, dash or bracket), with an optional `+` and `(` first.
 */
const PHONE_RE = /[+＋]?\(?\p{Nd}(?:[\s.\-()]{0,2}\p{Nd}){6,}/gu;

/** The visitor's words with every e-mail address and phone number replaced. */
export function maskVisitorText(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
}
