// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WATCH POLLER — the owner's "listener" (42-automations-and-workflow-
 * logs.md D4).
 *
 * The feature was asked for with one example: "a user signs up, send them a
 * welcome email". In every deployment that matters, that sign-up is a row the
 * CUSTOMER'S OWN APPLICATION inserts into its own users table. It never
 * touches `routes/data`, so a route trigger alone would fire for
 * dashboard-made users and nobody else — a feature that looks built and does
 * nothing for the case it exists to serve. This is what closes that.
 *
 * --- What one tick does ----------------------------------------------------
 *
 * For each enabled watching rule: read up to 500 rows past the stored cursor,
 * ordered by the cursor column then the primary key, claim each one under the
 * SAME occurrence key the route matcher would have used, and move the cursor.
 * A row Adminium wrote a minute ago and the poller now sees is therefore ONE
 * run, not two — the unique index decides, not a lookup.
 *
 * --- Ties, and why the cursor is a keyset ----------------------------------
 *
 * Ten rows can carry the same `created_at` to the millisecond. A cursor of
 * `> value` loses nine of them; a cursor of `>= value` re-reads all ten every
 * tick for ever — and if the tie block is larger than one batch, a poller
 * that skips already-seen rows in memory reads the same full page every
 * minute and never reaches the eleventh row at all. So the cursor is the pair
 * the query already orders by: `(column value, primary key)`, and the next
 * tick asks for `col > value OR (col = value AND pk > frontier)`. Progress is
 * then unconditional. The dedupe key would make a mistake here harmless
 * rather than duplicative, but "harmless" is not "correct": a rule that
 * silently skips every tenth sign-up is the bug this shape prevents.
 *
 * --- A first watch starts at NOW -------------------------------------------
 *
 * Switching a rule on must not replay history. A rule with no cursor yet
 * records the current position and fires for nothing; the inspector says so
 * ("Rows from now on"). The alternative — emailing every user who ever signed
 * up, the moment an operator flips a switch — is the kind of mistake nobody
 * gets to make twice.
 */

import type { Expression, ExpressionBuilder, Kysely, SqlBool } from 'kysely';
import type { Dialect } from '@adminium/engine';
import {
  automationRunsRepo,
  automationsRepo,
  type Automation,
  type AutomationWatchCursor,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
} from '@adminium/meta';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { keptRow, type Row } from '../crud/mask.js';
import { pkLabel } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { evaluateAll, type ConditionContext, type RelatedCountSpec } from './conditions.js';
import { recordOccurrenceKey } from './events.js';
import { AUTOMATION_RUN_KIND, AUTOMATION_WATCH_BATCH } from './kinds.js';
import { serverDay } from './relative-time.js';
import { watchColumnFor } from './watch-columns.js';

export interface WatchPollDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  enqueue(input: EnqueueJobInput): Promise<Job>;
  countRelated?:
    | ((connectionId: string, spec: RelatedCountSpec, now: number) => Promise<number>)
    | undefined;
  now?: (() => number) | undefined;
  log?: { warn(data: unknown, message: string): void } | undefined;
  /** Rows read per rule per tick; the batch bound. */
  batch?: number | undefined;
}

export interface WatchTickResult {
  rulesPolled: number;
  rowsSeen: number;
  runsStarted: number;
}

/** One tick over every watching rule. Returns what it did, for the log. */
export async function pollWatchedTables(deps: WatchPollDeps): Promise<WatchTickResult> {
  const now = (deps.now ?? Date.now)();
  const rules = automationsRepo(deps.meta);
  const watching = await rules.listWatching();
  const result: WatchTickResult = { rulesPolled: 0, rowsSeen: 0, runsStarted: 0 };
  if (watching.length === 0) return result;

  // One snapshot view and one data handle per connection, not per rule: a
  // dozen rules on the same table would otherwise re-read the snapshot a
  // dozen times a minute.
  const views = new Map<string, SnapshotView>();
  const handles = new Map<string, { db: Kysely<SourceDatabase>; dialect: Dialect }>();

  for (const rule of watching) {
    if (rule.trigger.kind !== 'record') continue;
    const connectionId = rule.trigger.connectionId;
    try {
      let view = views.get(connectionId);
      if (view === undefined) {
        view = await loadSnapshotView(deps.meta, connectionId);
        views.set(connectionId, view);
      }
      let handle = handles.get(connectionId);
      if (handle === undefined) {
        handle = await deps.manager.data(connectionId);
        handles.set(connectionId, handle);
      }
      const table = view.table(rule.trigger.table);
      const tick = await pollOneRule({ deps, rule, table, db: handle.db, dialect: handle.dialect, now });
      result.rulesPolled += 1;
      result.rowsSeen += tick.rowsSeen;
      result.runsStarted += tick.runsStarted;
    } catch (error) {
      // A disabled connection, a dropped table, a snapshot that never ran —
      // one broken rule must not stop the tick for the others.
      deps.log?.warn({ err: error, ruleId: rule.id }, 'automation watch failed for rule');
    }
  }
  return result;
}

