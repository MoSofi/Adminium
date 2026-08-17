// SPDX-License-Identifier: AGPL-3.0-only
/**
 * filesRepo — adminium_files (07-meta-store.md §3.27): one row per stored
 * artifact (export bundles, import uploads, error reports, branding assets…).
 *
 * The repo owns ROWS only — bytes live wherever `storage`/`storage_key` say
 * (v1: `local` under `<dataDir>/files/<id>`, apps/server/src/files/storage.ts).
 * Deletion is soft (`deleted_at`) so a GC pass can remove bytes first and rows
 * second without ever leaving a row that points at nothing.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { fileKindSchema, recordRefSchema, type RecordRef } from '../schema/json-payloads.js';
import type { AdminiumFilesTable } from '../schema/tables.js';
import { affected, packJson, readJsonOrNull } from './util.js';

export type FileKind = 'upload' | 'export' | 'import' | 'branding' | 'schema' | 'archive';

export interface StoredFile {
  id: string;
  /** v1: always `local`. */
  storage: string;
  storageKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  kind: FileKind;
  entity: RecordRef | null;
  uploadedBy: string | null;
  createdAt: number;
  deletedAt: number | null;
}

export interface CreateFileInput {
  /** Storage backend key; defaults to the row id (local layout). */
  storageKey?: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  kind: FileKind;
  entity?: RecordRef | null;
  uploadedBy?: string | null;
  /** Pre-minted id (lets the storage layer write bytes under the final id first). */
  id?: string;
}

function decode(row: Selectable<AdminiumFilesTable>): StoredFile {
  return {
    id: row.id,
    storage: row.storage,
    storageKey: row.storageKey,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: Number(row.sizeBytes),
    sha256: row.sha256,
    kind: fileKindSchema.parse(row.kind),
    entity: readJsonOrNull<RecordRef>(row.entity),
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

export function filesRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<StoredFile | null> {
    const row = await db.selectFrom('adminium_files').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    async create(input: CreateFileInput, at: number = Date.now()): Promise<StoredFile> {
      const id = input.id ?? newId('file');
      const entity = input.entity == null ? null : recordRefSchema.parse(input.entity);
      const row = {
        id,
        storage: 'local',
        storageKey: input.storageKey ?? id,
        filename: input.filename,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        kind: fileKindSchema.parse(input.kind),
        entity: entity === null ? null : packJson(entity),
        uploadedBy: input.uploadedBy ?? null,
        createdAt: at,
        deletedAt: null,
      };
      await db.insertInto('adminium_files').values(row).execute();
      return decode(row as Selectable<AdminiumFilesTable>);
    },

    /** Soft delete — bytes are removed by the storage GC, rows stay addressable. */
    async markDeleted(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_files')
        .set({ deletedAt: at })
        .where('id', '=', id)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Rows already soft-deleted before `cutoff` — the storage GC's worklist. */
    async listDeletedBefore(cutoff: number, limit = 100): Promise<StoredFile[]> {
      const rows = await db
        .selectFrom('adminium_files')
        .selectAll()
        .where('deletedAt', 'is not', null)
        .where('deletedAt', '<', cutoff)
        .orderBy('deletedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /** Hard-delete a row (call only after the bytes are gone). */
    async purge(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_files').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },
  };
}

export type FilesRepo = ReturnType<typeof filesRepo>;
