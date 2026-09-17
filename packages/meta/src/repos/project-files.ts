// SPDX-License-Identifier: AGPL-3.0-only
/**
 * projectFilesRepo — adminium_project_files (wave 0034).
 *
 * One row per project file (`pages/<slug>.json`, `schema/<database>.json`):
 * the hash of the version this instance last applied or wrote, and whether
 * the instance's own copy has moved away from it since. The server decides
 * what the hashes mean; this repo only stores them.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import type { AdminiumProjectFilesTable } from '../schema/tables.js';
import { MetaValidationError } from './util.js';

/** `server_hash` when the page or schema was removed on this server. */
export const PROJECT_FILE_DELETED = 'deleted';

/** A file path inside a project: relative, `/`-separated, no `..`. */
const PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export interface ProjectFileRow {
  path: string;
  /** Hash of the version last applied or written; `''` when none was agreed on. */
  hash: string;
  appliedAt: number;
  /** When this server first noticed its copy differs from `hash`. */
  serverEditedAt: number | null;
  /** Hash of this server's copy at that time, or {@link PROJECT_FILE_DELETED}. */
  serverHash: string | null;
}

function checkPath(path: string): void {
  if (path.length === 0 || path.length > 200 || !PATH_PATTERN.test(path) || path.split('/').includes('..')) {
    throw new MetaValidationError(`invalid project file path ${JSON.stringify(path)}`);
  }
}

function checkHash(hash: string, column: string): void {
  if (hash.length > 80) {
    throw new MetaValidationError(`${column} is longer than 80 characters`);
  }
}

function decode(row: Selectable<AdminiumProjectFilesTable>): ProjectFileRow {
  return {
    path: row.path,
    hash: row.hash,
    appliedAt: Number(row.appliedAt),
    serverEditedAt: row.serverEditedAt === null ? null : Number(row.serverEditedAt),
    serverHash: row.serverHash,
  };
}

export function projectFilesRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    async list(): Promise<ProjectFileRow[]> {
      const rows = await db.selectFrom('adminium_project_files').selectAll().orderBy('path', 'asc').execute();
      return rows.map(decode);
    },

    async find(path: string): Promise<ProjectFileRow | null> {
      const row = await db
        .selectFrom('adminium_project_files')
        .selectAll()
        .where('path', '=', path)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /**
     * The file and this instance agree on `hash`: store it and clear any
     * server-edit flag.
     */
    async record(path: string, hash: string, at: number = Date.now()): Promise<void> {
      checkPath(path);
      checkHash(hash, 'hash');
      const values = { hash, appliedAt: at, serverEditedAt: null, serverHash: null };
      const updated = await db
        .updateTable('adminium_project_files')
        .set(values)
        .where('path', '=', path)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 0) {
        await db.insertInto('adminium_project_files').values({ path, ...values }).execute();
      }
    },

    /**
     * This instance's copy no longer matches the recorded version. Keeps the
     * first time that was noticed; `serverHash` is always the latest copy.
     * A path with no row gets one with an empty `hash`: nothing was agreed on.
     */
    async flagServerEdit(path: string, serverHash: string, at: number = Date.now()): Promise<void> {
      checkPath(path);
      checkHash(serverHash, 'serverHash');
      const existing = await this.find(path);
      if (existing === null) {
        await db
          .insertInto('adminium_project_files')
          .values({ path, hash: '', appliedAt: at, serverEditedAt: at, serverHash })
          .execute();
        return;
      }
      await db
        .updateTable('adminium_project_files')
        .set({ serverEditedAt: existing.serverEditedAt ?? at, serverHash })
        .where('path', '=', path)
        .execute();
    },

    /** The copies agree again, without a new version being applied. */
    async clearServerEdit(path: string): Promise<void> {
      await db
        .updateTable('adminium_project_files')
        .set({ serverEditedAt: null, serverHash: null })
        .where('path', '=', path)
        .execute();
    },

    async remove(path: string): Promise<boolean> {
      const result = await db.deleteFrom('adminium_project_files').where('path', '=', path).executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },
  };
}

export type ProjectFilesRepo = ReturnType<typeof projectFilesRepo>;
