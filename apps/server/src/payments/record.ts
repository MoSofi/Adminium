// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recording a payment: exactly once, across two databases.
 *
 * ─── WHY IT IS A JOB, AND AT-LEAST-ONCE ────────────────────────────────────
 *
 * The attempt lives in the meta store; the payment row usually lives in the
 * shop's database. They never share a transaction (separate pools, often
 * separate engines), so no single commit
 * can say "the money arrived and it is written down". Recording is therefore
 * a job that may run more than once — after a crash, a lost lock, a second
 * delivery — and is made exactly-once by the payment's own reference: the
 * attempt id, written into a column with a unique index. The order:
 *
 *   1. claim:   succeeded → recording (compare-and-set; a resumed run finds it
 *               already `recording` and carries on)
 *   2. look:    is a row carrying this attempt id already there? Then it was
 *               written by a run that died before step 5: finish.
 *   3. check:   what the provider took against what is due NOW; any mismatch,
 *               a voided invoice, a deleted row → `record_refused` with the
 *               reason (Activity shows it; a person decides any refund,
 *               never this job)
 *   4. write:   insert-first, the attempt id in the unique column; a unique
 *               violation means another run got there: read that row, finish
 *   5. finish:  recording → recorded, with the row's key
 *
 * This is the OPPOSITE of the outbox, which would rather lose an email than
 * send two. A payment must never be lost: the job keeps trying for about a day
 * and a half, and the pickup below finds any attempt left in `succeeded` or
 * `recording` after that, so a dead-lettered job is never the last word.
 *
 * ─── TEST MODE NEVER WRITES TO A SHOP TABLE ────────────────────────────────
 *
 * A test-mode success is kept in the meta store only, marked test: a test
 * card must never settle a real invoice.
 */
import { compareAmounts, decimalToMinor, sameAmount } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { isDuplicateKeyError, keptPaymentsRepo, paymentAttemptsRepo, type AttemptProblem, type MetaDb, type PayableRef, type PaymentAttempt } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { afterRecordWrite } from '../crud/after-record-write.js';
import { isWriteConflict } from '../crud/db-errors.js';
import { isUniqueViolation } from '../crud/decided-columns.js';
import { pkLabel } from '../crud/records.js';
import type { Row } from '../crud/mask.js';
import type { WriteActor, WriteContext } from '../crud/write-context.js';
import { createWriteService, type RecordWriteService } from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import { normalizeWriteValue } from '../crud/write-values.js';
import { AppError } from '../errors.js';
import type { JobRegistry } from '../jobs/registry.js';
import { resolvePayable, rowKeyOf, type PayableSources, type ResolvedPayable } from './payables.js';

export const PAYMENTS_RECORD_JOB = 'payments.record';

/** With the worker's backoff capped at an hour, about a day and a half of tries. */
export const PAYMENTS_RECORD_MAX_ATTEMPTS = 40;

/** An attempt left in `succeeded` or `recording` this long is picked up again. */
export const RECORD_PICKUP_AFTER_MS = 10 * 60 * 1000;

/** The pickup's schedule: every five minutes. */
export const PAYMENTS_RECORD_PICKUP_NAME = 'payments-record-pickup';
export const PAYMENTS_RECORD_PICKUP_CRON = '*/5 * * * *';

export interface RecordDeps {
  meta: MetaDb;
  sources: PayableSources;
  writes?: RecordWriteService;
  /** For the audit row and the automations a written payment sets off. */
  app?: FastifyInstance;
  now?: () => number;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void };
  /**
   * Called once per payment, by the one run that moved the attempt to
   * `recorded` (the receipt email). A throw is logged, never raised.
   */
  onRecorded?: (attempt: PaymentAttempt) => Promise<unknown>;
  /** Crash injection for tests: called between the steps named. */
  faults?: { afterClaim?: () => Promise<void> | void; afterWrite?: () => Promise<void> | void };
}

export type RecordOutcome =
  | { state: 'recorded'; key: string; already: boolean }
  | { state: 'record_refused'; problem: AttemptProblem }
  | { state: 'skipped'; reason: string };

