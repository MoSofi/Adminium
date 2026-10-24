// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The payments repos (migration 0062): attempts, events, the payments
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
 * `open_key` is set from the moment an attempt is made until its payment is
 * recorded or refused (`OPEN_ATTEMPT_STATES`), and the move out of those
 * states sets it to NULL in the same statement. Its unique
 * index is the rule; `create` reads a duplicate as "an attempt is already
 * open" and returns null, never checks first.
 *
 * ─── Exactly once, across two databases ────────────────────────────────────
 *
 * A payment Adminium keeps itself carries its attempt id under a unique
 * index, so recording is insert-first: `kept.insert` returns null when the
 * attempt is already recorded, and the caller reads that row instead.
 *
 * Money is decimal TEXT throughout (0062's header says why); sums are made
 * here in exact decimal arithmetic, never by the database.
 */

import { createHash } from 'node:crypto';

import type { ExpressionBuilder, Insertable, Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  MetaDB,
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

/**
 * The states in which an attempt holds its payable's one open slot: from the
 * moment it is made until its payment is written down (or refused). Holding
 * it through `succeeded` and `recording` means a second checkout cannot start
 * in the seconds between the money arriving and the record being written,
 * which would let the customer pay twice.
 */
export const OPEN_ATTEMPT_STATES: readonly AttemptState[] = ['creating', 'open', 'processing', 'succeeded', 'recording'];

/**
 * Every move an attempt may make, by target: the states it may come FROM.
 *
 * - `creating → open` once the provider answered with a ref and URL;
 *   `→ failed` when the provider refused to make the checkout;
 *   `→ abandoned` when it is old and has no ref (nobody holds its URL).
 * - `open | processing → succeeded | failed | expired | cancelled` as the
 *   provider's own status says (never a webhook body); a success the
 *   provider reports after Adminium marked it expired, cancelled or failed
 *   still moves to `succeeded`, so taken money is never left unrecorded.
 * - `succeeded → recording` when the record job claims it; `recording →
 *   recorded | record_refused`.
 * - `record_refused → recorded` when a person records it elsewhere (Activity).
 */
export const ATTEMPT_MOVES: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  creating: [],
  open: ['creating'],
  processing: ['open'],
  // The provider's own status is the truth: a checkout marked expired, cancelled or failed here
  // may still have been paid there (an expiry that raced the customer), and that money is recorded.
  succeeded: ['open', 'processing', 'expired', 'cancelled', 'failed'],
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

/** `document:<id>` or `<connection>:<table>:<row>`: what a payable is, as text. */
export function payableNameOf(ref: PayableRef): string {
  if (ref.kind === 'document') return `document:${ref.rowKey}`;
  return `${ref.connectionId ?? ''}:${ref.tableName ?? ''}:${ref.rowKey}`;
}

/**
 * The one key a payable is counted under: a hash of its name. Hashed because
 * a MySQL meta store compares text without regard to case, so two rows whose
 * keys differ only in case (`ab` and `AB`) would share one open slot, one
 * current link and one paid sum. A hash compares the same on every engine.
 */
export function payableKeyOf(ref: PayableRef): string {
  return `pk1:${createHash('sha256').update(payableNameOf(ref), 'utf8').digest('hex')}`;
}

/**
 * The open slot of a payable in one mode. Test payments are pretend money, so
 * a staff member's test checkout never holds the payable against a customer
 * paying for real (and the reverse).
 */
export function openKeyOf(ref: PayableRef, mode: 'test' | 'live'): string {
  return mode === 'live' ? payableKeyOf(ref) : `${payableKeyOf(ref)}:test`;
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
  /** "Mark as checked" in Activity. */
  check: AttemptCheck | null;
  /** When the provider was last asked about it. */
  lookedAt: number | null;
  /** Which capture try a two-step provider's next capture is. */
  captureTry: number;
  failEvents: number;
  failCounted: number;
  /** What refunds not failed have promised back from the money taken. */
  refundCommitted: string;
  /** A dispute the provider told of, or null. `outcome`: how a closed one ended, when the provider said. */
  dispute: { state: 'open' | 'closed'; at: number; closedAt: number | null; outcome: DisputeOutcome | null } | null;
}

/** How a closed dispute ended, when the provider said so. */
export const DISPUTE_OUTCOMES = ['won', 'lost'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export interface AttemptCheck {
  at: number;
  by: string | null;
  note: string | null;
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
    // A check covers the problem it was made for: a later, different one is unchecked.
    check: !checkHolds(row) ? null : { at: Number(row.checkedAt), by: row.checkedBy, note: row.checkNote },
    lookedAt: row.lookedAt === null || row.lookedAt === undefined ? null : Number(row.lookedAt),
    captureTry: Number(row.captureTry ?? 0),
    failEvents: Number(row.failEvents ?? 0),
    failCounted: Number(row.failCounted ?? 0),
    refundCommitted: row.refundCommitted ?? '0',
    dispute:
      row.disputeState === 'open' || row.disputeState === 'closed'
        ? {
            state: row.disputeState,
            at: Number(row.disputedAt ?? 0),
            closedAt: row.disputeClosedAt === null || row.disputeClosedAt === undefined ? null : Number(row.disputeClosedAt),
            // Only a closed dispute has an outcome.
            outcome: row.disputeState === 'closed' && (DISPUTE_OUTCOMES as readonly string[]).includes(row.disputeOutcome ?? '') ? (row.disputeOutcome as DisputeOutcome) : null,
          }
        : null,
  };
}

/** Same row key, compared exactly (a MySQL meta store matched it without regard to case). */
function samePayable(attempt: PaymentAttempt, ref: PayableRef): boolean {
  return attempt.payable.kind === ref.kind && attempt.payable.rowKey === ref.rowKey && attempt.payable.connectionId === ref.connectionId && attempt.payable.tableName === ref.tableName;
}


function patchColumns(patch: AttemptPatch): Partial<Record<string, unknown>> {
  const out: Partial<Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = key === 'paidWith' || key === 'problem' ? (value === null ? null : packJson(value)) : value;
    if (key === 'problem') out['problemCode'] = value === null ? null : String((value as AttemptProblem).code).slice(0, 40);
  }
  return out;
}

/** Whether an attempt's check still covers it: made, and for the problem it has now. */
function checkHolds(row: { checkedAt: unknown; checkCode?: string | null; problemCode?: string | null }): boolean {
  return row.checkedAt !== null && (row.checkCode ?? null) === (row.problemCode ?? null);
}

/** "Not checked for the problem it has now", as a condition (null-safe on every engine). */
function uncheckedNow(eb: ExpressionBuilder<MetaDB, 'adminium_payment_attempts'>) {
  return eb.or([
    eb('checkedAt', 'is', null),
    eb.and([eb('checkCode', 'is', null), eb('problemCode', 'is not', null)]),
    eb.and([eb('checkCode', 'is not', null), eb('problemCode', 'is', null)]),
    eb('checkCode', '<>', eb.ref('problemCode')),
  ]);
}

/** An open dispute nobody has checked since it opened. */
function disputeUnchecked(eb: ExpressionBuilder<MetaDB, 'adminium_payment_attempts'>) {
  return eb.and([eb('disputeState', '=', 'open'), eb.or([eb('checkedAt', 'is', null), eb('checkedAt', '<', eb.ref('disputedAt'))])]);
}

/** What "needs a look" means in the database: a refused record or a flag not checked for its problem, or an open dispute not checked since it opened. */
function needsLook(eb: ExpressionBuilder<MetaDB, 'adminium_payment_attempts'>) {
  return eb.or([eb.and([eb.or([eb('state', '=', 'record_refused'), eb('flaggedAt', 'is not', null)]), uncheckedNow(eb)]), disputeUnchecked(eb)]);
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
        openKey: openKeyOf(input.payable, input.mode),
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
        checkedAt: null,
        checkedBy: null,
        checkNote: null,
        problemCode: null,
        checkCode: null,
        lookedAt: null,
        captureTry: 0,
        failEvents: 0,
        refundCommitted: '0',
        disputeState: null,
        disputedAt: null,
        disputeClosedAt: null,
        failCounted: 0,
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

    /**
     * The attempt holding a payable's open slot in a mode. With no mode, the
     * live one, else the test one.
     */
    async openFor(payable: PayableRef, mode?: 'test' | 'live'): Promise<PaymentAttempt | null> {
      const modes: ('test' | 'live')[] = mode === undefined ? ['live', 'test'] : [mode];
      for (const one of modes) {
        const row = await db.selectFrom('adminium_payment_attempts').selectAll().where('openKey', '=', openKeyOf(payable, one)).executeTakeFirst();
        if (row !== undefined) return decodeAttempt(row);
      }
      return null;
    },

    async byProviderRef(provider: string, mode: string, providerRef: string): Promise<PaymentAttempt | null> {
      const rows = await db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('providerRef', '=', providerRef)
        .execute();
      // Exact: a MySQL meta store matches text without regard to case.
      const row = rows.find((one) => one.providerRef === providerRef);
      return row === undefined ? null : decodeAttempt(row);
    },

    async byPaymentRef(provider: string, mode: string, paymentRef: string): Promise<PaymentAttempt | null> {
      const rows = await db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('paymentRef', '=', paymentRef)
        .execute();
      const row = rows.find((one) => one.paymentRef === paymentRef);
      return row === undefined ? null : decodeAttempt(row);
    },

    /** The attempt a return URL names. The nonce is unguessable; the caller still checks the link. */
    async byNonce(nonce: string): Promise<PaymentAttempt | null> {
      const rows = await db.selectFrom('adminium_payment_attempts').selectAll().where('nonce', '=', nonce).execute();
      const row = rows.find((one) => one.nonce === nonce);
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
      return rows.map(decodeAttempt).filter((one) => samePayable(one, payable));
    },

    /**
     * Moves an attempt to `to` from any state `ATTEMPT_MOVES` allows, as one
     * compare-and-set. Returns false when the attempt was not in an allowed
     * state (somebody else moved it first). Leaving the open states frees the
     * payable's slot in the same statement.
     *
     * A success that comes back from a closed state (the provider took the
     * money after Adminium let the payable go) takes the slot back, so no
     * second checkout starts before it is written down. When another attempt
     * holds the slot by then, the success still moves (taken money is never
     * left unrecorded) and is flagged for a person: two payments may be on
     * their way.
     */
    async move(id: string, to: AttemptState, patch: AttemptPatch = {}, at: number = Date.now()): Promise<boolean> {
      const from = ATTEMPT_MOVES[to];
      if (from.length === 0) throw new RangeError(`An attempt never moves to "${to}".`);
      const set: Record<string, unknown> = { ...patchColumns(patch), state: to, updatedAt: at };
      if (!OPEN_ATTEMPT_STATES.includes(to)) set['openKey'] = null;
      const run = (values: Record<string, unknown>) =>
        db.updateTable('adminium_payment_attempts').set(values).where('id', '=', id).where('state', 'in', [...from]).executeTakeFirst();
      if (to === 'succeeded') {
        const current = await db.selectFrom('adminium_payment_attempts').selectAll().where('id', '=', id).executeTakeFirst();
        if (current === undefined || !(from as readonly string[]).includes(current.state)) return false;
        if (current.openKey === null) {
          const attempt = decodeAttempt(current);
          try {
            return affected((await run({ ...set, openKey: openKeyOf(attempt.payable, attempt.mode) })).numUpdatedRows) === 1;
          } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
            const problem: AttemptProblem = { code: 'TWO_AT_ONCE', message: 'Another payment for the same record was on its way when this one arrived.' };
            return affected((await run({ ...set, flaggedAt: at, problem: packJson(problem), problemCode: problem.code })).numUpdatedRows) === 1;
          }
        }
      }
      return affected((await run(set)).numUpdatedRows) === 1;
    },

    /** The provider was asked about it now (whatever it answered). */
    async looked(id: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_payment_attempts').set({ lookedAt: at }).where('id', '=', id).execute();
    },

    /** The next capture try gets a key of its own (a declined capture's key would replay the decline). */
    async nextCaptureTry(id: string, seen: number): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set({ captureTry: seen + 1 })
        .where('id', '=', id)
        .where('captureTry', '=', seen)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * Counts a decline the provider reported, once: through one of its events
     * (`viaEvent`, each stored event is settled once) or by the attempt's own
     * move to failed. Returns how many declines the link's failure count must
     * gain now: `max(1, declines seen in events)` less what it already holds.
     */
    async countFailure(id: string, viaEvent: boolean): Promise<number> {
      if (viaEvent) await db.updateTable('adminium_payment_attempts').set((eb) => ({ failEvents: eb('failEvents', '+', 1) })).where('id', '=', id).execute();
      for (let round = 0; round < 3; round += 1) {
        const row = await db.selectFrom('adminium_payment_attempts').select(['failEvents', 'failCounted']).where('id', '=', id).executeTakeFirst();
        if (row === undefined) return 0;
        const counted = Number(row.failCounted);
        const wanted = Math.max(1, Number(row.failEvents));
        if (wanted <= counted) return 0;
        const res = await db
          .updateTable('adminium_payment_attempts')
          .set({ failCounted: wanted })
          .where('id', '=', id)
          .where('failCounted', '=', counted)
          .executeTakeFirst();
        if (affected(res.numUpdatedRows) === 1) return wanted - counted;
      }
      return 0;
    },

    /**
     * Attempts of one service and mode in these states, the longest-unasked
     * first, not asked since `before`: what the sweep looks up. Filtered and
     * ordered in the database, so one busy service never hides another's.
     */
    async waitingOn(provider: string, mode: string, states: readonly AttemptState[], before: number, limit = 100, createdAfter?: number): Promise<PaymentAttempt[]> {
      let query = db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('state', 'in', [...states])
        .where('providerRef', 'is not', null)
        .where((eb) => eb(eb.fn.coalesce('lookedAt', 'updatedAt'), '<', before));
      if (createdAfter !== undefined) query = query.where('createdAt', '>', createdAfter);
      const rows = await query.orderBy((eb) => eb.fn.coalesce('lookedAt', 'updatedAt'), 'asc').orderBy('id', 'asc').limit(limit).execute();
      return rows.map(decodeAttempt);
    },

    /** How many attempts of one service and mode are in these states. */
    async countIn(provider: string, mode: string, states: readonly AttemptState[]): Promise<number> {
      const row = await db
        .selectFrom('adminium_payment_attempts')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('state', 'in', [...states])
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /** Lets go of every attempt that never got a checkout (nobody holds its page), whatever its service. */
    async abandonStale(before: number, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set({ state: 'abandoned', openKey: null, updatedAt: at })
        .where('state', '=', 'creating')
        .where('providerRef', 'is', null)
        .where('updatedAt', '<', before)
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
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

    /**
     * Moves what refunds have promised back from `previous` to `next`, as one
     * compare-and-set: false when another refund moved it first (the caller
     * reads again and tries again). Never past the money taken, unless
     * `beyondTaken` (a refund the provider already made, which happened).
     */
    async commitRefund(id: string, previous: string, next: string, at: number = Date.now(), beyondTaken = false): Promise<boolean> {
      const attempt = await this.byId(id);
      if (attempt === null || attempt.refundCommitted !== previous) return false;
      if (!beyondTaken && (attempt.takenAmount === null || amountLeft(attempt.takenAmount, next) === null)) return false;
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set({ refundCommitted: next, updatedAt: at })
        .where('id', '=', id)
        .where('refundCommitted', '=', previous)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * A dispute the provider told of, at the time its event happened. Events
     * come in any order, so each moves only what is older than itself:
     *   - opened (`fresh`, a new dispute): from none, or from closed when it
     *     happened after that close (a second dispute);
     *   - any other news of an open dispute (an update) opens only one never
     *     heard of: after a close it changes nothing;
     *   - closed: from open when it happened after the open, or from none (the
     *     close came first; the open that follows is older and changes nothing);
     *     with its outcome (`won`, `lost`) when the provider said it. A close
     *     that said no outcome is told it by a later close of the same dispute,
     *     and a `lost` is told `won` by a later close (a provider that read a
     *     chargeback being filed as lost, then the bank decided for the seller);
     *     `won` is never told `lost`.
     *
     * The dispute starts when the provider opened it (`openedAt`, when its
     * event says), else at the first event heard: a dispute whose open was
     * never heard (opened under an add-on that did not listen, its "created"
     * retried after the close) still starts before the refund that settled it.
     * A start once recorded stays, so everything keyed by it stays the same.
     */
    async noteDispute(
      id: string,
      state: 'open' | 'closed',
      at: number = Date.now(),
      fresh = true,
      outcome: DisputeOutcome | null = null,
      openedAt: number | null = null,
    ): Promise<boolean> {
      // Never after the event that tells of it.
      const start = openedAt !== null && Number.isFinite(openedAt) && openedAt > 0 ? Math.min(openedAt, at) : at;
      const res =
        state === 'open'
          ? await db
              .updateTable('adminium_payment_attempts')
              .set({ disputeState: 'open', disputedAt: start, disputeClosedAt: null, disputeOutcome: null, updatedAt: at })
              .where('id', '=', id)
              .where((eb) => (fresh ? eb.or([eb('disputeState', 'is', null), eb.and([eb('disputeState', '=', 'closed'), eb('disputeClosedAt', '<', at)])]) : eb('disputeState', 'is', null)))
              .executeTakeFirst()
          : await db
              .updateTable('adminium_payment_attempts')
              .set((eb) => ({ disputeState: 'closed', disputeClosedAt: at, disputedAt: eb.fn.coalesce('disputedAt', eb.val(start)), disputeOutcome: outcome, updatedAt: at }))
              .where('id', '=', id)
              .where((eb) =>
                eb.or([
                  eb('disputeState', 'is', null),
                  eb.and([eb('disputeState', '=', 'open'), eb('disputedAt', '<=', at)]),
                  ...(outcome === null ? [] : [eb.and([eb('disputeState', '=', 'closed'), eb('disputeOutcome', 'is', null), eb('disputeClosedAt', '<=', at)])]),
                  ...(outcome === 'won' ? [eb.and([eb('disputeState', '=', 'closed'), eb('disputeOutcome', '=', 'lost'), eb('disputeClosedAt', '<=', at)])] : []),
                ]),
              )
              .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * Runs `run` as the one writer of this attempt's refunds, across processes:
     * in a transaction that first takes the attempt's row for writing (an
     * UPDATE that changes nothing — the same statement on all three engines:
     * a row lock until commit on Postgres and MySQL, the database's write lock
     * on SQLite). A second caller waits there until the first commits, then
     * reads what it wrote. `run` must use only the `meta` it is handed: the
     * outer one would wait on the lock this holds. No attempt with this id:
     * nothing runs, and the answer is null.
     */
    async holding<T>(id: string, run: (held: MetaDb, attempt: PaymentAttempt) => Promise<T>): Promise<T | null> {
      return db.transaction().execute(async (trx) => {
        // MySQL counts only changed rows, so the count says nothing: the row is held either way, then read.
        await trx
          .updateTable('adminium_payment_attempts')
          .set((eb) => ({ updatedAt: eb.ref('updatedAt') }))
          .where('id', '=', id)
          .execute();
        const row = await trx.selectFrom('adminium_payment_attempts').selectAll().where('id', '=', id).executeTakeFirst();
        if (row === undefined) return null;
        return run({ db: trx, dialect: meta.dialect }, decodeAttempt(row));
      });
    },

    /** Attempts with a dispute in a state, newest first (Activity, notices). */
    async disputed(state: 'open' | 'closed', limit = 200): Promise<PaymentAttempt[]> {
      const rows = await db.selectFrom('adminium_payment_attempts').selectAll().where('disputeState', '=', state).orderBy('disputedAt', 'desc').limit(limit).execute();
      return rows.map(decodeAttempt);
    },

    /** Marks a processing attempt past its method's horizon (Activity shows it; the sweep stops polling). */
    /** "Mark as checked" in Activity: a person looked at this attempt's flag and said what they found. */
    async check(id: string, by: string | null, note: string | null, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set((eb) => ({ checkedAt: at, checkedBy: by, checkNote: note, checkCode: eb.ref('problemCode'), updatedAt: at }))
        .where('id', '=', id)
        .where((eb) => eb.or([uncheckedNow(eb), disputeUnchecked(eb)]))
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Recorded attempts of one mode, recorded at or after `since`, newest first, from a `(recordedAt, id)` cursor. */
    async recordedPage(filter: { mode: 'test' | 'live'; since: number; before?: { at: number; id: string }; limit?: number }): Promise<PaymentAttempt[]> {
      let query = db.selectFrom('adminium_payment_attempts').selectAll().where('state', '=', 'recorded').where('mode', '=', filter.mode).where('recordedAt', '>=', filter.since);
      const before = filter.before;
      if (before !== undefined) query = query.where((eb) => eb.or([eb('recordedAt', '<', before.at), eb.and([eb('recordedAt', '=', before.at), eb('id', '<', before.id)])]));
      const rows = await query.orderBy('recordedAt', 'desc').orderBy('id', 'desc').limit(filter.limit ?? 200).execute();
      return rows.map(decodeAttempt);
    },

    /** Attempts in some states, last moved between `since` and `before`, newest first: what is stuck now, not years ago. */
    async movedBetween(states: readonly AttemptState[], filter: { mode?: 'test' | 'live'; since: number; before: number; limit?: number }): Promise<PaymentAttempt[]> {
      let query = db.selectFrom('adminium_payment_attempts').selectAll().where('state', 'in', [...states]).where('updatedAt', '>=', filter.since).where('updatedAt', '<', filter.before);
      if (filter.mode !== undefined) query = query.where('mode', '=', filter.mode);
      const rows = await query.orderBy('updatedAt', 'desc').orderBy('id', 'desc').limit(filter.limit ?? 200).execute();
      return rows.map(decodeAttempt);
    },

    /** Every attempt, newest first, for Activity: by mode and states when given. */
    async list(filter: { mode?: 'test' | 'live'; states?: readonly AttemptState[]; provider?: string; before?: number | { at: number; id: string }; limit?: number } = {}): Promise<PaymentAttempt[]> {
      let query = db.selectFrom('adminium_payment_attempts').selectAll();
      if (filter.mode !== undefined) query = query.where('mode', '=', filter.mode);
      if (filter.provider !== undefined) query = query.where('provider', '=', filter.provider);
      if (filter.states !== undefined && filter.states.length > 0) query = query.where('state', 'in', [...filter.states]);
      const before = filter.before;
      if (typeof before === 'number') query = query.where('createdAt', '<', before);
      else if (before !== undefined) query = query.where((eb) => eb.or([eb('createdAt', '<', before.at), eb.and([eb('createdAt', '=', before.at), eb('id', '<', before.id)])]));
      const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(filter.limit ?? 50).execute();
      return rows.map(decodeAttempt);
    },

    /** Flags an attempt for a person's look (in any state), once. */
    async flag(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payment_attempts')
        .set({ flaggedAt: at, updatedAt: at })
        .where('id', '=', id)
        .where('flaggedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * Attempts that need a person's look and nobody checked yet (taken but not
     * written down, or flagged), newest first, from a `(createdAt, id)` cursor.
     */
    async needingLook(filter: { mode?: 'test' | 'live'; provider?: string; before?: { at: number; id: string }; limit?: number } = {}): Promise<PaymentAttempt[]> {
      let query = db
        .selectFrom('adminium_payment_attempts')
        .selectAll()
        .where((eb) => needsLook(eb));
      if (filter.mode !== undefined) query = query.where('mode', '=', filter.mode);
      if (filter.provider !== undefined) query = query.where('provider', '=', filter.provider);
      const before = filter.before;
      if (before !== undefined) query = query.where((eb) => eb.or([eb('createdAt', '<', before.at), eb.and([eb('createdAt', '=', before.at), eb('id', '<', before.id)])]));
      const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(filter.limit ?? 50).execute();
      return rows.map(decodeAttempt);
    },

    async countNeedingLook(): Promise<number> {
      const row = await db
        .selectFrom('adminium_payment_attempts')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where((eb) => needsLook(eb))
        .executeTakeFirst();
      return Number(row?.n ?? 0);
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

    /**
     * Events stored before their payment was known (a dispute or refund that
     * outran the settle writing its `paymentRef`), not yet followed: the ones
     * naming this payment, oldest first.
     */
    async unattached(provider: string, mode: string, paymentRef: string): Promise<PaymentEventRow[]> {
      const rows = await db
        .selectFrom('adminium_payment_events')
        .selectAll()
        .where('provider', '=', provider)
        .where('mode', '=', mode)
        .where('paymentRef', '=', paymentRef)
        .where('attemptId', 'is', null)
        .where('processedAt', 'is', null)
        .orderBy('receivedAt', 'asc')
        .limit(50)
        .execute();
      return rows.map(decodeEvent);
    },

    /** Events of a service and mode stored with no payment known, received before `before` and never processed, oldest first. */
    async unattachedWaiting(before: number, scope: { provider: string; mode: string }, limit = 100): Promise<PaymentEventRow[]> {
      const rows = await db
        .selectFrom('adminium_payment_events')
        .selectAll()
        .where('provider', '=', scope.provider)
        .where('mode', '=', scope.mode)
        .where('attemptId', 'is', null)
        .where('processedAt', 'is', null)
        .where('receivedAt', '<', before)
        .orderBy('receivedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decodeEvent);
    },

    /** Marks handled every event stored with no payment known, received before `before`: about money Adminium never held. The rows stay. */
    async giveUpUnattached(before: number, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_payment_events')
        .set({ processedAt: at })
        .where('attemptId', 'is', null)
        .where('processedAt', 'is', null)
        .where('receivedAt', '<', before)
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
    },

    /** Ties an event stored with no payment known to its attempt, once. */
    async attach(id: string, attemptId: string): Promise<boolean> {
      const res = await db.updateTable('adminium_payment_events').set({ attemptId }).where('id', '=', id).where('attemptId', 'is', null).executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * Events about an attempt, received before `before` and never processed:
     * the sweep re-drives them. By service and mode when given; an event about
     * no attempt is never work here.
     */
    async unprocessed(before: number, limit = 100, scope?: { provider: string; mode: string }): Promise<PaymentEventRow[]> {
      let query = db
        .selectFrom('adminium_payment_events')
        .selectAll()
        .where('processedAt', 'is', null)
        .where('attemptId', 'is not', null)
        .where('receivedAt', '<', before);
      if (scope !== undefined) query = query.where('provider', '=', scope.provider).where('mode', '=', scope.mode);
      const rows = await query.orderBy('receivedAt', 'asc').limit(limit).execute();
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
  /** For a payment recorded by hand: the key its form sent; a second insert with it is refused. */
  requestKey?: string | null;
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
        requestKey: input.requestKey ?? null,
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
        if ((input.attemptId !== null || (input.requestKey ?? null) !== null) && isDuplicateKeyError(error)) return null;
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

    /** Sets a payment's refunded amount to the refunds that stand on it (never past what was paid). */
    async setRefunded(id: string, total: string): Promise<boolean> {
      const current = await this.byId(id);
      if (current === null || amountLeft(current.amount, total) === null) return false;
      if (current.refundedAmount === total) return true;
      const res = await db.updateTable('adminium_payments').set({ refundedAmount: total }).where('id', '=', id).executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
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
  source: RefundSource;
  requestedBy: string | null;
  failureMessage: string | null;
  createdAt: number;
  updatedAt: number;
  settledAt: number | null;
  appliedAt: number | null;
  undoneAt: number | null;
  /** What kept the record from following this refund as it should, until it does (or a person checked it). */
  problemCode: RefundProblemCode | null;
  check: AttemptCheck | null;
}

/**
 * Why the record did not follow a refund as it should:
 *   - `NOT_WRITTEN`       writing it failed; it is tried again until it lands (then cleared);
 *   - `RECORD_GONE`       the payment row it refunds is no longer in the record's table;
 *   - `MORE_THAN_PAID`    refunds stand above what was paid: the record shows what was paid, no more;
 *   - `CURRENCY_DIFFERS`  made at the provider in another currency than was paid: not written.
 */
/**
 * Where a refund was made: `staff` asked in Adminium, `provider` made in the
 * provider's own dashboard, `dispute` a dispute lost (the customer's bank took
 * the money back).
 */
export const REFUND_SOURCES = ['staff', 'provider', 'dispute'] as const;
export type RefundSource = (typeof REFUND_SOURCES)[number];

export const REFUND_PROBLEM_CODES = ['NOT_WRITTEN', 'RECORD_GONE', 'MORE_THAN_PAID', 'CURRENCY_DIFFERS'] as const;
export type RefundProblemCode = (typeof REFUND_PROBLEM_CODES)[number];

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
  source: RefundSource;
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
    source: (REFUND_SOURCES as readonly string[]).includes(row.source) ? (row.source as RefundSource) : 'staff',
    requestedBy: row.requestedBy,
    failureMessage: row.failureMessage,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    settledAt: row.settledAt === null ? null : Number(row.settledAt),
    appliedAt: row.appliedAt === null ? null : Number(row.appliedAt),
    undoneAt: row.undoneAt === null ? null : Number(row.undoneAt),
    problemCode: (REFUND_PROBLEM_CODES as readonly string[]).includes(row.problemCode ?? '') ? (row.problemCode as RefundProblemCode) : null,
    check: row.checkedAt === null ? null : { at: Number(row.checkedAt), by: row.checkedBy, note: row.checkNote },
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
        problemCode: null,
        checkedAt: null,
        checkedBy: null,
        checkNote: null,
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

    /**
     * A refund asked here whose answer was lost takes the provider's id an
     * event brought: only while it is still `requested` with none. False when
     * it moved or got an id first.
     */
    async adopt(id: string, providerRefundId: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_refunds')
        .set({ providerRefundId, updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'requested')
        .where('providerRefundId', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * A refund the provider reports that a lost dispute already counted (a
     * PayPal seller who settles a dispute by refunding: "refunded" and
     * "resolved, buyer's favour" are the same money). It is that row: its
     * provider id is set, nothing else moves.
     */
    async adoptForDispute(id: string, providerRefundId: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_refunds')
        .set({ providerRefundId, updatedAt: at })
        .where('id', '=', id)
        .where('source', '=', 'dispute')
        .where('state', '=', 'succeeded')
        .where('providerRefundId', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Notes (or, with null, clears) why the record did not follow. Clearing clears only `only` when given. */
    async setProblem(id: string, code: RefundProblemCode | null, at: number = Date.now(), only?: RefundProblemCode): Promise<boolean> {
      let query = db.updateTable('adminium_refunds').set({ problemCode: code, updatedAt: at }).where('id', '=', id);
      if (code !== null) query = query.where((eb) => eb.or([eb('problemCode', 'is', null), eb('problemCode', '!=', code)]));
      else query = only === undefined ? query.where('problemCode', 'is not', null) : query.where('problemCode', '=', only);
      const res = await query.executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * Refunds the record has not followed yet, on payments already written
     * down: done but not applied, or failed after being applied and not yet
     * undone. A problem a person must look at (the row gone) is not retried.
     */
    async unfollowed(limit = 100): Promise<RefundRow[]> {
      const rows = await db
        .selectFrom('adminium_refunds as r')
        .innerJoin('adminium_payment_attempts as a', 'a.id', 'r.attemptId')
        .selectAll('r')
        .where('a.state', '=', 'recorded')
        .where((eb) =>
          eb.and([
            eb.or([eb('r.problemCode', 'is', null), eb('r.problemCode', '=', 'NOT_WRITTEN')]),
            eb.or([
              eb.and([eb('r.state', '=', 'succeeded'), eb('r.appliedAt', 'is', null)]),
              eb.and([eb('r.state', '=', 'failed'), eb('r.appliedAt', 'is not', null), eb('r.undoneAt', 'is', null)]),
            ]),
          ]),
        )
        .orderBy('r.updatedAt', 'asc')
        .orderBy('r.id', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decodeRefund);
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

    /** Refunds still on their way (requested, pending, waiting for the customer), the longest-waiting first. */
    async waiting(before: number, limit = 100): Promise<RefundRow[]> {
      const rows = await db
        .selectFrom('adminium_refunds')
        .selectAll()
        .where('state', 'in', ['requested', 'pending', 'requires_action'])
        .where('updatedAt', '<', before)
        .orderBy('updatedAt', 'asc')
        .orderBy('id', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decodeRefund);
    },

    /** The refunds of one attempt, oldest first. */
    async forAttempt(attemptId: string): Promise<RefundRow[]> {
      const rows = await db.selectFrom('adminium_refunds').selectAll().where('attemptId', '=', attemptId).orderBy('createdAt', 'asc').orderBy('id', 'asc').execute();
      return rows.map(decodeRefund);
    },

    /** "Mark as checked" in Activity: a refund made at the provider (or one the record did not follow), looked at by a person. */
    async check(id: string, by: string | null, note: string | null, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_refunds')
        .set({ checkedAt: at, checkedBy: by, checkNote: note, updatedAt: at })
        .where('id', '=', id)
        .where('checkedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Refunds, newest first, for Activity. */
    async list(filter: { mode?: 'test' | 'live'; provider?: string; before?: number | { at: number; id: string }; limit?: number; needingLook?: boolean } = {}): Promise<RefundRow[]> {
      let query = db.selectFrom('adminium_refunds').selectAll();
      if (filter.mode !== undefined) query = query.where('mode', '=', filter.mode);
      if (filter.provider !== undefined) query = query.where('provider', '=', filter.provider);
      // A refund made at the provider or by a lost dispute, or one the record did not follow, is shown to a person until they check it.
      if (filter.needingLook === true) query = query.where((eb) => eb.or([eb('source', 'in', ['provider', 'dispute']), eb('problemCode', 'is not', null)])).where('checkedAt', 'is', null);
      const before = filter.before;
      if (typeof before === 'number') query = query.where('createdAt', '<', before);
      else if (before !== undefined) query = query.where((eb) => eb.or([eb('createdAt', '<', before.at), eb.and([eb('createdAt', '=', before.at), eb('id', '<', before.id)])]));
      const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(filter.limit ?? 50).execute();
      return rows.map(decodeRefund);
    },

    async countNeedingLook(): Promise<number> {
      const row = await db
        .selectFrom('adminium_refunds')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where((eb) => eb.or([eb('source', 'in', ['provider', 'dispute']), eb('problemCode', 'is not', null)]))
        .where('checkedAt', 'is', null)
        .executeTakeFirst();
      return Number(row?.n ?? 0);
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
