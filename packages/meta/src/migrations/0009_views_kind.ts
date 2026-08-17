// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0009 — `adminium_views.kind` (04-widget-registry.md §6.3, 07-meta-store.md
 * §3.18).
 *
 * A saved-views row now carries a `kind` discriminator: `'filters'` (the M5
 * saved page-crud grid state) or `'layout'` (a per-user dashboard layout
 * override — the "Reset layout" surface). The base table (0004) predates the
 * layout track, so this migration ADDS the column (never edits a shipped
 * migration).
 *
 * The column is NOT NULL with `DEFAULT 'filters'`: every existing row is a
 * saved filter view, so the backfill is correct and `viewsRepo` inserts stay
 * unaffected (they pass `kind` explicitly, defaulting to `'filters'`). The
 * `(page_id, user_id, name)` uniqueness index still holds — layout rows use a
 * reserved sentinel name, so at most one layout override exists per (page,user).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('views'))
    .addColumn('kind', c.str(12), (col) => col.notNull().defaultTo('filters'))
    .execute();
}
