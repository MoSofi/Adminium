// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE TEXT A STOPPED PERSON MAY GET: the plain confirmation of their STOP.
 *
 * Every other text is refused for someone on the stop list, so this is a door
 * of its own, and a narrow one. It sends only the fixed confirmation, only to a
 * number whose own STOP is on the list, only before the time the inbound side
 * gave, and at most once for one STOP. A try that may have gone is never
 * repeated. It takes no slot of the daily limit, because a business at its
 * limit still owes this answer.
 */
import { createHmac } from 'node:crypto';

import type { AddressHash } from '@adminium/meta';

import { parsePhone } from '../../phone/index.js';
import { maskPhone } from '../consent/redact.js';
import { accountRefOf } from '../credentials.js';
import { SMS_STOP_CONFIRMATION, type SmsStopConfirmation } from '../inbound/stop-reply.js';
import type { SmsService } from '../service.js';
import type { SmsSender } from '../types.js';
import type { HandOverDeps } from './handover.js';
import { estimateLength, limitsFor } from './length.js';
import { isFailedStatus } from './store.js';

const E164 = /^\+[1-9][0-9]{6,14}$/;

export type StopConfirmOutcome =
  | { sent: true; deliveryId: string }
  | { sent: false; reason: 'not-the-confirmation' | 'too-late' | 'off-by-operator' | 'not-stopped' | 'not-connected' | 'no-sender' | 'already-asked' | 'busy' | 'refused' | 'not-taken' | 'unknown' };

export interface StopConfirmDeps extends Pick<HandOverDeps, 'consent' | 'store' | 'secret' | 'operatorAllows' | 'callbackUrl' | 'now'> {
  sms: Pick<SmsService, 'send' | 'credentials' | 'view'>;
  phoneKeys: { forWrite(e164: string): Promise<AddressHash> };
}

export function createStopConfirmer(deps: StopConfirmDeps) {
  const now = deps.now ?? Date.now;
  const { store } = deps;
  const keyed = (purpose: string, value: string): string => createHmac('sha256', deps.secret).update(`adminium:text-delivery:${purpose}:${value}`).digest('hex');

  return async function confirmStop(request: SmsStopConfirmation): Promise<StopConfirmOutcome> {
    if (request.body !== SMS_STOP_CONFIRMATION) return { sent: false, reason: 'not-the-confirmation' };
    if (now() >= request.sendBy) return { sent: false, reason: 'too-late' };
    if (!deps.operatorAllows()) return { sent: false, reason: 'off-by-operator' };
    if (!E164.test(request.to)) return { sent: false, reason: 'not-stopped' };

    const entry = await deps.consent.stop.entryFor(request.to, null);
    if (entry === null || entry.reason !== 'text-stop' || entry.phone !== request.to) return { sent: false, reason: 'not-stopped' };

    const view = await deps.sms.view();
    if (view === null || !view.keyReadable) return { sent: false, reason: 'not-connected' };
    // The number they texted, so the answer comes from the same one.
    const sender: SmsSender | null = request.from !== null && E164.test(request.from) ? { kind: 'number', value: request.from } : view.sender;
    if (sender === null) return { sent: false, reason: 'no-sender' };

    let callbackUrl: string | null = null;
    try {
      callbackUrl = (await deps.callbackUrl?.()) ?? null;
    } catch {
      // A report is a nicety here. The confirmation has minutes to go.
    }

    const at = now();
    const parsed = parsePhone(request.to, null);
    const estimate = estimateLength(request.body, limitsFor(parsed.ok ? parsed.country : 'ZZ', sender));
    const made = await store.create({
      claimHash: keyed('stop-confirm-claim', request.dedupeKey),
      messageHash: keyed('stop-confirm-message', request.dedupeKey),
      phone: await deps.phoneKeys.forWrite(request.to),
      phoneMasked: maskPhone(request.to),
      textClass: 'service',
      estimatedSegments: estimate.segments,
      encoding: estimate.encoding,
      reportTarget: null,
      createdAt: at,
    });
    // Asked before, whatever became of it: at most one.
    if (made.row === null || !made.created) return { sent: false, reason: 'already-asked' };
    const row = made.row;

    const credentials = await deps.sms.credentials();
    const handedAt = now();
    const marked = await store.begin(row.id, row.version, { at: handedAt, account: credentials === null ? null : accountRefOf(credentials), earlier: null });
    if (marked === null) return { sent: false, reason: 'busy' };

    // A throw leaves the marker standing, and the sweep turns it into `unknown`.
    const result = await deps.sms.send({ to: request.to, body: request.body, idempotencyKey: row.id, sender, callbackUrl, earlier: null });
    switch (result.outcome) {
      case 'accepted':
        await store.accept(row.id, {
          state: isFailedStatus(result.status) ? 'provider-failed' : 'accepted',
          provider: result.provider,
          messageId: result.messageId,
          status: result.status,
          segments: result.segments,
          price: result.price,
          at: now(),
        });
        return { sent: true, deliveryId: row.id };
      case 'refused':
        await store.settle(row.id, marked.version, { state: 'refused', reason: result.reason, at: now(), clearMarker: true, provider: result.provider });
        return { sent: false, reason: 'refused' };
      case 'not-taken':
        await store.settle(row.id, marked.version, { state: 'not-sent', reason: result.reason, at: now(), clearMarker: true, provider: result.provider });
        return { sent: false, reason: 'not-taken' };
      case 'unknown':
        await store.settle(row.id, marked.version, { state: 'unknown', reason: result.reason, at: now(), clearMarker: true, provider: result.provider, mayHaveGone: { at: handedAt, account: result.account } });
        return { sent: false, reason: 'unknown' };
    }
  };
}
