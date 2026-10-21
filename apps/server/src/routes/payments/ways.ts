// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Ways to pay, and the pay page's own settings.
 *
 * A way to pay is a provider's (one of the ways its account has switched on)
 * or a manual one (a bank transfer, cash on delivery). Each carries rules
 * (countries, currencies, min and max, which payables), and the customer
 * preview answers "a customer in Germany paying €120.00 sees: …" with the
 * same resolver the pay page uses.
 *
 * Bank details are kept per currency on the bank-transfer way. A change of
 * them is where money would go somewhere else, so it is audited under its
 * own action, as a change of a provider's account is.
 *
 * The pay page settings say who the customer is paying (the shop's name and
 * logo, how to reach it, its country) and whether the page lists the
 * invoice's lines. The logo is a raster image only: an SVG on a public page
 * is a script waiting to happen.
 */
import type { PaymentMode } from '@adminium/add-on-contracts';
import {
  PAYABLE_KINDS,
  filesRepo,
  paymentMethodsRepo,
  paymentRulesSchema,
  paymentSettingsRepo,
  settingsRepo,
  type ManifestsRepo,
  type MetaDb,
  type PaymentMethodRow,
} from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { addOnHttpClientFor } from '../../add-ons/egress.js';
import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import { auditExempt, audited } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { paymentProviderFor } from '../../payments/providers.js';
import { paymentAddOnKeys, readyPaymentProviders } from '../../payments/ready.js';
import { emptyServiceState, serviceDocName, serviceStateSchema } from '../../payments/services.js';
import { MANUAL_METHODS, MANUAL_SOURCE, waysFor } from '../../payments/ways.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export interface PaymentWaysDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  runtime: () => AddOnRuntimeState | null;
}

/** The settings document's name for the pay page. */
export const PAY_PAGE_DOC = 'pay-page';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const payPageSchema = z
  .object({
    shopName: z.string().trim().min(1).max(120),
    logoFileId: z.string().min(1).max(64).nullable(),
    contactEmail: z.email().max(254).nullable(),
    contactPhone: z.string().trim().min(3).max(40).nullable(),
    /** The shop's country: the ways' country rules use it when the customer's is not known. */
    shopCountry: z.string().regex(/^[A-Z]{2}$/).nullable(),
    /** Whether the pay page lists the invoice's lines. */
    showLines: z.boolean(),
  })
  .strict();
export type PayPageSettings = z.infer<typeof payPageSchema>;

const bankAccountSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    holder: z.string().trim().min(1).max(140),
    iban: z.string().trim().max(42).nullable(),
    accountNumber: z.string().trim().max(40).nullable(),
    bic: z.string().trim().max(11).nullable(),
    sortCode: z.string().trim().max(20).nullable(),
    bank: z.string().trim().max(140).nullable(),
  })
  .strict()
  .refine((account) => account.iban !== null || account.accountNumber !== null, { message: 'an account needs an IBAN or an account number', path: ['iban'] });

const manualDetailsSchema = z
  .object({
    accounts: z.array(bankAccountSchema).max(20).optional(),
    /** What the customer is told: "Pay when the order arrives." */
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const wayParams = z.object({ source: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/), method: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/) });
const wayBody = z.object({
  enabled: z.boolean(),
  rules: paymentRulesSchema,
  label: z.record(z.string().min(2).max(10), z.string().trim().min(1).max(60)).nullable(),
  details: manualDetailsSchema.nullable(),
  position: z.number().int().min(0).max(1000),
});
const previewBody = z.object({
  country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  kind: z.enum(PAYABLE_KINDS),
  profileId: z.string().min(1).max(64).nullable(),
});

