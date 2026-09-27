// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TIMED MOVES — the moves Adminium makes by itself once a moment of the row
 * has passed (`states.timed`): a held order expires at its `held_until`, a
 * transfer not paid by its deadline becomes overdue and, a grace period later,
 * released; a waitlist offer lapses; a guest not arrived by the next morning
 * is a no-show; an order not collected by closing is not collected.
 *
 * ─── When ───────────────────────────────────────────────────────────────────
 *
 * Once a minute, per connection with such a rule, one job (`app.timed-moves`)
 * — at most one per connection at a time across every instance: the meta
 * store's dedupe key is the lock. No lock on the source database is held
 * across rows: each move is its own write, in its own transaction.
 *
 * ─── Which rows ─────────────────────────────────────────────────────────────
 *
 * Every rule reads its own row's moment. The rows still in the rule's `from`
 * whose moment has passed are found by a query bounded by the state and a
 * limit on the moment's column (a bound a little wide where the moment reads a
 * wall time or calendar days), then judged exactly (`crud/moments.ts`) on the
 * venue's clock. At most 500 rows move per connection per minute, the
 * longest-due first across every rule. A row whose move was refused (a lock,
 * a condition that no longer holds, a column the role may not write) is logged
 * and left alone for an hour — and the query pages past it, so rows refused
 * never keep newer ones waiting. Which rows are left alone is handed from one
 * minute's job to the next in the jobs store, so another instance knows too.
 *
 * ─── How ────────────────────────────────────────────────────────────────────
 *
 * Each move is an ordinary write (`writes.update`): its stamps are written,
 * its states judged — as the app's declared move, so a role the move is kept
 * for does not stop it, and nothing else is excused — its effects made, and
 * it is announced like any change: audited as "Timed move", seen by screens,
 * an app's emails and the rules. It moves the row only while the row is still
 * in `from` and its moment's columns still hold what was read: a row moved or
 * re-dated meanwhile is left as it is, and two runners never move a row twice.
 * A sample row is moved too (it sends no email — the outbox leaves sample rows
 * alone) and its sample record is brought up to date, so "Remove sample data"
 * still takes it for the app's own.
 *
 * Holds never wait for this job: a held order stops counting against a limit
 * at its moment by the clock, whether or not it has been moved.
 */
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import { connectionTenantConfig, jobsRepo, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import type { Moment, TimedMove } from '@adminium/manifest';
import { z } from 'zod';

import type { TableStatesRule } from '../connections/effective-schema.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { afterRecordWrite } from '../crud/after-record-write.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { dayPlus, momentOf, momentSettings, readDay, readInstant, type MomentSettings } from '../crud/moments.js';
import { pkLabel } from '../crud/records.js';
import { venueClock } from '../crud/venue-time.js';
import { createWriteService, type RecordWriteService, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import { bindWriteValue, normalizeWriteValue } from '../crud/write-values.js';
import { AppError } from '../errors.js';
import type { JobRegistry } from '../jobs/registry.js';
import { createPublicViews } from '../public-api/runtime.js';
import { rehashSampleRow } from '../apps/sample-data.js';
import { announceEffects } from './effects.js';

export const TIMED_MOVES_SCHEDULE_NAME = 'app-timed-moves';
export const TIMED_MOVES_JOB_KIND = 'app.timed-moves';
export const TIMED_MOVES_JITTER_MS = 15_000;
/** How many rows move per connection per minute. */
export const TIMED_MOVES_PER_TICK = 500;
/** How many pages of due rows one rule reads past rows left alone, at most. */
const PAGES = 5;
/** How long a refused row is left alone. */
const LEAVE_ALONE_MS = 3_600_000;
/** A due query slower than this is logged: a manifest cannot give the moment's column an index. */
const SLOW_QUERY_MS = 200;
/** Who a timed move is, in the audit log. */
const ACTOR = { kind: 'system' as const, id: null, label: 'Timed move' };
/** Refusals that pass: the next minute tries again. */
const TRANSIENT = new Set(['WRITE_CONFLICT', 'CAPACITY_BUSY', 'NUMBER_BUSY', 'BOOKING_BUSY']);

type Db = Kysely<SourceDatabase>;

/** Rows left alone until an instant, by connection, table, key and rule. */
export type LeftAlone = Record<string, number>;

interface Logger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
}

export interface TimedMovesDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** Where a move is announced (audit, screens, emails, rules); absent, nothing is announced but the write. */
  app?: FastifyInstance | undefined;
  writes?: RecordWriteService | undefined;
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
  log?: Logger | undefined;
  /** How many rows move per connection per minute (500). */
  perTick?: number | undefined;
}

