// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0031 — the document RENDER REGISTER and its machinery
 * (34-invoices-add-on.md §3.3, 34-T08).
 *
 * ─── This is not the invoice editor's table, and the two must not merge ────
 *
 * `adminium_invoice_documents` (0027) holds what a person TYPED and can edit
 * again — templates and invoices, one editor, one canvas. The tables here
 * record what was ISSUED: a frozen subject, a minted number, the bytes that
 * were produced, and who asked. Rendering an authored invoice writes a
 * register row pointing back at it; deleting a template does not unmake a
 * document already issued from it, which is the whole reason these are
 * separate rows rather than a status column on that one.
 *
 * ─── THE MIGRATION NUMBER MOVED THREE TIMES, AND THAT IS THE LESSON ───────
 *
 * §3.3 called this 0023, then 0025, then 0026, each time because another wave
 * merged first. It is 0031 because `ls packages/meta/src/migrations/` said so
 * on 2026-09-10 — disk is the authority, never the plan's line, and 37 D36
 * says the same from the other side. Every bare "0023"/"0025"/"0026" in that
 * document means THIS migration.
 *
 * ─── The uninstall rule, first, because it shapes every column ─────────────
 *
 * Nothing here has a foreign key to `adminium_manifests`. Uninstalling an
 * add-on deletes its manifest row, and documents must SURVIVE that (D5, and
 * 24 D16 — uninstall keeps data): a business that removes the add-on that
 * drew its invoices still has the invoices, and still has to be able to hand
 * one to an auditor two years later. So `add_on_key` is a SOFT string
 * reference throughout, the way `job_id` is, and the only cascade in the file
 * is `adminium_documents.profile_id → SET NULL`.
 *
 * That is also why the register carries a frozen `subject` rather than
 * pointing at the row it came from. The source row can be edited, archived or
 * deleted; what was issued cannot change afterwards (25 D12). A register that
 * re-derived its content would be a register of what things look like NOW,
 * which is not what an issued document is.
 *
 * ─── `number` has no unique index, and that is deliberate (D11) ────────────
 *
 * A document number is claimed from `adminium_document_sequences` by
 * compare-and-set AFTER a successful render, so a failed render burns no
 * number and leaves `number: null`. A partial unique index over
 * `(profile_id, number)` would be the obvious guard and is wrong twice: it
 * cannot be expressed portably across the three dialects, and it would turn a
 * legitimate re-render — a voided document reissued under the same number —
 * into a constraint violation. The CAS on the sequence is the mechanism; the
 * index below is for reading.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const profiles = metaTable('document_profiles');
  const documents = metaTable('documents');
  const sequences = metaTable('document_sequences');
  const addOnSettings = metaTable('add_on_settings');
  const connections = metaTable('connections');
  const files = metaTable('files');
  const users = metaTable('users');

  // --- adminium_document_profiles ------------------------------------------
  /*
   * An operator's answer to "which columns of which table make one of these
   * documents". Generated in Studio from the provider's own `describe(kind)`,
   * so the SLOT IDS in `mapping` are the provider's vocabulary and this table
   * never has an opinion about them.
   */
  await db.schema
    .createTable(profiles)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    /** SOFT ref to `manifests.manifest_key` — no FK; see the header. */
    .addColumn('add_on_key', c.str(80), (col) => col.notNull())
    /** The provider's kind: `invoice`, `receipt`, `label-sheet`. */
    .addColumn('kind', c.str(40), (col) => col.notNull())
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    /** Qualified source name, e.g. `public.orders`. */
    .addColumn('table', c.str(200), (col) => col.notNull())
    /** `{ slotId → {column} | {ref, column} | {collection: {...}} }`. */
    .addColumn('mapping', c.json, (col) => col.notNull())
    /** Prefix, paper, formats, locale (`'viewer'` or a tag). */
    .addColumn('options', c.json, (col) => col.notNull())
    /** `{event, when?}` or null — see `trigger_owner` below. */
    .addColumn('trigger', c.json)
    /** `{store, email?, writeBack?}`. */
    .addColumn('deliver', c.json, (col) => col.notNull())
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(true))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_document_profiles_connection',
      ['connection_id'],
      connections,
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_document_profiles_created_by',
      ['created_by'],
      users,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  /*
   * One profile per (add-on, kind, connection, table, name). The NAME is in
   * the key on purpose: two invoice profiles over one orders table is a real
   * thing — "Invoice" and "Proforma" differ only in their options — and a key
   * without it would force one of them into a second table.
   */
  await db.schema
    .createIndex('ux_adminium_document_profiles_identity')
    .on(profiles)
    .columns(['add_on_key', 'kind', 'connection_id', 'table', 'name'])
    .unique()
    .execute();

  // --- adminium_documents ---------------------------------------------------
  await db.schema
    .createTable(documents)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    /** SET NULL, never CASCADE: a deleted profile must not unmake a document. */
    .addColumn('profile_id', c.id)
    .addColumn('add_on_key', c.str(80), (col) => col.notNull())
    .addColumn('kind', c.str(40), (col) => col.notNull())
    .addColumn('connection_id', c.id)
    /*
     * The 0016 pattern: the full `RecordRef` as json for reading, plus the two
     * denormalised columns for the index. `entity` is null for a
     * request-shaped intent — a public caller's document has no source row
     * (D15) — which is exactly why the columns are nullable and the fallback
     * visibility rule in the routes exists at all.
     */
    .addColumn('entity', c.json)
    .addColumn('entity_table', c.str(200))
    .addColumn('entity_id', c.str(200))
    /** The frozen `DocumentSubject` (25 D12). The register's whole point. */
    .addColumn('subject', c.json, (col) => col.notNull())
    /** Null until a render succeeds and the CAS claims one. */
    .addColumn('number', c.str(60))
    .addColumn('file_id', c.id)
    .addColumn('html_file_id', c.id)
    .addColumn('locale', c.str(8), (col) => col.notNull())
    .addColumn('format', c.str(8), (col) => col.notNull())
    /** `rendered` | `failed` | `voided` | `skipped`. */
    .addColumn('status', c.str(10), (col) => col.notNull())
    .addColumn('error', c.text)
    /*
     * `sent` | `pending-review` | `not-sent:smtp-unconfigured` |
     * `not-sent:no-email` | `not-sent:no-file` | `skipped`. A public caller's document starts
     * `pending-review` and a person presses send (D15) — the job never emails
     * one unattended.
     */
    .addColumn('delivery', c.str(40))
    .addColumn('sent_at', c.ts)
    /** Soft ref — a job row is pruned long before the document is. */
    .addColumn('job_id', c.id)
    .addColumn('requested_by', c.id)
    /** `user` | `system` | `api-key`. */
    .addColumn('actor_kind', c.str(12), (col) => col.notNull())
    /** `{column, value}`, stamped LAST for an intent row. */
    .addColumn('claim', c.json)
    .addColumn('rendered_at', c.ts)
    .addColumn('voided_at', c.ts)
    .addColumn('void_reason', c.str(40))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_documents_profile',
      ['profile_id'],
      profiles,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_documents_file',
      ['file_id'],
      files,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_documents_html_file',
      ['html_file_id'],
      files,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  /** "Every document issued for this row" — the record page's panel. */
  await db.schema
    .createIndex('ix_adminium_documents_entity')
    .on(documents)
    .columns(['entity_table', 'entity_id'])
    .execute();

  /** "This profile's documents, by number" — the register view. No unique (D11). */
  await db.schema
    .createIndex('ix_adminium_documents_profile_number')
    .on(documents)
    .columns(['profile_id', 'number'])
    .execute();

  // --- adminium_document_sequences ------------------------------------------
  /*
   * The number source, claimed by compare-and-set. `key` is the profile id, or
   * `<add_on_key>:<kind>:<connection_id>` for a profile-less intent — a public
   * caller's document still needs a number and has no profile to hang one on.
   *
   * A row per key rather than a counter column on the profile, because intents
   * have no profile row to carry one, and because a CAS against a table with
   * one narrow row is the cheapest form of the operation on all three
   * dialects.
   */
  await db.schema
    .createTable(sequences)
    .ifNotExists()
    .addColumn('key', c.str(120), (col) => col.primaryKey())
    .addColumn('next', c.int, (col) => col.notNull().defaultTo(1))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();

  // --- adminium_add_on_settings ---------------------------------------------
  /*
   * An add-on's own non-secret values — the settings panel's store, which
   * every add-on with a panel has needed since wave 4 and none has had.
   *
   * SECRETS DO NOT GO HERE. They belong in 0021's credentials table, which is
   * encrypted; the repo refuses a key the manifest marks `secret`, so a
   * mistake at the route layer cannot put one in a table the settings API
   * reads back in clear.
   *
   * Uninstall CLEARS this row explicitly (§7.10), and that is the one place
   * the "uninstall keeps data" rule bends on purpose: 24 D16 keeps the
   * customer's DATA, and an add-on's own configuration is not that — it is
   * part of the add-on, and it goes with it exactly as a credential does.
   */
  await db.schema
    .createTable(addOnSettings)
    .ifNotExists()
    /** SOFT ref to `manifests.manifest_key` — no FK; see the header. */
    .addColumn('add_on_key', c.str(80), (col) => col.primaryKey())
    .addColumn('values', c.json, (col) => col.notNull())
    .addColumn('updated_by', c.id)
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_add_on_settings_updated_by',
      ['updated_by'],
      users,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();
}
