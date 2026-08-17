// SPDX-License-Identifier: AGPL-3.0-only
/**
 * snapshotsRepo — adminium_schema_snapshots (07-meta-store.md §3.14).
 *
 * Immutable record of one introspection / schema-import run. The `schema`
 * JSON is the normalized schema model owned by 05-introspection-engine.md —
 * opaque here. Exactly one snapshot per connection is active; activation is
 * app-enforced inside a transaction. Equal checksum to the latest snapshot
 * ⇒ no-op (the existing row is returned, nothing is inserted).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumSchemaSnapshotsTable } from '../schema/tables.js';
import { MetaValidationError, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

export const SNAPSHOT_SOURCES = ['introspection', 'schema-import'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export interface SchemaSnapshot {
  id: string;
  connectionId: string;
  source: string;
  importFormat: string | null;
  engineVersion: string | null;
  /** Normalized schema model JSON — opaque to the meta store. */
  schema: unknown;
  stats: Record<string, { rowCount: number }> | null;
  checksum: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: number;
}

/** Listing row without the (potentially multi-MB) schema payload. */
export interface SchemaSnapshotMeta {
  id: string;
  connectionId: string;
  source: string;
  importFormat: string | null;
  engineVersion: string | null;
  checksum: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: number;
}

export interface CreateSnapshotInput {
  connectionId: string;
  source: SnapshotSource;
  importFormat?: string | null;
  engineVersion?: string | null;
  schema: unknown;
  stats?: Record<string, { rowCount: number }> | null;
  /** SHA-256 of the canonicalized schema — computed by the caller (server). */
  checksum: string;
  createdBy?: string | null;
  /** Default true: the new snapshot becomes the connection's active one. */
  activate?: boolean;
}

export interface CreateSnapshotResult {
  snapshot: SchemaSnapshot;
  /** True when the checksum matched the latest snapshot and no row was written. */
  noop: boolean;
}

function decode(row: Selectable<AdminiumSchemaSnapshotsTable>): SchemaSnapshot {
  return {
    id: row.id,
    connectionId: row.connectionId,
    source: row.source,
    importFormat: row.importFormat,
    engineVersion: row.engineVersion,
    schema: readJson(row.schema),
    stats: readJsonOrNull(row.stats),
    checksum: row.checksum,
    isActive: readBool(row.isActive),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function decodeMeta(row: Omit<Selectable<AdminiumSchemaSnapshotsTable>, 'schema' | 'stats'>): SchemaSnapshotMeta {
  return {
    id: row.id,
    connectionId: row.connectionId,
    source: row.source,
    importFormat: row.importFormat,
    engineVersion: row.engineVersion,
    checksum: row.checksum,
    isActive: readBool(row.isActive),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

const META_COLUMNS = [
  'id',
  'connectionId',
  'source',
  'importFormat',
  'engineVersion',
  'checksum',
  'isActive',
  'createdBy',
  'createdAt',
] as const;

export function snapshotsRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    /**
     * Persist a snapshot; inside one transaction the previous active row is
     * deactivated so exactly one stays active per connection (§3.14). Equal
     * checksum to the latest snapshot short-circuits to a no-op.
     */
    async create(input: CreateSnapshotInput, at: number = Date.now()): Promise<CreateSnapshotResult> {
      if (!SNAPSHOT_SOURCES.includes(input.source)) {
        throw new MetaValidationError(`invalid snapshot source ${JSON.stringify(input.source)}`);
      }
      if (input.checksum.length === 0) {
        throw new MetaValidationError('snapshot checksum must not be empty');
      }
      return db.transaction().execute(async (trx) => {
        const latest = await trx
          .selectFrom('adminium_schema_snapshots')
          .selectAll()
          .where('connectionId', '=', input.connectionId)
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (latest !== undefined && latest.checksum === input.checksum) {
          return { snapshot: decode(latest), noop: true };
        }
        const activate = input.activate ?? true;
        const row = {
          id: newId('snap'),
          connectionId: input.connectionId,
          source: input.source,
          importFormat: input.importFormat ?? null,
          engineVersion: input.engineVersion ?? null,
          schema: packJson(input.schema),
          stats: input.stats === null || input.stats === undefined ? null : packJson(input.stats),
          checksum: input.checksum,
          isActive: writeBool(meta, activate),
          createdBy: input.createdBy ?? null,
          createdAt: at,
        };
        if (activate) {
          await trx
            .updateTable('adminium_schema_snapshots')
            .set({ isActive: writeBool(meta, false) })
            .where('connectionId', '=', input.connectionId)
            .execute();
        }
        await trx.insertInto('adminium_schema_snapshots').values(row).execute();
        return { snapshot: { ...decode(row as never), schema: input.schema }, noop: false };
      });
    },

    async findById(id: string): Promise<SchemaSnapshot | null> {
      const row = await db
        .selectFrom('adminium_schema_snapshots')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** The connection's active snapshot; falls back to the newest row. */
    async latest(connectionId: string): Promise<SchemaSnapshot | null> {
      const active = await db
        .selectFrom('adminium_schema_snapshots')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('isActive', '=', writeBool(meta, true))
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (active !== undefined) return decode(active);
      const newest = await db
        .selectFrom('adminium_schema_snapshots')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return newest === undefined ? null : decode(newest);
    },

    /** The snapshot immediately before the given one (diff default: previous vs latest). */
    async previous(connectionId: string, beforeSnapshotId: string): Promise<SchemaSnapshot | null> {
      const anchor = await this.findById(beforeSnapshotId);
      if (anchor === null) return null;
      const row = await db
        .selectFrom('adminium_schema_snapshots')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('id', '!=', anchor.id)
        .where('createdAt', '<=', anchor.createdAt)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      // Same-millisecond rows tie on createdAt; ULID ids break the tie.
      if (row !== undefined && row.createdAt === anchor.createdAt && row.id > anchor.id) return null;
      return row === undefined ? null : decode(row);
    },

    /** History (newest first) without schema payloads. */
    async listForConnection(connectionId: string): Promise<SchemaSnapshotMeta[]> {
      const rows = await db
        .selectFrom('adminium_schema_snapshots')
        .select(META_COLUMNS)
        .where('connectionId', '=', connectionId)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return rows.map(decodeMeta);
    },

    /** Flip the active snapshot (rollback flows). */
    async activate(id: string): Promise<boolean> {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('adminium_schema_snapshots')
          .select(['id', 'connectionId'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (row === undefined) return false;
        await trx
          .updateTable('adminium_schema_snapshots')
          .set({ isActive: writeBool(meta, false) })
          .where('connectionId', '=', row.connectionId)
          .execute();
        await trx
          .updateTable('adminium_schema_snapshots')
          .set({ isActive: writeBool(meta, true) })
          .where('id', '=', id)
          .execute();
        return true;
      });
    },
  };
}

export type SnapshotsRepo = ReturnType<typeof snapshotsRepo>;
