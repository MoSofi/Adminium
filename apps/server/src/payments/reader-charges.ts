// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHARGES ON A CARD READER: the till asks, the engine drives the reader.
 *
 *  1. The cashier presses Card. The engine reads the record again (what is due
 *     now, never the till's figure; a part payment may ask less), and inserts
 *     the attempt BEFORE the reader is asked, holding the reader for this
 *     charge alone (one charge on a reader at a time, whichever till sent it).
 *  2. The amount is sent to the reader with the attempt's own key: sent again
 *     (a lost answer, a crash after the send), it is the same charge.
 *  3. A short job asks the reader where the charge stands, every second,
 *     outbound only (no webhook: a server on the shop's own computer works),
 *     and re-queues itself. The till reads the attempt, not the reader, so a
 *     reloaded till picks the charge up again.
 *  4. Taken: the attempt says what was asked, the tip, the card's last four
 *     and approval code, and the record job writes the payment into the app's
 *     payments table like any other (the tip beside it, `record.ts`).
 *
 * NEVER GIVEN UP BLIND. A send whose answer never came is sent again with the
 * same key, never failed; a reader off the network for two minutes is asked
 * to take the amount off, and then asked where the charge stands, because a
 * card tapped a moment before the cancel is a payment; a cancel the cashier
 * presses is the same. Only the reader's own answer ends a charge.
 */
import { compareAmounts, isProviderError, type ReaderChargeState } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { paymentAttemptsRepo, paymentReadersRepo, type MetaDb, type PayableRef, type PaymentAttempt } from '@adminium/meta';
import { z } from 'zod';

import type { JobRegistry } from '../jobs/registry.js';
import { newAttemptNonce } from './checkout.js';
import { exactAmount, resolvePayable, type PayableSources } from './payables.js';
import { enqueueRecord } from './record.js';
import type { TerminalLookup } from './terminals.js';

export const PAYMENTS_READER_POLL_JOB = 'payments.reader-poll';
/** How often the reader is asked while a charge is on it. */
export const READER_POLL_MS = 1_000;
/** A reader off the network this long: the amount is taken off it (and the charge then read once more). */
export const READER_OFFLINE_MS = 2 * 60_000;

type Enqueue = (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number; runAt?: number }) => Promise<unknown>;

export interface ReaderChargeDeps {
  meta: MetaDb;
  sources: PayableSources;
  terminalFor: (key: string, mode: 'test' | 'live') => Promise<TerminalLookup>;
  enqueue: Enqueue;
  now?: () => number;
}

/** Why a charge did not go to the reader, said to the cashier. */
export type ChargeRefusal = 'not-payable' | 'amount' | 'reader-unknown' | 'reader-busy' | 'reader-offline' | 'service';

export type ChargeStart = { ok: true; attempt: PaymentAttempt } | { ok: false; reason: ChargeRefusal; message: string };

const ON_THE_WAY: ReadonlySet<string> = new Set(['creating', 'open', 'processing']);
const sendKey = (attempt: { id: string }): string => `${attempt.id}:send`;

async function queuePoll(deps: ReaderChargeDeps, attemptId: string, tick: number, at: number): Promise<void> {
  await deps.enqueue({ kind: PAYMENTS_READER_POLL_JOB, payload: { attemptId, tick }, dedupeKey: `${PAYMENTS_READER_POLL_JOB}:${attemptId}:${String(tick)}`, maxAttempts: 30, runAt: at + READER_POLL_MS });
}

/** Puts a record's amount on a paired reader. */
export async function startReaderCharge(
  deps: ReaderChargeDeps,
  input: { ref: PayableRef; readerId: string; amount?: string | null; tipping: boolean; by: string | null },
): Promise<ChargeStart> {
  const at = (deps.now ?? Date.now)();
  const reader = await paymentReadersRepo(deps.meta).byId(input.readerId);
  if (reader === null) return { ok: false, reason: 'reader-unknown', message: 'This reader is not paired.' };
  const payable = await resolvePayable(deps.sources, input.ref, { mode: reader.mode });
  if (payable === null || payable.refusal !== null) return { ok: false, reason: 'not-payable', message: payable?.refusal?.message ?? 'This record cannot be paid now.' };
  // What is due now, read again: the till may ask less (a part payment), never more.
  const scale = currencyScale(payable.currency);
  const amount = input.amount == null ? payable.due : exactAmount(input.amount, scale);
  if (amount === null || compareAmounts(amount, '0') !== 1 || compareAmounts(amount, payable.due) === 1) {
    return { ok: false, reason: 'amount', message: `At most ${payable.due} ${payable.currency} can be taken.` };
  }
  const lookup = await deps.terminalFor(reader.provider, reader.mode);
  if (!lookup.ok) return { ok: false, reason: 'service', message: lookup.message };
  const attempts = paymentAttemptsRepo(deps.meta);
  const attempt = await attempts.create(
    { provider: reader.provider, mode: reader.mode, accountId: null, payable: input.ref, payableLabel: payable.label, amount, currency: payable.currency, linkId: null, nonce: newAttemptNonce(), createdBy: input.by, readerId: reader.id },
    at,
  );
  if (attempt === null) {
    // This record's charge already on its way (a reloaded till): picked up again, never sent twice.
    const held = await attempts.openFor(input.ref, reader.mode);
    if (held?.reader !== null && held !== null && ON_THE_WAY.has(held.state)) return { ok: true, attempt: held };
    return { ok: false, reason: 'reader-busy', message: `${reader.label} is taking another payment.` };
  }
  return { ok: true, attempt: await send(deps, attempt, lookup, at, input.tipping) };
}

/** Sends (or sends again, with the same key) the amount to the reader. A refusal the reader gave ends the charge; a silence does not. */
async function send(deps: ReaderChargeDeps, attempt: PaymentAttempt, lookup: Extract<TerminalLookup, { ok: true }>, at: number, tipping: boolean): Promise<PaymentAttempt> {
  const attempts = paymentAttemptsRepo(deps.meta);
  const reader = attempt.reader === null ? null : await paymentReadersRepo(deps.meta).byId(attempt.reader.readerId);
  if (reader === null) {
    await attempts.move(attempt.id, 'failed', { problem: { code: 'READER_GONE', message: 'The reader was unpaired.' } }, at);
    return (await attempts.byId(attempt.id)) ?? attempt;
  }
  const sent = await lookup.terminal.sendToReader({ readerId: reader.readerRef, amount: attempt.reader?.asked ?? attempt.amount, currency: attempt.currency, attemptId: attempt.id, idempotencyKey: sendKey(attempt), tipping });
  if (isProviderError(sent)) {
    // The reader said no (busy, offline, unknown): nothing is on it. Anything else may have reached it: asked again.
    if (sent.code === 'READER_BUSY' || sent.code === 'READER_OFFLINE' || sent.code === 'NOT_FOUND' || sent.code === 'CREDENTIALS_REFUSED' || sent.code === 'PERMISSION_MISSING' || sent.code === 'INVALID_REQUEST') {
      await attempts.move(attempt.id, 'failed', { problem: { code: sent.code, message: sent.providerMessage } }, at);
    } else {
      await queuePoll(deps, attempt.id, 0, at);
    }
    return (await attempts.byId(attempt.id)) ?? attempt;
  }
  await attempts.move(attempt.id, 'open', { providerRef: sent.ref }, at);
  await follow(deps, (await attempts.byId(attempt.id))!, sent, at);
  return (await attempts.byId(attempt.id)) ?? attempt;
}

/** What the reader said moves the attempt; still on its way, the next look is queued. */
async function follow(deps: ReaderChargeDeps, attempt: PaymentAttempt, state: ReaderChargeState, at: number, tick = 0): Promise<void> {
  const attempts = paymentAttemptsRepo(deps.meta);
  switch (state.status) {
    case 'succeeded': {
      const label = state.brand === null ? (state.last4 === null ? 'Card' : `••${state.last4}`) : state.last4 === null ? state.brand : `${state.brand} ••${state.last4}`;
      const moved = await attempts.move(
        attempt.id,
        'succeeded',
        {
          takenAmount: state.amount,
          takenCurrency: state.currency,
          paymentRef: state.paymentRef,
          paidWith: { method: 'card', label, delayed: false, ...(state.brand === null ? {} : { brand: state.brand }) },
          tipAmount: state.tip ?? '0',
          approvalCode: state.approvalCode,
          cardLast4: state.last4,
          interac: state.interac,
          settledAt: at,
        },
        at,
      );
      if (moved) await enqueueRecord(deps.enqueue, attempt.id);
      return;
    }
    case 'declined':
      await attempts.move(attempt.id, 'failed', { problem: { code: 'DECLINED', message: state.failureMessage ?? 'The card was declined.' } }, at);
      return;
    case 'cancelled':
      await attempts.move(attempt.id, 'cancelled', {}, at);
      return;
    case 'offline':
      if (at - attempt.updatedAt >= READER_OFFLINE_MS) {
        await cancelThenRead(deps, attempt, at);
        return;
      }
      await queuePoll(deps, attempt.id, tick + 1, at);
      return;
    default:
      await queuePoll(deps, attempt.id, tick + 1, at);
  }
}

/** Takes the amount off the reader, then reads where the charge stands: a card tapped first is a payment. */
async function cancelThenRead(deps: ReaderChargeDeps, attempt: PaymentAttempt, at: number): Promise<void> {
  const lookup = await deps.terminalFor(attempt.provider, attempt.mode);
  if (!lookup.ok || attempt.providerRef === null) return queuePoll(deps, attempt.id, 1, at);
  const cancelled = await lookup.terminal.cancelOnReader(attempt.providerRef);
  const state = isProviderError(cancelled) ? await lookup.terminal.readerStatus(attempt.providerRef) : cancelled;
  if (isProviderError(state)) return queuePoll(deps, attempt.id, 1, at);
  // A reader still off the network keeps the charge on it: asked again later, never ended blind.
  if (state.status === 'offline' || state.status === 'waiting' || state.status === 'on_reader') return queuePoll(deps, attempt.id, 1, at);
  await follow(deps, attempt, state, at);
}

/** The job: one look at the reader. */
export async function pollReaderCharge(deps: ReaderChargeDeps, attemptId: string, tick = 0): Promise<string> {
  const at = (deps.now ?? Date.now)();
  const attempts = paymentAttemptsRepo(deps.meta);
  const attempt = await attempts.byId(attemptId);
  if (attempt === null || attempt.reader === null || !ON_THE_WAY.has(attempt.state)) return attempt?.state ?? 'gone';
  const lookup = await deps.terminalFor(attempt.provider, attempt.mode);
  if (!lookup.ok) {
    await queuePoll(deps, attempt.id, tick + 1, at);
    return 'waiting';
  }
  // Its send was never answered: sent again with the same key (the same charge).
  if (attempt.state === 'creating' || attempt.providerRef === null) {
    await send(deps, attempt, lookup, at, false);
    return (await attempts.byId(attempt.id))?.state ?? 'gone';
  }
  const state = await lookup.terminal.readerStatus(attempt.providerRef);
  if (isProviderError(state)) {
    await queuePoll(deps, attempt.id, tick + 1, at);
    return 'waiting';
  }
  await follow(deps, attempt, state, at, tick);
  return (await attempts.byId(attempt.id))?.state ?? 'gone';
}

/** The cashier's Cancel: the amount taken off the reader, then the charge read once more. */
export async function cancelReaderCharge(deps: ReaderChargeDeps, attemptId: string): Promise<PaymentAttempt | null> {
  const at = (deps.now ?? Date.now)();
  const attempts = paymentAttemptsRepo(deps.meta);
  const attempt = await attempts.byId(attemptId);
  if (attempt === null || attempt.reader === null) return null;
  if (ON_THE_WAY.has(attempt.state)) await cancelThenRead(deps, attempt, at);
  return attempts.byId(attemptId);
}

/**
 * Where a charge stands, as the till shows it: `sending` to the reader,
 * `on_reader` waiting for the card ("On the reader…"), `processing` once the
 * card was presented and the service is deciding, then `paid`, `declined`,
 * `cancelled` or `failed`. The card's brand and last four once it is paid.
 */
export function chargeView(attempt: PaymentAttempt): { attemptId: string; state: 'sending' | 'on_reader' | 'processing' | 'paid' | 'declined' | 'cancelled' | 'failed'; amount: string; currency: string; tip: string | null; brand: string | null; last4: string | null; message: string | null } {
  const brand = (attempt.paidWith as { brand?: unknown } | null)?.brand;
  const state =
    attempt.state === 'creating'
      ? 'sending'
      : attempt.state === 'open'
        ? 'on_reader'
        : attempt.state === 'processing'
          ? 'processing'
          : attempt.state === 'succeeded' || attempt.state === 'recording' || attempt.state === 'recorded'
          ? 'paid'
          : attempt.state === 'cancelled' || attempt.state === 'expired' || attempt.state === 'abandoned'
            ? 'cancelled'
            : attempt.problem?.code === 'DECLINED'
              ? 'declined'
              : 'failed';
  return { attemptId: attempt.id, state, amount: attempt.reader?.asked ?? attempt.amount, currency: attempt.currency, tip: attempt.reader?.tip ?? null, brand: typeof brand === 'string' && brand !== '' ? brand : null, last4: attempt.reader?.last4 ?? null, message: attempt.problem?.message ?? null };
}

const pollPayload = z.object({ attemptId: z.string().min(1).max(64), tick: z.number().int().nonnegative().optional() }).strict();

export function registerReaderPollHandler(registry: JobRegistry, deps: ReaderChargeDeps): void {
  registry.registerJobHandler(PAYMENTS_READER_POLL_JOB, pollPayload, async (payload) => ({ state: await pollReaderCharge(deps, payload.attemptId, payload.tick ?? 0) }), { internal: true });
}
