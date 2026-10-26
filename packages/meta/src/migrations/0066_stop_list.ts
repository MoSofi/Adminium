// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0066 — the stop list (the "do-not-email list").
 *
 * One row per stopped address, for the whole install: no marketing mail of
 * any app reaches it. The address is found by its keyed hash (`address_hash`
 * under `key_version`, from `adminium_address_keys`, 0065), unique together,
 * so the same address in two cases or with spaces around it is one row.
 *
 * The do-not-email page shows addresses, so each row also keeps the address
 * encrypted (`enc:v1:` under the server's secret). That copy is what lets a
 * new key version re-hash the list. An erased person's row keeps the hash
 * alone (`address_encrypted` empty, `erased_at` set): the objection outlives
 * the person, and the hash still matches, since the address keys never
 * change with the server's secret.
 *
 * Why (`reason`): `link`, `spam`, `bounce`, `hand`, `relay-unsubscribe`,
 * `old-mark`, `lead-finder`, `erased`. Where from (`origin`): the relay's,
 * the campaign's or the app's name, as the reason needs. Who added it: a
 * staff member, or nobody for an event from outside.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** A keyed hash: HMAC-SHA256 as hex. */
const ADDRESS_HASH_LENGTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('stop_list'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('address_hash', c.str(ADDRESS_HASH_LENGTH), (col) => col.notNull())
    .addColumn('key_version', c.int, (col) => col.notNull())
    // The address as the page shows it, encrypted; empty once its person is erased.
    .addColumn('address_encrypted', c.text)
    .addColumn('reason', c.str(20), (col) => col.notNull())
    .addColumn('origin', c.str(255))
    .addColumn('added_at', c.ts, (col) => col.notNull())
    .addColumn('added_by_id', c.id)
    .addColumn('added_by_label', c.str(255))
    .addColumn('erased_at', c.ts)
    .execute();
  // One row per address under a key version: the second add of an address is the same row.
  await db.schema
    .createIndex('uq_adminium_stop_list_address')
    .on(metaTable('stop_list'))
    .columns(['address_hash', 'key_version'])
    .unique()
    .execute();
  // The page lists newest first.
  await db.schema.createIndex('ix_adminium_stop_list_added').on(metaTable('stop_list')).columns(['added_at', 'id']).execute();
}
