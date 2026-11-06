// SPDX-License-Identifier: AGPL-3.0-only
/**
 * appPartsRepo — adminium_app_parts (0077): the rows an install made of the
 * parts its file carries (a report document, an invoice layout, a scheduled
 * report), each with a fingerprint of what was written.
 *
 * The made rows live in their own tables, which have no owner column; this is
 * how an update finds the row it made before, and an uninstall the rows to
 * take back.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { APP_PART_KEY_WIDTH, APP_PART_KIND_WIDTH } from '../migrations/0077_app_parts.js';
import type { AdminiumAppPartsTable } from '../schema/tables.js';
import { isDuplicateKeyError } from './util.js';

export const APP_PART_KINDS = ['report', 'invoice-layout', 'scheduled-report'] as const;
export type AppPartKind = (typeof APP_PART_KINDS)[number];

export interface AppPart {
  id: string;
  manifestId: string;
  kind: AppPartKind;
  partKey: string;
  targetId: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

function decode(row: Selectable<AdminiumAppPartsTable>): AppPart {
  return {
    id: row.id,
    manifestId: row.manifestId,
    kind: row.kind as AppPartKind,
    partKey: row.partKey,
    targetId: row.targetId,
    contentHash: row.contentHash,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function appPartsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Every row one install made, of one kind or all. */
    async list(manifestId: string, kind?: AppPartKind): Promise<AppPart[]> {
      let query = db.selectFrom('adminium_app_parts').selectAll().where('manifestId', '=', manifestId);
      if (kind !== undefined) query = query.where('kind', '=', kind);
      const rows = await query.orderBy('kind', 'asc').orderBy('partKey', 'asc').execute();
      return rows.map(decode);
    },

    /** Records the row an entry made, or what it now holds: one record per entry of an install. */
    async put(input: { manifestId: string; kind: AppPartKind; partKey: string; targetId: string; contentHash: string }, at: number = Date.now()): Promise<void> {
      if (input.kind.length > APP_PART_KIND_WIDTH || input.partKey.length > APP_PART_KEY_WIDTH) throw new Error('An app part key is longer than its column.');
      const set = { targetId: input.targetId, contentHash: input.contentHash, updatedAt: at };
      const res = await db
        .updateTable('adminium_app_parts')
        .set(set)
        .where('manifestId', '=', input.manifestId)
        .where('kind', '=', input.kind)
        .where('partKey', '=', input.partKey)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) > 0) return;
      try {
        await db
          .insertInto('adminium_app_parts')
          .values({ id: newId('apt'), manifestId: input.manifestId, kind: input.kind, partKey: input.partKey, createdAt: at, ...set })
          .execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await db.updateTable('adminium_app_parts').set(set).where('manifestId', '=', input.manifestId).where('kind', '=', input.kind).where('partKey', '=', input.partKey).execute();
      }
    },

    async remove(id: string): Promise<void> {
      await db.deleteFrom('adminium_app_parts').where('id', '=', id).execute();
    },
  };
}

export type AppPartsRepo = ReturnType<typeof appPartsRepo>;
