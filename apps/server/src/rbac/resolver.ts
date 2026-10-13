// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Effective-permission resolution: principal → roles (`adminium_user_roles`,
 * or the API key's single role) → union of the roles' matrix rows as grant
 * strings. `super-admin` short-circuits to allow-all; everything else is
 * deny-by-default via {@link isGranted}.
 */

import { permissionsRepo, rolesRepo, teamsRepo, type MetaDb, type Role } from '@adminium/meta';

import { loadAppParts, refNamesTable, roleIsOffered, tablesOfPartsOff } from './app-parts.js';
import { grantsFromMatrixRows, isGranted } from './permissions.js';
import type { RbacPrincipal } from './principal.js';
import { createLimitOfRow, limitOfRow, type LimitedUpdate, type UpdateLimits } from './update-limits.js';
import { readLimitOfRow, type LimitedRead, type ReadLimits } from './read-limits.js';
import { ROW_ACTIONS, asksForTeam, rowReachOfRow, type LimitedRows, type RowAction, type RowLimits, type RowReachOf } from './row-limits.js';

type RoleRowsDraft = Record<RowAction, { limited: LimitedRows[]; unlimited: Set<string> }>;

/** Built-in slug whose members bypass every check. */
export const SUPER_ADMIN_SLUG = 'super-admin';

export interface PermissionSet {
  superAdmin: boolean;
  grants: ReadonlySet<string>;
  roleIds: readonly string[];
  /**
   * The apps whose screens are ALL this person may open — every role they
   * hold is screens-only (a till's cashier) — or null for everyone who may
   * use the dashboard: Super Admin, and anyone with one ordinary role.
   */
  screensOnly: readonly string[] | null;
  /**
   * The update grants that may write only some columns (rbac/update-limits.ts).
   * Absent means none: a set built without it limits nothing.
   */
  updateLimits?: UpdateLimits | undefined;
  /** The create grants a role narrows (`creatable`), and every other grant: see `rbac/update-limits.ts`. */
  createLimits?: UpdateLimits | undefined;
  /**
   * The read grants that show only some columns (rbac/read-limits.ts).
   * Absent means none: a set built without it limits nothing.
   */
  readLimits?: ReadLimits | undefined;
  /**
   * The read, update and delete grants that reach only some rows
   * (rbac/row-limits.ts), action by action. Absent means none.
   */
  rowLimits?: RowLimits | undefined;
  /**
   * Who the person is to a row: themselves, and the people of the teams they
   * lead. Set by {@link resolvePermissionSet} for whoever it resolves; a set
   * built from bare roles has none, and reaches no row a limit asks an owner for.
   */
  reach?: RowReachOf | undefined;
  /**
   * Set when the person holds roles and every one of them is of a part of an
   * app that is switched off: they are told so, in place of an empty dashboard.
   */
  partsOff?: true | undefined;
}

export function emptyPermissionSet(): PermissionSet {
  return { superAdmin: false, grants: new Set(), roleIds: [], screensOnly: null };
}

/** The app keys of a role list that is screens-only through and through, or null. */
export function screensOnlyApps(roles: readonly Role[]): string[] | null {
  if (roles.length === 0 || roles.some((role) => role.slug === SUPER_ADMIN_SLUG || !role.screensOnly)) return null;
  return [...new Set(roles.flatMap((role) => (role.appKey === null ? [] : [role.appKey])))];
}

