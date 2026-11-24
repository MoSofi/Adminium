// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MARKETING TEXTS (80-sms-integration.md §4.7, the second release): their own
 * explicit consent, double opt-in where a country expects it, the audience,
 * runs through the one send path, and the console's routes.
 *
 * Put together once for `compose.ts` by {@link createTextMarketing}. Building
 * it does nothing outward: no job is queued and no provider is called until a
 * person makes a run.
 */
import { textTemplatesRepo, type ConsentPerson, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ConnectionManager } from '../../connections/manager.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import type { EmailLogger } from '../../email/send.js';
import type { JobRegistry } from '../../jobs/registry.js';
import type { TrialPolicy } from '../../trial/policy.js';
import type { TextConsentService } from '../consent/types.js';
import type { SmsService } from '../service.js';
import type { TextPhoneKeys, TextSendPath } from '../send/path.js';
import type { TextDelivery, TextSendReport } from '../send/types.js';
import { createTextConfirm, type TextConfirm } from './confirm.js';
import { textMarketingRoutes } from './routes.js';
import { createTextRuns, registerTextRunHandler, TEXT_RUN_REPORT_APP, type TextRuns } from './runs.js';
import type { TextMarketingStore } from './store.js';

export { createTextConfirm, needsConfirm, type ConfirmOutcome, type ConfirmPageState, type ConfirmRequestOutcome, type MarketingStanding, type TextConfirm } from './confirm.js';
export { makeTextConfirmToken, readTextConfirmToken, textConfirmKey, textConfirmUrl, TEXT_CONFIRM_DAYS, TEXT_CONFIRM_PATH } from './confirm-token.js';
export { judgedPages, openTextAudience, textAudienceTables, type JudgedPerson, type TextAudience, type TextAudienceAccess } from './audience.js';
export { preflight, templateRefusals, type Preflight, type RunRefusal } from './preflight.js';
export { createTextRuns, nextDayStart, registerTextRunHandler, TEXT_RUN_BATCH, TEXT_RUN_JOB, TEXT_RUN_REPORT_APP, TEXT_RUN_REPORT_TABLE, TextAudienceRefusedError, TextRunRefusedError, type TextRunPreview, type TextRuns } from './runs.js';
export { createTextMarketingStore, type TextMarketingStore, type TextRun, type TextRecipient } from './store.js';
export * from './types.js';

/** The short job that asks a person to confirm a marketing yes a public form just recorded. */
export const TEXT_CONFIRM_JOB = 'sms.marketing-confirm';
const confirmPayloadSchema = z.object({ connectionId: z.string().min(1).max(64), table: z.string().min(1).max(200), key: z.string().min(1).max(200) }).strict();
/** Long enough for the write that recorded the yes to have finished. */
const CONFIRM_DELAY_MS = 5_000;

export interface TextMarketingDeps {
  meta: MetaDb;
  secret: string;
  manager: Pick<ConnectionManager, 'data'>;
  consent: TextConsentService;
  store: TextMarketingStore;
  sms: Pick<SmsService, 'view'>;
  texts: () => TextSendPath | null;
  replyReach: () => Promise<{ state: string; canReceiveStop: boolean }>;
  policy: Pick<TrialPolicy, 'allows'>;
  country: () => Promise<string | null>;
  /** The stored sending settings: the day's clock and limit. */
  sendPolicy: () => Promise<unknown>;
  phoneKeys: TextPhoneKeys;
  enqueue: (job: EnqueueJobInput) => Promise<{ id: string }>;
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
  logger?: EmailLogger | undefined;
  now?: (() => number) | undefined;
}

export interface TextMarketing {
  runs: TextRuns;
  confirm: TextConfirm;
  routes(): FastifyPluginAsyncZod;
  registerJobs(registry: JobRegistry): void;
  /** After a public form records a marketing yes: the confirmation, a moment later, where the country expects it. */
  afterFormYes(person: ConsentPerson): Promise<unknown>;
  /** Whether a delivery belongs to a marketing run. */
  owns(report: TextSendReport): boolean;
  stillWanted(report: TextSendReport, e164: string): Promise<boolean>;
  settled(report: TextSendReport, delivery: TextDelivery): Promise<void>;
}

export function createTextMarketing(deps: TextMarketingDeps): TextMarketing {
  const operator = (question: 'smsProviders' | 'marketingCampaigns') => deps.policy.allows(question);
  const confirm = createTextConfirm({ meta: deps.meta, secret: deps.secret, consent: deps.consent, store: deps.store, phoneKeys: deps.phoneKeys, manager: deps.manager, country: deps.country, viewFor: deps.viewFor, logger: deps.logger, now: deps.now });
  const runs = createTextRuns({
    meta: deps.meta,
    secret: deps.secret,
    manager: deps.manager,
    consent: deps.consent,
    store: deps.store,
    texts: deps.texts,
    sms: deps.sms,
    replyReach: deps.replyReach,
    operator,
    country: deps.country,
    policy: deps.sendPolicy,
    phoneKeys: deps.phoneKeys,
    enqueue: deps.enqueue,
    now: deps.now,
  });

  async function templates(): Promise<{ key: string; name: string; languages: string[] }[]> {
    const repo = textTemplatesRepo(deps.meta);
    const out: { key: string; name: string; languages: string[] }[] = [];
    for (const key of await repo.liveKeys()) {
      const rows = (await repo.listByKey(key)).filter((row) => row.enabled);
      const name = (rows.find((row) => row.locale === 'en_US') ?? rows[0])?.name ?? key;
      out.push({ key, name, languages: rows.map((row) => row.locale) });
    }
    return out;
  }

  return {
    runs,
    confirm,
    routes: () =>
      textMarketingRoutes({
        meta: deps.meta,
        manager: deps.manager,
        consent: deps.consent,
        country: deps.country,
        sms: deps.sms,
        replyReach: deps.replyReach,
        operator,
        runs,
        confirm,
        policy: deps.policy,
        templates,
      }),
    registerJobs(registry) {
      registerTextRunHandler(registry, () => runs);
      registry.registerJobHandler(TEXT_CONFIRM_JOB, confirmPayloadSchema, async (payload) => ({ outcome: await confirm.request({ person: payload }) }), { internal: true });
    },
    afterFormYes: (person) => deps.enqueue({ kind: TEXT_CONFIRM_JOB, payload: { connectionId: person.connectionId, table: person.table, key: person.key }, runAt: (deps.now ?? Date.now)() + CONFIRM_DELAY_MS, maxAttempts: 3 }),
    owns: (report) => report.app === TEXT_RUN_REPORT_APP,
    stillWanted: (report, e164) => runs.stillWanted(report, e164),
    settled: (report, delivery) => runs.settled(report, delivery),
  };
}
