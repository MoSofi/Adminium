// SPDX-License-Identifier: AGPL-3.0-only
/**
 * May a text go to this number? The phone module reads it; the rules of what
 * SMS does with the answer are here.
 *
 *  - a number that cannot be read is never sent to;
 *  - `receivesText: 'no'` is not sent to, and `'maybe'` is: the US and Canada
 *    do not separate mobiles from landlines, so the provider's answer decides;
 *  - mainland China (+86) is refused: neither provider offers a dependable route there. Hong Kong, Macao
 *    and Taiwan have calling codes of their own and stay.
 *
 * Only the `e164` this returns ever reaches a provider, never what was typed.
 */
import { parsePhone, type Phone } from '../phone/index.js';
import type { SmsRefusalReason } from './types.js';

export type SmsDestination =
  | { ok: true; phone: Phone }
  | { ok: false; reason: Extract<SmsRefusalReason, 'bad-number' | 'cannot-receive-text' | 'country-blocked-cn'>; detail: string | null; e164: string | null };

export function checkDestination(input: unknown, defaultCountry: string | null): SmsDestination {
  const phone = parsePhone(input, defaultCountry);
  if (!phone.ok) return { ok: false, reason: 'bad-number', detail: phone.reason, e164: null };
  if (phone.callingCode === '86' || phone.country === 'CN') return { ok: false, reason: 'country-blocked-cn', detail: null, e164: phone.e164 };
  if (phone.receivesText === 'no') return { ok: false, reason: 'cannot-receive-text', detail: phone.kind, e164: phone.e164 };
  return { ok: true, phone };
}

/** A number for an audit row or a card: its last two digits only. */
export function phoneHint(e164: string | null): string | null {
  return e164 === null ? null : `+…${e164.slice(-2)}`;
}
