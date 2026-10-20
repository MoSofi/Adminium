// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The payments repos (migration 0061, plan 70): attempts, events, the payments
 * Adminium keeps itself, and refunds — the rows money depends on.
 *
 * ─── Every move is a compare-and-set ───────────────────────────────────────
 *
 * An attempt or a refund changes state only through `move`, which allows the
 * moves the tables below list and nothing else, and does it as
 * `UPDATE … WHERE id = ? AND state IN (<from>)`, then checks the affected
 * count. Two runners that race (a webhook and the sweep, a job delivered
 * twice) cannot both win: the second finds the state already moved and gets
 * `false`. The state column always changes in the SET, which matters on MySQL,
 * where an UPDATE that changes nothing reports zero rows.
 *
 * ─── One open attempt per payable ──────────────────────────────────────────
 *
 * `open_key` is set while an attempt is creating, open or processing, and the
 * move out of those states sets it to NULL in the same statement. Its unique
 * index is the rule; `create` reads a duplicate as "an attempt is already
 * open" and returns null, never checks first.
 *
 * ─── Exactly once, across two databases ────────────────────────────────────
 *
 * A payment Adminium keeps itself carries its attempt id under a unique
 * index, so recording is insert-first: `kept.insert` returns null when the
 * attempt is already recorded, and the caller reads that row instead.
 *
 * Money is decimal TEXT throughout (0061's header says why); sums are made
 * here in exact decimal arithmetic, never by the database.
 */

import type { Insertable, Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  AdminiumPaymentAttemptsTable,
  AdminiumPaymentEventsTable,
  AdminiumPaymentsTable,
  AdminiumRefundsTable,
} from '../schema/tables.js';
import { affected, DAY_MS, isDuplicateKeyError, packJson, readBool, readJsonOrNull, writeBool } from './util.js';

// ─── States ─────────────────────────────────────────────────────────────────

export const ATTEMPT_STATES = [
  'creating',
  'open',
  'processing',
  'succeeded',
  'failed',
  'expired',
  'cancelled',
  'abandoned',
  'recording',
  'recorded',
  'record_refused',
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

/** The states in which an attempt holds its payable's one open slot. */
export const OPEN_ATTEMPT_STATES: readonly AttemptState[] = ['creating', 'open', 'processing'];

/**
 * Every move an attempt may make, by target: the states it may come FROM.
 *
 * - `creating → open` once the provider answered with a ref and URL;
 *   `→ failed` when the provider refused to make the checkout;
 *   `→ abandoned` when it is old and has no ref (nobody holds its URL).
 * - `open | processing → succeeded | failed | expired | cancelled` as the
 *   provider's own status says (never a webhook body).
 * - `succeeded → recording` when the record job claims it; `recording →
 *   recorded | record_refused`.
 * - `record_refused → recorded` when a person records it elsewhere (Activity).
 */
export const ATTEMPT_MOVES: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  creating: [],
  open: ['creating'],
  processing: ['open'],
  succeeded: ['open', 'processing'],
  failed: ['creating', 'open', 'processing'],
  expired: ['open', 'processing'],
  cancelled: ['open', 'processing'],
  abandoned: ['creating'],
  recording: ['succeeded'],
  recorded: ['recording', 'record_refused'],
  record_refused: ['recording'],
};

export const REFUND_STATES = ['requested', 'pending', 'requires_action', 'succeeded', 'failed', 'cancelled'] as const;
export type RefundRowState = (typeof REFUND_STATES)[number];

/**
 * Every move a refund may make. A refund is not instant: it waits at the
 * provider, may need the customer, and may FAIL after it succeeded (a closed
 * card), which undoes what it changed.
 */
export const REFUND_MOVES: Readonly<Record<RefundRowState, readonly RefundRowState[]>> = {
  requested: [],
  pending: ['requested', 'requires_action'],
  requires_action: ['requested', 'pending'],
  succeeded: ['requested', 'pending', 'requires_action'],
  failed: ['requested', 'pending', 'requires_action', 'succeeded'],
  cancelled: ['requested', 'pending', 'requires_action'],
};

// ─── Payable keys ───────────────────────────────────────────────────────────

export const PAYABLE_KINDS = ['shape', 'profile', 'document'] as const;
export type PayableKind = (typeof PAYABLE_KINDS)[number];

/** Where a payable lives. `rowKey` is its primary key in canonical text, or the document's id. */
export interface PayableRef {
  kind: PayableKind;
  connectionId: string | null;
  tableName: string | null;
  rowKey: string;
}

/** `document:<id>` or `<connection>:<table>:<row>` — the one key a payable is counted under. */
export function payableKeyOf(ref: PayableRef): string {
  if (ref.kind === 'document') return `document:${ref.rowKey}`;
  return `${ref.connectionId ?? ''}:${ref.tableName ?? ''}:${ref.rowKey}`;
}

// ─── Decimal sums (exact) ───────────────────────────────────────────────────

const SUM_SCALE = 6;

function toMicro(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount);
  if (match === null) throw new RangeError(`"${amount}" is not a stored amount`);
  return BigInt(`${match[1]}${(match[2] ?? '').padEnd(SUM_SCALE, '0')}`);
}

