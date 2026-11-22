// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What one provider delivery holds, in one shape for both providers.
 *
 * Runs only after the signature was proved. Each event becomes a small JSON
 * body that is sealed before it is stored, holding only what its work needs.
 * The identity of an event is what a re-delivery repeats:
 *
 *   Twilio   the message SID, and for a report the status too, because one
 *            message reports several statuses
 *   Telnyx   `data.id`
 *
 * A reply found by the catch-up carries the same id as its webhook.
 */
import { z } from 'zod';

import type { InboundCandidate } from '../../inbound/index.js';
import { asRecord } from '../http.js';
import { telnyxErrorCode } from '../telnyx.js';
import { readControlWord } from './control-words.js';

const E164 = /^\+[1-9][0-9]{6,14}$/;
const TWILIO_SID = /^(?:SM|MM)[0-9a-fA-F]{32}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUS_WORD = /^[a-z_]{1,32}$/;
const ERROR_CODE = /^\d{1,8}$/;
/** More than a text can hold: a longer one is not read as a message. */
const MAX_TEXT = 4096;

export const SMS_INBOUND_CHANNEL = 'sms';

export const SMS_EVENT_KINDS = { reply: 'reply', status: 'delivery', optOut: 'opt-out' } as const;
/** The kinds that may hold a person's STOP: what a text about to go waits for. */
export const SMS_STOP_EVENT_KINDS: readonly string[] = [SMS_EVENT_KINDS.reply, SMS_EVENT_KINDS.optOut];
/** Telnyx's "this person opted out". */
const TELNYX_OPT_OUT = '40300';

export const smsEventBody = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('reply'), from: z.string().max(64), to: z.string().max(64).nullable(), text: z.string().max(MAX_TEXT), answered: z.boolean(), via: z.enum(['webhook', 'catch-up']) }).strict(),
  z.object({ v: z.literal(1), type: z.literal('status'), messageId: z.string().max(64), word: z.string().max(32), errorCode: z.string().max(8).nullable(), to: z.string().max(64).nullable() }).strict(),
  z.object({ v: z.literal(1), type: z.literal('opt-out'), phone: z.string().max(64) }).strict(),
]);
export type SmsEventBody = z.infer<typeof smsEventBody>;

/** A number as a subject for erasure; null when it is not one. */
export const subjectOf = (phone: string | null): string | null => (phone !== null && E164.test(phone) ? `tel:${phone}` : null);

export const replyProviderId = (messageId: string): string => `reply:${messageId}`;

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);

export function replyCandidate(input: { providerId: string; from: string; to: string | null; text: string; answered: boolean; via: 'webhook' | 'catch-up'; occurredAt: number | null }): InboundCandidate {
  const body: SmsEventBody = { v: 1, type: 'reply', from: input.from, to: input.to, text: input.text, answered: input.answered, via: input.via };
  return { providerId: input.providerId, kind: SMS_EVENT_KINDS.reply, subject: subjectOf(input.from), body: JSON.stringify(body), occurredAt: input.occurredAt };
}

function statusCandidate(input: { providerId: string; messageId: string; word: string; errorCode: string | null; to: string | null; occurredAt: number | null }): InboundCandidate {
  const body: SmsEventBody = { v: 1, type: 'status', messageId: input.messageId, word: input.word, errorCode: input.errorCode, to: input.to };
  return { providerId: input.providerId, kind: SMS_EVENT_KINDS.status, subject: subjectOf(input.to), body: JSON.stringify(body), occurredAt: input.occurredAt };
}

export function optOutCandidate(input: { phone: string; createdAt: string; occurredAt: number }): InboundCandidate {
  const body: SmsEventBody = { v: 1, type: 'opt-out', phone: input.phone };
  return { providerId: `optout:${input.phone}:${input.createdAt}`, kind: SMS_EVENT_KINDS.optOut, subject: subjectOf(input.phone), body: JSON.stringify(body), occurredAt: input.occurredAt };
}

export type SmsPayloadRead = { ok: true; events: InboundCandidate[] } | { ok: false; reason: string };

