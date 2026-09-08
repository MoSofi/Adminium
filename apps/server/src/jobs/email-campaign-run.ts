// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `email.campaign-run` job — one run of one campaign to its audience
 * (39-email-templates-and-campaigns.md D11, D12; 39-T15).
 *
 * ONE JOB PER RUN, an in-process loop over the recipients, NO per-recipient
 * job rows and NO sealed envelopes: nothing rendered is stored. The run row
 * (`adminium_email_runs`) is the record — counts, the first hundred failures,
 * and the status the manager derives a campaign's pill from (D2).
 *
 * THE DOCUMENT IS LIVE, NOT A SNAPSHOT (D11). The campaign is read when the
 * run starts, so an operator can edit until the moment it goes out; cancel is
 * the explicit way to stop a scheduled one. Each recipient gets the language
 * variation matching their locale when that variation exists and is
 * translated, else the variation the send was started from.
 *
 * DELIVERY IS SEQUENTIAL on today's one-connection-per-message transport
 * (D11): a run of ten thousand is tens of minutes with visible progress on
 * `jobs:<id>`; pooling is a transport change with its own tests (§5).
 *
 * ONE RETRY, THEN A COUNTED FAILURE. A relay's transient refusal is retried
 * once after a short pause; a second refusal counts the address as failed and
 * moves on — a campaign must not stall on one bad mailbox, and the run's
 * `failures` is where an operator finds it.
 *
 * CANCELLATION IS COOPERATIVE (08 §2.17). `POST /email-runs/:id/cancel` on a
 * running run aborts the worker's signal; this loop checks it before every
 * send, records `cancelled` with the counts so far, and stops.
 *
 * `maxAttempts: 1` — a run that throws (no SMTP, a vanished campaign) is
 * terminal with its reason on the row; re-running a campaign is an operator's
 * decision, never the worker's backoff.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { z } from 'zod';
import {
  emailRunsRepo,
  emailTemplatesRepo,
  settingsRepo,
  EMAIL_RUN_FAILURES_MAX,
  type EmailRunFailure,
  type EmailTemplate,
  type MetaDb,
} from '@adminium/meta';

