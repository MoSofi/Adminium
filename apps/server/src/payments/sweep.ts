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
 *      processing for a while, the longest-unasked first (the events list
 *      does not reach everything: PayPal keeps no list worth trusting, and
 *      Stripe's goes back 30 days), and, hourly, about declined attempts
 *      whose provider page may still be open (a later card may succeed
 *      there);
 *   3. queues the settle again for stored events nobody processed; ties an
 *      event stored before its payment was known (`events.ts`) to the attempt
 *      that has since taken its money, and follows it.
 *
 * An event about no payment Adminium holds is given up after
 * `UNATTACHED_GIVE_UP_MS` (by the planner, for every service at once): marked
 * handled, the row kept until retention.
 *
 * Attempts that never got a checkout (`creating` for too long: nobody holds
 * their page) are let go by the planner, for every service at once.
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
import { DEMO_PAYMENT_KEY, isProviderError, type PaymentMode } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, paymentEventsRepo, paymentSettingsRepo, refundsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import type { JobRegistry } from '../jobs/registry.js';
import { MAX_CHECKOUT_LIFE_MS, type CheckoutService } from './checkout.js';
import { eventBodyOf, followEvent, followUnattached, keptUnattached, occurredAtOf, UNATTACHED_GIVE_UP_MS, type Enqueue } from './events.js';
import type { NoticeDeps } from './notices.js';
import type { ProviderLookup } from './providers.js';
import { serviceDocName, serviceStateSchema } from './services.js';

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
    /** The last time attempts were looked up one by one (the slow cadence counts from here, not from any run). */
    lastLookupAt: z.number().int().nonnegative().nullable().default(null),
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
  enqueue: Enqueue;
  /** Who is told of a dispute the sweep finds. */
  notices?: NoticeDeps;
  now?: () => number;
}

export interface SweepResult {
  events: number;
  lookedUp: number;
  redriven: number;
  reads: number;
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
  const empty: SweepState = { cursor: null, lastRunAt: null, month: monthOf(at), reads: 0, caughtAt: null, slowed: false, lastLookupAt: null };
  let state: SweepState = (await docs.get(sweepDocName(key, mode), sweepStateSchema)) ?? empty;
  if (state.month !== monthOf(at)) state = { ...state, month: monthOf(at), reads: 0, slowed: false };
  const result: SweepResult = { events: 0, lookedUp: 0, redriven: 0, reads: 0 };
  const lookup = await deps.providerFor(key, mode);
  const follow = { meta: deps.meta, enqueue: deps.enqueue, ...(deps.notices === undefined ? {} : { notices: deps.notices }), ...(deps.now === undefined ? {} : { now: deps.now }) };

  // 1. Missed events, from the cursor.
  if (lookup.ok) {
    let cursor = state.cursor;
    for (let page = 0; page < PAGES_PER_RUN; page += 1) {
      const answer = await lookup.provider.listMissedEvents(cursor);
      result.reads += 1;
      if (isProviderError(answer)) break;
      for (const event of answer.events) {
        const refund = event.refundRef === null ? null : await refundsRepo(deps.meta).byProviderId(key, mode, event.refundRef);
        const attempt =
          (event.checkoutRef === null ? null : await attempts.byProviderRef(key, mode, event.checkoutRef)) ??
          (event.paymentRef === null ? null : await attempts.byPaymentRef(key, mode, event.paymentRef)) ??
          (refund?.attemptId == null ? null : await attempts.byId(refund.attemptId));
        // About no payment known: a dispute or refund is kept until one takes its money; anything else is not ours.
        if (attempt === null && (refund !== null || !keptUnattached(event))) continue;
        const stored = await events.record(
          { provider: key, mode, eventId: event.eventId, type: event.type, kind: event.kind, checkoutRef: event.checkoutRef, paymentRef: event.paymentRef, refundRef: event.refundRef, attemptId: attempt?.id ?? null, source: 'sweep', body: eventBodyOf(event) },
          at,
        );
        if (!stored.fresh || attempt === null) continue;
        result.events += 1;
        await followEvent(follow, stored.event, attempt, event.occurredAt);
        // The webhook never brought this one: it is not reaching this server.
        state = { ...state, caughtAt: at };
      }
      cursor = answer.cursor;
      if (!answer.more) break;
    }
    state = { ...state, cursor };
  }

  // 2. Attempts waiting on the provider, looked up one by one, the longest-unasked first —
  //    at the slow cadence once the reads are past the slow share.
  const payments = await recordedThisMonth(deps.meta, key, mode, at);
  const allowance = Math.max(READS_FLOOR, READS_PER_TRANSACTION * payments);
  const slowed = state.reads + result.reads > allowance * READS_SLOW_SHARE;
  const lastLookup = state.lastLookupAt ?? 0;
  let lookedUp = false;
  if (lookup.ok && (!slowed || at - lastLookup >= SWEEP_PROCESSING_EVERY_MS)) {
    lookedUp = true;
    const due = await attempts.waitingOn(key, mode, ['open', 'processing'], at - LOOK_UP_AFTER_MS, 200);
    // A declined attempt's page may still take a later card: asked hourly while it can.
    const declined = (await attempts.waitingOn(key, mode, ['failed'], at - SWEEP_PROCESSING_EVERY_MS, 100, at - MAX_CHECKOUT_LIFE_MS)).filter((one) => one.checkoutUrl !== null);
    for (const attempt of [...due, ...declined]) {
      await deps.checkout.settle(attempt.id);
      result.lookedUp += 1;
      result.reads += 1;
    }
  }

