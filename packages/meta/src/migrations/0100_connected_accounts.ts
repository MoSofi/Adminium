// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0100 — connected accounts: several people's outside accounts on one
 * add-on install, each tied to a row of the app or to the install.
 *
 * ─── The one-row credential stays ───────────────────────────────────────────
 *
 * Payments, lead sources and the generic connect form read and upsert the one
 * `adminium_add_on_credentials` row per install, so its index is left alone.
 * For an add-on whose accounts are kept here, that row holds the APP
 * REGISTRATION (client id and secret): one place to rotate a secret, however
 * many people connected. Two new columns say the provider refused that client
 * (`refused_code`, `refused_at`), which is the install's state: six people do
 * not need to reconnect because a studio's secret ran out.
 *
 * ─── Three tables ───────────────────────────────────────────────────────────
 *
 *  - `connected_accounts`: who connected, as the provider says, with the tokens
 *    sealed in `payload`. `payload` is NULLABLE on purpose: an export or a
 *    restore under another secret clears it and the row stays, so the list
 *    reads "Reconnect" rather than forgetting who was connected.
 *  - `connect_links`: a link's SHA-256, what it may connect, and until when.
 *    One per target. Deleted when spent, so spent, replaced, expired and
 *    unknown all read the same to whoever holds the link.
 *  - `oauth_flows`: a sign-in in progress, so a flow survives a restart and a
 *    second process. It holds the state's and the browser nonce's hashes and a
 *    sealed PKCE verifier, and NEVER the client secret, which is read from the
 *    install's row at the exchange.
 *
 * ─── A target ───────────────────────────────────────────────────────────────
 *
 * `(connection_id, table_name, row_key)`. An install-level account uses the
 * empty connection, the table `@install` and the install's id as its row, so
 * one unique index covers both and no column is NULL in a key (MySQL's unique
 * indexes let NULLs repeat).
 */
import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The longest table name a target holds. */
export const CONNECTED_TABLE_WIDTH = 128;
/** The longest row key a target holds, in canonical text. */
export const CONNECTED_ROW_WIDTH = 191;
/** The provider's stable id for the account. */
export const CONNECTED_SUBJECT_WIDTH = 255;
/** An e-mail address. */
export const CONNECTED_ADDRESS_WIDTH = 320;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  /**
   * A target's text, compared exactly on every engine. A MySQL meta store's
   * collation folds case, and a row keyed `SKU-a` is not the row `SKU-A`: one
   * person's limit, or one person's connection, must not reach the other's.
   */
  const exact = (width: number) => (c.dialect === 'mysql' ? sql.raw(`varchar(${String(width)}) character set utf8mb4 collate utf8mb4_bin`) : c.str(width));

  // Separate statements: SQLite adds one column per ALTER.
  await db.schema.alterTable(metaTable('add_on_credentials')).addColumn('refused_code', c.str(32)).execute();
  await db.schema.alterTable(metaTable('add_on_credentials')).addColumn('refused_at', c.ts).execute();

  await db.schema
    .createTable(metaTable('connected_accounts'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    .addColumn('connection_id', c.str(36), (col) => col.notNull())
    .addColumn('table_name', exact(CONNECTED_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', exact(CONNECTED_ROW_WIDTH), (col) => col.notNull())
    /** The provider's stable id. Never the address, which a person can change. */
    .addColumn('subject', c.str(CONNECTED_SUBJECT_WIDTH), (col) => col.notNull())
    .addColumn('address', c.str(CONNECTED_ADDRESS_WIDTH))
    /** Sealed `{ accessToken, refreshToken }`. NULL: the secret could not travel, so it reads "Reconnect". */
    .addColumn('payload', c.text)
    .addColumn('expires_at', c.ts)
    .addColumn('refresh_expires_at', c.ts)
    .addColumn('scopes', c.json)
    .addColumn('state', c.str(16), (col) => col.notNull())
    .addColumn('state_since', c.ts, (col) => col.notNull())
    /** Bumped on every token write, so an older answer never overwrites a newer one. */
    .addColumn('version', c.int, (col) => col.notNull())
    /** Until when one process holds the right to refresh. */
    .addColumn('lease_until', c.ts)
    .addColumn('connected_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_connected_accounts_manifest', ['manifest_id'], metaTable('manifests'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await db.schema
    .createIndex('uq_adminium_connected_accounts_target')
    .on(metaTable('connected_accounts'))
    .columns(['manifest_id', 'connection_id', 'table_name', 'row_key'])
    .unique()
    .execute();
  await db.schema
    .createIndex('ix_adminium_connected_accounts_row')
    .on(metaTable('connected_accounts'))
    .columns(['connection_id', 'table_name', 'row_key'])
    .execute();

  await db.schema
    .createTable(metaTable('connect_links'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.str(36), (col) => col.notNull())
    .addColumn('table_name', exact(CONNECTED_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', exact(CONNECTED_ROW_WIDTH), (col) => col.notNull())
    /** The add-on keys this link may connect. */
    .addColumn('providers', c.json, (col) => col.notNull())
    /** `connect` | `reconnect`. */
    .addColumn('purpose', c.str(12), (col) => col.notNull())
    .addColumn('token_hash', c.str(64), (col) => col.notNull())
    .addColumn('created_by', c.str(64))
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema.createIndex('uq_adminium_connect_links_token').on(metaTable('connect_links')).columns(['token_hash']).unique().execute();
  await db.schema
    .createIndex('uq_adminium_connect_links_target')
    .on(metaTable('connect_links'))
    .columns(['connection_id', 'table_name', 'row_key'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('oauth_flows'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('state_hash', c.str(64), (col) => col.notNull())
    .addColumn('nonce_hash', c.str(64), (col) => col.notNull())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    .addColumn('connection_id', c.str(36), (col) => col.notNull())
    .addColumn('table_name', exact(CONNECTED_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', exact(CONNECTED_ROW_WIDTH), (col) => col.notNull())
    .addColumn('link_id', c.str(36), (col) => col.notNull())
    /** The PKCE verifier, sealed. */
    .addColumn('verifier_sealed', c.text, (col) => col.notNull())
    /** The address the flow was started with: the exchange must repeat it exactly. */
    .addColumn('redirect_uri', c.str(2048), (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_oauth_flows_manifest', ['manifest_id'], metaTable('manifests'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await db.schema.createIndex('uq_adminium_oauth_flows_state').on(metaTable('oauth_flows')).columns(['state_hash']).unique().execute();
  await db.schema
    .createIndex('uq_adminium_oauth_flows_link')
    .on(metaTable('oauth_flows'))
    .columns(['link_id'])
    .unique()
    .execute();
}
