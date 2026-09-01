// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0021 — `adminium_add_on_credentials`: the secret a connected add-on was
 * given, and nothing else (26-add-on-runtime.md §4, D2, D5).
 *
 * ─── One row per connected add-on ──────────────────────────────────────────
 *
 * Not per attachment. A DHL API key belongs to the add-on the operator
 * connected, not to each host app it happens to be mounted on — connecting it
 * twice because it is attached twice would mean two copies of one secret, two
 * places to revoke, and a disconnect that leaves one behind. The unique index
 * on `manifest_id` is what makes "connected" a boolean fact about an add-on.
 *
 * ─── What is stored, and what is deliberately not ──────────────────────────
 *
 * `payload` is AES-256-GCM ciphertext over the whole credential envelope,
 * encrypted with a key derived from `ADMINIUM_SECRET` — the same discipline
 * `adminium_connections` uses for DSNs, reached through the same
 * `config/secrets.ts` helpers rather than a second crypto path. Its plaintext
 * shape is a JSON object whose keys differ per `kind`, which is precisely why
 * it is one opaque column and not a set of typed ones: an `api-key` credential
 * and an `oauth2` token pair have nothing in common worth normalising, and
 * columns named `access_token` invite a log line that prints them.
 *
 * `expires_at` and `scopes` sit OUTSIDE the ciphertext on purpose. Both are
 * needed to decide whether to refresh and what the consent dialog should say,
 * and neither is a secret — putting them inside would mean decrypting a token
 * to find out it had expired, on every request.
 *
 * There is no `refresh_token` column. It lives inside `payload` with the access
 * token, because a refresh token IS the credential once an access token lapses,
 * and a schema that stores it beside the ciphertext rather than inside it is a
 * schema that will eventually have it read by something that thought it was
 * metadata.
 *
 * ─── D5: disconnect deletes this row, and only this row ────────────────────
 *
 * 24 D16 / 26 D5 — disconnecting keeps every table the add-on brought and
 * destroys the keys. That is a DELETE here plus nothing anywhere else, which is
 * a property the schema should make easy to get right: this table holds only
 * secrets, so "delete the secrets" is one statement and cannot take data with
 * it by accident.
 *
 * The FK cascades for the uninstall path — a credential outliving its manifest
 * is an orphaned secret nothing can reach to revoke, which is strictly worse
 * than one that is gone.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('add_on_credentials'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    /** `api-key` | `oauth2` — `none` never reaches this table (D2). */
    .addColumn('kind', c.str(12), (col) => col.notNull())
    /** AES-256-GCM ciphertext over the whole envelope. Never logged, never served. */
    .addColumn('payload', c.text, (col) => col.notNull())
    /** Epoch ms; NULL for a credential that does not expire (an API key). */
    .addColumn('expires_at', c.ts)
    /** The granted OAuth scopes, for the consent surface. Not a secret. */
    .addColumn('scopes', c.json)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    // Named and table-level: MySQL parses an inline column-level `REFERENCES`
    // and silently discards it, which would leave the cascade below existing
    // only in this file (the 2026-07-20 CI onion).
    .addForeignKeyConstraint(
      'fk_adminium_add_on_credentials_manifest_id',
      ['manifest_id'],
      metaTable('manifests'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // One credential per add-on — see the header. Unique rather than merely
  // indexed, so a second connect is an upsert and can never become a duplicate
  // secret the disconnect path would miss.
  await db.schema
    .createIndex('uq_adminium_add_on_credentials_manifest')
    .on(metaTable('add_on_credentials'))
    .columns(['manifest_id'])
    .unique()
    .execute();
}
