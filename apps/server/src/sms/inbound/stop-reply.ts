// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a STOP gets a confirmation from Adminium. The send itself is the send
 * path's; this decides.
 *
 * At most one plain confirmation, so none when:
 *  - the number was already stopped;
 *  - the provider has already answered. Both providers answer their own default
 *    words by themselves, and a second text would be the one the rule forbids.
 *    So Adminium speaks only for what the provider does not catch, such as
 *    "STOP PLEASE" or a local word;
 *  - more than five minutes have passed. The US rule in force from 2026-11-25
 *    presumes a confirmation is consented to only inside that window, so a STOP
 *    found late by the catch-up is applied and not answered.
 *
 * A confirmation that is not sent loses nothing: the STOP is already on the list.
 */
import type { SmsProviderKey } from '../types.js';
import { textWordsFor } from '../words.js';

export const SMS_STOP_CONFIRM_WINDOW_MS = 5 * 60 * 1000;

/**
 * Fixed words: no marketing, no question, no link. The catalogue's
 * `email:texts.stopConfirmed`, in the language of the word the person used,
 * else the business's own. This is the US English one.
 */
export const SMS_STOP_CONFIRMATION = textWordsFor('en-US').stopConfirmed;

/** The confirmation in a language (`en-US` or `en_US`); US English for one the catalogue does not have. */
export const stopConfirmationIn = (language: string | null): string => textWordsFor(language).stopConfirmed;

/** Each provider's own default opt-out words, folded: a message that is exactly one of these was already answered. */
const PROVIDER_ANSWERS: Readonly<Record<SmsProviderKey, ReadonlySet<string>>> = {
  twilio: new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'revoke', 'optout', 'quit']),
  telnyx: new Set(['stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'opt out', 'optout']),
};

export type StopConfirmationDecision =
  | { send: true; sendBy: number }
  | { send: false; reason: 'already-stopped' | 'provider-answered' | 'too-late' | 'catch-up' };

export function decideStopConfirmation(input: {
  provider: SmsProviderKey;
  /** The stop list gained this number just now. */
  added: boolean;
  /** The delivery itself says the provider answered it. */
  answered: boolean;
  /** The whole message, folded. */
  whole: string;
  via: 'webhook' | 'catch-up';
  occurredAt: number;
  now: number;
}): StopConfirmationDecision {
  if (!input.added) return { send: false, reason: 'already-stopped' };
  if (input.via === 'catch-up') return { send: false, reason: 'catch-up' };
  if (input.answered || PROVIDER_ANSWERS[input.provider].has(input.whole)) return { send: false, reason: 'provider-answered' };
  const sendBy = input.occurredAt + SMS_STOP_CONFIRM_WINDOW_MS;
  if (input.now >= sendBy) return { send: false, reason: 'too-late' };
  return { send: true, sendBy };
}

/** What the send path is asked to send. `dedupeKey` is stable, so a repeat cannot become a second text. */
export interface SmsStopConfirmation {
  to: string;
  /** The number they texted, so the answer comes from the same one. */
  from: string | null;
  body: string;
  /** The language of the word they used; null when it says nothing. */
  language: string | null;
  /** After this, do not send. */
  sendBy: number;
  dedupeKey: string;
}
