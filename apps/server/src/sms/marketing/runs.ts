// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MARKETING TEXT RUNS: one text template sent to the people of one table who
 * agreed to marketing texts.
 *
 * ─── What a run is ────────────────────────────────────────────────────────
 * A run freezes its template when it is made (every language switched on),
 * and is started by the `sms.marketing-run` job at its time. The first batch
 * writes every person of the audience down, those left out with their reason
 * (`audience.ts`). Each batch then claims a few people, reads each one's row
 * again as the sender, and hands their text to the ONE send path every text
 * takes (`sms/send/path.ts`): `prepare` as class `marketing`, then `queue`,
 * then the sealed `sms.send` job. Nothing here talks to a provider, and no
 * rule of a text is decided twice: consent, the stop list, the country, the
 * sender, the words, the 09:00–20:00 Monday-to-Saturday window in every zone
 * of the country, and the day's limit are all the send path's.
 *
 * ─── The window ───────────────────────────────────────────────────────────
 * A text queued outside its hours is held in the job queue until they open,
 * for that country (`window.ts`). The run hands it over at once and is done;
 * its people show "sending" until their texts go. A run cancelled meanwhile
 * stops them: the hand-over asks the run whether the text is still wanted.
 *
 * ─── The day's limit ──────────────────────────────────────────────────────
 * A batch takes no more people than the day leaves, counting this run's texts
 * that will take a slot when they go. When the day is used up the run waits
 * (`waiting`) until the next business day on the limit's own clock. A text the
 * hand-over refuses for the limit after all (another text took the last slot)
 * puts its person back in the queue for the next day.
 *
 * ─── Never twice ──────────────────────────────────────────────────────────
 * A person's text is one message (`text-run:<run>:<person>`), and each try of
 * it one claim: a batch that dies after queueing and before writing that down
 * finds its own delivery again. One batch job is the run's head (`job_id`): a
 * job that is not the head does nothing.
 *
 * ─── What a run refuses ───────────────────────────────────────────────────
 * Before it is made, when it starts and at every batch: the preflight
 * (`preflight.ts`) and the audience as the sender reaches it. A refusal at a
 * batch ends the run `failed` with its reason, and everyone still queued is
 * left out with `run-failed`.
 */
