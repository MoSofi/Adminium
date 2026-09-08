// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0024 — storage destinations and the record linkage files never had
 * (37-files-and-storage.md §3.2, D2, D3, D6, D12).
 *
 * ─── Why destinations are rows and not a settings key ──────────────────────
 *
 * The owner's ask was plural: "choose the destination, configure a cloud
 * storage like S3 buckets, host it on the server or configure a remote
 * server". A settings key holds one value; several destinations coexist by
 * design (photos on R2, documents on the NAS) with exactly one default. And a
 * destination carries a SECRET — access keys, a WebDAV password — which needs
 * the same row-level `enc:v1:` treatment a connection DSN already gets, not a
 * settings blob that the config export would happily carry off the instance
 * (D16).
 *
 * ─── Why this server's disk is NOT one of those rows (D3) ──────────────────
 *
 * `adminium_files.destination_id IS NULL` means `<dataDir>/files`, with the
 * exact key grammar `files/storage.ts` has enforced since M4. Every row that
 * exists today is already in that state, so this migration backfills NOTHING
 * and a store that never configures a destination writes byte-identical bytes
 * to byte-identical paths afterwards. The alternative — minting a row for the
 * local disk and backfilling every file to point at it — would rewrite every
 * historical row to say what NULL already says, and would give the local disk
 * an id that could be deleted.
 *
 * RESTRICT, not CASCADE, on the FK: deleting a destination that still holds
 * files would orphan the bytes, and the repo refuses first with the count
 * (D20) so the operator sees "12 files live here" rather than a constraint
 * violation. The FK is the backstop for a repo bug, not the mechanism.
 *
 * ─── The entity columns, and why they are not the `entity` json column ─────
 *
 * `adminium_files.entity` (a `RecordRef`, migration 0003) has been NULL on
 * every row ever written — nothing has ever set it. The sidecar attachment
 * mode (D6) needs "every file attached to THIS record", which is a lookup, and
 * a lookup on packed JSON is the amplification anti-pattern 0016 exists to
 * rule out. So the same denormalisation 0016 applied to the audit log applies
 * here: three real, indexed columns beside the json.
 *
 * The shape is 0016's verbatim — a connection id, the qualified table, and the
 * canonical record-id string (`pkLabel` form) — with one addition: the
 * connection id, which the audit log gets from its `entity` ref's context and
 * a file needs explicitly, because two connections can carry the same
 * `public.invoices` and a file attached to one must not appear on the other.
 *
 * No backfill: there is nothing to backfill from.
 *
 * ─── Two indexes, one per access path ──────────────────────────────────────
 *
 * `idx_adminium_files_entity` is the record page's panel: equality on all
 * three columns. `idx_adminium_files_state` is the two halves of the daily
 * sweep (D12) — unattached uploads past their hour, then trashed rows past
 * their retention day — both of which scan by state and order by age.
 */

