// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PUBLIC ENTRY'S WINDOWS READ FROM MOMENTS, made ready for the statement.
 *
 * `writable_when` may open a guest's change only inside a window: a refund
 * until seven days before the show (or the show's own refund deadline, when
 * it has one), a change until two days before arrival at the check-in time,
 * and only while the linked row allows it (the show takes refunds at all).
 * A moment may read a setting, a linked row and the venue's calendar, so it
 * is no condition a WHERE can hold: the statement judges it, holding the row
 * and the linked row, on the clock read under its locks
 * (`crud/state-conditions.ts`). A window keyed by a link reads the linked
 * row's columns; one keyed by the row's own date reads that date.
 */
import type { Moment, StateCondition } from '@adminium/manifest';

import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { attachWindows, type StateWindow } from '../crud/state-conditions.js';
import { isMomentWindow, type MomentWindowEnd, type WritableState } from './relative-filters.js';

/** An end of a window as a moment, its column given by the key when it names none. */
function endOf(end: MomentWindowEnd | undefined): Moment | undefined {
  if (end === undefined) return undefined;
  return { ...(end as unknown as Moment), column: end.column ?? '' };
}

/**
 * The windows read from moments among an entry's `writable_when`, each with
 * its link followed as the write path follows one (one column to another
 * table's one-column key). A link the snapshot can no longer follow still
 * gives a window — with no link, and so with nothing to read: it is closed.
 */
export function publicWindows(
  writableWhen: Readonly<Record<string, WritableState>>,
  view: SnapshotView,
  table: ResolvedTable,
  zone: string,
): StateWindow[] {
  const out: StateWindow[] = [];
  for (const [column, when] of Object.entries(writableWhen)) {
    if (!isMomentWindow(when)) continue;
    const keyedByLink = [when.after, when.before].some((end) => end?.column !== undefined) || when.where !== undefined;
    const relation = view.model.relations.find(
      (r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column && r.to.columns.length === 1,
    );
    const link = keyedByLink && relation !== undefined ? { via: column, table: relation.to.tableId, key: relation.to.columns[0] as string } : undefined;
    out.push({
      column,
      ...(link === undefined ? {} : { link }),
      // A link that cannot be followed reads nothing: the window stays shut.
      ...(keyedByLink && link === undefined ? { unresolved: true } : {}),
      ...(when.after === undefined ? {} : { after: endOf(when.after) }),
      ...(when.before === undefined ? {} : { before: endOf(when.before) }),
      ...(when.where === undefined ? {} : { where: when.where as unknown as StateCondition[] }),
      zone,
    });
  }
  return out;
}

/**
 * A prepared row with the entry's moment windows attached, for a statement
 * written outside the write service's own update (a batch's): the statement
 * judges them holding the row, as a single change is judged.
 */
export function withPublicWindows<T extends Row>(
  values: T,
  writableWhen: Readonly<Record<string, WritableState>>,
  view: SnapshotView,
  table: ResolvedTable,
  zone: string,
): T {
  return attachWindows(values, publicWindows(writableWhen, view, table, zone));
}
