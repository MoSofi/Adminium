// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sync's small decisions, with no database and no provider: what a name
 * becomes in someone's calendar, which busy times count, and what a clash is.
 */
import { createHash } from 'node:crypto';

import type { CalendarBusyInterval } from '@adminium/add-on-contracts';

import { wallTimeToInstant } from '../crud/venue-time.js';

export type Detail = 'first-name+initial' | 'none';

/**
 * A name as a calendar shows it: the first word, then the last word's first
 * letter and a full stop, or the whole name when it is one word.
 * "María José de la Cruz" → "María C.", "Cher" → "Cher".
 */
export function shortName(full: string | null | undefined): string | null {
  const words = (full ?? '').trim().split(/\s+/u).filter((word) => word !== '');
  if (words.length === 0) return null;
  if (words.length === 1) return words[0]!;
  const initial = [...words[words.length - 1]!][0]!;
  return `${words[0]!} ${initial.toLocaleUpperCase()}.`;
}

/** The title of an event: the service, and the person only when the detail allows it. */
export function eventTitle(service: string | null, person: string | null, detail: Detail): { title: string; named: boolean } {
  const name = detail === 'none' ? null : shortName(person);
  const what = service?.trim() || null;
  if (what !== null && name !== null) return { title: `${what} — ${name}`, named: true };
  if (what !== null) return { title: what, named: false };
  return name !== null ? { title: name, named: true } : { title: 'Booking', named: false };
}

/** The lesser of what a rule allows and what a person chose. */
export function detailWithin(chosen: Detail, max: Detail): Detail {
  return max === 'none' ? 'none' : chosen;
}

export interface WantedEvent {
  start: number;
  end: number;
  zone: string;
  title: string;
  /** Whether the title holds a person's name. */
  named: boolean;
}

/** What is compared to know whether an event needs writing. Holds no text a person could read back. */
export function eventHash(event: WantedEvent): string {
  return createHash('sha256').update(JSON.stringify([event.start, event.end, event.zone, event.title])).digest('hex');
}

/**
 * The key the service keeps with an event, minted by the core: lower-case hex,
 * which Google's event ids allow, and never a booking's code, which is display
 * text and not unique across apps.
 */
export function eventKey(input: { connectionId: string; tableName: string; rowKey: string; accountId: string; generation: number }): string {
  return createHash('sha256')
    .update(JSON.stringify([input.connectionId, input.tableName, input.rowKey, input.accountId, input.generation]))
    .digest('hex')
    .slice(0, 40);
}

export interface Span {
  start: number;
  end: number;
}

/** Only these take a person's time. `tentative`, `free` and `elsewhere` do not. */
const TAKES_TIME: ReadonlySet<string> = new Set(['busy', 'away']);

/** The venue's midnight beginning a date. */
function midnight(date: string, zone: string): number | null {
  return wallTimeToInstant(`${date} 00:00`, zone)?.getTime() ?? null;
}

/**
 * The busy times that count, as instants, from what a provider read.
 *
 * An all-day time is a DATE, turned into the venue's day here (it is 25 hours
 * long on the day the clocks go back) and counted only when the person ticked
 * it. A provider that cannot tell an all-day time (`unknown`) counts: what was
 * marked Busy is Busy, and guessing from a block's length is wrong whenever
 * two events touch.
 */
export function countedBusy(intervals: readonly CalendarBusyInterval[], input: { countAllDay: boolean; zone: string; from: number; to: number }): Span[] {
  const spans: Span[] = [];
  for (const interval of intervals) {
    if (!TAKES_TIME.has(interval.kind)) continue;
    let start: number | null;
    let end: number | null;
    if (interval.allDay === true) {
      if (!input.countAllDay) continue;
      start = midnight(interval.date, input.zone);
      end = midnight(interval.endDate, input.zone);
    } else {
      start = Date.parse(interval.start);
      end = Date.parse(interval.end);
    }
    if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const clippedStart = Math.max(start, input.from);
    const clippedEnd = Math.min(end, input.to);
    if (clippedEnd > clippedStart) spans.push({ start: clippedStart, end: clippedEnd });
  }
  return mergeSpans(spans);
}

/** Overlapping or touching spans as one, in order. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

export const busyHash = (spans: readonly Span[]): string => createHash('sha256').update(JSON.stringify(spans.map((span) => [span.start, span.end]))).digest('hex');

export interface ClashBooking extends Span {
  rowKey: string;
  resource: string;
}

export interface DerivedClash {
  rowKey: string;
  resource: string;
  /** The overlap, clipped to the booking: "that busy time", whatever a later pass does to its rows. */
  overlapStart: number;
  overlapEnd: number;
}

/**
 * The clashes between bookings and busy times, worked out from the two.
 *
 * Nothing is stored for one until it is told or kept, so a full re-read that
 * finds the same busy times changes nothing.
 */
export function deriveClashes(bookings: readonly ClashBooking[], busy: ReadonlyMap<string, readonly Span[]>): DerivedClash[] {
  const out: DerivedClash[] = [];
  for (const booking of bookings) {
    const overlaps: Span[] = [];
    for (const span of busy.get(booking.resource) ?? []) {
      const start = Math.max(span.start, booking.start);
      const end = Math.min(span.end, booking.end);
      if (end > start) overlaps.push({ start, end });
    }
    for (const overlap of mergeSpans(overlaps)) {
      out.push({ rowKey: booking.rowKey, resource: booking.resource, overlapStart: overlap.start, overlapEnd: overlap.end });
    }
  }
  return out;
}

/**
 * What a read leaves out as Adminium's own events coming back: a person may
 * show the calendar Adminium writes inside an account they read. Only a time
 * that is EXACTLY one of their events: a longer meeting over a booking is a
 * real clash.
 */
export function withoutOwnEvents(intervals: readonly CalendarBusyInterval[], own: readonly Span[]): CalendarBusyInterval[] {
  const spans = new Set(own.map((span) => `${String(span.start)}|${String(span.end)}`));
  return intervals.filter((interval) => interval.allDay === true || !spans.has(`${String(Date.parse(interval.start))}|${String(Date.parse(interval.end))}`));
}

/** The last day a pass may read: two past the last bookable day, inside the longest window one swap holds. */
export function lastReadDay(firstDay: string, lastBookable: string, maxDays: number): string {
  const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const wanted = addDays(lastBookable, 2);
  const cap = addDays(firstDay, maxDays - 1);
  return wanted < cap ? wanted : cap;
}

/** The next poll: ten minutes, give or take a quarter, so a team is not read all at once. */
export function nextPollDelay(random: () => number): number {
  return Math.round(600_000 * (0.75 + random() * 0.5));
}
