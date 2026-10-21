// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Activity: every attempt and refund, the ones that need
 * a person flagged, and a CSV of it all.
 *
 * A row needs a look when money moved and something did not follow:
 *
 *   - `paid-not-recorded`  the provider took it; Adminium could not write it
 *                          down (a table rule refused, the record's table is gone);
 *   - `amount-differs`     what was taken is not what was asked, or more than is due;
 *   - `payable-voided`     the invoice was voided (or the row deleted) after the
 *                          customer paid;
 *   - `refunded-at-provider` a refund made in the provider's own dashboard: it is
 *                          recorded, and someone should know;
 *   - `refund-record`      the record did not follow a refund as it should (the
 *                          write keeps failing, its payment row is gone, refunds
 *                          stand above what was paid, another currency);
 *   - `mode-mismatch`      the provider reported a test payment for a live attempt
 *                          (or the reverse): not believed, not written;
 *   - `paid-twice`         a payment arrived while another for the same record
 *                          was already on its way: both are written down, and
 *                          someone should see whether one is to be refunded;
 *   - `waiting-long`       a payment has waited for the bank longer than
 *                          `WAITING_LONG_MS` (a direct debit's few days became weeks);
 *   - `record-changed`     a payment that was written down changed or went
 *                          missing afterwards (the integrity check flags it);
 *   - `disputed`           the customer's bank opened a dispute: it is answered
 *                          in the provider's own dashboard. Checked once per
 *                          dispute: one opened again needs a look again.
 *
 * Each row carries what a person needs to read its story without another
 * call: what was asked and what was taken, when it started, settled and was
 * written down, the ids at the payment service, the way it was paid, and the
 * name of whoever checked it.
 * "Mark as checked" keeps who looked, when and what they wrote; the flag stays
 * visible as checked, never deleted. `payments.view` sees everything and may
 * export it, and acts on nothing.
 */
import { paymentAttemptsRepo, refundsRepo, usersRepo, type AttemptState, type MetaDb, type PaymentAttempt, type RefundRow, type RefundRowState } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { refundableOf, refundRefusalOf } from '../../payments/refunds.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export interface PaymentActivityDeps {
  meta: MetaDb;
}

export const ACTIVITY_FLAGS = ['paid-not-recorded', 'amount-differs', 'payable-voided', 'refunded-at-provider', 'refund-record', 'mode-mismatch', 'paid-twice', 'waiting-long', 'record-changed', 'disputed'] as const;
export type ActivityFlag = (typeof ACTIVITY_FLAGS)[number];

/** The flags whose "Mark as checked" must say what was found. */
export const NOTE_REQUIRED: ReadonlySet<ActivityFlag> = new Set(['paid-not-recorded', 'amount-differs', 'payable-voided', 'refund-record', 'mode-mismatch', 'paid-twice', 'record-changed']);

/** How long a payment may wait for the bank before it needs a look (a direct debit takes up to a week). */
export const WAITING_LONG_MS = 14 * 86_400_000;

/** The state groups a person reads and filters by. */
export const STATE_GROUPS = ['started', 'paid', 'waiting', 'failed', 'expired', 'refunded', 'refundFailed', 'disputed'] as const;
export type StateGroup = (typeof STATE_GROUPS)[number];

const ATTEMPT_GROUP: Readonly<Record<AttemptState, StateGroup>> = {
  creating: 'started',
  open: 'started',
  processing: 'waiting',
  succeeded: 'paid',
  recording: 'paid',
  recorded: 'paid',
  // Money was taken: the row reads as paid, and its flag says it was not written down.
  record_refused: 'paid',
  failed: 'failed',
  expired: 'expired',
  cancelled: 'expired',
  abandoned: 'expired',
};

const REFUND_GROUP: Readonly<Record<RefundRowState, StateGroup>> = {
  requested: 'started',
  pending: 'started',
  requires_action: 'started',
  succeeded: 'refunded',
  failed: 'refundFailed',
  cancelled: 'refundFailed',
};

const ATTEMPT_STATES_OF: Readonly<Record<StateGroup, readonly AttemptState[]>> = {
  started: ['creating', 'open'],
  waiting: ['processing'],
  paid: ['succeeded', 'recording', 'recorded', 'record_refused'],
  failed: ['failed'],
  expired: ['expired', 'cancelled', 'abandoned'],
  refunded: [],
  refundFailed: [],
  // An attempt reads as disputed while its dispute is open, whatever its state: asked of the database apart.
  disputed: [],
};

const query = z.object({
  mode: z.enum(['test', 'live']).optional(),
  service: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/).optional(),
  /** Only the rows that still need a look. */
  open: z.enum(['1']).optional(),
  before: z.coerce.number().int().positive().optional(),
  /** With `before`: the id of the last row seen, so rows made in the same millisecond are not skipped. */
  beforeId: z.string().min(1).max(64).optional(),
  /** One state group (`paid`, `waiting`, …). */
  state: z.enum(STATE_GROUPS).optional(),
  /** The way it was paid, by the service's method id (`card`, `sepa_debit`, `paypal`). */
  way: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).optional(),
  /** First and last day, `YYYY-MM-DD`, in UTC. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const idParams = z.object({ id: z.string().min(1).max(64) });
const checkBody = z.object({ note: z.string().trim().max(500).nullable() });

const rowView = z.object({
  id: z.string(),
  kind: z.enum(['attempt', 'refund']),
  at: z.number(),
  service: z.string(),
  mode: z.enum(['test', 'live']),
  payable: z.object({ kind: z.string(), connectionId: z.string().nullable(), tableName: z.string().nullable(), rowKey: z.string(), label: z.string().nullable() }).nullable(),
  amount: z.string(),
  currency: z.string(),
  state: z.string(),
  paidWith: z.string().nullable(),
  /** The service's method id the payment went by, when known. */
  way: z.string().nullable(),
  group: z.enum(STATE_GROUPS),
  /** What was asked, beside `amount` (what was taken, once it was). */
  asked: z.object({ amount: z.string(), currency: z.string() }),
  /** The moments of its story. */
  times: z.object({ started: z.number(), settled: z.number().nullable(), recorded: z.number().nullable(), updated: z.number() }),
  /** Ids a person may quote to the payment service, or look up. */
  refs: z.object({ attempt: z.string().nullable(), checkout: z.string().nullable(), payment: z.string().nullable(), refund: z.string().nullable() }),
  /** A refund: made in Adminium (`staff`) or in the service's own dashboard (`provider`). */
  refundSource: z.enum(['staff', 'provider']).nullable(),
  flag: z.object({ code: z.enum(ACTIVITY_FLAGS), reason: z.string().nullable(), message: z.string().nullable() }).nullable(),
  check: z.object({ at: z.number(), by: z.string().nullable(), byName: z.string().nullable(), note: z.string().nullable() }).nullable(),
  /** An attempt that took money: what may still be refunded, and why nothing may now. Null on a refund row. */
  refund: z.object({ refundable: z.string(), refusal: z.object({ code: z.string(), message: z.string() }).nullable() }).nullable(),
  /** A dispute the provider told of. Its deadline, amount and outcome are read in the provider's dashboard. */
  dispute: z.object({ state: z.enum(['open', 'closed']), at: z.number(), closedAt: z.number().nullable() }).nullable(),
});
type RowView = z.infer<typeof rowView>;
const listReply = z.object({ data: z.object({ rows: z.array(rowView), more: z.boolean(), next: z.object({ before: z.number(), beforeId: z.string() }).nullable() }) });
const countReply = z.object({ data: z.object({ open: z.number() }) });