import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { AUDIT_ENTITY_KEY_MAX } from '../schema/json-payloads.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('storage_destinations'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    /** Operator-facing name; unique so a picker never shows two "Backups". */
    .addColumn('name', c.str(80), (col) => col.notNull())
    /** `local` | `s3` | `webdav` — Zod-validated in the repo. */
    .addColumn('driver', c.str(12), (col) => col.notNull())
    /**
     * Non-secret driver config. `local {root}`, `s3 {endpoint, region, bucket,
     * prefix?, forcePathStyle, publicBaseUrl?}`, `webdav {url, prefix?,
     * publicBaseUrl?}`. Opaque here, Zod-validated in the repo — the discipline
     * every other json column in this store follows.
     */
    .addColumn('config', c.json, (col) => col.notNull())
    /**
     * `enc:v1:` token over `{accessKeyId, secretAccessKey}` or `{username,
     * password}`, encrypted by caller-provided closures (HKDF salt
     * `adminium:storage:v1`). NULL for `local`, which has no credential.
     */
    .addColumn('secret_encrypted', c.text)
    /** At most one row is true; the repo enforces it inside the transaction that sets it. */
    .addColumn('is_default', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    /** `untested` | `ok` | `error` — the Test button's last verdict. */
    .addColumn('status', c.str(12), (col) => col.notNull())
    .addColumn('last_tested_at', c.ts)
    /** The driver's own error text, verbatim; an operator debugging a bucket needs the provider's words. */
    .addColumn('last_error', c.text)
    /**
     * Disabled ≠ deleted: a destination whose credentials were rotated stops
     * taking NEW files while every file it already holds stays readable.
     */
    .addColumn('disabled_at', c.ts)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    // Named and table-level (the 2026-07-20 lesson: MySQL parses an inline
    // column-level REFERENCES and silently discards it). SET NULL, not cascade:
    // deleting the admin who configured the bucket must not delete the bucket.
    .addForeignKeyConstraint(
      'fk_adminium_storage_destinations_created_by',
      ['created_by'],
      metaTable('users'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('uq_adminium_storage_destinations_name')
    .on(metaTable('storage_destinations'))
    .columns(['name'])
    .unique()
    .execute();

  // The destination FK is spelled per dialect, because the two available
  // spellings are each unsupported on one engine:
  //
  //   • `ALTER TABLE … ADD CONSTRAINT` does not exist in SQLite — its ALTER
  //     TABLE knows only RENAME / ADD COLUMN / DROP COLUMN — so a portable
  //     `addForeignKeyConstraint()` here would die on the dialect every
  //     developer and every desktop install actually runs.
  //   • A column-level `REFERENCES` inside ADD COLUMN is what SQLite accepts
  //     (legal precisely because this column is nullable and defaults to
  //     NULL), but MySQL parses it and silently discards it — the 2026-07-20
  //     lesson that made every other FK in this directory named and
  //     table-level.
  //
  // So: the inline reference where it is the only form, the named table-level
  // constraint everywhere else. Same guarantee on all three, and RESTRICT
  // spelled out on both paths (SQLite's implicit default is NO ACTION, which
  // is not the same thing under a deferred-constraint reading).
  const files = metaTable('files');
  const destinations = metaTable('storage_destinations');
  if (c.dialect === 'sqlite') {
    await sql`ALTER TABLE ${sql.table(files)} ADD COLUMN destination_id char(36) REFERENCES ${sql.table(destinations)}(id) ON DELETE RESTRICT`.execute(
      db,
    );
  } else {
    await db.schema.alterTable(files).addColumn('destination_id', c.id).execute();
    await db.schema
      .alterTable(files)
      .addForeignKeyConstraint(
        'fk_adminium_files_destination_id',
        ['destination_id'],
        destinations,
        ['id'],
        (cb) => cb.onDelete('restrict'),
      )
      .execute();
  }

  /** Set when the file becomes a record's file; NULL is the unattached upload the sweep collects. */
  await db.schema.alterTable(files).addColumn('attached_at', c.ts).execute();

  // 0016's `keysOf` shape, plus the connection: two connections can carry the
  // same `public.invoices` and their files must not merge.
  await db.schema.alterTable(files).addColumn('entity_connection_id', c.id).execute();
  await db.schema.alterTable(files).addColumn('entity_table', c.str(AUDIT_ENTITY_KEY_MAX)).execute();
  await db.schema.alterTable(files).addColumn('entity_id', c.str(AUDIT_ENTITY_KEY_MAX)).execute();

  // The record panel's exact access path: equality on all three.
  // 36 (id) + 2×200×4 utf8mb4 bytes stays under MySQL's 3072-byte InnoDB cap.
  await db.schema
    .createIndex('idx_adminium_files_entity')
    .on(files)
    .columns(['entity_connection_id', 'entity_table', 'entity_id'])
    .execute();

  // Both halves of the daily sweep (D12), which filter by state and order by age.
  await db.schema
    .createIndex('idx_adminium_files_state')
    .on(files)
    .columns(['deleted_at', 'attached_at', 'created_at'])
    .execute();
}
