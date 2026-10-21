// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The safety sweep: what a webhook that never arrived would have said.
 *
 * One job per payment service and mode (`payments-sweep:<service>:<mode>`),
 * so a second process skips a run already queued. Each run:
 *
 *   1. reads the provider's list of events whose webhook failed, from a
 *      stored cursor, a few pages at most, and settles the attempts they are
 *      about (stored as `sweep` events: the same row a late webhook finds);
 *   2. asks the provider again about attempts that have sat open or
 *      processing for a while (the events list does not reach everything:
 *      PayPal keeps no list worth trusting, and Stripe's goes back 30 days);
 *   3. lets go of attempts that never got a checkout (`creating` for too long:
 *      nobody holds their page);
 *   4. queues the settle again for stored events nobody processed.
 *
 * ─── HOW OFTEN, AND THE READ BUDGET ────────────────────────────────────────
 *
 * Every 15 minutes while any attempt of that service and mode is open; hourly
 * while only processing ones are left; not at all when nothing waits. Every
 * call to the provider is counted per calendar month. Stripe meters reads
 * (on average no more than 500 per transaction over 30 days, and at least
 * 10,000 a month, shared with the shop's other software), so past half of
 * `max(10,000, 500 × payments this month)` the per-attempt look-ups run at
 * the slow cadence only, and the setup page warns.
 */
import { isProviderError, type PaymentMode } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, paymentEventsRepo, paymentSettingsRepo, type MetaDb, type PaymentAttempt } from '@adminium/meta';
import { z } from 'zod';

import type { JobRegistry } from '../jobs/registry.js';
import type { CheckoutService } from './checkout.js';
import type { ProviderLookup } from './providers.js';
import { enqueueSettle, type WebhookDeps } from './webhook.js';

export const PAYMENTS_SWEEP_JOB = 'payments.sweep';
export const PAYMENTS_SWEEP_PLAN_NAME = 'payments-sweep-plan';
export const PAYMENTS_SWEEP_PLAN_CRON = '*/5 * * * *';

/** While anything is open. */
export const SWEEP_OPEN_EVERY_MS = 15 * 60_000;
/** While only processing payments are left. */
export const SWEEP_PROCESSING_EVERY_MS = 60 * 60_000;
/** An open attempt is looked up on its own once it has waited this long. */
export const LOOK_UP_AFTER_MS = 10 * 60_000;
/** A `creating` attempt with no checkout after this long is let go. */
export const ABANDON_AFTER_MS = 15 * 60_000;
/** A stored event nobody processed after this long is queued again. */
export const REDRIVE_AFTER_MS = 10 * 60_000;
/** Pages of missed events read per run. */
export const PAGES_PER_RUN = 3;
/** The floor of Stripe's monthly read allowance, and the share of it where the sweep slows. */
export const READS_FLOOR = 10_000;
export const READS_PER_TRANSACTION = 500;
export const READS_SLOW_SHARE = 0.5;

export const sweepStateSchema = z
  .object({
    cursor: z.string().max(1024).nullable(),
    lastRunAt: z.number().int().nonnegative().nullable(),
    /** `YYYY-MM` of the month `reads` counts. */
    month: z.string().regex(/^\d{4}-\d{2}$/),
    reads: z.number().int().nonnegative(),
    /** The sweep settled an attempt no webhook had announced: the webhook is not reaching this server. */
    caughtAt: z.number().int().nonnegative().nullable(),
    /** The reads passed the slow share this month. */
    slowed: z.boolean(),
  })
  .strict();
export type SweepState = z.infer<typeof sweepStateSchema>;

export function sweepDocName(key: string, mode: PaymentMode): string {
  return `sweep:${key}:${mode}`;
}

function monthOf(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

export interface SweepDeps {
  meta: MetaDb;
  checkout: CheckoutService;
  providerFor: (key: string, mode: PaymentMode) => Promise<ProviderLookup>;
  enqueue: WebhookDeps['enqueue'];
  now?: () => number;
}

export interface SweepResult {
  events: number;
  lookedUp: number;
  abandoned: number;
  redriven: number;
  reads: number;
}

/** The attempts of one service and mode still waiting on the provider. */
async function waiting(meta: MetaDb, key: string, mode: PaymentMode, before: number): Promise<PaymentAttempt[]> {
  const stale = await paymentAttemptsRepo(meta).stale(['open', 'processing'], before, 200);
  return stale.filter((attempt) => attempt.provider === key && attempt.mode === mode);
}

/** Payments recorded this calendar month for one service and mode: what the read allowance grows with. */
async function recordedThisMonth(meta: MetaDb, key: string, mode: PaymentMode, at: number): Promise<number> {
  const start = Date.parse(`${monthOf(at)}-01T00:00:00.000Z`);
  const row = await meta.db
    .selectFrom('adminium_payment_attempts')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('provider', '=', key)
    .where('mode', '=', mode)
    .where('state', '=', 'recorded')
    .where('recordedAt', '>=', start)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** One run for one service and mode. */
export async function runSweep(deps: SweepDeps, key: string, mode: PaymentMode): Promise<SweepResult> {
  const now = deps.now ?? (() => Date.now());
  const at = now();
  const docs = paymentSettingsRepo(deps.meta);
  const attempts = paymentAttemptsRepo(deps.meta);
  const events = paymentEventsRepo(deps.meta);
  let state = (await docs.get(sweepDocName(key, mode), sweepStateSchema)) ?? { cursor: null, lastRunAt: null, month: monthOf(at), reads: 0, caughtAt: null, slowed: false };
  if (state.month !== monthOf(at)) state = { ...state, month: monthOf(at), reads: 0, slowed: false };
  const result: SweepResult = { events: 0, lookedUp: 0, abandoned: 0, redriven: 0, reads: 0 };
  const lookup = await deps.providerFor(key, mode);

  // 1. Missed events, from the cursor.
  if (lookup.ok) {
    let cursor = state.cursor;
    for (let page = 0; page < PAGES_PER_RUN; page += 1) {
      const answer = await lookup.provider.listMissedEvents(cursor);
      result.reads += 1;
      if (isProviderError(answer)) break;
      for (const event of answer.events) {
        const attempt =
          (event.checkoutRef === null ? null : await attempts.byProviderRef(key, mode, event.checkoutRef)) ??
          (event.paymentRef === null ? null : await attempts.byPaymentRef(key, mode, event.paymentRef));
        if (attempt === null) continue;
        const stored = await events.record(
          { provider: key, mode, eventId: event.eventId, type: event.type, kind: event.kind, checkoutRef: event.checkoutRef, paymentRef: event.paymentRef, refundRef: event.refundRef, attemptId: attempt.id, source: 'sweep', body: null },
          at,
        );
        if (!stored.fresh) continue;
        result.events += 1;
        await enqueueSettle(deps.enqueue, attempt.id, stored.event.id);
        // The webhook never brought this one: it is not reaching this server.
        state = { ...state, caughtAt: at };
      }
      cursor = answer.cursor;
      if (!answer.more) break;
    }
    state = { ...state, cursor };
  }

  // 2. Attempts waiting on the provider, looked up one by one — unless the reads are past the slow share.
  const payments = await recordedThisMonth(deps.meta, key, mode, at);
  const allowance = Math.max(READS_FLOOR, READS_PER_TRANSACTION * payments);
  const slowed = state.reads + result.reads > allowance * READS_SLOW_SHARE;
  const lastRun = state.lastRunAt ?? 0;
  if (lookup.ok && (!slowed || at - lastRun >= SWEEP_PROCESSING_EVERY_MS)) {
    for (const attempt of await waiting(deps.meta, key, mode, at - LOOK_UP_AFTER_MS)) {
      await deps.checkout.settle(attempt.id);
      result.lookedUp += 1;
      result.reads += 1;
    }
  }

  // 3. Attempts that never got a checkout.
  for (const attempt of await attempts.stale(['creating'], at - ABANDON_AFTER_MS, 200)) {
    if (attempt.provider !== key || attempt.mode !== mode || attempt.providerRef !== null) continue;
    if (await attempts.move(attempt.id, 'abandoned', {}, at)) result.abandoned += 1;
  }

  // 4. Stored events nobody processed.
  for (const event of await events.unprocessed(at - REDRIVE_AFTER_MS, 200)) {
    if (event.provider !== key || event.mode !== mode || event.attemptId === null) continue;
    if (await enqueueSettle(deps.enqueue, event.attemptId, event.id)) result.redriven += 1;
  }

  await docs.set(sweepDocName(key, mode), sweepStateSchema, { ...state, lastRunAt: at, reads: state.reads + result.reads, slowed: slowed || state.slowed }, at);
  return result;
}

/** Whether a service and mode is due a run now, by what waits on it. */
export async function sweepDue(meta: MetaDb, key: string, mode: PaymentMode, at: number): Promise<boolean> {
  const state = await paymentSettingsRepo(meta).get(sweepDocName(key, mode), sweepStateSchema);
  const since = at - (state?.lastRunAt ?? 0);
  const all = (await paymentAttemptsRepo(meta).stale(['creating', 'open', 'processing'], at + 1, 500)).filter((attempt) => attempt.provider === key && attempt.mode === mode);
  if (all.some((attempt) => attempt.state === 'open' || attempt.state === 'creating')) return since >= SWEEP_OPEN_EVERY_MS;
  if (all.length > 0) return since >= SWEEP_PROCESSING_EVERY_MS;
  // Unprocessed events still count as work.
  const unprocessed = (await paymentEventsRepo(meta).unprocessed(at - REDRIVE_AFTER_MS, 1)).length > 0;
  return unprocessed && since >= SWEEP_OPEN_EVERY_MS;
}

const sweepPayload = z.object({ key: z.string().min(1), mode: z.enum(['test', 'live']) });

export function registerPaymentsSweepHandler(registry: JobRegistry, deps: SweepDeps): void {
  registry.registerJobHandler(PAYMENTS_SWEEP_JOB, sweepPayload, async (payload) => ({ ...(await runSweep(deps, payload.key, payload.mode)) }), { internal: true });
}

/** Queues a run for every service and mode that is due one. */
export async function planSweeps(
  deps: Pick<SweepDeps, 'meta' | 'enqueue' | 'now'>,
  services: readonly { key: string; mode: PaymentMode }[],
): Promise<number> {
  const at = (deps.now ?? Date.now)();
  let queued = 0;
  for (const { key, mode } of services) {
    if (!(await sweepDue(deps.meta, key, mode, at))) continue;
    try {
      await deps.enqueue({ kind: PAYMENTS_SWEEP_JOB, payload: { key, mode }, dedupeKey: `payments-sweep:${key}:${mode}`, maxAttempts: 3 });
      queued += 1;
    } catch {
      // Already queued by another process: theirs runs.
    }
  }
  return queued;
}