/** The provider's name as the row says who recorded it: "Online payment (Stripe)". */
export function recordedByOf(provider: string): string {
  const name = provider === 'demo' ? 'Demo' : provider.replace(/^payments-/, '').replace(/^./, (first) => first.toUpperCase());
  const known: Record<string, string> = { Stripe: 'Stripe', Paypal: 'PayPal' };
  return `Online payment (${known[name] ?? name})`;
}

function actorOf(attempt: PaymentAttempt): WriteActor & { kind: 'system' } {
  return { kind: 'system', id: null, label: recordedByOf(attempt.provider) };
}

/** A refusal from the write path (the table said no) as opposed to a failure to try again. */
function refusalOf(error: unknown): AttemptProblem | null {
  if (isWriteConflict(error)) return null;
  if (error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
    return { code: error.code, message: error.message };
  }
  return null;
}

export async function recordAttempt(deps: RecordDeps, attemptId: string): Promise<RecordOutcome> {
  const now = deps.now ?? (() => Date.now());
  const attempts = paymentAttemptsRepo(deps.meta);
  let attempt = await attempts.byId(attemptId);
  if (attempt === null) return { state: 'skipped', reason: 'no such attempt' };
  if (attempt.state === 'recorded') return { state: 'recorded', key: attempt.recordedKey ?? '', already: true };

  // 1. Claim. A run that finds it `recording` resumes; any other state is not ours to record.
  if (attempt.state === 'succeeded') {
    await attempts.move(attempt.id, 'recording', {}, now());
    attempt = (await attempts.byId(attempt.id))!;
  }
  if (attempt.state === 'recorded') return { state: 'recorded', key: attempt.recordedKey ?? '', already: true };
  if (attempt.state !== 'recording') return { state: 'skipped', reason: `the attempt is ${attempt.state}` };
  await deps.faults?.afterClaim?.();

  const refuse = async (problem: AttemptProblem): Promise<RecordOutcome> => {
    await attempts.move(attempt!.id, 'record_refused', { problem }, now());
    return { state: 'record_refused', problem };
  };
  const finish = async (key: string, already: boolean, payable: ResolvedPayable | null = null): Promise<RecordOutcome> => {
    // The paid status first, so a crash or a failure here leaves the attempt
    // `recording` and the next run (which finds the row) sets it again.
    if (payable !== null) await setPaidStatus(deps, attempt!.payable, payable, actorOf(attempt!), null);
    const moved = await attempts.move(attempt!.id, 'recorded', { recordedKey: key, recordedAt: now() }, now());
    // Only the run that moved it: a retry, a racing run or the pickup finds it recorded and tells nobody again.
    if (moved && deps.onRecorded !== undefined) {
      const recorded = await attempts.byId(attempt!.id);
      if (recorded !== null) {
        await deps.onRecorded(recorded).catch((error: unknown) => {
          deps.log?.warn({ attempt: recorded.id, err: error }, 'payment recorded; what follows a recording failed');
        });
      }
    }
    return { state: 'recorded', key, already };
  };

  const taken = attempt.takenAmount;
  const takenCurrency = attempt.takenCurrency;
  if (taken === null || takenCurrency === null) return refuse({ code: 'NOT_TAKEN', message: 'The payment service did not say what it took.' });

  // ── Test mode (and the demo service, which is never live): kept in meta,
  //    marked test, never in a shop table. Anything but a live attempt counts. ──
  if (attempt.mode !== 'live' || attempt.provider === 'demo') {
    const kept = await keepPayment(deps, attempt, taken, takenCurrency, now());
    await deps.faults?.afterWrite?.();
    return finish(`kept:${kept.id}`, kept.already);
  }

  const payable = await resolvePayable(deps.sources, attempt.payable);

  // 2. Already written by a run that died before finishing?
  if (payable !== null) {
    const found = await existingRecord(deps, attempt, payable);
    if (found !== null) return finish(found, true, payable);
  } else {
    const kept = await keptPaymentsRepo(deps.meta).byAttempt(attempt.id);
    if (kept !== null) return finish(`kept:${kept.id}`, true);
  }

  // 3. Check what was taken against what is due now.
  if (payable === null) return refuse({ code: 'GONE', message: 'The record this payment was for no longer exists.' });
  if (takenCurrency !== attempt.currency || takenCurrency !== payable.currency) {
    return refuse({ code: 'CURRENCY_DIFFERS', message: `The payment service took ${takenCurrency}; the record is in ${payable.currency || attempt.currency}.` });
  }
  if (!sameAmount(taken, attempt.amount)) {
    return refuse({ code: 'AMOUNT_DIFFERS', message: `The payment service took ${taken} ${takenCurrency}; ${attempt.amount} was asked.` });
  }
  if (payable.refusal !== null) {
    const code = payable.refusal.code === 'NOTHING_DUE' ? 'ALREADY_PAID' : payable.refusal.code;
    return refuse({ code, message: payable.refusal.message });
  }
  if (compareAmounts(taken, payable.due) === 1) {
    return refuse({ code: 'MORE_THAN_DUE', message: `${taken} ${takenCurrency} was taken, but only ${payable.due} is due now.` });
  }

  // 4. Write, insert-first.
  let key: string;
  let already = false;
  if (payable.recordInto.kind === 'kept') {
    const kept = await keepPayment(deps, attempt, taken, takenCurrency, now());
    key = `kept:${kept.id}`;
    already = kept.already;
  } else {
    try {
      const written = await writePaymentRow(deps, payable, attemptWrite(attempt, taken, takenCurrency, now()));
      if (written === 'refused') return refuse({ code: 'NOT_PAYABLE', message: 'The payment cannot be written into its payments table.' });
      key = written;
    } catch (error) {
      // Whatever went wrong, a row carrying this attempt means the payment is
      // written (a hook that failed after the save, a racing run): finish.
      const found = await existingRecord(deps, attempt, payable).catch(() => null);
      if (found !== null) return finish(found, true, payable);
      if (isUniqueViolation(error)) throw error;
      const problem = refusalOf(error);
      if (problem === null) throw error;
      return refuse(problem);
    }
  }
  await deps.faults?.afterWrite?.();

  // 5. Finish.
  return finish(key, already, payable);
}

