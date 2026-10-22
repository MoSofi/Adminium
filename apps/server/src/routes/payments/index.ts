// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments: setting up the payment services.
 *
 * ─── WHO MAY DO WHAT ───────────────────────────────────────────────────────
 *
 * Reading the setup needs `payments.manage` or `payments.view`. Every change
 * needs `payments.manage` AND a signed-in person: an API key may never point
 * a shop's money somewhere else. Payment add-ons are set up here only; the
 * generic connect form refuses them.
 *
 * ─── WHAT A SAVE DOES ──────────────────────────────────────────────────────
 *
 * One field of one mode at a time (a test key, a live signing secret), so a
 * shop can set up test first and live later and replace one key without
 * touching the other. A paste is checked for the commonest mistakes first
 * (`paste-checks.ts`); the value goes into the add-on's encrypted credential
 * envelope and only a hint of it into the readable setup document
 * (`services.ts`). When a mode's key fields are all saved, the provider is
 * asked at once whether the key works, which permissions it lacks and which
 * account it belongs to. A key that now belongs to another account is
 * audited as such.
 *
 * Connecting is refused while network features are off and on the desktop
 * app: neither can take a payment online.
 */
import {
  PAYMENT_PROVIDER_CONTRACT,
  PAYMENT_PROVIDER_VERSION,
  PAYMENT_WEBHOOK_EVENTS_EXPORT,
  type CredentialCheck,
  type PaymentMode,
} from '@adminium/add-on-contracts';
import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { paymentCountersRepo, paymentSettingsRepo, type InstalledManifest, type ManifestsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { addOnHttpClientFor } from '../../add-ons/egress.js';
import { providerByKey, type AddOnRuntimeState } from '../../add-ons/runtime.js';
import { auditExempt, audited } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { modeCredentials, withField } from '../../payments/credentials.js';
import { payAddress } from '../../payments/links.js';
import { checkPaste } from '../../payments/paste-checks.js';
import { paymentProviderFor } from '../../payments/providers.js';
import { dismissAlarm, raiseMoneyRedirect, recentAlarms } from '../../payments/alarms.js';
import { clockSkewOf } from '../../payments/clock.js';
import { refundableCount, removeKeysSafely, setLive, waitingCount } from '../../payments/going-live.js';
import { providerName, tellPaymentManagers } from '../../payments/notices.js';
import { reachability } from '../../payments/reachability.js';
import { sweepDocName, sweepStateSchema } from '../../payments/sweep.js';
import { webhookDocName, webhookHealthSchema } from '../../payments/webhook.js';
import {
  checklist,
  emptyServiceState,
  mutateServiceState,
  recordCheck,
  withServiceLock,
  serviceDocName,
  serviceStateSchema,
  withSavedField,
  type CheckRefusal,
  type ServiceState,
} from '../../payments/services.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  disconnectBody,
  liveBody,
  pathBody,
  saveFieldBody,
  serviceFieldParams,
  serviceKeyParams,
  serviceModeParams,
  serviceReply,
  alarmParams,
  setupReply,
  stoppedBody,
  type ServiceView,
} from './schema.js';

export interface PaymentsRoutesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  runtime: () => AddOnRuntimeState | null;
  /** `ADMINIUM_NETWORK_FEATURES`. */
  networkFeatures: boolean;
  /** `ADMINIUM_RUNTIME === 'desktop'`. */
  desktop: boolean;
  /** `ADMINIUM_TRUST_PROXY`. */
  trustProxy: boolean;
}

/** A payment add-on: installed, and providing `payment-provider@1`. */
interface PaymentAddOn {
  installed: InstalledManifest;
  manifest: AddOnManifest;
}

/**
 * The event types a loaded server half lists for its webhook, read off its
 * optional named export and kept only when it is a short list of short names.
 */
function webhookEventsOf(module: unknown): string[] {
  const value = (module as Record<string, unknown> | null)?.[PAYMENT_WEBHOOK_EVENTS_EXPORT];
  if (!Array.isArray(value) || value.length > 30) return [];
  return value.filter((one): one is string => typeof one === 'string' && /^[A-Za-z0-9._*-]{1,120}$/.test(one));
}

/** The provider that offers two ways to make its key (its own app, or by hand). */
const TWO_PATHS = new Set(['payments-stripe']);

function isPaymentAddOn(manifest: AddOnManifest): boolean {
  return (manifest.addOn.provides ?? []).some((entry) => entry.contract === PAYMENT_PROVIDER_CONTRACT);
}

