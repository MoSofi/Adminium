// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0095 — the answerer's notes on a network address: three hours, and
 * never with a conversation.
 *
 * 0094 kept one row per address hash AND conversation id for a UTC day: a
 * join of a visitor's (hashed) network address to their conversation that
 * lived a day or more and that no erasure could find. The promise is that
 * no address is kept with a conversation and its keyed hash counts for
 * three hours only. So that table goes, unread, and is made again as:
 *
 *  - one row per model call the answerer made for an address (a keyed hash,
 *    never the address): the install, the add-on, the hash, whether the
 *    call was the first of a NEW conversation (`first`, 1 or 0), the tokens
 *    it held and then spent, and when;
 *  - no conversation id, no day: the caps read the last three hours ("20
 *    new conversations per address", "one address spends at most a fifth of
 *    the day's tokens"), and a row older than that is never read and is
 *    deleted on the next write and by an hourly sweep.
 *
 * Still not a setting: no settings route, config import, export or archive
 * reads or writes it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { CHAT_AI_ADDRESS_WIDTH, CHAT_AI_ADD_ON_WIDTH, CHAT_AI_INSTALL_WIDTH } from './0094_chat_ai_tally.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  // Its rows join an address to a conversation: nothing in them is kept.
  await db.schema.dropTable(metaTable('chat_ai_addresses')).ifExists().execute();
  await db.schema
    .createTable(metaTable('chat_ai_addresses'))
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('install_id', c.str(CHAT_AI_INSTALL_WIDTH), (col) => col.notNull())
    .addColumn('add_on', c.str(CHAT_AI_ADD_ON_WIDTH), (col) => col.notNull())
    .addColumn('address_hash', c.str(CHAT_AI_ADDRESS_WIDTH), (col) => col.notNull())
    .addColumn('first', c.int, (col) => col.notNull())
    .addColumn('tokens', c.bigint, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  // A cap's count: one address's calls on one chat since a moment.
  await db.schema
    .createIndex('ix_adminium_chat_ai_addresses_hash')
    .on(metaTable('chat_ai_addresses'))
    .columns(['address_hash', 'install_id', 'add_on', 'created_at'])
    .execute();
  // The sweep: what is older than any cap reads.
  await db.schema.createIndex('ix_adminium_chat_ai_addresses_created').on(metaTable('chat_ai_addresses')).columns(['created_at']).execute();
}
