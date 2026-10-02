// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0049 — `adminium_project_apps`: what this instance last applied of an
 * app its project folder carries.
 *
 * A project can hold an app under `apps/<key>/`. The server installs it from
 * there and applies it again whenever its manifest changes. One row per app
 * records where that stands:
 *
 * - `applied_hash` is the hash of the manifest last applied in full. The row
 *   in `adminium_manifests` keeps the document itself, but a document read
 *   back from a JSON column is not byte for byte what was written (jsonb and
 *   MySQL's json both reorder keys), so it cannot be hashed again to ask "is
 *   this the one".
 * - `failure` is why the newest manifest was NOT applied, with its hash: the
 *   app keeps running as it was, the reason is shown, and the same manifest is
 *   not tried again until the folder changes.
 * - `removals` is a question waiting for a person: tables or columns the
 *   manifest no longer declares that hold data, with the hash of the manifest
 *   that dropped them. Nothing is dropped until it is answered.
 * - `declined_hash` is the manifest for which the answer was "keep the data",
 *   so the same manifest does not ask again.
 *
 * `app_key` is an app's key: at most 80 characters, the store's own grammar.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('project_apps'))
    .ifNotExists()
    .addColumn('app_key', c.str(80), (col) => col.primaryKey())
    .addColumn('applied_hash', c.str(80))
    .addColumn('applied_at', c.ts)
    .addColumn('failure', c.json)
    .addColumn('removals', c.json)
    .addColumn('declined_hash', c.str(80))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
}
