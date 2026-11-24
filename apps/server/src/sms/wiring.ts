// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS parts, put together once for `compose.ts`.
 *
 * Building them does nothing outward. No provider is called, no timer starts
 * and no setting is required: an install with no account answers exactly as
 * one without this code, and the sweep queues no job while there is neither an
 * account nor a stored event. The inbound core itself is built in
 * `compose.ts`, and this adds SMS to it as one channel.
 *
 * The send path is built in `compose.ts`, because it needs the job queue and
 * the outbox, and joined through {@link SmsWiring.joinSendPath}. Before that a
 * delivery report finds no message and no STOP confirmation is sent: the STOP
 * itself still goes on the list.
 *
 * Conversations (`threads/`) are the inbound channel's `replies` hook: an
 * ordinary reply is kept in its thread, or answered "not read" when its app's
 * replies are off. Their answers go through the same send path.
 */
import { readJsonFrom, settingsRepo, type ConsentPerson, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { storedPublicOrigin } from '../email/door-reach.js';
import type { InboundCore, InboundWiring } from '../inbound/index.js';
import { businessName } from '../privacy/business.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import type { LockReason } from '../trial/operator-lock.js';
import { createSmsAccountStore } from './account-store.js';
import { createTextConsentService, type TextConsentService } from './consent/index.js';
import { storedDefaultCountry } from './country.js';
import { createTextErasure, type TextErasure } from './erasure.js';
import { createSmsCatchUp, createSmsInboundChannel, type SmsCatchUpResult, type SmsInboundChannel, type SmsStopConfirmation } from './inbound/index.js';
import { smsConsoleRoutes } from './console-routes.js';
import { smsRoutes } from './routes.js';
import { createTextSendStore, textPhoneKeys, TEXT_SETTLE_JOB, TEXT_SETTLE_SCHEDULE, type TextReport, type TextSendPath, type TextSendStore } from './send/index.js';
import { createTextMarketingStore, type TextMarketingStore } from './marketing/store.js';
import { createSmsService, type SmsService } from './service.js';
import { createSmsTestGate } from './test-gate.js';
import { createTextThreads, textsRoutes, type RecordPhone, type TextApp, type TextThreads, type TextThreadsDeps } from './threads/index.js';

export interface SmsWiringDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  /** The server's one inbound core, which this adds its channel to. */
  inbound: Pick<InboundWiring, 'core' | 'addChannel'>;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  /** The operator's answer for `smsProviders`. */
  operator: () => { allowed: boolean; reason: LockReason | null };
  log: { info(fields: Record<string, unknown>, message: string): void };
  /** The app whose table a row is in: what makes a text yes count for that app alone. Without it a yes on a row counts for that row alone. */
  appOfRow?: ((person: ConsentPerson) => Promise<string | null>) | undefined;
  /** For conversations: who a text is from, the business's clock and language, and a realtime notice. Each has a plain default. */
  conversations?: Partial<Pick<TextThreadsDeps, 'business' | 'zone' | 'locale' | 'apps' | 'notify'>> | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
}

