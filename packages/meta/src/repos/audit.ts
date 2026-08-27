// SPDX-License-Identifier: AGPL-3.0-only
/**
 * auditRepo — adminium_audit_log (07-meta-store.md §3.11). Append-only;
 * actor label denormalized so entries survive principal deletion; `changes`
 * capped at 16 KB serialized (replaced by `{ "_truncated": true }` beyond it).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  AUDIT_CHANGES_MAX_BYTES,
  actorKindSchema,
  auditCategorySchema,
  auditEntityKeyOf,
  recordRefSchema,
  type ActorKind,
  type AuditCategory,
  type RecordRef,
} from '../schema/json-payloads.js';
import type { AdminiumAuditLogTable } from '../schema/tables.js';
import { packJson, readJsonOrNull } from './util.js';

export interface AuditEntryInput {
  actorKind: ActorKind;
  actorId?: string | null;
  actorLabel: string;
  category: AuditCategory;
  /** Dotted verb, e.g. `record.update`, `session.create`. */
  action: string;
  connectionId?: string | null;
  entity?: RecordRef | null;
  changes?: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  id: string;
  createdAt: number;
  actorKind: ActorKind;
  actorId: string | null;
  actorLabel: string;
  category: AuditCategory;
  action: string;
  connectionId: string | null;
  entity: RecordRef | null;
  changes: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

function mapEntry(row: Selectable<AdminiumAuditLogTable>): AuditEntry {
  return {
    id: row.id,
    createdAt: row.createdAt,
    actorKind: actorKindSchema.parse(row.actorKind),
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    category: auditCategorySchema.parse(row.category),
    action: row.action,
    connectionId: row.connectionId,
    entity: readJsonOrNull<RecordRef>(row.entity),
    changes: readJsonOrNull<Record<string, unknown>>(row.changes),
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
  };
}

/** Serialize `changes` under the 16 KB cap (§3.11). */
function packChanges(changes: AuditEntryInput['changes']): string | null {
  if (changes === null || changes === undefined) return null;
  const serialized = packJson(changes);
  if (Buffer.byteLength(serialized, 'utf8') <= AUDIT_CHANGES_MAX_BYTES) return serialized;
  return packJson({ _truncated: true });
}

export function auditRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async append(input: AuditEntryInput, at: number = Date.now()): Promise<AuditEntry> {
      const entity = input.entity === null || input.entity === undefined ? null : recordRefSchema.parse(input.entity);
      // Denormalized per-record lookup keys (30-record-pages.md WS-A): the
      // indexed columns the activity feed filters on, derived once at write.
      const entityKeys = entity === null ? null : auditEntityKeyOf(entity);
      const row = {
        id: newId('aud'),
        createdAt: at,
        actorKind: actorKindSchema.parse(input.actorKind),
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel,
        category: auditCategorySchema.parse(input.category),
        action: input.action,
        connectionId: input.connectionId ?? null,
        entity: entity === null ? null : packJson(entity),
        entityTable: entityKeys?.entityTable ?? null,
        entityId: entityKeys?.entityId ?? null,
        changes: packChanges(input.changes),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
      };
      await db.insertInto('adminium_audit_log').values(row).execute();
      return mapEntry(row as Selectable<AdminiumAuditLogTable>);
    },

    async list(
      filter: { actorId?: string; category?: AuditCategory; limit?: number } = {},
    ): Promise<AuditEntry[]> {
      let q = db.selectFrom('adminium_audit_log').selectAll();
      if (filter.actorId !== undefined) q = q.where('actorId', '=', filter.actorId);
      if (filter.category !== undefined) q = q.where('category', '=', filter.category);
      const rows = await q
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(filter.limit ?? 100)
        .execute();
      return rows.map(mapEntry);
    },

    /** Retention §8 `audit-log` policy (archive handling lives in the server GC job). */
    async gc(at: number, retentionDays: number): Promise<number> {
      const cutoff = at - retentionDays * 86_400_000;
      const res = await db.deleteFrom('adminium_audit_log').where('createdAt', '<', cutoff).executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type AuditRepo = ReturnType<typeof auditRepo>;
