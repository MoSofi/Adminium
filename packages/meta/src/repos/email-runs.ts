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
 * most a hundred `{ to, error }` records for diagnosis. There is no
 * per-recipient table: "18,240 sent · 12 failed" is the question the product
 * answers, and a ledger of every address a campaign reached is PII the product
 * does not need to keep.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  emailAudienceSchema,
  emailRunFailuresSchema,
  emailRunStatusSchema,
  type EmailAudience,
  type EmailRunFailure,
  type EmailRunStatus,
} from '../schema/json-payloads.js';
import type { AdminiumEmailRunsTable } from '../schema/tables.js';
import { affected, packJson, readJson, readJsonOrNull } from './util.js';

export interface EmailRun {
  id: string;
  templateId: string;
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
}

export interface CreateEmailRunInput {
  templateId: string;
  audience: EmailAudience;
  /** When the run should start; "now" is the caller's clock. */
  scheduledAt: number;
  jobId?: string | null | undefined;
  createdBy?: string | null | undefined;
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
        if (!out.has(row.templateId)) out.set(row.templateId, decode(row));
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
  };
}

export type EmailRunsRepo = ReturnType<typeof emailRunsRepo>;
