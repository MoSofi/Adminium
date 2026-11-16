// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Refunds, for a signed-in person who may refund (never an API key).
 *
 *   GET  /payments/attempts/:id/refund   what the refund dialog needs: what may
 *                                        still be refunded, where it goes back to,
 *                                        or why it cannot be refunded now
 *   POST /payments/refunds               the confirm step: one refund, under the
 *                                        key the dialog minted at that step
 *
 * Both reach the payment's record the way the Payment panel does: a table
 * record only under the person's own row limits, one they do not reach
 * answering as a payment that is not there. A record since deleted, and an
 * invoice made on the Invoices page, have no row to limit by.
 *
 * What a refund does, and why each refusal, is `payments/refunds.ts`.
 */
import { REFUND_REASONS } from '@adminium/add-on-contracts';
import { REFUND_SOURCES, paymentAttemptsRepo, refundsRepo, usersRepo, type PaymentAttempt, type RefundRow } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited, auditExempt } from '../../audit/coverage.js';
import { fetchVisible } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { mayRefundPayment, refundsKeptInApp } from '../../payments/app-refund-queue.js';
import { pkOfRowKey } from '../../payments/payables.js';
import { refundableOf, refundRefusalOf, requestRefund, type RefundDeps } from '../../payments/refunds.js';
import { createPublicViews } from '../../public-api/runtime.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { tagRoutes } from '../../security/route-audience.js';
import type { PermissionSet } from '../../rbac/resolver.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
const refundBody = z
  .object({
    attemptId: z.string().min(1).max(64),
    amount: z.string().regex(/^\d{1,15}(\.\d{1,6})?$/),
    reason: z.enum(REFUND_REASONS),
    note: z.string().trim().max(500).nullable(),
    /** Minted by the dialog at its confirm step. */
    key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  })
  .strict();

export const refundView = z.object({
  id: z.string(),
  attemptId: z.string().nullable(),
  amount: z.string(),
  currency: z.string(),
  state: z.enum(['requested', 'pending', 'requires_action', 'succeeded', 'failed', 'cancelled']),
  /** `staff`: asked in Adminium; `provider`: made in the provider's own dashboard; `dispute`: a lost dispute gave it back. */
  source: z.enum(REFUND_SOURCES),
  failureMessage: z.string().nullable(),
  createdAt: z.number(),
  settledAt: z.number().nullable(),
  /**
   * Who asked for it and why, told only to someone who may see payments or
   * refund this one (absent otherwise): the person's name (null when no
   * person asked — a refund made by itself, in the service's dashboard, or by
   * a lost dispute), the reason picked and the note typed.
   */
  by: z.string().nullable().optional(),
  reason: z.enum(REFUND_REASONS).nullable().optional(),
  note: z.string().nullable().optional(),
});

/** Who a refund's person is, by id: what {@link refundViewOf} names them with. Null for someone no longer here. */
export type RefundNames = (userId: string) => Promise<string | null>;

/** Who a refund's person is, from the meta store's people. */
export function refundNamesOf(meta: RefundDeps['meta']): RefundNames {
  const cache = new Map<string, Promise<string | null>>();
  return (userId) => {
    let found = cache.get(userId);
    if (found === undefined) {
      found = usersRepo(meta)
        .findById(userId)
        .then((user) => (user === null ? null : user.name));
      cache.set(userId, found);
    }
    return found;
  };
}

const previewReply = z.object({
  data: z.object({
    label: z.string(),
    provider: z.string(),
    test: z.boolean(),
    taken: z.string(),
    currency: z.string(),
    refundable: z.string(),
    paidWith: z.string().nullable(),
    refusal: z.object({ code: z.string(), message: z.string() }).nullable(),
    /** Refunded in its app, where its refund rows are kept: the app, and the staff screen a refund is made on. */
    inApp: z.object({ app: z.string().nullable(), openIn: z.string().nullable() }).nullable(),
  }),
});
const refundReply = z.object({ data: z.object({ refund: refundView, fresh: z.boolean() }) });

export function refundViewOf(refund: RefundRow): z.infer<typeof refundView> {
  return {
    id: refund.id,
    attemptId: refund.attemptId,
    amount: refund.amount,
    currency: refund.currency,
    state: refund.state,
    source: refund.source,
    failureMessage: refund.failureMessage,
    createdAt: refund.createdAt,
    settledAt: refund.settledAt,
  };
}

/** A refund with who asked for it and why: for someone who may see payments, or refund this one. */
export async function toldRefundViewOf(refund: RefundRow, names: RefundNames): Promise<z.infer<typeof refundView>> {
  const reason = (REFUND_REASONS as readonly string[]).includes(refund.reason) ? (refund.reason as (typeof REFUND_REASONS)[number]) : null;
  // A refund asked in Adminium names its person, reason and note; one made by itself, in the service's dashboard, by a
  // lost dispute or from an app's own refund row (which keeps its own) names none here.
  const asked = refund.source === 'staff';
  const by = !asked || refund.requestedBy === null ? null : await names(refund.requestedBy);
  return { ...refundViewOf(refund), by, reason: asked ? reason : null, note: asked ? refund.note : null };
}

