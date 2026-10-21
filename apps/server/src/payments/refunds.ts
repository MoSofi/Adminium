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
 * come back in its words.
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
 * record's status changes only through its "refunded in full" rule. A pay
 * link is never revived: the old one stays retired.
 *
 * ─── A REFUND MADE AT THE PROVIDER ─────────────────────────────────────────
 *
 * A refund event about a payment Adminium recorded, for a refund Adminium
 * did not ask for, is asked of the provider and recorded as made there
 * (source `provider`): the record follows the same way, and it is flagged in
 * Activity for a person to look at.
 *
 * ─── DISPUTES ──────────────────────────────────────────────────────────────
 *
 * A dispute event marks the payment disputed (and, later, closed). The
 * event says that it happened and when, and nothing more: the deadline, the
 * amount and the outcome are read in the provider's own dashboard. A dispute
 * never changes the record by itself.
 */
import {
  addAmounts,
  compareAmounts,
  decimalToMinor,
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

/** Asks the provider for a refund row that has not reached it yet, with its own key. */
async function askProvider(deps: RefundDeps, refund: RefundRow): Promise<RefundRow> {
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
    if (answer.retryable) return refund;
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
  const moved = await refunds.move(refund.id, to, patch, at);
  const now = (await refunds.byId(refund.id)) ?? refund;
  if (!moved) return now;
  if (to === 'failed' || to === 'cancelled') {
    // What it held is free again; a refund that had been done comes back out of the record.
    if (refund.attemptId !== null) await moveHold(deps.meta, refund.attemptId, `-${refund.amount}`, at);
    await tellRefundFailed(deps, now).catch(() => undefined);
  }
  if (refund.attemptId !== null && (to === 'succeeded' || refund.state === 'succeeded')) await followRecord(deps, refund.attemptId);
  return (await refunds.byId(refund.id)) ?? now;
}

// ─── The record follows ─────────────────────────────────────────────────────

export type RecordFollow = 'written' | 'kept-only' | 'not-recorded' | 'gone';

/**
 * Writes what stands refunded on an attempt's payment to where it was
 * recorded, then marks each refund done as applied (and each failed one that
 * had been as undone). The total is written, so a repeat writes the same.
 */
export async function followRecord(deps: RefundDeps, attemptId: string): Promise<RecordFollow> {
  const at = nowOf(deps);
  const attempts = paymentAttemptsRepo(deps.meta);
  const refunds = refundsRepo(deps.meta);
  const attempt = await attempts.byId(attemptId);
  if (attempt === null) return 'gone';
  const rows = await refunds.forAttempt(attempt.id);
  const done = rows.filter((row) => row.state === 'succeeded');
  const sum = sumAmounts(done.map((row) => row.amount));
  const total = exactAmount(sum, currencyScale(attempt.takenCurrency ?? attempt.currency)) ?? sum;
  const key = attempt.recordedKey;
  let outcome: RecordFollow;
  if (attempt.state !== 'recorded' || key === null) outcome = 'not-recorded';
  else if (key.startsWith('kept:')) {
    const written = await keptPaymentsRepo(deps.meta).setRefunded(key.slice('kept:'.length), total);
    outcome = written ? 'written' : 'gone';
  } else outcome = await writeTableRefund(deps, attempt, key, total);
  if (outcome === 'written') {
    for (const row of done) if (row.appliedAt === null) await refunds.markApplied(row.id, at);
    for (const row of rows) if (row.state === 'failed' && row.appliedAt !== null && row.undoneAt === null) await refunds.markUndone(row.id, at);
    await setRefundedStatus(deps, attempt, total).catch((error: unknown) => {
      deps.log?.warn({ attempt: attempt.id, err: error }, 'refund recorded; the record’s status rule did not apply');
    });
  }
  return outcome;
}

/** The refunded total on a payments table row (`row:<table>:<rowKey>`), when the table keeps refunds. */
async function writeTableRefund(deps: RefundDeps, attempt: PaymentAttempt, key: string, total: string): Promise<RecordFollow> {
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
  await writes.update({
    target: found.target,
    pk,
    values: { [into.refunded]: value },
    context: { origin: 'payment', hops: 0, actor: { kind: 'system', id: null, label: 'Refund' }, request: null },
    skipIfNone: true,
    announce: async () => {},
  });
  return 'written';
}

/** Refunded in full: the record's mapped "refunded" status, and nothing else (a part refund changes no status). */
async function setRefundedStatus(deps: RefundDeps, attempt: PaymentAttempt, total: string): Promise<void> {
  if (attempt.takenAmount === null || !sameAmount(total, attempt.takenAmount)) return;
  const ref = attempt.payable;
  const payable = await resolvePayable(deps.sources, ref);
  if (payable?.status?.refunded == null || ref.connectionId === null || ref.tableName === null) return;
  const found = await deps.sources.table(ref.connectionId, ref.tableName);
  const row = await deps.sources.readRow(ref.connectionId, ref.tableName, ref.rowKey);
  if (found === null || row === null || row[payable.status.column] === payable.status.refunded) return;
  const pk = Object.fromEntries(found.table.primaryKey.map((column) => [column, row[column]]));
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  await writes.update({
    target: found.target,
    pk,
    values: { [payable.status.column]: payable.status.refunded },
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
  let made: { refund: RefundRow; fresh: boolean };
  try {
    made = await refunds.create(
      {
        attemptId: attempt.id,
        paymentId: null,
        provider: input.provider,
        mode: input.mode,
        paymentRef: state.paymentRef,
        amount: state.amount,
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
  // It happened: held even past what Adminium thought was left.
  if (made.refund.state !== 'failed' && made.refund.state !== 'cancelled') await moveHold(deps.meta, attempt.id, made.refund.amount, at, true);
  if (made.refund.state === 'succeeded') await followRecord(deps, attempt.id);
  await tellMadeAtProvider(deps, attempt, made.refund).catch(() => undefined);
  return (await refunds.byId(made.refund.id)) ?? made.refund;
}

// ─── Disputes ───────────────────────────────────────────────────────────────

/** Whether a provider's dispute event type closes the dispute (`charge.dispute.closed`, `CUSTOMER.DISPUTE.RESOLVED`). */
export function disputeClosesOn(type: string): boolean {
  return /closed|resolved|won|lost|reinstated/i.test(type);
}

/** A verified dispute event about a payment: marks it disputed (or closed) and tells payment managers once. */
export async function disputeEvent(deps: Pick<RefundDeps, 'meta' | 'notices' | 'now'>, attempt: PaymentAttempt, event: { type: string; occurredAt: number }): Promise<void> {
  const state = disputeClosesOn(event.type) ? 'closed' : 'open';
  const at = event.occurredAt > 0 ? event.occurredAt : nowOf(deps);
  const moved = await paymentAttemptsRepo(deps.meta).noteDispute(attempt.id, state, at);
  if (moved && state === 'open') await tellDisputeOpened(deps, attempt).catch(() => undefined);
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

async function tellDisputeOpened(deps: Pick<RefundDeps, 'notices'>, attempt: PaymentAttempt): Promise<void> {
  if (deps.notices === undefined || attempt.mode !== 'live') return;
  await tellPaymentManagers(deps.notices, {
    kind: 'payments.dispute',
    about: `dispute:${attempt.id}:${String(attempt.dispute?.at ?? 0)}`,
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
        return { state: refund?.state ?? 'gone' };
      }
      const refund = await refundEvent(deps, { provider: payload.provider, mode: payload.mode, refundRef: payload.refundRef });
      if (payload.eventId !== undefined) await paymentEventsRepo(deps.meta).markProcessed(payload.eventId, nowOf(deps));
      return { state: refund?.state ?? 'not-ours' };
    },
    { internal: true },
  );
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

/** Refunds still on their way for a while: asked about again (the sweep's net under a missed event). */
export async function pickUpRefunds(deps: Pick<RefundDeps, 'meta' | 'enqueue' | 'now'>): Promise<number> {
  if (deps.enqueue === undefined) return 0;
  let queued = 0;
  for (const refund of await refundsRepo(deps.meta).waiting(nowOf(deps) - REFUND_ASK_AFTER_MS, 100)) {
    if (await enqueueRefund(deps.enqueue, { refundId: refund.id })) queued += 1;
  }
  return queued;
}
