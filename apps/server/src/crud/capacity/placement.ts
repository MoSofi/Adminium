// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A PLACE IS ONE THE VENUE OFFERS — before anything is counted.
 *
 * A new place (a new row, or one moved to another slot, show or stay) must be
 * one the venue offers at all; a place taken back (a cancelled order
 * restored) is never refused by a pause, a closure or a window that came
 * later. Each refusal is a 422 on the column that asked for the place, with
 * its reason:
 *
 *  - slot, in this order: a closed day (`closed`) → outside the day's hours
 *    (`out-of-hours`) → off the grid (`out-of-range`) → a paused slot
 *    (`paused`, a guest only) → in the past, or sooner than the notice a
 *    guest must give (`out-of-range`) → beyond the window (`out-of-range`).
 *    A slot starts at or after the day's opening and before its closing; a
 *    day that closes at or before it opens runs past midnight, and its small
 *    hours belong to the evening before.
 *  - parent: the row it points at must exist; a guest buys only inside its
 *    sales window (`not-on-sale`).
 *  - night: a stay leaves after it arrives, within the shortest and longest
 *    stays (the shortest by weekday of arrival); a guest arrives neither
 *    before today nor further ahead than the venue sells.
 *
 * A released app's slot rule (no hours, closures, pauses or notice) is judged
 * exactly as it always was, and refused without a reason.
 */
import { sql } from 'kysely';
import { BOOKING_WEEKDAYS } from '@adminium/manifest';

import type { CapacitySetting } from '../../connections/effective-schema.js';
import { daysBetween, minutesOf } from '../capacity-guard.js';
import type { Row } from '../mask.js';
import { readDay, readInstant } from '../moments.js';
import { venueClock, wallTimeToInstant } from '../venue-time.js';
import { addDays, staysOf, type Reads } from './count.js';
import type { NightRule, ParentRule, SlotRule } from './rules.js';
import type { CapacityReason } from './types.js';

export interface Placement {
  column: string;
  code: CapacityReason;
}

export interface PlaceContext {
  reads: Reads;
  now: Date;
  /** A guest is held to pauses, notice, sales windows and the past; staff are not. */
  public: boolean;
  zone: string;
}

const weekdayOf = (day: string) => BOOKING_WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]!;

async function timeOf(reads: Reads, value: string | CapacitySetting | undefined): Promise<number | null> {
  if (value === undefined) return null;
  return minutesOf(typeof value === 'string' ? value : await reads.setting(value));
}

const truthy = (value: unknown) => value === true || value === 1 || value === '1' || value === 't' || value === 'true';

/** A day's opening and closing minutes (closing past midnight is above 1440), or null when it does not open. */
export interface DayHours {
  opens: number;
  closes: number;
}

/** The hours table, read once per call: per weekday. */
async function hoursTable(rule: SlotRule, reads: Reads): Promise<Map<string, DayHours | null>> {
  const hours = rule.rule.hours!;
  const rows = (await reads.db.selectFrom(hours.table).selectAll().execute()) as Row[];
  const out = new Map<string, DayHours | null>();
  for (const row of rows) {
    const weekday = String(row[hours.weekday] ?? '');
    if (hours.open !== undefined && !truthy(row[hours.open])) {
      if (!out.has(weekday)) out.set(weekday, null);
      continue;
    }
    const opens = minutesOf(row[hours.opens]);
    let closes = minutesOf(row[hours.closes]);
    if (opens === null || closes === null) continue;
    if (closes <= opens) closes += 1440;
    out.set(weekday, { opens, closes });
  }
  return out;
}

/** The venue days a closure covers among `days` (inclusive dates; an empty end is open). */
async function closedDays(rule: SlotRule, reads: Reads, days: readonly string[]): Promise<Set<string>> {
  const closures = rule.rule.closures;
  const out = new Set<string>();
  if (closures === undefined || days.length === 0) return out;
  const first = [...days].sort()[0]!;
  const last = [...days].sort().at(-1)!;
  const active = closures.active === undefined ? sql`` : sql` and ${sql.ref(closures.active)} = ${sql.lit(true)}`;
  const rows = (
    await sql<{ f: unknown; t: unknown }>`select ${sql.ref(closures.from)} as f, ${sql.ref(closures.to)} as t from ${sql.table(closures.table)}
      where ${sql.ref(closures.from)} <= ${last} and (${sql.ref(closures.to)} is null or ${sql.ref(closures.to)} >= ${first})${active}`.execute(reads.db)
  ).rows;
  for (const row of rows) {
    const from = readDay(row.f);
    const to = readDay(row.t);
    if (from === null) continue;
    for (const day of days) if (day >= from && (to === null || day <= to)) out.add(day);
  }
  return out;
}

