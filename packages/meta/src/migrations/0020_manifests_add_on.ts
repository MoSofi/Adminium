// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0020 — the add-on half of `adminium_manifests`, plus the attachment
 * table an add-on needs and an app does not
 * (26-add-on-runtime.md §4, as amended 2026-08-29).
 *
 * ─── This ALTERs. It does not create. ───────────────────────────────────────
 *
 * 26 §4 as first written said `adminium_manifests` "does not exist at all
 * today, so this creates it rather than altering it", and `research/BRIEF.md`
 * §6 and `16-milestones.md` M16-T02 repeated it. All three were wrong: the
 * table has shipped since `0006_platform.ts:319-348`. It has no repo, no
 * writer and zero rows, which is how three documents came to record a shipped
 * table as absent — and it is why this migration adds two columns to something
 * that is already there rather than creating a fourth copy of the idea.
 *
 * Three shipped columns this plan never accounted for come along for the ride:
 * `connection_id`, `status`, and **`license_key_encrypted`** — a column 17
 * defers by name. It is deliberately left alone rather than dropped: it is
 * empty, dropping a column is the one irreversible thing a migration can do,
 * and "17 defers licences" is an argument for never WRITING it, which costs
 * nothing to honour. `repos/manifests.ts` never reads or writes it.
 *
 * ─── Why attachments are a table and not `attached_to` on the row ───────────
 *
 * 26 O3 asks how one add-on attaches to several hosts and recommends "two rows,
 * keyed `(manifest_key, attached_to)`". **This does not do that**, and the
 * reason is a cost O3 could not have weighed, because it was written believing
 * the table did not exist yet:
 *
 *  1. **Two rows means two manifest documents.** `manifest` is the whole
 *     validated JSON. An add-on attached to two hosts would store it twice, and
 *     every upgrade would have to rewrite N rows atomically to avoid a
 *     deployment where one attachment is on 1.1.0 and the other on 1.0.0.
 *  2. **It makes the credential FK ambiguous.** `adminium_add_on_credentials`
 *     (0021) is one row per CONNECTED add-on — a DHL API key belongs to the
 *     add-on, not to one of its attachments. With two manifest rows, that FK
 *     points at whichever row happened to be inserted first, and disconnecting
 *     "the other one" either orphans a secret or deletes a live one.
 *  3. **It requires editing a shipped constraint.** `uq_adminium_manifests_manifest_key`
 *     is UNIQUE on `manifest_key` ALONE (`0006_platform.ts:344-348`). Two rows
 *     per key violates it, so O3's shape means dropping and recreating a shipped
 *     index across three dialects — against §4's own "never edit a shipped
 *     migration".
 *
 * An attachment is a many-to-many fact between a manifest and a host app, so it
 * gets the table that models one. The shipped unique index stays true (one
 * manifest, one row, one document, one credential), and `attaches` in the
 * manifest stays what it always was: the set of hosts this add-on MAY attach to,
 * of which the rows below record the ones it actually is attached to.
 *
 * ─── Why `disabled_at` and not a boolean ───────────────────────────────────
 *
 * §5.1's `PATCH /add-ons/:key` enables and disables per surface, and that state
 * belongs on the attachment rather than on the manifest: an add-on can be
 * legitimately live on one host and switched off on another. The timestamp
 * follows 0019's discipline verbatim — NULL means enabled, and "how long has
 * this been off" is the question that follows a disable, which a boolean cannot
 * answer.
 *
 * ─── Backfill ──────────────────────────────────────────────────────────────
 *
 * None, and not for the usual reason: the table has zero rows in every
 * deployment, because nothing has ever written to it. `kind` still carries a
 * default so the column is honest about what a pre-existing row would have
 * meant — `adminium_manifests` was introduced for installed micro-SaaS apps
 * (13-marketplace.md), so an unlabelled row is an app.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  // `kind` — 'app' | 'add-on' (@adminium/manifest MANIFEST_KINDS). An add-on IS
  // a manifest (26 §4), so install, upgrade, uninstall and the audit trail need
  // no parallel code path; this column is what tells the two apart.
  await db.schema
    .alterTable(metaTable('manifests'))
    .addColumn('kind', c.str(12), (col) => col.notNull().defaultTo('app'))
    .execute();

  await db.schema
    .createTable(metaTable('manifest_attachments'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    // The host app's `manifest_key` (24 §5.7) — 80 to match
    // `adminium_manifests.manifest_key`, the column it points at by value.
    .addColumn('attached_to', c.str(80), (col) => col.notNull())
    /** NULL = enabled on this host. Epoch ms, never a native datetime. */
    .addColumn('disabled_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    // CASCADE, unlike the shipped manifests FKs' `set null`: an attachment with
    // no manifest is not a degraded row, it is a row that means nothing. A
    // named table-level constraint because MySQL parses an inline column-level
    // `REFERENCES` and silently discards it (the 2026-07-20 CI onion).
    .addForeignKeyConstraint(
      'fk_adminium_manifest_attachments_manifest_id',
      ['manifest_id'],
      metaTable('manifests'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // One attachment per (manifest, host). Re-attaching is idempotent rather than
  // a second row, and the enable/disable state has one home.
  await db.schema
    .createIndex('uq_adminium_manifest_attachments_pair')
    .on(metaTable('manifest_attachments'))
    .columns(['manifest_id', 'attached_to'])
    .unique()
    .execute();

  // The read the runtime actually makes: "what is attached to this host app,
  // and is it on?" — `GET /api/v1/add-ons` runs it on every host page load.
  await db.schema
    .createIndex('ix_adminium_manifest_attachments_host')
    .on(metaTable('manifest_attachments'))
    .columns(['attached_to'])
    .execute();
}
