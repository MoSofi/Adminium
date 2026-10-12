// SPDX-License-Identifier: AGPL-3.0-only
/**
 * automationSpellsRepo — adminium_automation_spells: for a rule that visits a
 * row "once per spell", the spell each row is in and whether it is still open.
 *
 * One tick calls {@link settle} with every row that matches now. A row not
 * held yet starts spell 1; a row held with its spell closed starts the next
 * spell; a row held open is only stamped. Every row held open that the tick
 * did not see has its spell closed (unless the tick could not read them all).
 * What `settle` answers are the rows whose spell STARTED: the rows to run.
 */

import type { MetaDb } from '../connect.js';
import { readBool, writeBool } from './util.js';

export interface SpellStart {
  rowKey: string;
  spell: number;
}

export function automationSpellsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * @param matching The keys of the rows that match at this tick.
     * @param complete False when the tick stopped at its cap: rows it did not reach may still match, so none is closed.
     */
    async settle(automationId: string, matching: readonly string[], opts: { at: number; complete: boolean }): Promise<SpellStart[]> {
      const held = await db.selectFrom('adminium_automation_spells').select(['rowKey', 'spell', 'open']).where('automationId', '=', automationId).execute();
      const byKey = new Map(held.map((row) => [row.rowKey, { spell: row.spell, open: readBool(row.open) }]));
      const seen = new Set(matching);
      const started: SpellStart[] = [];
      for (const rowKey of seen) {
        const row = byKey.get(rowKey);
        if (row === undefined) {
          await db.insertInto('adminium_automation_spells').values({ automationId, rowKey, spell: 1, open: writeBool(meta, true), lastTick: opts.at }).execute();
          started.push({ rowKey, spell: 1 });
        } else if (!row.open) {
          await db
            .updateTable('adminium_automation_spells')
            .set({ spell: row.spell + 1, open: writeBool(meta, true), lastTick: opts.at })
            .where('automationId', '=', automationId)
            .where('rowKey', '=', rowKey)
            .execute();
          started.push({ rowKey, spell: row.spell + 1 });
        }
      }
      // The rows still in their spell: one stamp for all of them.
      const still = [...seen].filter((rowKey) => byKey.get(rowKey)?.open === true);
      for (let i = 0; i < still.length; i += 500) {
        await db.updateTable('adminium_automation_spells').set({ lastTick: opts.at }).where('automationId', '=', automationId).where('rowKey', 'in', still.slice(i, i + 500)).execute();
      }
      if (opts.complete) {
        const ended = held.filter((row) => readBool(row.open) && !seen.has(row.rowKey)).map((row) => row.rowKey);
        for (let i = 0; i < ended.length; i += 500) {
          await db
            .updateTable('adminium_automation_spells')
            .set({ open: writeBool(meta, false) })
            .where('automationId', '=', automationId)
            .where('rowKey', 'in', ended.slice(i, i + 500))
            .execute();
        }
      }
      return started;
    },

    /** A start that did not become a run (the run's key was taken, the queue refused it): the spell is as it was before the tick. */
    async undoStart(automationId: string, start: SpellStart): Promise<void> {
      if (start.spell === 1) {
        await db.deleteFrom('adminium_automation_spells').where('automationId', '=', automationId).where('rowKey', '=', start.rowKey).execute();
        return;
      }
      await db
        .updateTable('adminium_automation_spells')
        .set({ spell: start.spell - 1, open: writeBool(meta, false) })
        .where('automationId', '=', automationId)
        .where('rowKey', '=', start.rowKey)
        .execute();
    },

    async listFor(automationId: string): Promise<{ rowKey: string; spell: number; open: boolean; lastTick: number }[]> {
      const rows = await db.selectFrom('adminium_automation_spells').selectAll().where('automationId', '=', automationId).orderBy('rowKey', 'asc').execute();
      return rows.map((row) => ({ rowKey: row.rowKey, spell: row.spell, open: readBool(row.open), lastTick: row.lastTick }));
    },

    /** Forget every spell of a rule: its conditions changed, so "matching again" means something else now. */
    async clear(automationId: string): Promise<void> {
      await db.deleteFrom('adminium_automation_spells').where('automationId', '=', automationId).execute();
    },
  };
}