async function pollOneRule(input: {
  deps: WatchPollDeps;
  rule: Automation;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  now: number;
}): Promise<{ rowsSeen: number; runsStarted: number }> {
  const { deps, rule, table, db, dialect, now } = input;
  if (rule.trigger.kind !== 'record') return { rowsSeen: 0, runsStarted: 0 };
  const event = rule.trigger.event === 'updated' ? 'updated' : 'created';
  const watched = watchColumnFor(table, event);
  // The table stopped qualifying (a column was dropped, the snapshot changed).
  if (watched === null) return { rowsSeen: 0, runsStarted: 0 };

  const rules = automationsRepo(deps.meta);
  const stored = rule.watchCursor === null ? null : dayCursor(rule.watchCursor, table, dialect);

  // First tick for this rule (or the column changed under it): record where we
  // are and fire for nothing.
  if (stored === null || stored.column !== watched.column) {
    await rules.advance(rule.id, { watchCursor: await readHead(db, table, watched.column) });
    return { rowsSeen: 0, runsStarted: 0 };
  }

  let query = db
    .selectFrom(table.id)
    .selectAll()
    .orderBy(db.dynamic.ref(watched.column), 'asc')
    .limit(deps.batch ?? AUTOMATION_WATCH_BATCH);
  for (const column of table.primaryKey) query = query.orderBy(db.dynamic.ref(column), 'asc');
  if (stored.value !== null) {
    query = query.where((eb) => keysetAfter(eb, db, table, watched.column, stored));
  }
  const rows = (await query.execute()) as Row[];
  if (rows.length === 0) return { rowsSeen: 0, runsStarted: 0 };

  let runsStarted = 0;
  for (const row of rows) {
    const pk = Object.fromEntries(table.primaryKey.map((c) => [c, row[c]]));
    if (await claimRow({ deps, rule, table, row, pk, event, watched, dialect, now })) runsStarted += 1;
  }

  // The LAST ROW OF THE PAGE, whatever happened to it. A row the conditions
  // rejected still moves the frontier — it has been considered, and leaving
  // the cursor behind it would re-consider it every minute for ever.
  const last = rows[rows.length - 1] as Row;
  const cursor: AutomationWatchCursor = {
    column: watched.column,
    value: normalizeCursorValue(last[watched.column]),
    frontierPk: Object.fromEntries(table.primaryKey.map((c) => [c, last[c] ?? null])),
  };
  await rules.advance(rule.id, { watchCursor: cursor });
  return { rowsSeen: rows.length, runsStarted };
}

/**
 * `col > value OR (col = value AND pk > frontier)`, with the pk comparison
 * unrolled column by column so a composite key works too. Kysely builds it;
 * every value binds as a parameter.
 */
function keysetAfter(
  eb: ExpressionBuilder<SourceDatabase, never>,
  db: Kysely<SourceDatabase>,
  table: ResolvedTable,
  column: string,
  cursor: AutomationWatchCursor,
): Expression<SqlBool> {
  const ref = db.dynamic.ref(column);
  const past = eb(ref as never, '>', cursor.value as never);
  const frontier = cursor.frontierPk;
  if (frontier === null || table.primaryKey.length === 0) return past;

  // (a > A) OR (a = A AND b > B) OR (a = A AND b = B AND c > C) — the standard
  // lexicographic unroll, because row-value comparison is not portable.
  const tiers: Expression<SqlBool>[] = [];
  for (let i = 0; i < table.primaryKey.length; i += 1) {
    const parts: Expression<SqlBool>[] = [eb(ref as never, '=', cursor.value as never)];
    for (let j = 0; j < i; j += 1) {
      const key = table.primaryKey[j] as string;
      parts.push(eb(db.dynamic.ref(key) as never, '=', (frontier[key] ?? null) as never));
    }
    const key = table.primaryKey[i] as string;
    parts.push(eb(db.dynamic.ref(key) as never, '>', (frontier[key] ?? null) as never));
    tiers.push(eb.and(parts));
  }
  return eb.or([past, ...tiers]);
}