const PAGE = 50;

/** The flag an attempt carries, if any; `now` decides how long a payment has waited for the bank. */
export function attemptFlag(attempt: PaymentAttempt, now: number = Date.now()): RowView['flag'] {
  const problem = attempt.problem;
  if (attempt.dispute?.state === 'open') return { code: 'disputed', reason: null, message: null };
  if (problem?.code === 'MODE_MISMATCH') return { code: 'mode-mismatch', reason: problem.code, message: problem.message };
  if (attempt.flaggedAt !== null && attempt.state !== 'record_refused') {
    if (problem?.code === 'TWO_AT_ONCE') return { code: 'paid-twice', reason: problem.code, message: problem.message };
    return { code: 'record-changed', reason: problem?.code ?? null, message: problem?.message ?? null };
  }
  if (attempt.state === 'processing' && now - attempt.createdAt > WAITING_LONG_MS) return { code: 'waiting-long', reason: null, message: null };
  if (attempt.state !== 'record_refused') return null;
  const code = problem?.code ?? '';
  if (code === 'AMOUNT_DIFFERS' || code === 'CURRENCY_DIFFERS' || code === 'MORE_THAN_DUE') return { code: 'amount-differs', reason: code, message: problem?.message ?? null };
  if (code === 'VOIDED' || code === 'GONE') return { code: 'payable-voided', reason: code, message: problem?.message ?? null };
  return { code: 'paid-not-recorded', reason: code === '' ? null : code, message: problem?.message ?? null };
}

type Names = ReadonlyMap<string, string>;