function secretFields(manifest: AddOnManifest): { key: string; webhook: boolean; label: { key: string; fallback: string } | null; help: { key: string; fallback: string } | null }[] {
  return (manifest.settings ?? [])
    .filter((setting) => setting.secret === true)
    .map((setting) => ({
      key: setting.key,
      webhook: setting.key.includes('webhook'),
      label: setting.label ?? null,
      help: setting.help ?? null,
    }));
}

/** When the sweep last caught a payment no webhook announced, if no webhook event arrived since; else null. */
export function caughtSince(caughtAt: number | null, lastEventAt: number | null): number | null {
  if (caughtAt === null) return null;
  return lastEventAt !== null && lastEventAt >= caughtAt ? null : caughtAt;
}

/** The signed-in person making the change. An API key is refused by name. */
function requirePerson(request: FastifyRequest): void {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError('Payments are set up by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  }
  if ((request as unknown as { user?: { id?: string } }).user?.id === undefined) throw new UnauthorizedError();
}

export function paymentsRoutes(deps: PaymentsRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manifests } = deps;
  const docs = paymentSettingsRepo(meta);
  const clock = () => Date.now();

  async function paymentAddOns(): Promise<PaymentAddOn[]> {
    const out: PaymentAddOn[] = [];
    for (const installed of await manifests.list('add-on')) {
      const parsed = addOnManifestSchema.safeParse(installed.document);
      if (parsed.success && isPaymentAddOn(parsed.data)) out.push({ installed, manifest: parsed.data });
    }
    return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'en'));
  }

  async function paymentAddOn(key: string): Promise<PaymentAddOn> {
    const installed = await manifests.findByKey(key);
    const parsed = installed === null ? null : addOnManifestSchema.safeParse(installed.document);
    if (installed === null || parsed === null || !parsed.success || !isPaymentAddOn(parsed.data)) {
      throw new NotFoundError(`"${key}" is not an installed payment service.`);
    }
    return { installed, manifest: parsed.data };
  }

  async function stateOf(key: string): Promise<ServiceState> {
    return (await docs.get(serviceDocName(key), serviceStateSchema)) ?? emptyServiceState();
  }

  /** Where providers must send webhooks: the pay address (the one chosen, else this server's public address). */
  async function webhookOrigin(): Promise<string | null> {
    return payAddress(meta);
  }

  function webhookUrl(origin: string | null, key: string, mode: PaymentMode): string | null {
    return origin === null ? null : `${origin.replace(/\/$/, '')}/api/v1/payments/webhook/${key}/${mode}`;
  }

  type Health = ServiceView['test']['health'];

  async function healthOf(key: string, mode: PaymentMode): Promise<Health> {
    const at = clock();
    const hook = await docs.get(webhookDocName(key, mode), webhookHealthSchema);
    const sweep = await docs.get(sweepDocName(key, mode), sweepStateSchema);
    return {
      lastEventAt: hook?.lastAt ?? null,
      lastBadAt: hook?.lastBadAt ?? null,
      badThisHour: await paymentCountersRepo(meta).read(`webhook-bad:${key}:${mode}`, at),
      // Only while no event has arrived since: a webhook that works again clears the warning.
      caughtAt: caughtSince(sweep?.caughtAt ?? null, hook?.lastAt ?? null),
      slowed: sweep?.slowed ?? false,
      eventOrigin: hook?.origin ?? null,
    };
  }

  /** What the Disconnect dialog counts, and how far the service's clock was off. */
  interface Extra {
    waiting: number;
    refundable: number;
    clockSkewMs: number | null;
  }

  async function extraOf(key: string): Promise<Extra> {
    return { waiting: await waitingCount(meta, key), refundable: await refundableCount(meta, key, clock()), clockSkewMs: clockSkewOf(key)?.skewMs ?? null };
  }

  function viewOf(addOn: PaymentAddOn, state: ServiceState, origin: string | null, health: Record<PaymentMode, Health>, extra: Extra): ServiceView {
    const { manifest, installed } = addOn;
    const fields = secretFields(manifest);
    const runtime = deps.runtime();
    const entry = runtime === null ? null : providerByKey(runtime, PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION, manifest.key);
    const mode = (which: PaymentMode) => ({
      fields: fields.map((field) => {
        const saved = state[which].fields[field.key];
        return { ...field, set: saved !== undefined, hint: saved?.hint ?? null, setAt: saved?.setAt ?? null };
      }),
      check: state[which].check,
      accountId: state[which].accountId,
      webhookUrl: webhookUrl(origin, manifest.key, which),
      firstEventAt: state[which].firstEventAt,
      firstPaymentAt: state[which].firstPaymentAt,
      health: health[which],
    });
    return {
      key: manifest.key,
      name: manifest.name,
      description: manifest.description,
      status: installed.row.status,
      loaded: entry !== null,
      hasPaths: TWO_PATHS.has(manifest.key),
      webhookEvents: entry === null ? [] : webhookEventsOf(entry.module),
      path: state.path,
      stopped: state.stopped,
      liveOn: state.liveOn,
      test: mode('test'),
      live: mode('live'),
      checklist: checklist({
        state,
        keyFields: fields.filter((field) => !field.webhook).map((field) => field.key),
        webhookFields: fields.filter((field) => field.webhook).map((field) => field.key),
        hasPaths: TWO_PATHS.has(manifest.key),
      }),
      ...extra,
    };
  }

  async function runCheck(key: string, mode: PaymentMode): Promise<CredentialCheck | CheckRefusal> {
    const lookup = await paymentProviderFor(
      {
        runtime: deps.runtime,
        manifests,
        httpFor: (manifest) => addOnHttpClientFor(meta, manifest),
        demo: null,
      },
      key,
      mode,
    );
    if (!lookup.ok) return { ok: false, code: lookup.code, providerMessage: lookup.message };
    return lookup.provider.checkCredentials();
  }

  async function lookupFor(key: string, mode: PaymentMode) {
    return paymentProviderFor({ runtime: deps.runtime, manifests, httpFor: (manifest) => addOnHttpClientFor(meta, manifest), demo: null }, key, mode);
  }

  function refuseOffline(): void {
    if (!deps.networkFeatures) {
      throw new ValidationFailedError('Network features are off on this server, so no payment service can be connected.', { reason: 'network-off' });
    }
    if (deps.desktop) {
      throw new ValidationFailedError('The desktop app takes payments by hand only: customers cannot reach this computer.', { reason: 'desktop' });
    }
  }

  return async (app) => {
    async function canRead(request: FastifyRequest): Promise<boolean> {
      return (await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView));
    }

    async function viewNow(key: string, state: ServiceState): Promise<ServiceView> {
      return viewOf(await paymentAddOn(key), state, await webhookOrigin(), { test: await healthOf(key, 'test'), live: await healthOf(key, 'live') }, await extraOf(key));
    }

    function who(request: FastifyRequest): string {
      const user = (request as unknown as { user?: { email?: string; name?: string } }).user;
      return user?.name ?? user?.email ?? 'someone';
    }

    /**
     * Asks the provider (slow, outside the lock), then records what it said on
     * the LATEST document. The provider's words are stored only after every
     * saved value of this mode is taken out of them.
     */
    async function checked(request: FastifyRequest, addOn: PaymentAddOn, mode: PaymentMode): Promise<ServiceState> {
      const key = addOn.manifest.key;
      let answer = await runCheck(key, mode);
      if (answer.ok !== true) {
        const saved = modeCredentials(await manifests.getCredential(addOn.installed.row.id), mode) ?? {};
        let message = answer.providerMessage;
        for (const value of Object.values(saved)) if (value.length >= 6) message = message.split(value).join('[a saved secret]');
        answer = { ...answer, providerMessage: message.slice(0, 2000) };
      }
      const { state, result: changed } = await mutateServiceState(meta, key, (current) => {
        const outcome = recordCheck(current, mode, answer, app.rbac.now());
        return { state: outcome.state, result: outcome.accountChanged };
      }, app.rbac.now());
      if (changed !== null && changed !== undefined) {
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.account.changed',
          changes: { before: { key, mode, accountId: changed.from }, after: { key, mode, accountId: changed.to } },
        });
        await raiseMoneyRedirect(meta, { what: 'account', service: key, from: changed.from, to: changed.to, by: who(request) });
      }
      return state;
    }

    app.get('/payments/setup', { schema: { response: { 200: setupReply } } }, async (request) => {
      if (!(await canRead(request))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      // The pay address, as the record panel and the pay links read it: one answer everywhere.
      const origin = await payAddress(meta);
      const hooks = origin;
      const forwarded = request.headers['x-forwarded-for'] !== undefined || request.headers['x-forwarded-proto'] !== undefined;
      const services: ServiceView[] = [];
      for (const addOn of await paymentAddOns()) {
        const key = addOn.manifest.key;
        services.push(viewOf(addOn, await stateOf(key), hooks, { test: await healthOf(key, 'test'), live: await healthOf(key, 'live') }, await extraOf(key)));
      }
      return {
        data: {
          reachability: reachability({ networkFeatures: deps.networkFeatures, desktop: deps.desktop, publicOrigin: origin, trustProxy: deps.trustProxy, forwarded }),
          canManage: await request.can(PERMISSIONS.paymentsManage),
          services,
          // Without the ones this person said "Got it" to.
          alarms: await recentAlarms(meta, clock(), (request as unknown as { user?: { id?: string } }).user?.id ?? null),
        },
      };
    });

    // "Got it" on an alarm banner: hidden for this person only (everyone who manages payments was emailed).
    app.post(
      '/payments/alarms/:id/dismiss',
      { config: { audit: auditExempt('a person hiding a banner for themselves; the change it reports stays audited') }, schema: { params: alarmParams } },
      async (request, reply) => {
        requirePerson(request);
        if (!(await canRead(request))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
        const userId = (request as unknown as { user: { id: string } }).user.id;
        if (!(await dismissAlarm(meta, userId, request.params.id, clock()))) throw new NotFoundError('No such alarm.');
        return reply.status(204).send();
      },
    );

    app.put(
      '/payments/services/:key/modes/:mode/fields/:field',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: serviceFieldParams, body: saveFieldBody, response: { 200: serviceReply } },
      },
      async (request) => {
        requirePerson(request);
        refuseOffline();
        const { key, mode, field } = request.params;
        const addOn = await paymentAddOn(key);
        const fields = secretFields(addOn.manifest);
        if (!fields.some((one) => one.key === field)) {
          throw new ValidationFailedError(`"${key}" has no field "${field}".`, { expected: fields.map((one) => one.key) });
        }
        const verdict = checkPaste(key, field, mode, request.body.value);
        if (!verdict.ok) throw new ValidationFailedError('That value cannot be saved in this field.', { reason: verdict.code, field });

        // The key and its hint change together, one writer at a time: two saves at once never lose a key.
        const { state: saved, replaced } = await withServiceLock(key, async () => {
          const envelope = await manifests.getCredential(addOn.installed.row.id);
          await manifests.setCredential(addOn.installed.row.id, { kind: 'api-key', secret: withField(envelope, mode, field, verdict.value) });
          const current = await stateOf(key);
          const next = withSavedField(current, mode, field, verdict.value, app.rbac.now());
          await docs.set(serviceDocName(key), serviceStateSchema, next, app.rbac.now());
          return { state: next, replaced: current[mode].fields[field] !== undefined };
        });
        let state = saved;
        await app.rbac.audit(request, {
          category: 'payments',
          // The field's NAME, never its value.
          action: replaced ? 'payments.service.field.replaced' : 'payments.service.field.saved',
          changes: { after: { key, mode, field } },
        });
        const keyFields = fields.filter((one) => !one.webhook).map((one) => one.key);
        if (keyFields.every((one) => state[mode].fields[one] !== undefined)) state = await checked(request, addOn, mode);
        return { data: await viewNow(key, state) };
      },
    );

    app.delete(
      '/payments/services/:key/modes/:mode/fields/:field',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: serviceFieldParams, response: { 200: serviceReply } },
      },
      async (request) => {
        requirePerson(request);
        const { key, mode, field } = request.params;
        const addOn = await paymentAddOn(key);
        const state = await withServiceLock(key, async () => {
          const envelope = await manifests.getCredential(addOn.installed.row.id);
          if (envelope !== null) await manifests.setCredential(addOn.installed.row.id, { kind: 'api-key', secret: withField(envelope, mode, field, null) });
          const next = withSavedField(await stateOf(key), mode, field, null, app.rbac.now());
          await docs.set(serviceDocName(key), serviceStateSchema, next, app.rbac.now());
          return next;
        });
        await app.rbac.audit(request, { category: 'payments', action: 'payments.service.field.removed', changes: { before: { key, mode, field } } });
        return { data: await viewNow(key, state) };
      },
    );

    app.post(
      '/payments/services/:key/modes/:mode/check',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: serviceModeParams, response: { 200: serviceReply } },
      },
      async (request) => {
        requirePerson(request);
        refuseOffline();
        const { key, mode } = request.params;
        const addOn = await paymentAddOn(key);
        const state = await checked(request, addOn, mode);
        return { data: await viewNow(key, state) };
      },
    );

    app.put(
      '/payments/services/:key/path',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: serviceKeyParams, body: pathBody, response: { 200: serviceReply } },
      },
      async (request) => {
        requirePerson(request);
        const { key } = request.params;
        await paymentAddOn(key);
        const { state } = await mutateServiceState(meta, key, (current) => ({ state: { ...current, path: request.body.path } }), app.rbac.now());
        await app.rbac.audit(request, { category: 'payments', action: 'payments.service.path', changes: { after: { key, path: request.body.path } } });
        return { data: await viewNow(key, state) };
      },
    );

    app.put(
      '/payments/services/:key/stopped',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: serviceKeyParams, body: stoppedBody, response: { 200: serviceReply } },
      },
      async (request) => {
        requirePerson(request);
        const { key } = request.params;
        await paymentAddOn(key);
        const { state } = await mutateServiceState(meta, key, (current) => ({ state: { ...current, stopped: request.body.stopped } }), app.rbac.now());
        await app.rbac.audit(request, {
          category: 'payments',
          action: request.body.stopped ? 'payments.service.stopped' : 'payments.service.resumed',
          changes: { after: { key, stopped: request.body.stopped } },
        });
        return { data: await viewNow(key, state) };
      },
    );

    // Live payments on (only with a live key that passed its Check) or off.
    app.put(
      '/payments/services/:key/live',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: serviceKeyParams, body: liveBody, response: { 200: serviceReply } },
      },
      async (request) => {
        requirePerson(request);
        const { key } = request.params;
        await paymentAddOn(key);
        if (request.body.on) {
          refuseOffline();
          const current = await stateOf(key);
          if (current.live.check?.ok !== true) throw new ValidationFailedError('Save a live key that passes its Check first.', { reason: 'live-key' });
        }
        const { state, ended } = await setLive({ meta, providerFor: lookupFor, now: () => app.rbac.now() }, key, request.body.on);
        await app.rbac.audit(request, {
          category: 'payments',
          action: request.body.on ? 'payments.service.live.on' : 'payments.service.live.off',
          changes: { after: { key, liveOn: request.body.on, testLinksEnded: ended?.links ?? 0, testCheckoutsEnded: ended?.checkouts ?? 0 } },
        });
        return { data: await viewNow(key, state) };
      },
    );

    // Disconnect: stop new payments, or remove the keys.
    app.post(
      '/payments/services/:key/disconnect',
      {
        preHandler: app.rbac.require(PERMISSIONS.paymentsManage),
        config: { audit: audited('rbac') },
        schema: { params: serviceKeyParams, body: disconnectBody, response: { 200: serviceReply } },
      },
      async (request) => {
        requirePerson(request);
        const { key } = request.params;
        const addOn = await paymentAddOn(key);
        if (request.body.action === 'stop') {
          const { state } = await mutateServiceState(meta, key, (current) => ({ state: { ...current, stopped: true } }), app.rbac.now());
          await app.rbac.audit(request, { category: 'payments', action: 'payments.service.stopped', changes: { after: { key, stopped: true } } });
          return { data: await viewNow(key, state) };
        }
        // Stopped first, open checkouts ended while the keys still work; then, with nothing in motion
        // (or the person's word they settle it by hand), the keys go.
        const outcome = await removeKeysSafely(
          { meta, manifests, providerFor: lookupFor, now: () => app.rbac.now() },
          { manifestId: addOn.installed.row.id, key, settleByHand: request.body.settleByHand },
        );
        if (!outcome.removed) {
          throw new ValidationFailedError('Payments are still on their way. New payments are stopped; say you will settle these by hand first.', { reason: 'waiting', waiting: outcome.waiting });
        }
        const { state, waiting } = outcome;
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.service.keys.removed',
          changes: { after: { key, waiting, settleByHand: request.body.settleByHand, checkoutsEnded: outcome.ended, settledByHand: outcome.leftByHand } },
        });
        // Taking a service's keys stops its payments: everyone who manages them hears of it.
        await tellPaymentManagers(
          { meta, now: () => app.rbac.now() },
          {
            kind: 'payments.keys-removed',
            about: `keys-removed:${key}:${String(app.rbac.now())}`,
            urgent: true,
            actorLabel: who(request),
            words: () => ({
              title: { key: 'keysRemoved.title', fallback: 'The {provider} keys were removed' },
              body: { key: 'keysRemoved.body', fallback: 'By {by}. No payment starts with {provider} until new keys are saved.' },
              values: { provider: providerName(key), by: who(request) },
            }),
          },
        );
        return { data: await viewNow(key, state) };
      },
    );
  };
}

