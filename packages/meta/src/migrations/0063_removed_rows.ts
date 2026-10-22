// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0063 — the rows a table keeps of its removed rows.
 *
 * A table that says `removal: { history: true }` keeps a removed row readable
 * through a row it linked to that the reader reads now (a deal's removed
 * member, a job's cancelled visit). The row itself is gone from the shop's
 * database, so this store keeps the facts of its removal: when, by whom, why,
 * and the row as it was, masked as the audit log keeps it (no personal data,
 * no code). Its earlier changes stay in the audit log, read by the same keys
 * (`entity_table`, `entity_id`, as `0016_audit_entity` derives them).
 *
 * ─── One row per removal and link ──────────────────────────────────────────
 * A removed row is found by the row it linked to: one row here for each link
 * column of the removed row that named a row (`via`, `parent_table`,
 * `parent_value`), so a member removed from a deal is listed under the deal,
 * and a visit under its deal and its job alike. A link that named nothing
 * keeps no row; a removed row with no link at all is kept for nobody.
 *
 * ─── Taken off again ───────────────────────────────────────────────────────
 * An undo that brings the row back deletes its rows here. The nightly
 * retention sweep deletes them with the audit entries they sit beside
 * (`retention.auditLogDays`, and not while `retention.auditArchive` is on).
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** As long as the audit log's entity keys (`AUDIT_ENTITY_KEY_MAX`). */
const KEY = 200;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('removed_rows'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    // The removed row, by the audit log's keys: its table's snapshot id and its key as `pkLabel` writes it.
    .addColumn('entity_table', c.str(KEY), (col) => col.notNull())
    .addColumn('entity_id', c.str(KEY), (col) => col.notNull())
    // The key itself, column by column (JSON), as a reply names the row.
    .addColumn('pk', c.text, (col) => col.notNull())
    // The link column of the removed row, the table it points at, and the value it held.
    .addColumn('via', c.str(KEY), (col) => col.notNull())
    .addColumn('parent_table', c.str(KEY), (col) => col.notNull())
    .addColumn('parent_value', c.str(KEY), (col) => col.notNull())
    .addColumn('removed_at', c.ts, (col) => col.notNull())
    .addColumn('actor_kind', c.str(20), (col) => col.notNull())
    .addColumn('actor_id', c.str(255))
    .addColumn('actor_label', c.str(255), (col) => col.notNull())
    // Why, when a person said; NULL for "no reason" (an undo, a cascade, a rule's delete).
    .addColumn('reason', c.text)
    // The row as it was, masked as the audit log keeps it (JSON).
    .addColumn('image', c.text, (col) => col.notNull())
    .execute();
  // A parent's removed children of one table, newest first.
  await db.schema
    .createIndex('idx_adminium_removed_rows_parent')
    .on(metaTable('removed_rows'))
    .columns(['connection_id', 'parent_table', 'parent_value', 'entity_table', 'removed_at'])
    .execute();
  // A row brought back by an undo, or asked for by its own key.
  await db.schema
    .createIndex('idx_adminium_removed_rows_entity')
    .on(metaTable('removed_rows'))
    .columns(['connection_id', 'entity_table', 'entity_id'])
    .execute();
  // The retention sweep.
  await db.schema.createIndex('idx_adminium_removed_rows_removed_at').on(metaTable('removed_rows')).column('removed_at').execute();
}
