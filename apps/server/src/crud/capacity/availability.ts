// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A GUEST MAY ASK OF A LIMIT — is there room, per kind, counted exactly
 * as the write path counts it, with no lock and no write.
 *
 *  - slot: each time of a day, free, full or paused (a closed day has none);
 *    or a strip of days, each open (with how many times are free), full or
 *    closed.
 *  - parent: each row the limit is held on (a ticket type), on sale, soon,
 *    ended or sold out.
 *  - night: each pool (a room type) over a stay's nights, open, full or
 *    closed; and the earliest arrival of the same length with room, per pool
 *    and for the house.
 *
 * A number is said only where the entry says so, and only when it is low
 * (`showLeft`): below a count, or below a share of the pool. Otherwise the
 * answer is states, and the one question a page can ask to probe is how many
 * it wants — never more than one order may take.
 *
 * The asker's own rows (a guest moving their booking, a checkout whose places
 * are already held) are left out of the count (`exclude`).
 */
import type { Row } from '../mask.js';
import { venueClock } from '../venue-time.js';
import type { WriteTarget } from '../write-context.js';
import { addDays, Reads } from './count.js';
import { capacityState, rangeOf, tallyFor, widerKeysOf } from './judge.js';
import { hhmm, onSale, placeNight, slotDays, type GridSlot } from './placement.js';
import { rulesFor, type NightRule, type ParentRule, type Rule, type SlotRule } from './rules.js';
import type { PoolState } from './types.js';

type Db = WriteTarget['db'];

/** Say what is left only when it is low. */
export type ShowLeft = { below: number } | { belowShare: number };

/** What is left, when the entry may say it: below its number, or its share of the pool. */
export function shownLeft(showLeft: ShowLeft | undefined, left: number | null, size: number | null): number | undefined {
  if (showLeft === undefined || left === null) return undefined;
  const low = 'below' in showLeft ? left < showLeft.below : size !== null && left * 100 < showLeft.belowShare * size;
  return low ? Math.max(0, left) : undefined;
}

export function ruleOf(target: WriteTarget, index: number): Rule | undefined {
  return rulesFor(target.view, target.table)[index];
}

/* ------------------------------------------------------------------ slot */

export interface SlotTime {
  time: string;
  state: 'free' | 'full' | 'paused';
}

async function slotTaken(db: Db, target: WriteTarget, rule: SlotRule, days: readonly string[], now: Date, exclude: readonly Row[]) {
  const states = await capacityState(db, target, { rule: rule.index, from: days[0], to: addDays(days.at(-1)!, 1), exclude, origin: 'public' }, now);
  return new Map(states.map((state) => [state.key, state]));
}

/** Whether a guest may still take a slot at `now`: not past, with the notice given, inside the window. */
async function takeable(rule: SlotRule, slot: GridSlot, day: string, reads: Reads, now: Date, zone: string): Promise<boolean> {
  if (slot.instant.getTime() < now.getTime()) return false;
  const notice = await reads.number(rule.rule.noticeMinutes);
  if (notice !== null && now.getTime() + notice * 60_000 > slot.instant.getTime()) return false;
  const window = await reads.number(rule.rule.windowDays);
  const today = venueClock(now, zone).day;
  return window === null || Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) <= window;
}

/** Each time of a venue day, for a party: free, full or paused. A day the venue is closed, or does not open, has none. */
export async function slotDayAnswer(db: Db, target: WriteTarget, rule: SlotRule, day: string, party: number, now: Date, exclude: readonly Row[] = []): Promise<SlotTime[]> {
  const zone = target.timezone ?? 'UTC';
  const reads = new Reads(db);
  const [one] = await slotDays(rule, reads, zone, [day]);
  if (one === undefined || one.closed || one.slots.length === 0) return [];
  const taken = await slotTaken(db, target, rule, [day], now, exclude);
  const size = await reads.number(rule.rule.perSlot);
  const out: SlotTime[] = [];
  for (const slot of one.slots) {
    if (one.paused.has(slot.instant.getTime())) {
      out.push({ time: hhmm(slot.minute % 1440), state: 'paused' });
      continue;
    }
    const held = taken.get(slot.instant.toISOString())?.taken ?? 0;
    const room = size === null || held + party <= size;
    out.push({ time: hhmm(slot.minute % 1440), state: room && (await takeable(rule, slot, day, reads, now, zone)) ? 'free' : 'full' });
  }
  return out;
}

export interface SlotDayState {
  date: string;
  open: number;
  state: 'open' | 'full' | 'closed';
}

