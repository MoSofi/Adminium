// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0103 — a staff account's new sign-in address, waiting to be confirmed.
 *
 * One row per account at most: asking again replaces it. Only the link's hash
 * is kept. The account's own address does not change until the link is opened
 * by that account, so a row here reserves nothing and grants nothing.
 * `sent_count` and `window_at` cap how many links one account can have sent to
 * addresses it may not own.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('email_changes'))
    .ifNotExists()
    .addColumn('user_id', c.id, (col) => col.primaryKey())
    .addColumn('new_email', c.str(320), (col) => col.notNull())
    .addColumn('token_hash', c.str(64), (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('sent_count', c.int, (col) => col.notNull())
    .addColumn('window_at', c.ts, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    // In the one statement: MySQL has no transactional DDL, so a second statement could not be re-run after a crash.
    .addUniqueConstraint('uq_adminium_email_changes_token_hash', ['token_hash'])
    .addForeignKeyConstraint('fk_adminium_email_changes_user_id', ['user_id'], metaTable('users'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
}
