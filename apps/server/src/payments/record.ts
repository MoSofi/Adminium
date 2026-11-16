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
import { addAmounts, compareAmounts, decimalToMinor, sameAmount } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { isDuplicateKeyError, keptPaymentsRepo, paymentAttemptsRepo, type AttemptProblem, type MetaDb, type PayableRef, type PaymentAttempt } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { afterRecordWrite } from '../crud/after-record-write.js';
import { isWriteConflict } from '../crud/db-errors.js';
import { isUniqueViolation } from '../crud/decided-columns.js';
import { pkLabel } from '../crud/records.js';
import type { Row } from '../crud/mask.js';
import type { WriteActor, WriteContext } from '../crud/write-context.js';
import { createWriteService } from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import { normalizeWriteValue } from '../crud/write-values.js';
import { AppError } from '../errors.js';
import type { JobRegistry } from '../jobs/registry.js';
import { pkOfRowKey, resolvePayable, rowKeyOf, type ResolvedPayable } from './payables.js';
import { listRuleMadeRow, rehashSampleRow, sampleListsNaming, type SampleList } from '../apps/sample-data.js';
import { followDocumentStatus } from './document-status.js';
import type { RecordDeps } from './record-deps.js';
import { followRefundsOnRecord } from './refunds.js';
import { serviceMark } from './service-name.js';

export const PAYMENTS_RECORD_JOB = 'payments.record';

/** With the worker's backoff capped at an hour, about a day and a half of tries. */
export const PAYMENTS_RECORD_MAX_ATTEMPTS = 40;

/** An attempt left in `succeeded` or `recording` this long is picked up again. */
export const RECORD_PICKUP_AFTER_MS = 10 * 60 * 1000;

/** The pickup's schedule: every five minutes. */
export const PAYMENTS_RECORD_PICKUP_NAME = 'payments-record-pickup';
export const PAYMENTS_RECORD_PICKUP_CRON = '*/5 * * * *';

export type { RecordDeps } from './record-deps.js';

export type RecordOutcome =
  | { state: 'recorded'; key: string; already: boolean }
  | { state: 'record_refused'; problem: AttemptProblem }
  | { state: 'skipped'; reason: string };

/** The provider's name as the row says who recorded it: "Online payment (Stripe)". */
export function recordedByOf(provider: string): string {
  return `Online payment (${serviceMark(provider)})`;
}

function actorOf(attempt: PaymentAttempt): WriteActor & { kind: 'system' } {
  return { kind: 'system', id: null, label: recordedByOf(attempt.provider) };
}

/** A lock another write holds, or a write that met another: tried again, as a timed move tries again the next minute. */
const BUSY = new Set(['WRITE_CONFLICT', 'CAPACITY_BUSY', 'NUMBER_BUSY', 'BOOKING_BUSY']);

