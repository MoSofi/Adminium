// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Text messages: connecting the business's own provider account.
 *
 *   GET    /sms/setup     what is connected, and whether replies can reach this server
 *   PUT    /sms/account   save keys: refused unless the provider accepts them
 *   PUT    /sms/sending   the sender and the default country
 *   POST   /sms/check     ask the provider about the saved keys again
 *   POST   /sms/test      one fixed test text, to the person's own number (`test-gate.ts`)
 *   DELETE /sms/account   remove the keys
 *
 * Everything needs `sms.manage`, and every change a signed-in person: an API
 * key may never point a business's texts, or its bill, somewhere else.
 *
 * No reply or audit row holds a key. The audit names what changed, the account
 * only by its masked hint, and a test's number only by its last two digits.
 * Replies are serialised through closed schemas, so a field added to a view by
 * mistake does not leave the server.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../audit/coverage.js';
import { AppError, ForbiddenError, UnauthorizedError, ValidationFailedError } from '../errors.js';
import { reachability, REACHABILITY_STATES } from '../payments/reachability.js';
import { tagRoutes } from '../security/route-audience.js';
import type { LockReason } from '../trial/operator-lock.js';
import { phoneHint } from './destination.js';
import type { SmsAccountView, SmsService } from './service.js';
import type { SmsTestGate } from './test-gate.js';
import { SMS_CHECK_REASONS, SMS_PROVIDERS } from './types.js';

export interface SmsRoutesDeps {
  service: SmsService;
  /** The grant the routes require: `PERMISSIONS.smsManage`. */
  manageGrant: string;
  /** The operator's answer for SMS (`smsProviders` in `trial/policy.ts`). */
  operator: () => { allowed: boolean; reason: LockReason | null };
  /** `ADMINIUM_NETWORK_FEATURES`. */
  networkFeatures: boolean;
  /** `ADMINIUM_RUNTIME === 'desktop'`. */
  desktop: boolean;
  /** `ADMINIUM_TRUST_PROXY`. */
  trustProxy: boolean;
  /** This server's stored public address (`storedPublicOrigin`). */
  publicOrigin: () => Promise<string | null>;
  /** The language a person reads in, for the test text they send themselves. */
  languageOf?: ((userId: string) => Promise<string | null>) | undefined;
  /** What a test text may cost, kept in meta (`test-gate.ts`). Without it, the service's own memory limit. */
  testGate?: SmsTestGate | undefined;
}

const field = z.string().max(1024);

/** `confirmAccountChange`: the person has seen that these keys open another account, and texts will bill there. */
const accountBody = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('twilio'), accountSid: field, authToken: field, confirmAccountChange: z.boolean().optional() }).strict(),
  z.object({ provider: z.literal('telnyx'), apiKey: field, publicKey: field, messagingProfileId: field, confirmAccountChange: z.boolean().optional() }).strict(),
]);

const senderSchema = z.object({ kind: z.enum(['number', 'name', 'pool']), value: z.string().min(1).max(64) }).strict();
const sendingBody = z.object({ sender: senderSchema, defaultCountry: z.string().max(2).nullable() }).strict();
const testBody = z.object({ to: z.string().min(1).max(64) }).strict();

const accountView = z
  .object({
    provider: z.enum(SMS_PROVIDERS),
    accountName: z.string().nullable(),
    accountHint: z.string(),
    accountType: z.enum(['full', 'trial']).nullable(),
    keyReadable: z.boolean(),
    sender: senderSchema.nullable(),
    senderTakesReplies: z.enum(['yes', 'no', 'depends']).nullable(),
    defaultCountry: z.string().nullable(),
    check: z.object({ ok: z.boolean(), reason: z.enum(SMS_CHECK_REASONS).nullable(), at: z.number() }),
    savedAt: z.number(),
    timeoutRetry: z.enum(['never', 'same-key']),
  })
  .strict();

const setupReply = z.object({
  data: z.object({
    reachability: z.object({ state: z.enum(REACHABILITY_STATES), origin: z.string().nullable(), notPort443: z.boolean() }),
    /** False: texts can go, but STOP replies and delivery reports cannot arrive. */
    repliesCanArrive: z.boolean(),
    account: accountView.nullable(),
  }),
});

const accountReply = z.object({ data: accountView });

const testReply = z.object({
  data: z.object({
    outcome: z.enum(['accepted', 'not-taken', 'refused', 'unknown']),
    reason: z.string().nullable(),
    detail: z.string().nullable(),
    resend: z.enum(['same-key', 'check-first']).nullable(),
    providerCode: z.string().nullable(),
  }),
});

function requirePerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Text messages are set up by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

export function smsRoutes(deps: SmsRoutesDeps): FastifyPluginAsyncZod {
  const { service } = deps;

  /** Refused before anything is read or sent: the operator's switch, then the network. */
  function refuseOffline(): void {
    const answer = deps.operator();
    if (!answer.allowed) {
      throw new AppError(403, 'OFF_BY_OPERATOR', 'The operator has switched text messages off for this installation.', {
        question: 'smsProviders',
        reason: answer.reason ?? 'not-allowed',
      });
    }
    if (!deps.networkFeatures) {
      throw new ValidationFailedError('Network features are off on this server, so no text message provider can be reached.', { reason: 'network-off' });
    }
  }

  return async (app) => {
    tagRoutes(app, 'staff');
    const manage = app.rbac.require(deps.manageGrant);

    const auditedView = (view: SmsAccountView) => ({ provider: view.provider, account: view.accountHint });

    app.get('/sms/setup', { preHandler: manage, schema: { response: { 200: setupReply } } }, async (request) => {
      const forwarded = request.headers['x-forwarded-for'] !== undefined || request.headers['x-forwarded-proto'] !== undefined;
      const reach = reachability({
        operatorOff: !deps.operator().allowed,
        networkFeatures: deps.networkFeatures,
        desktop: deps.desktop,
        publicOrigin: await deps.publicOrigin(),
        trustProxy: deps.trustProxy,
        forwarded,
      });
      return { data: { reachability: reach, repliesCanArrive: reach.state === 'reachable', account: await service.view() } };
    });

    app.put(
      '/sms/account',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: accountBody, response: { 200: accountReply } } },
      async (request) => {
        const person = requirePerson(request);
        refuseOffline();
        const { confirmAccountChange, ...keys } = request.body;
        const { view, replaced, accountChanged } = await service.connect(keys, person, { confirmAccountChange: confirmAccountChange === true });
        await app.rbac.audit(request, {
          category: 'settings',
          action: accountChanged ? 'sms.account.changed' : replaced ? 'sms.account.replaced' : 'sms.account.connected',
          changes: { after: auditedView(view) },
        });
        return { data: view };
      },
    );

    app.put(
      '/sms/sending',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: sendingBody, response: { 200: accountReply } } },
      async (request) => {
        const person = requirePerson(request);
        // Saving a Telnyx number asks Telnyx which profile holds it.
        refuseOffline();
        const view = await service.setSending(request.body, person);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'sms.sending.saved',
          changes: { after: { ...auditedView(view), senderKind: view.sender?.kind ?? null, defaultCountry: view.defaultCountry } },
        });
        return { data: view };
      },
    );

    app.post(
      '/sms/check',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { response: { 200: accountReply } } },
      async (request) => {
        requirePerson(request);
        refuseOffline();
        const view = await service.recheck();
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'sms.account.checked',
          changes: { after: { ...auditedView(view), ok: view.check.ok, reason: view.check.reason } },
        });
        return { data: view };
      },
    );

    app.post(
      '/sms/test',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { body: testBody, response: { 200: testReply } } },
      async (request) => {
        const userId = requirePerson(request);
        refuseOffline();
        const gate = deps.testGate;
        const result = await service.sendTest(request.body.to, (await deps.languageOf?.(userId)) ?? null, gate === undefined ? undefined : (e164) => gate(userId, e164));
        const reason = result.outcome === 'accepted' ? null : result.reason;
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'sms.test.sent',
          // The person's own number, by its last two digits; it took a slot of the day's text limit.
          changes: { after: { provider: result.provider, outcome: result.outcome, reason, to: phoneHint(result.to), ownNumber: true, countedInDailyLimit: gate !== undefined } },
        });
        return {
          data: {
            outcome: result.outcome,
            reason,
            detail: result.outcome === 'refused' ? result.detail : null,
            resend: result.outcome === 'unknown' ? result.resend : null,
            providerCode: result.outcome === 'accepted' ? null : result.providerCode,
          },
        };
      },
    );

    app.delete(
      '/sms/account',
      { preHandler: manage, config: { audit: audited('rbac') }, schema: { response: { 204: z.null() } } },
      async (request, reply) => {
        requirePerson(request);
        const before = await service.view();
        if (await service.disconnect()) {
          await app.rbac.audit(request, { category: 'settings', action: 'sms.account.removed', changes: { before: before === null ? {} : auditedView(before) } });
        }
        return reply.status(204).send(null);
      },
    );
  };
}
