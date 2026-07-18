/**
 * exportsRepo — adminium_exports (07-meta-store.md §3.25): one row per data
 * export request. The row is the export's public state machine
 * (`processing → ready | failed | cancelled | expired`); the artifact itself
 * is an adminium_files row (`file_id`) written by the `export-run` job.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  exportFormatSchema,
  exportSourceSchema,
  exportStatusSchema,
} from '../schema/json-payloads.js';
import type { AdminiumExportsTable } from '../schema/tables.js';
import { affected, packJson, readJson } from './util.js';

export type ExportFormat = 'csv' | 'json' | 'xlsx';
export type ExportStatus = 'processing' | 'ready' | 'failed' | 'cancelled' | 'expired';

export interface ExportSource {
  kind: 'table' | 'view' | 'page';
  table?: string | null | undefined;
  viewId?: string | null | undefined;
  filters?: unknown[] | undefined;
}

export interface DataExport {
  id: string;
  connectionId: string | null;
  requestedBy: string;
  source: ExportSource;
  format: ExportFormat;
  status: ExportStatus;
  fileId: string | null;
  rowCount: number | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  expiresAt: number | null;
}

export interface CreateExportInput {
  connectionId?: string | null;
  requestedBy: string;
  source: ExportSource;
  format: ExportFormat;
}

function decode(row: Selectable<AdminiumExportsTable>): DataExport {
  return {
    id: row.id,
    connectionId: row.connectionId,
    requestedBy: row.requestedBy,
    source: exportSourceSchema.parse(readJson(row.source)) as ExportSource,
    format: exportFormatSchema.parse(row.format),
    status: exportStatusSchema.parse(row.status),
    fileId: row.fileId,
    rowCount: row.rowCount === null ? null : Number(row.rowCount),
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
  };
}

export function exportsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<DataExport | null> {
    const row = await db.selectFrom('adminium_exports').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    async create(input: CreateExportInput, at: number = Date.now()): Promise<DataExport> {
      const row = {
        id: newId('exp'),
        connectionId: input.connectionId ?? null,
        requestedBy: input.requestedBy,
        source: packJson(exportSourceSchema.parse(input.source)),
        format: exportFormatSchema.parse(input.format),
        status: 'processing',
        fileId: null,
        rowCount: null,
        error: null,
        createdAt: at,
        completedAt: null,
        expiresAt: null,
      };
      await db.insertInto('adminium_exports').values(row).execute();
      return decode(row as Selectable<AdminiumExportsTable>);
    },

    /** Newest first; `requestedBy` scopes to one user (the "mine" list). */
    async list(
      opts: { requestedBy?: string; limit?: number } = {},
    ): Promise<DataExport[]> {
      let query = db.selectFrom('adminium_exports').selectAll();
      if (opts.requestedBy !== undefined) query = query.where('requestedBy', '=', opts.requestedBy);
      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(opts.limit ?? 50)
        .execute();
      return rows.map(decode);
    },

    /** processing → ready, stamping the artifact + retention window. */
    async markReady(
      id: string,
      result: { fileId: string; rowCount: number; expiresAt: number | null },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_exports')
        .set({
          status: 'ready',
          fileId: result.fileId,
          rowCount: result.rowCount,
          completedAt: at,
          expiresAt: result.expiresAt,
        })
        .where('id', '=', id)
        .where('status', '=', 'processing')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async markFailed(id: string, error: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_exports')
        .set({ status: 'failed', error, completedAt: at })
        .where('id', '=', id)
        .where('status', '=', 'processing')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async markCancelled(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_exports')
        .set({ status: 'cancelled', completedAt: at })
        .where('id', '=', id)
        .where('status', '=', 'processing')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Retention sweep: ready rows past `expires_at` flip to `expired`. */
    async expireDue(at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_exports')
        .set({ status: 'expired' })
        .where('status', '=', 'ready')
        .where('expiresAt', 'is not', null)
        .where('expiresAt', '<', at)
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
    },

    /**
     * Byte-GC worklist (retention hygiene): expired exports whose artifact
     * file row is not yet soft-deleted. The sweep marks each file deleted and
     * removes its bytes — re-querying (instead of returning `expireDue`'s
     * rows) makes the pass self-healing after a crash mid-GC.
     */
    async listExpiredArtifacts(
      limit = 500,
    ): Promise<{ id: string; fileId: string; storageKey: string }[]> {
      const rows = await db
        .selectFrom('adminium_exports')
        .innerJoin('adminium_files', 'adminium_files.id', 'adminium_exports.fileId')
        .select([
          'adminium_exports.id as id',
          'adminium_files.id as fileId',
          'adminium_files.storageKey as storageKey',
        ])
        .where('adminium_exports.status', '=', 'expired')
        .where('adminium_files.deletedAt', 'is', null)
        .limit(limit)
        .execute();
      return rows;
    },
  };
}

export type ExportsRepo = ReturnType<typeof exportsRepo>;