function fromMicro(micro: bigint): string {
  const digits = micro.toString().padStart(SUM_SCALE + 1, '0');
  const whole = digits.slice(0, -SUM_SCALE);
  const fraction = digits.slice(-SUM_SCALE).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** a + b, exactly. */
export function sumAmounts(amounts: readonly string[]): string {
  return fromMicro(amounts.reduce((total, one) => total + toMicro(one), 0n));
}

/** a − b, exactly; null when b > a. */
export function amountLeft(a: string, b: string): string | null {
  const result = toMicro(a) - toMicro(b);
  return result < 0n ? null : fromMicro(result);
}

// ─── Attempts ───────────────────────────────────────────────────────────────

export interface PaymentAttempt {
  id: string;
  provider: string;
  mode: 'test' | 'live';
  accountId: string | null;
  payable: PayableRef;
  payableLabel: string;
  amount: string;
  currency: string;
  state: AttemptState;
  openKey: string | null;
  linkId: string | null;
  nonce: string;
  providerRef: string | null;
  checkoutUrl: string | null;
  paymentRef: string | null;
  takenAmount: string | null;
  takenCurrency: string | null;
  paidWith: unknown;
  problem: AttemptProblem | null;
  recordedKey: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  settledAt: number | null;
  recordedAt: number | null;
  flaggedAt: number | null;
}

/** Why an attempt stopped short: a code the engine branches on, and the sentence staff read. */
export interface AttemptProblem {
  code: string;
  message: string;
}

export interface CreateAttemptInput {
  provider: string;
  mode: 'test' | 'live';
  accountId: string | null;
  payable: PayableRef;
  payableLabel: string;
  amount: string;
  currency: string;
  linkId: string | null;
  nonce: string;
  createdBy: string | null;
}

/** What a move may write besides the state. */
export interface AttemptPatch {
  accountId?: string | null;
  providerRef?: string | null;
  checkoutUrl?: string | null;
  paymentRef?: string | null;
  takenAmount?: string | null;
  takenCurrency?: string | null;
  paidWith?: unknown;
  problem?: AttemptProblem | null;
  recordedKey?: string | null;
  settledAt?: number | null;
  recordedAt?: number | null;
}

function decodeAttempt(row: Selectable<AdminiumPaymentAttemptsTable>): PaymentAttempt {
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode as 'test' | 'live',
    accountId: row.accountId,
    payable: {
      kind: row.payableKind as PayableKind,
      connectionId: row.connectionId,
      tableName: row.tableName,
      rowKey: row.rowKey,
    },
    payableLabel: row.payableLabel,
    amount: row.amount,
    currency: row.currency,
    state: row.state as AttemptState,
    openKey: row.openKey,
    linkId: row.linkId,
    nonce: row.nonce,
    providerRef: row.providerRef,
    checkoutUrl: row.checkoutUrl,
    paymentRef: row.paymentRef,
    takenAmount: row.takenAmount,
    takenCurrency: row.takenCurrency,
    paidWith: readJsonOrNull(row.paidWith),
    problem: readJsonOrNull<AttemptProblem>(row.problem),
    recordedKey: row.recordedKey,
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    settledAt: row.settledAt === null ? null : Number(row.settledAt),
    recordedAt: row.recordedAt === null ? null : Number(row.recordedAt),
    flaggedAt: row.flaggedAt === null ? null : Number(row.flaggedAt),
  };
}

