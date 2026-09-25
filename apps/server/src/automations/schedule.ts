// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SCHEDULE SCANNER — the owner's "a CRON workflow", and the half of
 * his appointment example a record trigger cannot express.
 *
 * "Email them two hours before their appointment" is not caused by a write.
 * Nothing happens at all: a row that was written last week becomes
 * interesting because the clock moved. So a schedule rule ticks, asks the
 * database which rows match right now, and starts one run per row.
 *
 * --- Two kinds of tick -----------------------------------------------------
 *
 * INTERVAL (every 5/10/15/30/60 minutes) is `last + n`. CALENDAR (daily,
 * weekly, monthly at HH:mm in a zone) goes through `schedule/next-run.ts`,
 * which is croner and therefore DST-correct — the module scheduled reports
 * already used, lifted rather than copied.
 *
 * --- "Once per record" is the exactly-once key -----------------------------
 *
 * An appointment 90 minutes out matches four consecutive 15-minute ticks. The
 * reminder must go once. That is not a "have I sent this?" lookup — it is the
 * dedupe key dropping the tick stamp, so all four ticks compute
 * `<rule>:<pk>` and only the first INSERT survives the unique index. Without
 * `once`, the key carries the tick and every tick is its own occurrence,
 * which is what a rule like "every hour, for each overdue invoice, post to
 * Slack" actually wants.
 *
 * --- The cap ---------------------------------------------------------------
 *
 * A scan is a query over the customer's own table with the operator's own
 * conditions, and a mistyped condition can match everything. One tick
 * enqueues at most 10,000 runs and writes an audit row saying it stopped —
 * loudly, because a rule that silently processes the first ten thousand rows
 * of a million-row table every hour is worse than one that fails.
 */

import type { Kysely } from 'kysely';
import {
  auditRepo,
  automationRunsRepo,
  automationsRepo,
  type Automation,
  type AutomationSchedule,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
} from '@adminium/meta';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { compileFilter } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { keptRow, type Row } from '../crud/mask.js';
import { pkLabel } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { nextRunAtOf } from '../schedule/next-run.js';
import { scheduleOccurrenceKey } from './events.js';
import {
  AUTOMATION_RUN_KIND,
  AUTOMATION_SCAN_CAP,
  AUTOMATION_SCAN_PAGE,
} from './kinds.js';
import { toRecordFilterAll } from './relative-time.js';

const MINUTE_MS = 60_000;

/**
 * When this rule ticks next. `from` is the tick that just happened (or "now"
 * when a rule is first saved), and the answer is always strictly after it —
 * a schedule that returned its own instant would spin.
 */
export function nextTickFor(schedule: AutomationSchedule, from: number): number | null {
  if (schedule.kind === 'interval') {
    return from + Number(schedule.everyMinutes) * MINUTE_MS;
  }
  return nextRunAtOf(
    {
      frequency: schedule.kind,
      time: schedule.time,
      dayOfWeek: schedule.dayOfWeek ?? null,
      dayOfMonth: schedule.dayOfMonth ?? null,
      timezone: schedule.timezone,
    },
    from,
  );
}

export interface ScheduleScanDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  enqueue(input: EnqueueJobInput): Promise<Job>;
  now?: (() => number) | undefined;
  log?: { warn(data: unknown, message: string): void } | undefined;
  /** Rows per page; the scan reads until the cap or the end. */
  page?: number | undefined;
  cap?: number | undefined;
}

export interface ScheduleTickResult {
  rulesDue: number;
  runsStarted: number;
  capped: number;
}

/** One tick over every due schedule rule. */
export async function scanDueSchedules(deps: ScheduleScanDeps): Promise<ScheduleTickResult> {
  const now = (deps.now ?? Date.now)();
  const rules = automationsRepo(deps.meta);
  const due = await rules.listDue(now);
  const result: ScheduleTickResult = { rulesDue: 0, runsStarted: 0, capped: 0 };

  for (const rule of due) {
    result.rulesDue += 1;
    try {
      const started = await runOneSchedule({ deps, rule, now });
      result.runsStarted += started.runsStarted;
      if (started.capped) result.capped += 1;
    } catch (error) {
      deps.log?.warn({ err: error, ruleId: rule.id }, 'automation schedule scan failed');
    } finally {
      // The tick is advanced whatever happened. A rule whose scan threw must
      // not re-run every minute for ever; it retries on its own next tick,
      // and the warning above is what an operator reads.
      if (rule.trigger.kind === 'schedule') {
        await rules.advance(rule.id, {
          lastRunAt: now,
          nextRunAt: nextTickFor(rule.trigger.schedule, now),
        });
      }
    }
  }
  return result;
}

