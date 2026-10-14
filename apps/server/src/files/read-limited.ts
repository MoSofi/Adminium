// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A file held only in a column the reader's role does not read. A file
 * attached to a record is read with the record's table; when the reader's
 * read of that table is limited to some columns (housekeeping reads a
 * stay's room, not its guest's passport scan), a file held in one of the
 * other columns — and in none they read — is not theirs either. A file the
 * record carries beside its columns (the attachments panel) stays theirs.
 */
import type { FastifyRequest } from 'fastify';
import type { MetaDb, StoredFile } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import { readViewOf } from '../crud/read-view.js';
import { fetchByPk, parseRecordId } from '../crud/records.js';
import { fetchVisible, type RowAction } from '../crud/row-limit.js';
import { rowTestOf } from '../crud/row-limit-context.js';
import { reachOfRequest } from '../crud/row-reach-request.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { readLimitOf } from '../rbac/read-limits.js';
import { ruledBlock, type ColumnFile } from './column-blocks.js';
import { fileIdsIn } from './column-values.js';

/** Whether a value holds the file id: itself, or in a list or a block of them. */
function holds(value: unknown, id: string): boolean {
  if (typeof value === 'string') return value === id || value.includes(id);
  if (Array.isArray(value)) return value.some((item) => holds(item, id));
  if (typeof value === 'object' && value !== null) return JSON.stringify(value).includes(id);
  return false;
}

export function hiddenFileCheck(meta: MetaDb, manager: ConnectionManager): (request: FastifyRequest, file: StoredFile) => Promise<boolean> {
  return async (request, file) => {
    if (file.entityConnectionId === null || file.entityTable === null || file.entityId === null) return false;
    const permissions = await request.server.rbac.resolve(request);
    if (readLimitOf(permissions, file.entityConnectionId, file.entityTable) === null) return false;
    const view = readViewOf(await loadSnapshotView(meta, file.entityConnectionId), permissions);
    const table = view.linkTable(file.entityTable);
    if (table === null) return false;
    const columns = [...table.columns.values()];
    if (!columns.some((column) => column.unreadable === true)) return false;
    let pk;
    try {
      pk = parseRecordId(table, file.entityId);
    } catch {
      return false;
    }
    const { db } = await manager.data(file.entityConnectionId);
    const row = await fetchByPk(db, table, pk);
    if (row === undefined) return false;
    const hidden = columns.some((column) => column.unreadable === true && holds(row[column.name], file.id));
    const shown = columns.some((column) => column.unreadable !== true && column.secret !== true && holds(row[column.name], file.id));
    return hidden && !shown;
  };
}

/** The record a file hangs on, or is being hung on: its table by the name the file keeps, and its id as a record's address spells it. */
export interface FileRecord {
  connectionId: string;
  table: string;
  /** Null for a file uploaded for a record that is not made yet. */
  recordId: string | null;
  /** Who uploaded the file; null for one that is being uploaded now, or whose uploader is gone. */
  uploadedBy: string | null;
}

/**
 * Whether a caller reaches the record a file hangs on, when a role of theirs
 * holds them to some rows of its table (`crud/row-limit.ts`): a file is read
 * with its record, and changed with it. Asked BESIDE the table's grant, never
 * instead of it, and of everybody: having uploaded the file, or holding the
 * grant that looks after files, is no way to a row that is not theirs.
 *
 * A file uploaded for a record that is not made yet has no row to ask about:
 * it is its uploader's until the record is saved.
 *
 * True for nearly everyone at no cost: nothing limits them, and no row is read.
 */
export function fileRecordCheck(meta: MetaDb, manager: ConnectionManager): (request: FastifyRequest, record: FileRecord, action: RowAction) => Promise<boolean> {
  return async (request, record, action) => {
    const reach = await reachOfRequest(meta, request, record.connectionId);
    if (reach === null) return true;
    // Somebody something could limit, and no schema to say which rows: none.
    if (reach === 'unreadable') return false;
    const { view, rows } = reach;
    const table = view.linkTable(record.table);
    if (rowTestOf(rows, table?.id ?? record.table, action) === null) return true;
    if (table === null) return false;
    if (record.recordId === null) return record.uploadedBy !== null && record.uploadedBy === request.user?.id;
    let pk;
    try {
      pk = parseRecordId(table, record.recordId);
    } catch {
      return false;
    }
    const { db } = await manager.data(record.connectionId);
    return (await fetchVisible(rows, db, table, pk, action)) !== undefined;
  };
}

/**
 * Whether a record keeps this file in a column an app's own rule makes a
 * file column (`column.file`): read in the record as it is now. Such a file
 * is the record's, and changes only with it — a signed sign-off's signature
 * is not taken off, renamed or thrown away by whoever uploaded it.
 */
export function fileHeldCheck(meta: MetaDb, manager: ConnectionManager): (file: StoredFile) => Promise<boolean> {
  return async (file) => {
    if (file.entityConnectionId === null || file.entityTable === null || file.entityId === null) return false;
    let table;
    try {
      table = (await loadSnapshotView(meta, file.entityConnectionId)).linkTable(file.entityTable);
    } catch {
      return false;
    }
    const ruled = table === null ? [] : [...table.columns.values()].filter((column) => column.file !== undefined);
    if (table === null || ruled.length === 0) return false;
    let pk;
    try {
      pk = parseRecordId(table, file.entityId);
    } catch {
      return false;
    }
    const { db } = await manager.data(file.entityConnectionId);
    const row = await fetchByPk(db, table, pk);
    return row !== undefined && ruled.some((column) => fileIdsIn(row[column.name]).includes(file.id));
  };
}

/** The block of a column an app's own rule makes a file column, read from the schema as it is now; null for any other column. */
export async function ruledFileColumn(meta: MetaDb, input: { connectionId: string; table: string; column: string }): Promise<ColumnFile | null> {
  try {
    const rule = (await loadSnapshotView(meta, input.connectionId)).linkTable(input.table)?.columns.get(input.column)?.file;
    return rule === undefined ? null : ruledBlock(rule);
  } catch {
    return null;
  }
}

/** A table's id as the database gives it, for its id or its plain name; null for one the schema does not have. */
export async function tableIdOf(meta: MetaDb, connectionId: string, table: string): Promise<string | null> {
  try {
    return (await loadSnapshotView(meta, connectionId)).linkTable(table)?.id ?? null;
  } catch {
    return null;
  }
}
