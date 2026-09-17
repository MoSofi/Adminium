// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0034 — `adminium_project_files`: what this instance last applied from a
 * project folder.
 *
 * A project keeps its pages and schema customizations as files
 * (`pages/<slug>.json`, `schema/<database>.json`). The files and the database
 * can each change on their own: a developer edits a file and deploys, and
 * somebody edits the same page in Studio on the server. One row per file
 * records the hash of the version last applied (or written), so a later start
 * can tell which side moved.
 *
 * - `hash` is that version's hash. An empty string means no version was ever
 *   agreed on: the file and the page already differed when the server first
 *   saw both.
 * - `server_edited_at` is when this server first noticed that its copy no
 *   longer matched `hash`, and `server_hash` is the hash of its copy at that
 *   time (`deleted` when the page was removed here). Both are NULL while the
 *   two agree.
 *
 * `path` is the file's path inside the project, always with `/`. The longest
 * one today is a 48-character database key under `schema/`, so 200 leaves
 * room without making the key expensive to index on MySQL.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('project_files'))
    .ifNotExists()
    .addColumn('path', c.str(200), (col) => col.primaryKey())
    .addColumn('hash', c.str(80), (col) => col.notNull())
    .addColumn('applied_at', c.ts, (col) => col.notNull())
    .addColumn('server_edited_at', c.ts)
    .addColumn('server_hash', c.str(80))
    .execute();
}
