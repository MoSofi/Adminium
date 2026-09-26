// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a connection's DATA role may do to a table, as the database grants it.
 *
 * Read by the connection manager (`tablePrivileges`), kept beside the schema
 * snapshot rather than inside it: the model is hashed to notice schema changes,
 * and a GRANT is not one — a granted or revoked right would otherwise read as a
 * new schema version.
 *
 * A least-privilege role (SELECT, INSERT, UPDATE, DELETE on the tables and
 * nothing else) is the recommended way to connect a production database, and
 * such a role often may write some tables and only read others. Without this a
 * table the role may not change still offered its New, Edit and Delete buttons,
 * and the database's refusal came back as a 500.
 *
 * Unknown rights — an adapter that cannot say, a probe that failed, a table the
 * map does not name — refuse nothing: the database still refuses what the role
 * may not do, and `mapDbError` turns that refusal into the same 403.
 */
import type { TablePrivilegeMap, TablePrivileges } from '@adminium/engine/adapter';

import { ForbiddenError } from '../errors.js';

export type WriteAction = 'create' | 'update' | 'delete';

/** How long a connection's rights are trusted before they are read again. */
export const PRIVILEGES_TTL_MS = 60_000;

/** One table's rights, by snapshot id (`schema.table`) or, when unambiguous, bare name. */
export function privilegesOf(map: TablePrivilegeMap | null, table: string): TablePrivileges | null {
  if (map === null) return null;
  const exact = map[table];
  if (exact !== undefined) return exact;
  if (table.includes('.')) return null;
  const matches = Object.keys(map).filter((id) => id.endsWith(`.${table}`));
  return matches.length === 1 ? (map[matches[0]!] ?? null) : null;
}

/** Whether the database refuses this write to this table. */
export function writeRefused(map: TablePrivilegeMap | null, table: string, action: WriteAction): boolean {
  const rights = privilegesOf(map, table);
  if (rights === null) return false;
  return action === 'create' ? !rights.insert : action === 'update' ? !rights.update : !rights.delete;
}

/**
 * The database said the role may not do this: Postgres `insufficient_privilege`
 * or MySQL's table- and column-access refusals.
 */
export function isPrivilegeRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '42501' || code === 'ER_TABLEACCESS_DENIED_ERROR' || code === 'ER_COLUMNACCESS_DENIED_ERROR';
}

/**
 * The database does not let the connection's data role make this change. The
 * same code as every other read-only refusal, so the dashboard treats it as one.
 */
export function privilegeRefusal(table?: { id: string }): ForbiddenError {
  return new ForbiddenError("The database does not let this connection's role change this table.", 'READ_ONLY_MODE', {
    table: table?.id ?? null,
    reason: 'privileges',
  });
}

/**
 * Whether the role may write this column on this write. A table granted by
 * column (`GRANT UPDATE (body) ON …`) carries a per-column map; any other
 * table's columns follow the table. Unknown rights grant everything.
 */
export function columnGranted(
  rights: TablePrivileges | null | undefined,
  column: string,
  action: 'create' | 'update',
): boolean {
  if (rights === null || rights === undefined) return true;
  const right = action === 'create' ? 'insert' : 'update';
  return rights.columns?.[column]?.[right] ?? rights[right];
}

/**
 * The columns a write names that the role may not write, refused before the
 * statement with the columns named — the database would refuse the whole write
 * and say only which table.
 */
export function refuseUngrantedColumns(
  rights: TablePrivileges | null | undefined,
  table: { id: string },
  action: 'create' | 'update',
  columns: readonly string[],
): void {
  const refused = columns.filter((column) => !columnGranted(rights, column, action));
  if (refused.length === 0) return;
  throw new ForbiddenError("The database does not let this connection's role change these columns.", 'READ_ONLY_MODE', {
    table: table.id,
    columns: refused,
    reason: 'privileges',
  });
}

