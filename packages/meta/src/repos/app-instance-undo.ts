// SPDX-License-Identifier: AGPL-3.0-only
/**
 * appInstanceUndoRepo — adminium_app_instance_undo (0079): each value an
 * app's deployment-wide part wrote, with what was there before it.
 *
 * `before` is kept from the FIRST write: an update writes over the value again
 * and records only what it wrote now, so an undo still lands on what this
 * server had before any version of the app. `before` null means nothing was
 * set (no setting row, no word, no email row, no language row). When several
 * apps write one value, their records lie in a stack by `updatedAt` (when
 * each last wrote it), each `before` what lies under it; the caller keeps the
 * stack in order ({@link appInstanceUndoRepo.setBefore}), and only a write
 * (`put`) moves a record's `updatedAt`.
 *
 * Every method takes the store it is handed, so the install passes its own
 * transaction (`{ db: trx, dialect }`) and the values and their undo commit
 * together.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { APP_INSTANCE_UNDO_ITEM_WIDTH, APP_INSTANCE_UNDO_KIND_WIDTH } from '../migrations/0079_app_instance_undo.js';
import type { AdminiumAppInstanceUndoTable } from '../schema/tables.js';
import { packJson, readJson, readJsonOrNull } from './util.js';

export const APP_INSTANCE_VALUE_KINDS = ['setting', 'word', 'email', 'locale'] as const;
export type AppInstanceValueKind = (typeof APP_INSTANCE_VALUE_KINDS)[number];

/** A value that was there, or none. */
export type HeldValue = { value: unknown } | null;

export interface AppInstanceValue {
  id: string;
  manifestId: string;
  kind: AppInstanceValueKind;
  item: string;
  /** As it was before the first install wrote it; null when nothing was set. */
  before: HeldValue;
  /** As the install last wrote it. */
  applied: unknown;
  createdAt: number;
  updatedAt: number;
}

function decode(row: Selectable<AdminiumAppInstanceUndoTable>): AppInstanceValue {
  const before = readJsonOrNull<{ v?: unknown }>(row.before);
  return {
    id: row.id,
    manifestId: row.manifestId,
    kind: row.kind as AppInstanceValueKind,
    item: row.item,
    before: before === null ? null : { value: before.v ?? null },
    applied: readJson<{ v?: unknown }>(row.applied).v ?? null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function fits(kind: string, item: string): void {
  if (kind.length > APP_INSTANCE_UNDO_KIND_WIDTH || item.length > APP_INSTANCE_UNDO_ITEM_WIDTH) {
    throw new Error(`An instance value "${item.slice(0, 20)}…" is longer than its column.`);
  }
}

export function appInstanceUndoRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Every value one install wrote, by kind and item. */
    async list(manifestId: string): Promise<AppInstanceValue[]> {
      const rows = await db.selectFrom('adminium_app_instance_undo').selectAll().where('manifestId', '=', manifestId).orderBy('kind', 'asc').orderBy('item', 'asc').execute();
      return rows.map(decode);
    },

    /**
     * Records a value the install wrote. The first record keeps `before`;
     * a later one (an update) only says what was written now.
     */
    async put(input: { manifestId: string; kind: AppInstanceValueKind; item: string; before: HeldValue; applied: unknown }, at: number = Date.now()): Promise<void> {
      fits(input.kind, input.item);
      const applied = packJson({ v: input.applied ?? null });
      const res = await db
        .updateTable('adminium_app_instance_undo')
        .set({ applied, updatedAt: at })
        .where('manifestId', '=', input.manifestId)
        .where('kind', '=', input.kind)
        .where('item', '=', input.item)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) > 0) return;
      await db
        .insertInto('adminium_app_instance_undo')
        .values({
          id: newId('aiu'),
          manifestId: input.manifestId,
          kind: input.kind,
          item: input.item,
          before: input.before === null ? null : packJson({ v: input.before.value ?? null }),
          applied,
          createdAt: at,
          updatedAt: at,
        })
        .execute();
    },

    /**
     * Every install's record of one value, oldest first: two apps may write
     * the same setting, and an undo of one asks what the other wrote after it.
     */
    async listForItem(kind: AppInstanceValueKind, item: string): Promise<AppInstanceValue[]> {
      const rows = await db.selectFrom('adminium_app_instance_undo').selectAll().where('kind', '=', kind).where('item', '=', item).orderBy('createdAt', 'asc').orderBy('id', 'asc').execute();
      return rows.map(decode);
    },

    /**
     * What a record puts back: the record under it went or moved, so this one
     * now lies on what that one lay on. Leaves `updatedAt`, the record's place
     * in its value's stack.
     */
    async setBefore(id: string, before: HeldValue): Promise<void> {
      await db
        .updateTable('adminium_app_instance_undo')
        .set({ before: before === null ? null : packJson({ v: before.value ?? null }) })
        .where('id', '=', id)
        .execute();
    },

    /** The value is back as it was (or somebody's own now): nothing is left to undo. */
    async remove(manifestId: string, kind: AppInstanceValueKind, item: string): Promise<void> {
      await db.deleteFrom('adminium_app_instance_undo').where('manifestId', '=', manifestId).where('kind', '=', kind).where('item', '=', item).execute();
    },
  };
}
