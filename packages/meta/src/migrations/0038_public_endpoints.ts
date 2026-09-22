// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0038 — public endpoints, derived scopes, server keys, request counts.
 *
 * A publishable key used to bind to one hand-written scope document.
 * Now an operator picks ENDPOINTS and methods for a key, and the server writes
 * the scope document for it. This wave adds what that needs, and nothing it
 * does is destructive: every table is new, and every column added to an
 * existing table is nullable or has a default.
 *
 * ─── `adminium_public_endpoints` ──────────────────────────────────────────
 * One row per endpoint an operator saved, or a key was granted, per
 * connection. An endpoint nobody has touched is VIRTUAL: it is computed from the
 * schema and never stored, so this table holds only decisions someone made.
 *
 * `definition` is TEXT, not `json`. The builder shows the stored definition
 * itself, as the authorization document the operator is reading. `jsonb`
 * (Postgres) and MySQL's `json` both reorder an object's keys, so the document
 * would come back rearranged from what was saved, and on two stores out of three
 * a byte comparison of "saved" and "shown" would never hold.
 *
 * `ref` is the URL segment, unique per connection.
 *
 * ─── `adminium_public_scopes.derived_for_key` ─────────────────────────────
 * The scope a key's grants were compiled into. It carries NO foreign key, on
 * purpose. `adminium_public_keys.scope_id` already points the other
 * way, NOT NULL and RESTRICT. A second FK back would be a cycle:
 *
 *  - neither row could be inserted first;
 *  - `relocate.ts` copies tables in one fixed order with no constraint
 *    juggling, and would fail on every dialect;
 *  - SQLite cannot add a named constraint to an existing table, and MySQL
 *    silently drops an inline `REFERENCES`.
 *
 * The UNIQUE index gives one derived scope per key. All three engines admit
 * repeated NULLs under a unique index, which is what every hand-written scope
 * holds. The repo that deletes a key deletes what hangs off it.
 *
 * ─── `adminium_public_keys.access`, `.kind` ────────────────────────────────
 * `access` is the key's grant, `{ endpointId: Method[] }`. It is NULL for a key
 * bound to a hand-written scope, which keeps working unchanged.
 *
 * `kind` is `browser` (today's `adm_pub_`) or `server` (`adm_srv_`, stored hash
 * only). It defaults to `browser`, which is correct for every row that exists.
 *
 * ─── `adminium_public_request_stats` ──────────────────────────────────────
 * Hourly request counts per key and ref, for the keys page's "Requests · 24h".
 *
 * - Keyed by REF, not endpoint id. A request knows its ref, and hand-written
 *   resources have refs but no endpoint rows.
 * - No foreign key to the key. Counts are flushed from memory up to a minute
 *   after the request, and a key deleted in between must not fail the whole
 *   flush. The repo that deletes a key deletes its counts.
 * - The `bucket` index serves the retention sweep.
 *
 * ─── `adminium_public_api_state` ──────────────────────────────────────────
 * One row, `id = 'public'`, holding a REVISION that every change to keys,
 * scopes or endpoints advances. It is used two ways:
 *
 * - An endpoint save commits by compare-and-set on it, so two saves that
 *   regenerate the same key cannot both win on stale reads.
 * - Every server process's 5 s gate refresh reads it, so a change made on one
 *   process reaches the others' caches within seconds, not 30.
 *
 * The migration creates no row: a relocation target must be empty, and
 * migrations here write schema only. The repo creates the row on first write.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('public_endpoints'))
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('ref', c.str(64), (col) => col.notNull())
    /** `generated` (from the schema, then saved) | `custom`. */
    .addColumn('origin', c.str(16), (col) => col.notNull())
    .addColumn('definition', c.text, (col) => col.notNull())
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_public_endpoints_connection',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_public_endpoints_created_by',
      ['created_by'],
      metaTable('users'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('uq_adminium_public_endpoints_connection_ref')
    .on(metaTable('public_endpoints'))
    .columns(['connection_id', 'ref'])
    .unique()
    .execute();

  // One ALTER per column: SQLite takes exactly one ADD COLUMN per statement.
  await db.schema.alterTable(metaTable('public_keys')).addColumn('access', c.json).execute();
  await db.schema
    .alterTable(metaTable('public_keys'))
    .addColumn('kind', c.str(16), (col) => col.notNull().defaultTo('browser'))
    .execute();

  await db.schema.alterTable(metaTable('public_scopes')).addColumn('derived_for_key', c.id).execute();
  await db.schema
    .createIndex('uq_adminium_public_scopes_derived_for_key')
    .on(metaTable('public_scopes'))
    .columns(['derived_for_key'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('public_request_stats'))
    .addColumn('key_id', c.id, (col) => col.notNull())
    .addColumn('ref', c.str(64), (col) => col.notNull())
    /** Start of the hour, epoch ms. */
    .addColumn('bucket', c.ts, (col) => col.notNull())
    .addColumn('requests', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('errors', c.int, (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('pk_adminium_public_request_stats', ['key_id', 'ref', 'bucket'])
    .execute();

  await db.schema
    .createIndex('ix_adminium_public_request_stats_bucket')
    .on(metaTable('public_request_stats'))
    .columns(['bucket'])
    .execute();

  await db.schema
    .createTable(metaTable('public_api_state'))
    .addColumn('id', c.str(16), (col) => col.primaryKey())
    .addColumn('revision', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
}