  // 3. Stored events about this service's attempts that nobody processed.
  for (const event of await events.unprocessed(at - REDRIVE_AFTER_MS, 200, { provider: key, mode })) {
    if (event.attemptId === null) continue;
    const attempt = await attempts.byId(event.attemptId);
    if (await followEvent(follow, event, attempt, occurredAtOf(event))) result.redriven += 1;
  }
  //    And events stored before their payment was known: the match tried again (the planner gives them up after a while).
  const tried = new Set<string>();
  for (const event of await events.unattachedWaiting(at - REDRIVE_AFTER_MS, { provider: key, mode }, 200)) {
    if (event.paymentRef === null || tried.has(event.paymentRef)) continue;
    tried.add(event.paymentRef);
    const attempt = await attempts.byPaymentRef(key, mode, event.paymentRef);
    if (attempt !== null) result.redriven += await followUnattached(follow, attempt);
  }

  await docs.set(
    sweepDocName(key, mode),
    sweepStateSchema,
    { ...state, lastRunAt: at, lastLookupAt: lookedUp ? at : state.lastLookupAt, reads: state.reads + result.reads, slowed: slowed || state.slowed },
    at,
  );
  return result;
}

/** Whether a service and mode is due a run now, by what waits on it (counted in the database). */
export async function sweepDue(meta: MetaDb, key: string, mode: PaymentMode, at: number): Promise<boolean> {
  const state = await paymentSettingsRepo(meta).get(sweepDocName(key, mode), sweepStateSchema);
  const since = at - (state?.lastRunAt ?? 0);
  const attempts = paymentAttemptsRepo(meta);
  if ((await attempts.countIn(key, mode, ['creating', 'open'])) > 0) return since >= SWEEP_OPEN_EVERY_MS;
  // Unprocessed events still count as work.
  if ((await paymentEventsRepo(meta).unprocessed(at - REDRIVE_AFTER_MS, 1, { provider: key, mode })).length > 0) return since >= SWEEP_OPEN_EVERY_MS;
  const declined = (await attempts.waitingOn(key, mode, ['failed'], at + 1, 1, at - MAX_CHECKOUT_LIFE_MS)).some((one) => one.checkoutUrl !== null);
  if (declined || (await attempts.countIn(key, mode, ['processing'])) > 0) {
    // Live on with no live event yet: nothing proves the webhook reaches this server, so a waiting payment is asked about often.
    return since >= ((await liveUnproven(meta, key, mode)) ? SWEEP_OPEN_EVERY_MS : SWEEP_PROCESSING_EVERY_MS);
  }
  return false;
}

/** Live payments are on for the service and no live event has arrived yet. */
async function liveUnproven(meta: MetaDb, key: string, mode: PaymentMode): Promise<boolean> {
  if (mode !== 'live') return false;
  const service = await paymentSettingsRepo(meta).get(serviceDocName(key), serviceStateSchema);
  return service !== null && service.liveOn && service.live.firstEventAt === null;
}

const sweepPayload = z.object({ key: z.string().min(1), mode: z.enum(['test', 'live']) });

export function registerPaymentsSweepHandler(registry: JobRegistry, deps: SweepDeps): void {
  registry.registerJobHandler(PAYMENTS_SWEEP_JOB, sweepPayload, async (payload) => ({ ...(await runSweep(deps, payload.key, payload.mode)) }), { internal: true });
}

/**
 * Queues a run for every service and mode that is due one, the demo service
 * included, and lets go of every attempt that never got a checkout, whatever
 * its service (one that is switched off or gone included).
 */
export async function planSweeps(
  deps: Pick<SweepDeps, 'meta' | 'enqueue' | 'now'>,
  services: readonly { key: string; mode: PaymentMode }[],
): Promise<number> {
  const at = (deps.now ?? Date.now)();
  await paymentAttemptsRepo(deps.meta).abandonStale(at - ABANDON_AFTER_MS, at);
  // Events about money no attempt ever took: not ours after all.
  await paymentEventsRepo(deps.meta).giveUpUnattached(at - UNATTACHED_GIVE_UP_MS, at);
  const all = [...services];
  if (!all.some((one) => one.key === DEMO_PAYMENT_KEY)) all.push({ key: DEMO_PAYMENT_KEY, mode: 'test' });
  let queued = 0;
  for (const { key, mode } of all) {
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
