// SPDX-License-Identifier: AGPL-3.0-only
/**
 * COUNTING A POOL — which rows count, what each takes, and how big the pool is.
 *
 * Every question the guard asks of a row is answered here once, the same way
 * for a row the write holds in memory and a row read back from the table:
 *
 *  - does it count now ({@link countsNow}): its states (and its owner's) are
 *    counted ones; a hold state counts only while its hold has not ended, on
 *    the clock the write judges by; a place kept back for the waitlist counts
 *    against the public and not against staff, who hand it on;
 *  - which pools it takes from, and how much ({@link unitsOf}): a slot's
 *    instant, a parent row (and wider pools) on a venue day, every night of a
 *    stay;
 *  - how big each pool is ({@link sizeOf}).
 *
 * SQL only narrows what is read (the pool's keys, a day or night envelope, the
 * counted states, holds long over); what counts is decided here, in code, on
 * exact instants. That keeps the counting the same on SQLite, Postgres and
 * MySQL, whatever zone the server runs in: bounds in SQL are whole `YYYY-MM-DD`
 * days either side, which every engine compares correctly with its own time
 * and date columns.
 *
 * Everything reads through the handle it is given: inside a write, the
 * transaction's own — never the pool's.
 */
import { sql, type Kysely, type RawBuilder } from 'kysely';

import type { CapacitySetting } from '../../connections/effective-schema.js';
import type { SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable } from '../identifiers.js';
import type { Row } from '../mask.js';
import { readDay, readInstant } from '../moments.js';
import { venueClock } from '../venue-time.js';
import type { WriteOrigin } from '../write-context.js';
import { stateColumn, type Level, type Link, type Rule, type Size } from './rules.js';

export type Db = Kysely<SourceDatabase>;

/** One read of each setting and each row by key, per judge call. */
export class Reads {
  readonly #settings = new Map<string, Promise<unknown>>();
  readonly #rows = new Map<string, Map<string, Row | null>>();

  constructor(readonly db: Db) {}

  /** A setting's value: its table's one row is read once per call, whichever of its columns are asked. */
  async setting(setting: CapacitySetting): Promise<unknown> {
    let found = this.#settings.get(setting.table);
    if (found === undefined) {
      this.#settings.set(setting.table, (found = this.db.selectFrom(setting.table).selectAll().limit(1).executeTakeFirst()));
    }
    const row = (await found) as Row | undefined;
    return row?.[setting.column];
  }

  async number(value: number | CapacitySetting | undefined): Promise<number | null> {
    if (value === undefined) return null;
    if (typeof value === 'number') return value;
    const read = await this.setting(value);
    if (read === null || read === undefined || read === '') return null;
    const n = Number(read);
    return Number.isFinite(n) ? n : null;
  }

  #of(table: ResolvedTable, key: string): Map<string, Row | null> {
    const id = `${table.id}\u0000${key}`;
    let rows = this.#rows.get(id);
    if (rows === undefined) this.#rows.set(id, (rows = new Map()));
    return rows;
  }

  /** Put rows the write already holds where a read would find them (a tree's root, the row being changed). */
  know(table: ResolvedTable, key: string, row: Row): void {
    const value = row[key];
    if (value !== null && value !== undefined) this.#of(table, key).set(String(value), row);
  }

  /** Read the rows by key that are not read yet, in one statement. */
  async load(table: ResolvedTable, key: string, keys: Iterable<unknown>): Promise<void> {
    const rows = this.#of(table, key);
    const wanted = [...new Set([...keys].filter((k) => k !== null && k !== undefined).map(String))].filter((k) => !rows.has(k));
    for (let i = 0; i < wanted.length; i += 500) {
      const chunk = wanted.slice(i, i + 500);
      const found = (await this.db
        .selectFrom(table.id)
        .selectAll()
        .where((eb) => eb(this.db.dynamic.ref(key), 'in', chunk))
        .execute()) as Row[];
      for (const row of found) rows.set(String(row[key]), row);
      for (const k of chunk) if (!rows.has(k)) rows.set(k, null);
    }
  }

  async row(table: ResolvedTable, key: string, value: unknown): Promise<Row | null> {
    if (value === null || value === undefined) return null;
    await this.load(table, key, [value]);
    return this.#of(table, key).get(String(value)) ?? null;
  }

  async linked(link: Link | null, value: unknown): Promise<Row | null> {
    return link === null ? null : this.row(link.table, link.key, value);
  }
}

