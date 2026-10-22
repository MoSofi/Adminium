// SPDX-License-Identifier: AGPL-3.0-only
/**
 * removedRowsRepo — adminium_removed_rows (0063).
 *
 * The removed rows of a table that keeps them (`removal: { history: true }`),
 * one row per removal and per link of the removed row that named a row: what
 * the server reads to list a parent's removed children, and to find the one
 * it is asked the history of. Who may read them is the server's to decide
 * (the parent read now, the child table's grants, its masking); this repo
 * only keeps and finds them.
 */

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { auditEntityKeyPart } from '../schema/json-payloads.js';
import type { AdminiumRemovedRowsTable } from '../schema/tables.js';
import { packJson, readJson } from './util.js';

/** One link of a removed row that named a row: the link column, the table it points at, and the value it held. */
export interface RemovedRowLink {
  via: string;
  parentTable: string;
  parentValue: string;
}

export interface RemovedRowInput {
  connectionId: string;
  /** The removed row's table, by its snapshot id. */
  entityTable: string;
  /** The removed row's key as `pkLabel` writes it. */
  entityId: string;
  pk: Record<string, unknown>;
  links: readonly RemovedRowLink[];
  removedAt: number;
  actorKind: string;
  actorId: string | null;
  actorLabel: string;
  reason: string | null;
  /** The row as it was, masked as the audit log keeps it. */
  image: Record<string, unknown>;
}

export interface RemovedRow {
  id: string;
  connectionId: string;
  entityTable: string;
  entityId: string;
  pk: Record<string, unknown>;
  via: string;
  parentTable: string;
  parentValue: string;
  removedAt: number;
  actorKind: string;
  actorId: string | null;
  actorLabel: string;
  reason: string | null;
  image: Record<string, unknown>;
}

/** Clamped as the audit log clamps its keys, so a long value still finds its row. */
const part = (value: string): string => auditEntityKeyPart(value);

function decode(row: AdminiumRemovedRowsTable): RemovedRow {
  return {
    id: row.id,
    connectionId: row.connectionId,
    entityTable: row.entityTable,
    entityId: row.entityId,
    pk: readJson<Record<string, unknown>>(row.pk),
    via: row.via,
    parentTable: row.parentTable,
    parentValue: row.parentValue,
    removedAt: Number(row.removedAt),
    actorKind: row.actorKind,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    reason: row.reason,
    image: readJson<Record<string, unknown>>(row.image),
  };
}

export function removedRowsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Keep one removal: a row for each of its links. A removal with no link keeps nothing. */
    async add(input: RemovedRowInput): Promise<number> {
      if (input.links.length === 0) return 0;
      const rows = input.links.map((link) => ({
        id: newId('rmv'),
        connectionId: input.connectionId,
        entityTable: part(input.entityTable),
        entityId: part(input.entityId),
        pk: packJson(input.pk),
        via: part(link.via),
        parentTable: part(link.parentTable),
        parentValue: part(link.parentValue),
        removedAt: input.removedAt,
        actorKind: input.actorKind.slice(0, 20),
        actorId: input.actorId,
        actorLabel: input.actorLabel.slice(0, 255),
        reason: input.reason,
        image: packJson(input.image),
      }));
      await db.insertInto('adminium_removed_rows').values(rows).execute();
      return rows.length;
    },

    /**
     * The removed rows of one table a parent row's links named, newest first:
     * `links` are the pairs (link column, the parent's value) that name it.
     * `before` continues a page: the removal time and id of its last row.
     */
    async listUnder(input: { connectionId: string; entityTable: string; parentTable: string; links: readonly { via: string; parentValue: string }[]; limit: number; before?: { removedAt: number; id: string } | undefined }): Promise<RemovedRow[]> {
      if (input.links.length === 0) return [];
      let q = db
        .selectFrom('adminium_removed_rows')
        .selectAll()
        .where('connectionId', '=', input.connectionId)
        .where('entityTable', '=', part(input.entityTable))
        .where('parentTable', '=', part(input.parentTable))
        .where((eb) => eb.or(input.links.map((link) => eb.and([eb('via', '=', part(link.via)), eb('parentValue', '=', part(link.parentValue))]))));
      const before = input.before;
      if (before !== undefined) q = q.where((eb) => eb.or([eb('removedAt', '<', before.removedAt), eb.and([eb('removedAt', '=', before.removedAt), eb('id', '<', before.id)])]));
      const rows = await q.orderBy('removedAt', 'desc').orderBy('id', 'desc').limit(input.limit).execute();
      return rows.map((row) => decode(row as AdminiumRemovedRowsTable));
    },

    /** One removed row of a table under one of a parent's links, newest removal first; null when it is not kept there. */
    async findUnder(input: { connectionId: string; entityTable: string; entityId: string; parentTable: string; links: readonly { via: string; parentValue: string }[] }): Promise<RemovedRow | null> {
      if (input.links.length === 0) return null;
      const row = await db
        .selectFrom('adminium_removed_rows')
        .selectAll()
        .where('connectionId', '=', input.connectionId)
        .where('entityTable', '=', part(input.entityTable))
        .where('entityId', '=', part(input.entityId))
        .where('parentTable', '=', part(input.parentTable))
        .where((eb) => eb.or(input.links.map((link) => eb.and([eb('via', '=', part(link.via)), eb('parentValue', '=', part(link.parentValue))]))))
        .orderBy('removedAt', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row === undefined ? null : decode(row as AdminiumRemovedRowsTable);
    },

    /** Rows brought back (an undo): off the list, under every parent. */
    async forget(connectionId: string, entityTable: string, entityIds: readonly string[]): Promise<number> {
      if (entityIds.length === 0) return 0;
      const res = await db
        .deleteFrom('adminium_removed_rows')
        .where('connectionId', '=', connectionId)
        .where('entityTable', '=', part(entityTable))
        .where('entityId', 'in', entityIds.map(part))
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },

    /** The retention sweep: removals older than the audit log keeps its entries. */
    async gc(at: number, retentionDays: number): Promise<number> {
      const res = await db
        .deleteFrom('adminium_removed_rows')
        .where('removedAt', '<', at - retentionDays * 86_400_000)
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type RemovedRowsRepo = ReturnType<typeof removedRowsRepo>;