/** A refusal from the write path (the table said no) as opposed to a failure to try again. */
function refusalOf(error: unknown): AttemptProblem | null {
  if (isWriteConflict(error)) return null;
  if (error instanceof AppError && BUSY.has(error.code)) return null;
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
  // A resumed run may find the record already moved to paid by the run that died: it says so again (`setPaidStatus`).
  const resumed = attempt.state === 'recording';
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
    // Paid on the pay page: the payable's further columns (`status.set`) go with the move. A card reader's charge at the counter writes none.
    const unmoved = payable === null ? null : await setPaidStatus(deps, attempt!.payable, payable, actorOf(attempt!), null, { resumed, mode: attempt!.mode, online: attempt!.reader == null });
    // A sample row Adminium moved to paid is still the sample's own to take away.
    if (sampleLists !== null && payable !== null) await rehashPayable(deps, attempt!.payable);
    // The money is written; the record would not move to paid. Kept on the attempt and flagged for a person, never a log line only.
    const moved = await attempts.move(attempt!.id, 'recorded', { recordedKey: key, recordedAt: now(), ...(unmoved === null ? {} : { problem: unmoved }) }, now());
    if (moved && unmoved !== null) await attempts.flag(attempt!.id, now());
    // Refunds made before it was written down (an event that came first) follow now.
    if (moved) {
      await followRefundsOnRecord(deps, attempt!.id).catch((error: unknown) => {
        deps.log?.warn({ attempt: attempt!.id, err: error }, 'payment recorded; its refunds are written by the sweep');
      });
    }
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
  //    marked test, never in a shop table — but for a sample row (a rehearsal's
  //    order, or one "Add sample data" made), written into the app's own tables
  //    like a real payment and listed with the sample, so "Remove sample data"
  //    takes it. A real row never gets a test payment. ──
  const test = attempt.mode !== 'live' || attempt.provider === 'demo';
  const sampleLists = test ? await sampleListsOf(deps, attempt.payable) : null;
  if (test && sampleLists === null) {
    const kept = await keepPayment(deps, attempt, taken, takenCurrency, now());
    await deps.faults?.afterWrite?.();
    return finish(`kept:${kept.id}`, kept.already);
  }

  const payable = await resolvePayable(deps.sources, attempt.payable, { mode: attempt.mode });

  // 2. Already written by a run that died before finishing?
  if (payable !== null) {
    const found = await existingRecord(deps, attempt, payable);
    if (found !== null) return finish(found, true, payable);
  } else {
    const kept = await keptPaymentsRepo(deps.meta).byAttempt(attempt.id);
    if (kept !== null) return finish(`kept:${kept.id}`, true);
  }

  // 3. Check what was taken against what is due now.
  // A rehearsal's row removed with the sample data while it was being paid: the test payment ends quietly, kept in meta.
  if (payable === null && test) {
    const kept = await keepPayment(deps, attempt, taken, takenCurrency, now());
    return finish(`kept:${kept.id}`, kept.already);
  }
  if (payable === null) return refuse({ code: 'GONE', message: 'The record this payment was for no longer exists.' });
  if (takenCurrency !== attempt.currency || takenCurrency !== payable.currency) {
    return refuse({ code: 'CURRENCY_DIFFERS', message: `The payment service took ${takenCurrency}; the record is in ${payable.currency || attempt.currency}.` });
  }
  // A card reader takes what was asked and the tip the customer added on it: nothing else.
  const asked = attempt.reader?.asked ?? attempt.amount;
  const tip = attempt.reader?.tip ?? '0';
  const expected = attempt.reader === null ? attempt.amount : addAmounts(asked, tip, currencyScale(takenCurrency));
  if (expected === null || !sameAmount(taken, expected)) {
    return refuse({ code: 'AMOUNT_DIFFERS', message: `The payment service took ${taken} ${takenCurrency}; ${expected ?? attempt.amount} was asked.` });
  }
  if (payable.refusal !== null) {
    const code = payable.refusal.code === 'NOTHING_DUE' ? 'ALREADY_PAID' : payable.refusal.code;
    return refuse({ code, message: payable.refusal.message });
  }
  // What counts against the record is what was asked: the tip is the staff's, never the record's.
  if (compareAmounts(asked, payable.due) === 1) {
    return refuse({ code: 'MORE_THAN_DUE', message: `${asked} ${takenCurrency} was taken, but only ${payable.due} is due now.` });
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
      // A rehearsal's payment goes in the same lists as the row it pays: a sample row too.
      if (sampleLists !== null) await listSamplePayment(deps, payable, written, sampleLists);
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

/** The sample lists naming a test payment's row, or null when it is no sample row (or no table's row at all). */
async function sampleListsOf(deps: RecordDeps, ref: PayableRef): Promise<SampleList[] | null> {
  if ((ref.kind !== 'profile' && ref.kind !== 'shape') || ref.connectionId === null || ref.tableName === null) return null;
  const found = await deps.sources.table(ref.connectionId, ref.tableName);
  if (found === null) return null;
  const pk = pkOfRowKey(found.table, ref.rowKey);
  if (pk === null) return null;
  const lists = await sampleListsNaming(deps.meta, found.target.db, ref.connectionId, found.table, pk);
  return lists.length === 0 ? null : lists;
}

/** A rehearsal's payment row, entered in the lists its paid row is in. */
async function listSamplePayment(deps: RecordDeps, payable: ResolvedPayable, written: string, lists: readonly SampleList[]): Promise<void> {
  const into = payable.recordInto;
  if (into.kind !== 'table' || payable.ref.connectionId === null) return;
  const found = await deps.sources.table(payable.ref.connectionId, into.tableName);
  if (found === null) return;
  const pk = pkOfRowKey(found.table, written.slice(`row:${into.tableName}:`.length));
  if (pk === null) return;
  await listRuleMadeRow(deps.meta, found.target, pk, lists, (deps.now ?? Date.now)());
}

/** A sample row Adminium changed, recorded again as it now stands. */
async function rehashPayable(deps: RecordDeps, ref: PayableRef): Promise<void> {
  if (ref.connectionId === null || ref.tableName === null) return;
  const found = await deps.sources.table(ref.connectionId, ref.tableName);
  const pk = found === null ? null : pkOfRowKey(found.table, ref.rowKey);
  if (found === null || pk === null) return;
  await rehashSampleRow(deps.meta, found.target, pk).catch(() => undefined);
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
  /** A card reader payment's tip, beside the amount asked. */
  tip?: string | null;
  /** The system for an online payment; the person who recorded one by hand. */
  actor: PaymentActor;
  request: FastifyRequest | null;
}

/** Who writes a payment: Adminium for an online one, a signed-in person for one recorded by hand. */
export type PaymentActor = WriteActor & { kind: 'system' | 'user' };

/** The write an attempt the provider confirmed makes. */
function attemptWrite(attempt: PaymentAttempt, taken: string, currency: string, at: number): PaymentWrite {
  const paidWith = attempt.paidWith as { method?: string; label?: string } | null;
  const reader = attempt.reader;
  return {
    ref: attempt.payable,
    // A reader payment writes what was asked; its tip goes beside it.
    amount: reader?.asked ?? taken,
    ...(reader === null || reader.tip === null ? {} : { tip: reader.tip }),
    currency,
    method: paidWith?.method ?? 'online',
    manual: false,
    note: paidWith?.label ?? null,
    reference: attempt.id,
    paidAt: attempt.settledAt ?? at,
    provider: attempt.provider,
    approvalCode: reader?.approvalCode ?? null,
    cardLast4: reader?.last4 ?? null,
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
  // A profile's own columns: when it was paid, by which service, a terminal's code and the card's last four, the currency.
  if (into.paidAt !== undefined && into.paidAt !== null) values[into.paidAt] = new Date(write.paidAt).toISOString();
  if (into.provider !== undefined && into.provider !== null && write.provider !== null) values[into.provider] = serviceMark(write.provider);
  if (into.approvalCode !== undefined && into.approvalCode !== null && write.approvalCode !== null) values[into.approvalCode] = write.approvalCode;
  if (into.last4 !== undefined && into.last4 !== null && write.cardLast4 !== null) values[into.last4] = write.cardLast4;
  if (into.currency !== undefined && into.currency !== null) values[into.currency] = write.currency;
  if (into.tip !== undefined && into.tip !== null && write.tip != null) {
    const tip = into.amountUnit === 'minor' ? decimalToMinor(write.tip, currencyScale(write.currency)) : write.tip;
    if (tip !== null) values[into.tip] = tip;
  }
  if (into.shapeColumns) {
    values['currency'] = write.currency;
    if (write.provider !== null) values['provider'] = serviceMark(write.provider);
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
 * payment write, announced like any write, so the app's own "paid" mail, its
 * live screens and its rules hear of it. Only from the states the payable
 * names (`status.from`): a record in any other state keeps its state. The move
 * is the app's own declared one, so a move only some roles may make is made.
 * A lock another write holds is thrown, so the job tries again; the table
 * refusing the move (its rules say no) is returned: the payment stands, and
 * the attempt says so for a person.
 */
export async function setPaidStatus(
  deps: RecordDeps,
  ref: PayableRef,
  before: ResolvedPayable,
  actor: PaymentActor,
  request: FastifyRequest | null,
  /**
   * `resumed`: a run that took over from one that died — a record it finds paid may never have been announced.
   * `online`: paid on the pay page — the payable's further columns (`status.set`) are written with the move; a
   * payment recorded by hand, or taken on a card reader, writes none.
   */
  opts: { resumed?: boolean; mode?: 'live' | 'test'; online?: boolean } = {},
): Promise<AttemptProblem | null> {
  // A designer invoice: its Paid follows the balance (a meta write; a failure is thrown, so the job tries again).
  if (ref.kind === 'document') {
    await followDocumentStatus({ meta: deps.meta, sources: deps.sources, ...(deps.now === undefined ? {} : { now: deps.now }) }, ref);
    return null;
  }
  try {
    await setPaidStatusOnce(deps, ref, before, actor, request, opts.resumed === true, opts.mode ?? 'live', opts.online === true);
    return null;
  } catch (error) {
    const problem = refusalOf(error);
    if (problem === null) throw error;
    deps.log?.warn({ payable: ref.rowKey, code: problem.code }, 'payment recorded; its table refused the paid status');
    return { code: 'STATUS_REFUSED', message: problem.message };
  }
}

async function setPaidStatusOnce(deps: RecordDeps, ref: PayableRef, before: ResolvedPayable, actor: PaymentActor, request: FastifyRequest | null, resumed: boolean, mode: 'live' | 'test', online: boolean): Promise<void> {
  const status = before.status;
  if (status === null || ref.connectionId === null || ref.tableName === null) return;
  const after = await resolvePayable(deps.sources, ref, { mode });
  if (after === null || !sameAmount(after.due, '0')) return;
  const found = await deps.sources.table(ref.connectionId, ref.tableName);
  if (found === null) return;
  const row = await deps.sources.readRow(ref.connectionId, ref.tableName, ref.rowKey);
  if (row === null) return;
  if (row[status.column] === status.paid) {
    // The run that died moved it and may have died before saying so: said again. The app's mail is queued once whatever is said twice.
    if (resumed && status.from !== undefined && deps.app !== undefined) {
      const pk = Object.fromEntries(found.table.primaryKey.map((column) => [column, row[column]]));
      await afterRecordWrite(deps.app, {
        request,
        actor,
        meta: deps.meta,
        connectionId: found.target.connectionId,
        table: found.table,
        action: 'update',
        entity: { connectionId: found.target.connectionId, table: found.table.id, pk, label: pkLabel(found.table, pk) },
        before: { ...row, [status.column]: status.from[0] },
        after: row,
        origin: 'payment',
      });
    }
    return;
  }
  const from = row[status.column] === null || row[status.column] === undefined ? null : String(row[status.column]);
  // Only from the states the payable names: a visit already seen, a stay already in the house, keep theirs.
  if (status.from !== undefined && (from === null || !status.from.includes(from))) return;
  const pk = Object.fromEntries(found.table.primaryKey.map((column) => [column, row[column]]));
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  // Paid online: the payable's further columns are written in the same statement as the move, open to the lock as its own.
  const sets = online ? (status.set ?? {}) : {};
  await writes.update({
    target: found.target,
    pk,
    values: { ...sets, [status.column]: status.paid },
    // The app's own move to paid, made by Adminium: as a timed move is, whatever roles the move names.
    context: { origin: 'payment', hops: 0, actor, request, ...(from === null ? {} : { declared: { from, to: status.paid, ...(Object.keys(sets).length === 0 ? {} : { sets: Object.keys(sets) }) } }) },
    skipIfNone: true,
    announce: async (outcome) => {
      if (deps.app === undefined || outcome.count === 0) return;
      await afterRecordWrite(deps.app, {
        request,
        actor,
        meta: deps.meta,
        connectionId: found.target.connectionId,
        table: found.table,
        action: 'update',
        entity: { connectionId: found.target.connectionId, table: found.table.id, pk, label: pkLabel(found.table, pk) },
        before: outcome.before ?? row,
        after: outcome.after,
        origin: 'payment',
      });
    },
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
