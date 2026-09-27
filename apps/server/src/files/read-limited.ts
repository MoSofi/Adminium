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
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { readLimitOf } from '../rbac/read-limits.js';

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