const wayView = z.object({
  source: z.string(),
  method: z.string(),
  label: z.record(z.string(), z.string()).nullable(),
  enabled: z.boolean(),
  rules: paymentRulesSchema,
  details: z.unknown(),
  position: z.number(),
});
const waysReply = z.object({ data: z.object({ ways: z.array(wayView), manualMethods: z.array(z.string()) }) });
const wayReply = z.object({ data: wayView });
const previewReply = z.object({ data: z.array(z.object({ source: z.string(), method: z.string(), label: z.record(z.string(), z.string()).nullable(), details: z.unknown() })) });
const methodsReply = z.object({
  data: z.object({ mode: z.enum(['test', 'live']), methods: z.array(z.object({ id: z.string(), label: z.string(), delayed: z.boolean() })) }),
});
const payPageReply = z.object({ data: payPageSchema });

function toView(way: PaymentMethodRow) {
  return { source: way.source, method: way.method, label: way.label, enabled: way.enabled, rules: way.rules, details: way.details, position: way.position };
}

function requirePerson(request: FastifyRequest): void {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Payments are set up by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  if ((request as unknown as { user?: { id?: string } }).user?.id === undefined) throw new UnauthorizedError();
}

export function paymentWaysRoutes(deps: PaymentWaysDeps): FastifyPluginAsyncZod {
  const { meta, manifests } = deps;
  const ways = paymentMethodsRepo(meta);
  const docs = paymentSettingsRepo(meta);

  async function canRead(request: FastifyRequest): Promise<boolean> {
    return (await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView));
  }

  async function paymentKeys(): Promise<Set<string>> {
    return new Set(await paymentAddOnKeys({ manifests }));
  }

  /** The mode a service works in now: live once live payments are switched on. */
  async function modeOf(key: string): Promise<PaymentMode> {
    const state = (await docs.get(serviceDocName(key), serviceStateSchema)) ?? emptyServiceState();
    return state.liveOn ? 'live' : 'test';
  }

  async function readyProviders(): Promise<string[]> {
    return (await readyPaymentProviders({ meta, manifests, runtime: deps.runtime })).map((one) => one.key);
  }

  async function defaultPayPage(): Promise<PayPageSettings> {
    const settings = settingsRepo(meta);
    const name = await settings.get('branding.appName');
    return { shopName: typeof name === 'string' ? name : 'Adminium', logoFileId: null, contactEmail: null, contactPhone: null, shopCountry: null, showLines: false };
  }

  return async (app) => {
    app.get('/payments/ways', { schema: { response: { 200: waysReply } } }, async (request) => {
      if (!(await canRead(request))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      return { data: { ways: (await ways.list()).map(toView), manualMethods: [...MANUAL_METHODS] } };
    });

    app.put(
      '/payments/ways/:source/:method',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: wayParams, body: wayBody, response: { 200: wayReply } },
      },
      async (request) => {
        requirePerson(request);
        const { source, method } = request.params;
        if (source === MANUAL_SOURCE) {
          if (!(MANUAL_METHODS as readonly string[]).includes(method)) throw new ValidationFailedError(`"${method}" is not a way to pay by hand.`, { expected: MANUAL_METHODS });
        } else {
          if (!(await paymentKeys()).has(source)) throw new NotFoundError(`"${source}" is not an installed payment service.`);
          if (request.body.details !== null) throw new ValidationFailedError("A payment service's ways carry no details of their own.");
        }
        if (method !== 'bank-transfer' && request.body.details?.accounts !== undefined) throw new ValidationFailedError('Only a bank transfer carries bank accounts.');
        const before = await ways.find(source, method);
        const saved = await ways.put({ source, method, ...request.body }, app.rbac.now());
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.way.changed',
          changes: { before: before === null ? null : { source, method, enabled: before.enabled, rules: before.rules }, after: { source, method, enabled: saved.enabled, rules: saved.rules } },
        });
        // Where a bank transfer sends the money: its own action, as an account change is.
        const accountsOf = (row: PaymentMethodRow | null) => JSON.stringify((row?.details as { accounts?: unknown } | null)?.accounts ?? []);
        if (method === 'bank-transfer' && accountsOf(before) !== accountsOf(saved)) {
          await app.rbac.audit(request, {
            category: 'payments',
            action: 'payments.bank.changed',
            changes: { before: { accounts: JSON.parse(accountsOf(before)) as unknown }, after: { accounts: JSON.parse(accountsOf(saved)) as unknown } },
          });
        }
        return { data: toView(saved) };
      },
    );

    app.delete(
      '/payments/ways/:source/:method',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: wayParams },
      },
      async (request, reply) => {
        requirePerson(request);
        const { source, method } = request.params;
        if (!(await ways.remove(source, method))) throw new NotFoundError('No such way to pay.');
        await app.rbac.audit(request, { category: 'payments', action: 'payments.way.removed', changes: { before: { source, method } } });
        return reply.status(204).send();
      },
    );

    app.post(
      '/payments/ways/preview',
      {
        config: { audit: auditExempt('a preview of what a customer would be offered saves nothing') },
        schema: { body: previewBody, response: { 200: previewReply } },
      },
      async (request) => {
        if (!(await canRead(request))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
        const page = (await docs.get(PAY_PAGE_DOC, payPageSchema)) ?? (await defaultPayPage());
        const { country, currency, amount, kind, profileId } = request.body;
        return {
          data: waysFor({
            methods: await ways.list(),
            payable: { kind, profileId, currency, due: amount, customerCountry: country },
            shopCountry: page.shopCountry,
            providers: await readyProviders(),
          }),
        };
      },
    );

    app.get(
      '/payments/services/:source/methods',
      { schema: { params: wayParams.pick({ source: true }), response: { 200: methodsReply } } },
      async (request) => {
        if (!(await request.can(PERMISSIONS.paymentsManage))) throw new ForbiddenError('Reading a payment service needs payments.manage.');
        const { source } = request.params;
        if (!(await paymentKeys()).has(source)) throw new NotFoundError(`"${source}" is not an installed payment service.`);
        const mode = await modeOf(source);
        const lookup = await paymentProviderFor({ runtime: deps.runtime, manifests, httpFor: (manifest) => addOnHttpClientFor(meta, manifest), demo: null }, source, mode);
        if (!lookup.ok) throw new ValidationFailedError(lookup.message, { reason: lookup.code });
        const answer = await lookup.provider.methodsFor({ country: null, currency: 'EUR', amount: '1.00' });
        if (answer.ok !== true) throw new ValidationFailedError(answer.providerMessage, { reason: answer.code });
        return { data: { mode, methods: [...answer.methods] } };
      },
    );

    app.get('/payments/pay-page', { schema: { response: { 200: payPageReply } } }, async (request) => {
      if (!(await canRead(request))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      return { data: (await docs.get(PAY_PAGE_DOC, payPageSchema)) ?? (await defaultPayPage()) };
    });

    app.put(
      '/payments/pay-page',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { body: payPageSchema, response: { 200: payPageReply } },
      },
      async (request) => {
        requirePerson(request);
        const page = request.body;
        if (page.logoFileId !== null) {
          const file = await filesRepo(meta).findById(page.logoFileId);
          if (file === null) throw new ValidationFailedError('That logo file is not there any more.', { field: 'logoFileId' });
          if (!(LOGO_TYPES as readonly string[]).includes(file.mime)) {
            throw new ValidationFailedError('The logo must be a PNG, JPEG or WebP image.', { field: 'logoFileId', reason: 'logo-type' });
          }
        }
        const before = await docs.get(PAY_PAGE_DOC, payPageSchema);
        await docs.set(PAY_PAGE_DOC, payPageSchema, page, app.rbac.now());
        await app.rbac.audit(request, { category: 'payments', action: 'payments.pay-page.changed', changes: { before: before as Record<string, unknown> | null, after: page as Record<string, unknown> } });
        return { data: page };
      },
    );
  };
}
