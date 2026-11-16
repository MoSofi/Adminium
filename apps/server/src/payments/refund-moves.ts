// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REFUNDS THAT START BY THEMSELVES (`refundOn`, plan 72 Q4, Q10, Q11).
 *
 * A payable may name the moves after which its online money goes back in
 * full by itself: a show cancelled, a customer's free cancellation. Judged at
 * the move, on the server, by who made it:
 *
 *  - `customer`: the customer's own move, through the app's public side;
 *  - `system`: Adminium's own timed move (an unpaid hold lapsing);
 *  - `refund-right`: a staff member who may refund (the install's right, or
 *    the app's own).
 *
 * Anyone else's move (a kitchen cancelling, a rule) refunds nothing: the
 * payment is flagged "Refund owed" for someone who may refund. So is a move
 * while the app's own switch ("Refund free cancellations automatically") is
 * off. A move past the app's late window (`before`, a clinic) refunds nothing
 * and owes nothing: the app's own rules keep that money. Moves the mapping
 * does not name (`from`) never refund: a row once handed over, checked in or
 * seen is never in a state such a move starts from.
 *
 * The refund itself runs in a job after the move committed, once per payment
 * (`auto:<attempt>`), for what is still refundable:
 *
 *  - the column model: Adminium's own refund, as a person's would be;
 *  - the rows model: Adminium writes the app's refund row as the system,
 *    with the app's own `auto` values, through the payments-table guard, then
 *    sends the money back for that row (`app-refunds.ts`). The row carries a
 *    mark (`auto:<attempt>`) in its reference column until the provider's
 *    own reference replaces it, so a run that died after writing it finds it
 *    and never writes a second.
 *
 * Each one is in Activity and tells the payment managers.
 */
import { decimalToMinor } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { payableProfilesRepo, paymentAttemptsRepo, refundsRepo, type PayableProfile, type PaymentAttempt, type RefundOn } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';

import { afterRecordWrite, type RecordWriteEvent } from '../crud/after-record-write.js';
import { pkLabel } from '../crud/records.js';
import { createWriteService } from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import type { JobRegistry } from '../jobs/registry.js';
import { askAppRefund } from './app-refunds.js';
import { noticeMoney, tellPaymentManagers } from './notices.js';
import { rowKeyOf } from './payables.js';
import { refundableOf, requestRefund, type RefundDeps } from './refunds.js';

export const PAYMENTS_AUTO_REFUND_JOB = 'payments.auto-refund';

/** What a payment is flagged with when a move would have refunded it, but nobody who may refund made it (or the app's switch is off). */
export const REFUND_OWED = 'REFUND_OWED';

/** Who made a move, as `refundOn` reads it. */
export type Mover = 'customer' | 'system' | 'refund-right' | 'other';

/** Who made the write an event tells of: the customer, a timed move, a staff member who may refund, or anyone else. */
export async function moverOf(event: RecordWriteEvent, ownerApp: string | null): Promise<Mover> {
  if (event.origin === 'public') return 'customer';
  const carried = event as RecordWriteEvent & { request?: FastifyRequest | null; actor?: { kind?: string } };
  if (event.origin === 'automation' && carried.actor?.kind === 'system' && (carried.request ?? null) === null) return 'system';
  const request = carried.request ?? null;
  if (request === null || typeof request.can !== 'function' || request.user == null) return 'other';
  try {
    if (await request.can('system:payments:refund')) return 'refund-right';
    if (ownerApp !== null && (await request.can(`payments:${ownerApp}:refund`))) return 'refund-right';
  } catch {
    return 'other';
  }
  return 'other';
}

/** The money a payment still holds that a refund may give back: recorded, taken, not refunded in full. */
function refundable(attempt: PaymentAttempt): boolean {
  return attempt.state === 'recorded' && refundableOf(attempt) !== '0';
}

export interface RefundMoveDeps extends RefundDeps {
  /** A column of the app's one-row settings table, read at the move. */
  setting?: (connectionId: string, table: string, column: string) => Promise<unknown>;
}

/** Whether a move refunds, owes, or does nothing. */
async function judge(deps: RefundMoveDeps, connectionId: string, on: RefundOn, move: RefundOn['moves'][number], mover: Mover, after: Record<string, unknown>): Promise<'refund' | 'owed' | 'none'> {
  if (on.before !== undefined) {
    const at = after[on.before.column];
    const moment = at instanceof Date ? at.getTime() : typeof at === 'string' || typeof at === 'number' ? new Date(at).getTime() : Number.NaN;
    const hours = Number((await deps.setting?.(connectionId, on.before.hours.table, on.before.hours.column)) ?? 0);
    // Past the late window: the app's own rules keep the money, and nothing is owed.
    if (Number.isNaN(moment) || moment - (deps.now ?? Date.now)() < (Number.isFinite(hours) ? hours : 0) * 3_600_000) return 'none';
  }
  if (!(move.by as readonly string[]).includes(mover)) return 'owed';
  if (on.switch !== undefined) {
    const value = await deps.setting?.(connectionId, on.switch.table, on.switch.column);
    if (!(value === true || value === 1 || value === '1' || value === 'true')) return 'owed';
  }
  return 'refund';
}

/**
 * Hears a payable row's move: queues its automatic refund, or flags its
 * payments "Refund owed". Never throws: a payment flagged by nothing is still
 * refundable by a person in Activity.
 */
export function createRefundMoveWatch(deps: RefundMoveDeps & { warn?: (fields: Record<string, unknown>, message: string) => void }) {
  return {
    async onRecordEvent(event: RecordWriteEvent): Promise<void> {
      if (event.action !== 'update' || event.before === null || event.after === null) return;
      try {
        const profile = await payableProfilesRepo(deps.meta).byTable(event.connectionId, event.table.id);
        const on = profile?.mapping?.refundOn;
        const status = profile?.mapping?.status;
        if (profile == null || on === undefined || status == null) return;
        const from = String(event.before[status.column] ?? '');
        const to = String(event.after[status.column] ?? '');
        if (from === to) return;
        const move = on.moves.find((one) => one.to === to && (one.from === undefined || one.from.includes(from)));
        if (move === undefined) return;
        const ref = { kind: profile.shape != null ? ('shape' as const) : ('profile' as const), connectionId: event.connectionId, tableName: event.table.id, rowKey: rowKeyOf(event.table, event.after) };
        const paid = (await paymentAttemptsRepo(deps.meta).forPayable(ref, 50)).filter(refundable);
        if (paid.length === 0) return;
        const verdict = await judge(deps, event.connectionId, on, move, await moverOf(event, profile.ownerApp), event.after);
        if (verdict === 'none') return;
        for (const attempt of paid) {
          if (verdict === 'refund') {
            await deps.enqueue?.({ kind: PAYMENTS_AUTO_REFUND_JOB, payload: { attemptId: attempt.id }, dedupeKey: `${PAYMENTS_AUTO_REFUND_JOB}:${attempt.id}`, maxAttempts: 20 });
          } else {
            await paymentAttemptsRepo(deps.meta).flagRecorded(attempt.id, { code: REFUND_OWED, message: `${attempt.payableLabel} moved to ${to}: its online payment is owed a refund. Someone who may refund gives it back.` }, (deps.now ?? Date.now)());
          }
        }
      } catch (error) {
        deps.warn?.({ err: error, table: event.table.id }, 'payments: a refund on a move could not be judged');
      }
    },
  };
}

/** The mark an automatic refund row carries in its reference column until the provider's reference replaces it. */
const autoMark = (attemptId: string): string => `auto:${attemptId}`;

/**
 * Gives an automatic refund: once per payment, for what it still holds.
 * Throws while it cannot finish (a database away), so the job tries again.
 */
export async function giveAutoRefund(deps: RefundDeps, attemptId: string): Promise<'refunded' | 'nothing' | 'refused'> {
  const attempt = await paymentAttemptsRepo(deps.meta).byId(attemptId);
  if (attempt === null || !refundable(attempt)) return 'nothing';
  const refunds = refundsRepo(deps.meta);
  if ((await refunds.forAttempt(attempt.id)).some((one) => one.source === 'auto')) return 'nothing';
  const amount = refundableOf(attempt);
  const ref = attempt.payable;
  const profile = ref.kind === 'profile' && ref.connectionId !== null && ref.tableName !== null ? await payableProfilesRepo(deps.meta).byTable(ref.connectionId, ref.tableName) : null;
  const rows = profile?.mapping?.refunds?.model === 'rows' ? profile.mapping.refunds : null;
  const payments = profile?.mapping?.payments.kind === 'table' ? profile.mapping.payments : null;

  if (rows === null || payments === null || ref.connectionId === null) {
    // The column model: Adminium's own refund, as a person's.
    const answer = await requestRefund(deps, { attemptId: attempt.id, amount, reason: 'requested_by_customer', note: null, key: autoMark(attempt.id), requestedBy: null, source: 'auto' });
    if (!answer.ok) return 'refused';
    await tellAuto(deps, attempt, profile, amount);
    return 'refunded';
  }

  // The rows model: the app's own refund row, written by Adminium as the system, then its money sent back.
  const refundTable = await deps.sources.table(ref.connectionId, rows.table);
  const paymentTable = await deps.sources.table(ref.connectionId, payments.table);
  if (refundTable === null || paymentTable === null) return 'refused';
  const db = refundTable.target.db;
  const marked = (await db.selectFrom(refundTable.table.id as never).selectAll().where(sql.ref(rows.providerRef), '=', autoMark(attempt.id)).limit(1).execute()) as Record<string, unknown>[];
  let row = marked[0] ?? null;
  if (row === null) {
    const paymentRow = ((await paymentTable.target.db.selectFrom(paymentTable.table.id as never).selectAll().where(sql.ref(payments.reference), '=', attempt.id).limit(1).execute()) as Record<string, unknown>[])[0];
    if (paymentRow === undefined || paymentTable.table.primaryKey.length !== 1) return 'refused';
    const scale = currencyScale(attempt.takenCurrency ?? attempt.currency);
    const value = payments.amountUnit === 'minor' ? decimalToMinor(amount, scale) : amount;
    if (value === null) return 'refused';
    const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
    const actor = { kind: 'system' as const, id: null, label: 'Refund' };
    row = await writes.create({
      target: refundTable.target,
      values: { ...(rows.auto?.values ?? {}), [rows.payment]: paymentRow[paymentTable.table.primaryKey[0]!], [rows.amount]: value, [rows.providerRef]: autoMark(attempt.id), [rows.state]: 'asked' },
      context: { origin: 'payment', hops: 0, actor, request: null },
      // Told as any new row is (the audit row, the app's rules and mail); asked for below, by this job.
      announce: async (created) => {
        if (deps.app === undefined) return;
        const pk = Object.fromEntries(refundTable.table.primaryKey.map((column) => [column, created[column]]));
        await afterRecordWrite(deps.app, {
          request: null,
          actor,
          meta: deps.meta,
          connectionId: refundTable.target.connectionId,
          table: refundTable.table,
          action: 'create',
          entity: { connectionId: refundTable.target.connectionId, table: refundTable.table.id, pk, label: pkLabel(refundTable.table, pk) },
          before: null,
          after: created,
          origin: 'payment',
        });
      },
    });
  }
  const outcome = await askAppRefund(deps, { connectionId: ref.connectionId, table: refundTable.table.id, rowKey: rowKeyOf(refundTable.table, row) }, null, 'auto');
  if (outcome === 'not-sent') return 'refused';
  await tellAuto(deps, attempt, profile, amount);
  return 'refunded';
}

/** The payment managers are told of each automatic refund, once. */
async function tellAuto(deps: RefundDeps, attempt: PaymentAttempt, profile: PayableProfile | null, amount: string): Promise<void> {
  if (deps.notices === undefined) return;
  await tellPaymentManagers(deps.notices, {
    kind: 'payments.auto-refund',
    about: `auto-refund:${attempt.id}`,
    words: (locale) => ({
      title: { key: 'autoRefund.title', fallback: 'Refunded automatically' },
      body: { key: 'autoRefund.body', fallback: '{amount} for {label}, after its free cancellation in {app}' },
      values: { amount: noticeMoney(amount, attempt.takenCurrency ?? attempt.currency, locale), label: attempt.payableLabel, app: profile?.ownerApp ?? '' },
    }),
  }).catch(() => 0);
}

const autoRefundPayload = z.object({ attemptId: z.string().min(1).max(64) }).strict();

export function registerAutoRefundHandler(registry: JobRegistry, deps: RefundDeps): void {
  registry.registerJobHandler(PAYMENTS_AUTO_REFUND_JOB, autoRefundPayload, async (payload) => ({ outcome: await giveAutoRefund(deps, payload.attemptId) }), { internal: true });
}
