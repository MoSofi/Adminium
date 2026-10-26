// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mailgun.
 *
 * Mailgun signs each call with the account's webhook signing key: an
 * HMAC-SHA256 over `timestamp + token`, hex in `signature.signature`
 * (https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks).
 * The owner pastes that key.
 *
 * The signature covers the timestamp and the token, NOT the body. A
 * signature seen once could be sent again with another body, naming any
 * address. So a signature is taken only inside the time window, and only
 * once (its token is claimed); together they make a captured signature
 * useless. Whether Mailgun signs a retry afresh is not documented; the window
 * is wide enough for its first retries either way.
 *
 * One event per call, in `event-data`:
 *   - `failed` with `severity: permanent` is a permanent bounce (including a
 *     send Mailgun dropped because the address is on its own list); with
 *     `temporary`, not permanent;
 *   - `complained`: a complaint;
 *   - `unsubscribed`: Mailgun's own unsubscribe link.
 */
import { createHmac } from 'node:crypto';

import { eventOf, isRecord, jsonOf, sameSecret, secondsTime, textOf, tokenMatches } from './common.js';
import type { NoticeEndpointConfig, NoticeEvent, NoticeRequest, NoticeVerdict, ReplayGuard } from './types.js';

/** How old a signature may be. */
export const MAILGUN_WINDOW_MS = 15 * 60 * 1000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

export interface MailgunReaderDeps {
  now: () => number;
  replays: ReplayGuard;
}

export function mailgunEvents(data: unknown): NoticeEvent[] | null {
  if (!isRecord(data) || typeof data['event'] !== 'string') return null;
  const id = textOf(data['id']);
  const at = secondsTime(data['timestamp']);
  switch (data['event']) {
    case 'failed':
    case 'permanent_fail':
    case 'temporary_fail': {
      const permanent = data['severity'] === 'permanent' || data['event'] === 'permanent_fail';
      return eventOf(data['recipient'], 'bounce', permanent, id, at);
    }
    case 'complained':
      return eventOf(data['recipient'], 'complaint', true, id, at);
    case 'unsubscribed':
      return eventOf(data['recipient'], 'unsubscribe', true, id, at);
    default:
      return [];
  }
}

export function readMailgun(request: NoticeRequest, endpoint: NoticeEndpointConfig, deps: MailgunReaderDeps): NoticeVerdict {
  if (!tokenMatches(endpoint, request.pathToken)) return { genuine: false, why: 'wrong-token' };
  if (endpoint.signingKey === null) return { genuine: false, why: 'not-set-up' };
  const body = jsonOf(request.body);
  if (!isRecord(body) || !isRecord(body['signature'])) return { genuine: false, why: 'malformed' };
  const signed = body['signature'];
  const timestamp = textOf(signed['timestamp']);
  const token = textOf(signed['token']);
  const signature = textOf(signed['signature']);
  if (timestamp === null || token === null || signature === null || !/^\d+$/.test(timestamp)) return { genuine: false, why: 'malformed' };

  const expected = createHmac('sha256', endpoint.signingKey).update(timestamp + token).digest('hex');
  if (!sameSecret(signature.toLowerCase(), expected)) return { genuine: false, why: 'bad-signature' };

  const now = deps.now();
  const at = Number(timestamp) * 1000;
  if (now - at > MAILGUN_WINDOW_MS || at - now > FUTURE_SLACK_MS) return { genuine: false, why: 'stale' };
  if (!deps.replays.claim(`mailgun:${token}`, at + MAILGUN_WINDOW_MS + FUTURE_SLACK_MS)) return { genuine: false, why: 'replay' };

  const events = mailgunEvents(body['event-data']);
  return events === null ? { genuine: false, why: 'malformed' } : { genuine: true, events };
}