export interface TimedMovesTick {
  moved: number;
  refused: number;
  skipped: number;
  left: LeftAlone;
}

/** One row due to move, and why. */
interface Due {
  target: WriteTarget;
  states: TableStatesRule;
  rule: TimedMove;
  index: number;
  row: Row;
  pk: Row;
  at: Date;
  key: string;
}

/** Whether a table's states list a timed move. */
const timedTables = (view: SnapshotView): ResolvedTable[] =>
  view.model.tables
    .filter((table) => (table.states?.timed?.length ?? 0) > 0)
    .map((table) => view.table(table.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The own columns a moment reads, first to last fallback. */
const columnsOf = (moment: Moment): string[] => [moment.column, ...(moment.or ?? []).map((m) => m.column)];

/**
 * How much earlier than its column a moment can fall, at most, in
 * milliseconds — so a query bounded by the column finds every row whose
 * moment has passed (a few more are judged exactly and left). Null when the
 * shift cannot be read (a setting that is not a number): no moment, no move.
 */
async function earliestShift(moment: Moment | { plus?: Moment['plus']; minus?: Moment['minus']; time?: Moment['time'] }, settings: MomentSettings): Promise<number | null> {
  const side = moment.plus !== undefined ? 1 : moment.minus !== undefined ? -1 : 0;
  const shift = moment.plus ?? moment.minus;
  let ms = 0;
  let slack = moment.time === undefined ? 0 : 26 * 3_600_000;
  if (shift !== undefined) {
    const [unit, amount] = Object.entries(shift).find(([, value]) => value !== undefined) as ['minutes' | 'hours' | 'days', number | { table: string; column: string }];
    const read = typeof amount === 'number' ? amount : Number(await settings(amount));
    if (!Number.isFinite(read) || read < 0) return null;
    ms = read * (unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 86_400_000);
    if (unit === 'days') slack += 2 * 3_600_000;
  }
  return side * ms - slack;
}

/** The first column of a table's key, when it has one key column (a timed move needs one to name its row). */
const keyColumn = (table: ResolvedTable): string | null => (table.primaryKey.length === 1 ? table.primaryKey[0]! : null);

/**
 * The rows one rule may move now, oldest due first: bounded by the state, the
 * moment's columns and a limit, paged past the rows left alone, judged
 * exactly. At most `want` rows.
 */
async function dueOf(
  db: Db,
  dialect: Dialect,
  target: WriteTarget,
  states: TableStatesRule,
  rule: TimedMove,
  index: number,
  context: { now: Date; zone: string; settings: MomentSettings; left: LeftAlone; want: number; log?: Logger | undefined },
): Promise<Due[]> {
  const table = target.table;
  const key = keyColumn(table);
  if (key === null) return [];
  const moments: { column: string; bound: unknown }[] = [];
  for (const [i, column] of columnsOf(rule.at).entries()) {
    const part = i === 0 ? rule.at : rule.at.or![i - 1]!;
    const shift = await earliestShift(part, context.settings);
    const resolved = table.columns.get(column);
    if (shift === null || resolved === undefined) continue;
    const latest = new Date(context.now.getTime() - shift);
    // A day column: every day up to the venue's day at the latest instant the moment could start from.
    const bound = resolved.logicalType === 'date' ? dayPlus(venueClock(latest, context.zone).day, 1) : bindWriteValue(resolved, latest.toISOString(), dialect);
    moments.push({ column, bound });
  }
  if (moments.length === 0) return [];
  const plain = moments.length === 1 && (rule.at.or ?? []).length === 0;
  const out: Due[] = [];
  let after: { at: unknown; pk: unknown } | null = null;
  for (let page = 0; page < PAGES && out.length < context.want; page += 1) {
    let query = db
      .selectFrom(table.id)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(states.column), '=', rule.from))
      .where((eb) =>
        eb.or(
          moments.map((m, i) =>
            eb.and([
              ...moments.slice(0, i).map((earlier) => eb(db.dynamic.ref(earlier.column), 'is', null)),
              eb(db.dynamic.ref(m.column), 'is not', null),
              eb(db.dynamic.ref(m.column), '<=', m.bound as never),
            ]),
          ),
        ),
      );
    if (after !== null) {
      const { at, pk } = after;
      query = plain
        ? query.where((eb) =>
            eb.or([eb(db.dynamic.ref(moments[0]!.column), '>', at as never), eb.and([eb(db.dynamic.ref(moments[0]!.column), '=', at as never), eb(db.dynamic.ref(key), '>', pk as never)])]),
          )
        : query.where((eb) => eb(db.dynamic.ref(key), '>', pk as never));
    }
    if (plain) query = query.orderBy(db.dynamic.ref(moments[0]!.column)).orderBy(db.dynamic.ref(key));
    else query = query.orderBy(db.dynamic.ref(key));
    const started = Date.now();
    const rows = (await query.limit(context.want).execute()) as Row[];
    const took = Date.now() - started;
    if (took > SLOW_QUERY_MS) context.log?.warn({ table: table.id, rule: index, ms: took }, 'timed move due query slow');
    for (const row of rows) {
      const pk = { [key]: row[key] };
      const name = `${target.connectionId}|${table.id}|${String(row[key])}|${String(index)}`;
      if ((context.left[name] ?? 0) > context.now.getTime()) continue;
      const at = await momentOf(rule.at, { table, row, linked: new Map(), zone: context.zone, settings: context.settings, db });
      if (at === null || at.getTime() > context.now.getTime()) continue;
      out.push({ target, states, rule, index, row, pk, at, key: name });
    }
    if (rows.length < context.want) break;
    const last = rows.at(-1)!;
    after = { at: plain ? readStored(table, moments[0]!.column, last[moments[0]!.column], dialect) : null, pk: last[key] };
  }
  return out.slice(0, context.want);
}

