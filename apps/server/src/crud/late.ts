// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LATE MOVES — a move made close to a moment: a cancellation inside the last
 * 48 hours before a stay's arrival, a guest's change the day before a visit.
 *
 * One window for every rule that asks "is this too close?": the booking
 * rule's cancellation (`booking.cancel`) and a table's own late moves
 * (`states.late`). A move is inside the window when the moment is less than
 * `within` away — a moment already past is inside too, which is what a
 * cancellation after the visit began is.
 *
 * A late move either goes through and is marked (mode `flag`: the flag column
 * set, whoever writes) or is turned away (mode `refuse`: a guest only, or
 * everyone). The moment is read from the row AS STORED, never from the write:
 * a guest who types a later arrival time in the same change does not move the
 * window they are cancelling in.
 *
 * DECIDE marks the move from the row read before the write's locks, on the
 * clock the write began by; the statement judges it again holding the row, on
 * the clock read under the locks (`crud/state-conditions.ts`). Time only moves
 * forward, so the two differ only when the window opened while the write
 * waited, or another writer moved the moment meanwhile: the write is then
 * made again (`WRITE_CONFLICT`, retry), and decided afresh.
 */
import type { LateMove } from '@adminium/manifest';

import type { TableStatesRule } from '../connections/effective-schema.js';
import type { Row } from './mask.js';
import { momentOf, shifted, type MomentContext } from './moments.js';
import { holds } from './state-conditions.js';

/**
 * Whether `now` is inside the window before `moment`: less than `within`
 * milliseconds before it, or past it. No moment is never late.
 */
export function lateWindow(input: { moment: Date | null; withinMs: number; now: Date }): 'inside' | 'outside' {
  if (input.moment === null) return 'outside';
  return input.moment.getTime() - input.now.getTime() < input.withinMs ? 'inside' : 'outside';
}

/**
 * The late rule a move from `from` to `to` is judged by, or undefined. A rule
 * with a `where` judges only a move whose row, as the write leaves it, meets
 * it (a cancellation by the house is never late).
 */
export function lateRuleFor(states: TableStatesRule | undefined, from: string, to: string, row: Row): LateMove | undefined {
  return (states?.late ?? []).find(
    (rule) => rule.to === to && (rule.from === undefined || rule.from.includes(from)) && (rule.where ?? []).every((condition) => holds(condition, row)),
  );
}

/**
 * A late rule's verdict for a row: its moment (read from the row and its
 * links as the context holds them) and whether `now` falls inside the window
 * before it. The window's start is the moment moved back by `within` — whole
 * minutes and hours as elapsed time, days on the venue's calendar.
 */
export async function lateVerdict(rule: LateMove, context: MomentContext, now: Date): Promise<{ inside: boolean; at: Date | null }> {
  const at = await momentOf(rule.moment, context);
  if (at === null) return { inside: false, at };
  const opens = await shifted(at, rule.within, -1, context);
  // A window whose length cannot be read is no window: the move is not late.
  if (opens === null) return { inside: false, at };
  return { inside: now.getTime() > opens.getTime(), at };
}

/** Whether this writer is turned away by a late rule in mode `refuse`. */
export function refusedBy(rule: LateMove, origin: string | undefined): boolean {
  return rule.mode === 'refuse' && (rule.refuse === 'everyone' || origin === 'public');
}
