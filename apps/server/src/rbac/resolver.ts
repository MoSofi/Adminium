// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Effective-permission resolution (08-server-api.md §5.1): principal →
 * roles (`adminium_user_roles`, or the API key's single role) → union of the
 * roles' matrix rows as grant strings. `super-admin` short-circuits to
 * allow-all; everything else is deny-by-default via {@link isGranted}.
 */

import { permissionsRepo, rolesRepo, type MetaDb, type Role } from '@adminium/meta';

import { grantsFromMatrixRows, isGranted } from './permissions.js';
import type { RbacPrincipal } from './principal.js';

/** Built-in slug whose members bypass every check (07-meta-store.md §3.8). */
export const SUPER_ADMIN_SLUG = 'super-admin';

export interface PermissionSet {
  superAdmin: boolean;
  grants: ReadonlySet<string>;
  roleIds: readonly string[];
}

export function emptyPermissionSet(): PermissionSet {
  return { superAdmin: false, grants: new Set(), roleIds: [] };
}

/** Union the grant strings of a concrete role list. */
export async function resolveForRoles(meta: MetaDb, roles: readonly Role[]): Promise<PermissionSet> {
  const superAdmin = roles.some((role) => role.slug === SUPER_ADMIN_SLUG);
  const permissions = permissionsRepo(meta);
  const grants = new Set<string>();
  if (!superAdmin) {
    for (const role of roles) {
      for (const grant of grantsFromMatrixRows(await permissions.listForRole(role.id))) {
        grants.add(grant);
      }
    }
  }
  return { superAdmin, grants, roleIds: roles.map((role) => role.id) };
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