/** A strip of venue days: each closed (or not opening), full, or open with how many times are free. */
export async function slotStripAnswer(db: Db, target: WriteTarget, rule: SlotRule, from: string, days: number, party: number, now: Date, exclude: readonly Row[] = []): Promise<SlotDayState[]> {
  const zone = target.timezone ?? 'UTC';
  const reads = new Reads(db);
  const list = rangeOf(from, addDays(from, days));
  const grid = await slotDays(rule, reads, zone, list);
  const taken = await slotTaken(db, target, rule, list, now, exclude);
  const size = await reads.number(rule.rule.perSlot);
  const out: SlotDayState[] = [];
  for (const day of grid) {
    if (day.closed || day.slots.length === 0) {
      out.push({ date: day.day, open: 0, state: 'closed' });
      continue;
    }
    let open = 0;
    for (const slot of day.slots) {
      if (day.paused.has(slot.instant.getTime())) continue;
      const held = taken.get(slot.instant.toISOString())?.taken ?? 0;
      if ((size === null || held + party <= size) && (await takeable(rule, slot, day.day, reads, now, zone))) open += 1;
    }
    out.push({ date: day.day, open, state: open > 0 ? 'open' : 'full' });
  }
  return out;
}

/* ---------------------------------------------------------------- parent */

export interface ParentState {
  id: string;
  state: 'on' | 'soon' | 'ended' | 'soldout';
  left?: number;
}

/**
 * Each row asked of a parent limit: on sale, soon, ended, or sold out when
 * fewer are left (in its own pool and every wider one) than `qty`.
 */
export async function parentAnswer(
  db: Db,
  target: WriteTarget,
  rule: ParentRule,
  ids: readonly string[],
  opts: { day?: string | undefined; qty: number; now: Date; exclude?: readonly Row[]; showLeft?: ShowLeft | undefined },
): Promise<ParentState[]> {
  if (ids.length === 0 || rule.via === null) return [];
  const reads = new Reads(db);
  await reads.load(rule.via.table, rule.via.key, ids);
  const day = rule.day === null ? undefined : opts.day;
  const ask = { rule: rule.index, keys: ids, ...(day === undefined ? {} : { day }), exclude: opts.exclude ?? [], origin: 'public' as const };
  const own = new Map((await capacityState(db, target, ask, opts.now)).map((state) => [state.key, state]));
  // The wider pools each row's sales also take from (the room across a show's types).
  const wider = await widerKeysOf(target, rule, ids, reads);
  const widerLeft = new Map<string, number | null>();
  for (const pool of rule.also) {
    const keys = [...new Set(wider.get(pool.part)?.values() ?? [])];
    if (keys.length === 0) continue;
    for (const state of await widerState(db, target, rule, pool.part, keys, day, opts)) widerLeft.set(`${pool.part}|${state.key}`, state.left);
  }
  const out: ParentState[] = [];
  for (const id of ids) {
    const row = await reads.linked(rule.via, id);
    if (row === null) continue;
    const sale = onSale(rule, row, opts.now);
    const state = own.get(id);
    let left = state?.left ?? null;
    for (const pool of rule.also) {
      const key = wider.get(pool.part)?.get(id);
      const other = key === undefined ? null : (widerLeft.get(`${pool.part}|${key}`) ?? null);
      if (other !== null) left = left === null ? other : Math.min(left, other);
    }
    const shown = shownLeft(opts.showLeft, left, state?.size ?? null);
    const soldOut = left !== null && left < opts.qty;
    out.push({ id, state: sale !== 'on' ? sale : soldOut ? 'soldout' : 'on', ...(shown === undefined || sale !== 'on' ? {} : { left: shown }) });
  }
  return out;
}

/** A wider pool's counts, per key: the same counting, asked of the wider pool's part. */
async function widerState(
  db: Db,
  target: WriteTarget,
  rule: ParentRule,
  part: string,
  keys: readonly string[],
  day: string | undefined,
  opts: { now: Date; exclude?: readonly Row[] },
): Promise<PoolState[]> {
  return tallyFor(db, target, rule, keys.map((key) => ({ part, key, at: day })), opts.now, opts.exclude ?? [], 'public');
}