/** The paused slots' instants among the envelope of `first`..`last`. */
async function pausedSlots(rule: SlotRule, reads: Reads, first: Date, last: Date): Promise<Set<number>> {
  const pauses = rule.rule.pauses;
  const out = new Set<number>();
  if (pauses === undefined) return out;
  const day = (instant: Date, days: number) => new Date(instant.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const active = pauses.active === undefined ? sql`` : sql` and ${sql.ref(pauses.active)} = ${sql.lit(true)}`;
  const rows = (
    await sql<{ s: unknown }>`select ${sql.ref(pauses.slot)} as s from ${sql.table(pauses.table)}
      where ${sql.ref(pauses.slot)} >= ${day(first, -1)} and ${sql.ref(pauses.slot)} < ${day(last, 2)}${active}`.execute(reads.db)
  ).rows;
  for (const row of rows) {
    const at = readInstant(row.s)?.getTime();
    if (at !== undefined) out.add(at);
  }
  return out;
}

/** One slot a day offers: its minute from the day's midnight (above 1440 past midnight) and its instant. */
export interface GridSlot {
  minute: number;
  instant: Date;
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** What a venue day offers under a slot rule: closed, or its slots on the grid (empty when it does not open). */
export interface SlotDay {
  day: string;
  closed: boolean;
  slots: GridSlot[];
  paused: Set<number>;
}

/** The slots each of `days` offers, with the closed days and paused slots: the answers' one reading of the rule. */
export async function slotDays(rule: SlotRule, reads: Reads, zone: string, days: readonly string[]): Promise<SlotDay[]> {
  const step = (await reads.number(rule.rule.slotMinutes)) ?? 30;
  const table = rule.rule.hours === undefined ? null : await hoursTable(rule, reads);
  const opens = table === null ? ((await timeOf(reads, rule.rule.opens)) ?? 0) : 0;
  let closes = table === null ? ((await timeOf(reads, rule.rule.closes)) ?? 1440) : 0;
  if (table === null && closes <= opens) closes += 1440;
  const closed = await closedDays(rule, reads, days);
  const out: SlotDay[] = [];
  for (const day of days) {
    const hours = table === null ? { opens, closes } : (table.get(weekdayOf(day)) ?? null);
    const slots: GridSlot[] = [];
    if (hours !== null && step > 0) {
      // Legacy hours end a slot by the close; a day of hours starts its last slot before it.
      const fits = table === null ? (minute: number) => minute + step <= hours.closes : (minute: number) => minute < hours.closes;
      for (let minute = hours.opens; fits(minute); minute += step) {
        const date = minute >= 1440 ? addDays(day, 1) : day;
        const instant = wallTimeToInstant(`${date} ${hhmm(minute % 1440)}`, zone);
        if (instant !== null) slots.push({ minute, instant });
      }
    }
    out.push({ day, closed: closed.has(day), slots, paused: new Set() });
  }
  const all = out.flatMap((d) => d.slots);
  if (all.length > 0 && rule.rule.pauses !== undefined) {
    const paused = await pausedSlots(rule, reads, all[0]!.instant, all.at(-1)!.instant);
    for (const day of out) for (const slot of day.slots) if (paused.has(slot.instant.getTime())) day.paused.add(slot.instant.getTime());
  }
  return out;
}

export { hhmm };

/** Whether a slot rule reads a day's hours, closures, pauses or notice: otherwise it is judged as it always was. */
const newShape = (rule: SlotRule) => !rule.legacy;

/** Where a slot sits, or why a guest (or anyone) may not take it. */
export async function placeSlot(rule: SlotRule, row: Row, ctx: PlaceContext): Promise<Placement | null> {
  const r = rule.rule;
  const refused = (column: string, code: CapacityReason = 'out-of-range'): Placement => ({ column, code });
  const instant = readInstant(row[r.slot]);
  if (instant === null) return refused(r.slot);
  const clock = venueClock(instant, ctx.zone);
  const step = await ctx.reads.number(r.slotMinutes);
  if (r.hours === undefined) {
    const opens = await timeOf(ctx.reads, r.opens);
    let closes = await timeOf(ctx.reads, r.closes);
    let minute = clock.minute;
    if (opens !== null && closes !== null && closes <= opens) {
      // Open past midnight: the small hours belong to the evening before.
      closes += 1440;
      if (minute < opens) minute += 1440;
    }
    const serviceDay = minute >= 1440 ? addDays(clock.day, -1) : clock.day;
    if (newShape(rule) && (await closedDays(rule, ctx.reads, [serviceDay])).has(serviceDay)) return refused(r.slot, 'closed');
    if (step !== null && step > 0 && (clock.second !== 0 || (minute - (opens ?? 0)) % step !== 0)) return refused(r.slot);
    if (opens !== null && minute < opens) return refused(r.slot);
    if (closes !== null && minute + (step ?? 0) > closes) return refused(r.slot);
  } else {
    // The day whose hours hold the slot: its own, or the evening before when that runs past midnight.
    const table = await hoursTable(rule, ctx.reads);
    const candidates = [
      { day: clock.day, minute: clock.minute },
      { day: addDays(clock.day, -1), minute: clock.minute + 1440 },
    ];
    // The close itself is inside the day's hours, and is no slot (a slot starts before the kitchen closes).
    const found = candidates.find(({ day, minute }) => {
      const hours = table.get(weekdayOf(day)) ?? null;
      return hours !== null && minute >= hours.opens && minute <= hours.closes;
    });
    const serviceDay = found?.day ?? clock.day;
    if ((await closedDays(rule, ctx.reads, [serviceDay])).has(serviceDay)) return refused(r.slot, 'closed');
    if (found === undefined) return refused(r.slot, 'out-of-hours');
    const { opens, closes } = table.get(weekdayOf(found.day))!;
    if (found.minute >= closes) return refused(r.slot);
    if (step !== null && step > 0 && (clock.second !== 0 || (found.minute - opens) % step !== 0)) return refused(r.slot);
  }
  if (ctx.public && r.pauses !== undefined && (await pausedSlots(rule, ctx.reads, instant, instant)).has(instant.getTime())) {
    return refused(r.slot, 'paused');
  }
  if (instant.getTime() < ctx.now.getTime()) return refused(r.slot);
  if (ctx.public && r.noticeMinutes !== undefined) {
    const notice = await ctx.reads.number(r.noticeMinutes);
    if (notice !== null && ctx.now.getTime() + notice * 60_000 > instant.getTime()) return refused(r.slot);
  }
  const window = await ctx.reads.number(r.windowDays);
  if (window !== null && daysBetween(venueClock(ctx.now, ctx.zone).day, clock.day) > window) return refused(r.slot);
  return null;
}

/** Whether a parent row sells now, for a guest: inside its sales window. */
export function onSale(rule: ParentRule, target: Row, now: Date): 'on' | 'soon' | 'ended' {
  const window = rule.rule.window;
  if (window === undefined) return 'on';
  const opens = window.opens === undefined ? null : readInstant(target[window.opens]);
  const closes = window.closes === undefined ? null : readInstant(target[window.closes]);
  if (opens !== null && opens.getTime() > now.getTime()) return 'soon';
  if (closes !== null && closes.getTime() <= now.getTime()) return 'ended';
  return 'on';
}

/** Whether the row a parent rule points at exists and, for a guest, sells now. */
export async function placeParent(rule: ParentRule, row: Row, ctx: PlaceContext): Promise<Placement | null> {
  const key = row[rule.viaColumn];
  if (key === null || key === undefined) return null;
  const target = await ctx.reads.linked(rule.via, key);
  if (target === null) return { column: rule.viaColumn, code: 'out-of-range' };
  if (ctx.public && onSale(rule, target, ctx.now) !== 'on') return { column: rule.viaColumn, code: 'not-on-sale' };
  return null;
}

/** The column a night rule's date is named by: its own, or the link to the row that holds it. */
export const dateColumn = (rule: NightRule, which: 'from' | 'to'): string => {
  const date = rule[which];
  return date.level === 'own' ? date.column : (rule.ownerColumn ?? date.column);
};

/** Whether a stay's dates are a stay the venue sells. */
/** `begun`: the guest has arrived, so the stay's first night is behind the venue's today and is no placement in the past. */
export async function placeNight(rule: NightRule, row: Row, owner: Row | null, ctx: PlaceContext, begun = false): Promise<Placement | null> {
  const { from, to } = staysOf(rule, row, owner);
  const toColumn = dateColumn(rule, 'to');
  if (from === null || to === null || from >= to) return { column: toColumn, code: 'out-of-range' };
  const nights = daysBetween(from, to);
  const limits = rule.rule.nights;
  if (limits !== undefined) {
    const min = await ctx.reads.number(limits.min);
    const max = await ctx.reads.number(limits.max);
    const byArrival = limits.minByArrival?.[weekdayOf(from)];
    if ((min !== null && nights < min) || (max !== null && nights > max) || (byArrival !== undefined && nights < byArrival)) {
      return { column: toColumn, code: 'out-of-range' };
    }
  }
  if (ctx.public && !begun) {
    const today = venueClock(ctx.now, ctx.zone).day;
    const ahead = await ctx.reads.number(limits?.aheadDays);
    if (from < today || (ahead !== null && daysBetween(today, from) > ahead)) return { column: dateColumn(rule, 'from'), code: 'out-of-range' };
  }
  return null;
}
