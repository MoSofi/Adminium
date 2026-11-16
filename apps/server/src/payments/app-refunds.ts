// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REFUNDS AN APP KEEPS AS ROWS OF ITS OWN (E4, the rows model).
 *
 * Tickets, Ordering, Hotel and the till keep a refund as a row of their own
 * refund table. Their staff write that row as they always did; a row that
 * sends money back (the mapping's `when`, such as `method eq online`) was
 * already held to the refund right before it committed (`crud/payment-rows.ts`).
 * After the commit, Adminium sends the money back FOR THAT ROW:
 *
 *  1. The row is read again: its payment row (the mapping's `payment` link)
 *     names the payment taken online by its reference (the attempt id), and
 *     its amount is read once, now, in the payment's own decimals. That amount
 *     is what is asked, and it is frozen in Adminium's own refund: a later
 *     change to the row is never sent again.
 *  2. The refund is asked under one key per row (`app:<hash>`), so a retry,
 *     a second worker or the sweep below never asks twice.
 *  3. Adminium stamps the row with what it alone writes: the provider's
 *     refund reference and where the refund stands (`asked`, `pending`, `done`,
 *     `not-sent`). It never writes an amount into the app's formulas: the
 *     app's own rollups count a row by its stamp.
 *
 * A refund that cannot be asked (the payment was not taken online, more than
 * is left, disputed) is stamped `not-sent` and kept in Adminium as a failed
 * refund with the reason, so Activity shows it to a person. A refund that
 * fails later (a closed card) is stamped again by the refund's own moves.
 *
 * Every row is reached by a job (`payments.app-refund`), queued when the row
 * is written and by a sweep every five minutes for a row nothing queued (a
 * write that crashed between its commit and its queue).
 */
import { currencyScale } from '@adminium/manifest';
import { appRefundKeyOf, payableProfilesRepo, paymentAttemptsRepo, refundsRepo, type AppRefundRow, type MetaDb, type PayableMapping, type RefundRow, type RefundRowsMapping } from '@adminium/meta';
import { sql } from 'kysely';
import { z } from 'zod';

import { afterRecordWrite, type RecordWriteEvent } from '../crud/after-record-write.js';
import { pkLabel } from '../crud/records.js';
import { createWriteService } from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import type { JobRegistry } from '../jobs/registry.js';
import { HAND_REFERENCE_PREFIX } from '../crud/write-service.js';
import { conditionHolds, exactAmount, fromMinorUnits, pkOfRowKey, rowKeyOf } from './payables.js';
import { PAYMENTS_APP_REFUND_JOB, enqueueAppRefund } from './app-refund-queue.js';
import { requestRefund, type RefundDeps } from './refunds.js';

export { PAYMENTS_APP_REFUND_JOB, enqueueAppRefund } from './app-refund-queue.js';

/** Where a refund row stands, as Adminium stamps it. */
export type AppRefundStamp = 'asked' | 'pending' | 'done' | 'not-sent';

/** The stamp of a refund's state: asked of the provider, on its way, done, or not sent (failed, cancelled, refused). */
export function stampOf(refund: Pick<RefundRow, 'state'>): AppRefundStamp {
  switch (refund.state) {
    case 'requested':
      return 'asked';
    case 'pending':
    case 'requires_action':
      return 'pending';
    case 'succeeded':
      return 'done';
    default:
      return 'not-sent';
  }
}

/** The refund table's mapping, with its payable's payments table: the profile that keeps refunds as rows of this table. */
export async function refundTableOf(
  meta: MetaDb,
  connectionId: string,
  tableId: string,
): Promise<{ rows: RefundRowsMapping; payments: Extract<PayableMapping['payments'], { kind: 'table' }> } | null> {
  for (const profile of await payableProfilesRepo(meta).list(connectionId)) {
    const refunds = profile.mapping?.refunds;
    const payments = profile.mapping?.payments;
    if (refunds?.model === 'rows' && refunds.table === tableId && payments?.kind === 'table') return { rows: refunds, payments };
  }
  return null;
}

/**
 * Stamps a refund row with what Adminium alone writes. A row since deleted is
 * left alone. A stamp that changed the row is announced as the paid move is:
 * the audit row, the app's rules and its mail (a "Refund sent" mail on the
 * stamp turning `done`), each once — the outbox's own log keeps a mail to one
 * however often the stamp is written again.
 */
async function stamp(deps: RefundDeps, rows: RefundRowsMapping, row: AppRefundRow, providerRef: string | null, state: AppRefundStamp): Promise<void> {
  const found = await deps.sources.table(row.connectionId, row.table);
  if (found === null) return;
  const pk = pkOfRowKey(found.table, row.rowKey);
  if (pk === null) return;
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  const actor = { kind: 'system' as const, id: null, label: 'Refund' };
  // The row as it stood, for what the stamp changed: the write itself reads none when no hook asks.
  const was = deps.app === undefined ? null : await deps.sources.readRow(row.connectionId, row.table, row.rowKey);
  await writes.update({
    target: found.target,
    pk,
    values: { [rows.providerRef]: providerRef, [rows.state]: state },
    context: { origin: 'payment', hops: 0, actor, request: null },
    skipIfNone: true,
    announce: async (outcome) => {
      if (deps.app === undefined || outcome.count === 0 || outcome.after === null || outcome.after === undefined) return;
      const before = outcome.before ?? was;
      // Written again as it stood: nothing changed, nothing to say.
      if (before !== null && before[rows.state] === outcome.after[rows.state] && before[rows.providerRef] === outcome.after[rows.providerRef]) return;
      await afterRecordWrite(deps.app, {
        request: null,
        actor,
        meta: deps.meta,
        connectionId: found.target.connectionId,
        table: found.table,
        action: 'update',
        entity: { connectionId: found.target.connectionId, table: found.table.id, pk, label: pkLabel(found.table, pk) },
        before,
        after: outcome.after,
        origin: 'payment',
      });
    },
  });
}

export type AppRefundOutcome = 'asked' | 'not-sent' | 'stamped' | 'skipped';

/**
 * Asks the money back for one refund row of an app, and stamps the row. Run
 * again, it asks nothing new: it stamps the row with where its refund stands.
 */
export async function askAppRefund(deps: RefundDeps, row: AppRefundRow, requestedBy: string | null = null, source: 'app' | 'auto' = 'app'): Promise<AppRefundOutcome> {
  const mapping = await refundTableOf(deps.meta, row.connectionId, row.table);
  if (mapping === null) return 'skipped';
  const { rows, payments } = mapping;
  const refunds = refundsRepo(deps.meta);
  // Asked before (this job again, the sweep, a second worker): the row says where it stands.
  const known = await refunds.forAppRow(row);
  if (known !== null) {
    await stamp(deps, rows, row, known.providerRefundId, stampOf(known));
    return 'stamped';
  }
  const refund = await deps.sources.readRow(row.connectionId, row.table, row.rowKey);
  if (refund === null || !rows.when.every((condition) => conditionHolds(condition, refund))) return 'skipped';

  // The payment it refunds: taken online, by the attempt its reference names.
  const paymentKey = refund[rows.payment];
  const payment = paymentKey === null || paymentKey === undefined ? null : await deps.sources.readRow(row.connectionId, payments.table, String(paymentKey));
  const reference = payment?.[payments.reference];
  const attempt = typeof reference === 'string' && reference !== '' && !reference.startsWith(HAND_REFERENCE_PREFIX) ? await paymentAttemptsRepo(deps.meta).byId(reference) : null;
  const refuse = async (message: string): Promise<AppRefundOutcome> => {
    await keepRefused(deps, row, attempt, refund[rows.amount], message, requestedBy, source);
    await stamp(deps, rows, row, null, 'not-sent');
    return 'not-sent';
  };
  if (attempt === null || attempt.paymentRef === null) return refuse('The payment this refund names was not taken online, so nothing can be sent back online.');

  // The amount, once, in the payment's own decimals.
  const currency = attempt.takenCurrency ?? attempt.currency;
  const scale = currencyScale(currency);
  const raw = refund[rows.amount];
  const amount = payments.amountUnit === 'minor' && (typeof raw === 'number' || typeof raw === 'string') ? fromMinorUnits(Number(raw), scale) : exactAmount(raw, scale);
  if (amount === null) return refuse('The refund row holds no amount that can be sent.');

  const answer = await requestRefund(deps, { attemptId: attempt.id, amount, reason: 'requested_by_customer', note: null, key: appRefundKeyOf(row), requestedBy, source, appRow: row });
  if (!answer.ok) return refuse(answer.refusal.message);
  await stamp(deps, rows, row, answer.refund.providerRefundId, stampOf(answer.refund));
  return 'asked';
}

/** A refund that could not be asked, kept as a failed refund with the reason, so Activity shows it to a person. */
async function keepRefused(deps: RefundDeps, row: AppRefundRow, attempt: Awaited<ReturnType<ReturnType<typeof paymentAttemptsRepo>['byId']>>, raw: unknown, message: string, requestedBy: string | null, source: 'app' | 'auto'): Promise<void> {
  const currency = attempt === null ? 'XXX' : (attempt.takenCurrency ?? attempt.currency);
  const amount = attempt === null ? '0' : (exactAmount(raw, currencyScale(currency)) ?? '0');
  await refundsRepo(deps.meta).create(
    {
      attemptId: attempt?.id ?? null,
      paymentId: null,
      provider: attempt?.provider ?? 'none',
      mode: attempt?.mode ?? 'live',
      paymentRef: attempt?.paymentRef ?? 'none',
      amount,
      currency,
      reason: 'requested_by_customer',
      note: null,
      idempotencyKey: appRefundKeyOf(row),
      source,
      requestedBy,
      state: 'failed',
      failureMessage: message.slice(0, 2000),
      appRow: row,
    },
    (deps.now ?? Date.now)(),
  );
}

/**
 * Hears a write to an app's refund table: a row that sends money back is
 * queued to be asked. Never throws: the sweep picks up what it misses.
 */
export function createAppRefundWatch(deps: { meta: MetaDb; enqueue: NonNullable<RefundDeps['enqueue']>; warn?: (fields: Record<string, unknown>, message: string) => void }) {
  return {
    async onRecordEvent(event: RecordWriteEvent): Promise<void> {
      if (event.action === 'delete' || event.after === null) return;
      // Adminium's own writes of the row (its stamps, an automatic refund's row) are asked by the one that wrote them.
      if (event.origin === 'payment') return;
      try {
        const mapping = await refundTableOf(deps.meta, event.connectionId, event.table.id);
        if (mapping === null || !mapping.rows.when.every((condition) => conditionHolds(condition, event.after!))) return;
        await enqueueAppRefund(deps, { connectionId: event.connectionId, table: event.table.id, rowKey: rowKeyOf(event.table, event.after) });
      } catch (error) {
        deps.warn?.({ err: error, table: event.table.id }, 'payments: a refund row could not be queued');
      }
    },
  };
}

/**
 * The sweep: refund rows that send money back and carry no stamp yet (the
 * write committed, and its queue never ran). How many it queued.
 */
export async function pickUpAppRefunds(deps: RefundDeps, limit = 100): Promise<number> {
  let queued = 0;
  const seen = new Set<string>();
  for (const profile of await payableProfilesRepo(deps.meta).list()) {
    const rows = profile.mapping?.refunds;
    const connectionId = profile.connectionId;
    if (rows?.model !== 'rows' || seen.has(`${connectionId}\u0000${rows.table}`)) continue;
    seen.add(`${connectionId}\u0000${rows.table}`);
    const found = await deps.sources.table(connectionId, rows.table);
    if (found === null || !found.table.columns.has(rows.state)) continue;
    const unstamped = (await found.target.db
      .selectFrom(found.table.id as never)
      .selectAll()
      .where(sql.ref(rows.state), 'is', null)
      .limit(limit)
      .execute()) as Record<string, unknown>[];
    for (const one of unstamped) {
      if (!rows.when.every((condition) => conditionHolds(condition, one))) continue;
      await enqueueAppRefund(deps, { connectionId, table: found.table.id, rowKey: rowKeyOf(found.table, one) });
      queued += 1;
    }
  }
  return queued;
}

const appRefundPayload = z.object({ connectionId: z.string().min(1).max(64), table: z.string().min(1).max(255), rowKey: z.string().min(1).max(512) }).strict();

export function registerAppRefundHandler(registry: JobRegistry, deps: RefundDeps): void {
  registry.registerJobHandler(PAYMENTS_APP_REFUND_JOB, appRefundPayload, async (payload) => ({ outcome: await askAppRefund(deps, payload) }), { internal: true });
}
