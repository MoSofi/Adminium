// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A yes/no in an app's settings row that switches part of its public side off
 * — online booking, new patients online, the kiosk — read from the source
 * database and trusted for fifteen seconds, so the key gate does not add a
 * source read to every request.
 *
 * Fail-safe: no row, no column, a row that is off, or a read that fails
 * reads as OFF.
 */
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { sameValue } from '../crud/write-values.js';

/** How long a switch's answer is trusted. */
export const SWITCH_TTL_MS = 15_000;

export interface Switches {
  isOn(connectionId: string, table: string, column: string): Promise<boolean>;
}

export function createSwitches(dbFor: (connectionId: string) => Promise<Kysely<SourceDatabase>>, now: () => number = () => Date.now()): Switches {
  const cache = new Map<string, { at: number; on: boolean }>();
  return {
    async isOn(connectionId, table, column) {
      const key = JSON.stringify([connectionId, table, column]);
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < SWITCH_TTL_MS) return hit.on;
      let on = false;
      try {
        const db = await dbFor(connectionId);
        // Every row, not the first one a database happens to hand back: on only
        // when there is a row and none is off.
        const rows = (await db.selectFrom(table as never).select(sql.ref(column).as('v')).limit(50).execute()) as { v?: unknown }[];
        on = rows.length > 0 && rows.every((row) => sameValue(true, row.v));
      } catch {
        on = false;
      }
      cache.set(key, { at: now(), on });
      return on;
    },
  };
}
