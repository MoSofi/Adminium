// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Staff: "Send a test payment" and the pay page's full preview.
 *
 *   POST /payments/test-payments          a throwaway payable of one unit for one
 *                                         service, and a test link to it
 *   GET  /payments/test-payments/:rowKey  the round trip: what the service took,
 *                                         whether the webhook arrived, and what
 *                                         would have been recorded
 *
 * The service is a ready payment add-on in test mode, or `demo` (the pretend
 * service, no account needed: that is the full preview). The link is a test
 * link on the host the person is signed in on, so it opens for them and for
 * nobody else. Nothing is written to any table: test payments are kept in
 * meta, marked test.
 */
import { keptPaymentsRepo, paymentAttemptsRepo, type MetaDb, type PaymentAttempt } from '@adminium/meta';
import { currencyScale } from '@adminium/manifest';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited, auditExempt } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { linkSealFromSecret, mintLink, payUrl } from '../../payments/links.js';
import { createTestPayable, oneUnit, readTestPayable, TEST_PAYABLE_PREFIX } from '../../payments/test-payables.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export interface TestPaymentsDeps {
  meta: MetaDb;
  secret: string;
  /** The payment add-ons that can take a checkout in test mode now. */
  readyInTest: () => Promise<string[]>;
  /** The currency a test payment is made in when the shop names none. */
  fallbackCurrency?: string;
}

/** A test link lasts an hour: long enough to pay, short enough to be thrown away. */
export const TEST_LINK_LIFETIME_MS = 60 * 60_000;

const startBody = z.object({ service: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/), currency: z.string().regex(/^[A-Z]{3}$/).optional() });
const rowKeyParams = z.object({ rowKey: z.string().startsWith(TEST_PAYABLE_PREFIX).max(64) });

const startReply = z.object({ data: z.object({ rowKey: z.string(), label: z.string(), url: z.string(), amount: z.string(), currency: z.string() }) });
const tripReply = z.object({
  data: z.object({
    label: z.string(),
    service: z.string(),
    amount: z.string(),
    currency: z.string(),
    /** The last attempt's state, or null before the customer pressed pay. */
    state: z.string().nullable(),
    /** What the service says it took, once it did. */
    taken: z.object({ amount: z.string(), currency: z.string() }).nullable(),
    paidWith: z.string().nullable(),
    /** A webhook about this payment reached the server. */
    webhookArrived: z.boolean(),
    /** Kept in meta as a test payment: what a live one would have recorded. */
    recorded: z.boolean(),
  }),
});

function requirePerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('A test payment is made by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

function originOf(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

export function testPaymentsRoutes(deps: TestPaymentsDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const seal = linkSealFromSecret(deps.secret);

  async function latest(rowKey: string): Promise<PaymentAttempt | null> {
    const attempts = await paymentAttemptsRepo(meta).forPayable({ kind: 'document', connectionId: null, tableName: null, rowKey }, 10);
    return attempts.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  async function webhookArrived(attemptId: string): Promise<boolean> {
    const row = await meta.db
      .selectFrom('adminium_payment_events')
      .select('id')
      .where('attemptId', '=', attemptId)
      .where('source', '=', 'webhook')
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  return async (app) => {
    app.post(
      '/payments/test-payments',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { body: startBody, response: { 200: startReply } } },
      async (request) => {
        const by = requirePerson(request);
        const { service } = request.body;
        if (service !== 'demo' && !(await deps.readyInTest()).includes(service)) {
          throw new ValidationFailedError('This service cannot take a test payment yet: save and check its test key first.', { reason: 'not-ready' });
        }
        const currency = request.body.currency ?? deps.fallbackCurrency ?? 'EUR';
        const { ref, payable } = await createTestPayable(meta, { provider: service, currency, amount: oneUnit(currencyScale(currency)), createdBy: by }, app.rbac.now());
        const minted = await mintLink(meta, seal, { payable: ref, mode: 'test', createdBy: by, lifetimeMs: TEST_LINK_LIFETIME_MS }, app.rbac.now());
        await app.rbac.audit(request, { category: 'payments', action: 'payments.test-payment.started', changes: { after: { service, rowKey: ref.rowKey, amount: payable.amount, currency } } });
        return { data: { rowKey: ref.rowKey, label: payable.label, url: payUrl(originOf(request), minted.token), amount: payable.amount, currency } };
      },
    );

    app.get(
      '/payments/test-payments/:rowKey',
      { config: { audit: auditExempt('reading how a test payment went changes nothing') }, schema: { params: rowKeyParams, response: { 200: tripReply } } },
      async (request) => {
        if (!((await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView)))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
        const test = await readTestPayable(meta, request.params.rowKey);
        if (test === null) throw new NotFoundError('No such test payment.');
        const attempt = await latest(request.params.rowKey);
        const ref = { kind: 'document' as const, connectionId: null, tableName: null, rowKey: request.params.rowKey };
        const kept = (await keptPaymentsRepo(meta).forPayable(ref)).filter((row) => row.mode === 'test' && !row.voided);
        return {
          data: {
            label: test.label,
            service: test.provider,
            amount: test.amount,
            currency: test.currency,
            state: attempt?.state ?? null,
            taken: attempt?.takenAmount == null ? null : { amount: attempt.takenAmount, currency: attempt.takenCurrency ?? test.currency },
            paidWith: (attempt?.paidWith as { label?: string } | null)?.label ?? null,
            webhookArrived: attempt === null ? false : await webhookArrived(attempt.id),
            recorded: kept.length > 0,
          },
        };
      },
    );
  };
}
