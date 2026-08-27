// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0016 — per-record audit lookup (30-record-pages.md WS-A).
 *
 * The record page's Activity tab needs "every audit entry for THIS record".
 * The entry's `entity` column stores a RecordRef, but as packed JSON text —
 * filtering on it means either a per-dialect JSON-extract expression (three
 * syntaxes, none of them indexable without generated columns) or a full scan
 * of the `data` category. Both are the amplification anti-pattern D6 exists
 * to rule out, so the ref's two lookup facts are denormalized into real,
 * indexed columns instead:
 *
 *   entity_table  the ref's qualified table ("public.invoices")
 *   entity_id     the canonical record-id string — `pkLabel` form: a single
 *                 PK stringified, a composite PK as the JSON value tuple —
 *                 the same string the record route and `rowIdOf` use
 *
 * Both are clamped by `auditEntityKeyPart` (write AND query side, so a
 * truncated key still matches itself), written by `auditRepo.append` from
 * this wave on, and BACKFILLED here from the stored refs so pre-existing
 * activity shows up on day one. The backfill parses each ref in JS — the
 * only portable JSON reader across the three dialects — in id-keyset batches;
 * audit volume is retention-bounded (§8 `audit-log` policy), so this is a
 * one-time bounded cost.
 *
 * Bulk writes (`record.bulk-*`) carry no per-row entity and stay out of the
 * feed by design (30 D6) — their rows simply keep NULL keys.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { AUDIT_ENTITY_KEY_MAX, auditEntityKeyOf, recordRefSchema } from '../schema/json-payloads.js';

const BACKFILL_BATCH = 500;

/** The four columns the backfill touches — local view over the audit table. */
interface AuditBackfillTable {
  id: string;
  entity: unknown;
  entityTable: string | null;
  entityId: string | null;
}
type BackfillDb = Kysely<Record<string, AuditBackfillTable>>;

function keysOf(entity: unknown): { entityTable: string; entityId: string } | null {
  // Postgres `jsonb` columns come back as objects; sqlite/mysql as text.
  let candidate: unknown = entity;
  if (typeof entity === 'string') {
    try {
      candidate = JSON.parse(entity);
    } catch {
      return null;
    }
  }
  const parsed = recordRefSchema.safeParse(candidate);
  return parsed.success ? auditEntityKeyOf(parsed.data) : null;
}

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('audit_log'))
    .addColumn('entity_table', c.str(AUDIT_ENTITY_KEY_MAX))
    .execute();
  await db.schema
    .alterTable(metaTable('audit_log'))
    .addColumn('entity_id', c.str(AUDIT_ENTITY_KEY_MAX))
    .execute();
  // (entity_table, entity_id, created_at): the feed's exact access path —
  // equality on both keys, ordered by recency. 2×200×4 utf8mb4 bytes + the
  // timestamp stays under MySQL's 3072-byte InnoDB index cap.
  await db.schema
    .createIndex('idx_adminium_audit_log_entity_created')
    .on(metaTable('audit_log'))
    .columns(['entity_table', 'entity_id', 'created_at'])
    .execute();

  // Backfill: id-keyset batches over rows that carry a ref. Unparseable JSON
  // stays NULL — a row this reader cannot interpret must not fail the wave.
  const backfill = db as unknown as BackfillDb;
  const audit = metaTable('audit_log');
  let after = '';
  for (;;) {
    const rows = await backfill
      .selectFrom(audit)
      .select(['id', 'entity'])
      .where('entity', 'is not', null)
      .where('id', '>', after)
      .orderBy('id', 'asc')
      .limit(BACKFILL_BATCH)
      .execute();
    if (rows.length === 0) break;
    for (const row of rows) {
      const keys = keysOf(row.entity);
      if (keys === null) continue;
      await backfill
        .updateTable(audit)
        .set({ entityTable: keys.entityTable, entityId: keys.entityId })
        .where('id', '=', row.id)
        .execute();
    }
    const last = rows[rows.length - 1];
    if (last === undefined || rows.length < BACKFILL_BATCH) break;
    after = last.id;
  }
}
