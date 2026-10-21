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
 *   - `mode-mismatch`      the provider reported a test payment for a live attempt
 *                          (or the reverse): not believed, not written;
 *   - `paid-twice`         a payment arrived while another for the same record
 *                          was already on its way: both are written down, and
 *                          someone should see whether one is to be refunded.
 *
 * "Mark as checked" keeps who looked, when and what they wrote; the flag stays
 * visible as checked, never deleted. `payments.view` sees everything and may
 * export it, and acts on nothing.
 */
import { paymentAttemptsRepo, refundsRepo, type MetaDb, type PaymentAttempt, type RefundRow } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export interface PaymentActivityDeps {
  meta: MetaDb;
}

export const ACTIVITY_FLAGS = ['paid-not-recorded', 'amount-differs', 'payable-voided', 'refunded-at-provider', 'mode-mismatch', 'paid-twice'] as const;
export type ActivityFlag = (typeof ACTIVITY_FLAGS)[number];

/** The flags whose "Mark as checked" must say what was found. */
const NOTE_REQUIRED: ReadonlySet<ActivityFlag> = new Set(['paid-not-recorded', 'amount-differs', 'payable-voided', 'mode-mismatch', 'paid-twice']);

const query = z.object({
  mode: z.enum(['test', 'live']).optional(),
  service: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/).optional(),
  /** Only the rows that still need a look. */
  open: z.enum(['1']).optional(),
  before: z.coerce.number().int().positive().optional(),
  /** With `before`: the id of the last row seen, so rows made in the same millisecond are not skipped. */
  beforeId: z.string().min(1).max(64).optional(),
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
  flag: z.object({ code: z.enum(ACTIVITY_FLAGS), reason: z.string().nullable(), message: z.string().nullable() }).nullable(),
  check: z.object({ at: z.number(), by: z.string().nullable(), note: z.string().nullable() }).nullable(),
});
type RowView = z.infer<typeof rowView>;
const listReply = z.object({ data: z.object({ rows: z.array(rowView), more: z.boolean(), next: z.object({ before: z.number(), beforeId: z.string() }).nullable() }) });
const countReply = z.object({ data: z.object({ open: z.number() }) });

const PAGE = 50;

/** The flag an attempt carries, if any. */
export function attemptFlag(attempt: PaymentAttempt): RowView['flag'] {
  const problem = attempt.problem;
  if (problem?.code === 'MODE_MISMATCH') return { code: 'mode-mismatch', reason: problem.code, message: problem.message };
  if (attempt.flaggedAt !== null && attempt.state !== 'record_refused') return { code: 'paid-twice', reason: problem?.code ?? null, message: problem?.message ?? null };
  if (attempt.state !== 'record_refused') return null;
  const code = problem?.code ?? '';
  if (code === 'AMOUNT_DIFFERS' || code === 'CURRENCY_DIFFERS' || code === 'MORE_THAN_DUE') return { code: 'amount-differs', reason: code, message: problem?.message ?? null };
  if (code === 'VOIDED' || code === 'GONE') return { code: 'payable-voided', reason: code, message: problem?.message ?? null };
  return { code: 'paid-not-recorded', reason: code === '' ? null : code, message: problem?.message ?? null };
}

function attemptRow(attempt: PaymentAttempt): RowView {
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
    paidWith: (attempt.paidWith as { label?: string } | null)?.label ?? null,
    flag: attemptFlag(attempt),
    check: attempt.check,
  };
}

function refundRow(refund: RefundRow): RowView {
  return {
    id: refund.id,
    kind: 'refund',
    at: refund.createdAt,
    service: refund.provider,
    mode: refund.mode,
    payable: null,
    amount: refund.amount,
    currency: refund.currency,
    state: refund.state,
    paidWith: null,
    flag: refund.source === 'provider' ? { code: 'refunded-at-provider', reason: null, message: null } : null,
    check: refund.check,
  };
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

  /**
   * One page, newest first, from a `(at, id)` cursor. "Needs a look" is asked
   * of the database, so a flagged row is never lost behind a page of others.
   */
  async function rows(filter: z.infer<typeof query>, limit: number): Promise<{ rows: RowView[]; more: boolean; next: { before: number; beforeId: string } | null }> {
    const before = filter.before === undefined ? undefined : filter.beforeId === undefined ? filter.before : { at: filter.before, id: filter.beforeId };
    const scope = {
      ...(filter.mode === undefined ? {} : { mode: filter.mode }),
      ...(filter.service === undefined ? {} : { provider: filter.service }),
      limit: limit + 1,
    };
    const open = filter.open !== undefined;
    const cursor = before === undefined ? {} : { before: typeof before === 'number' ? { at: before, id: '' } : before };
    const attemptRows = open ? await attempts.needingLook({ ...scope, ...cursor }) : await attempts.list({ ...scope, ...(before === undefined ? {} : { before }) });
    const refundRows = await refunds.list({ ...scope, ...(before === undefined ? {} : { before }), ...(open ? { needingLook: true } : {}) });
    const found = [...attemptRows.map(attemptRow), ...refundRows.map(refundRow)]
      .filter((row) => !open || row.flag !== null)
      .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    const page = found.slice(0, limit);
    const last = page.at(-1);
    const more = found.length > limit;
    return { rows: page, more, next: more && last !== undefined ? { before: last.at, beforeId: last.id } : null };
  }

  return async (app) => {
    app.get('/payments/activity', { schema: { querystring: query, response: { 200: listReply } } }, async (request) => {
      await mayRead(request);
      return { data: await rows(request.query, PAGE) };
    });

    app.get('/payments/activity/count', { schema: { response: { 200: countReply } } }, async (request) => {
      await mayRead(request);
      // The badge on the Payments entry: every row that still needs a look, test ones too, counted in the database.
      const open = (await attempts.countNeedingLook()) + (await refunds.countNeedingLook());
      return { data: { open } };
    });

    app.get('/payments/activity.csv', { schema: { querystring: query } }, async (request, reply) => {
      await mayRead(request);
      const header = ['when', 'kind', 'service', 'mode', 'record', 'amount', 'currency', 'state', 'paid with', 'needs a look', 'checked', 'note'];
      const lines = [header.join(',')];
      let cursor: { before: number; beforeId?: string } | null = request.query.before === undefined ? null : { before: request.query.before, ...(request.query.beforeId === undefined ? {} : { beforeId: request.query.beforeId }) };
      for (let page = 0; page < 200; page += 1) {
        const { rows: found, more, next } = await rows({ ...request.query, ...(cursor ?? {}) }, 500);
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
        const flag = attemptFlag(attempt);
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
        if (refund.source !== 'provider') throw new ValidationFailedError('This refund needs no look.');
        if (!(await refunds.check(refund.id, by, request.body.note, app.rbac.now()))) throw new ConflictError('Someone marked this as checked already.');
        await app.rbac.audit(request, { category: 'payments', action: 'payments.flag.checked', changes: { after: { refundId: refund.id, flag: 'refunded-at-provider', note: request.body.note } } });
        return reply.status(204).send();
      },
    );
  };
}