function patchColumns(patch: AttemptPatch): Partial<Record<string, unknown>> {
  const out: Partial<Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = key === 'paidWith' || key === 'problem' ? (value === null ? null : packJson(value)) : value;
  }
  return out;
}

export function paymentAttemptsRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    /**
     * Inserts a `creating` attempt holding the payable's open slot. Returns
     * null when another attempt already holds it: the unique index decides,
     * nothing checks first.
     */
    async create(input: CreateAttemptInput, at: number = Date.now()): Promise<PaymentAttempt | null> {
      const row: Insertable<AdminiumPaymentAttemptsTable> = {
        id: newId('pat'),
        provider: input.provider,
        mode: input.mode,
        accountId: input.accountId,
        payableKind: input.payable.kind,
        connectionId: input.payable.connectionId,
        tableName: input.payable.tableName,
        rowKey: input.payable.rowKey,
        payableLabel: input.payableLabel,
        amount: input.amount,
        currency: input.currency,
        state: 'creating',
        openKey: payableKeyOf(input.payable),
        linkId: input.linkId,
        nonce: input.nonce,
        providerRef: null,
        checkoutUrl: null,
        paymentRef: null,
        takenAmount: null,
        takenCurrency: null,
        paidWith: null,
        problem: null,
        recordedKey: null,
        createdBy: input.createdBy,
        createdAt: at,
        updatedAt: at,
        settledAt: null,
        recordedAt: null,
        flaggedAt: null,
      };
      try {
        await db.insertInto('adminium_payment_attempts').values(row).execute();
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
      return decodeAttempt(row as unknown as Selectable<AdminiumPaymentAttemptsTable>);
    },

    async byId(id: string): Promise<PaymentAttempt | null> {
      const row = await db.selectFrom('adminium_payment_attempts').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decodeAttempt(row);
    },

    /** The attempt holding a payable's open slot, if any. */
    async openFor(payable: PayableRef): Promise<PaymentAttempt | null> {
      const row = await db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('openKey', '=', payableKeyOf(payable))
        .executeTakeFirst();
      return row === undefined ? null : decodeAttempt(row);
    },

    async byProviderRef(provider: string, mode: string, providerRef: string): Promise<PaymentAttempt | null> {
      const row = await db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('providerRef', '=', providerRef)
        .executeTakeFirst();
      return row === undefined ? null : decodeAttempt(row);
    },

    async byPaymentRef(provider: string, mode: string, paymentRef: string): Promise<PaymentAttempt | null> {
      const row = await db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('paymentRef', '=', paymentRef)
        .executeTakeFirst();
      return row === undefined ? null : decodeAttempt(row);
    },

    /** The attempt a return URL names. The nonce is unguessable; the caller still checks the link. */
    async byNonce(nonce: string): Promise<PaymentAttempt | null> {
      const row = await db.selectFrom('adminium_payment_attempts').selectAll().where('nonce', '=', nonce).executeTakeFirst();
      return row === undefined ? null : decodeAttempt(row);
    },

    /** Every attempt a payable has had, newest first. */
    async forPayable(payable: PayableRef, limit = 50): Promise<PaymentAttempt[]> {
      let query = db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('payableKind', '=', payable.kind)
        .where('rowKey', '=', payable.rowKey);
      query =
        payable.connectionId === null
          ? query.where('connectionId', 'is', null)
          : query.where('connectionId', '=', payable.connectionId);
      query = payable.tableName === null ? query.where('tableName', 'is', null) : query.where('tableName', '=', payable.tableName);
      const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(limit).execute();
      return rows.map(decodeAttempt);
    },

    /**
     * Moves an attempt to `to` from any state `ATTEMPT_MOVES` allows, as one
     * compare-and-set. Returns false when the attempt was not in an allowed
     * state (somebody else moved it first). Leaving the open states frees the
     * payable's slot in the same statement.
     */
    async move(id: string, to: AttemptState, patch: AttemptPatch = {}, at: number = Date.now()): Promise<boolean> {
      const from = ATTEMPT_MOVES[to];
      if (from.length === 0) throw new RangeError(`An attempt never moves to "${to}".`);
      const set: Record<string, unknown> = { ...patchColumns(patch), state: to, updatedAt: at };
      if (!OPEN_ATTEMPT_STATES.includes(to)) set['openKey'] = null;
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set(set)
        .where('id', '=', id)
        .where('state', 'in', [...from])
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Writes what was learned without a move (a ref read again, the taken amount). Guarded on the state. */
    async note(id: string, state: AttemptState, patch: AttemptPatch, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set({ ...patchColumns(patch), updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', state)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Marks a processing attempt past its method's horizon (Activity shows it; the sweep stops polling). */
    async flag(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set({ flaggedAt: at, updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'processing')
        .where('flaggedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Attempts in these states not touched since `before`, oldest first: what the sweep picks up. */
    async stale(states: readonly AttemptState[], before: number, limit = 100): Promise<PaymentAttempt[]> {
      const rows = await db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('state', 'in', [...states])
        .where('updatedAt', '<', before)
        .orderBy('updatedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decodeAttempt);
    },
  };
}

export type PaymentAttemptsRepo = ReturnType<typeof paymentAttemptsRepo>;

// ─── Events ─────────────────────────────────────────────────────────────────

export interface PaymentEventRow {
  id: string;
  provider: string;
  mode: string;
  eventId: string;
  type: string;
  kind: string;
  checkoutRef: string | null;
  paymentRef: string | null;
  refundRef: string | null;
  attemptId: string | null;
  source: 'webhook' | 'sweep' | 'poll';
  body: unknown;
  receivedAt: number;
  processedAt: number | null;
}

export type RecordEventInput = Omit<PaymentEventRow, 'id' | 'receivedAt' | 'processedAt'>;

function decodeEvent(row: Selectable<AdminiumPaymentEventsTable>): PaymentEventRow {
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    eventId: row.eventId,
    type: row.type,
    kind: row.kind,
    checkoutRef: row.checkoutRef,
    paymentRef: row.paymentRef,
    refundRef: row.refundRef,
    attemptId: row.attemptId,
    source: row.source as PaymentEventRow['source'],
    body: readJsonOrNull(row.body),
    receivedAt: Number(row.receivedAt),
    processedAt: row.processedAt === null ? null : Number(row.processedAt),
  };
}

export function paymentEventsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * Stores an event once. A second delivery of the same event (the
     * provider retries, the sweep finds it too) is `fresh: false` and must do
     * nothing more.
     */
    async record(input: RecordEventInput, at: number = Date.now()): Promise<{ event: PaymentEventRow; fresh: boolean }> {
      const row: Insertable<AdminiumPaymentEventsTable> = {
        id: newId('pev'),
        provider: input.provider,
        mode: input.mode,
        eventId: input.eventId,
        type: input.type,
        kind: input.kind,
        checkoutRef: input.checkoutRef,
        paymentRef: input.paymentRef,
        refundRef: input.refundRef,
        attemptId: input.attemptId,
        source: input.source,
        body: input.body === undefined || input.body === null ? null : packJson(input.body),
        receivedAt: at,
        processedAt: null,
      };
      try {
        await db.insertInto('adminium_payment_events').values(row).execute();
        return { event: decodeEvent(row as unknown as Selectable<AdminiumPaymentEventsTable>), fresh: true };
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const found = await db
          .selectFrom('adminium_payment_events')
          .selectAll()
          .where('provider', '=', input.provider)
          .where('mode', '=', input.mode)
          .where('eventId', '=', input.eventId)
          .executeTakeFirstOrThrow();
        return { event: decodeEvent(found), fresh: false };
      }
    },

    /** Marks an event handled. Guarded, so a second handler cannot claim it was first. */
    async markProcessed(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payment_events')
        .set({ processedAt: at })
        .where('id', '=', id)
        .where('processedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Events received before `before` and never processed: the sweep re-drives them. */
    async unprocessed(before: number, limit = 100): Promise<PaymentEventRow[]> {
      const rows = await db
        .selectFrom('adminium_payment_events')
        .selectAll()
        .where('processedAt', 'is', null)
        .where('receivedAt', '<', before)
        .orderBy('receivedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decodeEvent);
    },

    /** Deletes processed events older than `days`. Unprocessed ones are work and are kept. */
    async gc(at: number, days: number): Promise<number> {
      const res = await db
        .deleteFrom('adminium_payment_events')
        .where('processedAt', 'is not', null)
        .where('receivedAt', '<', at - days * DAY_MS)
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n);
    },
  };
}

export type PaymentEventsRepo = ReturnType<typeof paymentEventsRepo>;

// ─── Payments Adminium keeps ────────────────────────────────────────────────

export interface KeptPayment {
  id: string;
  payable: PayableRef;
  payableKey: string;
  number: string | null;
  amount: string;
  currency: string;
  refundedAmount: string;
  method: string;
  methodNote: string | null;
  provider: string | null;
  mode: 'test' | 'live';
  attemptId: string | null;
  approvalCode: string | null;
  cardLast4: string | null;
  note: string | null;
  paidOn: number;
  recordedBy: string;
  recordedByUser: string | null;
  voided: boolean;
  voidReason: string | null;
  voidedAt: number | null;
  createdAt: number;
}

export interface InsertKeptPaymentInput {
  payable: PayableRef;
  number: string | null;
  amount: string;
  currency: string;
  method: string;
  methodNote: string | null;
  provider: string | null;
  mode: 'test' | 'live';
  attemptId: string | null;
  approvalCode: string | null;
  cardLast4: string | null;
  note: string | null;
  paidOn: number;
  recordedBy: string;
  recordedByUser: string | null;
}

function decodeKept(row: Selectable<AdminiumPaymentsTable>): KeptPayment {
  return {
    id: row.id,
    payable: {
      kind: row.payableKind as PayableKind,
      connectionId: row.connectionId,
      tableName: row.tableName,
      rowKey: row.rowKey,
    },
    payableKey: row.payableKey,
    number: row.number,
    amount: row.amount,
    currency: row.currency,
    refundedAmount: row.refundedAmount,
    method: row.method,
    methodNote: row.methodNote,
    provider: row.provider,
    mode: row.mode as 'test' | 'live',
    attemptId: row.attemptId,
    approvalCode: row.approvalCode,
    cardLast4: row.cardLast4,
    note: row.note,
    paidOn: Number(row.paidOn),
    recordedBy: row.recordedBy,
    recordedByUser: row.recordedByUser,
    voided: readBool(row.voided),
    voidReason: row.voidReason,
    voidedAt: row.voidedAt === null ? null : Number(row.voidedAt),
    createdAt: Number(row.createdAt),
  };
}

export function keptPaymentsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * Records a payment. For an online one (`attemptId` set) this is
     * insert-first: null means the attempt is already recorded, and the
     * caller reads it with `byAttempt`.
     */
    async insert(input: InsertKeptPaymentInput, at: number = Date.now()): Promise<KeptPayment | null> {
      const row: Selectable<AdminiumPaymentsTable> = {
        id: newId('pay'),
        payableKind: input.payable.kind,
        connectionId: input.payable.connectionId,
        tableName: input.payable.tableName,
        rowKey: input.payable.rowKey,
        payableKey: payableKeyOf(input.payable),
        number: input.number,
        amount: input.amount,
        currency: input.currency,
        refundedAmount: '0',
        method: input.method,
        methodNote: input.methodNote,
        provider: input.provider,
        mode: input.mode,
        attemptId: input.attemptId,
        approvalCode: input.approvalCode,
        cardLast4: input.cardLast4,
        note: input.note,
        paidOn: input.paidOn,
        recordedBy: input.recordedBy,
        recordedByUser: input.recordedByUser,
        voided: writeBool(meta, false),
        voidReason: null,
        voidedAt: null,
        createdAt: at,
      };
      try {
        await db.insertInto('adminium_payments').values(row).execute();
      } catch (error) {
        if (input.attemptId !== null && isDuplicateKeyError(error)) return null;
        throw error;
      }
      return decodeKept(row);
    },

    async byId(id: string): Promise<KeptPayment | null> {
      const row = await db.selectFrom('adminium_payments').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decodeKept(row);
    },

    async byAttempt(attemptId: string): Promise<KeptPayment | null> {
      const row = await db.selectFrom('adminium_payments').selectAll().where('attemptId', '=', attemptId).executeTakeFirst();
      return row === undefined ? null : decodeKept(row);
    },

    /** A payable's payments, oldest first, void ones included. */
    async forPayable(payable: PayableRef): Promise<KeptPayment[]> {
      const rows = await db
        .selectFrom('adminium_payments')
        .selectAll()
        .where('payableKey', '=', payableKeyOf(payable))
        .orderBy('paidOn', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map((row) => decodeKept(row));
    },

    /**
     * What a payable has been paid in one currency, net of refunds, live
     * payments only unless `mode` says otherwise. Exact: summed here.
     */
    async paid(payable: PayableRef, currency: string, mode: 'test' | 'live' = 'live'): Promise<string> {
      const rows = await this.forPayable(payable);
      const counted = rows.filter((row) => !row.voided && row.currency === currency && row.mode === mode);
      const gross = sumAmounts(counted.map((row) => row.amount));
      const refunded = sumAmounts(counted.map((row) => row.refundedAmount));
      return amountLeft(gross, refunded) ?? '0';
    },

    /**
     * Adds to a payment's refunded amount, as a compare-and-set on the old
     * value, refusing to pass the amount paid. Returns false when someone
     * changed it first or it would pass; the caller reads again and retries.
     */
    async addRefunded(id: string, previous: string, amount: string): Promise<boolean> {
      const current = await this.byId(id);
      if (current === null || current.refundedAmount !== previous) return false;
      const next = sumAmounts([previous, amount]);
      if (amountLeft(current.amount, next) === null) return false;
      const res = await db
        .updateTable('adminium_payments')
        .set({ refundedAmount: next })
        .where('id', '=', id)
        .where('refundedAmount', '=', previous)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Takes back an amount a failed refund had added (compare-and-set, as above). */
    async subtractRefunded(id: string, previous: string, amount: string): Promise<boolean> {
      const next = amountLeft(previous, amount);
      if (next === null) return false;
      const res = await db
        .updateTable('adminium_payments')
        .set({ refundedAmount: next })
        .where('id', '=', id)
        .where('refundedAmount', '=', previous)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async void(id: string, reason: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payments')
        .set({ voided: writeBool(meta, true), voidReason: reason, voidedAt: at })
        .where('id', '=', id)
        .where('voidedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },
  };
}

export type KeptPaymentsRepo = ReturnType<typeof keptPaymentsRepo>;

// ─── Refunds ────────────────────────────────────────────────────────────────

export interface RefundRow {
  id: string;
  attemptId: string | null;
  paymentId: string | null;
  provider: string;
  mode: 'test' | 'live';
  paymentRef: string;
  amount: string;
  currency: string;
  reason: string;
  note: string | null;
  state: RefundRowState;
  idempotencyKey: string;
  providerRefundId: string | null;
  source: 'staff' | 'provider';
  requestedBy: string | null;
  failureMessage: string | null;
  createdAt: number;
  updatedAt: number;
  settledAt: number | null;
  appliedAt: number | null;
  undoneAt: number | null;
}

export interface CreateRefundInput {
  attemptId: string | null;
  paymentId: string | null;
  provider: string;
  mode: 'test' | 'live';
  paymentRef: string;
  amount: string;
  currency: string;
  reason: string;
  note: string | null;
  idempotencyKey: string;
  source: 'staff' | 'provider';
  requestedBy: string | null;
  /** A refund made at the provider arrives already settled; one made here starts `requested`. */
  state?: RefundRowState;
  providerRefundId?: string | null;
}

export interface RefundPatch {
  providerRefundId?: string | null;
  failureMessage?: string | null;
  settledAt?: number | null;
}

function decodeRefund(row: Selectable<AdminiumRefundsTable>): RefundRow {
  return {
    id: row.id,
    attemptId: row.attemptId,
    paymentId: row.paymentId,
    provider: row.provider,
    mode: row.mode as 'test' | 'live',
    paymentRef: row.paymentRef,
    amount: row.amount,
    currency: row.currency,
    reason: row.reason,
    note: row.note,
    state: row.state as RefundRowState,
    idempotencyKey: row.idempotencyKey,
    providerRefundId: row.providerRefundId,
    source: row.source as 'staff' | 'provider',
    requestedBy: row.requestedBy,
    failureMessage: row.failureMessage,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    settledAt: row.settledAt === null ? null : Number(row.settledAt),
    appliedAt: row.appliedAt === null ? null : Number(row.appliedAt),
    undoneAt: row.undoneAt === null ? null : Number(row.undoneAt),
  };
}

export function refundsRepo(meta: MetaDb) {
  const { db } = meta;

  async function byKey(idempotencyKey: string): Promise<RefundRow | null> {
    const row = await db.selectFrom('adminium_refunds').selectAll().where('idempotencyKey', '=', idempotencyKey).executeTakeFirst();
    return row === undefined ? null : decodeRefund(row);
  }

  return {
    /**
     * Creates a refund under its idempotency key. A second create with the
     * same key (a double click, a retry) returns the first refund, `fresh:
     * false`: it never makes a second one.
     */
    async create(input: CreateRefundInput, at: number = Date.now()): Promise<{ refund: RefundRow; fresh: boolean }> {
      const row: Selectable<AdminiumRefundsTable> = {
        id: newId('rfd'),
        attemptId: input.attemptId,
        paymentId: input.paymentId,
        provider: input.provider,
        mode: input.mode,
        paymentRef: input.paymentRef,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason,
        note: input.note,
        state: input.state ?? 'requested',
        idempotencyKey: input.idempotencyKey,
        providerRefundId: input.providerRefundId ?? null,
        source: input.source,
        requestedBy: input.requestedBy,
        failureMessage: null,
        createdAt: at,
        updatedAt: at,
        settledAt: input.state === 'succeeded' ? at : null,
        appliedAt: null,
        undoneAt: null,
      };
      try {
        await db.insertInto('adminium_refunds').values(row).execute();
        return { refund: decodeRefund(row), fresh: true };
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const found = (await byKey(input.idempotencyKey)) ?? (input.providerRefundId ? await this.byProviderId(input.provider, input.mode, input.providerRefundId) : null);
        if (found === null) throw error;
        return { refund: found, fresh: false };
      }
    },

    async byId(id: string): Promise<RefundRow | null> {
      const row = await db.selectFrom('adminium_refunds').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decodeRefund(row);
    },

    byKey,

    async byProviderId(provider: string, mode: string, providerRefundId: string): Promise<RefundRow | null> {
      const row = await db
        .selectFrom('adminium_refunds')
        .selectAll()
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('providerRefundId', '=', providerRefundId)
        .executeTakeFirst();
      return row === undefined ? null : decodeRefund(row);
    },

    /** Every refund against one payment at a provider, oldest first. */
    async forPaymentRef(paymentRef: string): Promise<RefundRow[]> {
      const rows = await db
        .selectFrom('adminium_refunds')
        .selectAll()
        .where('paymentRef', '=', paymentRef)
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(decodeRefund);
    },

    /** What is promised back on a payment: every refund not failed or cancelled. */
    async committed(paymentRef: string): Promise<string> {
      const rows = await this.forPaymentRef(paymentRef);
      return sumAmounts(rows.filter((row) => row.state !== 'failed' && row.state !== 'cancelled').map((row) => row.amount));
    },

    /** Moves a refund as one compare-and-set; false when it was not in an allowed state. */
    async move(id: string, to: RefundRowState, patch: RefundPatch = {}, at: number = Date.now()): Promise<boolean> {
      const from = REFUND_MOVES[to];
      if (from.length === 0) throw new RangeError(`A refund never moves to "${to}".`);
      const set: Record<string, unknown> = { state: to, updatedAt: at };
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) set[key] = value;
      if (to === 'succeeded' && patch.settledAt === undefined) set['settledAt'] = at;
      const res = await db
        .updateTable('adminium_refunds')
        .set(set)
        .where('id', '=', id)
        .where('state', 'in', [...from])
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** The shop's record took this refund. Once. */
    async markApplied(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_refunds')
        .set({ appliedAt: at, updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'succeeded')
        .where('appliedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** A failure after success took the refund back out of the shop's record. Once. */
    async markUndone(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_refunds')
        .set({ undoneAt: at, updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'failed')
        .where('appliedAt', 'is not', null)
        .where('undoneAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },
  };
}

export type RefundsRepo = ReturnType<typeof refundsRepo>;