function checkView(check: PaymentAttempt['check'], names: Names): RowView['check'] {
  return check === null ? null : { ...check, byName: check.by === null ? null : (names.get(check.by) ?? null) };
}

/** The states in which an attempt took money. */
const TOOK_MONEY: ReadonlySet<AttemptState> = new Set(['succeeded', 'recording', 'recorded', 'record_refused']);

function attemptRow(attempt: PaymentAttempt, names: Names, now: number): RowView {
  const paidWith = attempt.paidWith as { label?: string; method?: string } | null;
  const flag = attemptFlag(attempt, now);
  // A check from before the dispute opened is not a look at the dispute.
  const check = flag?.code === 'disputed' && attempt.check !== null && attempt.check.at < (attempt.dispute?.at ?? 0) ? null : checkView(attempt.check, names);
  return {
    id: attempt.id,
    kind: 'attempt',
    at: attempt.createdAt,
    service: attempt.provider,
    mode: attempt.mode,
    payable: { ...attempt.payable, label: attempt.payableLabel },
    amount: attempt.takenAmount ?? attempt.amount,
    currency: attempt.takenCurrency ?? attempt.currency,
    state: attempt.state,
    paidWith: paidWith?.label ?? null,
    way: paidWith?.method ?? null,
    group: attempt.dispute?.state === 'open' ? 'disputed' : ATTEMPT_GROUP[attempt.state],
    asked: { amount: attempt.amount, currency: attempt.currency },
    times: { started: attempt.createdAt, settled: attempt.settledAt, recorded: attempt.recordedAt, updated: attempt.updatedAt },
    refs: { attempt: attempt.id, checkout: attempt.providerRef, payment: attempt.paymentRef, refund: null },
    refundSource: null,
    flag,
    check,
    refund: TOOK_MONEY.has(attempt.state) && attempt.takenAmount !== null ? { refundable: refundableOf(attempt), refusal: refundRefusalOf(attempt) } : null,
    dispute: attempt.dispute,
  };
}

/** A refund's flag: what kept the record from following it first, then one made at the provider. */
export function refundFlag(refund: RefundRow): RowView['flag'] {
  if (refund.problemCode !== null) return { code: 'refund-record', reason: refund.problemCode, message: null };
  return refund.source === 'provider' ? { code: 'refunded-at-provider', reason: null, message: null } : null;
}

function refundRow(refund: RefundRow, of: PaymentAttempt | null, names: Names): RowView {
  return {
    id: refund.id,
    kind: 'refund',
    at: refund.createdAt,
    service: refund.provider,
    mode: refund.mode,
    // The record it gave money back on, when it came from an attempt Adminium made.
    payable: of === null ? null : { ...of.payable, label: of.payableLabel },
    amount: refund.amount,
    currency: refund.currency,
    state: refund.state,
    paidWith: of === null ? null : ((of.paidWith as { label?: string } | null)?.label ?? null),
    way: of === null ? null : ((of.paidWith as { method?: string } | null)?.method ?? null),
    group: REFUND_GROUP[refund.state],
    asked: { amount: refund.amount, currency: refund.currency },
    times: { started: refund.createdAt, settled: refund.settledAt, recorded: refund.appliedAt, updated: refund.updatedAt },
    refs: { attempt: refund.attemptId, checkout: null, payment: refund.paymentRef, refund: refund.providerRefundId },
    refundSource: refund.source,
    flag: refundFlag(refund),
    check: checkView(refund.check, names),
    refund: null,
    dispute: null,
  };
}

/** `YYYY-MM-DD` → the first millisecond of that day, or of the next one, in UTC. */
function dayStart(day: string, next = false): number {
  return Date.parse(`${day}T00:00:00Z`) + (next ? 86_400_000 : 0);
}