/** The largest quantity a page may ask of a row: one order's most, or one when nothing is shown. */
export async function qtyCap(db: Db, rule: ParentRule, id: string, asked: number, showLeft: ShowLeft | undefined): Promise<number> {
  if (showLeft === undefined) return 1;
  if (rule.perWrite === null) return asked;
  const reads = new Reads(db);
  const max = rule.perWrite.max;
  const row = await reads.linked(rule.via, id);
  const cap =
    max.kind === 'number' ? max.value : max.kind === 'setting' ? await reads.number(max.setting) : max.kind === 'column' && row !== null ? Number(row[max.column]) : null;
  return cap === null || !Number.isFinite(cap) ? asked : Math.max(1, Math.min(asked, cap));
}

/* ----------------------------------------------------------------- night */

export interface NightState {
  pool: string;
  state: 'open' | 'full' | 'closed';
  left?: number;
  earliest?: string | null;
}

/**
 * Each pool over the nights `from`..`to`: closed when those dates are not a
 * stay the venue sells, full when a night has no room, else open; and with
 * `earliest`, the first arrival after `from` (within that many days) of the
 * same length where the pool is open.
 */
export async function nightAnswer(
  db: Db,
  target: WriteTarget,
  rule: NightRule,
  pools: readonly string[],
  opts: { from: string; to: string; earliest?: number | undefined; now: Date; exclude?: readonly Row[]; showLeft?: ShowLeft | undefined },
): Promise<{ pools: NightState[]; earliest: string | null }> {
  const zone = target.timezone ?? 'UTC';
  const reads = new Reads(db);
  const length = rangeOf(opts.from, opts.to).length;
  const search = opts.earliest ?? 0;
  const last = addDays(opts.to, search);
  const states = await capacityState(db, target, { rule: rule.index, keys: pools, from: opts.from, to: last, exclude: opts.exclude ?? [], origin: 'public' }, opts.now);
  const at = new Map(states.map((state) => [`${state.key}|${state.at!}`, state]));
  // Whether a stay of these dates is one the venue sells a guest (nights, arrival, how far ahead).
  const sells = async (from: string, to: string) => (await placeNight(rule, { [rule.from.column]: from, [rule.to.column]: to }, { [rule.from.column]: from, [rule.to.column]: to }, { reads, now: opts.now, public: true, zone })) === null;
  const over = (pool: string, from: string) => {
    let left: number | null = null;
    let size: number | null = null;
    for (const night of rangeOf(from, addDays(from, length))) {
      const state = at.get(`${pool}|${night}`);
      if (state?.left === null || state === undefined) continue;
      if (left === null || state.left < left) {
        left = state.left;
        size = state.size;
      }
    }
    return { left, size };
  };
  const sold = await sells(opts.from, opts.to);
  const out: NightState[] = [];
  let first: string | null = null;
  for (const pool of pools) {
    const { left, size } = over(pool, opts.from);
    const state: NightState['state'] = !sold ? 'closed' : left !== null && left < 1 ? 'full' : 'open';
    const shown = state === 'closed' ? undefined : shownLeft(opts.showLeft, left, size);
    const row: NightState = { pool, state, ...(shown === undefined ? {} : { left: shown }) };
    if (search > 0) {
      row.earliest = null;
      for (let d = 1; d <= search; d += 1) {
        const from = addDays(opts.from, d);
        if (!(await sells(from, addDays(from, length)))) continue;
        const later = over(pool, from).left;
        if (later === null || later >= 1) {
          row.earliest = from;
          break;
        }
      }
      if (row.earliest !== null && (first === null || row.earliest < first)) first = row.earliest;
    }
    out.push(row);
  }
  return { pools: out, earliest: first };
}

/** Whether a pool's row sleeps the guests asked (a pool with no such column sleeps any). */
export function fitsGuests(rule: NightRule, row: Row | null, guests: number | undefined): boolean {
  if (guests === undefined || !('count' in rule.rule.pool) || rule.rule.pool.fits === undefined || row === null) return true;
  const sleeps = Number(row[rule.rule.pool.fits.column]);
  return !Number.isFinite(sleeps) || sleeps >= guests;
}

/** The asker's own rows among a rule's rows: those of an owner id (their held order), or one row by its key. */
export async function ownRows(db: Db, rule: Rule, key: { table: 'own' | 'owner'; id: string }): Promise<Row[]> {
  const table = rule.table;
  if (table.primaryKey.length === 0) return [];
  if (key.table === 'own') return [Object.fromEntries(table.primaryKey.map((k) => [k, key.id]))];
  if (rule.owner === null) return [];
  const rows = (await db
    .selectFrom(table.id)
    .select(table.primaryKey.map((k) => db.dynamic.ref(k)) as never)
    .where((eb) => eb(db.dynamic.ref(rule.owner!.column), '=', key.id))
    .execute()) as Row[];
  return rows;
}