async function runOneSchedule(input: {
  deps: ScheduleScanDeps;
  rule: Automation;
  now: number;
}): Promise<{ runsStarted: number; capped: boolean }> {
  const { deps, rule, now } = input;
  if (rule.trigger.kind !== 'schedule') return { runsStarted: 0, capped: false };
  const forEach = rule.trigger.forEach;

  // A bare tick: one run, no record. "Every night at 02:00, call this webhook."
  if (forEach === undefined) {
    const started = await claim({ deps, rule, now, table: null, row: null, tick: now });
    return { runsStarted: started ? 1 : 0, capped: false };
  }

  const connectionId = rule.trigger.connectionId;
  if (connectionId === null) return { runsStarted: 0, capped: false };
  const view = await loadSnapshotView(deps.meta, connectionId);
  const { db, dialect } = await deps.manager.data(connectionId);
  const table = view.table(forEach.table);

  const filter = toRecordFilterAll(forEach.where, { table, dialect, now });
  const page = deps.page ?? AUTOMATION_SCAN_PAGE;
  const cap = deps.cap ?? AUTOMATION_SCAN_CAP;

  let runsStarted = 0;
  let scanned = 0;
  let after: Row | null = null;
  let capped = false;

  for (;;) {
    const rows = await readPage({ db, view, table, dialect, filter, page, after });
    if (rows.length === 0) break;
    for (const row of rows) {
      const pk = Object.fromEntries(table.primaryKey.map((c) => [c, row[c]]));
      const started = await claim({
        deps,
        rule,
        now,
        table,
        row,
        pk,
        // `once` drops the tick from the key, so every later tick that matches
        // the same row collapses onto the run the first one made.
        tick: forEach.once ? undefined : now,
      });
      if (started) runsStarted += 1;
      scanned += 1;
      if (scanned >= cap) {
        capped = true;
        break;
      }
    }
    if (capped || rows.length < page) break;
    after = rows[rows.length - 1] ?? null;
  }

  if (capped) {
    await auditRepo(deps.meta).append({
      actorKind: 'automation',
      actorId: rule.id,
      actorLabel: rule.name,
      category: 'automation',
      action: 'automation.scan-capped',
      connectionId,
      changes: { after: { table: table.id, cap, rule: rule.name } },
    });
  }
  return { runsStarted, capped };
}

/** Keyset page over the primary key — a scan must not depend on OFFSET. */
async function readPage(input: {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  table: ResolvedTable;
  dialect: Parameters<typeof compileFilter>[1]['dialect'];
  filter: ReturnType<typeof toRecordFilterAll>;
  page: number;
  after: Row | null;
}): Promise<Row[]> {
  const { db, table } = input;
  let query = db.selectFrom(table.id).selectAll().limit(input.page);
  for (const column of table.primaryKey) query = query.orderBy(db.dynamic.ref(column), 'asc');
  if (input.filter !== null) {
    const filter = input.filter;
    query = query.where((eb) =>
      compileFilter(
        eb as never,
        {
          view: input.view,
          table,
          // The scan reads rows the RUN will act on, so it must see the real
          // values; masking happens where the trace is written.
          canReadPii: true,
          dynamic: db.dynamic,
          dialect: input.dialect,
        },
        filter,
      ),
    );
  }
  const after = input.after;
  if (after !== null && table.primaryKey.length === 1) {
    const key = table.primaryKey[0] as string;
    query = query.where(db.dynamic.ref(key), '>', after[key] as never);
  }
  return (await query.execute()) as Row[];
}

async function claim(input: {
  deps: ScheduleScanDeps;
  rule: Automation;
  now: number;
  table: ResolvedTable | null;
  row: Row | null;
  pk?: Row | undefined;
  tick: number | undefined;
}): Promise<boolean> {
  const { deps, rule, now, table, row } = input;
  if (rule.trigger.kind !== 'schedule') return false;
  const pk = input.pk ?? null;

  const run = await automationRunsRepo(deps.meta).begin(
    {
      automationId: rule.id,
      dedupeKey: scheduleOccurrenceKey({
        ruleId: rule.id,
        table,
        pk,
        ...(input.tick === undefined ? {} : { tick: input.tick }),
      }),
      origin: 'schedule',
      triggerEvent: {
        event: 'schedule.tick',
        origin: 'schedule',
        ruleId: null,
        hops: 0,
        record:
          table === null || pk === null || rule.trigger.connectionId === null
            ? null
            : {
                connectionId: rule.trigger.connectionId,
                table: table.id,
                pk,
                label: pkLabel(table, pk),
              },
        snapshot: table === null || row === null ? null : keptRow(row, table),
        occurredAt: now,
      },
      wakeAt: null,
    },
    now,
  );
  if (run === null) return false;

  const job = await deps.enqueue({
    kind: AUTOMATION_RUN_KIND,
    payload: { runId: run.id },
    runAt: now,
    dedupeKey: `run:${run.id}`,
    maxAttempts: 1,
  });
  await automationRunsRepo(deps.meta).attachJob(run.id, job.id);
  return true;
}
