// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0127 — what a provider handed this server, stored once.
 *
 * Shared by every inbound channel. One row per `(channel, account,
 * provider_id)`, so a re-delivery finds the first.
 *
 * `provider_id` is an HMAC-SHA-256 hex digest under a key taken from the
 * address keys, never the raw id. MySQL's default collation is case-blind, so
 * two real ids differing only in case would count as one. And this mark
 * outlives an erasure while some ids are built from a phone number, so a plain
 * digest could be walked back to the number.
 *
 * `sealed_body` is the event, sealed under a key taken from the address keys.
 * It goes when the event finishes; a failed event keeps it for a retry.
 * `subject_hash` is the sender's keyed hash, which is what an erasure finds.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const table = metaTable('inbound_events');
  await db.schema
    .createTable(table)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('channel', c.str(16), (col) => col.notNull())
    .addColumn('account', c.str(64), (col) => col.notNull())
    .addColumn('provider_id', c.str(64), (col) => col.notNull())
    .addColumn('source', c.str(32), (col) => col.notNull())
    .addColumn('kind', c.str(32), (col) => col.notNull())
    .addColumn('state', c.str(12), (col) => col.notNull())
    .addColumn('subject_hash', c.str(64))
    .addColumn('key_version', c.int)
    .addColumn('sealed_body', c.text)
    .addColumn('attempts', c.int, (col) => col.notNull())
    .addColumn('reason', c.str(32))
    .addColumn('occurred_at', c.ts)
    .addColumn('received_at', c.ts, (col) => col.notNull())
    .addColumn('claimed_at', c.ts)
    .addColumn('finished_at', c.ts)
    .addColumn('retain_until', c.ts)
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_inbound_events_key', table, ['channel', 'account', 'provider_id'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_inbound_events_state', table, ['state', 'received_at', 'id']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_inbound_events_subject', table, ['subject_hash', 'key_version']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_inbound_events_retain', table, ['retain_until']);
}
