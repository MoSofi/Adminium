// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `email.campaign-run` job — one short batch of one campaign run.
 *
 * A RUN IS A CHAIN OF SHORT BATCHES ON A LEDGER. The first batch writes every
 * recipient down (`adminium_email_sends`, `email-campaign-recipients.ts`) and
 * freezes the campaign's content; each batch then claims a few `queued` rows,
 * hands each to the `email.send` queue as a sealed envelope (the app outbox's
 * way), and queues the next batch, spaced by the run's hourly cap. One long
 * job could not do this: the queue reclaims a job whose lock is five minutes
 * stale, a clean stop aborts what is in flight after ten seconds, and a
 * process has two job slots, which a 50-hour send would hold for 50 hours.
 * A batch hands at most {@link CAMPAIGN_BATCH_MAX} rows and stops taking new
 * ones after {@link CAMPAIGN_BATCH_BUDGET_MS}, far inside both limits.
 *
 * AT MOST ONCE, AND NEVER LOST. A row leaves `queued` only under a batch's
 * fresh claim token. It is handed over in ONE transaction that counts it on
 * the run (only while the run is `running` and this job is the head of its
 * chain), queues its `email.send` job, and marks it `sent` (only while it is
 * still `sending` under this token). So a handed row has its message queued
 * and a row whose message is queued is marked handed: a crash between the
 * two is impossible. Every batch starts by putting back whatever rows an
 * earlier batch claimed and did not hand: that batch died (a `kill -9`,
 * whose job the queue reclaims after its lock goes stale), was stopped
 * cleanly mid-batch, or lost the head to a "go on". If it is somehow still
 * running, its rows are no longer under its token and it can hand none of
 * them. The message itself then has the mail queue's five tries; when the
 * last one fails the row turns `failed` ({@link campaignGaveUp}).
 *
 * THE CHAIN HAS ONE HEAD. The run's `job_id` names the batch job allowed to
 * work on it. A batch queues its successor and moves the head to it in one
 * transaction; a job that is not the head (an old one a pause left pending,
 * a reclaimed job whose run went on without it) does nothing.
 *
 * PAUSE AND STOP are run states the batches read: a hand-over refuses once
 * the run is not `running`, and the batch then queues nothing. "Go on" queues
 * a new head; "stop for good" leaves the rest `queued` for ever.
 *
 * THE CAP is a count of messages handed in the current hour that every run
 * and every process shares (`emailSendCountersRepo`): a batch takes no more
 * rows than its run's cap leaves in the hour, and when nothing is left it
 * waits for the next hour. Between batches it waits `size / rate` hours, so a
 * run at 100 an hour hands two every 72 seconds.
 *
 * THE CONTENT IS FROZEN when the run starts: the campaign in every language
 * it is sent in, copied to `adminium_email_run_contents`. An edit afterwards
 * changes the next send, not this one; a campaign deleted meanwhile leaves
 * the run, its content and its log.
 *
 * THE RECIPIENT'S LANGUAGE is the one written on their row: the variation in
 * that language when the campaign has it translated, else the one the send
 * was started from.
 *
 * THREE SEAMS: a check of each row at each batch (the do-not-email list and
 * the consent log, `email-campaign-checks.ts`), a check once per batch that
 * the run may still send at all (the sender checks; its creator can still
 * read the audience), and what a row's message carries besides the campaign
 * (a marketing run's unsubscribe headers and locked footer).
 *
 * A RUN MADE BEFORE THE LEDGER (no `state`) that a crash left `running`
 * cannot know who was mailed, so it is never sent again: it is recorded
 * `failed` with the reason. One still `scheduled` starts on the ledger.
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import {
  emailRunsRepo,
  emailSendCountersRepo,
  emailSendsRepo,
  emailTemplatesRepo,
  jobsRepo,
  settingsRepo,
  EMAIL_CAMPAIGN_COUNTER_BUCKET,
  type EmailRun,
  type EmailRunContent,
  type EmailRunContentVariant,
  type EmailSend,
  type EmailSendInput,
  type MetaDb,
} from '@adminium/meta';
import { dirForLocale, isLocaleId } from '@adminium/i18n';

import { EMAIL_CAMPAIGN_SENT_KIND, recipientVars } from '../email/audience.js';
import { emailSecretKey, resolveSmtpConfig } from '../email/config.js';
import { renderEmail, type RenderedEmail } from '../email/render.js';
import {
  enqueueRenderedEmail,
  prepareEmail,
  resolveGeneratedAttachments,
  type EmailSendReport,
  type PreparedEmail,
} from '../email/send.js';
import type { MarketingCarry } from '../email/marketing.js';
import type { EmailSendAttachmentRef } from '../email/types.js';
import { translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { campaignRecipients, writeRecipients, type TableAudience } from './email-campaign-recipients.js';
import { JobCancelledError, type JobHandlerContext, type JobRegistry } from './registry.js';

export const EMAIL_CAMPAIGN_RUN_KIND = 'email.campaign-run';

/**
 * A batch that throws (the meta store away for a moment) is tried again on the
 * queue's backoff: every batch is safe to run twice.
 */
export const EMAIL_CAMPAIGN_RUN_MAX_ATTEMPTS = 5;

/** The most rows one batch hands over. */
export const CAMPAIGN_BATCH_MAX = 50;

/** After this long a batch takes no new row; what it claimed and did not reach goes back. */
export const CAMPAIGN_BATCH_BUDGET_MS = 60_000;

/** How a ledger row names itself to the mail queue, so a message that fails for good finds its row. */
export const CAMPAIGN_REPORT_APP = 'adminium.campaign';
export const CAMPAIGN_REPORT_TABLE = 'adminium_email_sends';

export const emailCampaignRunPayloadSchema = z.object({
  runId: z.string().min(1).max(36),
  /** The campaign the run was started from; informational (a deleted campaign leaves it behind). */
  templateId: z.string().min(1).max(36).optional(),
  /** Owner convention (routes/jobs `jobOwnerId`): the creator may follow `jobs:<id>`. */
  userId: z.string().optional(),
});
export type EmailCampaignRunPayload = z.infer<typeof emailCampaignRunPayloadSchema>;

/** What the row check says: send it, or leave it out with a state and a reason code. */
export type CampaignRowVerdict = 'send' | { skip: 'skipped-stop' | 'skipped-consent'; reason: string };

/** What the batch check says: go on, or stop the run for good with the reason. */
export type CampaignBatchVerdict = 'send' | { refuse: string };

export interface CampaignSeams {
  /** Each row, at each batch, just before it is handed over. */
  checkRow?: ((row: EmailSend, run: EmailRun) => Promise<CampaignRowVerdict>) | undefined;
  /** Once per batch, before any row is claimed. */
  checkBatch?: ((run: EmailRun) => Promise<CampaignBatchVerdict>) | undefined;
  /**
   * What a row's message carries besides the campaign (a marketing run's
   * unsubscribe headers and locked footer, and its click links when counted);
   * null for nothing. Asked after `checkRow` passed the row, in the variant's
   * language.
   */
  carryFor?: ((row: EmailSend, run: EmailRun, locale: string) => Promise<(MarketingCarry & { clicks?: ((html: string) => string) | undefined }) | null>) | undefined;
  /**
   * The recipients of an audience that reads a source table (a table's
   * people): the first batch writes them down. Without it such a run
   * writes nobody.
   */
  tableRecipients?: ((run: EmailRun, audience: TableAudience) => AsyncIterable<EmailSendInput>) | undefined;
  /**
   * What a row's message fills its placeholders with, when the audience
   * gives more than a workspace user's four (a table's own columns); null
   * keeps those four. Asked after `checkRow` passed the row.
   */
  varsFor?: ((row: EmailSend, run: EmailRun, appName: string) => Promise<Record<string, string> | null>) | undefined;
}

export interface EmailCampaignRunDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET` — seals each message and opens `email.smtp.passEncrypted`. */
  secret: string;
  /** `app.realtime`, for the creator's in-app notice; optional in tests. */
  hub?: NotificationPublisher | undefined;
  /** Clock; tests move it. Every time the ledger, the counter and the queue are told comes from it. */
  now?: (() => number) | undefined;
  seams?: CampaignSeams | undefined;
  /** Test seams: rows per batch and the batch's time budget. */
  batchMax?: number | undefined;
  budgetMs?: number | undefined;
}

/** How many rows a batch takes at `rate` an hour, and how long the next one waits. */
export function batchPlan(rate: number | null, max: number = CAMPAIGN_BATCH_MAX): { size: number; gapMs: number } {
  if (rate === null) return { size: max, gapMs: 0 };
  const size = Math.max(1, Math.min(max, Math.ceil(rate / 60)));
  return { size, gapMs: Math.ceil((size * 3_600_000) / rate) };
}

/** Minutes `count` messages take at `rate` an hour; null when the rate is "as fast as the server allows". */
export function estimateMinutes(count: number, rate: number | null): number | null {
  if (rate === null) return null;
  return Math.ceil((count * 60) / rate);
}

/** The report a campaign message carries to the mail queue. */
function reportOf(row: EmailSend): EmailSendReport {
  return { app: CAMPAIGN_REPORT_APP, connectionId: row.runId, table: CAMPAIGN_REPORT_TABLE, pk: { id: row.id } };
}

export function isCampaignReport(report: EmailSendReport): boolean {
  return report.app === CAMPAIGN_REPORT_APP && report.table === CAMPAIGN_REPORT_TABLE;
}

/**
 * The mail queue gave up on a campaign message after its last try: its row
 * turns `failed` with what the server said, and the run counts one less sent
 * and one more failed.
 */
export async function campaignGaveUp(meta: MetaDb, report: EmailSendReport, error: unknown, at: number = Date.now()): Promise<void> {
  const id = report.pk['id'];
  if (typeof id !== 'string') return;
  const message = error instanceof Error ? error.message : String(error);
  // Refused for good at send time: a bounce, and the address is already on the do-not-email list.
  const bounced = error instanceof Error && error.name === 'PermanentlyRefusedError';
  const row = await emailSendsRepo(meta).markGivenUp(id, message, at, bounced ? 'bounced' : 'failed');
  if (row === null) return;
  const runs = emailRunsRepo(meta);
  await runs.countGivenUp(row.runId);
  await runs.noteFailure(row.runId, { to: row.address, error: message }, at);
}

/** The mail queue's give-up hook: campaign rows here, everything else to `next` (the app outbox). */
export function withCampaignGiveUp(
  meta: MetaDb,
  next?: ((report: EmailSendReport, error: unknown) => Promise<void>) | undefined,
): (report: EmailSendReport, error: unknown) => Promise<void> {
  return async (report, error) => {
    if (isCampaignReport(report)) await campaignGaveUp(meta, report, error);
    else if (next !== undefined) await next(report, error);
  };
}

/** A hand-over that found the run or the row no longer its to hand. */
class Lost extends Error {
  constructor(readonly what: 'run' | 'row') {
    super(`the ${what} was taken back`);
  }
}

/** A message the mail layer would not queue (no secret, an empty address). */
class NotQueued extends Error {}

interface Pack {
  variant: EmailRunContentVariant;
  prepared: PreparedEmail;
}

interface Message {
  to: string;
  locale: string;
  rendered: RenderedEmail;
  from: string | undefined;
  attachments: EmailSendAttachmentRef[];
  /** A marketing run's list headers. */
  headers?: Record<string, string> | undefined;
}

/** Registers the `email.campaign-run` handler on `registry` (internal kind). */
export function registerEmailCampaignRunHandler(registry: JobRegistry, deps: EmailCampaignRunDeps): void {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const runs = emailRunsRepo(meta);
  const sends = emailSendsRepo(meta);
  const counters = emailSendCountersRepo(meta);
  const templates = emailTemplatesRepo(meta);
  const batchMax = deps.batchMax ?? CAMPAIGN_BATCH_MAX;
  const budgetMs = deps.budgetMs ?? CAMPAIGN_BATCH_BUDGET_MS;

  /** Ends a run that cannot go on, with the reason; nothing more is handed. */
  async function fail(run: EmailRun, error: string): Promise<{ runId: string; status: 'failed'; error: string }> {
    await runs.update(run.id, { status: 'failed', state: 'done', finishedAt: now(), failures: [...run.failures, { to: '', error }].slice(0, 100) });
    return { runId: run.id, status: 'failed', error };
  }

  /**
   * The first batch: freeze the content, write the recipients, move the run to
   * `running`. Null when the run cannot start (it failed, or was cancelled
   * meanwhile).
   */
  async function start(run: EmailRun, ctx: JobHandlerContext): Promise<EmailRun | { runId: string; status: string; error?: string } > {
    const campaign = run.templateId === null ? null : await templates.findById(run.templateId);
    if (campaign === null || campaign.kind !== 'campaign' || campaign.archivedAt !== null) {
      return await fail(run, 'the campaign was deleted or archived before the run started');
    }
    if ((await resolveSmtpConfig(meta, emailSecretKey(deps.secret))) === null) {
      return await fail(run, 'SMTP is not configured — the campaign cannot be sent');
    }
    if (run.state === null) await runs.moveState(run.id, [null], 'running');
    const at = now();
    ctx.progress(0, { step: 'audience', message: 'writing recipients' });
    // What a start that died half-way wrote is written again: nothing was handed before `running`.
    await sends.clearRun(run.id);
    await runs.dropContent(run.id);
    const siblings = (await templates.siblings(campaign.key)).filter((s) => s.id !== campaign.id && s.archivedAt === null && !s.needsTranslation);
    const variants: EmailRunContentVariant[] = [campaign, ...siblings].map((row) => ({
      templateId: row.id,
      locale: row.locale,
      name: row.name,
      subject: row.subject,
      preheader: row.preheader,
      blocks: row.blocks,
      footer: row.footer,
      brand: row.brand,
      attachments: row.attachments,
    }));
    const content = await runs.freeze(run.id, { name: campaign.name, templateKey: campaign.key, variants }, at);
    const written = await writeRecipients(meta, run.id, campaignRecipients(meta, run.audience, { run, table: deps.seams?.tableRecipients }), at);
    if (!(await runs.start(run.id, { contentId: content.id, total: written.total, skipped: written.skipped, jobId: ctx.jobId }, at))) {
      // Cancelled while the recipients were written: it never started, so it keeps no log.
      await sends.clearRun(run.id);
      await runs.dropContent(run.id);
      return { runId: run.id, status: 'cancelled' };
    }
    return (await runs.findById(run.id)) ?? run;
  }

  /** Queues the next batch at `runAt` and makes it the head; false when this job was no longer the head. */
  async function queueNext(run: EmailRun, from: string, runAt: number): Promise<boolean> {
    try {
      await meta.db.transaction().execute(async (trx) => {
        const tx = { ...meta, db: trx } as MetaDb;
        const job = await jobsRepo(tx).enqueue(
          {
            kind: EMAIL_CAMPAIGN_RUN_KIND,
            payload: {
              runId: run.id,
              ...(run.templateId === null ? {} : { templateId: run.templateId }),
              ...(run.createdBy === null ? {} : { userId: run.createdBy }),
            },
            runAt,
            maxAttempts: EMAIL_CAMPAIGN_RUN_MAX_ATTEMPTS,
          },
          now(),
        );
        if (!(await emailRunsRepo(tx).advance(run.id, from, job.id, now()))) throw new Lost('run');
      });
      return true;
    } catch (error) {
      if (error instanceof Lost) return false;
      throw error;
    }
  }

  /** The run has nobody left: `sent` (or `failed` when nothing went and something failed), and the creator told. */
  async function finish(run: EmailRun, content: EmailRunContent | null): Promise<void> {
    const status = run.sent === 0 && run.failed > 0 ? 'failed' : 'sent';
    if (!(await runs.moveState(run.id, ['running'], 'done', { status, finishedAt: now(), statuses: ['running'] }))) return;
    // Old hours of the shared count are read by nobody.
    await counters.gc(now() - 3_600_000).catch(() => 0);
    if (run.createdBy === null) return;
    try {
      const { t } = await translatorFor(meta, run.createdBy);
      await notify(
        meta,
        {
          userId: run.createdBy,
          kind: EMAIL_CAMPAIGN_SENT_KIND,
          title: t('email:campaignSent.title', { name: content?.name ?? '', defaultValue: 'Campaign sent: {name}' }),
          body: t('email:campaignSent.body', { sent: String(run.sent), failed: String(run.failed), defaultValue: '{sent} sent · {failed} failed' }),
          actionUrl: run.templateId === null ? '/email-templates?kind=campaign' : `/email-templates?kind=campaign&open=${run.templateId}`,
        },
        { hub: deps.hub, email: false },
      );
    } catch {
      // The creator's notice is a courtesy row; the run is finished whatever it does.
    }
  }

  registry.registerJobHandler(
    EMAIL_CAMPAIGN_RUN_KIND,
    emailCampaignRunPayloadSchema,
    async (payload, ctx: JobHandlerContext) => {
      const found = await runs.findById(payload.runId);
      if (found === null) return { runId: payload.runId, status: 'gone' };
      if (found.status === 'cancelled' || found.status === 'sent' || found.status === 'failed') {
        return { runId: found.id, status: found.status };
      }
      // Not the head of the run's chain: an old job a pause left, or one whose run went on without it.
      if (found.jobId !== ctx.jobId) return { runId: found.id, status: found.status, superseded: true };
      // A run from before the ledger that a crash left sending: who got it is not known (see the header).
      if (found.status === 'running' && found.state === null) {
        return await fail(found, 'the server stopped while this run was sending; it was not restarted, so nobody is mailed twice — some recipients may not have received it');
      }
      if (found.state === 'paused' || found.state === 'stopped' || found.state === 'done') return { runId: found.id, state: found.state };

      let run = found;
      if (run.status === 'scheduled') {
        const started = await start(run, ctx);
        if (!('audience' in started)) return started;
        run = started;
      }

      const verdict = deps.seams?.checkBatch === undefined ? 'send' : await deps.seams.checkBatch(run);
      if (verdict !== 'send') {
        await sends.releaseClaims(run.id, now());
        if (await runs.moveState(run.id, ['running', 'paused'], 'stopped', { status: 'failed', finishedAt: now() })) {
          await runs.noteFailure(run.id, { to: '', error: verdict.refuse }, now());
        }
        return { runId: run.id, status: 'failed', error: verdict.refuse };
      }

      // Whatever an earlier batch claimed and did not hand over goes back first (see the header).
      await sends.releaseClaims(run.id, now());

      const plan = batchPlan(run.ratePerHour, batchMax);
      let room = plan.size;
      if (run.ratePerHour !== null) {
        room = Math.min(room, run.ratePerHour - (await counters.read(EMAIL_CAMPAIGN_COUNTER_BUCKET, now())));
        if (room <= 0) {
          // The hour's cap is used up, by this run or another: the next batch waits for the next hour.
          await queueNext(run, ctx.jobId, counters.nextWindow(now()));
          return { runId: run.id, handed: 0, waiting: true };
        }
      }

      const token = randomUUID();
      const claimed = await sends.claim(run.id, room, token, now());
      const content = await runs.content(run.id);
      if (content === null) throw new Error(`campaign run ${run.id} has no frozen content`);
      const appName = await settingsRepo(meta).get('branding.appName');
      const packs = new Map<string, Pack>();
      const packFor = async (language: string | null): Promise<Pack> => {
        const variant = content.variants.find((v) => v.locale === language) ?? content.variants[0]!;
        let pack = packs.get(variant.locale);
        if (pack === undefined) {
          pack = { variant, prepared: await prepareEmail(meta, variant) };
          packs.set(variant.locale, pack);
        }
        return pack;
      };
      const messageFor = async (row: EmailSend): Promise<Message> => {
        const { variant, prepared } = await packFor(row.language);
        const vars = (await deps.seams?.varsFor?.(row, run, appName)) ?? recipientVars({ name: row.name, email: row.address }, appName);
        const generated = await resolveGeneratedAttachments(meta, variant.attachments, vars, {
          info: () => {},
          warn: (obj, msg) => ctx.log(msg ?? 'generated attachment skipped', obj),
        });
        const carry = deps.seams?.carryFor === undefined ? null : await deps.seams.carryFor(row, run, variant.locale);
        const drawn = renderEmail({
          ...prepared.render,
          locale: variant.locale,
          vars,
          dir: isLocaleId(variant.locale) ? dirForLocale(variant.locale) : 'ltr',
          ...(carry === null ? {} : { locked: carry.locked }),
        });
        const rendered = carry?.clicks === undefined ? drawn : { ...drawn, html: carry.clicks(drawn.html) };
        return { to: row.address, locale: variant.locale, rendered, from: prepared.from, attachments: [...prepared.attachments, ...generated], ...(carry === null ? {} : { headers: carry.headers }) };
      };
      /** The one transaction that makes a row handed: counted, queued, marked (see the header). */
      const handOver = async (row: EmailSend, message: Message): Promise<'handed' | 'run' | 'row'> => {
        try {
          await meta.db.transaction().execute(async (trx) => {
            const tx = { ...meta, db: trx } as MetaDb;
            if (!(await emailRunsRepo(tx).countHanded(run.id, ctx.jobId))) throw new Lost('run');
            const job = await enqueueRenderedEmail(
              { meta: tx, secret: deps.secret, enqueue: (input) => jobsRepo(tx).enqueue(input, now()) },
              {
                to: message.to,
                templateKey: content.templateKey,
                locale: message.locale,
                rendered: message.rendered,
                from: message.from,
                attachments: message.attachments,
                report: reportOf(row),
                dedupeKey: `email-campaign:${row.id}`,
                // A run to contacts is marketing or service mail; one to the workspace's own people has no class.
                ...(run.mailClass === null ? {} : { mailClass: run.mailClass }),
                ...(message.headers === undefined ? {} : { headers: message.headers }),
              },
            );
            if (job === null) throw new NotQueued('the message could not be queued');
            if (!(await emailSendsRepo(tx).markHanded(row.id, token, job.id, now()))) throw new Lost('row');
          });
          return 'handed';
        } catch (error) {
          if (error instanceof Lost) return error.what;
          throw error;
        }
      };

      const began = Date.now();
      let handed = 0;
      let skipped = 0;
      let failed = 0;
      let aborted = false;
      for (const row of claimed) {
        if (ctx.signal.aborted) {
          aborted = true;
          break;
        }
        if (Date.now() - began > budgetMs) break;
        const check = deps.seams?.checkRow === undefined ? 'send' : await deps.seams.checkRow(row, run);
        if (check !== 'send') {
          if (await sends.settle(row.id, token, check.skip, check.reason, now())) skipped += 1;
          continue;
        }
        let outcome: 'handed' | 'run' | 'row';
        try {
          const message = await messageFor(row);
          if (ctx.signal.aborted) {
            aborted = true;
            break;
          }
          outcome = await handOver(row, message);
        } catch (error) {
          // This row alone fails, before it was handed over, with why; the others go on.
          const reason = error instanceof Error ? error.message : String(error);
          if (await sends.settle(row.id, token, 'failed', reason, now())) {
            failed += 1;
            await runs.noteFailure(run.id, { to: row.address, error: reason }, now());
          }
          continue;
        }
        if (outcome === 'run') break;
        if (outcome === 'handed') {
          handed += 1;
          await counters.hit(EMAIL_CAMPAIGN_COUNTER_BUCKET, now());
        }
      }
      // What this batch claimed and did not get to goes back for the next one.
      await sends.unclaimAll(run.id, token, now());
      await runs.countSettled(run.id, { skipped, failed });

      const fresh = (await runs.findById(run.id)) ?? run;
      const left = await sends.remaining(run.id);
      const done = fresh.total - left;
      ctx.progress(fresh.total === 0 ? 100 : Math.min(99, Math.round((done / fresh.total) * 100)), {
        step: 'send',
        message: `${String(done)} of ${String(fresh.total)}`,
      });
      if (fresh.jobId === ctx.jobId && fresh.state === 'running') {
        if (left === 0) await finish(fresh, content);
        else await queueNext(fresh, ctx.jobId, aborted ? now() : now() + plan.gapMs);
      }
      // A clean stop: the rest goes back, the next batch is queued, and this job reads `cancelled`.
      if (aborted) throw new JobCancelledError(ctx.jobId);
      return { runId: run.id, handed, skipped, failed, left };
    },
    { internal: true },
  );
}
