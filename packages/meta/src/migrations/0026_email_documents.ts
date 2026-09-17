// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0026 — email documents: the room the comp needs.
 *
 * ─── One table, two kinds (D2) ─────────────────────────────────────────────
 *
 * `adminium_email_templates` was `(key, locale, name, subject, blocks,
 * enabled, is_builtin_copy)` — enough for three built-ins and nothing the
 * comp draws. A campaign (a send-out: a weekly digest, a monthly report) is
 * the SAME document with a different lifecycle, so it is a `kind` on the same
 * row rather than a second table: one editor, one variants model, one
 * renderer, exactly as the comp holds one block model behind `arrName(kind)`.
 * Status is DERIVED and never stored twice — a template's Draft/Live is
 * `enabled`, a campaign's Draft/Scheduled/Sending/Sent/Failed is its latest
 * run — so there is no `status` column to drift from the truth.
 *
 * ─── Why `footer` and `attachments` are NULLABLE and default to nothing ────
 *
 * They were spelled `text ''` and `json '[]'`. MySQL refuses a DEFAULT on TEXT,
 * BLOB and JSON columns ("can't have a default value"), and no migration in
 * this directory has ever put one on `c.text`/`c.json` for that reason. So
 * both are nullable with NULL read as the empty value by the repo — the same
 * semantics, one dialect fewer to special-case. `brand` is nullable by design
 * (NULL = the workspace defaults, D6).
 *
 * ─── Legacy footer blocks are lifted on READ, not rewritten here ───────────
 *
 * Every seeded row and every install's edits hold a trailing `email.footer`
 * BLOCK; the comp's footer is a fixed envelope field (D5). Rewriting 24 seeded
 * rows × N installs in a migration would move content nobody asked to move
 * and would have to reproduce the repo's decode rules in SQL on three
 * dialects. The repo lifts a trailing footer block into `footer` when it
 * decodes a row whose `footer` is empty, stores `footer` on the next save, and
 * the renderer keeps rendering a footer block it still meets — forever,
 * because a row that is never re-saved keeps its block.
 *
 * ─── The two new tables ────────────────────────────────────────────────────
 *
 * `adminium_email_blocks` — saved reusable blocks (the comp's "Save as
 * reusable block" / "Saved blocks" group in the picker), workspace-wide.
 *
 * `adminium_email_runs` — one row per campaign send (D11). Counts and the
 * first hundred failures live on the run, not one row per recipient: the
 * product needs "18,240 sent · 12 failed", not a per-address ledger. The FK
 * to the template CASCADES: a campaign deleted for good takes its history
 * with it — a run without its document answers no question.
 *
 * FKs are named and table-level (the 2026-07-20 lesson: MySQL parses an
 * inline column-level REFERENCES and silently discards it), except on the
 * ALTER, where SQLite's ALTER TABLE cannot ADD CONSTRAINT and the inline form
 * is the only one it accepts — 0024's split, verbatim.
 */

import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const templates = metaTable('email_templates');
  const users = metaTable('users');

  // ── the envelope columns (D2–D8) ─────────────────────────────────────────
  await db.schema
    .alterTable(templates)
    /** `template` | `campaign` (D2). */
    .addColumn('kind', c.str(10), (col) => col.notNull().defaultTo('template'))
    .execute();
  await db.schema
    .alterTable(templates)
    /** `transactional` | `lifecycle` | `marketing` — the comp's three categories. */
    .addColumn('category', c.str(16), (col) => col.notNull().defaultTo('transactional'))
    .execute();
  await db.schema
    .alterTable(templates)
    /** Which starter minted the family; NULL for blank and built-in documents (D3/D10). */
    .addColumn('starter', c.str(40))
    .execute();
  await db.schema
    .alterTable(templates)
    /** A verbatim copy awaiting translation; cleared on the variant's first explicit save (D3). */
    .addColumn('needs_translation', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .execute();
  await db.schema
    .alterTable(templates)
    /** Delete is archive (D4); NULL = live in the manager. */
    .addColumn('archived_at', c.ts)
    .execute();
  await db.schema
    .alterTable(templates)
    /** The inbox preview line (comp 520). */
    .addColumn('preheader', c.str(300), (col) => col.notNull().defaultTo(''))
    .execute();
  await db.schema
    .alterTable(templates)
    /** The fixed footer (D5). NULL reads as '' — see the header for why. */
    .addColumn('footer', c.text)
    .execute();
  await db.schema
    .alterTable(templates)
    /** `{ name, mark, accent, fromName, fromEmail }`; NULL = workspace defaults (D6). */
    .addColumn('brand', c.json)
    .execute();
  await db.schema
    .alterTable(templates)
    /** `[{ id, kind: 'file', fileId } | { id, kind: 'generated', label, token }]`; NULL reads as [] (D8). */
    .addColumn('attachments', c.json)
    .execute();

  if (c.dialect === 'sqlite') {
    await sql`ALTER TABLE ${sql.table(templates)} ADD COLUMN created_by char(36) REFERENCES ${sql.table(users)}(id) ON DELETE SET NULL`.execute(
      db,
    );
  } else {
    await db.schema.alterTable(templates).addColumn('created_by', c.id).execute();
    await db.schema
      .alterTable(templates)
      .addForeignKeyConstraint(
        'fk_adminium_email_templates_created_by',
        ['created_by'],
        users,
        ['id'],
        (cb) => cb.onDelete('set null'),
      )
      .execute();
  }

  // The manager's two questions — "the live templates", "the live campaigns",
  // "the archived ones" — are equality on kind and a NULL test on archived_at.
  await db.schema
    .createIndex('ix_adminium_email_templates_kind_archived')
    .on(templates)
    .columns(['kind', 'archived_at'])
    .execute();

  // ── saved blocks ─────────────────────────────────────────────────────────
  await db.schema
    .createTable(metaTable('email_blocks'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(80), (col) => col.notNull())
    /** One `{ id, block, data, style }` record; the editor clones it with a fresh id on insert. */
    .addColumn('block', c.json, (col) => col.notNull())
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_email_blocks_created_by',
      ['created_by'],
      users,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  // ── campaign runs (D11) ──────────────────────────────────────────────────
  await db.schema
    .createTable(metaTable('email_runs'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('template_id', c.id, (col) => col.notNull())
    /** scheduled | running | sent | failed | cancelled */
    .addColumn('status', c.str(12), (col) => col.notNull())
    /** `{ kind: 'users', roleIds? }` now; a table audience joins in the next wave (O1). */
    .addColumn('audience', c.json, (col) => col.notNull())
    .addColumn('scheduled_at', c.ts, (col) => col.notNull())
    .addColumn('started_at', c.ts)
    .addColumn('finished_at', c.ts)
    .addColumn('total', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('sent', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('failed', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('skipped', c.int, (col) => col.notNull().defaultTo(0))
    /** At most 100 `{ to, error }` records — enough to diagnose, never a per-recipient ledger. */
    .addColumn('failures', c.json)
    /** The `email.campaign-run` job; NULL once the row no longer needs one. */
    .addColumn('job_id', c.id)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_email_runs_template_id',
      ['template_id'],
      templates,
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_email_runs_created_by',
      ['created_by'],
      users,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  // "The latest run of this campaign" — the derivation behind every status pill.
  await db.schema
    .createIndex('ix_adminium_email_runs_template_created')
    .on(metaTable('email_runs'))
    .columns(['template_id', 'created_at'])
    .execute();
}
