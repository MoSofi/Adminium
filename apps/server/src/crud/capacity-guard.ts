// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BOOKING GUARD — how much of a slot a table's rows may take.
 *
 * A venue seats twelve at half past seven. Two guests pressing Book at the
 * same moment must not both get the last four seats, whoever they write
 * through: the till, the public API, an automation. So the write runs as
 *
 *     lock the slot → add up what it holds → compare → write
 *
 * inside one transaction, with a lock only the same slot contends for:
 *
 *  - Postgres: `pg_advisory_xact_lock` on a hash of connection, table and
 *    slot, released by the commit itself.
 *  - MySQL: `GET_LOCK` on a pinned connection, released after the commit —
 *    releasing before it would let the next writer add up rows it cannot
 *    see yet.
 *  - SQLite: one connection serialises this process already; `BEGIN
 *    IMMEDIATE` takes the write lock up front for a second process.
 *
 * Only rows whose `countWhere` column holds one of its values count — a
 * cancelled booking holds no seats — and a change to an existing row leaves
 * that row's own amount out of the sum. A guest cancelling through the public
 * API must do it `cancelHours` before the time; staff are never held to it. The slot must also be one the venue
 * offers: on its grid, inside its hours, not in the past and not further
 * ahead than its window — all on the venue's clock, never the server's.
 *
 * A limit or an hour may be a number in the rule or the column of a one-row
 * settings table, read inside the same transaction, so a venue changes its
 * capacity from its own settings screen.
 */
import { createHash } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { CapacitySetting, TableCapacityRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError, ValidationFailedError } from '../errors.js';
import type { ResolvedTable } from './identifiers.js';
import { venueClock, wallTimeToInstant } from './venue-time.js';

export { venueClock } from './venue-time.js';
import type { Row } from './mask.js';
import type { WriteOrigin } from './write-context.js';

type Db = Kysely<SourceDatabase>;

export interface GuardTarget {
  connectionId: string;
  table: ResolvedTable;
  db: Db;
  dialect: Dialect;
  /** The venue's time zone; UTC when the connection names none. */
  timezone?: string | undefined;
  /** Who is writing: a guest is held to the cancellation window, staff never. */
  origin?: WriteOrigin | undefined;
}

/** How long a MySQL writer waits for the slot before giving up. */
const LOCK_WAIT_SECONDS = 10;

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/**
 * The instant a slot value names. A zone-less value is this server's wall
 * clock — how the write path stores one and how the drivers read one back
 * (`crud/write-values.ts`).
 */
export function slotInstant(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const instant = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(instant.getTime()) ? null : instant;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** `HH:MM` (or a database time, `HH:MM:SS`) as minutes of the day. */
function minutesOf(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

async function settingOf(db: Db, setting: CapacitySetting): Promise<unknown> {
  const row = (await db
    .selectFrom(setting.table)
    .select(sql<unknown>`${sql.ref(setting.column)}`.as('value'))
    .limit(1)
    .executeTakeFirst()) as { value?: unknown } | undefined;
  return row?.value;
}

async function numberOf(db: Db, value: number | CapacitySetting | undefined): Promise<number | null> {
  if (value === undefined) return null;
  if (typeof value === 'number') return value;
  const read = Number(await settingOf(db, value));
  return Number.isFinite(read) ? read : null;
}

async function timeOf(db: Db, value: string | CapacitySetting | undefined): Promise<number | null> {
  if (value === undefined) return null;
  return minutesOf(typeof value === 'string' ? value : await settingOf(db, value));
}

/** Whether a row, as it will be, holds any of the slot. */
function counts(rule: TableCapacityRule, row: Row): boolean {
  if (rule.countWhere === undefined) return true;
  // An absent status takes the column's default, which is not known here:
  // counting it is the side that never overbooks.
  if (!has(row, rule.countWhere.column)) return true;
  return rule.countWhere.values.includes(String(row[rule.countWhere.column]));
}

/** Whether a write touches what the guard adds up. */
export function touchesGuard(rule: TableCapacityRule, values: Row): boolean {
  return [rule.slot, rule.amount, rule.resource, rule.countWhere?.column].some(
    (column) => column !== undefined && has(values, column),
  );
}

function refused(column: string): ValidationFailedError {
  return new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'out-of-range' } } });
}

/**
 * Refuse the row unless its slot is one the venue offers and has room for it.
 * Run inside the guarded transaction, after the lock. `before` is the row as
 * stored, on an update.
 */