import { codeNamesIn } from '@adminium/manifest';
import { textTemplatesRepo, usersRepo, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { resolveMailSender } from '../../email/workspace-sender.js';
import { AppError, ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { businessName } from '../../privacy/business.js';
import { parsePhone } from '../../phone/index.js';
import type { JobHandlerContext, JobRegistry } from '../../jobs/registry.js';
import type { TextConsentService } from '../consent/types.js';
import type { SmsService } from '../service.js';
import { DEFAULT_SERVICE_HOURS, dayKey, readTextPolicy } from '../send/policy.js';
import type { TextPhoneKeys, TextSendPath } from '../send/path.js';
import type { TextDelivery, TextSendReport } from '../send/types.js';
import { judgeWindow } from '../send/window.js';
import { audienceRefusalSentence, judgedPages, openTextAudience, rowNow, textCodeColumns, textValues, textVariableNames, type JudgedPerson, type TextAudience, type TextAudienceAccess, type TextAudienceDeps } from './audience.js';
import { preflight, templateRefusals, type Preflight, type PreflightDeps, type RunRefusal } from './preflight.js';
import type { NewTextRecipient, TextMarketingStore, TextRun } from './store.js';
import { TEXT_RUN_OPEN, type TextAudienceRefusal, type TextRecipientSkip, type TextRecipientView, type TextRunTotals, type TextRunView } from './types.js';

export const TEXT_RUN_JOB = 'sms.marketing-run';
export const textRunPayloadSchema = z.object({ runId: z.string().min(1).max(36) }).strict();

/** How a person's delivery names the run, so the send path can ask it and tell it (`compose.ts`). */
export const TEXT_RUN_REPORT_APP = '@adminium/text-runs';
export const TEXT_RUN_REPORT_TABLE = 'adminium_text_run_recipients';

/** The most people one batch hands over, and how long it keeps taking new ones. */
export const TEXT_RUN_BATCH = 50;
const BATCH_BUDGET_MS = 60_000;
/** Between batches, and before a batch that could not check something tries again. */
const NEXT_BATCH_MS = 2_000;
const RETRY_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;

export interface TextRunsDeps extends TextAudienceDeps, PreflightDeps {
  secret: string;
  consent: TextConsentService;
  store: TextMarketingStore;
  /** The send path, once it is joined. */
  texts: () => TextSendPath | null;
  sms: Pick<SmsService, 'view'>;
  /** The stored sending settings (`readTextPolicy`), for the day's clock. */
  policy: () => Promise<unknown>;
  phoneKeys: TextPhoneKeys;
  enqueue: (job: EnqueueJobInput) => Promise<{ id: string }>;
  now?: (() => number) | undefined;
}

/** A run refused before it is made: every reason, so the console can say all of them. */
export class TextRunRefusedError extends AppError {
  constructor(readonly refusals: readonly RunRefusal[]) {
    super(409, 'TEXT_RUN_REFUSED', `This marketing text can't go out: ${refusals.map((one) => one.reason).join(', ')}.`, { refusals });
  }
}

export class TextAudienceRefusedError extends AppError {
  constructor(
    readonly reason: TextAudienceRefusal,
    label: string,
  ) {
    super(reason === 'not-people' ? 409 : reason === 'view-gone' ? 404 : reason === 'view-search' ? 422 : 403, 'AUDIENCE_REFUSED', audienceRefusalSentence(reason, label), { reason, table: label });
  }
}

/** The first moment after `at` that falls on another day on `zone`'s clock. */
export function nextDayStart(at: number, zone: string): number {
  const today = dayKey(at, zone);
  let high = at + HOUR_MS;
  while (dayKey(high, zone) === today) high += HOUR_MS;
  let low = high - HOUR_MS;
  // To the minute: the first minute of the new day.
  while (high - low > 60_000) {
    const middle = low + Math.floor((high - low) / 2 / 60_000) * 60_000;
    if (dayKey(middle, zone) === today) low = middle;
    else high = middle;
  }
  return high - (high % 60_000);
}

export interface TextRunPreview {
  preflight: Preflight;
  template: { refusals: RunRefusal[]; unfilled: string[]; languages: string[] };
  people: number;
  canSend: number;
  skipped: Record<string, number>;
  /** By the country of the number: who can get it, and when the sending hours open at the chosen time (null: open then). */
  countries: { country: string; people: number; canSend: number; opensAt: number | null; noWindow: boolean }[];
  /** Today's limit, and how much of it is left for this run. */
  daily: { limit: number; used: number; left: number; days: number };
}

/** The template's languages that are switched on, as the run freezes them. */
async function contentOf(meta: MetaDb, key: string): Promise<Record<string, string>> {
  const rows = await textTemplatesRepo(meta).listByKey(key);
  return Object.fromEntries(rows.filter((row) => row.enabled && row.body.trim() !== '').map((row) => [row.locale, row.body]));
}

export function createTextRuns(deps: TextRunsDeps) {
  const { meta, store } = deps;
  const now = deps.now ?? Date.now;

  async function opened(userId: string | null, audience: TextAudience): Promise<TextAudienceAccess> {
    const result = await openTextAudience(deps, userId, audience);
    if ('refuse' in result) throw new TextAudienceRefusedError(result.refuse, result.label);
    return result.ok;
  }

  async function business(connectionId: string): Promise<string> {
    const sender = await resolveMailSender(meta, { connectionId });
    return sender.name ?? (await businessName(meta));
  }

  async function dayZone(): Promise<string> {
    return readTextPolicy(await deps.policy()).dayZone;
  }

  async function usageNow(): Promise<{ limit: number; used: number }> {
    const texts = deps.texts();
    if (texts !== null) return texts.usage();
    return { limit: readTextPolicy(await deps.policy()).dailyLimit, used: 0 };
  }

  /** The whole check the dialog shows, worked out as the run will: who gets it, who does not and why, and when. */
  async function preview(userId: string, input: { templateKey: string; audience: TextAudience; scheduleAt?: number | undefined }): Promise<TextRunPreview> {
    const access = await opened(userId, input.audience);
    const content = await contentOf(meta, input.templateKey);
    const template = { ...templateRefusals(content, textCodeColumns(access), textVariableNames(access)), languages: Object.keys(content).sort() };
    const at = input.scheduleAt ?? now();
    const skipped: Record<string, number> = {};
    const countries = new Map<string, { people: number; canSend: number }>();
    let people = 0;
    let canSend = 0;
    for await (const page of judgedPages(deps, access)) {
      for (const one of page) {
        people += 1;
        if (one.skip === null) canSend += 1;
        else skipped[one.skip] = (skipped[one.skip] ?? 0) + 1;
        if (one.country !== null) {
          const held = countries.get(one.country) ?? { people: 0, canSend: 0 };
          held.people += 1;
          if (one.skip === null) held.canSend += 1;
          countries.set(one.country, held);
        }
      }
    }
    const usage = await usageNow();
    const left = Math.max(usage.limit - usage.used, 0);
    return {
      preflight: await preflight(deps),
      template,
      people,
      canSend,
      skipped,
      countries: [...countries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([country, counts]) => {
          const verdict = judgeWindow({ timing: 'marketing', at, zone: null, country, serviceHours: DEFAULT_SERVICE_HOURS, notAfter: null });
          return { country, ...counts, opensAt: verdict.go ? null : 'until' in verdict ? verdict.until : null, noWindow: !verdict.go && 'skip' in verdict };
        }),
      daily: { limit: usage.limit, used: usage.used, left, days: canSend === 0 ? 0 : left >= canSend ? 1 : 1 + Math.ceil((canSend - left) / usage.limit) },
    };
  }

  /** "See who": the people one reason leaves out (`ok` for those who get it), as the sender reads them. */
  async function peopleFor(userId: string, audience: TextAudience, reason: string, page: { limit: number; offset: number }): Promise<{ people: Pick<JudgedPerson, 'key' | 'name' | 'masked' | 'country' | 'skip'>[]; more: boolean }> {
    const access = await opened(userId, audience);
    const out: Pick<JudgedPerson, 'key' | 'name' | 'masked' | 'country' | 'skip'>[] = [];
    let seen = 0;
    for await (const rows of judgedPages(deps, access)) {
      for (const one of rows) {
        if ((reason === 'ok' ? one.skip !== null : one.skip !== reason)) continue;
        seen += 1;
        if (seen <= page.offset) continue;
        if (out.length === page.limit) return { people: out, more: true };
        out.push({ key: one.key, name: one.name, masked: one.masked, country: one.country, skip: one.skip });
      }
    }
    return { people: out, more: false };
  }

  async function enqueueBatch(runId: string, runAt: number): Promise<string> {
    const job = await deps.enqueue({ kind: TEXT_RUN_JOB, payload: { runId }, runAt, maxAttempts: 3 });
    await store.runs.setJob(runId, job.id, now());
    return job.id;
  }

  /** Makes a run and queues its first batch at its time. Refused while anything the preflight checks is not right. */
  async function create(userId: string, input: { name: string; templateKey: string; audience: TextAudience; scheduleAt?: number | undefined }): Promise<TextRun> {
    const at = now();
    if (input.scheduleAt !== undefined && input.scheduleAt < at - 60_000) throw new ValidationFailedError('The scheduled time is in the past.', { field: 'scheduleAt' });
    const access = await opened(userId, input.audience);
    const content = await contentOf(meta, input.templateKey);
    const template = templateRefusals(content, textCodeColumns(access), textVariableNames(access));
    const checked = await preflight(deps);
    const refusals = [...checked.refusals, ...template.refusals];
    if (refusals.length > 0) throw new TextRunRefusedError(refusals);
    if (template.unfilled.length > 0) {
      throw new AppError(422, 'PLACEHOLDER_UNFILLED', `Nothing fills ${template.unfilled.map((name) => `{{${name}}}`).join(', ')} in this text. Give it a backup, or take it out.`, { placeholders: template.unfilled });
    }
    const run = await store.runs.create({ name: input.name, templateKey: input.templateKey, content, connectionId: input.audience.connectionId, table: access.wholeTable.id, viewId: input.audience.viewId ?? null, scheduledAt: input.scheduleAt ?? at, createdBy: userId }, at);
    const jobId = await enqueueBatch(run.id, run.scheduledAt);
    return { ...run, jobId };
  }

  /** Every person left still waiting ends with the run's failure; the run says why. */
  async function fail(run: TextRun, reason: string): Promise<void> {
    const at = now();
    if (await store.runs.move(run.id, TEXT_RUN_OPEN, 'failed', { reason, finishedAt: at, waitingUntil: null }, at)) await store.recipients.endQueued(run.id, { state: 'skipped', reason: 'run-failed' }, at);
  }

  /** The first batch: everyone in the audience written down, in one transaction, so a batch that dies writes nobody twice. */
  async function writePeople(run: TextRun, access: TextAudienceAccess): Promise<void> {
    const rows: NewTextRecipient[] = [];
    const install = await recipientLocale(meta, null);
    const hashFor = async (e164: string | null) => (e164 === null ? null : deps.phoneKeys.forWrite(e164));
    for await (const page of judgedPages(deps, access)) {
      for (const one of page) {
        rows.push({ connectionId: run.connectionId, table: access.wholeTable.id, key: one.key, name: one.name, phone: await hashFor(one.e164), phoneMasked: one.masked, country: one.country, locale: one.locale ?? install, state: one.skip === null ? 'queued' : 'skipped', reason: one.skip });
      }
    }
    await store.transaction(async (scoped) => {
      if (await scoped.recipients.any(run.id)) return;
      await scoped.recipients.write(run.id, rows, now());
    });
  }

  /** One batch of one run (see the header). */
  async function batch(runId: string, ctx: Pick<JobHandlerContext, 'jobId' | 'signal'>): Promise<{ outcome: string; handed?: number }> {
    const run = await store.runs.byId(runId);
    if (run === null || !TEXT_RUN_OPEN.includes(run.status)) return { outcome: 'ended' };
    // Not the head of its chain: an old job a later batch replaced.
    if (run.jobId !== null && run.jobId !== ctx.jobId) return { outcome: 'not-head' };
    const texts = deps.texts();
    if (texts === null) {
      await enqueueBatch(run.id, now() + RETRY_MS);
      return { outcome: 'not-joined' };
    }
    const checked = await preflight(deps);
    if (!checked.ok) {
      await fail(run, checked.refusals[0]!.reason);
      return { outcome: 'failed' };
    }
    const result = await openTextAudience(deps, run.createdBy, { connectionId: run.connectionId, table: run.table, viewId: run.viewId });
    if ('refuse' in result) {
      await fail(run, result.refuse);
      return { outcome: 'failed' };
    }
    const access = result.ok;
    const template = templateRefusals(run.content, textCodeColumns(access), textVariableNames(access));
    if (template.refusals.length > 0) {
      await fail(run, template.refusals[0]!.reason);
      return { outcome: 'failed' };
    }

    if (run.status === 'scheduled') {
      await writePeople(run, access);
      await store.runs.move(run.id, ['scheduled'], 'running', { startedAt: now() }, now());
    } else if (run.status === 'waiting') {
      await store.runs.move(run.id, ['waiting'], 'running', { waitingUntil: null }, now());
    }

    const zone = await dayZone();
    const usage = await texts.usage();
    const room = usage.limit - usage.used - (await store.recipients.pendingSlots(run.id));
    const tomorrow = async (): Promise<{ outcome: string }> => {
      const until = nextDayStart(now(), zone);
      await store.runs.move(run.id, ['running'], 'waiting', { waitingUntil: until }, now());
      await enqueueBatch(run.id, until);
      return { outcome: 'waiting' };
    };
    if (room <= 0 && (await store.recipients.countByState(run.id))['queued'] !== undefined) return tomorrow();

    const claim = randomUUID();
    const claimed = await store.recipients.claim(run.id, claim, Math.min(TEXT_RUN_BATCH, Math.max(room, 0)), now());
    const started = now();
    const name = await business(run.connectionId);
    const country = await deps.country();
    const install = await recipientLocale(meta, null);
    const codeColumns = textCodeColumns(access);
    let handed = 0;
    let limitHit = false;
    let retry = false;
    for (const person of claimed) {
      if (ctx.signal.aborted || now() - started > BATCH_BUDGET_MS || limitHit) {
        await store.recipients.end(person.id, claim, { state: 'queued' }, now());
        continue;
      }
      const skip = (reason: TextRecipientSkip) => store.recipients.end(person.id, claim, { state: 'skipped', reason }, now());
      const whole = await rowNow(access, person.key);
      if (whole === undefined) {
        await skip('out-of-reach');
        continue;
      }
      const raw = whole[access.declared.phone];
      const parsed = parsePhone(raw, country);
      const hashes = parsed.ok ? await deps.phoneKeys.all(parsed.e164) : [];
      if (person.phone === null || !hashes.some((one) => one.hash === person.phone!.hash && one.version === person.phone!.version)) {
        await skip('phone-changed');
        continue;
      }
      const body = run.content[person.locale ?? install] ?? run.content[install] ?? run.content['en_US'];
      if (body === undefined) {
        await skip('no-template-language');
        continue;
      }
      const prepared = await texts.prepare({
        phone: raw,
        country,
        textClass: 'marketing',
        template: body,
        values: textValues(access, whole, name),
        codeNames: codeNamesIn(body, codeColumns),
        zone: null,
        notAfter: null,
        business: { name },
        person: { connectionId: run.connectionId, table: person.table, key: person.key },
      });
      if (prepared.action === 'fail') {
        retry = true;
        await store.recipients.end(person.id, claim, { state: 'queued' }, now());
        continue;
      }
      if (prepared.action === 'skip') {
        if (prepared.reason === 'daily-limit') {
          limitHit = true;
          await store.recipients.end(person.id, claim, { state: 'queued' }, now());
        } else {
          await skip(prepared.reason);
        }
        continue;
      }
      const report: TextSendReport = { app: TEXT_RUN_REPORT_APP, connectionId: run.connectionId, table: TEXT_RUN_REPORT_TABLE, pk: { id: person.id } };
      const queued = await texts.queue(prepared, { messageKey: `text-run:${run.id}:${person.id}`, claimKey: `try:${String(person.tries)}`, report });
      if (queued.queued) {
        if (await store.recipients.end(person.id, claim, { state: 'handed', deliveryId: queued.deliveryId }, now())) handed += 1;
      } else {
        retry = true;
        await store.recipients.end(person.id, claim, { state: 'queued' }, now());
      }
    }

    const left = (await store.recipients.countByState(run.id))['queued'] ?? 0;
    if (left === 0) {
      await store.runs.move(run.id, ['running'], 'done', { finishedAt: now() }, now());
      return { outcome: 'done', handed };
    }
    // The day is used up, by the send path's own count or by this run's texts still to take their slots.
    if (limitHit || handed >= room) {
      await tomorrow();
      return { outcome: 'waiting', handed };
    }
    await enqueueBatch(run.id, now() + (retry && handed === 0 ? RETRY_MS : NEXT_BATCH_MS));
    return { outcome: 'more', handed };
  }

  /** Stops a run: nobody else is handed over, and a text still waiting for its hours is not sent. */
  async function cancel(runId: string, userId: string): Promise<TextRun> {
    const run = await store.runs.byId(runId);
    if (run === null) throw new NotFoundError('That marketing text run is not there.', { runId });
    const at = now();
    if (!(await store.runs.move(run.id, TEXT_RUN_OPEN, 'cancelled', { cancelledBy: userId, finishedAt: at, waitingUntil: null }, at))) {
      // A done run can still be cancelled while some of its texts wait for their hours.
      if (run.status !== 'done' || !(await store.runs.move(run.id, ['done'], 'cancelled', { cancelledBy: userId }, at))) {
        throw new ConflictError(`This run is ${run.status} and cannot be cancelled.`, 'CONFLICT', { status: run.status });
      }
    }
    await store.recipients.endQueued(run.id, { state: 'cancelled' }, at);
    return (await store.runs.byId(run.id))!;
  }

  async function totals(runId: string): Promise<TextRunTotals> {
    const out: TextRunTotals = { people: 0, queued: 0, sending: 0, sent: 0, delivered: 0, failed: 0, unknown: 0, skipped: {}, cancelled: 0, optOuts: await store.recipients.optOuts(runId) };
    const skipped = (reason: string | null, n: number): void => {
      const key = reason ?? 'unknown';
      out.skipped[key] = (out.skipped[key] ?? 0) + n;
    };
    for (const row of await store.recipients.tally(runId)) {
      out.people += row.n;
      if (row.state === 'queued' || row.state === 'sending') out.queued += row.n;
      else if (row.state === 'skipped') skipped(row.reason, row.n);
      else if (row.state === 'cancelled') out.cancelled += row.n;
      else if (row.state === 'handed') {
        switch (row.dState) {
          case 'prepared':
          case 'retrying':
          case 'handing-over':
            out.sending += row.n;
            break;
          case 'accepted':
          case 'checked-went':
            out.sent += row.n;
            if (row.dStatus === 'delivered') out.delivered += row.n;
            break;
          case 'provider-failed':
          case 'refused':
          case 'not-sent':
          case 'checked-not-sent':
            out.failed += row.n;
            break;
          case 'unknown':
            out.unknown += row.n;
            break;
          case 'skipped':
            skipped(row.dReason, row.n);
            break;
          default:
            // Its delivery was erased with the person: counted, and nowhere else.
            break;
        }
      }
    }
    return out;
  }

  async function view(run: TextRun): Promise<TextRunView> {
    return {
      id: run.id,
      name: run.name,
      templateKey: run.templateKey,
      connectionId: run.connectionId,
      table: run.table,
      viewId: run.viewId,
      status: run.status,
      reason: run.reason,
      scheduledAt: run.scheduledAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      waitingUntil: run.waitingUntil,
      createdBy: run.createdBy,
      cancelledBy: run.cancelledBy,
      createdAt: run.createdAt,
      totals: await totals(run.id),
    };
  }

  async function recipients(runId: string, opts: { limit: number; after?: string | null | undefined; state?: TextRecipientView['state'] | undefined; reason?: string | undefined }): Promise<{ people: TextRecipientView[]; next: string | null }> {
    const rows = await store.recipients.page(runId, { ...opts, limit: opts.limit + 1 });
    const shown = rows.slice(0, opts.limit);
    return {
      people: shown.map(({ recipient, delivery }) => ({
        id: recipient.id,
        name: recipient.name,
        phone: recipient.phoneMasked,
        country: recipient.country,
        state: recipient.state,
        reason: recipient.reason,
        delivery: delivery === null ? null : { id: delivery.id, state: delivery.state, reason: delivery.reason, providerStatus: delivery.providerStatus, segments: delivery.segments },
      })),
      next: rows.length > opts.limit ? shown.at(-1)!.recipient.id : null,
    };
  }

  /** The hand-over asks, at the last moment, whether a run's text is still wanted. */
  async function stillWanted(report: TextSendReport, e164: string): Promise<boolean> {
    const id = report.pk['id'];
    if (typeof id !== 'string') return false;
    const person = await store.recipients.byId(id);
    if (person === null || person.state !== 'handed' || person.phone === null) return false;
    const run = await store.runs.byId(person.runId);
    if (run === null || run.status === 'cancelled' || run.status === 'failed') return false;
    return (await deps.phoneKeys.all(e164)).some((one) => one.hash === person.phone!.hash && one.version === person.phone!.version);
  }

  /** A delivery of a run ended: one the day's limit refused at the hand-over goes back in the queue for the next day. */
  async function settled(report: TextSendReport, delivery: TextDelivery): Promise<void> {
    if (delivery.state !== 'skipped' || delivery.reason !== 'daily-limit') return;
    const id = report.pk['id'];
    if (typeof id !== 'string') return;
    const person = await store.recipients.byId(id);
    if (person === null) return;
    const run = await store.runs.byId(person.runId);
    if (run === null || run.status === 'cancelled' || run.status === 'failed') return;
    if (!(await store.recipients.requeue(person.id, delivery.id, now()))) return;
    // The run may already be done, or waiting: either way it goes on the next day, once.
    const until = nextDayStart(now(), await dayZone());
    if (await store.runs.move(run.id, ['running', 'done'], 'waiting', { waitingUntil: until, finishedAt: null }, now())) await enqueueBatch(run.id, until);
  }

  /** Who made a run, for the list: their name, never their address. */
  async function makerName(userId: string): Promise<string | null> {
    return (await usersRepo(meta).findById(userId))?.name ?? null;
  }

  return {
    preview,
    peopleFor,
    create,
    batch,
    cancel,
    view,
    totals,
    recipients,
    stillWanted,
    settled,
    makerName,
    usage: usageNow,
    byId: (id: string) => store.runs.byId(id),
    list: (opts: { limit: number; cursor?: string | null | undefined }) => store.runs.page(opts),
  };
}

export type TextRuns = ReturnType<typeof createTextRuns>;

/** The batch job's registration. A batch that throws is tried again: every batch is safe to run twice. */
export function registerTextRunHandler(registry: JobRegistry, runs: () => TextRuns | null): void {
  registry.registerJobHandler(
    TEXT_RUN_JOB,
    textRunPayloadSchema,
    async (payload, ctx) => {
      const service = runs();
      if (service === null) return { outcome: 'not-joined' };
      return service.batch(payload.runId, ctx);
    },
    { internal: true },
  );
}
