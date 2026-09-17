// SPDX-License-Identifier: AGPL-3.0-only
/**
 * automationRunsRepo — adminium_automation_runs (migration 0006 + 0028).
 * One row per EXECUTION, and the only thing Workflow Logs reads.
 *
 * ─── `begin` is the exactly-once gate ──────────────────────────────────────
 *
 * Four producers can decide the same occurrence happened: the route matcher,
 * the watch poller, the schedule scanner and a dry run. `begin` INSERTs the
 * `pending` row first and reads a duplicate-key error as "somebody already
 * fired this", returning null. Nothing checks-then-inserts, because between
 * the check and the insert is exactly where the second producer lives. This
 * is why a row created through the dashboard and then seen by the poller a
 * minute later is ONE run: both compute the same `dedupeKey`.
 *
 * A caller that returns null MUST NOT enqueue a job. The job is enqueued only
 * after the row exists, which is also why the job carries `{ runId }` and
 * nothing else — the run row is the source of truth for what to do.
 *
 * ─── Statuses, and which are terminal ──────────────────────────────────────
 *
 * `pending` → `running` → `succeeded | failed | skipped`, with `waiting`
 * between steps for a suspended run (D8) and `cancelled` for a rule switched
 * off mid-wait. `pending` and `waiting` are never swept by retention: they
 * are work that has not happened yet.
 *
 * ─── Stats are queries (D24) ───────────────────────────────────────────────
 *
 * Nothing here is denormalised onto the rule. `perRule`, `counts` and `stats`
 * are grouped queries over the two indexes 0028 leaves behind —
 * `(automation_id, started_at)` and `(status, started_at)` — because a
 * counter that can drift from the rows it counts is a bug waiting for a
 * crash between two writes.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  automationOriginSchema,
  automationRunStatusSchema,
  automationTraceSchema,
  automationTriggerEventSchema,
  type AutomationOrigin,
  type AutomationRunStatus,
  type AutomationTrace,
  type AutomationTriggerEvent,
} from '../schema/json-payloads.js';
import type { AdminiumAutomationRunsTable } from '../schema/tables.js';
import { affected, isDuplicateKeyError, packJson, readJson, readJsonOrNull } from './util.js';

export interface AutomationRun {
  id: string;
  automationId: string;
  jobId: string | null;
  status: AutomationRunStatus;
  triggerEvent: AutomationTriggerEvent;
  trace: AutomationTrace | null;
  error: string | null;
  dedupeKey: string | null;
  wakeAt: number | null;
  durationMs: number | null;
  origin: AutomationOrigin;
  startedAt: number;
  finishedAt: number | null;
}

export interface BeginRunInput {
  automationId: string;
  /** The occurrence identity (D6). NULL when there is nothing to collapse on. */
  dedupeKey: string | null;
  origin: AutomationOrigin;
  triggerEvent: AutomationTriggerEvent;
  /** When the run may start — `now + UNDO_TTL_MS` for a dashboard event (D7). */
  wakeAt?: number | null | undefined;
}

/** `running` covers the comp's three-way filter: pending + running + waiting (D9). */
export type AutomationRunFilter = 'success' | 'failed' | 'running';

export const AUTOMATION_RUNNING_STATUSES: readonly AutomationRunStatus[] = [
  'pending',
  'running',
  'waiting',
];

const FILTER_STATUSES: Record<AutomationRunFilter, readonly AutomationRunStatus[]> = {
  success: ['succeeded'],
  failed: ['failed'],
  running: AUTOMATION_RUNNING_STATUSES,
};

/** Keyset cursor — the last row of the previous page (newest first). */
export interface AutomationRunCursor {
  startedAt: number;
  id: string;
}

export interface ListRunsOptions {
  /** Inclusive lower bound on `started_at` — the 7-day window (D22). */
  since: number;
  filter?: AutomationRunFilter | undefined;
  automationId?: string | undefined;
  limit?: number | undefined;
  before?: AutomationRunCursor | undefined;
}

export interface AutomationRunCounts {
  all: number;
  success: number;
  failed: number;
  running: number;
}

export interface AutomationDayStats {
  runs: number;
  succeeded: number;
  failed: number;
  /** Mean `duration_ms` of FINISHED runs; null when none finished. */
  avgDurationMs: number | null;
}

export interface AutomationRulePeriodStats {
  runs: number;
  succeeded: number;
  failed: number;
}