/** The installed apps, and where each manifest starts its replies. Read from the stored manifests, one row per app key. */
export async function installedTextApps(meta: MetaDb): Promise<TextApp[]> {
  const rows = await meta.db.selectFrom('adminium_manifests').select(['manifestKey', 'manifest']).where('kind', '=', 'app').execute();
  const out = new Map<string, TextApp>();
  for (const row of rows) {
    const document = readJsonFrom<{ name?: unknown; textReplies?: unknown } | null>(meta, row.manifest);
    const replies = document?.textReplies === 'off' ? 'off' : 'on';
    const known = out.get(row.manifestKey);
    // Two copies of one app: the stricter word holds.
    if (known === undefined) out.set(row.manifestKey, { key: row.manifestKey, name: typeof document?.name === 'string' ? document.name : row.manifestKey, replies });
    else if (replies === 'off') known.replies = 'off';
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
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
  /** Marketing runs, who they reach, and requests to confirm a marketing yes (`marketing/`). */
  marketing: TextMarketingStore;
  erasure: TextErasure;
  /** Two-way conversations: the replies hook, the threads and their answers. */
  threads: TextThreads;
  defaultCountry: () => Promise<string | null>;
  settingsRoutes(): FastifyPluginAsyncZod;
  /** Studio → Texts beside the provider card: limits, Activity, the do-not-text list, text templates. */
  consoleRoutes(): FastifyPluginAsyncZod;
  /** Texts → Conversations, the replies switches, and "Send a text" on a record. */
  conversationRoutes(input: { recordPhone?: ((request: FastifyRequest, input: { connection: string; table: string; row: string; column: string }) => Promise<RecordPhone | null>) | undefined }): FastifyPluginAsyncZod;
  /** Queues the clean-up of the send path, when there is a delivery for it to look at. */
  enqueueTextSettle(enqueue: (input: EnqueueJobInput) => Promise<{ id: string }>): Promise<{ id: string } | null>;
  /** Asks the provider what arrived while the server was down. Null when it may not reach out. */
  catchUpAtBoot(): Promise<SmsCatchUpResult | null>;
  /** The text send path, for whatever sends a text. Null until it is joined. */
  readonly texts: TextSendPath | null;
  joinSendPath(path: TextSendPath): void;
}

export function createSmsWiring(deps: SmsWiringDeps): SmsWiring {
  const { meta, secret } = deps;
  const now = deps.now ?? Date.now;
  const defaultCountry = storedDefaultCountry(meta);
  const accounts = createSmsAccountStore(meta);
  const consent = createTextConsentService({ meta, secret, now, appOf: deps.appOfRow });
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

  let sendPath: TextSendPath | null = null;
  const conversations = deps.conversations ?? {};
  const threads = createTextThreads({
    meta,
    secret,
    consent,
    sms: { view: () => service.view() },
    texts: () => sendPath,
    business: conversations.business ?? (async () => ({ name: await businessName(meta) })),
    zone: conversations.zone ?? (async () => null),
    locale: conversations.locale ?? (async () => null),
    apps: conversations.apps ?? (() => installedTextApps(meta)),
    notify: conversations.notify,
    now,
  });
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
    replies: (reply) => threads.received(reply),
    networkFeatures: deps.networkFeatures,
    desktop: deps.desktop,
    trustProxy: deps.trustProxy,
    operatorOff: () => !deps.operator().allowed,
    onCatchUp: (result) => deps.log.info({ catchUp: result.outcome, stored: result.stored, truncated: result.truncated, unreadable: result.unreadable, otherProfile: result.otherProfile }, 'sms catch-up'),
    fetch: deps.fetch,
    now,
  });
  deps.inbound.addChannel(channel);
  const inbound = deps.inbound.core;
  const marketing = createTextMarketingStore(meta);
  const erasure = createTextErasure({
    meta,
    consent,
    inbound,
    deliveries,
    phoneKeys: textPhoneKeys(meta, secret),
    threads,
    country: defaultCountry,
    marketing: { eraseFor: async (who) => (await marketing.recipients.eraseFor(who)) + (await marketing.confirmations.eraseFor(who)), countFor: async (who) => (await marketing.recipients.countFor(who)) + (await marketing.confirmations.countFor(who)) },
  });

  return {
    service,
    consent,
    channel,
    inbound,
    deliveries,
    marketing,
    erasure,
    threads,
    defaultCountry,

    get texts() {
      return sendPath;
    },

    settingsRoutes: () =>
      smsRoutes({
        service,
        manageGrant: PERMISSIONS.smsManage,
        operator: deps.operator,
        networkFeatures: deps.networkFeatures,
        desktop: deps.desktop,
        trustProxy: deps.trustProxy,
        publicOrigin: () => storedPublicOrigin(meta),
        // The send path's own settings: a test takes a slot of the same day's limit.
        testGate: createSmsTestGate({ meta, secret, store: deliveries, policy: () => settingsRepo(meta).get('sms.sendPolicy').catch(() => null), now }),
      }),

    consoleRoutes: () =>
      smsConsoleRoutes({
        meta,
        service,
        consent,
        deliveries,
        texts: () => sendPath,
        manageGrant: PERMISSIONS.smsManage,
        peopleGrant: PERMISSIONS.privacyPeople,
        now,
      }),
    conversationRoutes: (input) =>
      textsRoutes({
        threads,
        manageGrant: PERMISSIONS.smsManage,
        replyReach: () => channel.replyReach(),
        country: defaultCountry,
        recordPhone: input.recordPhone,
      }),

    async enqueueTextSettle(enqueue) {
      // Deliveries to settle, or conversations to keep to their time.
      const any = (await meta.db.selectFrom('adminium_text_deliveries').select('id').limit(1).executeTakeFirst()) !== undefined || (await threads.any());
      if (!any) return null;
      return enqueue({ kind: TEXT_SETTLE_JOB, payload: {}, dedupeKey: TEXT_SETTLE_SCHEDULE, maxAttempts: 1 });
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
