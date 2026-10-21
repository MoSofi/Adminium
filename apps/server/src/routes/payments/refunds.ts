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
 * What a refund does, and why each refusal, is `payments/refunds.ts`.
 */
import { REFUND_REASONS } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, refundsRepo, type RefundRow } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited, auditExempt } from '../../audit/coverage.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { refundableOf, refundRefusalOf, requestRefund, type RefundDeps } from '../../payments/refunds.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

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
  /** `staff`: asked in Adminium; `provider`: made in the provider's own dashboard. */
  source: z.enum(['staff', 'provider']),
  failureMessage: z.string().nullable(),
  createdAt: z.number(),
  settledAt: z.number().nullable(),
});

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
    source: refund.source === 'provider' ? 'provider' : 'staff',
    failureMessage: refund.failureMessage,
    createdAt: refund.createdAt,
    settledAt: refund.settledAt,
  };
}

function personOf(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('A refund is made by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

export function paymentRefundRoutes(deps: RefundDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/payments/attempts/:id/refund',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsRefund), config: { audit: auditExempt('reading what a refund would do changes nothing') }, schema: { params: idParams, response: { 200: previewReply } } },
      async (request) => {
        personOf(request);
        const attempt = await paymentAttemptsRepo(deps.meta).byId(request.params.id);
        if (attempt === null) throw new NotFoundError('No such payment.');
        return {
          data: {
            label: attempt.payableLabel,
            provider: attempt.provider,
            test: attempt.mode === 'test',
            taken: attempt.takenAmount ?? '0',
            currency: attempt.takenCurrency ?? attempt.currency,
            refundable: refundableOf(attempt),
            paidWith: (attempt.paidWith as { label?: string } | null)?.label ?? null,
            refusal: refundRefusalOf(attempt),
          },
        };
      },
    );

    app.post(
      '/payments/refunds',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsRefund), config: { audit: audited('rbac') }, schema: { body: refundBody, response: { 200: refundReply } } },
      async (request) => {
        const by = personOf(request);
        const body = request.body;
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
        return { data: { refund: refundViewOf(now), fresh: answer.fresh } };
      },
    );
  };
}
