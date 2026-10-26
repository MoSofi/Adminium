// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Brevo (formerly Sendinblue).
 *
 * Brevo signs nothing; it offers credentials in the webhook's address, a
 * bearer token or extra headers (https://developers.brevo.com/docs/secured-webhooks).
 * Basic auth in the address works from its screens as well as its API, so
 * Adminium makes a user name and password the owner copies into Brevo, on top
 * of the long token in the address. As with Postmark, the credentials are the
 * gate: nothing signed, no time to check.
 *
 * Each event is one object (https://developers.brevo.com/docs/transactional-webhooks);
 * a webhook made with `batched: true` sends an array of them (its exact shape
 * is undocumented, so an array of the same objects is taken). The event name
 * is the kind: `hard_bounce` and `invalid_email` are permanent bounces,
 * `soft_bounce` is not, `spam` is a complaint, `unsubscribed` is Brevo's own
 * unsubscribe. `blocked` is Brevo refusing an address already on its own list,
 * which an earlier event put there: nothing new. The webhook settings spell
 * events in camel case (`hardBounce`), so both spellings are read.
 */
import { basicMatches, eventOf, isRecord, jsonOf, secondsTime, textOf, tokenMatches } from './common.js';
import type { NoticeEndpointConfig, NoticeEvent, NoticeEventKind, NoticeRequest, NoticeVerdict } from './types.js';

/** A Brevo event's name, in snake case: `hardBounce` reads as `hard_bounce`. */
const snake = (name: string): string => name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

/** A Map, not an object: an event named `constructor` must find nothing. */
const KINDS: ReadonlyMap<string, { kind: NoticeEventKind; permanent: boolean }> = new Map<string, { kind: NoticeEventKind; permanent: boolean }>([
  ['hard_bounce', { kind: 'bounce', permanent: true }],
  ['invalid_email', { kind: 'bounce', permanent: true }],
  ['soft_bounce', { kind: 'bounce', permanent: false }],
  ['spam', { kind: 'complaint', permanent: true }],
  ['unsubscribed', { kind: 'unsubscribe', permanent: true }],
]);

function brevoEvent(event: unknown): NoticeEvent[] | null {
  if (!isRecord(event) || typeof event['event'] !== 'string') return null;
  const found = KINDS.get(snake(event['event']));
  if (found === undefined) return [];
  const messageId = textOf(event['message-id']);
  // `ts_epoch` is in ms (UTC); `ts_event` and `ts` in seconds. `date` is in Brevo's own time zone, so it is not read.
  const epoch = event['ts_epoch'];
  const at = typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : secondsTime(event['ts_event'] ?? event['ts']);
  const id = messageId === null ? null : `${messageId}:${snake(event['event'])}`;
  return eventOf(event['email'], found.kind, found.permanent, id, at);
}

export function brevoEvents(body: unknown): NoticeEvent[] | null {
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0) return null;
  const out: NoticeEvent[] = [];
  for (const item of items) {
    const events = brevoEvent(item);
    if (events === null) return null;
    out.push(...events);
  }
  return out;
}

export function readBrevo(request: NoticeRequest, endpoint: NoticeEndpointConfig): NoticeVerdict {
  if (!tokenMatches(endpoint, request.pathToken)) return { genuine: false, why: 'wrong-token' };
  if (endpoint.basic === null) return { genuine: false, why: 'not-set-up' };
  if (!basicMatches(request, endpoint.basic)) return { genuine: false, why: 'wrong-credentials' };
  const events = brevoEvents(jsonOf(request.body));
  return events === null ? { genuine: false, why: 'malformed' } : { genuine: true, events };
}
