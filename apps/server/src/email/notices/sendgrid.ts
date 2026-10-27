// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SendGrid (Twilio).
 *
 * SendGrid's signed event webhook signs `timestamp + the raw body` with
 * ECDSA (P-256, SHA-256); the signature (base64 DER) and the timestamp come
 * in `X-Twilio-Email-Event-Webhook-Signature` and `…-Timestamp`
 * (https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features).
 * The owner pastes the PUBLIC verification key from SendGrid's settings: it
 * proves calls, it opens nothing, so it is kept as it is.
 *
 * The body is always an array of events. Their kinds
 * (https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event):
 *   - `bounce` with `type: bounce` is a hard bounce; `type: blocked` is SendGrid's
 *     soft bounce, not permanent. A `bounce` with no `type` (older senders) is hard;
 *   - `dropped`: SendGrid did not send. Its `reason` says why, and only some
 *     reasons are about the address: "Bounced Address" and "Invalid" (a bounce),
 *     "Spam Reporting Address" (a complaint), "Unsubscribed Address" and
 *     "Unsubscribed Group" (an unsubscribe) are permanent. Any other reason (a
 *     quota, the content, a bad header) is about the send, so it is a bounce
 *     that is not permanent;
 *   - `spamreport`: a complaint;
 *   - `unsubscribe` and `group_unsubscribe`: SendGrid's own unsubscribe.
 */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

import { eventOf, headerOf, isRecord, jsonOf, secondsTime, textOf, tokenMatches } from './common.js';
import type { NoticeEndpointConfig, NoticeEvent, NoticeEventKind, NoticeRequest, NoticeVerdict, ReplayGuard } from './types.js';

export const SENDGRID_WINDOW_MS = 15 * 60 * 1000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;
export const SENDGRID_SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
export const SENDGRID_TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

export interface SendgridReaderDeps {
  now: () => number;
  replays: ReplayGuard;
}

/**
 * The verification key as a key object, or null when it is not a P-256 public
 * key. SendGrid shows it as base64 of its DER; a PEM is taken too.
 */
export function sendgridKeyOf(raw: string): KeyObject | null {
  const text = raw.trim();
  try {
    const key = text.startsWith('-----BEGIN')
      ? createPublicKey(text)
      : createPublicKey({ key: Buffer.from(text.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : null;
  } catch {
    return null;
  }
}

/** A `dropped` event's reason, as SendGrid words it, to what it means for the address. A Map: a reason named `constructor` finds nothing. */
const DROPPED: ReadonlyMap<string, NoticeEventKind> = new Map<string, NoticeEventKind>([
  ['bounced address', 'bounce'],
  ['invalid', 'bounce'],
  ['invalid address', 'bounce'],
  ['spam reporting address', 'complaint'],
  ['unsubscribed address', 'unsubscribe'],
  ['unsubscribed group', 'unsubscribe'],
]);

function sendgridEvent(event: unknown): NoticeEvent[] | null {
  if (!isRecord(event) || typeof event['event'] !== 'string') return null;
  const id = textOf(event['sg_event_id']);
  const at = secondsTime(event['timestamp']);
  // `smtp-id` is the Message-ID the mail was sent with; some events (a spam report, an unsubscribe) may not carry it.
  const message = textOf(event['smtp-id']);
  switch (event['event']) {
    case 'bounce':
      return eventOf(event['email'], 'bounce', event['type'] !== 'blocked', id, at, message);
    case 'dropped': {
      const kind = DROPPED.get((textOf(event['reason']) ?? '').trim().toLowerCase());
      return kind === undefined ? eventOf(event['email'], 'bounce', false, id, at, message) : eventOf(event['email'], kind, true, id, at, message);
    }
    case 'spamreport':
      return eventOf(event['email'], 'complaint', true, id, at, message);
    case 'unsubscribe':
    case 'group_unsubscribe':
      return eventOf(event['email'], 'unsubscribe', true, id, at, message);
    default:
      return [];
  }
}

export function sendgridEvents(body: unknown): NoticeEvent[] | null {
  if (!Array.isArray(body)) return null;
  const out: NoticeEvent[] = [];
  for (const item of body) {
    const events = sendgridEvent(item);
    if (events === null) return null;
    out.push(...events);
  }
  return out;
}

export function readSendgrid(request: NoticeRequest, endpoint: NoticeEndpointConfig, deps: SendgridReaderDeps): NoticeVerdict {
  if (!tokenMatches(endpoint, request.pathToken)) return { genuine: false, why: 'wrong-token' };
  const key = endpoint.verificationKey === null ? null : sendgridKeyOf(endpoint.verificationKey);
  if (key === null) return { genuine: false, why: 'not-set-up' };
  const signature = headerOf(request, SENDGRID_SIGNATURE_HEADER);
  const timestamp = headerOf(request, SENDGRID_TIMESTAMP_HEADER);
  if (signature === null || timestamp === null || !/^\d+$/.test(timestamp.trim())) return { genuine: false, why: 'malformed' };

  let verified = false;
  try {
    verified = verify('sha256', Buffer.concat([Buffer.from(timestamp.trim(), 'utf8'), request.body]), key, Buffer.from(signature.trim(), 'base64'));
  } catch {
    verified = false;
  }
  if (!verified) return { genuine: false, why: 'bad-signature' };

  const now = deps.now();
  const at = Number(timestamp.trim()) * 1000;
  if (now - at > SENDGRID_WINDOW_MS || at - now > FUTURE_SLACK_MS) return { genuine: false, why: 'stale' };
  // Keyed by what was signed, not by the signature: an ECDSA signature can be re-encoded and still verify.
  const signedDigest = createHash('sha256').update(timestamp.trim()).update(request.body).digest('hex');
  if (!deps.replays.claim(`sendgrid:${signedDigest}`, at + SENDGRID_WINDOW_MS + FUTURE_SLACK_MS)) return { genuine: false, why: 'replay' };

  const events = sendgridEvents(jsonOf(request.body));
  return events === null ? { genuine: false, why: 'malformed' } : { genuine: true, events };
}
