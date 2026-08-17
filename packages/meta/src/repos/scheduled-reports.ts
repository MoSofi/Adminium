// SPDX-License-Identifier: AGPL-3.0-only
/**
 * scheduledReportsRepo — adminium_scheduled_reports (07-meta-store.md §3.24):
 * one row per recurring report. The row stores WHAT and WHEN (`schedule` per
 * `reportScheduleSchema`, `recipients`, `format`) plus the run bookkeeping
 * (`last_run_at` / `next_run_at`); computing `next_run_at` from the schedule
 * fields is the SERVER's job (croner lives there — apps/server/src/reports/),
 * so the repo persists timestamps it is handed and never parses cron.
 *
 * `format` keeps the §3.24 `pdf | png` vocabulary even though the v1 runner
 * delivers a data snapshot (no headless browser) — the stored intent survives
 * the day rendering arrives, and the UI explains the degradation rather than
 * hiding it (documented deviation in the M7 reports track).
 */

import type { Selectable } from 'kysely';
import { z } from 'zod';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  reportFormatSchema,
  reportRecipientsSchema,
  reportScheduleSchema,
} from '../schema/json-payloads.js';
import type { AdminiumScheduledReportsTable } from '../schema/tables.js';
import { affected, packJson, readBool, readJson, writeBool } from './util.js';

export type ReportSchedule = z.infer<typeof reportScheduleSchema>;
export type ReportFormat = z.infer<typeof reportFormatSchema>;

export interface ScheduledReport {
  id: string;
  pageId: string;
  name: string;
  schedule: ReportSchedule;
  recipients: string[];
  format: ReportFormat;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateScheduledReportInput {
  pageId: string;
  name: string;
  schedule: ReportSchedule;
  recipients: string[];
  format: ReportFormat;
  enabled?: boolean | undefined;
  /** Computed by the caller (croner) — null parks the schedule. */
  nextRunAt: number | null;
  createdBy?: string | null | undefined;
}

export interface UpdateScheduledReportInput {
  name?: string | undefined;
  pageId?: string | undefined;
  schedule?: ReportSchedule | undefined;
  recipients?: string[] | undefined;
  format?: ReportFormat | undefined;
  enabled?: boolean | undefined;
  /** Recompute + pass whenever `schedule`/`enabled` changes. */
  nextRunAt?: number | null | undefined;
}

function decode(row: Selectable<AdminiumScheduledReportsTable>): ScheduledReport {
  return {
    id: row.id,
    pageId: row.pageId,
    name: row.name,
    schedule: reportScheduleSchema.parse(readJson(row.schedule)),
    recipients: reportRecipientsSchema.parse(readJson(row.recipients)),
    format: reportFormatSchema.parse(row.format),
    enabled: readBool(row.enabled),
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function scheduledReportsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<ScheduledReport | null> {
    const row = await db
      .selectFrom('adminium_scheduled_reports')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    async create(input: CreateScheduledReportInput, at: number = Date.now()): Promise<ScheduledReport> {
      const row = {
        id: newId('rep'),
        pageId: input.pageId,
        name: input.name,
        schedule: packJson(reportScheduleSchema.parse(input.schedule)),
        recipients: packJson(reportRecipientsSchema.parse(input.recipients)),
        format: reportFormatSchema.parse(input.format),
        enabled: writeBool(meta, input.enabled ?? true),
        lastRunAt: null,
        nextRunAt: input.nextRunAt,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_scheduled_reports').values(row).execute();
      return decode(row as unknown as Selectable<AdminiumScheduledReportsTable>);
    },

    /** Newest first; `createdBy` scopes to one user (the "mine" list). */
    async list(opts: { createdBy?: string; limit?: number } = {}): Promise<ScheduledReport[]> {
      let query = db.selectFrom('adminium_scheduled_reports').selectAll();
      if (opts.createdBy !== undefined) query = query.where('createdBy', '=', opts.createdBy);
      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(opts.limit ?? 100)
        .execute();
      return rows.map(decode);
    },

    async update(
      id: string,
      patch: UpdateScheduledReportInput,
      at: number = Date.now(),
    ): Promise<ScheduledReport | null> {
      const set: Record<string, unknown> = { updatedAt: at };
      if (patch.name !== undefined) set['name'] = patch.name;
      if (patch.pageId !== undefined) set['pageId'] = patch.pageId;
      if (patch.schedule !== undefined) set['schedule'] = packJson(reportScheduleSchema.parse(patch.schedule));
      if (patch.recipients !== undefined) {
        set['recipients'] = packJson(reportRecipientsSchema.parse(patch.recipients));
      }
      if (patch.format !== undefined) set['format'] = reportFormatSchema.parse(patch.format);
      if (patch.enabled !== undefined) set['enabled'] = writeBool(meta, patch.enabled);
      if (patch.nextRunAt !== undefined) set['nextRunAt'] = patch.nextRunAt;
      const res = await db
        .updateTable('adminium_scheduled_reports')
        .set(set)
        .where('id', '=', id)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) return null;
      return findById(id);
    },

    async remove(id: string): Promise<boolean> {
      const res = await db
        .deleteFrom('adminium_scheduled_reports')
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },

    /** Stamp a completed run and park the next one (the report-run job). */
    async recordRun(
      id: string,
      run: { lastRunAt: number; nextRunAt: number | null },
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_scheduled_reports')
        .set({ lastRunAt: run.lastRunAt, nextRunAt: run.nextRunAt, updatedAt: run.lastRunAt })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Enabled reports whose `next_run_at` has passed — the poll's worklist. */
    async listDue(at: number = Date.now()): Promise<ScheduledReport[]> {
      const rows = await db
        .selectFrom('adminium_scheduled_reports')
        .selectAll()
        .where('enabled', '=', writeBool(meta, true))
        .where('nextRunAt', 'is not', null)
        .where('nextRunAt', '<=', at)
        .orderBy('nextRunAt', 'asc')
        .execute();
      return rows.map(decode);
    },
  };
}

export type ScheduledReportsRepo = ReturnType<typeof scheduledReportsRepo>;