async function claimRow(input: {
  deps: WatchPollDeps;
  rule: Automation;
  table: ResolvedTable;
  row: Row;
  pk: Row;
  event: 'created' | 'updated';
  watched: { column: string };
  dialect: Dialect;
  now: number;
}): Promise<boolean> {
  const { deps, rule, table, row, pk, event, dialect, now } = input;
  if (rule.trigger.kind !== 'record') return false;

  const when = rule.trigger.when ?? [];
  if (when.length > 0) {
    const count = deps.countRelated;
    const ctx: ConditionContext = {
      row,
      table,
      now,
      countRelated:
        count === undefined ? undefined : (spec) => count(rule.trigger.connectionId as string, spec, now),
    };
    if (!(await evaluateAll(when, ctx))) return false;
  }

  // The SAME key the route matcher builds — that identity is the whole reason
  // a dashboard-made row does not fire twice (`events.ts`).
  const changeStamp = event === 'updated' ? row[input.watched.column] : undefined;
  const dedupeKey = recordOccurrenceKey(
    changeStamp === undefined
      ? { ruleId: rule.id, table, pk }
      : { ruleId: rule.id, table, pk, changeStamp, dialect },
  );

  const run = await automationRunsRepo(deps.meta).begin(
    {
      automationId: rule.id,
      dedupeKey,
      origin: 'watch',
      triggerEvent: {
        event: event === 'created' ? 'record.created' : 'record.updated',
        origin: 'watch',
        ruleId: null,
        hops: 0,
        record: {
          connectionId: rule.trigger.connectionId,
          table: table.id,
          pk,
          label: pkLabel(table, pk),
        },
        snapshot: keptRow(row, table),
        occurredAt: now,
      },
      // Nobody can undo a write Adminium did not make.
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

/**
 * The table's current high-water mark — where a first watch starts. The LAST
 * row in the poller's own ordering, so the very next tick continues from
 * exactly where this one would have left off had it read the whole table.
 */
async function readHead(
  db: Kysely<SourceDatabase>,
  table: ResolvedTable,
  column: string,
): Promise<AutomationWatchCursor> {
  let query = db.selectFrom(table.id).selectAll().orderBy(db.dynamic.ref(column), 'desc').limit(1);
  for (const key of table.primaryKey) query = query.orderBy(db.dynamic.ref(key), 'desc');
  const row = (await query.executeTakeFirst()) as Row | undefined;
  if (row === undefined) return { column, value: null, frontierPk: null };
  return {
    column,
    value: normalizeCursorValue(row[column]),
    frontierPk: Object.fromEntries(table.primaryKey.map((c) => [c, row[c] ?? null])),
  };
}

/**
 * A stored cursor on a Postgres or MySQL `date` column, as the poller compares
 * it now. Before dates read as `YYYY-MM-DD` text the driver handed back a
 * JavaScript date at this server's local midnight, stored below as its ISO
 * instant: `2026-08-13T22:00:00.000Z` for the 14th in Berlin. Compared with
 * a date as it stands, that is the 13th, and the first tick would read the
 * 14th's rows again. The instant is read back as the day it was on this
 * server's clock. SQLite's date cursor is whatever text the column holds,
 * compared as text, and is left alone.
 */
function dayCursor(cursor: AutomationWatchCursor, table: ResolvedTable, dialect: Dialect): AutomationWatchCursor {
  const value = cursor.value;
  if (dialect === 'sqlite' || table.columns.get(cursor.column)?.logicalType !== 'date') return cursor;
  if (value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return cursor;
  const at = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(at) ? { ...cursor, value: serverDay(at) } : cursor;
}

/**
 * A cursor is STORED as json, so a driver Date has to become something json
 * round-trips. ISO-8601 keeps chronological order under a string comparison,
 * which is what the `>=` above does on SQLite.
 */
function normalizeCursorValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return value;
  return String(value);
}

