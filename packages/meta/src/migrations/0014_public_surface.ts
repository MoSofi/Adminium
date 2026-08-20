// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0014 — the public surface (28-public-surface.md §3).
 *
 * Four tables behind the scoped, off-by-default `/api/v1/public` namespace:
 * the browser-safe key kind, the scope document that says what a key may reach,
 * the end-customer session a `claim` mints, and the one-time challenge the
 * `email-code` claim tier needs.
 *
 * WHY THESE ARE NOT `adminium_api_keys` ROWS WITH A `kind` COLUMN (28 §3.3).
 * Two properties diverge and both are load-bearing:
 *
 *  1. The secret is RE-READABLE by an admin. `adminium_api_keys` reveals once
 *     and never again, which is right for a server-side credential a human
 *     copies into a deployment. An `adm_pub_` secret lives in a public bundle
 *     and has to survive a rebuild months later, so the row keeps a reversible
 *     copy alongside the hash.
 *  2. A publishable key is NEVER an `RbacPrincipal` (28 D3). `parseBearerApiKey`
 *     gates on the `adm_sk_` prefix, so a token from this table cannot resolve
 *     through the rbac plugin at all — which is what makes it inert on every
 *     other route BY CONSTRUCTION rather than by an allow-list somebody has to
 *     maintain. Sharing a table would invite exactly the `kind`-check-per-route
 *     that property exists to avoid.
 *
 * NO SETTINGS TABLE HERE, deliberately (28 D20). Tenant configuration is
 * hybrid: the only key Adminium must own is the `timezone` it needs to
 * interpret its own `timestamptz` values, and that rides on the SCOPE document
 * below — already per-connection, already operator-authored, already served on
 * `/public/config`. A global settings key would be one line cheaper and wrong
 * the moment an instance holds two connections for businesses in different
 * zones. Everything else an app needs (tax rates, tip presets, opening hours)
 * stays in the app's own tables, where the generated dashboard edits it for
 * free.
 *
 * `0013_connection_last_error_hint` is the latest applied migration; never edit
 * a shipped one (the one-time checksum exception in `index.ts` was pre-release).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  /*
   * The scope document. One row per (connection, side) the operator publishes.
   *
   * `document` is the compiled-from JSON: resources, their logical refs, the
   * `expose` column allow-list, `filterable`/`searchable`/`orderable`, the
   * mandatory `where` predicate, and the claim strategy. It is validated by
   * `compileScope` on every write and on every boot — never trusted from disk.
   *
   * `timezone` is a COLUMN rather than a field inside `document` because it is
   * the one datum the SERIALIZER needs, not the caller: a reader has to reach it
   * without parsing and validating the whole document first.
   *
   * `proposed_from_manifest` records whether this row was seeded from a
   * manifest's `publicApi.propose` block (O2 option b) or authored from scratch
   * in Studio (option c). It exists so widening past a publisher's proposal can
   * be audited, and it is nullable because option (c) is unblocked today and
   * option (b) is not yet ruled.
   */
  await db.schema
    .createTable(metaTable('public_scopes'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('side', c.str(16), (col) => col.notNull())
    .addColumn('name', c.str(80), (col) => col.notNull())
    /** IANA zone, e.g. `Europe/London`. Required — see 28 D20. */
    .addColumn('timezone', c.str(64), (col) => col.notNull())
    .addColumn('document', c.json, (col) => col.notNull())
    .addColumn('proposed_from_manifest', c.str(80))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_public_scopes_connection',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_public_scopes_created_by',
      ['created_by'],
      metaTable('users'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('ix_adminium_public_scopes_connection')
    .on(metaTable('public_scopes'))
    .columns(['connection_id'])
    .execute();

  /*
   * The publishable key.
   *
   * `token_hash` is what a request is verified against. `token_encrypted` is the
   * reversible copy that makes the secret re-readable (see the header) — it uses
   * the same `dsnCryptoFromSecret` envelope as connection DSNs, so it is
   * unreadable without `ADMINIUM_SECRET` and it never leaves the server except
   * through an authenticated reveal.
   *
   * `origins` is a JSON array narrowing the instance-wide
   * `ADMINIUM_PUBLIC_API_ORIGINS` allow-list for this one key. Empty array means
   * "no narrowing" — it does NOT mean "any origin", because the env var is
   * always the outer bound.
   *
   * `scope_id` is `restrict` on delete, not `cascade`: deleting a scope out from
   * under a live key would silently turn a working public surface into a 500,
   * so the operator has to revoke the key first and see what they are breaking.
   */
  await db.schema
    .createTable(metaTable('public_keys'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(80), (col) => col.notNull())
    /** Display fragment, e.g. `adm_pub_4f2a91cd`. */
    .addColumn('prefix', c.str(32), (col) => col.notNull())
    .addColumn('token_hash', c.str(128), (col) => col.notNull())
    .addColumn('token_encrypted', c.text, (col) => col.notNull())
    .addColumn('scope_id', c.id, (col) => col.notNull())
    .addColumn('side', c.str(16), (col) => col.notNull())
    .addColumn('origins', c.json, (col) => col.notNull())
    .addColumn('expires_at', c.ts)
    .addColumn('revoked_at', c.ts)
    .addColumn('last_used_at', c.ts)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_public_keys_scope',
      ['scope_id'],
      metaTable('public_scopes'),
      ['id'],
      (cb) => cb.onDelete('restrict'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_public_keys_created_by',
      ['created_by'],
      metaTable('users'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  /* Lookup is by prefix on every public request — the hot path of this wave. */
  await db.schema
    .createIndex('ix_adminium_public_keys_prefix')
    .on(metaTable('public_keys'))
    .columns(['prefix'])
    .execute();

  /*
   * The end-customer session minted by `POST /public/claim` (28 §3.4).
   *
   * `grants` is the resolved claim — the mandatory predicate later requests are
   * filtered by, e.g. "patient_id = 41". It is stored RESOLVED rather than
   * re-derived per request so that editing a scope cannot retroactively widen a
   * session that is already in someone's browser.
   *
   * There is no `user_id`. An end customer is deliberately NOT an
   * `adminium_users` row (28 §3.4) — Adminium grows no second identity system,
   * and this table is the whole of what a claimed customer is.
   */
  await db.schema
    .createTable(metaTable('public_sessions'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('key_id', c.id, (col) => col.notNull())
    .addColumn('token_hash', c.str(128), (col) => col.notNull())
    .addColumn('grants', c.json, (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('last_seen_at', c.ts)
    .addForeignKeyConstraint(
      'fk_adminium_public_sessions_key',
      ['key_id'],
      metaTable('public_keys'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('ix_adminium_public_sessions_token_hash')
    .on(metaTable('public_sessions'))
    .columns(['token_hash'])
    .execute();

  /*
   * One-time challenges for the `email-code` claim tier (28 D11/D17).
   *
   * `attempts` is on the row rather than in a counter elsewhere because the
   * containment property this tier is bought for — a low-entropy code is only
   * safe if guesses are bounded — has to survive a process restart, and the
   * rate limiter is an in-process `Map` that does not.
   *
   * `destination_hash` rather than the address itself: a challenge table is a
   * list of customer email addresses otherwise, which is a needless standing
   * disclosure for a row whose whole life is five minutes.
   */
  await db.schema
    .createTable(metaTable('public_challenges'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('key_id', c.id, (col) => col.notNull())
    .addColumn('ref', c.str(64), (col) => col.notNull())
    .addColumn('destination_hash', c.str(128), (col) => col.notNull())
    .addColumn('code_hash', c.str(128), (col) => col.notNull())
    .addColumn('attempts', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('consumed_at', c.ts)
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_public_challenges_key',
      ['key_id'],
      metaTable('public_keys'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('ix_adminium_public_challenges_key_ref')
    .on(metaTable('public_challenges'))
    .columns(['key_id', 'ref'])
    .execute();
}