/** Inserts the kept payment, or finds the one this attempt already made. */
async function keepPayment(deps: RecordDeps, attempt: PaymentAttempt, taken: string, currency: string, at: number): Promise<{ id: string; already: boolean }> {
  const kept = keptPaymentsRepo(deps.meta);
  const paidWith = attempt.paidWith as { method?: string; label?: string } | null;
  const inserted = await kept.insert(
    {
      payable: attempt.payable,
      number: null,
      amount: taken,
      currency,
      method: paidWith?.method ?? 'online',
      methodNote: paidWith?.label ?? null,
      provider: attempt.provider,
      mode: attempt.mode,
      attemptId: attempt.id,
      approvalCode: null,
      cardLast4: null,
      note: null,
      paidOn: attempt.settledAt ?? at,
      recordedBy: recordedByOf(attempt.provider),
      recordedByUser: null,
    },
    at,
  );
  if (inserted !== null) return { id: inserted.id, already: false };
  const existing = await kept.byAttempt(attempt.id);
  if (existing === null) throw new Error(`The payment for ${attempt.id} was refused as a duplicate and then not found.`);
  return { id: existing.id, already: true };
}

/** The key of a row already carrying this attempt's reference, or null. */
async function existingRecord(deps: RecordDeps, attempt: PaymentAttempt, payable: ResolvedPayable): Promise<string | null> {
  if (payable.recordInto.kind === 'kept') {
    const kept = await keptPaymentsRepo(deps.meta).byAttempt(attempt.id);
    return kept === null ? null : `kept:${kept.id}`;
  }
  const into = payable.recordInto;
  const found = await deps.sources.table(attempt.payable.connectionId!, into.tableName);
  if (found === null) return null;
  const row = (await found.target.db
    .selectFrom(found.table.id)
    .selectAll()
    .where((eb) => eb(eb.ref(into.reference as never), '=', attempt.id as never))
    .executeTakeFirst()) as Row | undefined;
  return row === undefined ? null : `row:${into.tableName}:${rowKeyOf(found.table, row)}`;
}

