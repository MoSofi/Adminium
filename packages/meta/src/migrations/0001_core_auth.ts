// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0001 — core auth: adminium_users, adminium_user_prefs,
 * adminium_sessions, adminium_password_resets, adminium_settings
 * (07-meta-store.md §3.2–§3.6).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('users'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('email', c.str(320), (col) => col.notNull())
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('password_hash', c.text)
    .addColumn('status', c.str(20), (col) => col.notNull().defaultTo('active'))
    .addColumn('totp_secret_encrypted', c.text)
    .addColumn('totp_enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('recovery_codes', c.json)
    // Soft ref → adminium_files (wave 0003; SQLite cannot ALTER TABLE ADD FK, so no FK).
    .addColumn('avatar_file_id', c.id)
    .addColumn('last_login_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex('uq_adminium_users_email')
    .on(metaTable('users'))
    .columns(['email'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('user_prefs'))
    .ifNotExists()
    .addColumn('user_id', c.id, (col) => col.primaryKey())
    .addColumn('theme', c.str(10))
    .addColumn('accent', c.str(10))
    .addColumn('density', c.str(12))
    .addColumn('locale', c.str(5))
    .addColumn('dir', c.str(3))
    .addColumn('ui_state', c.json)
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_user_prefs_user_id', ['user_id'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable(metaTable('sessions'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('token_hash', c.str(64), (col) => col.notNull())
    .addColumn('user_id', c.id, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('last_seen_at', c.ts, (col) => col.notNull())
    .addColumn('ip', c.str(45))
    .addColumn('user_agent', c.str(300))
    .addColumn('revoked_at', c.ts)
    .addForeignKeyConstraint('fk_adminium_sessions_user_id', ['user_id'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_sessions_token_hash')
    .on(metaTable('sessions'))
    .columns(['token_hash'])
    .unique()
    .execute();
  await db.schema
    .createIndex('idx_adminium_sessions_user_id')
    .on(metaTable('sessions'))
    .columns(['user_id'])
    .execute();
  await db.schema
    .createIndex('idx_adminium_sessions_expires_at')
    .on(metaTable('sessions'))
    .columns(['expires_at'])
    .execute();

  await db.schema
    .createTable(metaTable('password_resets'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('user_id', c.id, (col) => col.notNull())
    .addColumn('kind', c.str(10), (col) => col.notNull())
    .addColumn('token_hash', c.str(64), (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('used_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_password_resets_user_id', ['user_id'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_password_resets_token_hash')
    .on(metaTable('password_resets'))
    .columns(['token_hash'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('settings'))
    .ifNotExists()
    .addColumn('key', c.str(120), (col) => col.primaryKey())
    .addColumn('value', c.json, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addColumn('updated_by', c.id)
    .addForeignKeyConstraint('fk_adminium_settings_updated_by', ['updated_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
}
