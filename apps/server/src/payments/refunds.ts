// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Refunds, and the disputes a payment service tells of.
 *
 * ─── A REFUND ASKED IN ADMINIUM ────────────────────────────────────────────
 *
 * A person who may refund confirms an amount (step 2 of the dialog), with a
 * key their screen minted at that step. The key is bound to the payment and
 * the amount: the same key again is the same refund (a double click, a lost
 * answer), never a second one; the same key for another amount is refused.
 *
 *   1. What may still be refunded is the money taken less every refund not
 *      failed or cancelled. It is held on the attempt as one compare-and-set
 *      (`refundCommitted`), so two people refunding at once can never promise
 *      back more than was taken.
 *   2. The refund row is made (`requested`), then the provider is asked with
 *      the key. A provider that cannot be reached leaves it `requested`: the
 *      refund job asks again later with the same key.
 *   3. Its answer moves the row: done, pending, waiting for the customer,
 *      failed (with the provider's words), cancelled. A failed or cancelled
 *      refund gives back what it held. A refund done, then failed (a closed
 *      card), is taken back out of the record.
 *
 * Refused before the provider is asked: money not taken, still waiting for
 * the bank, disputed, refunded in full, more than is left. The provider's
 * own refusals (a method that cannot be refunded online, a window passed)
 * come back in its words. Only such a refusal fails a refund: any other
 * answer (the service down, its key refused, an answer outside its contract)
 * leaves it `requested`, and it is asked again with the same key. Two asks of
 * one refund at once are one ask.
 *
 * ─── THE RECORD FOLLOWS ────────────────────────────────────────────────────
 *
 * What stands refunded on a payment is the sum of its refunds done. It is
 * written to where the payment was recorded: a payment Adminium keeps, or the
 * record's own payments table when that keeps refunds (an invoice table's
 * `refunded_amount`; a mapped "refunded" column). The total is written, not an
 * increment, so a repeat or a race writes the same thing. The balance then
 * reopens by itself. A table that keeps no refunds keeps the refund in
 * Adminium only: the record's balance is left to the table's own rules. A
 * record's status changes only through its "refunded in full" rule (and
 * back to its "paid" one when a refund fails afterwards). A pay link is never
 * revived: the old one stays retired.
 *
 * Only a live payment writes to the shop's tables: a test or demo refund is
 * kept in Adminium alone, like the payment it refunds. A refund made before
 * its payment was written down follows once it is. Refunds never stand above
 * what was paid on the record: past it, the record shows what was paid as
 * refunded, and the refund is flagged. A write that fails (the database
 * away, a rule refusing) never undoes the refund the provider made: it is
 * flagged and tried again until it lands; a payment row since deleted is
 * flagged for a person.
 *
 * ─── A REFUND MADE AT THE PROVIDER ─────────────────────────────────────────
 *
 * A refund event about a payment Adminium recorded, for a refund Adminium
 * did not ask for, is asked of the provider and recorded as made there
 * (source `provider`): the record follows the same way, and it is flagged in
 * Activity for a person to look at. Its amount is read in the currency's own
 * decimals; one in another currency than was paid is kept and flagged, never
 * written. An event about a refund asked here whose answer was lost (the
 * same payment, the same amount, still waiting for its id) is that refund,
 * not one made there.
 *
 * ─── DISPUTES ──────────────────────────────────────────────────────────────
 *
 * A dispute event marks the payment disputed (and, later, closed). The
 * event says that it happened and when, and nothing more: the deadline, the
 * amount and the outcome are read in the provider's own dashboard. A dispute
 * never changes the record by itself. Events arrive in any order: each moves
 * only what is older than itself, an update after the close reopens nothing,
 * and only a new dispute after a close opens one again.
 */
import {
  addAmounts,
  compareAmounts,
  decimalToMinor,
  DEMO_PAYMENT_KEY,
  isProviderError,
  sameAmount,
  subtractAmounts,
  type PaymentMode,
  type RefundReason,
  type RefundState,
} from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import {
  isDuplicateKeyError,
  keptPaymentsRepo,
  paymentAttemptsRepo,
  paymentEventsRepo,
  refundsRepo,
  sumAmounts,
  type MetaDb,
  type PaymentAttempt,
  type RefundRow,
  type RefundRowState,
} from '@adminium/meta';
import { z } from 'zod';

import { createWriteService } from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import type { JobRegistry } from '../jobs/registry.js';
import { noticeMoney, providerName, tellPaymentManagers, type NoticeDeps } from './notices.js';
import { exactAmount, pkOfRowKey, resolvePayable, type PayableSources } from './payables.js';
import type { ProviderLookup } from './providers.js';
import type { RecordDeps } from './record.js';

