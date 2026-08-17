// SPDX-License-Identifier: AGPL-3.0-only
/**
 * importsRepo — adminium_imports (07-meta-store.md §3.26): the import wizard's
 * server-side state machine
 * (`validating → ready → running → succeeded | failed | cancelled`).
 *
 * `mapping`/`options` are validated against the §3.26 payload schemas on every
 * write; `stats` carries the invariant the SPA asserts (09 §11.1):
 * total = inserted + updated + skipped.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  importMappingSchema,
  importOptionsSchema,
  importStatsSchema,
  importStatusSchema,
} from '../schema/json-payloads.js';
import type { AdminiumImportsTable } from '../schema/tables.js';
import { affected, packJson, readJson, readJsonOrNull } from './util.js';

export type ImportStatus = 'validating' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ImportMapping {
  columns: { from: string; to: string | null }[];
}

export interface ImportOptions {
  mode?: 'insert' | 'upsert' | undefined;
  matchColumn?: string | null | undefined;
  skipInvalid?: boolean | undefined;
}

export interface ImportStats {
  total: number;
  inserted?: number | undefined;
  updated?: number | undefined;
  skipped?: number | undefined;
}

export interface DataImport {
  id: string;
  connectionId: string;
  tableName: string;
  requestedBy: string;
  fileId: string;
  mapping: ImportMapping;
  options: ImportOptions;
  status: ImportStatus;
  stats: ImportStats | null;
  errorReportFileId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface CreateImportInput {
  connectionId: string;
  tableName: string;
  requestedBy: string;
  fileId: string;
  mapping: ImportMapping;
  options: ImportOptions;
}

function decode(row: Selectable<AdminiumImportsTable>): DataImport {
  return {
    id: row.id,
    connectionId: row.connectionId,
    tableName: row.tableName,
    requestedBy: row.requestedBy,
    fileId: row.fileId,
    mapping: importMappingSchema.parse(readJson(row.mapping)),
    options: importOptionsSchema.parse(readJson(row.options)),
    status: importStatusSchema.parse(row.status),
    stats: ((): ImportStats | null => {
      const raw = readJsonOrNull(row.stats);
      return raw === null ? null : importStatsSchema.parse(raw);
    })(),
    errorReportFileId: row.errorReportFileId,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function importsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<DataImport | null> {
    const row = await db.selectFrom('adminium_imports').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findById,

    async create(input: CreateImportInput, at: number = Date.now()): Promise<DataImport> {
      const row = {
        id: newId('imp'),
        connectionId: input.connectionId,
        tableName: input.tableName,
        requestedBy: input.requestedBy,
        fileId: input.fileId,
        mapping: packJson(importMappingSchema.parse(input.mapping)),
        options: packJson(importOptionsSchema.parse(input.options)),
        status: 'validating',
        stats: null,
        errorReportFileId: null,
        createdAt: at,
        startedAt: null,
        finishedAt: null,
      };
      await db.insertInto('adminium_imports').values(row).execute();
      return decode(row as Selectable<AdminiumImportsTable>);
    },

    /** Newest first; `requestedBy` scopes to one user (the "mine" list). */
    async list(opts: { requestedBy?: string; limit?: number } = {}): Promise<DataImport[]> {
      let query = db.selectFrom('adminium_imports').selectAll();
      if (opts.requestedBy !== undefined) query = query.where('requestedBy', '=', opts.requestedBy);
      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(opts.limit ?? 50)
        .execute();
      return rows.map(decode);
    },

    /** validating → ready, stamping the validation stats (total parsed rows). */
    async markReady(id: string, stats: ImportStats, at: number = Date.now()): Promise<boolean> {
      void at;
      const res = await db
        .updateTable('adminium_imports')
        .set({ status: 'ready', stats: packJson(importStatsSchema.parse(stats)) })
        .where('id', '=', id)
        .where('status', '=', 'validating')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** ready → running (the import-run job's claim; double-runs are refused). */
    async markRunning(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_imports')
        .set({ status: 'running', startedAt: at })
        .where('id', '=', id)
        .where('status', '=', 'ready')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async markFinished(
      id: string,
      outcome: {
        status: 'succeeded' | 'failed' | 'cancelled';
        stats?: ImportStats | null;
        errorReportFileId?: string | null;
      },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_imports')
        .set({
          status: outcome.status,
          finishedAt: at,
          ...(outcome.stats == null ? {} : { stats: packJson(importStatsSchema.parse(outcome.stats)) }),
          ...(outcome.errorReportFileId === undefined
            ? {}
            : { errorReportFileId: outcome.errorReportFileId }),
        })
        .where('id', '=', id)
        .where('status', 'in', ['running', 'validating', 'ready'])
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },
  };
}

export type ImportsRepo = ReturnType<typeof importsRepo>;
