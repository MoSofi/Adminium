// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0011 — runtime translations (23-runtime-translations.md §3.1, §3.2).
 *
 * Two tables, both deliberately SPARSE:
 *
 *  - `adminium_locales` holds a row only when an admin deviates from a
 *    compiled locale's defaults (or invents a new one). A built-in locale
 *    with no row behaves exactly as it does today, and the immutable fields
 *    of a built-in row (`dir`, `font_hint`, `intl_tag`, names) are always
 *    read from the compiled registry — the row can only carry `enabled` and
 *    `sort_order`. That is what makes "zero rows ⇒ byte-identical to today"
 *    a structural guarantee rather than a convention, and it also means an
 *    admin cannot flip `ar_EG` to `ltr` and corrupt a shipped bundle.
 *  - `adminium_translations` holds one row per OVERRIDDEN message. Absence
 *    means "use the compiled built-in"; a row with an empty `value` means
 *    "deliberately blank" (§3.3). Reset-to-built-in is therefore a hard
 *    DELETE, which is why the version stamp is a counter in
 *    `adminium_settings` and not `MAX(updated_at)` over these rows.
 *
 * Column widths are index-budget driven, not guesses. The composite unique
 * index spans scope(16) + locale(35) + namespace(16) + key(120) = 187 chars;
 * MySQL's InnoDB utf8mb4 index-key limit of 3072 bytes allows 768, so this
 * fits with 4x margin. The longest en-US key today is 64 chars. Widening
 * `key` past ~200 would break MySQL, so it is bounded here rather than left
 * to `text`.
 *
 * `scope` LEADS the unique index deliberately. It is reserved (always
 * 'workspace' in v1) against a possible per-app string set; adding a leading
 * column to a MySQL unique index later is the migration nobody wants.
 *
 * The column is `source_text`, NOT `src_hash`: `assertNoCredentialColumns`
 * in the export path aborts an export on any column matching /hash$/i, and
 * that assertion is a CI unit test.
 *
 * Index-guard note (index.ts): no `.ifNotExists()` on index creation — MySQL
 * cannot parse it, and the ledger's exactly-once guarantee is the idempotency
 * mechanism.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('locales'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('locale', c.str(35), (col) => col.notNull())
    .addColumn('is_builtin', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('sort_order', c.int, (col) => col.notNull().defaultTo(0))
    // Custom locales only — a built-in row reads these from the compiled registry.
    .addColumn('english', c.str(80))
    .addColumn('native', c.str(80))
    .addColumn('dir', c.str(3))
    .addColumn('font_hint', c.str(16))
    // A REAL BCP-47 tag whose Intl behaviour a custom locale borrows (§5.6).
    .addColumn('intl_tag', c.str(35))
    // Frozen at create time from `intl_tag` so write validation is
    // deterministic across the browser's ICU and Node's (§5.6).
    .addColumn('plural_categories', c.json)
    .addColumn('updated_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_locales_updated_by',
      ['updated_by'],
      metaTable('users'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('uq_adminium_locales_locale')
    .on(metaTable('locales'))
    .columns(['locale'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('translations'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('scope', c.str(16), (col) => col.notNull().defaultTo('workspace'))
    .addColumn('locale', c.str(35), (col) => col.notNull())
    .addColumn('namespace', c.str(16), (col) => col.notNull())
    .addColumn('key', c.str(120), (col) => col.notNull())
    .addColumn('value', c.text, (col) => col.notNull())
    // The en-US text this override was authored against, so the editor can
    // flag "the English changed since this was written" (§7 stale badge).
    .addColumn('source_text', c.text)
    .addColumn('updated_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_translations_updated_by',
      ['updated_by'],
      metaTable('users'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('uq_adminium_translations_scope_locale_ns_key')
    .on(metaTable('translations'))
    .columns(['scope', 'locale', 'namespace', 'key'])
    .unique()
    .execute();

  // The bundle read path is always (scope, locale, namespace) — one index
  // serves it and the per-locale budget count without scanning.
  await db.schema
    .createIndex('ix_adminium_translations_scope_locale_ns')
    .on(metaTable('translations'))
    .columns(['scope', 'locale', 'namespace'])
    .execute();
}