export async function checkCapacity(
  rule: TableCapacityRule,
  target: GuardTarget,
  values: Row,
  before: Row | null,
  now: Date = new Date(),
): Promise<void> {
  const row = before === null ? values : { ...before, ...values };
  // A guest's cancellation, too close to the time: only the venue may now.
  if (before !== null && target.origin === 'public' && rule.cancelHours !== undefined && counts(rule, before) && !counts(rule, row)) {
    const hours = await numberOf(target.db, rule.cancelHours);
    const held = slotInstant(before[rule.slot]);
    if (hours !== null && held !== null && held.getTime() - now.getTime() < hours * 3_600_000) {
      throw new ConflictError('It is too late to cancel online.', 'CAPACITY_TOO_LATE', { column: rule.countWhere?.column ?? rule.slot });
    }
  }
  if (!counts(rule, row)) return;
  const zone = target.timezone ?? 'UTC';
  const slotValue = row[rule.slot];
  const instant = slotInstant(slotValue);
  if (instant === null) throw refused(rule.slot);

  // The grid, the hours and the window — only when the slot is new or moved.
  if (before === null || has(values, rule.slot)) {
    const step = await numberOf(target.db, rule.slotMinutes);
    const clock = venueClock(instant, zone);
    const opens = await timeOf(target.db, rule.opens);
    let closes = await timeOf(target.db, rule.closes);
    let minute = clock.minute;
    if (opens !== null && closes !== null && closes <= opens) {
      // Open past midnight: the small hours belong to the evening before.
      closes += 1440;
      if (minute < opens) minute += 1440;
    }
    if (step !== null && step > 0 && (clock.second !== 0 || (minute - (opens ?? 0)) % step !== 0)) throw refused(rule.slot);
    if (opens !== null && minute < opens) throw refused(rule.slot);
    if (closes !== null && minute + (step ?? 0) > closes) throw refused(rule.slot);
    if (instant.getTime() < now.getTime()) throw refused(rule.slot);
    const window = await numberOf(target.db, rule.windowDays);
    if (window !== null && daysBetween(venueClock(now, zone).day, clock.day) > window) throw refused(rule.slot);
  }

  const amount = Number(row[rule.amount] ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) throw refused(rule.amount);
  const limit = await numberOf(target.db, rule.perSlot);
  if (limit === null) return;

  const held = await takenBySlot(rule, target, instant, instant, {
    ...(rule.resource === undefined ? {} : { resource: row[rule.resource] ?? null }),
    // The row being changed holds what it held; it is not counted twice.
    ...(before === null ? {} : { exclude: before }),
  });
  const taken = held.get(instant.getTime()) ?? 0;
  if (taken + amount > limit) {
    throw new ConflictError('That time is full.', 'CAPACITY_FULL', { column: rule.slot });
  }
}

