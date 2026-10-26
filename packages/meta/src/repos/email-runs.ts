// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailRunsRepo — adminium_email_runs: one row per campaign send.
 *
 * A campaign's status is DERIVED from its latest run: no run → Draft, else
 * the run's own status. So the two reads that matter are "the newest run of
 * THIS campaign" ({@link latestByTemplates}, one query for a whole manager
 * page) and "is a run already scheduled or running" ({@link active}, the 409
 * behind a second Send).
 *
 * Counts live on the run — `total`, `sent`, `failed`, `skipped` — with at
 * most a hundred `{ to, error }` records for diagnosis. Who each message went
 * to is the send ledger's (`email-sends.ts`, wave 0067): a run writes its
 * recipients down before the first message goes, so a restart neither loses
 * nor repeats anyone, and the send log reads them back.
 *
 * `status` says where a run is (the manager's pill); `state` says what it is
 * told to do (running, paused, stopped, done). The moves between them are
 * compare-and-set updates, so a pause, a stop and a batch can race safely.
 * `jobId` is the batch job at the head of the run's chain: only that job may
 * hand anything over, and it moves to the next job when one is queued.
 *
 * A run outlives its campaign (wave 0067): the template id goes NULL and the
 * frozen content keeps the name.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  emailAudienceSchema,
  emailRunBasisSchema,
  emailRunClassSchema,
  emailRunContentVariantsSchema,
  emailRunFailuresSchema,
  emailRunStateSchema,
  emailRunStatusSchema,
  EMAIL_RUN_FAILURES_MAX,
  type EmailAudience,
  type EmailRunBasis,
  type EmailRunClass,
  type EmailRunContentVariant,
  type EmailRunFailure,
  type EmailRunState,
  type EmailRunStatus,
} from '../schema/json-payloads.js';
import type { AdminiumEmailRunsTable } from '../schema/tables.js';
import { affected, packJson, readJson, readJsonOrNull } from './util.js';

export interface EmailRun {
  id: string;
  /** NULL once the campaign was deleted; the run stays. */
  templateId: string | null;
  status: EmailRunStatus;
  audience: EmailAudience;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  failures: EmailRunFailure[];
  jobId: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  /** At most this many an hour; null = as fast as the mail server allows. */
  ratePerHour: number | null;
  /** What the run is told to do; null on a run made before the ledger. */
  state: EmailRunState | null;
  mailClass: EmailRunClass | null;
  basis: EmailRunBasis | null;
  /** The content frozen when the run started; null until then. */
  contentId: string | null;
}

export interface CreateEmailRunInput {
  templateId: string;
  audience: EmailAudience;
  /** When the run should start; "now" is the caller's clock. */
  scheduledAt: number;
  jobId?: string | null | undefined;
  createdBy?: string | null | undefined;
  ratePerHour?: number | null | undefined;
  mailClass?: EmailRunClass | null | undefined;
  basis?: EmailRunBasis | null | undefined;
}

/** A run's content as it froze: the campaign in every language it goes out in, the started-from one first. */
export interface EmailRunContent {
  id: string;
  runId: string;
  name: string;
  templateKey: string;
  variants: EmailRunContentVariant[];
  createdAt: number;
}

/** Everything the handler writes back as a run progresses; absent = untouched. */
export interface UpdateEmailRunInput {
  status?: EmailRunStatus | undefined;
  startedAt?: number | null | undefined;
  finishedAt?: number | null | undefined;
  total?: number | undefined;
  sent?: number | undefined;
  failed?: number | undefined;
  skipped?: number | undefined;
  failures?: EmailRunFailure[] | undefined;
  jobId?: string | null | undefined;
  state?: EmailRunState | undefined;
}

/** The statuses under which a campaign may not be sent again (409). */
export const EMAIL_RUN_ACTIVE_STATUSES: readonly EmailRunStatus[] = ['scheduled', 'running'];

function decode(row: Selectable<AdminiumEmailRunsTable>): EmailRun {
  const failuresRaw = readJsonOrNull(row.failures);
  return {
    id: row.id,
    templateId: row.templateId,
    status: emailRunStatusSchema.parse(row.status),
    audience: emailAudienceSchema.parse(readJson(row.audience)),
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    total: Number(row.total),
    sent: Number(row.sent),
    failed: Number(row.failed),
    skipped: Number(row.skipped),
    failures: failuresRaw === null ? [] : emailRunFailuresSchema.parse(failuresRaw),
    jobId: row.jobId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ratePerHour: row.ratePerHour === null ? null : Number(row.ratePerHour),
    state: row.state === null ? null : emailRunStateSchema.parse(row.state),
    mailClass: row.mailClass === null ? null : emailRunClassSchema.parse(row.mailClass),
    basis: row.basis === null ? null : emailRunBasisSchema.parse(row.basis),
    contentId: row.contentId,
  };
}

