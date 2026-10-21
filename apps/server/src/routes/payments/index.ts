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
import { paymentCountersRepo, paymentSettingsRepo, settingsRepo, type InstalledManifest, type ManifestsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { addOnHttpClientFor } from '../../add-ons/egress.js';
import { providerByKey, type AddOnRuntimeState } from '../../add-ons/runtime.js';
import { audited } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { withField } from '../../payments/credentials.js';
import { checkPaste } from '../../payments/paste-checks.js';
import { paymentProviderFor } from '../../payments/providers.js';
import { reachability } from '../../payments/reachability.js';
import { sweepDocName, sweepStateSchema } from '../../payments/sweep.js';
import { webhookDocName, webhookHealthSchema } from '../../payments/webhook.js';
import {
  checklist,
  emptyServiceState,
  recordCheck,
  serviceDocName,
  serviceStateSchema,
  withSavedField,
  type CheckRefusal,
  type ServiceState,
} from '../../payments/services.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  pathBody,
  saveFieldBody,
  serviceFieldParams,
  serviceKeyParams,
  serviceModeParams,
  serviceReply,
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

  async function publicOrigin(): Promise<string | null> {
    const value = await settingsRepo(meta).get('system.publicOrigin');
    return typeof value === 'string' && value !== '' ? value : null;
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
      caughtAt: sweep?.caughtAt ?? null,
      slowed: sweep?.slowed ?? false,
    };
  }

  function viewOf(addOn: PaymentAddOn, state: ServiceState, origin: string | null, health: Record<PaymentMode, Health>): ServiceView {
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

    async function save(key: string, state: ServiceState): Promise<ServiceView> {
      await docs.set(serviceDocName(key), serviceStateSchema, state, app.rbac.now());
      return viewOf(await paymentAddOn(key), state, await publicOrigin(), { test: await healthOf(key, 'test'), live: await healthOf(key, 'live') });
    }

    async function checked(request: FastifyRequest, addOn: PaymentAddOn, state: ServiceState, mode: PaymentMode): Promise<ServiceState> {
      const answer = await runCheck(addOn.manifest.key, mode);
      const outcome = recordCheck(state, mode, answer, app.rbac.now());
      if (outcome.accountChanged !== null) {
        await app.rbac.audit(request, {
          category: 'payments',
          action: 'payments.account.changed',
          changes: { before: { key: addOn.manifest.key, mode, accountId: outcome.accountChanged.from }, after: { key: addOn.manifest.key, mode, accountId: outcome.accountChanged.to } },
        });
      }
      return outcome.state;
    }

    app.get('/payments/setup', { schema: { response: { 200: setupReply } } }, async (request) => {
      if (!(await canRead(request))) throw new ForbiddenError('Seeing payments needs payments.manage or payments.view.');
      const origin = await publicOrigin();
      const forwarded = request.headers['x-forwarded-for'] !== undefined || request.headers['x-forwarded-proto'] !== undefined;
      const services: ServiceView[] = [];
      for (const addOn of await paymentAddOns()) {
        const key = addOn.manifest.key;
        services.push(viewOf(addOn, await stateOf(key), origin, { test: await healthOf(key, 'test'), live: await healthOf(key, 'live') }));
      }
      return {
        data: {
          reachability: reachability({ networkFeatures: deps.networkFeatures, desktop: deps.desktop, publicOrigin: origin, trustProxy: deps.trustProxy, forwarded }),
          canManage: await request.can(PERMISSIONS.paymentsManage),
          services,
        },
      };
    });

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

        const envelope = await manifests.getCredential(addOn.installed.row.id);
        await manifests.setCredential(addOn.installed.row.id, { kind: 'api-key', secret: withField(envelope, mode, field, verdict.value) });
        let state = await stateOf(key);
        const replaced = state[mode].fields[field] !== undefined;
        state = withSavedField(state, mode, field, verdict.value, app.rbac.now());
        await app.rbac.audit(request, {
          category: 'payments',
          // The field's NAME, never its value.
          action: replaced ? 'payments.service.field.replaced' : 'payments.service.field.saved',
          changes: { after: { key, mode, field } },
        });
        const keyFields = fields.filter((one) => !one.webhook).map((one) => one.key);
        if (keyFields.every((one) => state[mode].fields[one] !== undefined)) state = await checked(request, addOn, state, mode);
        return { data: await save(key, state) };
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
        const envelope = await manifests.getCredential(addOn.installed.row.id);
        if (envelope !== null) await manifests.setCredential(addOn.installed.row.id, { kind: 'api-key', secret: withField(envelope, mode, field, null) });
        const state = withSavedField(await stateOf(key), mode, field, null, app.rbac.now());
        await app.rbac.audit(request, { category: 'payments', action: 'payments.service.field.removed', changes: { before: { key, mode, field } } });
        return { data: await save(key, state) };
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
        const state = await checked(request, addOn, await stateOf(key), mode);
        return { data: await save(key, state) };
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
        const state = { ...(await stateOf(key)), path: request.body.path };
        await app.rbac.audit(request, { category: 'payments', action: 'payments.service.path', changes: { after: { key, path: request.body.path } } });
        return { data: await save(key, state) };
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
        const state = { ...(await stateOf(key)), stopped: request.body.stopped };
        await app.rbac.audit(request, {
          category: 'payments',
          action: request.body.stopped ? 'payments.service.stopped' : 'payments.service.resumed',
          changes: { after: { key, stopped: request.body.stopped } },
        });
        return { data: await save(key, state) };
      },
    );
  };
}

