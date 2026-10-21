// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's Payment panel: how a payable record stands, and
 * recording a payment by hand.
 *
 *   POST /payments/panel           one record: what is due, what was paid, what waits, what may be done
 *   POST /payments/record-payment  a payment taken by hand (bank transfer, cash, a card on the shop's
 *                                  own terminal, a cheque) written into the record's payments
 *
 * ─── WHO SEES WHAT ─────────────────────────────────────────────────────────
 *
 * The panel is for whoever reads the record: a row their own row limits hide
 * answers as one that is not there. Recording a payment and making a pay link
 * are for whoever may change the record (the gate of its state actions); a
 * reader sees the panel with no actions. A table nobody marked payable, and
 * that is not built on the invoice shape, has no panel at all (`data: null`).
 *
 * ─── ONE WRITE PATH ────────────────────────────────────────────────────────
 *
 * A payment recorded by hand goes through the record job's own write
 * (`writePaymentRow`, a `payment` write), as the person who recorded it, or is
 * kept by Adminium for a payable whose payments Adminium keeps. The amount
 * may not pass what is due, and no text of it may hold a full card number.
 *
 * The dialog sends a key it made when it opened; a second press with the
 * same key (a retry after a lost answer) records nothing new.
 */
import { compareAmounts, sameAmount, subtractAmounts } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { createHash } from 'node:crypto';

import { isDuplicateKeyError, keptPaymentsRepo, payableKeyOf, paymentAttemptsRepo, refundsRepo, type KeptPayment, type MetaDb, type PayableRef, type PaymentAttempt } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt, audited } from '../../audit/coverage.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { isUniqueViolation } from '../../crud/decided-columns.js';
import type { Row } from '../../crud/mask.js';
import { fetchVisible } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import type { RecordWriteService } from '../../crud/write-service.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { holdsCardNumber } from '../../payments/card-number.js';
import { payAddress, payReachable } from '../../payments/links.js';
import { exactAmount, fromMinorUnits, pkOfRowKey, resolvePayable, rowKeyOf, type PayableSources, type ResolvedPayable } from '../../payments/payables.js';
import { recordedByOf, setPaidStatus, writePaymentRow, type PaymentActor } from '../../payments/record.js';
import { refundableOf, refundRefusalOf } from '../../payments/refunds.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { createPublicViews } from '../../public-api/runtime.js';
import type { PermissionSet } from '../../rbac/resolver.js';
import { refundView, refundViewOf } from './refunds.js';

export interface PaymentPanelDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  sources: PayableSources;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  /** The write service the record job uses (its stores and hooks). */
  writes?: RecordWriteService;
}

/** The ways a payment is recorded by hand: the invoice shape's own words for them. */
export const HAND_WAYS = ['bank-transfer', 'cash', 'card', 'cheque', 'other'] as const;
export type HandWay = (typeof HAND_WAYS)[number];

const recordQuery = z.object({
  connectionId: z.string().min(1).max(64),
  table: z.string().min(1).max(255),
  recordId: z.string().min(1).max(512),
});

const recordBody = recordQuery.extend({
  amount: z.string().trim().min(1).max(32),
  way: z.enum(HAND_WAYS),
  /** The day it was paid, `YYYY-MM-DD`. */
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).nullable(),
  approvalCode: z.string().trim().max(32).nullable(),
  last4: z.string().trim().max(32).nullable(),
  /** Made by the dialog when it opened; the same key twice records once. */
  // `hand_<key>` is written to a 64-character reference column: 59 at most.
  key: z.string().regex(/^[A-Za-z0-9_-]{16,59}$/),
});

