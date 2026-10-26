// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0070 — a person's data, downloaded (an access request).
 *
 * One row per "Download everything": who asked for it, the person it is
 * about, where it stands, and the .zip once it is written. The person is
 * kept as the keyed hash of their address (`address_hash` under
 * `key_version`, from `adminium_address_keys`, 0065), never the address: the
 * row says whose data the file holds without holding the address itself,
 * and an erasure finds the person's own downloads by the same hash.
 *
 * `status`: `processing`, then `ready` (the file is written) or `failed`;
 * `expired` once its file is gone. `counts` is `{ <source>: <rows> }`.
 * The file goes with its row's expiry (`retention.exportsDays`), and the row
 * with the person who asked for it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** A keyed hash: HMAC-SHA256 as hex. */
const ADDRESS_HASH_LENGTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('privacy_exports'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('requested_by', c.id, (col) => col.notNull())
    .addColumn('address_hash', c.str(ADDRESS_HASH_LENGTH), (col) => col.notNull())
    .addColumn('key_version', c.int, (col) => col.notNull())
    .addColumn('status', c.str(16), (col) => col.notNull())
    .addColumn('file_id', c.id)
    .addColumn('counts', c.json)
    .addColumn('error', c.str(500))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('completed_at', c.ts)
    .addColumn('expires_at', c.ts)
    .addForeignKeyConstraint('fk_adminium_privacy_exports_requested_by', ['requested_by'], metaTable('users'), ['id'], (cb) => cb.onDelete('cascade'))
    .addForeignKeyConstraint('fk_adminium_privacy_exports_file_id', ['file_id'], metaTable('files'), ['id'], (cb) => cb.onDelete('set null'))
    .execute();
  // A person's own downloads, newest first.
  await db.schema
    .createIndex('ix_adminium_privacy_exports_requested')
    .on(metaTable('privacy_exports'))
    .columns(['requested_by', 'created_at'])
    .execute();
  // Every download about one person (an erasure removes them).
  await db.schema
    .createIndex('ix_adminium_privacy_exports_address')
    .on(metaTable('privacy_exports'))
    .columns(['address_hash', 'key_version'])
    .execute();
  // The sweep: what has expired.
  await db.schema
    .createIndex('ix_adminium_privacy_exports_expires')
    .on(metaTable('privacy_exports'))
    .columns(['expires_at'])
    .execute();
}
