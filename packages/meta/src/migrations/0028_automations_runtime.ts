// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0028 — the runtime columns automations need to actually run
 * (42-automations-and-workflow-logs.md §3.2, 42-T01).
 *
 * ─── Why 0006's tables were not enough ─────────────────────────────────────
 *
 * `adminium_automations` and `adminium_automation_runs` have existed since
 * migration 0006 as DDL with no code behind them (27-T13). They hold WHAT a
 * rule is (`trigger`, `graph`) and WHAT a run did (`trigger_event`, `trace`).
 * What they never held is the bookkeeping a running engine needs: when the
 * next schedule tick is due, how far a watch poller has read, whether an
 * occurrence has already fired, and when a suspended run wakes up. Those are
 * the six columns below.
 *
 * ─── `dedupe_key` is the exactly-once guarantee (D6) ───────────────────────
 *
 * Four different producers can decide the same thing happened: the route
 * matcher (Adminium wrote the row), the watch poller (the customer's app
 * wrote it), the schedule scanner (the row matched this tick) and the dry
 * run. A check-then-insert between them is a race; a UNIQUE index is not.
 * Every producer INSERTs the `pending` run row FIRST and reads a unique
 * violation as "somebody already fired this" — which is why a row created
 * through the dashboard and then seen by the poller a minute later is ONE
 * run, not two. NULLs are exempt from unique on all three dialects, so runs
 * that need no occurrence identity (a schedule tick with no `forEach`) carry
 * NULL, exactly as `adminium_jobs.dedupe_key` does (0005).
 *
 * 160 chars: a rule id (31) + a JSON pk map + a timestamp or tick stamp. A
 * pk map longer than that is hashed by the caller rather than truncated —
 * truncation would collapse two DIFFERENT records onto one key and silently
 * drop a run.
 *
 * ─── `wake_at` is on the RUN, not just the job (D7, D8) ────────────────────
 *
 * A wait step re-enqueues the run as a delayed job, so the job row already
 * knows when it resumes. `wake_at` duplicates that on the run because the
 * Workflow logs detail has to say "resumes in 4 hours" without joining a
 * queue table whose rows are garbage-collected on a shorter clock than the
 * runs are (`retention.jobsDays` vs `retention.automationRunsDays`). It is
 * also what a `pending` dashboard-origin run shows while it waits out the
 * 60 s undo window.
 *
 * ─── `origin` is a column, not a `trigger_event` field ─────────────────────
 *
 * It IS also in the `trigger_event` json, and that copy is the record of what
 * happened. This one exists because the undo mapping has to find "every
 * pending dashboard-origin run for these records" in a WHERE clause, and json
 * columns in this store are opaque by design (07 §3: never queried with JSON
 * operators). `str(12)` fits the longest value, `dashboard` (9).
 *
 * ─── `duration_ms` excludes waits ──────────────────────────────────────────
 *
 * `finished_at - started_at` on a run that slept for two days is two days,
 * which is true and useless — the Workflow Logs KPI is "how long does this
 * automation take to do its work". So the runner sums step durations and
 * writes them here, and waits contribute nothing.
 *
 * ─── `watch_cursor` is json, not a timestamp ───────────────────────────────
 *
 * A poller over `created_at` has to survive ties: ten rows written in the
 * same millisecond must not lose nine. The cursor is therefore a KEYSET —
 * `{ value, frontierPk }`, the column value plus the primary key of the last
 * row consumed at that value — rather than a scalar (§3.3).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const automations = metaTable('automations');
  const runs = metaTable('automation_runs');

  // --- adminium_automations ------------------------------------------------

  /** Next schedule tick, epoch ms; NULL for record-triggered rules. */
  await db.schema.alterTable(automations).addColumn('next_run_at', c.ts).execute();

  /** `{ value, seenPks }` — how far the watch poller has read (§3.3). */
  await db.schema.alterTable(automations).addColumn('watch_cursor', c.json).execute();

  /** Minutes a person would have spent — the comp's ROI segment (F6). NULL = not stated. */
  await db.schema.alterTable(automations).addColumn('time_saved_minutes', c.int).execute();

  // The scanner's worklist, every minute: "enabled rules whose tick has passed".
  await db.schema
    .createIndex('idx_adminium_automations_next_run_at')
    .on(automations)
    .columns(['next_run_at'])
    .execute();

  // --- adminium_automation_runs --------------------------------------------

  /** The occurrence identity; see the header. NULL = no identity to collapse on. */
  await db.schema.alterTable(runs).addColumn('dedupe_key', c.str(160)).execute();

  /** When a `pending` or `waiting` run resumes, epoch ms. */
  await db.schema.alterTable(runs).addColumn('wake_at', c.ts).execute();

  /** Sum of step durations, waits excluded. */
  await db.schema.alterTable(runs).addColumn('duration_ms', c.int).execute();

  /** dashboard | public | bulk | watch | schedule | test | automation. */
  await db.schema
    .alterTable(runs)
    .addColumn('origin', c.str(12), (col) => col.notNull().defaultTo('dashboard'))
    .execute();

  // NULLs are exempt from unique on all three dialects (the 0005 precedent).
  await db.schema
    .createIndex('uq_adminium_automation_runs_dedupe_key')
    .on(runs)
    .columns(['dedupe_key'])
    .unique()
    .execute();

  // Workflow Logs' window: "today's failures", "this week's runs", newest first.
  await db.schema
    .createIndex('idx_adminium_automation_runs_status_started')
    .on(runs)
    .columns(['status', 'started_at'])
    .execute();
}
