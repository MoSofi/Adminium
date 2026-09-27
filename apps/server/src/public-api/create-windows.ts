// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CHILD'S CREATE INSIDE ITS PARENT'S WINDOW.
 *
 * An extra is added to a stay only until the arrival day's check-in time: the
 * entry that adds it (`visibleWith` the stay) carries a window keyed by its
 * link to the stay (`writable_when {stay_id: {before: {column: 'arrive',
 * time: …}}}`), read from the stay the new row names — the same window a
 * change of the extra is judged by. Judged inside the create's own
 * transaction, on the parent as that transaction reads it (a parent whose
 * totals the new row climbs into is already held by it), on the server's
 * clock. Outside it: refused as too late (or too early), and nothing is made.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { momentSettings } from '../crud/moments.js';
import { judgeWindow } from '../crud/state-conditions.js';
import { publicWindows } from './moment-windows.js';
import type { WritableState } from './relative-filters.js';

export async function judgeCreateWindows(input: {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  table: ResolvedTable;
  writableWhen: Readonly<Record<string, WritableState>> | undefined;
  row: Row;
  zone: string;
  now?: Date;
}): Promise<void> {
  const { db, table, row } = input;
  // Only the windows read through a link: a create has no stored row of its own to be early or late by.
  const windows = publicWindows(input.writableWhen ?? {}, input.view, table, input.zone).filter((window) => window.link !== undefined || window.unresolved === true);
  for (const window of windows) {
    const linked = new Map<string, Row | null>();
    if (window.link !== undefined) {
      const key = row[window.link.via];
      const parent =
        key === null || key === undefined
          ? null
          : (((await db.selectFrom(window.link.table).selectAll().where(db.dynamic.ref(window.link.key), '=', key as never).executeTakeFirst()) as Row | undefined) ?? null);
      linked.set(window.link.via, parent);
    }
    await judgeWindow(window, { moments: { table, row, linked, zone: window.zone ?? input.zone, settings: momentSettings(db), db }, now: input.now ?? new Date() });
  }
}