/** One CSV field, quoted when it must be, and never read as a formula by a spreadsheet. */
function csvField(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function requirePerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('Activity is acted on by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

export function paymentActivityRoutes(deps: PaymentActivityDeps): FastifyPluginAsyncZod {
  const attempts = paymentAttemptsRepo(deps.meta);
  const refunds = refundsRepo(deps.meta);

  async function mayRead(request: FastifyRequest): Promise<void> {
    if (!((await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView)))) {
      throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
    }
  }

  /** The names of the people who checked these, read once per page. */
  async function namesOf(ids: readonly (string | null)[]): Promise<Names> {
    const names = new Map<string, string>();
    for (const id of new Set(ids.filter((one): one is string => one !== null))) {
      const user = await usersRepo(deps.meta).findById(id);
      if (user !== null) names.set(id, user.name?.trim() || user.email);
    }
    return names;
  }

  /** The attempts the refunds came from, read once per page. */
  async function attemptsOf(found: readonly RefundRow[]): Promise<Map<string, PaymentAttempt>> {
    const out = new Map<string, PaymentAttempt>();
    for (const id of new Set(found.map((refund) => refund.attemptId).filter((one): one is string => one !== null))) {
      const one = await attempts.byId(id);
      if (one !== null) out.set(id, one);
    }
    return out;
  }

  /** Payments with a dispute open (few, ever): asked of the database apart, narrowed here. */
  async function disputedNow(filter: { mode?: 'test' | 'live'; provider?: string }, before: { at: number; id: string } | undefined): Promise<PaymentAttempt[]> {
    return (await attempts.disputed('open', 500)).filter(
      (attempt) =>
        (filter.mode === undefined || attempt.mode === filter.mode) &&
        (filter.provider === undefined || attempt.provider === filter.provider) &&
        (before === undefined || attempt.createdAt < before.at || (attempt.createdAt === before.at && attempt.id < before.id)),
    );
  }

  /** Payments waiting for the bank so long they need a look, unchecked: asked of the database by state. */
  async function waitingLong(filter: { mode?: 'test' | 'live'; provider?: string }, now: number): Promise<PaymentAttempt[]> {
    const waiting = await attempts.list({ ...filter, states: ['processing'], before: now - WAITING_LONG_MS, limit: 500 });
    return waiting.filter((attempt) => attempt.check === null);
  }

  /**
   * One page, newest first, from a `(at, id)` cursor. "Needs a look" is asked
   * of the database, so a flagged row is never lost behind a page of others.
   * The state, the way and the days narrow it; a narrowing the database
   * cannot do (the way, kept in a JSON column) reads on, page by page.
   */
  async function rows(filter: z.infer<typeof query>, limit: number, now: number): Promise<{ rows: RowView[]; more: boolean; next: { before: number; beforeId: string } | null }> {
    const open = filter.open !== undefined;
    const fromAt = filter.from === undefined ? null : dayStart(filter.from);
    const scope = {
      ...(filter.mode === undefined ? {} : { mode: filter.mode }),
      ...(filter.service === undefined ? {} : { provider: filter.service }),
    };
    const group = filter.state;
    const wantAttempts = group === undefined || group === 'disputed' || ATTEMPT_STATES_OF[group].length > 0;
    const wantRefunds = group === undefined || group === 'refunded' || group === 'refundFailed' || group === 'started';
    let cursor: { at: number; id: string } | null =
      filter.before !== undefined ? { at: filter.before, id: filter.beforeId ?? '' } : filter.to !== undefined ? { at: dayStart(filter.to, true), id: '' } : null;
    const keep = (row: RowView): boolean =>
      (!open || (row.flag !== null && row.check === null)) &&
      (group === undefined || row.group === group) &&
      (filter.way === undefined || row.way === filter.way) &&
      (fromAt === null || row.at >= fromAt);
    const out: RowView[] = [];
    let exhausted = false;
    // At most ten reads: a narrow filter over a long history answers with what it found and a cursor to go on.
    for (let read = 0; read < 10 && out.length <= limit; read += 1) {
      const before = cursor === null ? undefined : cursor;
      const batch = limit + 1;
      const states = group === undefined ? undefined : ATTEMPT_STATES_OF[group];
      const attemptRows = !wantAttempts
        ? []
        : group === 'disputed'
          ? await disputedNow(scope, before)
          : open
          ? [...(await attempts.needingLook({ ...scope, ...(before === undefined ? {} : { before }), limit: batch })), ...(await waitingLong(scope, now))]
            : await attempts.list({ ...scope, ...(states === undefined ? {} : { states }), ...(before === undefined ? {} : { before }), limit: batch });
      const refundRows = wantRefunds ? await refunds.list({ ...scope, ...(before === undefined ? {} : { before }), ...(open ? { needingLook: true } : {}), limit: batch }) : [];
      const from = await attemptsOf(refundRows);
      const names = await namesOf([...attemptRows.map((one) => one.check?.by ?? null), ...refundRows.map((one) => one.check?.by ?? null)]);
      const merged = [...new Map([...attemptRows.map((one) => attemptRow(one, names, now)), ...refundRows.map((one) => refundRow(one, one.attemptId === null ? null : (from.get(one.attemptId) ?? null), names))].map((row) => [row.id, row])).values()]
        .filter((row) => cursor === null || row.at < cursor.at || (row.at === cursor.at && row.id < cursor.id))
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
        .slice(0, batch);
      if (merged.length === 0) {
        exhausted = true;
        break;
      }
      for (const row of merged) if (keep(row)) out.push(row);
      const last = merged.at(-1)!;
      cursor = { at: last.at, id: last.id };
      // Older than the first day asked for: nothing further can match.
      if (fromAt !== null && last.at < fromAt) {
        exhausted = true;
        break;
      }
      if (merged.length < batch) {
        exhausted = true;
        break;
      }
    }
    const page = out.slice(0, limit);
    const more = out.length > limit || (!exhausted && cursor !== null);
    const lastShown = out.length > limit ? page.at(-1) : undefined;
    const next = !more ? null : lastShown !== undefined ? { before: lastShown.at, beforeId: lastShown.id } : cursor === null ? null : { before: cursor.at, beforeId: cursor.id };
    return { rows: page, more: next !== null, next };
  }

  return async (app) => {
    app.get('/payments/activity', { schema: { querystring: query, response: { 200: listReply } } }, async (request) => {
      await mayRead(request);
      return { data: await rows(request.query, PAGE, app.rbac.now()) };
    });

    app.get('/payments/activity/count', { schema: { response: { 200: countReply } } }, async (request) => {
      await mayRead(request);
      // The badge on the Payments entry: every row that still needs a look, test ones too, counted in the database.
      const open = (await attempts.countNeedingLook()) + (await refunds.countNeedingLook()) + (await waitingLong({}, app.rbac.now())).length;
      return { data: { open } };
    });

    app.get('/payments/activity.csv', { schema: { querystring: query } }, async (request, reply) => {
      await mayRead(request);
      const header = ['when', 'kind', 'service', 'mode', 'record', 'amount', 'currency', 'state', 'paid with', 'needs a look', 'checked', 'note'];
      const lines = [header.join(',')];
      let cursor: { before: number; beforeId?: string } | null = request.query.before === undefined ? null : { before: request.query.before, ...(request.query.beforeId === undefined ? {} : { beforeId: request.query.beforeId }) };
      for (let page = 0; page < 200; page += 1) {
        const { rows: found, more, next } = await rows({ ...request.query, ...(cursor ?? {}) }, 500, app.rbac.now());
        for (const row of found) {
          lines.push(
            [new Date(row.at).toISOString(), row.kind, row.service, row.mode, row.payable?.label ?? null, row.amount, row.currency, row.state, row.paidWith, row.flag?.code ?? null, row.check === null ? null : new Date(row.check.at).toISOString(), row.check?.note ?? null]
              .map(csvField)
              .join(','),
          );
        }
        if (!more || next === null) break;
        cursor = next;
      }
      await app.rbac.audit(request, { category: 'payments', action: 'payments.activity.exported', changes: { after: { rows: lines.length - 1, mode: request.query.mode ?? null } } });
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="payments-activity.csv"').header('cache-control', 'no-store').send(`${lines.join('\r\n')}\r\n`);
    });

    app.post(
      '/payments/activity/attempts/:id/check',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { params: idParams, body: checkBody } },
      async (request, reply) => {
        const by = requirePerson(request);
        const attempt = await attempts.byId(request.params.id);
        if (attempt === null) throw new NotFoundError('No such payment attempt.');
        const flag = attemptFlag(attempt, app.rbac.now());
        if (flag === null) throw new ValidationFailedError('This attempt needs no look.');
        if (NOTE_REQUIRED.has(flag.code) && (request.body.note ?? '') === '') throw new ValidationFailedError('Say what you checked.', { field: 'note' });
        if (!(await attempts.check(attempt.id, by, request.body.note, app.rbac.now()))) throw new ConflictError('Someone marked this as checked already.');
        await app.rbac.audit(request, { category: 'payments', action: 'payments.flag.checked', changes: { after: { attemptId: attempt.id, flag: flag.code, note: request.body.note } } });
        return reply.status(204).send();
      },
    );

    app.post(
      '/payments/activity/refunds/:id/check',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { params: idParams, body: checkBody } },
      async (request, reply) => {
        const by = requirePerson(request);
        const refund = await refunds.byId(request.params.id);
        if (refund === null) throw new NotFoundError('No such refund.');
        const flag = refundFlag(refund);
        if (flag === null) throw new ValidationFailedError('This refund needs no look.');
        if (NOTE_REQUIRED.has(flag.code) && (request.body.note ?? '') === '') throw new ValidationFailedError('Say what you checked.', { field: 'note' });
        if (!(await refunds.check(refund.id, by, request.body.note, app.rbac.now()))) throw new ConflictError('Someone marked this as checked already.');
        await app.rbac.audit(request, { category: 'payments', action: 'payments.flag.checked', changes: { after: { refundId: refund.id, flag: flag.code, note: request.body.note } } });
        return reply.status(204).send();
      },
    );
  };
}
