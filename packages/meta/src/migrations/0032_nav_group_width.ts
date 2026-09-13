// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0032 — `adminium_pages.nav_group` was twelve characters wide.
 *
 * ─── THE BUG ──────────────────────────────────────────────────────────────
 * The column holds a nav-group SLUG, and 0004 sized it `str(12)`. The
 * enrichment response proposes those slugs (`NavGroupSuggestion.id`, a `Slug`
 * with no length bound at all), so any two-word group a model reasonably picks
 * — `client-management`, `project-delivery` — is longer than the column. Apply
 * the run and PostgreSQL answers `value too long for type character
 * varying(12)` from inside the transaction, as an unhandled 500.
 *
 * ─── WHY NO TEST CAUGHT IT ────────────────────────────────────────────────
 * `str(n)` is `varchar(n)` on PostgreSQL and MySQL and plain `text` on SQLite
 * (../columns.ts), because SQLite does not enforce a length. Every unit suite
 * and the default e2e leg run on SQLite, where a 17-character slug fits a
 * 12-character column perfectly well. It is reachable ONLY on the two engines
 * a real install is most likely to use. `test/nav-group-width.test.ts` asserts
 * it on all three, so the next narrowing fails where it can be seen.
 *
 * ─── WHY 48 ───────────────────────────────────────────────────────────────
 * Wide enough for every plausible slug (`customer-relationship-management` is
 * 32) and still bounded, because this is a key that lands in a URL and a
 * sidebar. `packages/llm`'s referential pass drops a suggestion that would not
 * fit rather than letting the database be the thing that says no — a fatal
 * schema error would reject the whole run, and one unusable group must not.
 *
 * SQLITE IS DELIBERATELY UNTOUCHED: its column is already `text`, `ALTER
 * COLUMN` cannot change a type there, and rebuilding a table to widen a
 * constraint the engine never enforced would be all risk and no change.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The widened bound, exported so the response pass and its tests share it. */
export const NAV_GROUP_MAX = 48;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  if (c.dialect === 'sqlite') return;

  const table = db.schema.alterTable(metaTable('pages'));
  if (c.dialect === 'mysql') {
    // MySQL has no `ALTER COLUMN … TYPE` — kysely's `alterColumn().setDataType()`
    // emits the PostgreSQL spelling and MySQL answers "You have an error in your
    // SQL syntax … near 'type varchar(48)'". `MODIFY COLUMN` restates the whole
    // definition, which for this column is just the type: 0004 left it nullable
    // with no default, and MODIFY's own default is nullable, so nothing else has
    // to be repeated here.
    await table.modifyColumn('nav_group', c.str(NAV_GROUP_MAX), (col) => col).execute();
    return;
  }
  await table.alterColumn('nav_group', (col) => col.setDataType(c.str(NAV_GROUP_MAX))).execute();
}