/** A stored value bound back into a query as its column keeps it (a moment read as a Date, on MySQL). */
function readStored(table: ResolvedTable, column: string, value: unknown, dialect: Dialect): unknown {
  const resolved = table.columns.get(column);
  if (resolved === undefined || value === null || value === undefined) return value;
  if (resolved.logicalType === 'date') return readDay(value);
  const instant = readInstant(value);
  return instant === null ? value : bindWriteValue(resolved, instant.toISOString(), dialect);
}

/**
 * Move every row of one connection whose timed move is due, up to 500, the
 * longest-due first. `left` is the rows left alone after a refusal (from the
 * last minute's job); the answer carries it on, pruned.
 */
export async function runTimedMoves(deps: TimedMovesDeps, connectionId: string, left: LeftAlone = {}, now: Date = new Date()): Promise<TimedMovesTick> {
  const viewFor = deps.viewFor ?? createPublicViews(deps.meta).viewFor;
  const view = await viewFor(connectionId);
  const kept: LeftAlone = Object.fromEntries(Object.entries(left).filter(([, until]) => until > now.getTime()));
  const tick: TimedMovesTick = { moved: 0, refused: 0, skipped: 0, left: kept };
  if (view === null) return tick;
  const tables = timedTables(view);
  if (tables.length === 0) return tick;
  const { db, dialect } = await deps.manager.data(connectionId);
  const zone = (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? 'UTC';
  const settings = momentSettings(db);
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  const perTick = deps.perTick ?? TIMED_MOVES_PER_TICK;

  // Read every due row first, then write them one by one: no write runs inside an open read.
  const due: Due[] = [];
  for (const table of tables) {
    const states = table.table.states!;
    const target: WriteTarget = { connectionId, view, table, db, dialect, timezone: zone };
    for (const [index, rule] of states.timed!.entries()) {
      due.push(...(await dueOf(db, dialect, target, states, rule, index, { now, zone, settings, left: kept, want: perTick, log: deps.log })));
    }
  }
  due.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  tick.skipped = Math.max(0, due.length - perTick);
  for (const one of due.slice(0, perTick)) {
    try {
      (await moveOne(deps, writes, one)) ? (tick.moved += 1) : undefined;
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      if (TRANSIENT.has(error.code)) continue;
      tick.refused += 1;
      kept[one.key] = now.getTime() + LEAVE_ALONE_MS;
      deps.log?.warn({ connectionId, table: one.target.table.id, pk: one.pk, rule: one.index, code: error.code }, 'timed move refused; left alone for an hour');
    }
  }
  if (tick.moved + tick.refused > 0) deps.log?.info({ connectionId, moved: tick.moved, refused: tick.refused, skipped: tick.skipped }, 'timed moves');
  return tick;
}

/** One timed move, as an ordinary write that moves the row only if it is still as it was read. Whether it moved. */
async function moveOne(deps: TimedMovesDeps, writes: RecordWriteService, one: Due): Promise<boolean> {
  const { target, states, rule, row } = one;
  const values: Row = { [states.column]: rule.to };
  for (const [column, value] of Object.entries(rule.set ?? {})) {
    const resolved = target.table.columns.get(column);
    values[column] = resolved === undefined ? value : normalizeWriteValue(resolved, value);
  }
  const context: WriteContext = { origin: 'automation', hops: 0, actor: ACTOR, request: null, declared: { from: rule.from, to: rule.to } };
  // Still in `from`, and the moment's columns still as read: a row moved or re-dated meanwhile is left alone.
  const read = columnsOf(rule.at).map((column) => ({ column, value: readStored(target.table, column, row[column], target.dialect) }));
  const outcome = await writes.update({
    target,
    pk: one.pk,
    values,
    context,
    skipIfNone: true,
    refine: (query) => {
      let out = query.where((eb) => eb(eb.ref(states.column as never), '=', rule.from as never));
      for (const { column, value } of read) {
        out = out.where((eb) => (value === null || value === undefined ? eb(eb.ref(column as never), 'is', null) : eb(eb.ref(column as never), '=', value as never)));
      }
      return out;
    },
    announce: async (moved) => {
      if (deps.app === undefined) return;
      await afterRecordWrite(deps.app, {
        request: null,
        actor: ACTOR,
        meta: deps.meta,
        connectionId: target.connectionId,
        table: target.table,
        action: 'update',
        entity: { connectionId: target.connectionId, table: target.table.id, pk: one.pk, label: pkLabel(target.table, one.pk) },
        before: moved.before,
        after: moved.after,
        origin: 'automation',
      });
      await announceEffects(deps.app, { connectionId: target.connectionId, view: target.view, effects: moved.effects, origin: 'automation', actor: ACTOR });
    },
  });
  if (outcome.count === 0) return false;
  // A sample row moved stays the app's own to take away.
  await rehashSampleRow(deps.meta, target, one.pk).catch((error: unknown) => {
    deps.log?.warn({ err: error, table: target.table.id, pk: one.pk }, 'sample row not re-recorded after a timed move');
  });
  return true;
}

const payloadSchema = z
  .object({ connectionId: z.string().min(1).max(64), left: z.record(z.string(), z.number()).optional() })
  .strict();

/** The minute job: move one connection's due rows, and hand on the rows left alone. */
export function registerTimedMovesHandler(registry: JobRegistry, deps: TimedMovesDeps): void {
  registry.registerJobHandler(
    TIMED_MOVES_JOB_KIND,
    payloadSchema,
    async (payload, ctx) => {
      const tick = await runTimedMoves(deps, payload.connectionId, payload.left ?? {});
      await jobsRepo(deps.meta).setPayload(ctx.jobId, { connectionId: payload.connectionId, left: tick.left });
      return { moved: tick.moved, refused: tick.refused, skipped: tick.skipped };
    },
    { internal: true },
  );
}

/**
 * The minute's tick: one job per connection whose model lists a timed move,
 * handed the rows the last minute's job left alone. A job still pending or
 * running for the connection takes the place of a new one.
 */
export async function enqueueTimedMoves(deps: TimedMovesDeps & { enqueue: (input: EnqueueJobInput) => Promise<unknown> }, now: Date = new Date()): Promise<number> {
  const viewFor = deps.viewFor ?? createPublicViews(deps.meta).viewFor;
  const recent = await jobsRepo(deps.meta).recentPayloads(TIMED_MOVES_JOB_KIND, now.getTime() - 2 * LEAVE_ALONE_MS);
  let queued = 0;
  for (const connection of await deps.manager.connections.list()) {
    if (connection.disabled) continue;
    const view = await viewFor(connection.id).catch(() => null);
    if (view === null || timedTables(view).length === 0) continue;
    const last = recent.find((payload) => payload['connectionId'] === connection.id);
    const left = (last?.['left'] as LeftAlone | undefined) ?? {};
    await deps.enqueue({
      kind: TIMED_MOVES_JOB_KIND,
      payload: { connectionId: connection.id, ...(Object.keys(left).length === 0 ? {} : { left }) },
      dedupeKey: `${TIMED_MOVES_JOB_KIND}:${connection.id}`,
      maxAttempts: 1,
    });
    queued += 1;
  }
  return queued;
}
