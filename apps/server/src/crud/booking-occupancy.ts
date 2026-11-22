// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HOW MUCH OF A PERSON'S WORKING TIME WAS BOOKED, over a run of venue days:
 * the minutes of their rows in the states asked, against the minutes they
 * worked. Clean-up buffers are not booked time.
 *
 * Working minutes are the guard's own reading of the week: a person's hours
 * (capped by the practice's where the rule says so), less their breaks and
 * their time away, and none on a day they or the practice are closed. A busy
 * time Adminium keeps from a calendar is left out: that table is private, so
 * nothing worked out for somebody else reads it.
 */
import type { TableBookingRule } from '../connections/effective-schema.js';
import { addDays, busyIn, cappedBy, closureRows, compareKeys, dateOf, hoursOf, keyOf, off, weekdayOf, type Hours } from './booking-guard.js';
import { slotInstant, type GuardTarget } from './capacity-guard.js';
import type { Row } from './mask.js';
import { venueClock, wallTimeToInstant } from './venue-time.js';

export interface OccupancyLine {
  resource: string;
  /** Minutes of the person's rows in the states asked. */
  booked: number;
  /** Minutes they worked, breaks and time away taken out. */
  working: number;
}

/** The minutes of `[opens, closes)` left once these spans are taken out. */
export function minutesLeft(hours: Pick<Hours, 'opens' | 'closes'>, out: readonly { start: number; end: number }[]): number {
  let left = hours.closes - hours.opens;
  let reached = hours.opens;
  for (const span of [...out].sort((a, b) => a.start - b.start)) {
    const start = Math.max(span.start, reached);
    const end = Math.min(span.end, hours.closes);
    if (end <= start) continue;
    left -= end - start;
    reached = end;
  }
  return left;
}

/**
 * The moments of a span as wall minutes of its day. Where the clocks went back
 * inside it, its end can read earlier than its start: it is then two spans,
 * up to the moment the clocks turned and on from where they turned to.
 */
export function wallSpans(start: number, end: number, minuteOf: (at: number) => number): { start: number; end: number }[] {
  const from = minuteOf(start);
  const to = minuteOf(end);
  if (to > from || end - start < 60_000) return [{ start: from, end: to }];
  let before = start;
  let after = end;
  while (after - before > 1_000) {
    const middle = before + Math.floor((after - before) / 2);
    if (minuteOf(middle) >= from) before = middle;
    else after = middle;
  }
  return [
    { start: from, end: minuteOf(before) + 1 },
    { start: minuteOf(after), end: to },
  ];
}

/** Everyone who does a kind, in the rule's order: someone on the staff table who is booked for nothing has no time to fill. */
async function peopleOf(rule: TableBookingRule, target: GuardTarget): Promise<{ resource: string; active: boolean; raw: unknown }[]> {
  const { db } = target;
  const rows = (await db.selectFrom(rule.eligible.table).selectAll().execute()) as Row[];
  const doing = new Map(rows.map((row) => [keyOf(row[rule.eligible.resource]), row[rule.eligible.resource]]));
  doing.delete('');
  const order = rule.eligible.order;
  if (order === undefined) return [...doing].sort(([a], [b]) => compareKeys(a, b)).map(([resource, raw]) => ({ resource, active: true, raw }));
  const idColumn = target.table.table?.columns.find((c) => c.name === rule.resource)?.references?.column ?? 'id';
  const people = (await db.selectFrom(order.table).selectAll().execute()) as Row[];
  return people
    .filter((row) => doing.has(keyOf(row[idColumn])))
    .map((row) => ({ resource: keyOf(row[idColumn]), active: order.active === undefined || !off(row[order.active]), raw: row[idColumn], position: Number(row[order.column] ?? 0) }))
    .sort((a, b) => a.position - b.position || compareKeys(a.resource, b.resource));
}

/**
 * Each person's booked and working minutes over `[from, to]`, in the rule's
 * order. Someone switched off is listed only if they have booked time there.
 */
export async function bookingOccupancy(rule: TableBookingRule, target: GuardTarget, input: { from: string; to: string; states?: readonly string[] | undefined }): Promise<OccupancyLine[]> {
  const { db } = target;
  const zone = target.timezone ?? 'UTC';
  const { from, to } = input;
  const people = await peopleOf(rule, target);

  const practiceSpec = rule.hours.practice;
  const week = (await db.selectFrom(practiceSpec.table).selectAll().execute()) as Row[];
  const ownSpec = rule.hours.own;
  const ownRows = new Map<string, Row[]>();
  if (ownSpec !== undefined) {
    for (const row of (await db.selectFrom(ownSpec.table).selectAll().execute()) as Row[]) {
      const key = keyOf(row[ownSpec.resource]);
      ownRows.set(key, [...(ownRows.get(key) ?? []), row]);
    }
  }
  const closures = (await closureRows(rule, db, from, to)).map((row) => ({
    who: rule.closures?.resource === undefined ? '' : keyOf(row[rule.closures.resource]),
    start: dateOf(row[rule.closures!.from]),
    end: dateOf(row[rule.closures!.to]),
  }));
  const away = await busyIn(rule, target, from, to, people.map((person) => person.raw), (source) => source.engine === undefined);

  // Read wide and placed by the venue's day, as the guard reads a day's rows.
  const states = input.states ?? rule.countWhere.values;
  const rows = (await db
    .selectFrom(target.table.id)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(rule.start), '>=', addDays(from, -1)))
    .where((eb) => eb(db.dynamic.ref(rule.start), '<', addDays(to, 2)))
    .where((eb) => eb(db.dynamic.ref(rule.countWhere.column), 'in', [...states]))
    .execute()) as Row[];
  const booked = new Map<string, number>();
  for (const row of rows) {
    const start = slotInstant(row[rule.start]);
    if (start === null) continue;
    const day = venueClock(start, zone).day;
    if (day < from || day > to) continue;
    const key = keyOf(row[rule.resource]);
    booked.set(key, (booked.get(key) ?? 0) + Math.max(0, Number(row[rule.minutes] ?? 0)));
  }

  const working = new Map<string, number>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = weekdayOf(day);
    const practice = hoursOf(practiceSpec, week.find((row) => String(row[practiceSpec.weekday]) === weekday));
    const closedToday = new Set(closures.filter((closure) => closure.start <= day && day <= closure.end).map((closure) => closure.who));
    if (closedToday.has('')) continue;
    const dayStart = wallTimeToInstant(`${day} 00:00`, zone)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const dayEnd = wallTimeToInstant(`${addDays(day, 1)} 00:00`, zone)?.getTime() ?? Number.POSITIVE_INFINITY;
    const minuteOf = (at: number) => (at <= dayStart ? 0 : at >= dayEnd ? 1440 : venueClock(new Date(at), zone).minute);
    for (const person of people) {
      if (closedToday.has(person.resource)) continue;
      const mine = ownRows.get(person.resource);
      let hours = practice;
      if (mine !== undefined && ownSpec !== undefined) {
        const own = hoursOf(ownSpec, mine.find((row) => String(row[ownSpec.weekday]) === weekday));
        hours = ownSpec.within === 'practice' ? cappedBy(own, practice) : own;
      }
      if (hours === null) continue;
      const taken = away.filter((one) => one.resource === person.resource && one.start < dayEnd && one.end > dayStart).flatMap((one) => wallSpans(Math.max(one.start, dayStart), Math.min(one.end, dayEnd), minuteOf));
      working.set(person.resource, (working.get(person.resource) ?? 0) + minutesLeft(hours, [...hours.breaks, ...taken]));
    }
  }

  return people
    .filter((person) => person.active || (booked.get(person.resource) ?? 0) > 0)
    .map((person) => ({ resource: person.resource, booked: booked.get(person.resource) ?? 0, working: working.get(person.resource) ?? 0 }));
}