import { EMAIL_CAMPAIGN_SENT_KIND, recipientVars, resolveCampaignAudience } from '../email/audience.js';
import { createSmtpTransport, emailSecretKey, resolveSmtpConfig } from '../email/config.js';
import { deliverPrepared } from '../email/deliver.js';
import { renderEmail } from '../email/render.js';
import { prepareEmail, resolveGeneratedAttachments, inlineRefs, type PreparedEmail } from '../email/send.js';
import type { EmailTransport, OutboundAttachment, SmtpConfig } from '../email/types.js';
import type { FileStore } from '../files/store.js';
import { recipientLocale, translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { resolveEmailParts } from './email-send.js';
import { JobCancelledError, type JobHandlerContext, type JobRegistry } from './registry.js';

export const EMAIL_CAMPAIGN_RUN_KIND = 'email.campaign-run';

/** A run that throws is terminal — see the header. */
export const EMAIL_CAMPAIGN_RUN_MAX_ATTEMPTS = 1;

/** The pause before the one retry of a refused send. */
const RETRY_DELAY_MS = 500;

export const emailCampaignRunPayloadSchema = z.object({
  runId: z.string().min(1).max(36),
  templateId: z.string().min(1).max(36),
  /** Owner convention (routes/jobs `jobOwnerId`): the creator may follow `jobs:<id>`. */
  userId: z.string().optional(),
});
export type EmailCampaignRunPayload = z.infer<typeof emailCampaignRunPayloadSchema>;

export interface EmailCampaignRunDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET` — opens `email.smtp.passEncrypted`. */
  secret: string;
  /** Transport factory; tests inject a recorder instead of a socket. */
  createTransport?: ((cfg: SmtpConfig) => EmailTransport) | undefined;
  /** Where attachment and inline-image bytes are read from (D8/D9). */
  storage?: FileStore | undefined;
  /** `app.realtime`, for the creator's in-app notice; optional in tests. */
  hub?: NotificationPublisher | undefined;
  /** Test seam: the pause before the one retry. */
  retryDelayMs?: number | undefined;
}

/** Everything one language variation contributes, resolved once per run. */
interface VariantPack {
  row: EmailTemplate;
  prepared: PreparedEmail;
  parts: OutboundAttachment[];
}

async function packVariant(deps: EmailCampaignRunDeps, row: EmailTemplate): Promise<VariantPack> {
  const prepared = await prepareEmail(deps.meta, row);
  // Inline parts (the mark, Files images) are the same for every recipient;
  // fixed attachments too. Resolved once, reused for the whole run.
  const probe = renderEmail({ ...prepared.render, locale: row.locale, vars: {}, dir: 'ltr' });
  const parts = await resolveEmailParts(deps, { inline: inlineRefs(probe), attachments: prepared.attachments });
  return { row, prepared, parts };
}

/** Registers the `email.campaign-run` handler on `registry` (internal kind). */
export function registerEmailCampaignRunHandler(registry: JobRegistry, deps: EmailCampaignRunDeps): void {
  const makeTransport = deps.createTransport ?? createSmtpTransport;
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;

  registry.registerJobHandler(
    EMAIL_CAMPAIGN_RUN_KIND,
    emailCampaignRunPayloadSchema,
    async (payload, ctx: JobHandlerContext) => {
      const { meta } = deps;
      const runs = emailRunsRepo(meta);
      const templates = emailTemplatesRepo(meta);
      const run = await runs.findById(payload.runId);
      if (run === null) throw new Error(`campaign run ${payload.runId} no longer exists`);
      // Cancelled between the enqueue and the claim (the cancel route could not
      // reach the job): nothing to do, and nothing to record over the cancel.
      if (run.status === 'cancelled') return { runId: run.id, status: 'cancelled', sent: 0 };

      const now = Date.now();
      const fail = async (error: string): Promise<never> => {
        await runs.update(run.id, { status: 'failed', finishedAt: Date.now(), failures: [{ to: '', error }] });
        throw new Error(error);
      };

      const campaign = await templates.findById(run.templateId);
      if (campaign === null || campaign.kind !== 'campaign' || campaign.archivedAt !== null) {
        return await fail('the campaign was deleted or archived before the run started');
      }
      const config = await resolveSmtpConfig(meta, emailSecretKey(deps.secret));
      if (config === null) return await fail('SMTP is not configured — the campaign cannot be sent');

      await runs.update(run.id, { status: 'running', startedAt: now, jobId: ctx.jobId });
      ctx.progress(0, { step: 'audience', message: 'resolving recipients' });

      // Live audience, live document (D11).
      const audience = await resolveCampaignAudience(meta, run.audience);
      const total = audience.total;
      const siblings = (await templates.siblings(campaign.key)).filter(
        (s) => s.archivedAt === null && !s.needsTranslation,
      );
      const appName = await settingsRepo(meta).get('branding.appName');
      const transport = makeTransport(config);
      const packs = new Map<string, VariantPack>();
      const packFor = async (row: EmailTemplate): Promise<VariantPack> => {
        let pack = packs.get(row.id);
        if (pack === undefined) {
          pack = await packVariant(deps, row);
          packs.set(row.id, pack);
        }
        return pack;
      };

      let sent = 0;
      let failed = 0;
      const failures: EmailRunFailure[] = [];
      let cancelled = false;
      const report = (): void => {
        const done = sent + failed + audience.skipped;
        ctx.progress(total === 0 ? 100 : Math.min(99, Math.round((done / total) * 100)), {
          step: 'send',
          message: `${String(done)} of ${String(total)}`,
        });
      };
      report();

      for (const user of audience.recipients) {
        if (ctx.signal.aborted) {
          cancelled = true;
          break;
        }
        const locale = await recipientLocale(meta, user.id);
        const variant = siblings.find((s) => s.locale === locale) ?? campaign;
        const pack = await packFor(variant);
        const vars = recipientVars(user, appName);
        const generated = await resolveGeneratedAttachments(meta, variant.attachments, vars, {
          info: () => {},
          warn: (obj, msg) => ctx.log(msg ?? 'generated attachment skipped', obj),
        });
        const generatedParts = generated.length === 0 ? [] : await resolveEmailParts(deps, { attachments: generated });
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            // The render-and-send core is shared with the automation email
            // step (42 D15); the retry above it and the per-variation pack
            // caching below it are this runner's own.
            await deliverPrepared({
              transport,
              prepared: pack.prepared,
              locale: variant.locale,
              to: user.email,
              vars,
              parts: [...pack.parts, ...generatedParts],
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            if (attempt === 1 && !ctx.signal.aborted) await sleep(retryDelayMs);
          }
        }
        if (lastError === null) sent += 1;
        else {
          failed += 1;
          if (failures.length < EMAIL_RUN_FAILURES_MAX) failures.push({ to: user.email, error: lastError });
        }
        report();
        // A cancel that landed during this send stops the run here — the send
        // that completed still counts (it went out), nothing after it starts.
        if (ctx.signal.aborted) {
          cancelled = true;
          break;
        }
      }

      const status = cancelled ? 'cancelled' : sent === 0 && audience.recipients.length > 0 ? 'failed' : 'sent';
      await runs.update(run.id, {
        status,
        finishedAt: Date.now(),
        total,
        sent,
        failed,
        skipped: audience.skipped,
        failures,
        jobId: ctx.jobId,
      });

      // The creator's notice (D11) — best-effort, like every courtesy row.
      if (run.createdBy !== null && !cancelled) {
        try {
          const { t } = await translatorFor(meta, run.createdBy);
          await notify(
            meta,
            {
              userId: run.createdBy,
              kind: EMAIL_CAMPAIGN_SENT_KIND,
              title: t('email.campaignSent.title', { name: campaign.name, defaultValue: 'Campaign sent: {name}' }),
              body: t('email.campaignSent.body', {
                sent: String(sent),
                failed: String(failed),
                defaultValue: '{sent} sent · {failed} failed',
              }),
              actionUrl: `/email-templates?kind=campaign&open=${campaign.id}`,
            },
            { hub: deps.hub, email: false },
          );
        } catch (error) {
          ctx.log('could not notify the campaign creator', { err: error instanceof Error ? error.message : String(error) });
        }
      }

      if (cancelled) throw new JobCancelledError(ctx.jobId);
      ctx.progress(100, { step: 'done', message: `${String(sent)} sent · ${String(failed)} failed` });
      return { runId: run.id, status, sent, failed, skipped: audience.skipped };
    },
    { internal: true },
  );
}