const unreadable: SmsPayloadRead = { ok: false, reason: 'unreadable-payload' };

export function readTwilioForm(form: URLSearchParams): SmsPayloadRead {
  const sid = form.get('MessageSid') ?? form.get('SmsSid');
  if (sid === null || !TWILIO_SID.test(sid)) return unreadable;
  const status = form.get('MessageStatus');
  if (status !== null) {
    if (!STATUS_WORD.test(status)) return unreadable;
    const code = form.get('ErrorCode');
    return {
      ok: true,
      events: [statusCandidate({ providerId: `status:${sid}:${status}`, messageId: sid, word: status, errorCode: code !== null && ERROR_CODE.test(code) ? code : null, to: text(form.get('To'), 64), occurredAt: null })],
    };
  }
  const from = text(form.get('From'), 64);
  const body = text(form.get('Body') ?? '', MAX_TEXT);
  if (from === null || from === '' || body === null) return unreadable;
  return {
    ok: true,
    events: [replyCandidate({ providerId: replyProviderId(sid), from, to: text(form.get('To'), 64), text: body, answered: (form.get('OptOutType') ?? '') !== '', via: 'webhook', occurredAt: null })],
  };
}

function dateOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * A genuine Telnyx delivery. `profile` is the connected messaging profile, and
 * `senders` the numbers this business sends from. An event stamped with another
 * profile of the same account is kept when it concerns one of those numbers.
 * A STOP or an opt-out code is kept whatever it is stamped with, because
 * dropping one would text someone who said no. Anything else there is not ours.
 */
export function readTelnyxBody(raw: Buffer, profile: string, senders: readonly string[] = []): SmsPayloadRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return unreadable;
  }
  const data = asRecord(asRecord(parsed)?.['data']);
  const payload = asRecord(data?.['payload']);
  if (data === null || payload === null) return unreadable;
  const id = data['id'];
  if (typeof id !== 'string' || !EVENT_ID.test(id)) return unreadable;
  const stated = payload['messaging_profile_id'];
  const otherProfile = typeof stated === 'string' && stated.toLowerCase() !== profile;

  const type = data['event_type'];
  const occurredAt = dateOf(data['occurred_at']);
  const first = Array.isArray(payload['to']) ? asRecord(payload['to'][0]) : null;
  const toNumber = text(first?.['phone_number'], 64);
  const addressed: unknown[] = Array.isArray(payload['to']) ? payload['to'].map((one) => asRecord(one)?.['phone_number']) : [];

  if (type === 'message.received') {
    const from = text(asRecord(payload['from'])?.['phone_number'], 64);
    const body = text(payload['text'] ?? '', MAX_TEXT);
    if (from === null || from === '' || body === null) return unreadable;
    if (otherProfile && !addressed.some((one) => typeof one === 'string' && senders.includes(one)) && readControlWord(body).kind !== 'stop') return { ok: true, events: [] };
    const answered = typeof payload['autoresponse_type'] === 'string' && payload['autoresponse_type'] !== '';
    return { ok: true, events: [replyCandidate({ providerId: id, from, to: toNumber, text: body, answered, via: 'webhook', occurredAt })] };
  }

  if (type === 'message.sent' || type === 'message.finalized') {
    const code = telnyxErrorCode(payload);
    const errorCode = code !== null && ERROR_CODE.test(code) ? code : null;
    const sentFrom = asRecord(payload['from'])?.['phone_number'];
    if (otherProfile && errorCode !== TELNYX_OPT_OUT && !(typeof sentFrom === 'string' && senders.includes(sentFrom))) return { ok: true, events: [] };
    const messageId = payload['id'];
    const word = first?.['status'];
    if (typeof messageId !== 'string' || !EVENT_ID.test(messageId) || typeof word !== 'string' || !STATUS_WORD.test(word)) return unreadable;
    return { ok: true, events: [statusCandidate({ providerId: id, messageId, word, errorCode, to: toNumber, occurredAt })] };
  }

  // Genuine, and not about a message's text or delivery.
  return { ok: true, events: [] };
}