export function emailRunsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<EmailRun | null> {
    const row = await db.selectFrom('adminium_email_runs').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    /** A new run, `scheduled` until the job picks it up. */
    async create(input: CreateEmailRunInput, at: number = Date.now()): Promise<EmailRun> {
      const id = newId('erun');
      const audience = emailAudienceSchema.parse(input.audience);
      await db
        .insertInto('adminium_email_runs')
        .values({
          id,
          templateId: input.templateId,
          status: 'scheduled',
          audience: packJson(audience),
          scheduledAt: input.scheduledAt,
          startedAt: null,
          finishedAt: null,
          total: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          failures: null,
          jobId: input.jobId ?? null,
          createdBy: input.createdBy ?? null,
          createdAt: at,
          updatedAt: at,
          ratePerHour: input.ratePerHour ?? null,
          state: 'running',
          mailClass: input.mailClass ?? null,
          basis: input.basis ?? null,
          contentId: null,
        })
        .execute();
      const row = await findById(id);
      if (row === null) throw new Error(`email run insert lost its row: ${id}`);
      return row;
    },

    async update(id: string, input: UpdateEmailRunInput, at: number = Date.now()): Promise<EmailRun | null> {
      const res = await db
        .updateTable('adminium_email_runs')
        .set({
          ...(input.status === undefined ? {} : { status: emailRunStatusSchema.parse(input.status) }),
          ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
          ...(input.finishedAt === undefined ? {} : { finishedAt: input.finishedAt }),
          ...(input.total === undefined ? {} : { total: input.total }),
          ...(input.sent === undefined ? {} : { sent: input.sent }),
          ...(input.failed === undefined ? {} : { failed: input.failed }),
          ...(input.skipped === undefined ? {} : { skipped: input.skipped }),
          ...(input.failures === undefined
            ? {}
            : { failures: packJson(emailRunFailuresSchema.parse(input.failures)) }),
          ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
          ...(input.state === undefined ? {} : { state: emailRunStateSchema.parse(input.state) }),
          updatedAt: at,
        })
        .where('id', '=', id)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) return null;
      return await findById(id);
    },

    /** Newest first — the campaign's run history. */
    async listByTemplate(templateId: string, limit = 50): Promise<EmailRun[]> {
      const rows = await db
        .selectFrom('adminium_email_runs')
        .selectAll()
        .where('templateId', '=', templateId)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /**
     * The latest run per campaign, for a whole list at once — the status
     * derivation behind every card. One query, newest first, first seen
     * wins.
     */
    async latestByTemplates(templateIds: readonly string[]): Promise<Map<string, EmailRun>> {
      const out = new Map<string, EmailRun>();
      if (templateIds.length === 0) return out;
      const rows = await db
        .selectFrom('adminium_email_runs')
        .selectAll()
        .where('templateId', 'in', [...templateIds])
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .execute();
      for (const row of rows) {
        if (row.templateId !== null && !out.has(row.templateId)) out.set(row.templateId, decode(row));
      }
      return out;
    },

    /** The scheduled or running run of a campaign, if any — the reason a second Send is refused. */
    async active(templateId: string): Promise<EmailRun | null> {
      const row = await db
        .selectFrom('adminium_email_runs')
        .selectAll()
        .where('templateId', '=', templateId)
        .where('status', 'in', [...EMAIL_RUN_ACTIVE_STATUSES])
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      return row ? decode(row) : null;
    },

    /**
     * The first batch's move from `scheduled` to `running`, with the content it
     * froze and the counts of the recipients it wrote. False when the run was
     * no longer scheduled (cancelled meanwhile): nothing starts.
     */
    async start(
      id: string,
      input: { contentId: string; total: number; skipped: number; jobId: string },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_email_runs')
        .set({ status: 'running', startedAt: at, contentId: input.contentId, total: input.total, skipped: input.skipped, sent: 0, failed: 0, updatedAt: at })
        .where('id', '=', id)
        .where('status', '=', 'scheduled')
        .where('jobId', '=', input.jobId)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * Hands the head of the run's chain from one batch job to the next. False
     * when `from` was no longer the head (a "go on" queued another, or a stop
     * ended the chain): the caller's new job must not run.
     */
    async advance(id: string, from: string, to: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_email_runs')
        .set({ jobId: to, updatedAt: at })
        .where('id', '=', id)
        .where('jobId', '=', from)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * Counts one message handed over — only while the run is `running` and
     * `jobId` is still its head. Inside the hand-over's transaction this is the
     * lock a pause or a stop waits on, so nothing is handed after either.
     * `sent` always changes, so MySQL reports the row as touched.
     */
    async countHanded(id: string, jobId: string): Promise<boolean> {
      const res = await db
        .updateTable('adminium_email_runs')
        .set((eb) => ({ sent: eb('sent', '+', 1) }))
        .where('id', '=', id)
        .where('state', '=', 'running')
        .where('jobId', '=', jobId)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Adds to the run's `skipped` and `failed` counts (rows a batch did not hand over). */
    async countSettled(id: string, input: { skipped?: number; failed?: number }): Promise<void> {
      const skipped = input.skipped ?? 0;
      const failed = input.failed ?? 0;
      if (skipped === 0 && failed === 0) return;
      await db
        .updateTable('adminium_email_runs')
        .set((eb) => ({ skipped: eb('skipped', '+', skipped), failed: eb('failed', '+', failed) }))
        .where('id', '=', id)
        .execute();
    },

    /** A handed message the mail queue gave up on: one less sent, one more failed. */
    async countGivenUp(id: string): Promise<void> {
      await db
        .updateTable('adminium_email_runs')
        .set((eb) => ({ sent: eb('sent', '-', 1), failed: eb('failed', '+', 1) }))
        .where('id', '=', id)
        .execute();
    },

    /**
     * Keeps one more `{ to, error }` record, up to the hundred. A read and a
     * write: two give-ups at the same moment may keep one of the two, which a
     * diagnosis list can afford (the ledger keeps every failure).
     */
    async noteFailure(id: string, failure: EmailRunFailure, at: number = Date.now()): Promise<void> {
      const run = await findById(id);
      if (run === null || run.failures.length >= EMAIL_RUN_FAILURES_MAX) return;
      const error = failure.error.slice(0, 500);
      await db
        .updateTable('adminium_email_runs')
        .set({ failures: packJson(emailRunFailuresSchema.parse([...run.failures, { to: failure.to, error }])), updatedAt: at })
        .where('id', '=', id)
        .execute();
    },

    /**
     * Moves the run's `state` from one of `from` to `to` (and `status` with it
     * when given). False when the run was in none of `from`: a pause of a
     * stopped run, a second stop.
     */
    async moveState(
      id: string,
      from: readonly (EmailRunState | null)[],
      to: EmailRunState,
      extra: { status?: EmailRunStatus; finishedAt?: number; statuses?: readonly EmailRunStatus[] } = {},
      at: number = Date.now(),
    ): Promise<boolean> {
      const states = from.filter((state): state is EmailRunState => state !== null);
      const withNull = from.includes(null);
      let query = db
        .updateTable('adminium_email_runs')
        .set({
          state: to,
          ...(extra.status === undefined ? {} : { status: extra.status }),
          ...(extra.finishedAt === undefined ? {} : { finishedAt: extra.finishedAt }),
          updatedAt: at,
        })
        .where('id', '=', id)
        .where((eb) =>
          eb.or([
            ...(states.length === 0 ? [] : [eb('state', 'in', states)]),
            ...(withNull ? [eb('state', 'is', null)] : []),
          ]),
        );
      if (extra.statuses !== undefined) query = query.where('status', 'in', [...extra.statuses]);
      const res = await query.executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Freezes a run's content; the run points at it once it starts. */
    async freeze(
      runId: string,
      input: { name: string; templateKey: string; variants: EmailRunContentVariant[] },
      at: number = Date.now(),
    ): Promise<EmailRunContent> {
      const id = newId('ercn');
      const variants = emailRunContentVariantsSchema.parse(input.variants);
      await db
        .insertInto('adminium_email_run_contents')
        .values({ id, runId, name: input.name.slice(0, 120), templateKey: input.templateKey, variants: packJson(variants), createdAt: at })
        .execute();
      return { id, runId, name: input.name.slice(0, 120), templateKey: input.templateKey, variants, createdAt: at };
    },

    /** The content a run froze, or null before it started. */
    async content(runId: string): Promise<EmailRunContent | null> {
      const row = await db.selectFrom('adminium_email_run_contents').selectAll().where('runId', '=', runId).executeTakeFirst();
      if (row === undefined) return null;
      return {
        id: row.id,
        runId: row.runId,
        name: row.name,
        templateKey: row.templateKey,
        variants: emailRunContentVariantsSchema.parse(readJson(row.variants)),
        createdAt: row.createdAt,
      };
    },

    /** What a start that died half-way left behind: written again from the beginning. */
    async dropContent(runId: string): Promise<void> {
      await db.deleteFrom('adminium_email_run_contents').where('runId', '=', runId).execute();
    },
  };
}

export type EmailRunsRepo = ReturnType<typeof emailRunsRepo>;
