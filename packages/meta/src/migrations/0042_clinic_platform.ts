// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0042 — what an app that books people needs from the meta store:
 * sessions that prove more than a lookup, emailed codes, a second browser key
 * bound to staff, email templates an app owns, the app's outbox, and the
 * record of human checks already used. One wave, because they ship in one
 * release; a column found missing later goes in the next wave, never here.
 *
 * ─── `adminium_public_sessions.level`, `.kind`, `.subject` ─────────────────
 * `level` is `lookup` (the row's details matched) or `verified` (a code
 * emailed to the row's own address was typed back). An entry that needs
 * `verified` refuses a `lookup` session. `kind` (`claim` | `account`) and
 * `subject` are designed together with it so customer accounts, which come
 * later, do not fork the table: `subject` names what the session is about —
 * for a claim, the claimed row — so every session of one person can be found,
 * counted and ended at once. Every session minted before this wave is a
 * lookup claim with no subject, which is what the defaults say.
 *
 * ─── `adminium_public_challenges` ──────────────────────────────────────────
 * The table 0014 made for emailed codes and nothing ever wrote. It gains the
 * session a code belongs to, its `purpose` (`verify` raises that session;
 * `email-change` confirms a new address, held encrypted in
 * `new_destination_enc` until it is confirmed), the claimed row it was sent
 * for (`subject`, so the per-person caps count across sessions), and
 * `cleared_at`, set when the desk lifts the day's lock after too many wrong
 * codes: a cleared row no longer counts toward it.
 *
 * ─── `adminium_public_keys.purpose`, `.requires_staff`, `.enabled_by` ──────
 * An app may have a browser key besides its public side's (a waiting-room
 * kiosk). `purpose` says which one a key is, so the public side is never
 * handed the kiosk's; every key made before this wave is a `customer` key.
 * `requires_staff` (JSON `{appKey, roleSlug}`) binds a key to a signed-in
 * staff member holding that role, so a token copied out of the page opens
 * nothing alone. `enabled_by` (JSON `{table, column}`) names a bool in the
 * app's settings row that switches the key off.
 *
 * ─── `adminium_email_templates.managed_by`, `.content_hash` ────────────────
 * The app that shipped a template, and the hash of what it shipped. An update
 * rewrites a row whose content still hashes to what the app shipped, and
 * keeps one an operator edited; uninstall removes only the unedited ones.
 *
 * ─── `adminium_app_outboxes` ───────────────────────────────────────────────
 * One row per installed app that declares an outbox: its definition with the
 * table names made real at install, read by the sender and the producers.
 * `scanned_at` is when the reminder scanner last finished a pass.
 *
 * ─── `adminium_public_proofs` ──────────────────────────────────────────────
 * A human check's proof works once, on every server of a deployment: the
 * proof's id is inserted here as the primary key, and a replay is the insert
 * that fails. Rows go once the proof would have expired anyway.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('public_sessions'))
    .addColumn('level', c.str(16), (col) => col.notNull().defaultTo('lookup'))
    .execute();
  await db.schema
    .alterTable(metaTable('public_sessions'))
    .addColumn('kind', c.str(16), (col) => col.notNull().defaultTo('claim'))
    .execute();
  await db.schema.alterTable(metaTable('public_sessions')).addColumn('subject', c.str(191)).execute();
  await db.schema
    .createIndex('ix_adminium_public_sessions_subject')
    .on(metaTable('public_sessions'))
    .columns(['subject'])
    .execute();

  await db.schema.alterTable(metaTable('public_challenges')).addColumn('session_id', c.id).execute();
  await db.schema
    .alterTable(metaTable('public_challenges'))
    .addColumn('purpose', c.str(16), (col) => col.notNull().defaultTo('verify'))
    .execute();
  await db.schema.alterTable(metaTable('public_challenges')).addColumn('new_destination_enc', c.text).execute();
  await db.schema.alterTable(metaTable('public_challenges')).addColumn('subject', c.str(191)).execute();
  await db.schema.alterTable(metaTable('public_challenges')).addColumn('cleared_at', c.ts).execute();
  await db.schema
    .createIndex('ix_adminium_public_challenges_subject')
    .on(metaTable('public_challenges'))
    .columns(['subject', 'created_at'])
    .execute();
  await db.schema
    .createIndex('ix_adminium_public_challenges_session')
    .on(metaTable('public_challenges'))
    .columns(['session_id'])
    .execute();

  await db.schema
    .alterTable(metaTable('public_keys'))
    .addColumn('purpose', c.str(32), (col) => col.notNull().defaultTo('customer'))
    .execute();
  await db.schema.alterTable(metaTable('public_keys')).addColumn('requires_staff', c.text).execute();
  await db.schema.alterTable(metaTable('public_keys')).addColumn('enabled_by', c.text).execute();

  await db.schema.alterTable(metaTable('email_templates')).addColumn('managed_by', c.str(80)).execute();
  await db.schema.alterTable(metaTable('email_templates')).addColumn('content_hash', c.str(64)).execute();
  await db.schema
    .createIndex('ix_adminium_email_templates_managed_by')
    .on(metaTable('email_templates'))
    .columns(['managed_by'])
    .execute();

  await db.schema
    .createTable(metaTable('app_outboxes'))
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('app_key', c.str(80), (col) => col.notNull().unique())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    /** The manifest's `outbox`, with every table name real. Text, so it reads back byte for byte. */
    .addColumn('definition', c.text, (col) => col.notNull())
    .addColumn('scanned_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_app_outboxes_manifest',
      ['manifest_id'],
      metaTable('manifests'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_app_outboxes_connection',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable(metaTable('public_proofs'))
    .addColumn('id', c.str(64), (col) => col.primaryKey())
    .addColumn('key_id', c.id, (col) => col.notNull())
    .addColumn('purpose', c.str(32), (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex('ix_adminium_public_proofs_expires')
    .on(metaTable('public_proofs'))
    .columns(['expires_at'])
    .execute();
}
