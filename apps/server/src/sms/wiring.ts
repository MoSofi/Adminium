// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS parts, put together once for `compose.ts`.
 *
 * Building them does nothing outward. No provider is called, no timer starts
 * and no setting is required: an install with no account answers exactly as
 * one without this code, and the sweep queues no job while there is neither an
 * account nor a stored event.
 *
 * The send path is joined later through {@link SmsWiring.joinSendPath}. Until
 * then a delivery report finds no message, and no STOP confirmation is sent:
 * the STOP itself still goes on the list.
 */
import { jobsRepo, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { storedPublicOrigin } from '../email/door-reach.js';
import { createInboundCore, inboundRoutes, INBOUND_SWEEP_JOB, registerInboundJobs, type InboundCore } from '../inbound/index.js';
import type { JobRegistry } from '../jobs/registry.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import type { LockReason } from '../trial/operator-lock.js';
import { createSmsAccountStore } from './account-store.js';
import { createTextConsentService, type TextConsentService } from './consent/index.js';
import { storedDefaultCountry } from './country.js';
import { createTextErasure, type TextErasure } from './erasure.js';
import { createSmsCatchUp, createSmsInboundChannel, type SmsCatchUpResult, type SmsInboundChannel, type SmsStopConfirmation } from './inbound/index.js';
import { smsRoutes } from './routes.js';
import { createTextSendStore, textPhoneKeys, type TextReport, type TextSendStore } from './send/index.js';
import { createSmsService, type SmsService } from './service.js';

export const INBOUND_SWEEP_SCHEDULE = 'inbound-sweep';
/** Often enough for an event whose job could not be queued. The channel limits how often it asks the provider. */
export const INBOUND_SWEEP_CRON = '*/10 * * * *';

export interface SmsWiringDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  /** The operator's answer for `smsProviders`. */
  operator: () => { allowed: boolean; reason: LockReason | null };
  log: { info(fields: Record<string, unknown>, message: string): void };
  fetch?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
}

/** What the send path gives the inbound channel once it is joined. */
export interface SmsSendPathSeam {
  applyReport(report: TextReport): Promise<unknown>;
  confirmStop(request: SmsStopConfirmation): Promise<unknown>;
}

export interface SmsWiring {
  service: SmsService;
  consent: TextConsentService;
  channel: SmsInboundChannel;
  inbound: InboundCore;
  deliveries: TextSendStore;
  erasure: TextErasure;
  defaultCountry: () => Promise<string | null>;
  settingsRoutes(): FastifyPluginAsyncZod;
  doorRoutes(): FastifyPluginAsync;
  registerJobs(registry: JobRegistry): void;
  /** Queues the sweep when there is something for it to do. */
  enqueueSweep(enqueue?: (input: EnqueueJobInput) => Promise<{ id: string }>): Promise<{ id: string } | null>;
  /** Asks the provider what arrived while the server was down. Null when it may not reach out. */
  catchUpAtBoot(): Promise<SmsCatchUpResult | null>;
  joinSendPath(path: SmsSendPathSeam): void;
}

export function createSmsWiring(deps: SmsWiringDeps): SmsWiring {
  const { meta, secret } = deps;
  const now = deps.now ?? Date.now;
  const defaultCountry = storedDefaultCountry(meta);
  const accounts = createSmsAccountStore(meta);
  const consent = createTextConsentService({ meta, secret, now });
  const deliveries = createTextSendStore(meta);
  const service = createSmsService({
    store: accounts,
    secret,
    defaultCountry,
    fetch: deps.fetch,
    now,
    stopList: {
      isStopped: (e164) => consent.stop.has(e164, null),
      recordProviderOptOut: async ({ e164, provider }) => {
        await consent.stop.add({ phone: e164, reason: 'provider-opt-out', origin: provider });
      },
    },
  });

  let sendPath: SmsSendPathSeam | null = null;
  const channel = createSmsInboundChannel({
    meta,
    secret,
    sms: service,
    consent,
    reports: (report) => (sendPath === null ? deliveries.applyReport(report) : sendPath.applyReport(report)),
    confirmations: async (request) => {
      if (sendPath === null) throw new Error('The send path is not joined yet.');
      return sendPath.confirmStop(request);
    },
    networkFeatures: deps.networkFeatures,
    desktop: deps.desktop,
    trustProxy: deps.trustProxy,
    operatorOff: () => !deps.operator().allowed,
    onCatchUp: (result) => deps.log.info({ catchUp: result.outcome, stored: result.stored, truncated: result.truncated, unreadable: result.unreadable, otherProfile: result.otherProfile }, 'sms catch-up'),
    fetch: deps.fetch,
    now,
  });
  const inbound = createInboundCore({ meta, secret, channels: [channel], now });
  const erasure = createTextErasure({ meta, consent, inbound, deliveries, phoneKeys: textPhoneKeys(meta, secret), country: defaultCountry });

  async function sweepWanted(): Promise<boolean> {
    if ((await accounts.read()) !== null) return true;
    return (await meta.db.selectFrom('adminium_inbound_events').select('id').limit(1).executeTakeFirst()) !== undefined;
  }

  return {
    service,
    consent,
    channel,
    inbound,
    deliveries,
    erasure,
    defaultCountry,

    settingsRoutes: () =>
      smsRoutes({
        service,
        manageGrant: PERMISSIONS.smsManage,
        operator: deps.operator,
        networkFeatures: deps.networkFeatures,
        desktop: deps.desktop,
        trustProxy: deps.trustProxy,
        publicOrigin: () => storedPublicOrigin(meta),
      }),

    doorRoutes: () => inboundRoutes({ core: inbound, channels: [channel], secret, now }),

    registerJobs: (registry) => registerInboundJobs(registry, inbound),

    async enqueueSweep(enqueue) {
      if (!(await sweepWanted())) return null;
      const input: EnqueueJobInput = { kind: INBOUND_SWEEP_JOB, payload: {}, dedupeKey: INBOUND_SWEEP_SCHEDULE, maxAttempts: 1 };
      return enqueue === undefined ? jobsRepo(meta).enqueue(input, now()) : enqueue(input);
    },

    async catchUpAtBoot() {
      // A server told not to reach out does not, whatever it may have missed.
      if (!deps.networkFeatures || !deps.operator().allowed) return null;
      const result = await createSmsCatchUp({ core: inbound, sms: service, fetch: deps.fetch, now }).run();
      if (result.outcome !== 'not-connected') deps.log.info({ catchUp: result.outcome, stored: result.stored, truncated: result.truncated, unreadable: result.unreadable, otherProfile: result.otherProfile }, 'sms catch-up');
      return result;
    },

    joinSendPath(path) {
      sendPath = path;
    },
  };
}
