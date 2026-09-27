// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A connection as ONE caller reads it: the tables their role reads only in
 * part (`roles[].limits[table].readable`) with the other columns hidden — as
 * secret columns are, so every reader that already leaves a secret column
 * out (rows, lists, search, labels, exports, widgets, forms) leaves these
 * out too, and a filter, a search or a sort by one is refused by name.
 *
 * Every door that reads rows for a person builds its view through here: the
 * data routes, search, exports (and the export job, from the person who
 * asked), widgets, live frames, documents, the assistant, pages' forms and
 * the audit's before and after images. Writes and the rules they run never
 * do: they read the connection whole.
 */
import type { FastifyRequest } from 'fastify';
import type { MetaDb } from '@adminium/meta';

import { readLimitsOn, type ReadLimits } from '../rbac/read-limits.js';
import { resolvePermissionSet } from '../rbac/resolver.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

/** The view as a caller with these permissions reads it; the same view when nothing they read is limited. */
export function readViewOf(view: SnapshotView, permissions: { superAdmin?: boolean; readLimits?: ReadLimits | undefined }): SnapshotView {
  if (permissions.superAdmin === true || permissions.readLimits === undefined) return view;
  return view.readAs(readLimitsOn(permissions, view.connectionId, view.model.tables.map((table) => table.id)));
}

/** The view as the signed-in caller of a request reads it. */
export async function readViewFor(request: FastifyRequest, view: SnapshotView): Promise<SnapshotView> {
  // A server mounted without the role layer (a narrow harness) limits nothing, as it grants everything.
  const resolve = (request.server as { rbac?: { resolve?: unknown } }).rbac?.resolve;
  if (typeof resolve !== 'function') return view;
  return readViewOf(view, await request.server.rbac.resolve(request));
}

/** The view as a person reads it, for work done later without their request (an export job). */
export async function readViewForUser(meta: MetaDb, userId: string, view: SnapshotView): Promise<SnapshotView> {
  return readViewOf(view, await resolvePermissionSet(meta, { kind: 'user', id: userId, label: userId }));
}

/** A table as the caller's view reads it (a link table included). */
export function readTableOf(view: SnapshotView, table: ResolvedTable): ResolvedTable {
  return view.readLimited ? (view.linkTable(table.id) ?? table) : table;
}

/**
 * A row image (an audit entry's before or after, a live frame's row) with
 * only the columns the caller's view shows of its table: the others dropped,
 * keys the table does not know kept as they are.
 */
export function readableImage(view: SnapshotView, tableId: string, row: Row | null | undefined): Row | null | undefined {
  if (row === null || row === undefined || !view.readLimited) return row;
  const table = view.linkTable(tableId);
  if (table === null) return row;
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (table.columns.get(key)?.unreadable === true) continue;
    out[key] = value;
  }
  return out;
}
