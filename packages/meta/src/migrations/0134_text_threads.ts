// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0134 — two-way text conversations: one thread per customer number and
 * app, and the messages in it.
 *
 * `text_threads`: found by the number's keyed hash under `key_version`, and the
 * app the thread belongs to (`app_key`, empty when no app texted the number).
 * Unique together, so two replies arriving at once make one thread.
 * `phone_encrypted` is the number, sealed under a key taken from the address
 * keys, for the console to show and a reply to go to. It holds no name: the
 * record a staff text was sent from is named by its key alone.
 *
 * `text_thread_messages`: what the customer wrote, what staff answered, and the
 * STOP or START that was read. `sealed_body` is the words, sealed under a key
 * taken from the address keys. A reply's delivery is found by `delivery_id`;
 * the delivery record holds its state and never the words. `event_id` is the
 * inbound event a message came from. Both are unique, so a retried event or a
 * reply sent again with its key adds nothing; every engine lets NULLs repeat.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

/** A keyed hash: HMAC-SHA256 as hex. */
const HASH_LENGTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const threads = metaTable('text_threads');
  await db.schema
    .createTable(threads)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('phone_hash', c.str(HASH_LENGTH), (col) => col.notNull())
    .addColumn('key_version', c.int, (col) => col.notNull())
    .addColumn('app_key', c.str(64), (col) => col.notNull())
    .addColumn('phone_encrypted', c.text)
    .addColumn('phone_masked', c.str(32))
    .addColumn('line', c.str(32))
    .addColumn('record_connection', c.id)
    .addColumn('record_table', c.str(255))
    .addColumn('record_key', c.str(191))
    .addColumn('last_at', c.ts, (col) => col.notNull())
    .addColumn('last_direction', c.str(4), (col) => col.notNull())
    .addColumn('last_kind', c.str(16), (col) => col.notNull())
    .addColumn('unread', c.int, (col) => col.notNull())
    .addColumn('read_at', c.ts)
    .addColumn('read_by_id', c.id)
    .addColumn('read_by_label', c.str(255))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_text_threads_phone', threads, ['phone_hash', 'key_version', 'app_key'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_threads_last', threads, ['last_at', 'id']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_threads_app', threads, ['app_key', 'last_at']);

  const messages = metaTable('text_thread_messages');
  await db.schema
    .createTable(messages)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('thread_id', c.id, (col) => col.notNull())
    .addColumn('direction', c.str(4), (col) => col.notNull())
    .addColumn('kind', c.str(16), (col) => col.notNull())
    .addColumn('sealed_body', c.text)
    .addColumn('event_id', c.id)
    .addColumn('delivery_id', c.id)
    .addColumn('outcome', c.str(40))
    .addColumn('by_id', c.id)
    .addColumn('by_label', c.str(255))
    .addColumn('at', c.ts, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_thread_messages_thread', messages, ['thread_id', 'at', 'id']);
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_text_thread_messages_event', messages, ['event_id'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_text_thread_messages_delivery', messages, ['delivery_id'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_thread_messages_at', messages, ['at']);
}