const refusalView = z.object({ code: z.string(), message: z.string() });
const paymentView = z.object({
  id: z.string(),
  number: z.string().nullable(),
  amount: z.string(),
  currency: z.string(),
  /** What was refunded of it so far. */
  refunded: z.string(),
  way: z.string(),
  /** The provider's or the person's label for the way ("Visa ••4242", "SEPA Direct Debit"). */
  wayLabel: z.string().nullable(),
  /** The service that took it, online; null when it was recorded by hand. */
  provider: z.string().nullable(),
  test: z.boolean(),
  paidOn: z.string(),
  recordedBy: z.string().nullable(),
  cardLast4: z.string().nullable(),
  /** The online payment behind it (what a refund is asked against); null when recorded by hand. */
  attemptId: z.string().nullable(),
  /** What may still be refunded online, and why not when nothing may. */
  refundable: z.string(),
  refundRefusal: refusalView.nullable(),
  /** Its refunds, oldest first: asked here or made in the provider's dashboard. */
  refunds: z.array(refundView),
  /** A dispute the provider told of. Its deadline, amount and outcome are read in the provider's dashboard. */
  dispute: z.object({ state: z.enum(['open', 'closed']), at: z.number(), closedAt: z.number().nullable() }).nullable(),
});
const waitingView = z.object({ id: z.string(), provider: z.string(), wayLabel: z.string().nullable(), startedAt: z.number(), test: z.boolean() });
const panelView = z.object({
  payable: z.object({ kind: z.enum(['shape', 'profile']), connectionId: z.string(), tableName: z.string(), rowKey: z.string() }),
  label: z.string(),
  currency: z.string(),
  total: z.string(),
  due: z.string(),
  /** Paid so far, net of refunds; never more than the total. */
  paid: z.string(),
  refusal: refusalView.nullable(),
  /** Customers can open pay links here (and why not, when they cannot). */
  links: z.object({ on: z.boolean(), reason: z.string().nullable() }),
  /** May make and revoke pay links and record payments: the record's update grant. */
  mayChange: z.boolean(),
  /** A payment can be recorded by hand now. */
  mayRecord: z.boolean(),
  /** May refund online payments: a signed-in person holding the refund permission. */
  mayRefund: z.boolean(),
  waiting: z.array(waitingView),
  payments: z.array(paymentView),
});
const panelReply = z.object({ data: panelView.nullable() });
const recordReply = z.object({ data: z.object({ key: z.string(), already: z.boolean(), due: z.string() }) });

type PanelView = z.infer<typeof panelView>;
type PaymentView = z.infer<typeof paymentView>;

/**
 * How long a key is remembered in this process, for a table whose payments
 * carry no unique reference (an `@1` invoice table). A payment kept by
 * Adminium carries its key in a unique column, so a retry there is caught by
 * the database in every process and for good.
 */
const KEY_MEMORY_MS = 15 * 60_000;