/** Whose view a count takes, and when. */
export interface CountContext {
  reads: Reads;
  /** The instant holds are compared with. */
  now: Date;
  /** A guest's write (and a public answer) counts places kept back; staff's does not. */
  origin: WriteOrigin | 'staff';
  /** The venue's time zone. */
  zone: string;
}

/**
 * How a row's count is read: exactly, or — while locks are being named,
 * before anything is held — the side that names more locks: a hold state
 * before the write never counts, and after it always does.
 */
export type CountMode = 'exact' | 'before-naming' | 'after-naming';

export const has = (row: Row, column: string): boolean => Object.prototype.hasOwnProperty.call(row, column);

function levelRow(level: Level, row: Row, owner: Row | null): Row | null {
  return level === 'own' ? row : owner;
}

/** The state at a level, as text; undefined when the level's row does not say (a create that left it to the default). */
function stateAt(rule: Rule, level: Level, row: Row, owner: Row | null): string | null | undefined {
  const column = stateColumn(rule, level);
  const at = levelRow(level, row, owner);
  if (column === null || at === null || !has(at, column)) return undefined;
  const value = at[column];
  return value === null || value === undefined ? null : String(value);
}

/** Whether every condition holds. An absent own state (the column's default) and a row with no owner count: the side that never oversells. */
export function conditionsHold(rule: Rule, row: Row, owner: Row | null): boolean {
  return rule.conditions.every((condition) => {
    const at = levelRow(condition.level, row, owner);
    if (at === null || !has(at, condition.column)) return true;
    const value = at[condition.column];
    return value !== null && value !== undefined && condition.values.includes(String(value));
  });
}

/** Whether the row is in one of its hold's states. */
export function inHold(rule: Rule, row: Row, owner: Row | null): boolean {
  if (rule.hold === null) return false;
  const state = stateAt(rule, rule.hold.level, row, owner);
  return typeof state === 'string' && rule.hold.states.includes(state);
}

/** Whether a stay has begun: its guest arrived (a night rule's `arrived` states). */
export function hasArrived(rule: Rule, row: Row, owner: Row | null): boolean {
  if (rule.kind !== 'night' || rule.arrived === null) return false;
  const state = stateAt(rule, rule.arrived.level, row, owner);
  return typeof state === 'string' && rule.arrived.states.includes(state);
}

/** Whether the row is a place kept back from the public. */
export function isKept(rule: Rule, row: Row, owner: Row | null): boolean {
  if (rule.kept === null) return false;
  const state = stateAt(rule, rule.kept.level, row, owner);
  return typeof state === 'string' && rule.kept.states.includes(state);
}

/** When the row's hold ends: the first end that is filled; null for none (a hold with no end holds). */
export async function holdEndOf(rule: Rule, row: Row, owner: Row | null, reads: Reads): Promise<Date | null> {
  if (rule.hold === null) return null;
  const at = levelRow(rule.hold.level, row, owner);
  if (at === null) return null;
  for (const end of rule.hold.ends) {
    if (end.lost === true) continue;
    const from = end.link === null ? at : await reads.linked(end.link, at[end.link.column]);
    const instant = from === null ? null : readInstant(from[end.column]);
    if (instant !== null) return instant;
  }
  return null;
}

export interface Counted {
  counts: boolean;
  /** Counted only because its hold has not ended. */
  held: boolean;
  /** Counted only against the public: a place kept back. */
  kept: boolean;
}

const NONE: Counted = { counts: false, held: false, kept: false };

