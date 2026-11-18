// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0094 — what a website chat's automatic answerer spent today.
 *
 * Two tables, both written only by the server's answerer:
 *
 *  - `chat_ai_days`: one row per chat install, add-on and UTC day, with the
 *    tokens the day's calls spent and the tokens the calls running now hold.
 *    A call reserves before it is made and settles after, so calls at once
 *    never pass the chat's daily limit together.
 *  - `chat_ai_addresses`: one row per network address (a keyed hash, never the
 *    address) and conversation the answerer was asked for that day, so one
 *    address can have automatic answers in a bounded number of conversations
 *    a day. These rows are swept two days on.
 *
 * Neither is a setting: no settings route, config import, export or archive
 * reads or writes them, so nobody sets a day's spend back.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The longest install id (an add-on install's id). */
export const CHAT_AI_INSTALL_WIDTH = 64;
/** The longest add-on key (an add-on's manifest key). */
export const CHAT_AI_ADD_ON_WIDTH = 80;
/** A UTC day, `YYYY-MM-DD`. */
export const CHAT_AI_DAY_WIDTH = 10;
/** The longest address hash: a prefix and a keyed hash. */
export const CHAT_AI_ADDRESS_WIDTH = 128;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('chat_ai_days'))
    .ifNotExists()
    .addColumn('install_id', c.str(CHAT_AI_INSTALL_WIDTH), (col) => col.notNull())
    .addColumn('add_on', c.str(CHAT_AI_ADD_ON_WIDTH), (col) => col.notNull())
    .addColumn('day', c.str(CHAT_AI_DAY_WIDTH), (col) => col.notNull())
    .addColumn('tokens_spent', c.bigint, (col) => col.notNull())
    .addColumn('tokens_reserved', c.bigint, (col) => col.notNull())
    .addColumn('changed_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_chat_ai_days', ['install_id', 'add_on', 'day'])
    .execute();

  await db.schema
    .createTable(metaTable('chat_ai_addresses'))
    .ifNotExists()
    .addColumn('install_id', c.str(CHAT_AI_INSTALL_WIDTH), (col) => col.notNull())
    .addColumn('add_on', c.str(CHAT_AI_ADD_ON_WIDTH), (col) => col.notNull())
    .addColumn('day', c.str(CHAT_AI_DAY_WIDTH), (col) => col.notNull())
    .addColumn('address_hash', c.str(CHAT_AI_ADDRESS_WIDTH), (col) => col.notNull())
    .addColumn('conversation_id', c.bigint, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_chat_ai_addresses', ['install_id', 'add_on', 'day', 'address_hash', 'conversation_id'])
    .execute();
  // The sweep: the days older than any cap reads.
  await db.schema.createIndex('ix_adminium_chat_ai_addresses_day').on(metaTable('chat_ai_addresses')).columns(['day']).execute();
}