function personOf(request: FastifyRequest): { id: string; label: string } {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('A payment is recorded by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  const user = (request as unknown as { user?: { id?: string; name?: string | null; email?: string | null } }).user;
  if (user?.id === undefined) throw new UnauthorizedError();
  return { id: user.id, label: user.name?.trim() || user.email || 'someone' };
}

function positive(amount: string): boolean {
  return compareAmounts(amount, '0') === 1;
}

function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** The online fields of a payment: none for one recorded by hand. */
const BY_HAND = { attemptId: null, refundable: '0', refundRefusal: null, refunds: [], dispute: null } as const;

function keptView(row: KeptPayment): Omit<PaymentView, keyof typeof BY_HAND> & { attemptId: string | null } {
  return {
    id: `kept:${row.id}`,
    number: row.number,
    amount: row.amount,
    currency: row.currency,
    refunded: row.refundedAmount,
    way: row.method,
    wayLabel: row.methodNote,
    provider: row.provider,
    test: row.mode === 'test',
    paidOn: new Date(row.paidOn).toISOString().slice(0, 10),
    recordedBy: row.recordedByUser !== null ? row.recordedBy : row.provider === null ? row.recordedBy : recordedByOf(row.provider),
    cardLast4: row.cardLast4,
    attemptId: row.attemptId,
  };
}

export function paymentPanelRoutes(deps: PaymentPanelDeps): FastifyPluginAsyncZod {
  const { meta, sources } = deps;
  const views = createPublicViews(meta);
  const recentKeys = new Map<string, { at: number; due: string }>();

  /**
   * The record as this person reaches it: refuses a table they may not read,
   * and answers a row their row limits hide as one that is not there.
   */
  async function reach(request: FastifyRequest, input: z.infer<typeof recordQuery>, action: 'read' | 'update') {
    const found = await sources.table(input.connectionId, input.table);
    if (found === null) throw new NotFoundError('No such table.');
    const table = found.table;
    if (!(await request.can(`table:${input.connectionId}:${table.id}:read`))) throw new ForbiddenError('You may not read this record.', 'TABLE_FORBIDDEN');
    if (action === 'update' && !(await request.can(`table:${input.connectionId}:${table.id}:update`))) {
      throw new ForbiddenError('You may not record a payment on this record.', 'TABLE_FORBIDDEN');
    }
    const pk = table.primaryKey.length === 1 ? pkOfRowKey(table, input.recordId) : null;
    if (pk === null) throw new NotFoundError('No such record.');
    // When the row limits cannot be worked out, nothing is shown: never a row read past them.
    const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
    const view = await views.viewFor(input.connectionId);
    if (set === undefined || view === null || !view.model.tables.some((one) => one.id === table.id)) {
      throw new ForbiddenError('You may not read this record.', 'TABLE_FORBIDDEN');
    }
    const context = await rowLimitContextOf(meta, set, input.connectionId, view.model);
    const row =
      context === null
        ? await found.target.db.selectFrom(table.id).selectAll().where((eb) => eb.and(Object.entries(pk).map(([column, value]) => eb(found.target.db.dynamic.ref(column), '=', value)))).executeTakeFirst()
        : await fetchVisible(context, found.target.db, table, pk, action);
    if (row === undefined) throw new NotFoundError('No such record.');
    // The row's own spelling of its key ("7", not "007"; "INV-1", not "inv-1" on a case-blind database),
    // so the payable is counted under the one key links and kept payments use.
    return { found, rowKey: rowKeyOf(table, row as Row) };
  }

  /** Which kind of payable the table is, or null when it is none. */
  async function kindOf(connectionId: string, tableId: string): Promise<'shape' | 'profile' | null> {
    if ((await sources.shapeOf(connectionId, tableId)) !== null) return 'shape';
    const profile = await sources.profile(connectionId, tableId);
    return profile !== null && profile.enabled && profile.mapping !== null ? 'profile' : null;
  }

  async function linksOn(request: FastifyRequest): Promise<{ on: boolean; reason: string | null }> {
    const forwarded = request.headers['x-forwarded-for'] !== undefined || request.headers['forwarded'] !== undefined;
    const answer = await payReachable(meta, { networkFeatures: deps.networkFeatures, desktop: deps.desktop, trustProxy: deps.trustProxy, forwarded });
    if (answer.state === 'reachable' && (await payAddress(meta)) !== null) return { on: true, reason: null };
    return { on: false, reason: answer.state };
  }

  /** The payments in the record's own payments table (live, online and by hand). */
  async function tablePayments(request: FastifyRequest, payable: ResolvedPayable): Promise<(Omit<PaymentView, keyof typeof BY_HAND> & { attemptId: string | null })[]> {
    const into = payable.recordInto;
    if (into.kind !== 'table' || payable.ref.connectionId === null) return [];
    const found = await sources.table(payable.ref.connectionId, into.tableName);
    if (found === null) return [];
    // The payments table's rows are shown only to someone who may read that table too.
    if (!(await request.can(`table:${payable.ref.connectionId}:${found.table.id}:read`))) return [];
    const has = (column: string | null): column is string => column !== null && found.table.columns.has(column);
    const rows = (await found.target.db
      .selectFrom(found.table.id)
      .selectAll()
      .where((eb) => eb(eb.ref(into.link as never), '=', into.linkValue as never))
      .limit(200)
      .execute()) as Row[];
    const scale = currencyScale(payable.currency);
    const out: (Omit<PaymentView, keyof typeof BY_HAND> & { attemptId: string | null })[] = [];
    for (const row of rows) {
      if (into.shapeColumns && (row['voided'] === true || row['voided'] === 1 || row['voided'] === '1')) continue;
      const raw = row[into.amount];
      const amount = into.amountUnit === 'minor' ? fromMinorUnits(raw, scale) : exactAmount(raw, scale);
      if (amount === null) continue;
      const rawRefunded = has(into.refunded) ? (row[into.refunded] ?? 0) : 0;
      const refunded = (into.amountUnit === 'minor' ? fromMinorUnits(rawRefunded, scale) : exactAmount(rawRefunded, scale)) ?? '0';
      const provider = into.shapeColumns ? textOf(row['provider']) : null;
      out.push({
        id: `row:${String(row[found.table.primaryKey[0] ?? 'id'])}`,
        number: into.shapeColumns ? textOf(row['number']) : null,
        amount,
        currency: (into.shapeColumns ? textOf(row['currency']) : null) ?? payable.currency,
        refunded,
        way: into.method === null ? 'other' : (textOf(row[into.method.column]) ?? 'other'),
        wayLabel: into.note === null ? null : textOf(row[into.note]),
        provider,
        test: false,
        paidOn: (into.date === null ? null : textOf(row[into.date])) ?? '',
        recordedBy: into.shapeColumns ? textOf(row['recorded_by']) : null,
        cardLast4: into.shapeColumns ? textOf(row['card_last4']) : null,
        attemptId: into.reference === null ? null : textOf(row[into.reference]),
      });
    }
    return out.sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0));
  }

  /** Each online payment with what may still be refunded, its refunds and any dispute. */
  async function withRefunds(attempts: PaymentAttempt[], rows: (Omit<PaymentView, keyof typeof BY_HAND> & { attemptId: string | null })[]): Promise<PaymentView[]> {
    const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));
    const out: PaymentView[] = [];
    for (const row of rows) {
      // A reference that is not one of this record's attempts was written by someone else: shown as by hand.
      const attempt = row.attemptId === null ? undefined : byId.get(row.attemptId);
      if (attempt === undefined) {
        out.push({ ...row, ...BY_HAND, refunds: [] });
        continue;
      }
      out.push({
        ...row,
        attemptId: attempt.id,
        refundable: refundableOf(attempt),
        refundRefusal: refundRefusalOf(attempt),
        refunds: (await refundsRepo(meta).forAttempt(attempt.id)).map(refundViewOf),
        dispute: attempt.dispute,
      });
    }
    return out;
  }

  async function panelOf(request: FastifyRequest, input: z.infer<typeof recordQuery>): Promise<PanelView | null> {
    // Most record pages are of tables that take no payments: answered from meta alone, before any row is read.
    const table = await sources.table(input.connectionId, input.table);
    if (table === null || (await kindOf(input.connectionId, table.table.id)) === null) return null;
    const { found, rowKey } = await reach(request, input, 'read');
    const kind = await kindOf(input.connectionId, found.table.id);
    if (kind === null) return null;
    const ref: PayableRef = { kind, connectionId: input.connectionId, tableName: found.table.id, rowKey };
    const payable = await resolvePayable(sources, ref);
    if (payable === null) return null;
    const mayChange = await request.can(`table:${input.connectionId}:${found.table.id}:update`);
    const scale = payable.currency === '' ? 2 : currencyScale(payable.currency);
    const paid = subtractAmounts(payable.total, payable.due, scale) ?? '0';
    const attempts = await paymentAttemptsRepo(meta).forPayable(ref);
    const kept = (await keptPaymentsRepo(meta).forPayable(ref)).filter((row) => !row.voided);
    const payments = await withRefunds(attempts, [...(await tablePayments(request, payable)), ...kept.map(keptView)]);
    const mayRefund = request.apiKeyPrincipal == null && (await request.can(PERMISSIONS.paymentsRefund));
    const handOk = payable.refusal === null || payable.refusal.code === 'NEEDS_UPDATE';
    return {
      payable: { kind, connectionId: input.connectionId, tableName: found.table.id, rowKey },
      label: payable.label,
      currency: payable.currency,
      total: payable.total,
      due: payable.due,
      paid: compareAmounts(paid, '0') === -1 ? '0' : paid,
      refusal: payable.refusal,
      links: await linksOn(request),
      mayChange,
      mayRecord: mayChange && handOk && payable.currency !== '' && positive(payable.due),
      mayRefund,
      waiting: attempts
        .filter((attempt) => attempt.state === 'processing')
        .map((attempt) => ({ id: attempt.id, provider: attempt.provider, wayLabel: (attempt.paidWith as { label?: string } | null)?.label ?? null, startedAt: attempt.createdAt, test: attempt.mode === 'test' })),
      payments,
    };
  }

  /** A key's claim: a counters row in a day-long window that only one insert can make. */
  function claimOf(memoryKey: string, now: number): { bucket: string; windowStart: number } {
    return { bucket: `hand-key:${createHash('sha256').update(memoryKey).digest('hex')}`, windowStart: Math.floor(now / 86_400_000) * 86_400_000 };
  }

  async function claimed(claim: { bucket: string; windowStart: number }): Promise<boolean> {
    const row = await meta.db.selectFrom('adminium_payment_counters').select('hits').where('bucket', '=', claim.bucket).where('windowStart', '=', claim.windowStart).executeTakeFirst();
    return row !== undefined;
  }

  async function takeClaim(claim: { bucket: string; windowStart: number }): Promise<boolean> {
    try {
      await meta.db.insertInto('adminium_payment_counters').values({ ...claim, hits: 1 }).execute();
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  async function dropClaim(claim: { bucket: string; windowStart: number }): Promise<void> {
    await meta.db.deleteFrom('adminium_payment_counters').where('bucket', '=', claim.bucket).where('windowStart', '=', claim.windowStart).execute();
  }

  /** Whether the payments table already holds a row with this reference. */
  async function referenceWritten(connectionId: string, tableName: string, column: string | null, value: string): Promise<boolean> {
    if (column === null) return false;
    const found = await sources.table(connectionId, tableName);
    if (found === null || !found.table.columns.has(column)) return false;
    const row = await found.target.db.selectFrom(found.table.id).selectAll().where(found.target.db.dynamic.ref(column), '=', value).limit(1).executeTakeFirst();
    return row !== undefined;
  }

  function forget(now: number): void {
    for (const [key, entry] of recentKeys) if (now - entry.at > KEY_MEMORY_MS) recentKeys.delete(key);
  }

  return async (app) => {
    app.post(
      '/payments/panel',
      { config: { audit: auditExempt('reading how a record stands changes nothing') }, schema: { body: recordQuery, response: { 200: panelReply } } },
      async (request) => ({ data: await panelOf(request, request.body) }),
    );

    app.post(
      '/payments/record-payment',
      { config: { audit: audited('rbac') }, schema: { body: recordBody, response: { 200: recordReply } } },
      async (request) => {
        const person = personOf(request);
        const body = request.body;
        const { found, rowKey } = await reach(request, body, 'update');
        const kind = await kindOf(body.connectionId, found.table.id);
        if (kind === null) throw new NotFoundError('This record takes no payments.');
        const ref: PayableRef = { kind, connectionId: body.connectionId, tableName: found.table.id, rowKey };
        const payable = await resolvePayable(sources, ref);
        if (payable === null) throw new NotFoundError('No such record.');

        const now = app.rbac.now();
        forget(now);
        // A key belongs to one person and one record: the same key elsewhere is a different payment.
        const memoryKey = `${person.id}:${payableKeyOf(ref)}:${body.key}`;
        const remembered = recentKeys.get(memoryKey);
        if (remembered !== undefined) return { data: { key: body.key, already: true, due: remembered.due } };
        // Claimed already, by this process or another: the same payment, answered as it stands now.
        const claim = claimOf(memoryKey, now);
        if (await claimed(claim)) return { data: { key: body.key, already: true, due: sameAmount(payable.due, '0') ? '0' : payable.due } };

        if (payable.refusal !== null && payable.refusal.code !== 'NEEDS_UPDATE') {
          throw new ValidationFailedError(payable.refusal.message, { reason: payable.refusal.code });
        }
        const scale = currencyScale(payable.currency);
        const amount = exactAmount(body.amount, scale);
        if (amount === null || !positive(amount)) throw new ValidationFailedError('Enter an amount above zero.', { field: 'amount', reason: 'AMOUNT' });
        if (compareAmounts(amount, payable.due) === 1) {
          throw new ValidationFailedError(`More than the ${payable.due} ${payable.currency} that is due.`, { field: 'amount', reason: 'BALANCE_EXCEEDED', due: payable.due });
        }
        const terminal = body.way === 'card';
        if (terminal) {
          if (body.approvalCode === null || !/^[A-Za-z0-9]{1,12}$/.test(body.approvalCode)) {
            throw new ValidationFailedError('Use letters and digits only, up to 12.', { field: 'approvalCode', reason: 'APPROVAL_CODE' });
          }
          if (body.last4 === null || !/^\d{4}$/.test(body.last4)) throw new ValidationFailedError('Enter the last four digits only.', { field: 'last4', reason: 'LAST_FOUR' });
        } else if ((body.approvalCode ?? '') !== '' || (body.last4 ?? '') !== '') {
          throw new ValidationFailedError('An approval code and the last four digits belong to a card payment only.', { field: 'way', reason: 'NOT_A_CARD' });
        }
        for (const [field, text] of [['note', body.note], ['approvalCode', body.approvalCode]] as const) {
          if (holdsCardNumber(text)) throw new ValidationFailedError('This looks like a full card number. Never write card numbers here.', { field, reason: 'CARD_NUMBER' });
        }
        const paidAt = Date.parse(`${body.paidOn}T12:00:00Z`);
        if (Number.isNaN(paidAt) || paidAt > now + 36 * 3600_000) throw new ValidationFailedError('The day it was paid cannot be in the future.', { field: 'paidOn', reason: 'DATE' });

        const actor: PaymentActor = { kind: 'user', id: person.id, label: person.label };
        const note = body.note === null || body.note === '' ? null : body.note;
        const recordDeps = { meta, sources, app: app as unknown as FastifyInstance, ...(deps.writes === undefined ? {} : { writes: deps.writes }) };
        let already = false;
        // One insert only one request can win, in every process: the key's claim, made before the write.
        if (!(await takeClaim(claim))) return { data: { key: body.key, already: true, due: sameAmount(payable.due, '0') ? '0' : payable.due } };
        try {
          if (payable.recordInto.kind === 'table') {
            const into = payable.recordInto;
            try {
              const written = await writePaymentRow(recordDeps, payable, {
                ref,
                amount,
                currency: payable.currency,
                method: body.way,
                manual: true,
                note,
                reference: `hand_${body.key}`,
                paidAt,
                provider: null,
                approvalCode: terminal ? body.approvalCode : null,
                cardLast4: terminal ? body.last4 : null,
                actor,
                request,
              });
              if (written === 'refused') throw new ValidationFailedError("The payment cannot be written into this record's payments.", { reason: 'NOT_PAYABLE' });
            } catch (error) {
              // The same key already wrote its row (a retry after a lost answer) — and only then: another
              // unique column colliding is a refusal, never "already on file".
              if (!isUniqueViolation(error) || !(await referenceWritten(ref.connectionId!, into.tableName, into.reference, `hand_${body.key}`))) throw error;
              already = true;
            }
          } else {
            const kept = await keptPaymentsRepo(meta).insert(
              {
                payable: ref,
                // Unique across every record, so scoped to this person and record: a hash of the three.
              requestKey: createHash('sha256').update(memoryKey).digest('hex'),
                number: null,
                amount,
                currency: payable.currency,
                method: body.way,
                methodNote: null,
                provider: null,
                mode: 'live',
                attemptId: null,
                approvalCode: terminal ? body.approvalCode : null,
                cardLast4: terminal ? body.last4 : null,
                note,
                paidOn: paidAt,
                recordedBy: person.label,
                recordedByUser: person.id,
              },
              now,
            );
            // The same key already kept its payment: a retry after a lost answer, here or in another process.
            if (kept === null) already = true;
          }
        } catch (error) {
          // Nothing was written: the key may be tried again.
          await dropClaim(claim);
          throw error;
        }
        if (!already) await setPaidStatus(recordDeps, ref, payable, actor, request);
        const after = await resolvePayable(sources, ref);
        const due = after?.due ?? payable.due;
        recentKeys.set(memoryKey, { at: now, due });
        if (!already) {
          await app.rbac.audit(request, {
            category: 'payments',
            action: 'payments.payment.recorded',
            changes: { after: { kind, connectionId: body.connectionId, tableName: found.table.id, rowKey, amount, currency: payable.currency, way: body.way, paidOn: body.paidOn } },
          });
        }
        return { data: { key: body.key, already, due: sameAmount(due, '0') ? '0' : due } };
      },
    );
  };
}
