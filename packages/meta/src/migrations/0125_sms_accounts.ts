// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0125 — the one SMS provider account of this server.
 *
 * Each business opens and pays for its own account. `slot` is always `server`,
 * and its unique index makes "one SMS account per server" a database fact.
 * Writes are compare-and-set on `revision`, because checking a key with the
 * provider is slow and happens outside any lock.
 *
 * `sealed_credentials` is an `enc:v1:` value under the key salted
 * `adminium:sms-credential:v1`. Everything else is safe to show: the account's
 * name is already masked, and `account_hint` is its last four characters.
 *
 * The person who saved it is a named, table-level foreign key (MySQL parses an
 * inline REFERENCES and drops it), SET NULL so removing them keeps the account.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('sms_accounts'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('slot', c.str(16), (col) => col.notNull())
    .addColumn('revision', c.int, (col) => col.notNull())
    // `twilio` or `telnyx`.
    .addColumn('provider', c.str(16), (col) => col.notNull())
    .addColumn('sealed_credentials', c.text, (col) => col.notNull())
    .addColumn('account_name', c.str(32))
    .addColumn('account_hint', c.str(16), (col) => col.notNull())
    // `full`, `trial`, or null when the provider does not say.
    .addColumn('account_type', c.str(8))
    // `number`, `name` or `pool`.
    .addColumn('sender_kind', c.str(8))
    .addColumn('sender_value', c.str(64))
    .addColumn('default_country', c.str(2))
    .addColumn('check_ok', c.bool, (col) => col.notNull())
    .addColumn('check_reason', c.str(32))
    .addColumn('check_at', c.ts, (col) => col.notNull())
    .addColumn('saved_at', c.ts, (col) => col.notNull())
    .addColumn('saved_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_sms_accounts_saved_by', ['saved_by'], metaTable('users'), ['id'], (cb) => cb.onDelete('set null'))
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'uq_adminium_sms_accounts_slot', metaTable('sms_accounts'), ['slot'], { unique: true });
}
