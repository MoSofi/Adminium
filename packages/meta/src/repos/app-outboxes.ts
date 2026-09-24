// SPDX-License-Identifier: AGPL-3.0-only
/**
 * appOutboxesRepo — one row per installed app that declares an outbox
 * (migration `0042_clinic_platform`).
 *
 * The definition is stored as TEXT with its table names already real, so the
 * sender and the producers read exactly what the install wrote, byte for
 * byte, on every store (a JSON column comes back reordered on some).
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumAppOutboxesTable } from '../schema/tables.js';

export type AppOutboxRow = Selectable<AdminiumAppOutboxesTable>;

export interface PutAppOutboxInput {
  appKey: string;
  manifestId: string;
  connectionId: string;
  /** The definition, already serialized. */
  definition: string;
}

export function appOutboxesRepo(meta: MetaDb) {
  const { db } = meta;

  async function findByApp(appKey: string): Promise<AppOutboxRow | null> {
    const row = await db.selectFrom('adminium_app_outboxes').selectAll().where('appKey', '=', appKey).executeTakeFirst();
    return row ?? null;
  }

  return {
    findByApp,

    /**
     * Install and update write the same way: the app's row replaced in place
     * (UPDATE first, INSERT on none — no cross-dialect upsert). When it last
     * scanned is kept: an update does not make a reminder due twice.
     */
    async put(input: PutAppOutboxInput, at: number = Date.now()): Promise<AppOutboxRow> {
      const res = await db
        .updateTable('adminium_app_outboxes')
        .set({ manifestId: input.manifestId, connectionId: input.connectionId, definition: input.definition, updatedAt: at })
        .where('appKey', '=', input.appKey)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        await db
          .insertInto('adminium_app_outboxes')
          .values({ id: newId('aob'), ...input, scannedAt: null, createdAt: at, updatedAt: at })
          .execute();
      }
      const row = await findByApp(input.appKey);
      if (row === null) throw new Error(`app outbox write lost its row: ${input.appKey}`);
      return row;
    },

    async list(): Promise<AppOutboxRow[]> {
      return await db.selectFrom('adminium_app_outboxes').selectAll().orderBy('appKey').execute();
    },

    /** Uninstall, or an update whose manifest no longer declares one. */
    async remove(appKey: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_app_outboxes').where('appKey', '=', appKey).executeTakeFirst();
      return Number(res.numDeletedRows) === 1;
    },

    /** The reminder scanner finished a pass. */
    async markScanned(appKey: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_app_outboxes').set({ scannedAt: at }).where('appKey', '=', appKey).execute();
    },
  };
}

export type AppOutboxesRepo = ReturnType<typeof appOutboxesRepo>;
