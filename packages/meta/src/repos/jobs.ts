// SPDX-License-Identifier: AGPL-3.0-only
/**
 * jobsRepo — adminium_jobs (07-meta-store.md §3.12), the table-backed queue.
 *
 * Portable claim (§3.12): a candidate SELECT followed by
 * `UPDATE … WHERE id = ? AND status = 'pending'` — affected-rows 0 means
 * another worker won; try the next candidate. No `SELECT … FOR UPDATE SKIP
 * LOCKED` (not on SQLite), no `UPDATE … LIMIT` (not portable).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { jobPayloadSchema, jobStatusSchema, type JobStatus } from '../schema/json-payloads.js';
import type { AdminiumJobsTable } from '../schema/tables.js';
import { DAY_MS, packJson, readJson } from './util.js';

/** A running job whose lock is older than this is reclaimable (§3.12). */
export const JOB_STALE_LOCK_MS = 5 * 60_000;

/** First-retry delay; retry n waits `backoffBaseMs * 2^(n-1)` (server backoff spec). */
export const JOB_BACKOFF_BASE_MS = 30_000;

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  runAt: number;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedAt: number | null;
  dedupeKey: string | null;
  lastError: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface EnqueueJobInput {
  kind: string;
  payload: Record<string, unknown>;
  runAt?: number;
  priority?: number;
  maxAttempts?: number;
  /** Collapses duplicates while a job with the same key is pending/running. */
  dedupeKey?: string | null;
}

function mapJob(row: Selectable<AdminiumJobsTable>): Job {
  return {
    id: row.id,
    kind: row.kind,
    payload: readJson<Record<string, unknown>>(row.payload),
    status: jobStatusSchema.parse(row.status),
    priority: row.priority,
    runAt: row.runAt,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt,
    dedupeKey: row.dedupeKey,
    lastError: row.lastError,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function jobsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<Job | null> {
    const row = await db.selectFrom('adminium_jobs').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? mapJob(row) : null;
  }

  return {
    findById,

    /**
     * Enqueue a job. With a `dedupeKey`, an existing pending/running job with
     * the same key is returned instead of inserting (the unique index is the
     * hard guarantee underneath).
     */
    async enqueue(input: EnqueueJobInput, at: number = Date.now()): Promise<Job> {
      const payload = jobPayloadSchema.parse(input.payload);
      const dedupeKey = input.dedupeKey ?? null;
      if (dedupeKey !== null) {
        const existing = await db
          .selectFrom('adminium_jobs')
          .selectAll()
          .where('dedupeKey', '=', dedupeKey)
          .executeTakeFirst();
        if (existing) return mapJob(existing);
      }
      const row = {
        id: newId('job'),
        kind: input.kind,
        payload: packJson(payload),
        status: 'pending',
        priority: input.priority ?? 0,
        runAt: input.runAt ?? at,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        lockedBy: null,
        lockedAt: null,
        dedupeKey,
        lastError: null,
        createdAt: at,
        startedAt: null,
        finishedAt: null,
      };
      await db.insertInto('adminium_jobs').values(row).execute();
      return mapJob(row as Selectable<AdminiumJobsTable>);
    },

    /**
     * Claim the next due job for `workerId` using the portable UPDATE guard.
     * Considers pending jobs due at `at` (priority desc, run_at asc, id asc)
     * and stale running jobs (lock older than `staleLockMs`). Returns null
     * when nothing is claimable.
     */
    async claim(
      workerId: string,
      at: number = Date.now(),
      staleLockMs: number = JOB_STALE_LOCK_MS,
    ): Promise<Job | null> {
      const candidates = await db
        .selectFrom('adminium_jobs')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb.and([eb('status', '=', 'pending'), eb('runAt', '<=', at)]),
            eb.and([eb('status', '=', 'running'), eb('lockedAt', '<', at - staleLockMs)]),
          ]),
        )
        .orderBy('priority', 'desc')
        .orderBy('runAt', 'asc')
        .orderBy('id', 'asc')
        .limit(5)
        .execute();

      for (const candidate of candidates) {
        let guard = db
          .updateTable('adminium_jobs')
          .set({
            status: 'running',
            lockedBy: workerId,
            lockedAt: at,
            startedAt: at,
            attempts: candidate.attempts + 1,
          })
          .where('id', '=', candidate.id)
          .where('status', '=', candidate.status);
        // Reclaiming a stale lock: make sure nobody re-locked it meanwhile.
        if (candidate.status === 'running') {
          guard = guard.where('lockedAt', '=', candidate.lockedAt);
        }
        const res = await guard.executeTakeFirst();
        if (Number(res.numUpdatedRows) === 1) {
          return await findById(candidate.id);
        }
        // Affected-rows 0: another worker won this candidate — try the next.
      }
      return null;
    },

    /** Success: terminal state; dedupe key released for reuse (§3.12). */
    async complete(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_jobs')
        .set({ status: 'succeeded', finishedAt: at, dedupeKey: null, lockedBy: null, lockedAt: null })
        .where('id', '=', id)
        .where('status', '=', 'running')
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Failure: retries with exponential backoff until `max_attempts`, then
     * lands in terminal `failed` (dedupe key released).
     */
    async fail(
      id: string,
      error: string,
      at: number = Date.now(),
      backoffBaseMs: number = JOB_BACKOFF_BASE_MS,
    ): Promise<Job | null> {
      const job = await findById(id);
      if (!job || job.status !== 'running') return null;
      if (job.attempts >= job.maxAttempts) {
        await db
          .updateTable('adminium_jobs')
          .set({ status: 'failed', finishedAt: at, lastError: error, dedupeKey: null, lockedBy: null, lockedAt: null })
          .where('id', '=', id)
          .where('status', '=', 'running')
          .execute();
      } else {
        const delay = backoffBaseMs * 2 ** Math.max(0, job.attempts - 1);
        await db
          .updateTable('adminium_jobs')
          .set({ status: 'pending', runAt: at + delay, lastError: error, lockedBy: null, lockedAt: null })
          .where('id', '=', id)
          .where('status', '=', 'running')
          .execute();
      }
      return await findById(id);
    },

    async cancel(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_jobs')
        .set({ status: 'cancelled', finishedAt: at, dedupeKey: null, lockedBy: null, lockedAt: null })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Retention §8 `jobs` policy: succeeded/cancelled past `retentionDays`,
     * failed kept twice as long.
     */
    async gc(at: number = Date.now(), retentionDays = 30): Promise<number> {
      const cutoff = at - retentionDays * DAY_MS;
      const failedCutoff = at - 2 * retentionDays * DAY_MS;
      const res = await db
        .deleteFrom('adminium_jobs')
        .where((eb) =>
          eb.or([
            eb.and([eb('status', 'in', ['succeeded', 'cancelled']), eb('finishedAt', '<', cutoff)]),
            eb.and([eb('status', '=', 'failed'), eb('finishedAt', '<', failedCutoff)]),
          ]),
        )
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type JobsRepo = ReturnType<typeof jobsRepo>;
