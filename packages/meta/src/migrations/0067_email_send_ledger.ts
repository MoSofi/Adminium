// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0067 — the campaign send ledger.
 *
 * Until now a campaign run was one row (`adminium_email_runs`) and one long
 * job that looped over the audience in memory: nothing recorded who had been
 * mailed, so a server that died mid-run could only refuse to go on. From this
 * wave a run writes every recipient down BEFORE the first message goes, and
 * short batch jobs hand them to the mail queue a few at a time. The ledger is
 * what makes a restart safe (each row says whether it was handed) and it is
 * the send log people read.
 *
 * ─── `adminium_email_sends`: one row per recipient of one run ──────────────
 * The address is held in clear, as the app outbox holds it: the outbox writes
 * the address it sends to on its own row (`outbox/sender.ts`, `cols.to`), and
 * the send log searches and shows it. The person's name and language are
 * copied when the run starts, so the log reads the same after the person is
 * renamed. A workspace user is named by `person_key` (their user id) with no
 * table; a row of an app table by its connection, table and key.
 *
 * `state` is one of queued, sending, sent, skipped-stop, skipped-consent,
 * bounced, spam, failed, unsubscribed. `sending` is a row a batch has claimed
 * (`claim_token`, `claimed_at`) and not yet handed over; `sent` means handed to
 * the `email.send` queue (`job_id`), in the same transaction that queued the
 * message, so a row is never handed twice and never lost between the two.
 *
 * ─── `adminium_email_run_contents`: what the run sends ─────────────────────
 * The campaign in every language it goes out in, copied when the run starts:
 * an edit to the campaign afterwards changes the next send, not this one. The
 * run points at it (`content_id`); the content row points back at its run and
 * goes with it.
 *
 * ─── `adminium_email_send_counters`: the hourly cap ────────────────────────
 * How many campaign messages were handed over in each hour, shared by every
 * run and every process (the payment counters' shape): a run that may send
 * at most 100 an hour counts what every other run handed in that hour too.
 *
 * ─── `adminium_email_runs` gains a few columns, and outlives its campaign ──
 * `rate_per_hour` (NULL = as fast as the mail server allows), `state` (running,
 * paused, stopped, done; NULL on a run made before this wave), `mail_class`
 * and `basis` (marketing or service; consent or existing customers, filled by
 * later work), and `content_id`.
 *
 * A run used to be deleted with its campaign (`ON DELETE CASCADE` from the
 * template, 0026). The send log, and the proof of who was mailed on what
 * basis, may not vanish because somebody tidied the campaign list, so the
 * template id becomes nullable and the foreign key `ON DELETE SET NULL`: the
 * run stays, and its frozen content still carries the campaign's name. MySQL
 * and PostgreSQL change the constraint in place; SQLite cannot alter a
 * constraint, so the table is rebuilt with the same columns, data and index
 * (nothing references the runs table before this wave, so the rebuild touches
 * no other table).
 */
import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** As long as the audit log's entity keys: a table name and a row key. */
const KEY = 200;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const runs = metaTable('email_runs');
  const templates = metaTable('email_templates');
  const users = metaTable('users');

  // ── the runs: four new columns, and a template id that may go ─────────────
  for (const [column, type] of [
    ['rate_per_hour', c.int],
    ['state', c.str(12)],
    ['mail_class', c.str(12)],
    ['basis', c.str(24)],
    ['content_id', c.id],
  ] as const) {
    await db.schema.alterTable(runs).addColumn(column, type).execute();
  }

  if (c.dialect === 'postgres') {
    await db.schema.alterTable(runs).dropConstraint('fk_adminium_email_runs_template_id').execute();
    await db.schema.alterTable(runs).alterColumn('template_id', (col) => col.dropNotNull()).execute();
    await db.schema
      .alterTable(runs)
      .addForeignKeyConstraint('fk_adminium_email_runs_template_id', ['template_id'], templates, ['id'], (cb) => cb.onDelete('set null'))
      .execute();
  } else if (c.dialect === 'mysql') {
    await sql`ALTER TABLE ${sql.table(runs)} DROP FOREIGN KEY fk_adminium_email_runs_template_id`.execute(db);
    await sql`ALTER TABLE ${sql.table(runs)} MODIFY COLUMN template_id char(36) NULL`.execute(db);
    await db.schema
      .alterTable(runs)
      .addForeignKeyConstraint('fk_adminium_email_runs_template_id', ['template_id'], templates, ['id'], (cb) => cb.onDelete('set null'))
      .execute();
  } else {
    // SQLite: the same table under a new name, the rows copied, the old one dropped.
    const next = metaTable('email_runs_0067');
    await db.schema
      .createTable(next)
      .addColumn('id', c.id, (col) => col.primaryKey())
      .addColumn('template_id', c.id)
      .addColumn('status', c.str(12), (col) => col.notNull())
      .addColumn('audience', c.json, (col) => col.notNull())
      .addColumn('scheduled_at', c.ts, (col) => col.notNull())
      .addColumn('started_at', c.ts)
      .addColumn('finished_at', c.ts)
      .addColumn('total', c.int, (col) => col.notNull().defaultTo(0))
      .addColumn('sent', c.int, (col) => col.notNull().defaultTo(0))
      .addColumn('failed', c.int, (col) => col.notNull().defaultTo(0))
      .addColumn('skipped', c.int, (col) => col.notNull().defaultTo(0))
      .addColumn('failures', c.json)
      .addColumn('job_id', c.id)
      .addColumn('created_by', c.id)
      .addColumn('created_at', c.ts, (col) => col.notNull())
      .addColumn('updated_at', c.ts, (col) => col.notNull())
      .addColumn('rate_per_hour', c.int)
      .addColumn('state', c.str(12))
      .addColumn('mail_class', c.str(12))
      .addColumn('basis', c.str(24))
      .addColumn('content_id', c.id)
      .addForeignKeyConstraint('fk_adminium_email_runs_template_id', ['template_id'], templates, ['id'], (cb) => cb.onDelete('set null'))
      .addForeignKeyConstraint('fk_adminium_email_runs_created_by', ['created_by'], users, ['id'], (cb) => cb.onDelete('set null'))
      .execute();
    const columns = sql.raw(
      [
        'id', 'template_id', 'status', 'audience', 'scheduled_at', 'started_at', 'finished_at', 'total', 'sent', 'failed',
        'skipped', 'failures', 'job_id', 'created_by', 'created_at', 'updated_at', 'rate_per_hour', 'state', 'mail_class',
        'basis', 'content_id',
      ].join(', '),
    );
    await sql`INSERT INTO ${sql.table(next)} (${columns}) SELECT ${columns} FROM ${sql.table(runs)}`.execute(db);
    await db.schema.dropTable(runs).execute();
    await db.schema.alterTable(next).renameTo(runs).execute();
    await db.schema
      .createIndex('ix_adminium_email_runs_template_created')
      .on(runs)
      .columns(['template_id', 'created_at'])
      .execute();
  }

  // ── what a run sends, frozen when it starts ───────────────────────────────
  await db.schema
    .createTable(metaTable('email_run_contents'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('run_id', c.id, (col) => col.notNull())
    /** The campaign's name and key when the run started: the log's title after the campaign is gone. */
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('template_key', c.str(80), (col) => col.notNull())
    /** `[{ templateId, locale, name, subject, preheader, blocks, footer, brand, attachments }]`, the started-from one first. */
    .addColumn('variants', c.json, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_email_run_contents_run_id', ['run_id'], runs, ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await db.schema
    .createIndex('uq_adminium_email_run_contents_run')
    .on(metaTable('email_run_contents'))
    .columns(['run_id'])
    .unique()
    .execute();

  // ── the ledger ────────────────────────────────────────────────────────────
  await db.schema
    .createTable(metaTable('email_sends'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('run_id', c.id, (col) => col.notNull())
    /** The order the recipients were written in: the log's order and its page cursor. */
    .addColumn('seq', c.int, (col) => col.notNull())
    .addColumn('address', c.str(320), (col) => col.notNull())
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('language', c.str(35))
    /** An app table's row: its connection, table and key. A workspace user: no table, the user id as the key. */
    .addColumn('connection_id', c.id)
    .addColumn('person_table', c.str(KEY))
    .addColumn('person_key', c.str(KEY))
    .addColumn('state', c.str(16), (col) => col.notNull())
    /** A code the screen words (`campaign-mail-off`), or what the mail server said. */
    .addColumn('reason', c.str(500))
    /** How many times a batch claimed the row: more than one only after a stop or a crash. */
    .addColumn('attempts', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('claim_token', c.str(64))
    .addColumn('claimed_at', c.ts)
    .addColumn('sent_at', c.ts)
    /** The `email.send` job the row was handed to. */
    .addColumn('job_id', c.id)
    .addColumn('clicks', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_email_sends_run_id', ['run_id'], runs, ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  // A batch's claim and the log's summary and filters: equality on both.
  await db.schema
    .createIndex('ix_adminium_email_sends_run_state')
    .on(metaTable('email_sends'))
    .columns(['run_id', 'state'])
    .execute();
  // One row per place in the run: a start that died half-way is written again, never twice.
  await db.schema
    .createIndex('uq_adminium_email_sends_run_seq')
    .on(metaTable('email_sends'))
    .columns(['run_id', 'seq'])
    .unique()
    .execute();

  // ── the shared hourly count ───────────────────────────────────────────────
  await db.schema
    .createTable(metaTable('email_send_counters'))
    .ifNotExists()
    .addColumn('bucket', c.str(200), (col) => col.notNull())
    .addColumn('window_start', c.ts, (col) => col.notNull())
    .addColumn('hits', c.int, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_email_send_counters', ['bucket', 'window_start'])
    .execute();
}
