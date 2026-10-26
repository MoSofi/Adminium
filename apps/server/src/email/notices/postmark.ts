// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Postmark.
 *
 * Postmark signs nothing ("Postmark does not currently support HMAC webhook
 * signature verification", https://postmarkapp.com/developer/webhooks/webhooks-overview).
 * So Adminium makes a user name and password and the owner copies them into
 * Postmark's webhook (basic auth), on top of the long token in the address.
 * Both are checked in constant time. With nothing signed there is no time to
 * check and no replay to tell from a retry: the credentials are the gate.
 *
 * One record per call:
 *   - `Bounce`: `TypeCode` 1 (HardBounce) is permanent; every other bounce
 *     type (soft, transient, auto-reply, …) is not
 *     (https://postmarkapp.com/developer/webhooks/bounce-webhook);
 *   - `SpamComplaint`: a complaint;
 *   - `SubscriptionChange` with `SuppressSending: true`: Postmark stopped the
 *     address, for `HardBounce`, `SpamComplaint` or `ManualSuppression` (an
 *     unsubscribe through Postmark's own link or a person in Postmark's
 *     screens). This is the one record that carries Postmark's own
 *     unsubscribes, so it feeds the list too. `SuppressSending: false` (Postmark
 *     lifted it) changes nothing here: only the person's new yes does.
 *     (https://postmarkapp.com/developer/webhooks/subscription-change-webhook)
 *
 * `ID` is a 64-bit number JSON cannot hold exactly, so the event's id is the
 * message's `MessageID` with the record's type.
 */
import { basicMatches, eventOf, isRecord, isoTime, jsonOf, textOf, tokenMatches } from './common.js';
import type { NoticeEndpointConfig, NoticeEvent, NoticeRequest, NoticeVerdict } from './types.js';

/** Postmark's `TypeCode` for a hard bounce. */
const HARD_BOUNCE = 1;

export function postmarkEvents(record: unknown): NoticeEvent[] | null {
  if (!isRecord(record) || typeof record['RecordType'] !== 'string') return null;
  const messageId = textOf(record['MessageID']);
  const id = messageId === null ? null : `${messageId}:${record['RecordType']}`;
  switch (record['RecordType']) {
    case 'Bounce':
      return eventOf(record['Email'], 'bounce', record['TypeCode'] === HARD_BOUNCE, id, isoTime(record['BouncedAt']));
    case 'SpamComplaint':
      return eventOf(record['Email'], 'complaint', true, id, isoTime(record['BouncedAt']));
    case 'SubscriptionChange': {
      if (record['SuppressSending'] !== true) return [];
      const reason = record['SuppressionReason'];
      const kind = reason === 'HardBounce' ? 'bounce' : reason === 'SpamComplaint' ? 'complaint' : 'unsubscribe';
      return eventOf(record['Recipient'], kind, true, id, isoTime(record['ChangedAt']));
    }
    default:
      // Deliveries, opens, clicks: nothing for the list.
      return [];
  }
}

export function readPostmark(request: NoticeRequest, endpoint: NoticeEndpointConfig): NoticeVerdict {
  if (!tokenMatches(endpoint, request.pathToken)) return { genuine: false, why: 'wrong-token' };
  if (endpoint.basic === null) return { genuine: false, why: 'not-set-up' };
  if (!basicMatches(request, endpoint.basic)) return { genuine: false, why: 'wrong-credentials' };
  const events = postmarkEvents(jsonOf(request.body));
  return events === null ? { genuine: false, why: 'malformed' } : { genuine: true, events };
}
