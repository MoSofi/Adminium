// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0035 — `adminium_option_lists`: the answers a column accepts, named once
 * and used from anywhere (plan 50 D20).
 *
 * A `column.options` rule either carries its values inline or NAMES one of
 * these. Naming matters for the lists that repeat: a workspace has one list of
 * countries, not one per column, and renaming "Ops" to "Operations" is one edit
 * rather than nine.
 *
 * ─── Why `key` and not the id ──────────────────────────────────────────────
 *
 * Rules travel. A `column.options` row goes into a project's
 * `schema/<database>.json` (plan 49), which is committed and moves between
 * installs, and plan 49's own gate refuses a file that names an INSTANCE ID.
 * So a list is referenced by a slug it keeps everywhere, and the id stays an
 * internal detail. The list itself travels as `lists/<key>.json`.
 *
 * ─── What is NOT a row here ────────────────────────────────────────────────
 *
 * The built-ins — countries, US states, gender — live in code
 * (`page-config/option-lists.ts`). They are the same everywhere, their labels
 * come from the runtime's own data, and seeding 249 country rows into every
 * workspace would make an edit to the list a migration. Editing a built-in
 * makes a COPY, which is an ordinary row with `origin` recording where it came
 * from.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('option_lists'))
    .ifNotExists()
    .addColumn('id', c.str(40), (col) => col.primaryKey())
    // 120 matches the `column.options` payload's own ceiling, so a key that
    // validates at the route always fits here.
    .addColumn('key', c.str(120), (col) => col.notNull())
    .addColumn('name', c.str(200), (col) => col.notNull())
    /*
     * `items` is JSON: `[{ value, label?, tone?, description? }]`. A child table
     * would buy referential integrity over values nothing points at, and cost a
     * join on every form render plus an ordering column — the order IS the
     * document's order, which is what a list means.
     */
    .addColumn('items', c.json, (col) => col.notNull())
    /** `custom`, or `copy:<builtin key>` — where an editable copy came from. */
    .addColumn('origin', c.str(140), (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();

  // The key is the reference, so it is unique and it is what every read looks
  // up by. Named rather than `.unique()` on the column: MySQL needs the name to
  // drop it, and every other index in this store carries one.
  await db.schema
    .createIndex('ux_adminium_option_lists_key')
    .on(metaTable('option_lists'))
    .column('key')
    .unique()
    .execute();
}
