// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0027 — invoice documents: the AUTHORED source behind `/invoices`
 * (34-invoices-add-on.md §3.9, Appendix G; 34-T46).
 *
 * ─── Two tables with confusable names; this is the authored one ────────────
 *
 * `adminium_invoice_documents` holds what a person typed and can edit again:
 * a template (a reusable design) or an invoice (a document built from one,
 * or from scratch), both the same ~70-field envelope in `body`. It is NOT a
 * register. `adminium_documents` (34 §3.3, the render register — a frozen
 * subject, a minted number, file ids, one row per RENDERING) is a later
 * wave's table and is not created here; when it lands, a rendering points
 * back at the authored row it was made from, and deleting a template never
 * unmakes a document that was issued from it.
 *
 * ─── One table, two kinds (§3.9) ───────────────────────────────────────────
 *
 * The comp holds templates and invoices in one object model behind
 * `arrName(kind)`, so `kind` is a column rather than a second table: one
 * editor, one variants model, one sheet. `status` is the comp's five-value
 * vocabulary shared by both kinds (draft · sent · paid · live · overdue) —
 * stored, not derived, because a status here is what the operator SAID about
 * the document, and nothing else in the product knows better.
 *
 * ─── `topic` + `lang` name a member, not a group ───────────────────────────
 *
 * A language variation is another row with the same `kind` and `topic` and
 * a different `lang` (the comp's `addLangVariant`, 1237-1253). `(topic, lang)`
 * is therefore the identity of one MEMBER of a family, and the family is
 * every row sharing the topic. No unique index enforces it: the route refuses
 * a duplicate language with a 409 that names the existing row, which is what
 * the comp does (it opens the existing one).
 *
 * ─── Why `origin_id` has no foreign key ─────────────────────────────────────
 *
 * An invoice remembers the template it was built from (34 O20). That is a
 * SOFT reference on purpose: deleting a template must not unmake, cascade
 * into, or null out an invoice an operator already issued — the invoice is
 * its own document from the moment it exists. `created_by` keeps the named
 * table-level FK to users (0026's spelling), because a deleted user leaving
 * a dangling id is exactly the row the SET NULL exists for.
 *
 * ─── `position` is the manager's sort key ──────────────────────────────────
 *
 * The comp orders both collections by array position: a new document is
 * prepended, a duplicate lands directly after its source, a language
 * variation lands after the last of its topic. The repo keeps that arithmetic
 * (min − 1, shift-and-insert) on this column; `(kind, position)` is the
 * manager's list index.
 *
 * ─── Denormalised for the list ─────────────────────────────────────────────
 *
 * `number` and `summary` (the card facts: number, customer, title, accent,
 * currency, total in minor units, item count) are written by the server on
 * every save so the manager never decodes 70 fields per row, and so a number
 * can be checked for uniqueness without opening the body.
 *
 * `body` and `summary` are NOT NULL json with no DEFAULT: MySQL refuses a
 * DEFAULT on json/text columns, and every row is written whole by the repo.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const documents = metaTable('invoice_documents');
  const users = metaTable('users');

  await db.schema
    .createTable(documents)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    /** `template` | `invoice` (§3.9). */
    .addColumn('kind', c.str(10), (col) => col.notNull())
    .addColumn('name', c.str(120), (col) => col.notNull())
    /** draft | sent | paid | live | overdue — the comp's five, shared by both kinds. */
    .addColumn('status', c.str(10), (col) => col.notNull().defaultTo('draft'))
    /** recurring | services | receipts | sales | logistics | other — the family key. */
    .addColumn('topic', c.str(40), (col) => col.notNull().defaultTo('other'))
    /** en | de | fr | es | pt | ja — the document's language (34 O23). */
    .addColumn('lang', c.str(8), (col) => col.notNull().defaultTo('en'))
    /** Denormalised from `body.number` for the list and uniqueness checks. */
    .addColumn('number', c.str(60), (col) => col.notNull().defaultTo(''))
    /** Which starter minted it; NULL for blank documents. */
    .addColumn('starter', c.str(40))
    /** The template an invoice was built from (34 O20) — a soft ref, no FK. */
    .addColumn('origin_id', c.id)
    /** The manager's sort key; see the header. */
    .addColumn('position', c.int, (col) => col.notNull())
    /** The envelope — the comp's `base()` shape (§3.9, Appendix F). */
    .addColumn('body', c.json, (col) => col.notNull())
    /** The card facts, written on every save. */
    .addColumn('summary', c.json, (col) => col.notNull())
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_invoice_documents_created_by',
      ['created_by'],
      users,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  // The manager's list: "the templates, in order" / "the invoices, in order".
  await db.schema
    .createIndex('ix_adminium_invoice_documents_kind_position')
    .on(documents)
    .columns(['kind', 'position'])
    .execute();

  // The family question: "every variation of this topic", and "is there a
  // German one already" — equality on both.
  await db.schema
    .createIndex('ix_adminium_invoice_documents_topic_lang')
    .on(documents)
    .columns(['topic', 'lang'])
    .execute();
}
