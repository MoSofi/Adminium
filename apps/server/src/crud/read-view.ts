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

/**
 * The view as a caller with these permissions reads it; the same view when
 * nothing they read is limited. A code no desk hands out (`code.hiddenFromStaff`,
 * an online order's own link) is left out for every staff reader, Super Admin
 * too: the link and the emails that carry it read the connection whole.
 */
export function readViewOf(view: SnapshotView, permissions: { superAdmin?: boolean; readLimits?: ReadLimits | undefined }): SnapshotView {
  const limits = new Map(permissions.superAdmin === true || permissions.readLimits === undefined ? [] : readLimitsOn(permissions, view.connectionId, view.model.tables.map((table) => table.id)));
  for (const table of view.model.tables) {
    const hidden = new Set(table.columns.filter((column) => column.code?.hiddenFromStaff === true).map((column) => column.name));
    if (hidden.size === 0) continue;
    const readable = limits.get(table.id) ?? new Set(table.columns.map((column) => column.name));
    limits.set(table.id, new Set([...readable].filter((name) => !hidden.has(name))));
  }
  return view.readAs(limits);
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

/**
 * An import as a caller whose role reads its table only in part may make it:
 * a column they may not read is never the column rows are matched by (which
 * rows exist would be the answer), and is brought in only when their update
 * names it (`writable`), as a form's field is. Refused 403 as a masked
 * column is. Nothing to check for a caller who reads the table whole.
 */
export function assertImportReadable(
  view: SnapshotView,
  tableId: string,
  mapping: readonly { to: string | null }[],
  match: string | null,
  writable: readonly string[] | null,
): void {
  if (!view.readLimited) return;
  const table = view.linkTable(tableId);
  if (table === null) return;
  const hidden = (column: string) => table.columns.get(column)?.unreadable === true;
  if (match !== null && hidden(match)) view.column(table, match);
  for (const entry of mapping) {
    if (entry.to !== null && hidden(entry.to) && !(writable ?? []).includes(entry.to)) view.column(table, entry.to);
  }
}

/** Every string anywhere inside a value: the column names a rule reads, among others. */
export function stringsOf(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) stringsOf(item, out);
  return out;
}

/**
 * Refuse (403, as a masked column is) a figure built from a column the
 * caller's view hides: a rule (a limit, a price by the night) that names one
 * — on its own table or a table it reads through a link. Read by name, so a
 * column of the same name elsewhere refuses too: it errs on telling less.
 */
export function refuseHiddenIn(view: SnapshotView, rule: unknown): void {
  if (!view.readLimited) return;
  const named = stringsOf(rule);
  for (const model of view.model.tables) {
    const table = view.linkTable(model.id);
    for (const column of table?.columns.values() ?? []) {
      if (column.unreadable === true && named.has(column.name)) view.column(table!, column.name);
    }
  }
}

/** Whether a rule names a column the caller's view hides (see {@link refuseHiddenIn}). */
export function readsHidden(view: SnapshotView, rule: unknown): boolean {
  try {
    refuseHiddenIn(view, rule);
    return false;
  } catch {
    return true;
  }
}