/**
 * One payment to write into a payable's payments table: an online one the
 * record job confirmed, or one a person recorded by hand. Both go through
 * this one write path, as a `payment` write.
 */
export interface PaymentWrite {
  ref: PayableRef;
  amount: string;
  currency: string;
  /** The way it was paid: a provider's method (`card`, `sepa_debit`) or a way recorded by hand (`cash`, `cheque`). */
  method: string;
  /** Recorded by hand: the way is written as it is when the table's own values have no other word for it. */
  manual: boolean;
  /** What goes in the note column: the provider's label, or the person's note. */
  note: string | null;
  /** The value of the unique reference column, when there is one. */
  reference: string | null;
  paidAt: number;
  /** The service that took it, for an online payment. */
  provider: string | null;
  approvalCode: string | null;
  cardLast4: string | null;
  /** The system for an online payment; the person who recorded one by hand. */
  actor: PaymentActor;
  request: FastifyRequest | null;
}

/** Who writes a payment: Adminium for an online one, a signed-in person for one recorded by hand. */
export type PaymentActor = WriteActor & { kind: 'system' | 'user' };

/** The write an attempt the provider confirmed makes. */
function attemptWrite(attempt: PaymentAttempt, taken: string, currency: string, at: number): PaymentWrite {
  const paidWith = attempt.paidWith as { method?: string; label?: string } | null;
  return {
    ref: attempt.payable,
    amount: taken,
    currency,
    method: paidWith?.method ?? 'online',
    manual: false,
    note: paidWith?.label ?? null,
    reference: attempt.id,
    paidAt: attempt.settledAt ?? at,
    provider: attempt.provider,
    approvalCode: null,
    cardLast4: null,
    actor: actorOf(attempt),
    request: null,
  };
}