/** Whether a row counts, from the context's point of view. */
export async function countsNow(rule: Rule, row: Row, owner: Row | null, ctx: CountContext, mode: CountMode = 'exact'): Promise<Counted> {
  if (!conditionsHold(rule, row, owner)) return NONE;
  // Kept back from the public: counted against a guest; for staff not counted, only told apart.
  if (isKept(rule, row, owner)) return { counts: ctx.origin === 'public', held: false, kept: true };
  if (!inHold(rule, row, owner)) return { counts: true, held: false, kept: false };
  if (mode === 'before-naming') return NONE;
  if (mode === 'after-naming') return { counts: true, held: true, kept: false };
  const end = await holdEndOf(rule, row, owner, ctx.reads);
  if (end !== null && end.getTime() <= ctx.now.getTime()) return NONE;
  return { counts: true, held: true, kept: false };
}

/** One place a row takes: in a pool (`part` and `key`), on a day or night (`at`), this much. */
export interface Unit {
  part: string;
  key: string;
  at: string | undefined;
  amount: number;
}

/** How much the row takes. */
export function amountOf(rule: Rule, row: Row): number {
  if ('value' in rule.amount) return rule.amount.value;
  const n = Number(row[rule.amount.column] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** `YYYY-MM-DD`, `days` after `day`. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The UTC day of an instant, `days` later: the whole-day bounds SQL narrows by. */
export const envelopeDay = (instant: Date, days: number): string => new Date(instant.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** Every night of a stay, `from` to the night before `to`. */
export function nightsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const keyText = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value));

/** A slot's pool key: its instant, and its resource when the rule has one. */
export function slotKey(instant: Date, resource: unknown): string {
  return `${instant.toISOString()}|${keyText(resource) ?? ''}`;
}

/** The dates of a stay, as `YYYY-MM-DD`. */
export function staysOf(rule: Extract<Rule, { kind: 'night' }>, row: Row, owner: Row | null): { from: string | null; to: string | null } {
  const read = (date: { level: Level; column: string }) => {
    const at = levelRow(date.level, row, owner);
    return at === null ? null : readDay(at[date.column]);
  };
  return { from: read(rule.from), to: read(rule.to) };
}

/** The night pool a row counts against: the type of the room given when one is, else its own. */
export async function nightKey(rule: Extract<Rule, { kind: 'night' }>, row: Row, reads: Reads): Promise<string | null> {
  if (rule.given !== null) {
    const room = row[rule.given.via?.column ?? ''];
    if (rule.given.via !== null && room !== null && room !== undefined) {
      const given = await reads.linked(rule.given.via, room);
      const type = keyText(given?.[rule.given.column]);
      if (type !== null) return type;
    }
  }
  return keyText(row[rule.viaColumn]);
}

/** The venue day of an instant column at a level, or undefined when the rule counts by no day. */
function dayAt(rule: Extract<Rule, { kind: 'parent' }>, row: Row, owner: Row | null, zone: string): string | undefined {
  if (rule.day === null) return undefined;
  const at = levelRow(rule.day.level, row, owner);
  const instant = at === null ? null : readInstant(at[rule.day.column]);
  return instant === null ? undefined : venueClock(instant, zone).day;
}

/** The places a row takes, by pool. */
export async function unitsOf(rule: Rule, row: Row, owner: Row | null, ctx: CountContext): Promise<Unit[]> {
  const amount = amountOf(rule, row);
  if (rule.kind === 'slot') {
    const instant = readInstant(row[rule.rule.slot]);
    if (instant === null) return [];
    const resource = rule.rule.resource === undefined ? null : row[rule.rule.resource];
    return [{ part: 's', key: slotKey(instant, resource), at: venueClock(instant, ctx.zone).day, amount }];
  }
  if (rule.kind === 'parent') {
    const key = keyText(row[rule.viaColumn]);
    if (key === null) return [];
    const at = dayAt(rule, row, owner, ctx.zone);
    const out: Unit[] = [{ part: 'p', key, at, amount }];
    for (const wider of rule.also) {
      const wide = keyText(row[wider.column]);
      if (wide !== null) out.push({ part: wider.part, key: wide, at, amount });
    }
    return out;
  }
  const { from, to } = staysOf(rule, row, owner);
  if (from === null || to === null || from >= to) return [];
  const key = await nightKey(rule, row, ctx.reads);
  if (key === null) return [];
  return nightsOf(from, to).map((night) => ({ part: 'n', key, at: night, amount: 1 }));
}

/** A size read on a row a pool is keyed by: null for no limit. */
async function sizeOn(size: Size, target: Row | null, at: string | undefined, reads: Reads): Promise<number | null> {
  if (size.kind === 'number') return size.value;
  if (size.kind === 'setting') return reads.number(size.setting);
  if (target === null) return null;
  if (size.kind === 'hop') {
    const hop = size.link === null ? null : await reads.linked(size.link, target[size.link.column]);
    return numberIn(hop?.[size.column]);
  }
  if (size.onDay !== undefined) {
    // A number for one venue day: any other day has no limit.
    const day = readDay(target[size.onDay]);
    if (day === null || day !== at) return null;
  }
  return numberIn(target[size.column]);
}

const numberIn = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The target row a parent pool is keyed by (the ticket type), or null. */
export async function poolRow(rule: Extract<Rule, { kind: 'parent' }>, part: string, key: string, reads: Reads): Promise<Row | null> {
  const link = part === 'p' ? rule.via : (rule.also.find((wider) => wider.part === part)?.via ?? null);
  return reads.linked(link, key);
}

/** Rooms of a type out of service, per night of `nights`: counted from the closures that cover it. */
export async function outOfService(
  rule: Extract<Rule, { kind: 'night' }>,
  keys: readonly string[],
  nights: readonly string[],
  reads: Reads,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const oos = rule.outOfService;
  if (oos === null || nights.length === 0 || keys.length === 0) return out;
  const first = nights[0]!;
  const last = nights.at(-1)!;
  const db = reads.db;
  const pool = rule.pool;
  // The pool a closure's room is in: the room's type (a count pool), or the room itself (a pool of one).
  let rows: { k: unknown; f: unknown; t: unknown }[];
  if (pool.kind === 'count') {
    rows = (
      await sql<{ k: unknown; f: unknown; t: unknown }>`select ${sql.ref(`adm_r.${pool.column}`)} as k, ${sql.ref(`adm_c.${oos.from}`)} as f, ${sql.ref(`adm_c.${oos.to}`)} as t
        from ${sql.table(oos.table)} as adm_c join ${sql.table(pool.table)} as adm_r on ${sql.ref(`adm_r.${roomKey(rule)}`)} = ${sql.ref(`adm_c.${oos.room}`)}
        where ${sql.ref(`adm_r.${pool.column}`)} in (${sql.join(keys)}) and ${sql.ref(`adm_c.${oos.from}`)} <= ${last}
          and (${sql.ref(`adm_c.${oos.to}`)} is null or ${sql.ref(`adm_c.${oos.to}`)} >= ${first})${activeOnly(oos.active)}`.execute(db)
    ).rows;
  } else {
    rows = (
      await sql<{ k: unknown; f: unknown; t: unknown }>`select ${sql.ref(`adm_c.${oos.room}`)} as k, ${sql.ref(`adm_c.${oos.from}`)} as f, ${sql.ref(`adm_c.${oos.to}`)} as t
        from ${sql.table(oos.table)} as adm_c
        where ${sql.ref(`adm_c.${oos.room}`)} in (${sql.join(keys)}) and ${sql.ref(`adm_c.${oos.from}`)} <= ${last}
          and (${sql.ref(`adm_c.${oos.to}`)} is null or ${sql.ref(`adm_c.${oos.to}`)} >= ${first})${activeOnly(oos.active)}`.execute(db)
    ).rows;
  }
  for (const row of rows) {
    const key = keyText(row.k);
    const from = readDay(row.f);
    const to = readDay(row.t);
    if (key === null || from === null) continue;
    let per = out.get(key);
    if (per === undefined) out.set(key, (per = new Map()));
    // Closure dates are inclusive; an open-ended one closes every night from its first.
    for (const night of nights) if (night >= from && (to === null || night <= to)) per.set(night, (per.get(night) ?? 0) + 1);
  }
  return out;
}

const activeOnly = (active: string | undefined): RawBuilder<unknown> =>
  active === undefined ? sql`` : sql` and ${sql.ref(`adm_c.${active}`)} = ${sql.lit(true)}`;

/** The key column of the rooms a count pool counts. */
function roomKey(rule: Extract<Rule, { kind: 'night' }>): string {
  return rule.outOfService?.roomsKey ?? 'id';
}

/** Rooms per type, for a count pool. */
async function roomsPer(rule: Extract<Rule, { kind: 'night' }>, keys: readonly string[], reads: Reads): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (rule.pool.kind !== 'count' || keys.length === 0) return out;
  const pool = rule.pool;
  const rows = (
    await sql<{ k: unknown; n: unknown }>`select ${sql.ref(pool.column)} as k, count(*) as n from ${sql.table(pool.table)}
      where ${sql.ref(pool.column)} in (${sql.join(keys)}) group by ${sql.ref(pool.column)}`.execute(reads.db)
  ).rows;
  for (const row of rows) {
    const key = keyText(row.k);
    if (key !== null) out.set(key, Number(row.n));
  }
  return out;
}

