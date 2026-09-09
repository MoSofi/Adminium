// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0030 — report documents: the AUTHORED source behind `/report-builder`
 * (43-report-builder.md §3.2; 43-T02).
 *
 * ─── Three tables now carry the word "report"; this is the builder's ───────
 *
 * `adminium_report_documents` holds what a person typed and can edit again:
 * a report template (a reusable layout) or a report built from one, or from
 * scratch. It is NOT `adminium_scheduled_reports` (the recurring CSV snapshot
 * of a page, prefix `rep`, route `/reports`) and it is not a render register.
 * The two features share only the English word — a grep for it finds the
 * wrong one at every layer, which is why this table, its prefix (`rpt`), its
 * route and its namespace all say `report-builder` rather than `reports`.
 *
 * ─── One table, two kinds (§3.2) ───────────────────────────────────────────
 *
 * The comp holds templates and reports in one object model behind
 * `arrName(kind)` (comp 511), so `kind` is a column rather than a second
 * table: one editor, one canvas, one sheet. `status` is the comp's three-value
 * vocabulary shared by both kinds (draft · sent · live, comp `statusMeta` 563)
 * — stored, not derived, because a status here is what the operator SAID about
 * the document. The key `sent` is kept although its label reads *Published*:
 * it is the comp's own state key, the way 0027 kept its five.
 *
 * ─── The body is a block ARRAY, not a flat record ──────────────────────────
 *
 * 0027's envelope is one flat body with a `blockOrder` and eighteen `*Show`
 * flags, where a kind occurs at most once. Here a kind REPEATS (the KPI
 * scorecard starter has two `kpi` blocks, comp 491), every block carries its
 * own `title`, `w` and `show`, and `show: false` dims a block on the canvas —
 * it never removes it and never re-orders. Nothing in 0027's ordering
 * arithmetic applies inside a body; `position` below is the manager's, not
 * the canvas's.
 *
 * ─── Why `origin_id` has no foreign key ────────────────────────────────────
 *
 * A report remembers the template it was built from (43 D6/O3). That is a
 * SOFT reference on purpose: deleting a template must not unmake, cascade
 * into, or null out a report an operator already published — the report is
 * its own document from the moment it exists. `created_by` keeps the named
 * table-level FK to users (0026/0027's spelling), because a deleted user
 * leaving a dangling id is exactly the row the SET NULL exists for.
 *
 * ─── `position` is the manager's sort key ──────────────────────────────────
 *
 * The comp orders both collections by array position: a new document is
 * prepended (`createFrom` 553), a duplicate lands directly after its source
 * (`duplicate` 555). The repo keeps that arithmetic (min − 1,
 * shift-and-insert) on this column; `(kind, position)` is the manager's list
 * index. There is no second index here: this comp has no topics, no language
 * variations and no group-by (43 §5 item 3), so no family question exists to
 * answer.
 *
 * ─── Denormalised for the list ─────────────────────────────────────────────
 *
 * `summary` (the card facts: report title, kicker, accent, block count, KPI
 * count, up to six series values, the starter's icon) is written by the server
 * on every save so the manager's thumbnail never decodes a body — the comp
 * derives its mini chart from the first bar/line block and its KPI boxes from
 * the first `kpi` block (584-591), and a list that did that per row would
 * decode every document to draw a gallery.
 *
 * `body` and `summary` are NOT NULL json with no DEFAULT: MySQL refuses a
 * DEFAULT on json/text columns, and every row is written whole by the repo.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const documents = metaTable('report_documents');
  const users = metaTable('users');

  await db.schema
    .createTable(documents)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    /** `template` | `report` (§3.2). */
    .addColumn('kind', c.str(10), (col) => col.notNull())
    .addColumn('name', c.str(120), (col) => col.notNull())
    /** draft | sent | live — the comp's three, shared by both kinds. */
    .addColumn('status', c.str(10), (col) => col.notNull().defaultTo('draft'))
    /** Which starter minted it; NULL for blank documents (43 D14). */
    .addColumn('starter', c.str(40))
    /** The template a report was built from (43 D6) — a soft ref, no FK. */
    .addColumn('origin_id', c.id)
    /** The manager's sort key; see the header. */
    .addColumn('position', c.int, (col) => col.notNull())
    /** The envelope — header plus the block array (§3.3). */
    .addColumn('body', c.json, (col) => col.notNull())
    /** The card facts, written on every save (43 D15/D16). */
    .addColumn('summary', c.json, (col) => col.notNull())
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_report_documents_created_by',
      ['created_by'],
      users,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  // The manager's list: "the templates, in order" / "the reports, in order".
  await db.schema
    .createIndex('ix_adminium_report_documents_kind_position')
    .on(documents)
    .columns(['kind', 'position'])
    .execute();
}
