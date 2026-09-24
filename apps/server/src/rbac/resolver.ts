// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Effective-permission resolution: principal → roles (`adminium_user_roles`,
 * or the API key's single role) → union of the roles' matrix rows as grant
 * strings. `super-admin` short-circuits to allow-all; everything else is
 * deny-by-default via {@link isGranted}.
 */

import { permissionsRepo, rolesRepo, type MetaDb, type Role } from '@adminium/meta';

import { grantsFromMatrixRows, isGranted } from './permissions.js';
import type { RbacPrincipal } from './principal.js';
import { limitOfRow, type LimitedUpdate, type UpdateLimits } from './update-limits.js';

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
}

export function emptyPermissionSet(): PermissionSet {
  return { superAdmin: false, grants: new Set(), roleIds: [], screensOnly: null };
}

/** The app keys of a role list that is screens-only through and through, or null. */
export function screensOnlyApps(roles: readonly Role[]): string[] | null {
  if (roles.length === 0 || roles.some((role) => role.slug === SUPER_ADMIN_SLUG || !role.screensOnly)) return null;
  return [...new Set(roles.flatMap((role) => (role.appKey === null ? [] : [role.appKey])))];
}

/**
 * The app keys among these roles whose app is switched off. An app's roles
 * are suspended with it: they grant nothing until it is switched back on, and
 * nothing about them is deleted.
 */
async function suspendedApps(meta: MetaDb, roles: readonly Role[]): Promise<ReadonlySet<string>> {
  const keys = [...new Set(roles.flatMap((role) => (role.appKey === null ? [] : [role.appKey])))];
  if (keys.length === 0) return new Set();
  const rows = await meta.db
    .selectFrom('adminium_manifests')
    .select('manifestKey')
    .where('kind', '=', 'app')
    .where('status', '=', 'disabled')
    .where('manifestKey', 'in', keys)
    .execute();
  return new Set(rows.map((row) => row.manifestKey));
}

/** Union the grant strings of a concrete role list. */
export async function resolveForRoles(meta: MetaDb, roles: readonly Role[]): Promise<PermissionSet> {
  const superAdmin = roles.some((role) => role.slug === SUPER_ADMIN_SLUG);
  const permissions = permissionsRepo(meta);
  const grants = new Set<string>();
  // The same union without the update grants a limit narrows, and the limits.
  const unlimited = new Set<string>();
  const limited: LimitedUpdate[] = [];
  if (!superAdmin) {
    const suspended = await suspendedApps(meta, roles);
    for (const role of roles) {
      if (role.appKey !== null && suspended.has(role.appKey)) continue;
      for (const row of await permissions.listForRole(role.id)) {
        const limit = limitOfRow(row);
        for (const grant of grantsFromMatrixRows([row])) {
          grants.add(grant);
          if (limit !== null && grant.endsWith(':update')) limited.push({ grant, limit });
          else unlimited.add(grant);
        }
      }
    }
  }
  return {
    superAdmin,
    grants,
    roleIds: roles.map((role) => role.id),
    screensOnly: screensOnlyApps(roles),
    ...(limited.length === 0 ? {} : { updateLimits: { limited, unlimited } }),
  };
}

/**
 * Resolve the acting principal's permission set. Unknown role ids (e.g. an
 * API key whose role was deleted) resolve to the empty set — deny.
 */
export async function resolvePermissionSet(meta: MetaDb, principal: RbacPrincipal): Promise<PermissionSet> {
  const roles = rolesRepo(meta);
  if (principal.kind === 'api-key') {
    const role = await roles.findById(principal.roleId);
    return role === null ? emptyPermissionSet() : resolveForRoles(meta, [role]);
  }
  return resolveForRoles(meta, await roles.rolesForUser(principal.id));
}

/** The single allow/deny decision: super-admin bypass, then the grant union. */
export function permissionSetAllows(set: PermissionSet, permission: string): boolean {
  if (set.superAdmin) return true;
  return isGranted(set.grants, permission);
}