function personOf(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('A refund is made by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

export function paymentRefundRoutes(deps: RefundDeps): FastifyPluginAsyncZod {
  const views = createPublicViews(deps.meta);

  /** The payment, when this person reaches its record; refuses (or answers "no such payment") otherwise. */
  /** The install's refund right, or the app's own for a payment of its records: a 403 otherwise. */
  async function mayRefundOrRefuse(request: FastifyRequest, attempt: PaymentAttempt): Promise<void> {
    if (!(await mayRefundPayment(deps.meta, request, attempt.payable))) throw new ForbiddenError('Refunding needs the right to refund payments.', 'FORBIDDEN', { permission: PERMISSIONS.paymentsRefund });
  }

  async function reachable(request: FastifyRequest, attemptId: string): Promise<PaymentAttempt> {
    const attempt = await paymentAttemptsRepo(deps.meta).byId(attemptId);
    if (attempt === null) throw new NotFoundError('No such payment.');
    const { connectionId, tableName, rowKey } = attempt.payable;
    if (attempt.payable.kind === 'document' || connectionId === null || tableName === null) return attempt;
    const found = await deps.sources.table(connectionId, tableName);
    // The table is gone: no row is left to limit by.
    if (found === null) return attempt;
    const table = found.table;
    if (!(await request.can(`table:${connectionId}:${table.id}:read`))) throw new ForbiddenError('You may not read the record this payment was for.', 'TABLE_FORBIDDEN');
    const pk = pkOfRowKey(table, rowKey);
    if (pk === null) return attempt;
    const byKey = () => found.target.db.selectFrom(table.id).selectAll().where((eb) => eb.and(Object.entries(pk).map(([column, value]) => eb(found.target.db.dynamic.ref(column), '=', value)))).executeTakeFirst();
    // When the row limits cannot be worked out, nothing is refunded: never past them.
    const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
    const view = await views.viewFor(connectionId);
    if (set === undefined || view === null || !view.model.tables.some((one) => one.id === table.id)) {
      throw new ForbiddenError('You may not refund this payment: which records you may see cannot be worked out.', 'TABLE_FORBIDDEN');
    }
    const context = await rowLimitContextOf(deps.meta, set, connectionId, view.model);
    if (context === null) return attempt;
    if ((await fetchVisible(context, found.target.db, table, pk, 'read')) !== undefined) return attempt;
    // Hidden by the person's row limits: answered as a payment that is not there. A row deleted since is no one's to hide.
    if ((await byKey()) !== undefined) throw new NotFoundError('No such payment.');
    return attempt;
  }

  return async (app) => {
    // For the instance's own people, not the public: kept while the public pages are hidden (`security/route-audience.ts`).
    tagRoutes(app, 'staff');
    app.get(
      '/payments/attempts/:id/refund',
      { config: { audit: auditExempt('reading what a refund would do changes nothing') }, schema: { params: idParams, response: { 200: previewReply } } },
      async (request) => {
        personOf(request);
        const attempt = await reachable(request, request.params.id);
        await mayRefundOrRefuse(request, attempt);
        return {
          data: {
            label: attempt.payableLabel,
            provider: attempt.provider,
            test: attempt.mode === 'test',
            taken: attempt.takenAmount ?? '0',
            currency: attempt.takenCurrency ?? attempt.currency,
            refundable: refundableOf(attempt),
            paidWith: (attempt.paidWith as { label?: string } | null)?.label ?? null,
            ...(await (async () => {
              const inApp = await refundsKeptInApp(deps.meta, attempt.payable);
              // Its refunds are the app's own rows: made in the app, never here.
              return { refusal: refundRefusalOf(attempt) ?? (inApp === null ? null : { code: 'IN_APP', message: 'Refund this payment in its app, where its refunds are kept.' }), inApp };
            })()),
          },
        };
      },
    );

    app.post(
      '/payments/refunds',
      { config: { audit: audited('rbac') }, schema: { body: refundBody, response: { 200: refundReply } } },
      async (request) => {
        const by = personOf(request);
        const body = request.body;
        await mayRefundOrRefuse(request, await reachable(request, body.attemptId));
        const answer = await requestRefund(deps, { attemptId: body.attemptId, amount: body.amount, reason: body.reason, note: body.note === '' ? null : body.note, key: body.key, requestedBy: by });
        if (!answer.ok) {
          if (answer.refusal.code === 'KEY_REUSED' || answer.refusal.code === 'BUSY') throw new ConflictError(answer.refusal.message, 'CONFLICT', { reason: answer.refusal.code });
          throw new ValidationFailedError(answer.refusal.message, { reason: answer.refusal.code, ...(answer.refusal.code === 'MORE_THAN_REFUNDABLE' || answer.refusal.code === 'AMOUNT' ? { field: 'amount' } : {}) });
        }
        if (answer.fresh) {
          await app.rbac.audit(request, {
            category: 'payments',
            action: 'payments.refund.requested',
            changes: { after: { refundId: answer.refund.id, attemptId: body.attemptId, amount: answer.refund.amount, currency: answer.refund.currency, reason: body.reason, state: answer.refund.state } },
          });
        }
        // The refund as it stands now (requested, pending, done or failed in the provider's words).
        const now = (await refundsRepo(deps.meta).byId(answer.refund.id)) ?? answer.refund;
        return { data: { refund: await toldRefundViewOf(now, refundNamesOf(deps.meta)), fresh: answer.fresh } };
      },
    );
  };
}