/** A pool as asked: which one, and on which day or night. */
export interface PoolAsk {
  part: string;
  key: string;
  at: string | undefined;
}

/** The size of each pool asked, in order; null for no limit. */
export async function sizesOf(rule: Rule, asks: readonly PoolAsk[], reads: Reads): Promise<(number | null)[]> {
  if (asks.length === 0) return [];
  if (rule.kind === 'slot') {
    const size = await reads.number(rule.rule.perSlot);
    return asks.map(() => size);
  }
  if (rule.kind === 'parent') {
    const byPart = new Map<string, string[]>();
    for (const ask of asks) byPart.set(ask.part, [...(byPart.get(ask.part) ?? []), ask.key]);
    for (const [part, keys] of byPart) {
      const link = part === 'p' ? rule.via : (rule.also.find((wider) => wider.part === part)?.via ?? null);
      if (link !== null) await reads.load(link.table, link.key, keys);
    }
    const out: (number | null)[] = [];
    for (const ask of asks) {
      const size = ask.part === 'p' ? rule.size : rule.also.find((wider) => wider.part === ask.part)!.size;
      out.push(await sizeOn(size, await poolRow(rule, ask.part, ask.key, reads), ask.at, reads));
    }
    return out;
  }
  const keys = [...new Set(asks.map((ask) => ask.key))];
  const nights = [...new Set(asks.map((ask) => ask.at!))].sort();
  const closed = await outOfService(rule, keys, nights, reads);
  const closedOn = (ask: PoolAsk) => closed.get(ask.key)?.get(ask.at!) ?? 0;
  if (rule.pool.kind === 'count') {
    const rooms = await roomsPer(rule, keys, reads);
    return asks.map((ask) => Math.max(0, (rooms.get(ask.key) ?? 0) - closedOn(ask)));
  }
  const size = rule.pool.size;
  if (rule.via !== null) await reads.load(rule.via.table, rule.via.key, keys);
  const out: (number | null)[] = [];
  for (const ask of asks) {
    const whole = await sizeOn(size, await reads.linked(rule.via, ask.key), ask.at, reads);
    out.push(whole === null ? null : Math.max(0, whole - closedOn(ask)));
  }
  return out;
}

