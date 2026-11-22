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
import type { ReadLimit, RolePermission, TableActions, UpdateLimit } from '@adminium/meta';

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
export function canonical(value: unknown): string {
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

/** A matrix row, stored or about to be. */
export type GrantRow = Pick<RolePermission, 'resourceKind' | 'resourceRef' | 'actions'>;

const asStored = (row: GrantRow): RolePermission => ({ id: '', roleId: '', ...row });

function holdsGrant(held: PermissionSet, row: RolePermission, grant: string): boolean {
  if (![...held.grants].some((own) => grantCovers(own, grant))) return false;
  const parsed = parseGrant(grant);
  return parsed?.kind !== 'table' || tableGrantWithin(held, row, parsed);
}

/**
 * Does this permission set hold everything these rows give, as it stands now?
 * What to ask of rows that are not a role's yet: a clone, or an edit. Holding
 * the role they come from says nothing about them.
 */
export function holdsRows(held: PermissionSet, rows: readonly GrantRow[]): boolean {
  if (held.superAdmin) return true;
  return rows.every((given) => {
    const row = asStored(given);
    return grantsFromMatrixRows([row]).every((grant) => holdsGrant(held, row, grant));
  });
}

/** Does this permission set already hold everything the role's stored rows give? */
export function holdsRole(held: PermissionSet, roleId: string, rows: readonly GrantRow[]): boolean {
  return held.superAdmin || held.roleIds.includes(roleId) || holdsRows(held, rows);
}

const TABLE_ROW_ACTIONS = ['read', 'create', 'update', 'delete', 'export', 'import', 'read_pii'] as const;
type TableRowAction = (typeof TABLE_ROW_ACTIONS)[number];

/** The limits on a row that bear on one action: a read's, on every action, and the action's own. */
function limitsOn(row: GrantRow, action: TableRowAction): readonly unknown[] {
  const actions = row.actions as TableActions;
  const own =
    action === 'update' ? [actions.updateLimit, actions.rowLimit?.update]
    : action === 'delete' ? [actions.rowLimit?.delete]
    : action === 'create' || action === 'import' ? [actions.createLimit]
    : [];
  return [actions.readLimit, actions.rowLimit?.read, ...own].filter((limit) => limit !== undefined);
}

/** Would this save leave a wider grant reaching what a limited row of the role held back? */
function limitWouldLift(next: readonly GrantRow[], stored: readonly GrantRow[]): boolean {
  const wider = (other: GrantRow, ref: string): boolean => {
    const [theirConnection = '', ...theirTable] = other.resourceRef.split('/');
    const [connection = '', ...table] = ref.split('/');
    return other.resourceRef !== ref && segmentHeld(theirConnection, connection) && segmentHeld(theirTable.join('/'), table.join('/'));
  };
  return stored.some((row) => {
    if (row.resourceKind !== 'table') return false;
    const kept = next.find((other) => other.resourceKind === 'table' && other.resourceRef === row.resourceRef);
    return TABLE_ROW_ACTIONS.some((action) => {
      if ((row.actions as TableActions)[action] !== true || limitsOn(row, action).length === 0) return false;
      if (kept !== undefined && (kept.actions as TableActions)[action] === true) return false;
      return next.some((other) => other.resourceKind === 'table' && (other.actions as TableActions)[action] === true && wider(other, row.resourceRef));
    });
  });
}

/**
 * May this person save these rows over the role's stored ones, having been
 * found to hold the role as it is? Asked only of what the save adds or
 * un-limits: taking a permission off, or leaving a row as it was, needs
 * nothing more. Unless a limit goes and a wider grant of the role would then
 * reach what it held back: then every row the role would keep is asked about.
 */
export function holdsEdit(held: PermissionSet, next: readonly GrantRow[], stored: readonly GrantRow[]): boolean {
  if (held.superAdmin) return true;
  if (limitWouldLift(next, stored)) return holdsRows(held, next);
  return next.every((given) => {
    const row = asStored(given);
    const was = stored.find((other) => other.resourceKind === given.resourceKind && other.resourceRef === given.resourceRef);
    const had = new Set(was === undefined ? [] : grantsFromMatrixRows([asStored(was)]));
    return grantsFromMatrixRows([row]).every((grant) => {
      if (had.has(grant)) {
        const parsed = parseGrant(grant);
        if (parsed?.kind !== 'table' || parsed.action === '*') return true;
        if (canonical(limitsOn(was!, parsed.action)) === canonical(limitsOn(given, parsed.action))) return true;
      }
      return holdsGrant(held, row, grant);
    });
  });
}
