// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SLOT LIMIT'S OLD HELPERS — what the booking guard, the outbox and the
 * released slot limit's availability still read.
 *
 * The guard itself (every kind of limit, its locks, its counting) lives in
 * `crud/capacity/`. Kept here: the one reader of a stored time
 * (`slotInstant`), settings and minutes readers, the one-name lock wrapper,
 * and the released slot limit's free-or-full day (`slotAvailability`), which
 * answers Point of Sale exactly as it always has.
 */
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { CapacitySetting, TableCapacityRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { withNamedLocks, type LockBusy } from './capacity/locks.js';
import { readInstant } from './moments.js';
import type { ResolvedTable } from './identifiers.js';
import { venueClock, wallTimeToInstant } from './venue-time.js';

export { venueClock } from './venue-time.js';
export { inTransaction } from './capacity/locks.js';
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

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/**
 * The instant a slot value names. A zone-less value is this server's wall
 * clock — how the write path stores one and how the drivers read one back
 * (`crud/write-values.ts`). The server's one reader of a stored time.
 */
export const slotInstant = readInstant;

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** `HH:MM` (or a database time, `HH:MM:SS`) as minutes of the day. */
export function minutesOf(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

export async function settingOf(db: Db, setting: CapacitySetting): Promise<unknown> {
  const row = (await db
    .selectFrom(setting.table)
    .select(sql<unknown>`${sql.ref(setting.column)}`.as('value'))
    .limit(1)
    .executeTakeFirst()) as { value?: unknown } | undefined;
  return row?.value;
}

export async function numberOf(db: Db, value: number | CapacitySetting | undefined): Promise<number | null> {
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

/**
 * Run `write` inside one transaction, holding a lock only writers asking for
 * the same `name` contend for, and released only once the write is
 * committed — a writer let in before the commit would count rows it cannot
 * see yet. One name of {@link withNamedLocks}, which says how each engine
 * holds it; a MySQL call inside a caller's open transaction is refused.
 */
export async function withNamedLock<T>(
  target: Pick<GuardTarget, 'db' | 'dialect'>,
  name: string,
  busy: LockBusy,
  write: (db: Db) => Promise<T>,
): Promise<T> {
  return withNamedLocks(target, [{ name, busy }], write);
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