/* ------------------------------------------------------------ stored rows */

/** A row read back from the table, with its owner's columns the rule reads. */
export interface StoredRow {
  row: Row;
  owner: Row | null;
}

/** The owner columns a rule reads, for the join. */
function ownerReads(rule: Rule): string[] {
  const out = new Set<string>();
  for (const condition of rule.conditions) if (condition.level === 'owner') out.add(condition.column);
  if (rule.hold?.level === 'owner') for (const end of rule.hold.ends) out.add(end.link?.column ?? end.column);
  if (rule.kind === 'parent' && rule.day?.level === 'owner') out.add(rule.day.column);
  if (rule.kind === 'night') for (const date of [rule.from, rule.to]) if (date.level === 'owner') out.add(date.column);
  if (rule.owner !== null) out.add(rule.owner.key);
  return [...out];
}

/** A column at a level, in the counting statement. */
export const at = (level: Level, column: string): RawBuilder<unknown> => sql.ref(`${level === 'own' ? 'adm_t' : 'adm_o'}.${column}`);

/**
 * The rows of a rule's table that may count, narrowed by `where`, leaving out
 * the rows of `exclude` (by key): the rows this write holds in memory.
 */
export async function storedRows(rule: Rule, db: Db, where: readonly RawBuilder<unknown>[], exclude: readonly Row[], now: Date): Promise<StoredRow[]> {
  const table = rule.table;
  const owner = rule.owner;
  const reads = owner === null ? [] : ownerReads(rule);
  const conditions: RawBuilder<unknown>[] = [...where];
  for (const condition of rule.conditions) {
    const column = at(condition.level, condition.column);
    const among = sql`${column} in (${sql.join(condition.values)})`;
    // A row with no owner counts (the side that never oversells).
    conditions.push(condition.level === 'owner' && owner !== null ? sql`(${sql.ref(`adm_t.${owner.column}`)} is null or ${among})` : among);
  }
  // A hold long over counts for nothing: left in the table, but not read back.
  const hold = rule.hold;
  const state = hold === null ? null : stateColumn(rule, hold.level);
  if (hold !== null && state !== null && hold.ends.length === 1 && hold.ends[0]!.link === null && (hold.level === 'own' || owner !== null)) {
    const end = at(hold.level, hold.ends[0]!.column);
    conditions.push(sql`not (${at(hold.level, state)} in (${sql.join(hold.states)}) and ${end} is not null and ${end} < ${envelopeDay(now, -1)})`);
  }
  if (exclude.length > 0 && table.primaryKey.length > 0) {
    if (table.primaryKey.length === 1) {
      const key = table.primaryKey[0]!;
      const values = exclude.map((row) => row[key]).filter((value) => value !== null && value !== undefined);
      if (values.length > 0) conditions.push(sql`${sql.ref(`adm_t.${key}`)} not in (${sql.join(values)})`);
    } else {
      for (const row of exclude) {
        conditions.push(sql`not (${sql.join(table.primaryKey.map((key) => sql`${sql.ref(`adm_t.${key}`)} = ${row[key]}`), sql` and `)})`);
      }
    }
  }
  const select = [sql`adm_t.*`, ...reads.map((column, i) => sql`${sql.ref(`adm_o.${column}`)} as ${sql.ref(`adm_o_${String(i)}`)}`)];
  const join =
    owner === null ? sql`` : sql` left join ${sql.table(owner.table.id)} as adm_o on ${sql.ref(`adm_o.${owner.key}`)} = ${sql.ref(`adm_t.${owner.column}`)}`;
  const filter = conditions.length === 0 ? sql`` : sql` where ${sql.join(conditions, sql` and `)}`;
  const rows = (await sql<Row>`select ${sql.join(select)} from ${sql.table(table.id)} as adm_t${join}${filter}`.execute(db)).rows;
  return rows.map((raw) => {
    if (owner === null) return { row: raw, owner: null };
    const row: Row = { ...raw };
    const ownerRow: Row = {};
    reads.forEach((column, i) => {
      const alias = `adm_o_${String(i)}`;
      ownerRow[column] = raw[alias];
      delete row[alias];
    });
    return { row, owner: row[owner.column] === null || row[owner.column] === undefined ? null : ownerRow };
  });
}