/** Writes a payment into the payable's payments table through the write service. */
export async function writePaymentRow(deps: RecordDeps, payable: ResolvedPayable, write: PaymentWrite): Promise<string | 'refused'> {
  const into = payable.recordInto;
  if (into.kind !== 'table') throw new Error('not a table payable');
  if (write.ref.connectionId === null) return 'refused';
  const found = await deps.sources.table(write.ref.connectionId, into.tableName);
  if (found === null) return 'refused';
  const amount = into.amountUnit === 'minor' ? decimalToMinor(write.amount, currencyScale(write.currency)) : write.amount;
  if (amount === null) return 'refused';
  const values: Row = { [into.link]: into.linkValue, [into.amount]: amount };
  if (write.reference !== null) values[into.reference] = write.reference;
  // The day the money arrived, on the shop's own calendar.
  if (into.date !== null) values[into.date] = localDate(write.paidAt, found.target.timezone ?? 'UTC');
  if (into.method !== null) {
    const mapped = into.method.values[write.method] ?? (write.manual ? write.method : (into.method.values['*'] ?? write.method));
    values[into.method.column] = mapped;
  }
  if (into.note !== null && write.note !== null) values[into.note] = write.note;
  if (into.shapeColumns) {
    values['currency'] = write.currency;
    if (write.provider !== null) values['provider'] = recordedByOf(write.provider).replace(/^Online payment \((.*)\)$/, '$1');
    // A person's write is stamped with their name by the table's own rule.
    if (write.actor.kind === 'system') values['recorded_by'] = write.actor.label;
    if (write.approvalCode !== null) values['approval_code'] = write.approvalCode;
    if (write.cardLast4 !== null) values['card_last4'] = write.cardLast4;
  }
  // Only the columns the table has; each as the write path wants it.
  const prepared: Row = {};
  for (const [column, value] of Object.entries(values)) {
    const resolved = found.table.columns.get(column);
    if (resolved !== undefined) prepared[column] = normalizeWriteValue(resolved, value);
  }
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  const context: WriteContext = { origin: 'payment', hops: 0, actor: write.actor, request: write.request };
  const row = await writes.create({
    target: found.target,
    values: prepared,
    context,
    announce: async (created) => {
      if (deps.app === undefined) return;
      const pk = Object.fromEntries(found.table.primaryKey.map((column) => [column, created[column]]));
      await afterRecordWrite(deps.app, {
        request: write.request,
        actor: write.actor,
        meta: deps.meta,
        connectionId: found.target.connectionId,
        table: found.table,
        action: 'create',
        entity: { connectionId: found.target.connectionId, table: found.table.id, pk, label: pkLabel(found.table, pk) },
        before: null,
        after: created,
        origin: 'payment',
      });
    },
  });
  return `row:${into.tableName}:${rowKeyOf(found.table, row)}`;
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function localDate(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/**
 * When the due reached zero and the profile names a status, set it — as a
 * payment write. The table refusing the move (its rules say no) is logged and
 * left: the payment stands. Anything else is thrown, so the job tries again.
 */
export async function setPaidStatus(deps: RecordDeps, ref: PayableRef, before: ResolvedPayable, actor: PaymentActor, request: FastifyRequest | null): Promise<void> {
  try {
    await setPaidStatusOnce(deps, ref, before, actor, request);
  } catch (error) {
    if (refusalOf(error) === null) throw error;
    deps.log?.warn({ payable: ref.rowKey, code: (error as AppError).code }, 'payment recorded; its table refused the paid status');
  }
}

async function setPaidStatusOnce(deps: RecordDeps, ref: PayableRef, before: ResolvedPayable, actor: PaymentActor, request: FastifyRequest | null): Promise<void> {
  if (before.status === null || ref.connectionId === null || ref.tableName === null) return;
  const after = await resolvePayable(deps.sources, ref);
  if (after === null || !sameAmount(after.due, '0')) return;
  const found = await deps.sources.table(ref.connectionId, ref.tableName);
  if (found === null) return;
  const row = await deps.sources.readRow(ref.connectionId, ref.tableName, ref.rowKey);
  if (row === null || row[before.status.column] === before.status.paid) return;
  const pk = Object.fromEntries(found.table.primaryKey.map((column) => [column, row[column]]));
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  await writes.update({
    target: found.target,
    pk,
    values: { [before.status.column]: before.status.paid },
    context: { origin: 'payment', hops: 0, actor, request },
    skipIfNone: true,
    announce: async () => {},
  });
}

// ─── The job ────────────────────────────────────────────────────────────────

const payloadSchema = z.object({ attemptId: z.string().min(1).max(64) }).strict();

export function registerPaymentsRecordHandler(registry: JobRegistry, deps: RecordDeps): void {
  registry.registerJobHandler(
    PAYMENTS_RECORD_JOB,
    payloadSchema,
    async (payload) => {
      const outcome = await recordAttempt(deps, payload.attemptId);
      return outcome.state === 'record_refused' ? { state: outcome.state, code: outcome.problem.code } : outcome;
    },
    { internal: true },
  );
}

/** Queues the record job for an attempt. A racing enqueue of the same attempt is "already queued". */
export async function enqueueRecord(
  enqueue: (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>,
  attemptId: string,
): Promise<boolean> {
  try {
    await enqueue({ kind: PAYMENTS_RECORD_JOB, payload: { attemptId }, dedupeKey: `payment-record:${attemptId}`, maxAttempts: PAYMENTS_RECORD_MAX_ATTEMPTS });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/**
 * Finds every attempt left in `succeeded` or `recording` for a while and
 * queues its record job again: the safety net under a job that died or
 * dead-lettered. Returns how many were queued.
 */
export async function pickUpRecordings(
  meta: MetaDb,
  enqueue: Parameters<typeof enqueueRecord>[0],
  at: number = Date.now(),
): Promise<number> {
  const stuck = await paymentAttemptsRepo(meta).stale(['succeeded', 'recording'], at - RECORD_PICKUP_AFTER_MS, 200);
  let queued = 0;
  for (const attempt of stuck) if (await enqueueRecord(enqueue, attempt.id)) queued += 1;
  return queued;
}
