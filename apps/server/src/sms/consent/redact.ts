// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping a phone number out of a log, an error or an audit row.
 *
 * {@link maskPhone} is the one form a number is shown in outside its sealed
 * copy. {@link redactPhones} reaches inside a string, such as a provider's
 * error that quotes the number. It finds anything written with a `+`, in any
 * digit `parsePhone` reads. A number written with no `+` cannot be told from
 * an id or a timestamp, so it is removed only when the caller names it.
 */
import { parsePhone } from '../../phone/index.js';

const HIDDEN = '•••';

const DIGIT = '0-9\\u0660-\\u0669\\u06F0-\\u06F9\\uFF10-\\uFF19';
const SEPARATOR = ' \\u00A0\\u2009\\u202F\\u3000().\\-\\u2010-\\u2015\\uFF0D/';
/** A plus (or a plus in a URL), then at least seven digits, however they are spaced. */
const WRITTEN_WITH_PLUS = new RegExp(`(?:[+\\uFF0B]|%2[Bb])[${SEPARATOR}]*[${DIGIT}](?:[${SEPARATOR}]*[${DIGIT}]){6,}`, 'gu');

/** A value shorter than this is not a number worth searching a text for. */
const SHORTEST_KNOWN = 6;

/** `+49 ••• 789`. Anything that does not read as one number shows nothing of itself. */
export function maskPhone(value: unknown): string {
  const phone = parsePhone(value, null);
  return phone.ok ? `+${phone.callingCode} ${HIDDEN} ${phone.e164.slice(-3)}` : HIDDEN;
}

/** A known number's digits, however they are spaced. Not bounded by non-digits: `0049…` must go too. */
function spaced(digits: string): RegExp {
  return new RegExp([...digits].join(`[${SEPARATOR}]*`), 'gu');
}

/** The patterns a known number may be written in, longest first. */
function spellings(value: string, country: string | null): RegExp[] {
  const phone = parsePhone(value, country);
  const written = value.trim();
  const literal = written.length >= SHORTEST_KNOWN ? [new RegExp(written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu')] : [];
  if (!phone.ok) return literal;
  return [...literal, spaced(phone.e164.slice(1)), spaced(phone.nationalDigits)];
}

/** Whether a text quotes this exact number, in any spelling {@link redactPhones} would remove. */
export function quotesPhone(text: string, e164: string, country: string | null = null): boolean {
  return spellings(e164, country).some((pattern) => text.search(pattern) !== -1);
}

/**
 * The text with every phone number masked. `known` names numbers to remove
 * however they are written, such as the recipient of the send that failed;
 * `country` reads a local one.
 */
export function redactPhones(text: string, known: readonly string[] = [], country: string | null = null): string {
  let out = text;
  for (const value of known) {
    const phone = parsePhone(value, country);
    const mask = maskPhone(phone.ok ? phone.e164 : value);
    for (const spelling of spellings(value, country)) out = out.replace(spelling, mask);
  }
  return out.replace(WRITTEN_WITH_PLUS, (found) => maskPhone(found.replace(/^%2[Bb]/, '+')));
}