function decode(row: Selectable<AdminiumAutomationRunsTable>): AutomationRun {
  const trace = readJsonOrNull(row.trace);
  return {
    id: row.id,
    automationId: row.automationId,
    jobId: row.jobId,
    status: automationRunStatusSchema.parse(row.status),
    triggerEvent: automationTriggerEventSchema.parse(readJson(row.triggerEvent)),
    trace: trace === null ? null : automationTraceSchema.parse(trace),
    error: row.error,
    dedupeKey: row.dedupeKey,
    wakeAt: row.wakeAt,
    durationMs: row.durationMs,
    origin: automationOriginSchema.parse(row.origin),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function automationRunsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<AutomationRun | null> {
    const row = await db
      .selectFrom('adminium_automation_runs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    /**
     * Claim an occurrence. Returns the new `pending` run, or null when the
     * unique index says another producer got there first — which is not an
     * error and must not be logged as one.
     */
    async begin(input: BeginRunInput, at: number = Date.now()): Promise<AutomationRun | null> {
      const row = {
        id: newId('arun'),
        automationId: input.automationId,
        jobId: null,
        status: 'pending' as const,
        triggerEvent: packJson(automationTriggerEventSchema.parse(input.triggerEvent)),
        trace: null,
        error: null,
        dedupeKey: input.dedupeKey,
        wakeAt: input.wakeAt ?? null,
        durationMs: null,
        origin: automationOriginSchema.parse(input.origin),
        startedAt: at,
        finishedAt: null,
      };
      try {
        await db.insertInto('adminium_automation_runs').values(row).execute();
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
      return decode(row as unknown as Selectable<AdminiumAutomationRunsTable>);
    },

    /** Remember which job carries this run, so a cancel can find it. */
    async attachJob(id: string, jobId: string): Promise<boolean> {
      const res = await db
        .updateTable('adminium_automation_runs')
        .set({ jobId })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * pending|waiting → running. Guarded on the previous status so a job
     * delivered twice (the queue's at-least-once contract) cannot restart a
     * run that is already walking its graph.
     */
    async start(id: string): Promise<boolean> {
      const res = await db
        .updateTable('adminium_automation_runs')
        .set({ status: 'running', wakeAt: null })
        .where('id', '=', id)
        .where('status', 'in', ['pending', 'waiting'])
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** running → waiting, with the trace so far and where to pick up (D8). */
    async wait(
      id: string,
      input: { wakeAt: number; trace: AutomationTrace },
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_automation_runs')
        .set({
          status: 'waiting',
          wakeAt: input.wakeAt,
          trace: packJson(automationTraceSchema.parse(input.trace)),
        })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async finish(
      id: string,
      input: {
        status: Extract<AutomationRunStatus, 'succeeded' | 'failed' | 'skipped' | 'cancelled'>;
        trace: AutomationTrace;
        error?: string | null | undefined;
        /** Sum of step durations, waits excluded. */
        durationMs: number;
      },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_automation_runs')
        .set({
          status: input.status,
          trace: packJson(automationTraceSchema.parse(input.trace)),
          error: input.error ?? null,
          durationMs: input.durationMs,
          wakeAt: null,
          finishedAt: at,
        })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * The undo mapping's worklist (D7): runs that have not started and are
     * still inside their delay. Small by construction — the window is 60 s —
     * so the caller decodes `triggerEvent.record` in JS rather than the store
     * reaching into a json column.
     */
    async listPending(origin: AutomationOrigin): Promise<AutomationRun[]> {
      const rows = await db
        .selectFrom('adminium_automation_runs')
        .selectAll()
        .where('status', '=', 'pending')
        .where('origin', '=', origin)
        .orderBy('startedAt', 'asc')
        .execute();
      return rows.map(decode);
    },

    /** pending → skipped, guarded: a run that already started keeps running. */
    async skipPending(
      id: string,
      input: { trace: AutomationTrace; error?: string | null | undefined },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_automation_runs')
        .set({
          status: 'skipped',
          trace: packJson(automationTraceSchema.parse(input.trace)),
          error: input.error ?? null,
          durationMs: 0,
          wakeAt: null,
          finishedAt: at,
        })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Newest first, keyset-paginated — the Workflow Logs list (D22). */
    async list(options: ListRunsOptions): Promise<AutomationRun[]> {
      let query = db
        .selectFrom('adminium_automation_runs')
        .selectAll()
        .where('startedAt', '>=', options.since);
      if (options.filter) query = query.where('status', 'in', [...FILTER_STATUSES[options.filter]]);
      if (options.automationId !== undefined) {
        query = query.where('automationId', '=', options.automationId);
      }
      if (options.before) {
        const { startedAt, id } = options.before;
        query = query.where((eb) =>
          eb.or([
            eb('startedAt', '<', startedAt),
            eb.and([eb('startedAt', '=', startedAt), eb('id', '<', id)]),
          ]),
        );
      }
      const rows = await query
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc')
        .limit(options.limit ?? 50)
        .execute();
      return rows.map(decode);
    },

    /** The four filter-pill badges over the same window (D22). */
    async counts(
      options: { since: number; automationId?: string | undefined },
    ): Promise<AutomationRunCounts> {
      let query = db
        .selectFrom('adminium_automation_runs')
        .select(({ fn }) => ['status', fn.countAll<number>().as('n')])
        .where('startedAt', '>=', options.since)
        .groupBy('status');
      if (options.automationId !== undefined) {
        query = query.where('automationId', '=', options.automationId);
      }
      const rows = await query.execute();
      const counts: AutomationRunCounts = { all: 0, success: 0, failed: 0, running: 0 };
      for (const row of rows) {
        const n = Number(row.n);
        counts.all += n;
        if (row.status === 'succeeded') counts.success += n;
        else if (row.status === 'failed') counts.failed += n;
        else if ((AUTOMATION_RUNNING_STATUSES as readonly string[]).includes(row.status)) {
          counts.running += n;
        }
      }
      return counts;
    },

    /** One period's shape for both KPI strips: `[from, to)` on `started_at`. */
    async stats(from: number, to: number): Promise<AutomationDayStats> {
      const rows = await db
        .selectFrom('adminium_automation_runs')
        .select(({ fn }) => ['status', fn.countAll<number>().as('n')])
        .where('startedAt', '>=', from)
        .where('startedAt', '<', to)
        .groupBy('status')
        .execute();
      const stats: AutomationDayStats = { runs: 0, succeeded: 0, failed: 0, avgDurationMs: null };
      for (const row of rows) {
        const n = Number(row.n);
        stats.runs += n;
        if (row.status === 'succeeded') stats.succeeded += n;
        else if (row.status === 'failed') stats.failed += n;
      }
      // AVG over a bigint column comes back as a string on pg and a Decimal on
      // mysql2; sum and divide in JS instead of trusting the driver's cast.
      const durations = await db
        .selectFrom('adminium_automation_runs')
        .select(['durationMs'])
        .where('startedAt', '>=', from)
        .where('startedAt', '<', to)
        .where('durationMs', 'is not', null)
        .execute();
      if (durations.length > 0) {
        const total = durations.reduce((sum, row) => sum + Number(row.durationMs ?? 0), 0);
        stats.avgDurationMs = Math.round(total / durations.length);
      }
      return stats;
    },

    /** Per-rule counts for the card footer and the flow header (30 days, D22). */
    async perRule(from: number): Promise<Map<string, AutomationRulePeriodStats>> {
      const rows = await db
        .selectFrom('adminium_automation_runs')
        .select(({ fn }) => ['automationId', 'status', fn.countAll<number>().as('n')])
        .where('startedAt', '>=', from)
        .groupBy(['automationId', 'status'])
        .execute();
      const byRule = new Map<string, AutomationRulePeriodStats>();
      for (const row of rows) {
        const entry = byRule.get(row.automationId) ?? { runs: 0, succeeded: 0, failed: 0 };
        const n = Number(row.n);
        entry.runs += n;
        if (row.status === 'succeeded') entry.succeeded += n;
        else if (row.status === 'failed') entry.failed += n;
        byRule.set(row.automationId, entry);
      }
      return byRule;
    },

    /**
     * Retention (D23): finished runs older than `days` go, and a FAILED run
     * is kept twice as long — the run you want to read is the one that went
     * wrong, and it is the one nobody looks at until later. `pending` and
     * `waiting` are never swept: they are future work.
     */
    async gc(at: number, days: number): Promise<number> {
      const dayMs = 86_400_000;
      const cutoff = at - days * dayMs;
      const failedCutoff = at - days * 2 * dayMs;
      const res = await db
        .deleteFrom('adminium_automation_runs')
        .where('status', 'in', ['succeeded', 'failed', 'skipped', 'cancelled'])
        .where((eb) =>
          eb.or([
            eb.and([eb('status', '!=', 'failed'), eb('startedAt', '<', cutoff)]),
            eb.and([eb('status', '=', 'failed'), eb('startedAt', '<', failedCutoff)]),
          ]),
        )
        .executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined);
    },
  };
}

export type AutomationRunsRepo = ReturnType<typeof automationRunsRepo>;
