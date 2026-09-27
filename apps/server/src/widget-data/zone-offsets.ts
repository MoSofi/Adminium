// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHEN A ZONE'S CLOCK MOVES — for the engines that cannot move a row to a
 * venue's clock themselves.
 *
 * Postgres converts every row by the zone's name (`AT TIME ZONE`). MySQL
 * (whose zone tables are seldom loaded) and SQLite know no zone names, so a
 * bucket on the venue's clock adds a number of minutes to each row. One
 * number read at one instant is an hour off for every row on the other side
 * of a clock change. So the number is chosen per row, from the instants at
 * which either clock involved (the venue's, and the server's for a value kept
 * on the server's wall clock) moves.
 *
 * Offsets are found by sampling each day and narrowing a change to the
 * minute, once per zone and year for the life of the process. No I/O.
 */
import { venueClock } from '../crud/venue-time.js';

/** How far a zone's clock is ahead of UTC at `instant`, in minutes. */
export function offsetMinutesAt(instant: number, timezone: string): number {
  const clock = venueClock(new Date(instant), timezone);
  const asUtc = Date.parse(`${clock.day}T00:00:00Z`) + clock.minute * 60_000;
  return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/** One instant a zone's clock moves at, and its offset from then on. */
interface Change {
  at: number;
  offset: number;
}

const DAY = 86_400_000;
const CHANGES = new Map<string, readonly Change[]>();

/** The changes of `timezone`'s offset during one calendar year (UTC), found once. */
function changesIn(timezone: string, year: number): readonly Change[] {
  const key = `${timezone}|${String(year)}`;
  const held = CHANGES.get(key);
  if (held !== undefined) return held;
  const out: Change[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  let before = start;
  let offset = offsetMinutesAt(before, timezone);
  for (let t = start + DAY; t <= end; t += DAY) {
    const now = offsetMinutesAt(t, timezone);
    if (now !== offset) {
      // The first minute on the new offset, between the two samples.
      let lo = before;
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
        if (offsetMinutesAt(mid, timezone) === offset) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi, offset: offsetMinutesAt(hi, timezone) });
      offset = now;
    }
    before = t;
  }
  CHANGES.set(key, out);
  return out;
}

/** The changes of `timezone`'s offset strictly after `from` and up to `to`. */
function changesBetween(timezone: string, from: number, to: number): Change[] {
  const out: Change[] = [];
  for (let year = new Date(from).getUTCFullYear(); year <= new Date(to).getUTCFullYear(); year += 1) {
    for (const change of changesIn(timezone, year)) if (change.at > from && change.at <= to) out.push(change);
  }
  return out;
}

/** A stretch of time over which neither clock moves: from `at` (null: from ever) on. */
export interface OffsetSpan {
  at: number | null;
  /** The venue's offset from UTC, in minutes. */
  venue: number;
  /** The server's offset from UTC, in minutes: the clock a zone-less value is kept on. */
  server: number;
}

/**
 * The spans between `from` and `to` over which neither the venue's nor the
 * server's clock moves, oldest first; the first reaches back for ever and
 * the last on for ever (a row outside the range takes its nearest span).
 */
export function offsetSpans(venue: string, server: string, from: Date, to: Date): OffsetSpan[] {
  const a = from.getTime();
  const b = Math.max(a, to.getTime());
  const spans: OffsetSpan[] = [{ at: null, venue: offsetMinutesAt(a, venue), server: offsetMinutesAt(a, server) }];
  const moves = [...changesBetween(venue, a, b).map((c) => ({ ...c, zone: 'venue' as const })), ...changesBetween(server, a, b).map((c) => ({ ...c, zone: 'server' as const }))].sort(
    (x, y) => x.at - y.at,
  );
  for (const move of moves) {
    const last = spans[spans.length - 1]!;
    const next = { ...last, at: move.at, [move.zone]: move.offset };
    if (last.at === move.at) spans[spans.length - 1] = next;
    else spans.push(next);
  }
  return spans;
}

/** `YYYY-MM-DD HH:MM:SS` of an instant moved by `minutes`: how the engines' text and DATETIME compare. */
export function wallText(instant: number, minutes: number): string {
  return new Date(instant + minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The steps of one value over the spans, merged where it does not change:
 * `[{at, value}]` oldest first, the first with `at: null`.
 */
export function stepsOf(spans: readonly OffsetSpan[], value: (span: OffsetSpan) => number): { at: number | null; value: number; span: OffsetSpan }[] {
  const out: { at: number | null; value: number; span: OffsetSpan }[] = [];
  for (const span of spans) {
    const v = value(span);
    if (out.length > 0 && out[out.length - 1]!.value === v) continue;
    out.push({ at: span.at, value: v, span });
  }
  return out;
}
