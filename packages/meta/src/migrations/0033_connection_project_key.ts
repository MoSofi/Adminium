// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0033 — `adminium_connections.project_key`: the name a project folder
 * gives this database.
 *
 * A project's `adminium.config.ts` lists its databases under keys such as
 * `main`, and the project's files refer to those keys, never to connection
 * ids, because ids differ on every install. This column ties a connection row
 * to its key. NULL means the connection was added some other way (Studio, the
 * setup wizard, ADMINIUM_SOURCE_URL) and belongs to no project.
 *
 * 48 characters, the longest key the config accepts. The index is unique so a
 * key can never name two connections; NULLs do not collide on any of the three
 * engines.
 *
 * No backfill: no connection predating this wave came from a project.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('connections'))
    .addColumn('project_key', c.str(48))
    .execute();
  await db.schema
    .createIndex('uq_adminium_connections_project_key')
    .on(metaTable('connections'))
    .column('project_key')
    .unique()
    .execute();
}
