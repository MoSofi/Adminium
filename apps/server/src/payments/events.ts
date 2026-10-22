// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a stored payment event sets going, wherever it was stored from (the
 * webhook, the sweep's missed events, the redrive).
 *
 * ─── AN EVENT THAT OUTRAN ITS PAYMENT ──────────────────────────────────────
 *
 * A provider names a payment two ways: by its checkout (known from the moment
 * Adminium made it) and by the money itself (a PaymentIntent, a capture),
 * which Adminium learns only when the settle job asks how the checkout went.
 * A dispute or a refund names the money only. A card that disputes at once
 * (Stripe's 0259 test card, a fraud alert) or a refund made in the dashboard
 * a second after the payment can arrive before the settle job wrote that
 * reference down: matched by nothing, it would be answered 200 and lost (the
 * provider never sends it again).
 *
 * So such an event is stored with no attempt, keyed by the money it names,
 * and is followed the moment an attempt takes that reference
 * ({@link followUnattached}). The sweep tries the match again on each run,
 * and after {@link UNATTACHED_GIVE_UP_MS} an event still about no payment
 * Adminium holds (the shop's other software, a staging install) is marked
 * handled; the row is kept until retention removes it.
 */
import { DISPUTE_STATUSES, type PaymentDispute, type PaymentMode } from '@adminium/add-on-contracts';
import { isDuplicateKeyError, paymentEventsRepo, type MetaDb, type PaymentAttempt, type PaymentEventRow } from '@adminium/meta';

import type { NoticeDeps } from './notices.js';
import { disputeEvent, enqueueRefund } from './refunds.js';

export const PAYMENTS_SETTLE_JOB = 'payments.settle';
export const PAYMENTS_SETTLE_MAX_ATTEMPTS = 20;

/** An event stored with no payment known is given up after this long (the longest a checkout can live). */
export const UNATTACHED_GIVE_UP_MS = 48 * 60 * 60_000;

export type Enqueue = (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;

export interface FollowDeps {
  meta: MetaDb;
  enqueue: Enqueue;
  /** Who is told of a dispute. */
  notices?: NoticeDeps;
  now?: () => number;
}

/** Queues a settle for an attempt. A second queue for the same attempt while one waits is "already queued". */
export async function enqueueSettle(enqueue: Enqueue, attemptId: string, eventId: string | null): Promise<boolean> {
  try {
    await enqueue({
      kind: PAYMENTS_SETTLE_JOB,
      payload: { attemptId, ...(eventId === null ? {} : { eventId }) },
      dedupeKey: `payments-settle:${attemptId}`,
      maxAttempts: PAYMENTS_SETTLE_MAX_ATTEMPTS,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/** Whether an event about no known payment is kept until its payment is: a dispute or refund that names the money. */
export function keptUnattached(event: { kind: string; paymentRef: string | null }): boolean {
  return (event.kind === 'dispute' || event.kind === 'refund') && event.paymentRef !== null;
}

/**
 * What a stored event's body keeps: of a dispute event, when it happened and
 * its news as the provider said it (it is followed from the row, perhaps
 * later). Nothing of any other event: a body that verified no status is not
 * kept.
 */
export function eventBodyOf(event: { kind: string; occurredAt: number; dispute?: PaymentDispute | undefined }): { occurredAt: number; dispute?: PaymentDispute } | null {
  if (event.kind !== 'dispute') return null;
  return { occurredAt: event.occurredAt, ...(event.dispute === undefined ? {} : { dispute: event.dispute }) };
}

/** When a stored event happened, as its body says, else when it was received. */
export function occurredAtOf(event: { body?: unknown; receivedAt: number }): number {
  const at = (event.body as { occurredAt?: unknown } | null | undefined)?.occurredAt;
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : event.receivedAt;
}

/** A stored event's dispute news, or null (an add-on that does not say, a body from before this was kept). */
export function disputeOfBody(body: unknown): PaymentDispute | null {
  const dispute = (body as { dispute?: unknown } | null)?.dispute as Record<string, unknown> | undefined;
  if (typeof dispute !== 'object' || dispute === null) return null;
  const status = dispute['status'];
  if (typeof status !== 'string' || !(DISPUTE_STATUSES as readonly string[]).includes(status)) return null;
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  return { status: status as PaymentDispute['status'], amount: text(dispute['amount']), currency: text(dispute['currency']) };
}

/**
 * What a stored event sets going: a refund event the refund job (which asks
 * the provider); a dispute event marks its payment disputed (nothing to ask:
 * the event is what there is); anything else the settle job. An event about
 * nothing Adminium holds is marked handled, so it is never left as work.
 */
export async function followEvent(
  deps: FollowDeps,
  event: Pick<PaymentEventRow, 'id' | 'provider' | 'mode' | 'kind' | 'type' | 'refundRef'> & { body?: unknown },
  attempt: PaymentAttempt | null,
  occurredAt: number,
): Promise<boolean> {
  const at = (deps.now ?? Date.now)();
  if (event.kind === 'refund' && event.refundRef !== null) {
    return enqueueRefund(deps.enqueue, { provider: event.provider, mode: event.mode as PaymentMode, refundRef: event.refundRef, eventId: event.id });
  }
  if (event.kind === 'dispute' && attempt !== null) {
    await disputeEvent(deps, attempt, { type: event.type, occurredAt, dispute: disputeOfBody(event.body) });
    await paymentEventsRepo(deps.meta).markProcessed(event.id, at);
    return true;
  }
  // Anything else about a payment, a refund event that names no refund among it, is the settle job's.
  if (attempt !== null && event.kind !== 'dispute') return enqueueSettle(deps.enqueue, attempt.id, event.id);
  await paymentEventsRepo(deps.meta).markProcessed(event.id, at);
  return false;
}

/**
 * An attempt just learned which money it took: the events that arrived about
 * that money before it did are tied to it and followed now. Never throws: a
 * failure here leaves them to the sweep.
 */
export async function followUnattached(deps: FollowDeps, attempt: PaymentAttempt): Promise<number> {
  if (attempt.paymentRef === null) return 0;
  const events = paymentEventsRepo(deps.meta);
  let followed = 0;
  try {
    for (const event of await events.unattached(attempt.provider, attempt.mode, attempt.paymentRef)) {
      // Another process tied it first: theirs follows it.
      if (!(await events.attach(event.id, attempt.id))) continue;
      await followEvent(deps, event, attempt, occurredAtOf(event));
      followed += 1;
    }
  } catch {
    // Left stored and unprocessed: the sweep ties and follows it on its next run.
  }
  return followed;
}
