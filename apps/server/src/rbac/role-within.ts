// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER SOMEBODY ALREADY HOLDS EVERYTHING A ROLE GIVES.
 *
 * Giving a role to an API key hands out that role's power, so the giver must
 * hold it already: every grant, and each no wider than their own limit on it.
 * A limit on what somebody READS holds every action on that table: a write
 * answers with the row, so a write-only role would show what its giver cannot.
 *
 * The role is read from its STORED rows, not from what it grants this minute:
 * a role of an app that is switched off holds nothing now and everything again
 * when the app comes back. The giver is read as they stand: what a switched-off
 * app suspends, they do not hold.
 *
 * When in doubt this answers no. It does not work out that two limits together
 * reach what a third one does, and a grant on every table is held only by
 * somebody with no limit on any table under it. Holding the very role always
 * counts, so those cases are refused only for a role somebody does not have.
 */
import type { ReadLimit, RolePermission, UpdateLimit } from '@adminium/meta';

import { grantMatches, grantsFromMatrixRows, parseGrant, type ParsedGrant } from './permissions.js';
import { readLimitOf, readLimitOfRow } from './read-limits.js';
import type { PermissionSet } from './resolver.js';
import { rowReachOfRow, rowReachesOf, type RowAction } from './row-limits.js';
import { createLimitOf, createLimitOfRow, limitOfRow, updateLimitOf, type UpdateLimits } from './update-limits.js';

type TableGrant = Extract<ParsedGrant, { kind: 'table' }>;

const segmentHeld = (held: string, wanted: string): boolean => held === '*' || held === wanted;
const segmentsMeet = (a: string, b: string): boolean => a === '*' || b === '*' || a === b;

/** Does one grant someone holds reach everything one wanted grant does? Either may carry wildcards. */
function grantCovers(held: string, wanted: string): boolean {
  if (held === wanted) return true;
  const own = parseGrant(held);
  const asked = parseGrant(wanted);
  if (own === null || asked === null) return false;
  // The matrix stores actions by name, so only a connection, table, page or app can be a wildcard here.
  if (own.kind === 'table' && asked.kind === 'table') {
    return own.action === asked.action && segmentHeld(own.connectionId, asked.connectionId) && segmentHeld(own.table, asked.table);
  }
  if (own.kind === 'page' && asked.kind === 'page') return own.action === asked.action && segmentHeld(own.pageId, asked.pageId);
  if (own.kind === 'app' && asked.kind === 'app') return segmentHeld(own.appKey, asked.appKey);
  return false; // the other kinds are concrete: only the same string holds them
}

/** A limit no wider than one the giver is held to: its columns, its values, and the rows it starts from. */
function limitWithin(wanted: UpdateLimit, own: UpdateLimit): boolean {
  const columns = wanted.writable.every((column) => {
    if (!own.writable.includes(column)) return false;
    const allowed = own.writableValues?.[column];
    if (allowed === undefined) return true;
    const asked = wanted.writableValues?.[column];
    return asked !== undefined && asked.every((value) => allowed.includes(value));
  });
  return columns && Object.entries(own.writableFrom ?? {}).every(([column, from]) => {
    const asked = wanted.writableFrom?.[column];
    return asked !== undefined && asked.every((value) => from.includes(value));
  });
}

function writesWithin(limits: UpdateLimits | undefined, heldTo: UpdateLimit | null, wanted: UpdateLimit | null, permission: string): boolean {
  if (heldTo === null) return true;
  if (wanted === null) return false;
  return (limits?.limited ?? []).some((entry) => grantMatches(entry.grant, permission) && limitWithin(wanted, entry.limit));
}

function columnsWithin(heldTo: ReadonlySet<string> | null, wanted: ReadLimit | null): boolean {
  if (heldTo === null) return true;
  return wanted !== null && wanted.readable.every((column) => heldTo.has(column));
}

/** The same JSON whatever order its keys were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Each reach wanted must be one the giver has: reaches are whole tests, so a part of one proves nothing. */
function rowsWithin(held: PermissionSet, row: RolePermission, connectionId: string, table: string, action: RowAction): boolean {
  const own = rowReachesOf(held, connectionId, table, action);
  if (own === null) return true;
  const wanted = rowReachOfRow(row, action);
  if (wanted === null) return false;
  const reaches = new Set(own.map(canonical));
  return wanted.every((reach) => reaches.has(canonical(reach)));
}

/** Whether the giver is under any limit, on any table this wildcard grant covers, that bears on its action. */
function limitedUnder(held: PermissionSet, grant: TableGrant): boolean {
  const { action } = grant;
  const creates = action === 'create' || action === 'import';
  const entries: readonly { grant: string }[] = [
    // A read's limits bear on every action.
    ...(held.readLimits?.limited ?? []),
    ...(held.rowLimits?.read ?? []).flatMap((role) => role.limited),
    ...(creates ? (held.createLimits?.limited ?? []) : []),
    ...(action === 'update' ? (held.updateLimits?.limited ?? []) : []),
    ...(action === 'update' || action === 'delete' ? (held.rowLimits?.[action] ?? []).flatMap((role) => role.limited) : []),
  ];
  return entries.some((entry) => {
    const limited = parseGrant(entry.grant);
    return limited?.kind === 'table' && segmentsMeet(limited.connectionId, grant.connectionId) && segmentsMeet(limited.table, grant.table);
  });
}

function tableGrantWithin(held: PermissionSet, row: RolePermission, grant: TableGrant): boolean {
  const { connectionId, table, action } = grant;
  if (action === '*') return false; // the matrix stores actions by name
  if (connectionId === '*' || table === '*') return !limitedUnder(held, grant);
  if (!columnsWithin(readLimitOf(held, connectionId, table), readLimitOfRow(row))) return false;
  if (!rowsWithin(held, row, connectionId, table, 'read')) return false;
  switch (action) {
    case 'read':
    case 'export':
    case 'read_pii':
      return true;
    // An import brings new rows, under the create limit.
    case 'create':
    case 'import':
      return writesWithin(held.createLimits, createLimitOf(held, connectionId, table), createLimitOfRow(row), `table:${connectionId}:${table}:create`);
    case 'update':
      return writesWithin(held.updateLimits, updateLimitOf(held, connectionId, table), limitOfRow(row), `table:${connectionId}:${table}:update`) && rowsWithin(held, row, connectionId, table, 'update');
    case 'delete':
      return rowsWithin(held, row, connectionId, table, 'delete');
  }
}

/** Does this permission set already hold everything the role's stored rows give? */
export function holdsRole(held: PermissionSet, roleId: string, rows: readonly RolePermission[]): boolean {
  if (held.superAdmin || held.roleIds.includes(roleId)) return true;
  return rows.every((row) =>
    grantsFromMatrixRows([row]).every((grant) => {
      if (![...held.grants].some((own) => grantCovers(own, grant))) return false;
      const parsed = parseGrant(grant);
      return parsed?.kind !== 'table' || tableGrantWithin(held, row, parsed);
    }),
  );
}
