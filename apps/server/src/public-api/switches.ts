// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A yes/no in an app's settings row that switches part of its public side off
 * — online booking, new patients online, the kiosk — read from the source
 * database and trusted for fifteen seconds, so the key gate does not add a
 * source read to every request.
 *
 * A write through Adminium to the settings table drops what is trusted
 * (`forget`), so a switch thrown at the desk is thrown at once: before, a
 * kiosk switched off went on checking patients in for up to fifteen seconds,
 * and an order was taken ten seconds after "Taking online orders" went off.
 * The fifteen seconds remain for a row changed straight in the database.
 *
 * Fail-safe: no row, no column, a row that is off, or a read that fails
 * reads as OFF.
 *
 * The row is the settings row as every reader takes it: the first by key,
 * the one the Settings page edits (`crud/settings-row.ts`). It used to be
 * on only when every row was on; with a stray second row the owner then
 * switched the shop on and it stayed off, with nothing on the page to say
 * why. A create in the settings table is refused while it holds its row.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { settingsRow } from '../crud/settings-row.js';
import { sameValue } from '../crud/write-values.js';

/** How long a switch's answer is trusted. */
export const SWITCH_TTL_MS = 15_000;

export interface Switches {
  /** On: the settings row holds true — or, given `values`, one of those values (a choice: "nothing", "optional", "required"). */
  isOn(connectionId: string, table: string, column: string, values?: readonly string[]): Promise<boolean>;
  /** A row of `table` was written: its switches are read again on the next ask. A table is named by its id or its bare name. */
  forget(connectionId: string, table: string): void;
}

export function createSwitches(dbFor: (connectionId: string) => Promise<Kysely<SourceDatabase>>, now: () => number = () => Date.now()): Switches {
  const cache = new Map<string, { at: number; on: boolean }>();
  return {
    async isOn(connectionId, table, column, values) {
      const key = JSON.stringify([connectionId, table, column, ...(values === undefined ? [] : [[...values].sort()])]);
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < SWITCH_TTL_MS) return hit.on;
      let on = false;
      try {
        const db = await dbFor(connectionId);
        // The first row by key, not the first one a database happens to hand back.
        const row = await settingsRow(db, table, [column]);
        const v = row?.[column];
        on = row !== undefined && (values === undefined ? sameValue(true, v) : typeof v === 'string' && values.includes(v));
      } catch {
        on = false;
      }
      cache.set(key, { at: now(), on });
      return on;
    },
    forget(connectionId, table) {
      const bare = (name: string) => name.slice(name.lastIndexOf('.') + 1);
      for (const key of [...cache.keys()]) {
        const [owner, kept] = JSON.parse(key) as [string, string, ...unknown[]];
        if (owner === connectionId && (kept === table || bare(kept) === bare(table))) cache.delete(key);
      }
    },
  };
}
