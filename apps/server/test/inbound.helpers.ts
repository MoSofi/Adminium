// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inbound events table, as the migration will make it.
 *
 * No migration makes it yet. This body is what moves into
 * `packages/meta/src/migrations/` when one does, under the next free number.
 */
import { columnHelpers, metaTable, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

export async function makeInboundTables(meta: MetaDb): Promise<void> {
  const db = meta.db as unknown as Kysely<unknown>;
  const c = columnHelpers(meta.dialect);
  const table = metaTable('inbound_events');

  await db.schema
    .createTable(table)
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
  await db.schema.createIndex('ux_adminium_inbound_events_key').on(table).columns(['channel', 'account', 'provider_id']).unique().execute();
  await db.schema.createIndex('ix_adminium_inbound_events_state').on(table).columns(['state', 'received_at', 'id']).execute();
  await db.schema.createIndex('ix_adminium_inbound_events_subject').on(table).columns(['subject_hash', 'key_version']).execute();
  await db.schema.createIndex('ix_adminium_inbound_events_retain').on(table).columns(['retain_until']).execute();
}