/** `YYYY-MM-DD`, `days` after the UTC day of `instant`. */
const dayOf = (instant: Date, days: number) => new Date(instant.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * What each slot between `first` and `last` holds, keyed by the slot's
 * instant. Read over whole days either side and grouped by the slot as
 * stored, then matched by INSTANT: a slot written by a till (this server's
 * wall clock) and one written by a guest (an ISO instant) are the same slot,
 * though SQLite, which compares text, would never say so.
 */
async function takenBySlot(
  rule: TableCapacityRule,
  target: GuardTarget,
  first: Date,
  last: Date,
  opts: { resource?: unknown; exclude?: Row } = {},
): Promise<Map<number, number>> {
  let query = target.db
    .selectFrom(target.table.id)
    .select([sql<unknown>`${sql.ref(rule.slot)}`.as('slot'), sql<unknown>`coalesce(sum(${sql.ref(rule.amount)}), 0)`.as('taken')])
    .where((eb) => eb(target.db.dynamic.ref(rule.slot), '>=', dayOf(first, -1)))
    .where((eb) => eb(target.db.dynamic.ref(rule.slot), '<', dayOf(last, 2)))
    .groupBy(sql.ref(rule.slot) as never);
  if (rule.resource !== undefined && 'resource' in opts) {
    const column = target.db.dynamic.ref(rule.resource);
    query = opts.resource === null || opts.resource === undefined ? query.where(column, 'is', null) : query.where(column, '=', opts.resource);
  }
  if (rule.countWhere !== undefined) {
    query = query.where(target.db.dynamic.ref(rule.countWhere.column), 'in', rule.countWhere.values);
  }
  if (opts.exclude !== undefined) {
    for (const key of target.table.primaryKey) query = query.where(target.db.dynamic.ref(key), '<>', opts.exclude[key]);
  }
  const taken = new Map<number, number>();
  for (const row of (await query.execute()) as { slot: unknown; taken: unknown }[]) {
    const at = slotInstant(row.slot)?.getTime();
    if (at !== undefined) taken.set(at, (taken.get(at) ?? 0) + Number(row.taken));
  }
  return taken;
}

/** The lock's name: the slot, on this connection, in this table (and resource). */
function lockName(rule: TableCapacityRule, target: GuardTarget, row: Row): string {
  const resource = rule.resource === undefined ? '' : String(row[rule.resource] ?? '');
  const slot = slotInstant(row[rule.slot])?.toISOString() ?? String(row[rule.slot]);
  return `${target.connectionId}|${target.table.id}|${slot}|${resource}`;
}

/**
 * Run `write` holding the slot, inside one transaction. `write` receives the
 * handle to write through; what it returns is returned once committed.
 */
export async function withSlotLock<T>(
  rule: TableCapacityRule,
  target: GuardTarget,
  row: Row,
  write: (db: Db) => Promise<T>,
): Promise<T> {
  const name = lockName(rule, target, row);
  const { db, dialect } = target;
  if (dialect === 'postgres') {
    const locked = async (trx: Db) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`.execute(trx);
      return write(trx);
    };
    return db.isTransaction ? locked(db) : db.transaction().execute(locked);
  }
  if (dialect === 'mysql') {
    // MySQL's lock names stop at 64 characters.
    const key = `adm:${createHash('sha1').update(name).digest('hex')}`;
    const held = async (conn: Db) => {
      const got = (await sql<{ got: number | null }>`select get_lock(${key}, ${LOCK_WAIT_SECONDS}) as got`.execute(conn)).rows[0]?.got;
      if (Number(got) !== 1) throw new ConflictError('That time is busy. Try again in a moment.', 'CAPACITY_BUSY');
      try {
        return conn.isTransaction ? await write(conn) : await conn.transaction().execute(write);
      } finally {
        await sql`select release_lock(${key})`.execute(conn);
      }
    };
    return db.isTransaction ? held(db) : db.connection().execute(held);
  }
  // SQLite: this process has one connection; BEGIN IMMEDIATE holds off a second.
  if (db.isTransaction) return write(db);
  return db.connection().execute(async (conn) => {
    await sql`begin immediate`.execute(conn);
    try {
      const out = await write(conn);
      await sql`commit`.execute(conn);
      return out;
    } catch (error) {
      await sql`rollback`.execute(conn);
      throw error;
    }
  });
}

/* ------------------------------------------------------------ availability */

export interface SlotState {
  /** `HH:mm` on the venue's clock. */
  time: string;
  state: 'free' | 'full';
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * Whether each of a day's slots has room for `party` — the same sum the guard
 * adds up, answered as free or full and nothing more: no row, name or count
 * leaves this function. A slot in the past, or beyond the window, is full.
 *
 * `own` is the booking the asker already holds (a claimed guest changing
 * theirs): its party is not counted against them, or a guest could never
 * grow a booking at the time it already has.
 */
export async function slotAvailability(
  rule: TableCapacityRule,
  target: GuardTarget,
  day: string,
  party: number,
  own: Row | null = null,
  now: Date = new Date(),
): Promise<SlotState[]> {
  const zone = target.timezone ?? 'UTC';
  const step = (await numberOf(target.db, rule.slotMinutes)) ?? 30;
  const opens = (await timeOf(target.db, rule.opens)) ?? 0;
  let closes = (await timeOf(target.db, rule.closes)) ?? 1440;
  if (closes <= opens) closes += 1440;
  const window = await numberOf(target.db, rule.windowDays);
  const limit = await numberOf(target.db, rule.perSlot);
  const beyond = window !== null && daysBetween(venueClock(now, zone).day, day) > window;

  const slots: { minute: number; instant: Date }[] = [];
  for (let minute = opens; step > 0 && minute + step <= closes; minute += step) {
    const date = minute >= 1440 ? new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : day;
    const instant = wallTimeToInstant(`${date} ${hhmm(minute % 1440)}`, zone);
    if (instant !== null) slots.push({ minute, instant });
  }
  if (slots.length === 0) return [];

  // What each slot of the day holds, in one grouped read.
  const taken = await takenBySlot(rule, target, slots[0]!.instant, slots.at(-1)!.instant);
  if (own !== null && counts(rule, own)) {
    const at = slotInstant(own[rule.slot])?.getTime();
    if (at !== undefined && taken.has(at)) taken.set(at, taken.get(at)! - Number(own[rule.amount] ?? 0));
  }

  return slots.map(({ minute, instant }) => {
    const open = !beyond && instant.getTime() >= now.getTime();
    const room = limit === null || (taken.get(instant.getTime()) ?? 0) + party <= limit;
    return { time: hhmm(minute % 1440), state: open && room ? 'free' : 'full' };
  });
}