export const PAYMENTS_REFUND_JOB = 'payments.refund';
export const PAYMENTS_REFUND_MAX_ATTEMPTS = 20;
/** A refund still on its way is asked about again after this long. */
export const REFUND_ASK_AFTER_MS = 10 * 60_000;

/** What makes the record follow its refunds: the record job has it too. */
export type FollowDeps = Pick<RecordDeps, 'meta' | 'sources' | 'writes' | 'app' | 'log' | 'now'>;

export interface RefundDeps extends Pick<RecordDeps, 'writes' | 'app' | 'log'> {
  meta: MetaDb;
  sources: PayableSources;
  providerFor: (key: string, mode: PaymentMode) => Promise<ProviderLookup>;
  enqueue?: (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;
  notices?: NoticeDeps;
  now?: () => number;
}

/** Why a refund cannot be asked now. */
export const REFUND_REFUSALS = ['NOT_TAKEN', 'PROCESSING', 'DISPUTED', 'FULLY_REFUNDED', 'MORE_THAN_REFUNDABLE', 'AMOUNT', 'KEY_REUSED', 'BUSY', 'NOT_ONLINE'] as const;
export type RefundRefusalCode = (typeof REFUND_REFUSALS)[number];

export interface RefundRefusal {
  code: RefundRefusalCode;
  message: string;
}

/** The states in which money was taken and may be refunded. */
const TAKEN_STATES: ReadonlySet<string> = new Set(['succeeded', 'recording', 'recorded', 'record_refused']);

/** What may still be refunded of an attempt: taken less what refunds hold. */
export function refundableOf(attempt: Pick<PaymentAttempt, 'takenAmount' | 'takenCurrency' | 'currency' | 'refundCommitted'>): string {
  if (attempt.takenAmount === null) return '0';
  const scale = currencyScale(attempt.takenCurrency ?? attempt.currency);
  const left = subtractAmounts(attempt.takenAmount, attempt.refundCommitted, scale);
  return left === null || compareAmounts(left, '0') !== 1 ? '0' : left;
}

/** Why this attempt cannot be refunded at all now, or null. */
export function refundRefusalOf(attempt: PaymentAttempt): RefundRefusal | null {
  if (attempt.state === 'processing') return { code: 'PROCESSING', message: 'This payment is still waiting for the bank.' };
  if (!TAKEN_STATES.has(attempt.state) || attempt.paymentRef === null || attempt.takenAmount === null) return { code: 'NOT_TAKEN', message: 'No money was taken for this payment.' };
  if (attempt.dispute?.state === 'open') return { code: 'DISPUTED', message: `This payment is disputed. Answer it in ${providerName(attempt.provider)} first.` };
  if (refundableOf(attempt) === '0') return { code: 'FULLY_REFUNDED', message: 'This payment is fully refunded.' };
  return null;
}

function nowOf(deps: { now?: () => number }): number {
  return (deps.now ?? Date.now)();
}

// ─── Asking ─────────────────────────────────────────────────────────────────

export interface RefundRequest {
  attemptId: string;
  amount: string;
  reason: RefundReason;
  note: string | null;
  /** Minted by the screen at the confirm step; bound to (payment, amount). */
  key: string;
  requestedBy: string | null;
}

export type RefundAnswer = { ok: true; refund: RefundRow; fresh: boolean } | { ok: false; refusal: RefundRefusal };

/** Moves the attempt's refund hold by `delta` (negative gives back), as a compare-and-set, a few tries. */
async function moveHold(meta: MetaDb, attemptId: string, delta: string, at: number, beyondTaken = false): Promise<boolean> {
  const attempts = paymentAttemptsRepo(meta);
  for (let tries = 0; tries < 5; tries += 1) {
    const attempt = await attempts.byId(attemptId);
    if (attempt === null) return false;
    const scale = currencyScale(attempt.takenCurrency ?? attempt.currency);
    const next = delta.startsWith('-') ? subtractAmounts(attempt.refundCommitted, delta.slice(1), scale) : addAmounts(attempt.refundCommitted, delta, scale);
    if (next === null) return false;
    // Giving back never goes below nothing.
    const floored = compareAmounts(next, '0') === -1 ? '0' : next;
    if (await attempts.commitRefund(attemptId, attempt.refundCommitted, floored, at, beyondTaken)) return true;
    // Moved by someone else, or past the money taken: read again; past it stays refused.
    const again = await attempts.byId(attemptId);
    if (again === null || again.refundCommitted === attempt.refundCommitted) return false;
  }
  return false;
}

/** Asks for a refund: checks, holds the amount, makes the row and asks the provider. */
export async function requestRefund(deps: RefundDeps, input: RefundRequest): Promise<RefundAnswer> {
  const at = nowOf(deps);
  const refunds = refundsRepo(deps.meta);
  const attempts = paymentAttemptsRepo(deps.meta);
  const attempt = await attempts.byId(input.attemptId);
  if (attempt === null) return { ok: false, refusal: { code: 'NOT_TAKEN', message: 'No such payment.' } };

  // The same key again: the same refund, asked again if it never reached the provider.
  const known = await refunds.byKey(input.key);
  if (known !== null) {
    if (known.attemptId !== attempt.id || !sameAmount(known.amount, input.amount)) {
      return { ok: false, refusal: { code: 'KEY_REUSED', message: 'This confirmation was for another refund. Start again.' } };
    }
    if (known.state === 'requested' && known.providerRefundId === null) return { ok: true, refund: await askProvider(deps, known), fresh: false };
    return { ok: true, refund: known, fresh: false };
  }

  const refusal = refundRefusalOf(attempt);
  if (refusal !== null) return { ok: false, refusal };
  const currency = attempt.takenCurrency ?? attempt.currency;
  const amount = exactAmount(input.amount, currencyScale(currency));
  if (amount === null || compareAmounts(amount, '0') !== 1) return { ok: false, refusal: { code: 'AMOUNT', message: 'Enter an amount above zero, in the currency’s own decimals.' } };
  if (compareAmounts(amount, refundableOf(attempt)) === 1) {
    return { ok: false, refusal: { code: 'MORE_THAN_REFUNDABLE', message: `At most ${refundableOf(attempt)} ${currency} can be refunded.` } };
  }
  if (!(await moveHold(deps.meta, attempt.id, amount, at))) {
    return { ok: false, refusal: { code: 'BUSY', message: 'Another refund of this payment changed what is left. Look again and try once more.' } };
  }
  let made: { refund: RefundRow; fresh: boolean };
  try {
    made = await refunds.create(
      {
        attemptId: attempt.id,
        paymentId: null,
        provider: attempt.provider,
        mode: attempt.mode,
        paymentRef: attempt.paymentRef!,
        amount,
        currency,
        reason: input.reason,
        note: input.note,
        idempotencyKey: input.key,
        source: 'staff',
        requestedBy: input.requestedBy,
      },
      at,
    );
  } catch (error) {
    await moveHold(deps.meta, attempt.id, `-${amount}`, at);
    throw error;
  }
  if (!made.fresh) {
    // A twin request with the same key won the row: give back this one's hold.
    await moveHold(deps.meta, attempt.id, `-${amount}`, at);
    return { ok: true, refund: made.refund, fresh: false };
  }
  return { ok: true, refund: await askProvider(deps, made.refund), fresh: true };
}

/** The provider's answers that refuse a refund in so many words: only these fail it. */
const REFUSALS: ReadonlySet<string> = new Set(['REFUND_REFUSED', 'AMOUNT_UNREPRESENTABLE', 'CURRENCY_UNSUPPORTED', 'INVALID_REQUEST']);

/** Asks in flight, by refund: a second ask of the same refund waits for the first, never asks beside it. */
const asking = new Map<string, Promise<RefundRow>>();

/** Asks the provider for a refund row that has not reached it yet, with its own key. */
function askProvider(deps: RefundDeps, refund: RefundRow): Promise<RefundRow> {
  const inFlight = asking.get(refund.id);
  if (inFlight !== undefined) return inFlight;
  const ask = askOnce(deps, refund).finally(() => asking.delete(refund.id));
  asking.set(refund.id, ask);
  return ask;
}

async function askOnce(deps: RefundDeps, asked: RefundRow): Promise<RefundRow> {
  // As it stands now: an ask that finished a moment ago may have moved it.
  const refund = (await refundsRepo(deps.meta).byId(asked.id)) ?? asked;
  if (refund.state !== 'requested' || refund.providerRefundId !== null) return refund;
  const lookup = await deps.providerFor(refund.provider, refund.mode as PaymentMode);
  // The service cannot be asked now (switched off, keys being replaced): asked again later, same key.
  if (!lookup.ok) return refund;
  const answer = await lookup.provider.refund({
    paymentRef: refund.paymentRef,
    amount: refund.amount,
    currency: refund.currency,
    reason: refund.reason as RefundReason,
    idempotencyKey: refund.idempotencyKey,
  });
  if (isProviderError(answer)) {
    // Anything but a refusal may have made the refund: it stays asked, and is asked again with the same key.
    if (answer.retryable || !REFUSALS.has(answer.code)) {
      deps.log?.warn({ refund: refund.id, code: answer.code }, 'refund not answered yet; asked again with the same key');
      return refund;
    }
    return moveTo(deps, refund, 'failed', { failureMessage: answer.providerMessage.slice(0, 2000) || 'The payment service refused the refund.' });
  }
  return follow(deps, refund, answer);
}

/** What a provider's refund status moves a row to. */
function rowStateOf(status: RefundState['status']): RefundRowState {
  return status;
}

/** Moves a row to what the provider says, then makes the record follow. */
async function follow(deps: RefundDeps, refund: RefundRow, state: RefundState): Promise<RefundRow> {
  const to = rowStateOf(state.status);
  const patch = { providerRefundId: state.ref, failureMessage: state.failureMessage === null ? null : state.failureMessage.slice(0, 2000) };
  // Nothing new: the row already says it.
  if (to === refund.state) return refund;
  return moveTo(deps, refund, to, patch);
}

async function moveTo(deps: RefundDeps, refund: RefundRow, to: RefundRowState, patch: { providerRefundId?: string; failureMessage?: string | null }): Promise<RefundRow> {
  const at = nowOf(deps);
  const refunds = refundsRepo(deps.meta);
  if (to === 'requested') return refund;
  let moved: boolean;
  try {
    moved = await refunds.move(refund.id, to, patch, at);
  } catch (error) {
    // Another row holds this provider refund already (an event recorded it while this answer was lost).
    if (!isDuplicateKeyError(error) || patch.providerRefundId === undefined) throw error;
    return mergeInto(deps, refund, patch.providerRefundId);
  }
  const now = (await refunds.byId(refund.id)) ?? refund;
  if (!moved) return now;
  if (to === 'failed' || to === 'cancelled') {
    // What it held is free again; a refund that had been done comes back out of the record.
    if (refund.attemptId !== null) await moveHold(deps.meta, refund.attemptId, `-${refund.amount}`, at);
    await tellRefundFailed(deps, now).catch(() => undefined);
  }
  if (refund.attemptId !== null && (to === 'succeeded' || refund.state === 'succeeded')) await followOrRetry(deps, refund.id, refund.attemptId);
  return (await refunds.byId(refund.id)) ?? now;
}

/**
 * Two rows for one refund at the provider: the one that holds its id keeps
 * it, and the twin is closed as the same refund, counted once. What the twin
 * held is given back, and nobody is told of a failure that never happened.
 */
async function mergeInto(deps: RefundDeps, twin: RefundRow, providerRefundId: string): Promise<RefundRow> {
  const at = nowOf(deps);
  const refunds = refundsRepo(deps.meta);
  const holder = await refunds.byProviderId(twin.provider, twin.mode, providerRefundId);
  if (await refunds.move(twin.id, 'cancelled', { failureMessage: 'The same refund as one already recorded: counted once.' }, at)) {
    if (twin.attemptId !== null) await moveHold(deps.meta, twin.attemptId, `-${twin.amount}`, at);
  }
  deps.log?.warn({ refund: twin.id, holder: holder?.id ?? null }, 'refund answered with an id another row holds; counted once');
  return holder ?? (await refunds.byId(twin.id)) ?? twin;
}

/**
 * The record follows a refund the provider made. When writing fails, the
 * refund stands (it happened): it is flagged and queued, and the sweep finds
 * it too, until the write lands.
 */
async function followOrRetry(deps: RefundDeps, refundId: string, attemptId: string): Promise<void> {
  try {
    await followRecord(deps, attemptId);
  } catch (error) {
    deps.log?.warn({ refund: refundId, attempt: attemptId, err: error }, 'refund made; writing it to the record failed, tried again');
    await refundsRepo(deps.meta).setProblem(refundId, 'NOT_WRITTEN', nowOf(deps)).catch(() => false);
    if (deps.enqueue !== undefined) await enqueueRefund(deps.enqueue, { refundId }).catch(() => false);
  }
}

/** Whether the record has yet to follow this refund (done and not applied, or failed after it was). */
export function recordBehind(refund: RefundRow): boolean {
  if (refund.attemptId === null || (refund.problemCode !== null && refund.problemCode !== 'NOT_WRITTEN')) return false;
  return (refund.state === 'succeeded' && refund.appliedAt === null) || (refund.state === 'failed' && refund.appliedAt !== null && refund.undoneAt === null);
}

/**
 * A payment just written down, with refunds made before it was: the record
 * follows them now. A write that fails is flagged and left to the sweep.
 */
export async function followRefundsOnRecord(deps: FollowDeps, attemptId: string): Promise<void> {
  const rows = await refundsRepo(deps.meta).forAttempt(attemptId);
  if (!rows.some(recordBehind)) return;
  try {
    await followRecord(deps, attemptId);
  } catch (error) {
    deps.log?.warn({ attempt: attemptId, err: error }, 'payment recorded; writing its refunds to the record failed, tried again');
    for (const row of rows) if (recordBehind(row)) await refundsRepo(deps.meta).setProblem(row.id, 'NOT_WRITTEN', nowOf(deps)).catch(() => false);
  }
}

// ─── The record follows ─────────────────────────────────────────────────────

export type RecordFollow = 'written' | 'kept-only' | 'not-recorded' | 'gone';

/** Only a live payment at a real service writes to the shop's tables; a test or demo one stays in Adminium. */
function writesShop(attempt: Pick<PaymentAttempt, 'mode' | 'provider'>): boolean {
  return attempt.mode === 'live' && attempt.provider !== DEMO_PAYMENT_KEY;
}

/**
 * Writes what stands refunded on an attempt's payment to where it was
 * recorded, then marks each refund done as applied (and each failed one that
 * had been as undone). The total is written, so a repeat writes the same. A
 * refund in another currency than was paid is not counted; refunds above what
 * was paid write what was paid, and the refund past it is flagged.
 */
export async function followRecord(deps: FollowDeps, attemptId: string): Promise<RecordFollow> {
  const at = nowOf(deps);
  const attempts = paymentAttemptsRepo(deps.meta);
  const refunds = refundsRepo(deps.meta);
  const attempt = await attempts.byId(attemptId);
  if (attempt === null) return 'gone';
  const currency = attempt.takenCurrency ?? attempt.currency;
  const scale = currencyScale(currency);
  const rows = await refunds.forAttempt(attempt.id);
  const done = rows.filter((row) => row.state === 'succeeded' && row.currency === currency);
  const sum = sumAmounts(done.map((row) => row.amount));
  let total = exactAmount(sum, scale) ?? sum;
  let past: RefundRow | null = null;
  if (attempt.takenAmount !== null && compareAmounts(total, attempt.takenAmount) === 1) {
    total = exactAmount(attempt.takenAmount, scale) ?? attempt.takenAmount;
    past = done.at(-1) ?? null;
  }
  const key = attempt.recordedKey;
  let outcome: RecordFollow;
  if (attempt.state !== 'recorded' || key === null) outcome = 'not-recorded';
  else if (key.startsWith('kept:')) {
    const written = await keptPaymentsRepo(deps.meta).setRefunded(key.slice('kept:'.length), total);
    outcome = written ? 'written' : 'gone';
  } else if (!writesShop(attempt)) outcome = 'kept-only';
  else outcome = await writeTableRefund(deps, attempt, key, total);
  if (outcome === 'written' || outcome === 'kept-only') {
    for (const row of done) if (row.appliedAt === null) await refunds.markApplied(row.id, at);
    for (const row of rows) if (row.state === 'failed' && row.appliedAt !== null && row.undoneAt === null) await refunds.markUndone(row.id, at);
    for (const row of rows) if (row.problemCode === 'NOT_WRITTEN') await refunds.setProblem(row.id, null, at, 'NOT_WRITTEN');
    if (past !== null) await refunds.setProblem(past.id, 'MORE_THAN_PAID', at);
  }
  if (outcome === 'written' && writesShop(attempt)) {
    await setRefundedStatus(deps, attempt, total).catch((error: unknown) => {
      deps.log?.warn({ attempt: attempt.id, err: error }, 'refund recorded; the record’s status rule did not apply');
    });
  }
  // The payment row it refunds is no longer there: a person looks; it is not tried again.
  if (outcome === 'gone') for (const row of rows) if (recordBehind(row)) await refunds.setProblem(row.id, 'RECORD_GONE', at);
  return outcome;
}

/** The refunded total on a payments table row (`row:<table>:<rowKey>`), when the table keeps refunds. */
async function writeTableRefund(deps: FollowDeps, attempt: PaymentAttempt, key: string, total: string): Promise<RecordFollow> {
  const payable = await resolvePayable(deps.sources, attempt.payable);
  if (payable === null || payable.recordInto.kind !== 'table' || attempt.payable.connectionId === null) return 'gone';
  const into = payable.recordInto;
  if (into.refunded === null) return 'kept-only';
  const rest = key.slice('row:'.length);
  const tableName = rest.slice(0, rest.indexOf(':'));
  const rowKey = rest.slice(rest.indexOf(':') + 1);
  const found = await deps.sources.table(attempt.payable.connectionId, tableName);
  if (found === null || !found.table.columns.has(into.refunded)) return 'gone';
  const pk = pkOfRowKey(found.table, rowKey);
  if (pk === null) return 'gone';
  const scale = currencyScale(attempt.takenCurrency ?? attempt.currency);
  const value = into.amountUnit === 'minor' ? decimalToMinor(total, scale) : total;
  if (value === null) return 'gone';
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  const written = await writes.update({
    target: found.target,
    pk,
    values: { [into.refunded]: value },
    context: { origin: 'payment', hops: 0, actor: { kind: 'system', id: null, label: 'Refund' }, request: null },
    skipIfNone: true,
    announce: async () => {},
  });
  if (written.count > 0) return 'written';
  // Nothing changed: the same total again (MySQL counts only changed rows), or the row deleted.
  const there = await found.target.db
    .selectFrom(found.table.id)
    .select(found.table.primaryKey.map((column) => found.target.db.dynamic.ref(column)))
    .where((eb) => eb.and(Object.entries(pk).map(([column, one]) => eb(found.target.db.dynamic.ref(column), '=', one))))
    .executeTakeFirst();
  return there === undefined ? 'gone' : 'written';
}

/**
 * Refunded in full: the record's mapped "refunded" status. A record that
 * reads "refunded" and no longer is (a refund failed afterwards) goes back to
 * its "paid" status. A part refund changes no status.
 */
async function setRefundedStatus(deps: FollowDeps, attempt: PaymentAttempt, total: string): Promise<void> {
  if (attempt.takenAmount === null) return;
  const full = sameAmount(total, attempt.takenAmount);
  const ref = attempt.payable;
  const payable = await resolvePayable(deps.sources, ref);
  if (payable?.status?.refunded == null || ref.connectionId === null || ref.tableName === null) return;
  const found = await deps.sources.table(ref.connectionId, ref.tableName);
  const row = await deps.sources.readRow(ref.connectionId, ref.tableName, ref.rowKey);
  if (found === null || row === null) return;
  const now = row[payable.status.column];
  const want = full ? payable.status.refunded : now === payable.status.refunded ? payable.status.paid : null;
  if (want === null || now === want) return;
  const pk = Object.fromEntries(found.table.primaryKey.map((column) => [column, row[column]]));
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  await writes.update({
    target: found.target,
    pk,
    values: { [payable.status.column]: want },
    context: { origin: 'payment', hops: 0, actor: { kind: 'system', id: null, label: 'Refund' }, request: null },
    skipIfNone: true,
    announce: async () => {},
  });
}

// ─── Asking again, and the provider's own refunds ───────────────────────────

/**
 * Asks how a refund stands and follows it. `strict` (the job) throws when the
 * provider cannot be asked, so the job tries again.
 */
export async function settleRefund(deps: RefundDeps, refundId: string, options: { strict?: boolean } = {}): Promise<RefundRow | null> {
  const refund = await refundsRepo(deps.meta).byId(refundId);
  if (refund === null) return null;
  if (refund.providerRefundId === null) {
    if (refund.state !== 'requested') return refund;
    const asked = await askProvider(deps, refund);
    if (options.strict === true && asked.state === 'requested') throw new Error('The payment service could not be asked for the refund yet.');
    return asked;
  }
  const lookup = await deps.providerFor(refund.provider, refund.mode as PaymentMode);
  if (!lookup.ok) {
    if (options.strict === true) throw new Error(`The payment service cannot be asked now (${lookup.code}).`);
    return refund;
  }
  const state = await lookup.provider.refundStatus(refund.providerRefundId);
  if (isProviderError(state)) {
    if (options.strict === true && state.retryable) throw new Error('The payment service could not be asked about the refund now.');
    return refund;
  }
  return follow(deps, refund, state);
}

/**
 * A refund event: the refund Adminium asked for, asked about again; or one
 * made in the provider's own dashboard, recorded as made there and flagged.
 */
export async function refundEvent(deps: RefundDeps, input: { provider: string; mode: PaymentMode; refundRef: string }): Promise<RefundRow | null> {
  const refunds = refundsRepo(deps.meta);
  const known = await refunds.byProviderId(input.provider, input.mode, input.refundRef);
  if (known !== null) return settleRefund(deps, known.id, { strict: true });
  const lookup = await deps.providerFor(input.provider, input.mode);
  if (!lookup.ok) throw new Error(`The payment service cannot be asked now (${lookup.code}).`);
  const state = await lookup.provider.refundStatus(input.refundRef);
  if (isProviderError(state)) {
    if (state.retryable) throw new Error('The payment service could not be asked about the refund now.');
    return null;
  }
  const attempt = await paymentAttemptsRepo(deps.meta).byPaymentRef(input.provider, input.mode, state.paymentRef);
  // About money Adminium never took: not ours to record.
  if (attempt === null) return null;
  const at = nowOf(deps);
  // A refund asked here whose answer was lost: the same payment and amount, still waiting for its id. It is that one.
  const lost = (await refunds.forAttempt(attempt.id)).find((row) => row.source === 'staff' && row.state === 'requested' && row.providerRefundId === null && row.currency === state.currency && sameAmount(row.amount, state.amount));
  if (lost !== undefined && (await refunds.adopt(lost.id, input.refundRef, at))) {
    return follow(deps, (await refunds.byId(lost.id)) ?? lost, state);
  }
  const paidIn = attempt.takenCurrency ?? attempt.currency;
  const otherCurrency = state.currency !== paidIn;
  // In the currency's own decimals ("20" is 20.00 EUR, 20.000 KWD), so sums and the record read it as written.
  const amount = exactAmount(state.amount, currencyScale(state.currency)) ?? state.amount;
  let made: { refund: RefundRow; fresh: boolean };
  try {
    made = await refunds.create(
      {
        attemptId: attempt.id,
        paymentId: null,
        provider: input.provider,
        mode: input.mode,
        paymentRef: state.paymentRef,
        amount,
        currency: state.currency,
        reason: 'other',
        note: null,
        idempotencyKey: `provider:${input.provider}:${input.mode}:${input.refundRef}`.slice(0, 80),
        providerRefundId: input.refundRef,
        source: 'provider',
        requestedBy: null,
        state: rowStateOf(state.status) === 'requested' ? 'pending' : rowStateOf(state.status),
      },
      at,
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const again = await refunds.byProviderId(input.provider, input.mode, input.refundRef);
    return again === null ? null : settleRefund(deps, again.id, { strict: true });
  }
  if (!made.fresh) return settleRefund(deps, made.refund.id, { strict: true });
  if (otherCurrency) {
    // Not in what was paid: kept and flagged, never held against it nor written to the record.
    await refunds.setProblem(made.refund.id, 'CURRENCY_DIFFERS', at);
  } else {
    // It happened: held even past what Adminium thought was left.
    if (made.refund.state !== 'failed' && made.refund.state !== 'cancelled') await moveHold(deps.meta, attempt.id, made.refund.amount, at, true);
    if (made.refund.state === 'succeeded') await followOrRetry(deps, made.refund.id, attempt.id);
  }
  await tellMadeAtProvider(deps, attempt, made.refund).catch(() => undefined);
  return (await refunds.byId(made.refund.id)) ?? made.refund;
}

// ─── Disputes ───────────────────────────────────────────────────────────────

/** Whether a provider's dispute event type closes the dispute (`charge.dispute.closed`, `CUSTOMER.DISPUTE.RESOLVED`). */
export function disputeClosesOn(type: string): boolean {
  return /closed|resolved|won|lost|reinstated/i.test(type);
}

/** Whether a provider's dispute event type opens a new dispute (`charge.dispute.created`, `CUSTOMER.DISPUTE.CREATED`), not news of one. */
export function disputeOpensOn(type: string): boolean {
  return /created|opened/i.test(type);
}

/**
 * A verified dispute event about a payment: marks it disputed (or closed) and
 * tells payment managers once per dispute. Each event moves only what is
 * older than itself (the repo's `noteDispute`).
 */
export async function disputeEvent(deps: Pick<RefundDeps, 'meta' | 'notices' | 'now'>, attempt: PaymentAttempt, event: { type: string; occurredAt: number }): Promise<void> {
  const state = disputeClosesOn(event.type) ? 'closed' : 'open';
  const at = event.occurredAt > 0 ? event.occurredAt : nowOf(deps);
  const moved = await paymentAttemptsRepo(deps.meta).noteDispute(attempt.id, state, at, disputeOpensOn(event.type));
  if (moved && state === 'open') await tellDisputeOpened(deps, attempt, at).catch(() => undefined);
}

// ─── Notices ────────────────────────────────────────────────────────────────

async function tellRefundFailed(deps: RefundDeps, refund: RefundRow): Promise<void> {
  if (deps.notices === undefined || refund.mode !== 'live') return;
  const attempt = refund.attemptId === null ? null : await paymentAttemptsRepo(deps.meta).byId(refund.attemptId);
  const paidWith = (attempt?.paidWith as { label?: string } | null)?.label ?? providerName(refund.provider);
  await tellPaymentManagers(deps.notices, {
    kind: 'payments.refund-failed',
    about: `refund-failed:${refund.id}`,
    urgent: true,
    actionUrl: '/studio/payments?tab=activity',
    words: (locale) => ({ title: { key: 'refundFailed.title', fallback: 'Refund failed' }, body: { key: 'refundFailed.body', fallback: '{amount} to {paidWith}' }, values: { amount: noticeMoney(refund.amount, refund.currency, locale), paidWith } }),
  });
}

async function tellMadeAtProvider(deps: RefundDeps, attempt: PaymentAttempt, refund: RefundRow): Promise<void> {
  if (deps.notices === undefined || refund.mode !== 'live') return;
  await tellPaymentManagers(deps.notices, {
    kind: 'payments.needs-look',
    about: `refund-at-provider:${refund.id}`,
    actionUrl: '/studio/payments?tab=activity',
    words: (locale) => ({
      title: { key: 'look.title', fallback: 'A payment needs a look' },
      body: { key: 'look.refundedThere', fallback: 'Refunded in the {provider} dashboard: {amount} on {label}. Recorded.' },
      values: { provider: providerName(refund.provider), amount: noticeMoney(refund.amount, refund.currency, locale), label: attempt.payableLabel },
    }),
  });
}

async function tellDisputeOpened(deps: Pick<RefundDeps, 'notices'>, attempt: PaymentAttempt, openedAt: number): Promise<void> {
  if (deps.notices === undefined || attempt.mode !== 'live') return;
  await tellPaymentManagers(deps.notices, {
    kind: 'payments.dispute',
    // Once per dispute: keyed by when this one opened, not by the one before it.
    about: `dispute:${attempt.id}:${String(openedAt)}`,
    urgent: true,
    actionUrl: '/studio/payments?tab=activity',
    words: () => ({
      title: { key: 'dispute.title', fallback: 'Dispute opened' },
      body: { key: 'dispute.bodyNoDate', fallback: '{label} · answer it in the {provider} dashboard' },
      values: { label: attempt.payableLabel, provider: providerName(attempt.provider) },
    }),
  });
}

// ─── The job ────────────────────────────────────────────────────────────────

const jobPayload = z.union([
  z.object({ refundId: z.string().min(1).max(64) }).strict(),
  z.object({ provider: z.string().min(1).max(80), mode: z.enum(['test', 'live']), refundRef: z.string().min(1).max(255), eventId: z.string().min(1).max(64).optional() }).strict(),
]);

/**
 * The refund job: one refund asked about again (by id), or a refund event
 * followed (by the provider's id). It throws when the provider cannot be
 * asked, so it is tried again; the event that queued it is marked handled
 * only once it was followed.
 */
export function registerPaymentsRefundHandler(registry: JobRegistry, deps: RefundDeps): void {
  registry.registerJobHandler(
    PAYMENTS_REFUND_JOB,
    jobPayload,
    async (payload) => {
      if ('refundId' in payload) {
        const refund = await settleRefund(deps, payload.refundId, { strict: true });
        if (refund !== null) await followStrict(deps, refund.id);
        return { state: refund?.state ?? 'gone' };
      }
      const refund = await refundEvent(deps, { provider: payload.provider, mode: payload.mode, refundRef: payload.refundRef });
      if (refund !== null) await followStrict(deps, refund.id);
      if (payload.eventId !== undefined) await paymentEventsRepo(deps.meta).markProcessed(payload.eventId, nowOf(deps));
      return { state: refund?.state ?? 'not-ours' };
    },
    { internal: true },
  );
}

/** In the job: a refund the record has yet to follow is written now, and a failure throws, so the job tries again. */
async function followStrict(deps: RefundDeps, refundId: string): Promise<void> {
  const refund = await refundsRepo(deps.meta).byId(refundId);
  if (refund === null || refund.attemptId === null || !recordBehind(refund)) return;
  await followRecord(deps, refund.attemptId);
}

/** Queues the refund job. A second queue of the same while one waits is "already queued". */
export async function enqueueRefund(
  enqueue: NonNullable<RefundDeps['enqueue']>,
  payload: { refundId: string } | { provider: string; mode: PaymentMode; refundRef: string; eventId?: string },
): Promise<boolean> {
  const dedupeKey = 'refundId' in payload ? `payments-refund:${payload.refundId}` : `payments-refund-event:${payload.provider}:${payload.mode}:${payload.refundRef}`;
  try {
    await enqueue({ kind: PAYMENTS_REFUND_JOB, payload: { ...payload }, dedupeKey, maxAttempts: PAYMENTS_REFUND_MAX_ATTEMPTS });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/**
 * Refunds still on their way for a while: asked about again (the sweep's net
 * under a missed event); and refunds the record has not followed yet (a write
 * that failed), written again.
 */
export async function pickUpRefunds(deps: Pick<RefundDeps, 'meta' | 'enqueue' | 'now'>): Promise<number> {
  if (deps.enqueue === undefined) return 0;
  const refunds = refundsRepo(deps.meta);
  let queued = 0;
  for (const refund of [...(await refunds.waiting(nowOf(deps) - REFUND_ASK_AFTER_MS, 100)), ...(await refunds.unfollowed(100))]) {
    if (await enqueueRefund(deps.enqueue, { refundId: refund.id })) queued += 1;
  }
  return queued;
}
