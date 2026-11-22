// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RULES OF A TEXT: what refuses it before anything is read from a store.
 *
 * Pure. The stop list and the consent log are the service's to read; every
 * rule here depends only on the number and the request. Anything this code
 * does not recognise refuses.
 */
import type { Phone, PhoneFailure } from '../../phone/index.js';
import type { TextClass, TextDecision, TextOptOut, TextPurpose, TextRequest } from './types.js';

/** No text of any class: mainland China. Hong Kong, Macao and Taiwan have calling codes of their own. */
export const NO_TEXT_CALLING_CODES: ReadonlySet<string> = new Set(['86']);

/** Replies do not work here, so no marketing opt-out can. Service texts stay, with opt-out through the business. */
export const NO_REPLY_COUNTRIES: ReadonlySet<string> = new Set(['AE', 'EG', 'SA', 'CN', 'TW']);

/** Marketing here needs a confirmed yes. A list for a legal review to grow. */
export const DOUBLE_OPT_IN_COUNTRIES: ReadonlySet<string> = new Set(['DE']);

const PURPOSES: Readonly<Record<TextClass, TextPurpose>> = { service: 'text-service', marketing: 'text-marketing' };

/** The consent a class needs; undefined for a class this code does not know. */
export function purposeFor(textClass: unknown): TextPurpose | undefined {
  return textClass === 'service' || textClass === 'marketing' ? PURPOSES[textClass] : undefined;
}

export type PreLookup = { pass: false; refusal: Extract<TextDecision, { send: false }> } | { pass: true; phone: Phone; purpose: TextPurpose };

const refuse = (reason: Extract<TextDecision, { send: false }>['reason']): PreLookup => ({ pass: false, refusal: { send: false, reason } });

/** The refusal that needs no store, or the number and purpose the stop list and the log then decide on. */
export function judgeBeforeLookup(phone: Phone | PhoneFailure, request: Pick<TextRequest, 'class' | 'sender' | 'repliesReachUs'>): PreLookup {
  if (!phone.ok) return { pass: false, refusal: { send: false, reason: 'unreadable-phone', phoneReason: phone.reason } };
  const purpose = purposeFor(request.class);
  if (purpose === undefined) return refuse('unknown-class');
  if (NO_TEXT_CALLING_CODES.has(phone.callingCode)) return refuse('country-blocked');
  if (phone.receivesText === 'no') return refuse('cannot-receive-text');
  if (request.class === 'marketing') {
    if (NO_REPLY_COUNTRIES.has(phone.country)) return refuse('country-blocked-for-marketing');
    if (request.sender.kind !== 'number') return refuse('marketing-from-name');
    if (request.repliesReachUs !== true) return refuse('marketing-without-replies');
  }
  return { pass: true, phone, purpose };
}

/** "Reply STOP" only where a reply can arrive: from a number, to a country with replies, on a server that reads them. */
export function optOutFor(phone: Phone, request: Pick<TextRequest, 'sender' | 'repliesReachUs'>): TextOptOut {
  return request.sender.kind === 'number' && request.repliesReachUs === true && !NO_REPLY_COUNTRIES.has(phone.country) ? 'reply-stop' : 'through-business';
}