/** Union the grant strings of a concrete role list. */
export async function resolveForRoles(meta: MetaDb, roles: readonly Role[]): Promise<PermissionSet> {
  const superAdmin = roles.some((role) => role.slug === SUPER_ADMIN_SLUG);
  const permissions = permissionsRepo(meta);
  const grants = new Set<string>();
  // The same union without the update grants a limit narrows, and the limits.
  const unlimited = new Set<string>();
  const limited: LimitedUpdate[] = [];
  // The same for reads: the read grants a limit narrows, and every other grant.
  const readUnlimited = new Set<string>();
  const readLimited: LimitedRead[] = [];
  // …and for creates: the create grants a limit narrows, and every other grant.
  const createUnlimited = new Set<string>();
  const createLimited: LimitedUpdate[] = [];
  // …and for which rows a read, an update and a delete reach: role by role, each action's limited grants and every other grant.
  const rowsByRole: RoleRowsDraft[] = [];
  // The roles that count: not one of an app that is switched off, nor one whose every part is.
  const live: Role[] = [];
  let partsOff = false;
  if (!superAdmin) {
    /*
     * An app's roles are suspended with it: they grant nothing until it is
     * switched back on, and nothing about them is deleted. The same for a
     * role whose parts are all off; and a role of a part holds nothing on
     * that part's tables while the part is off. A role of ANOTHER part goes
     * on reading them (a won deal's job is still a fact) and writes none of
     * them: a part that is off is stopped, for everybody.
     */
    const parts = await loadAppParts(meta, [...new Set(roles.flatMap((role) => (role.appKey === null ? [] : [role.appKey])))]);
    const closed = await tablesOfPartsOff(meta, parts);
    for (const role of roles) {
      if (role.appKey !== null && parts.get(role.appKey)?.disabled === true) continue;
      if (!roleIsOffered(role, parts)) {
        partsOff = true;
        continue;
      }
      live.push(role);
      const lapsed = role.appKey === null || role.modules === null ? [] : closed.filter((table) => table.app === role.appKey && role.modules!.includes(table.module));
      const rows = Object.fromEntries(ROW_ACTIONS.map((action) => [action, { limited: [] as LimitedRows[], unlimited: new Set<string>() }])) as RoleRowsDraft;
      rowsByRole.push(rows);
      for (const row of await permissions.listForRole(role.id)) {
        if (row.resourceKind === 'table' && lapsed.some((table) => refNamesTable(row.resourceRef, table.connectionId, table.table, table.schema))) continue;
        const stopped = row.resourceKind === 'table' && closed.some((table) => refNamesTable(row.resourceRef, table.connectionId, table.table, table.schema));
        const limit = limitOfRow(row);
        const read = readLimitOfRow(row);
        const create = createLimitOfRow(row);
        for (const grant of grantsFromMatrixRows([row])) {
          if (stopped && WRITES.test(grant)) continue;
          grants.add(grant);
          if (limit !== null && grant.endsWith(':update')) limited.push({ grant, limit });
          else unlimited.add(grant);
          if (create !== null && grant.endsWith(':create')) createLimited.push({ grant, limit: create });
          else createUnlimited.add(grant);
          if (read !== null && grant.endsWith(':read')) readLimited.push({ grant, limit: read });
          else readUnlimited.add(grant);
          for (const action of ROW_ACTIONS) {
            const reach = rowReachOfRow(row, action);
            if (reach !== null && grant.endsWith(`:${action}`)) rows[action].limited.push({ grant, reach });
            else rows[action].unlimited.add(grant);
          }
        }
      }
    }
  }
  return {
    superAdmin,
    grants,
    roleIds: roles.map((role) => role.id),
    // From every role held, as ever: a cashier whose app or part is off stays a person of those screens, and is told there.
    screensOnly: screensOnlyApps(roles),
    ...(partsOff && live.length === 0 ? { partsOff: true as const } : {}),
    ...(limited.length === 0 ? {} : { updateLimits: { limited, unlimited } }),
    ...(readLimited.length === 0 ? {} : { readLimits: { limited: readLimited, unlimited: readUnlimited } }),
    ...(createLimited.length === 0 ? {} : { createLimits: { limited: createLimited, unlimited: createUnlimited } }),
    ...rowLimitsOf(rowsByRole),
  };
}

/** The row limits of a set, action by action: an action no role limits is left out, and a set nothing limits has none. */
function rowLimitsOf(roles: readonly RoleRowsDraft[]): { rowLimits?: RowLimits } {
  const limited = ROW_ACTIONS.filter((action) => roles.some((role) => role[action].limited.length > 0));
  if (limited.length === 0) return {};
  return { rowLimits: Object.fromEntries(limited.map((action) => [action, roles.map((role) => role[action])])) as RowLimits };
}

/**
 * Resolve the acting principal's permission set. Unknown role ids (e.g. an
 * API key whose role was deleted) resolve to the empty set — deny.
 */
/** A table grant that changes rows: what nobody holds on a table of a part that is off. */
const WRITES = /:(create|update|delete|import)$/;

export async function resolvePermissionSet(meta: MetaDb, principal: RbacPrincipal): Promise<PermissionSet> {
  const roles = rolesRepo(meta);
  if (principal.kind === 'api-key') {
    const role = await roles.findById(principal.roleId);
    // A key has no person: it owns no row and leads no team.
    return role === null ? emptyPermissionSet() : { ...(await resolveForRoles(meta, [role])), reach: { userId: null, ledIds: [] } };
  }
  const set = await resolveForRoles(meta, await roles.rolesForUser(principal.id));
  // The people of the teams they lead: read only for someone a limit of theirs asks it of, so nobody else pays for it.
  const led = asksForTeam(set.rowLimits) ? await teamsRepo(meta).leadReach(principal.id) : { ids: [], capped: false };
  return { ...set, reach: { userId: principal.id, ledIds: led.ids, ...(led.capped ? { capped: true as const } : {}) } };
}

/** The single allow/deny decision: super-admin bypass, then the grant union. */
export function permissionSetAllows(set: PermissionSet, permission: string): boolean {
  if (set.superAdmin) return true;
  return isGranted(set.grants, permission);
}
