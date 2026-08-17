// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Roles & permissions data layer over `/api/v1/roles` and
 * `/api/v1/permissions/catalog`.
 *
 * ONLY GRANTABLE PERMISSIONS EVER REACH THE MATRIX. `@adminium/meta`'s
 * `RESERVED_SYSTEM_ACTION_KEYS` — `automations.manage`, `webhooks.manage`,
 * `manifests.manage`, `sql.run` — are deferred features with ZERO enforcement
 * points in v1: no route and no realtime authorizer checks them. They stay in
 * the closed grammar so stored grants keep round-tripping, but offering one in
 * a permissions UI would let an admin believe they had restricted something
 * that is not checked anywhere, which is worse than no control at all. The
 * catalog endpoint is authored from `GRANTABLE_SYSTEM_ACTION_KEYS` for exactly
 * this reason; {@link catalogPermissions} filters them out a SECOND time on the
 * way in, because this file cannot import the constant (the dashboard has no
 * `@adminium/meta` dependency) and a silent server-side drift would otherwise
 * render as a working switch.
 *
 * SYNC NOTE: {@link RESERVED_GRANTS} is the copied mirror of that list
 * (`packages/meta/src/schema/json-payloads.ts`), with `<area>.<verb>` spelled
 * as the `system:<area>:<verb>` grant string the matrix rows are keyed by.
 * Move a key out of both in the same change that lands its first enforcement
 * point.
 */
import { queryOptions } from '@tanstack/react-query';
import type { PermissionGrant, PermissionMatrixPermission } from '@adminium/ui';

import { api } from '../app/api.js';

/** The role whose column is hard-locked: `PUT /roles/:id/permissions` 409s. */
export const SUPER_ADMIN_SLUG = 'super-admin';

export interface RoleListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  /** Users currently holding the role — the delete flow's whole problem. */
  memberCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Row-header grouping (presentation only) — mirrors `permissionCategory`. */
export type PermissionCategory = 'access' | 'data' | 'workspace' | 'operations';

/** One catalog row: a grant string, an English label, and its group. */
export interface PermissionCatalogEntry {
  key: string;
  /**
   * The server's English fallback. The dashboard localizes by `key` where it
   * can (see `permissionLabel` in `RolesPage`) and falls back to this — which
   * is exactly what the endpoint's docblock asks for, and what keeps a key
   * added after this build from rendering as a raw dotted string.
   */
  label: string;
  category: PermissionCategory;
}

export interface PermissionCatalogReply {
  /** Grantable system actions only — never the full `SYSTEM_ACTION_KEYS`. */
  system: PermissionCatalogEntry[];
  /**
   * ACTION VOCABULARIES, not rows: `['read', 'create', …]` and
   * `['view', 'edit']`. They describe how a `table:`/`page:` grant is spelled
   * once a connection and a table are known — the catalog cannot enumerate
   * those rows without the schema, so the matrix carries the system rows only
   * and these are here for whoever builds the per-table editor.
   */
  tableActions: string[];
  pageActions: string[];
}

// --- the grammar + the reserved filter (pure) --------------------------------

/** Copied mirror — see the header's SYNC NOTE. */
export const RESERVED_GRANTS: readonly string[] = [
  'system:automations:manage',
  'system:webhooks:manage',
  'system:manifests:manage',
  'system:sql:run',
];

const SYSTEM_GRANT = /^system:[^:\s/]+:[^:\s/]+$/;
const TABLE_GRANT = /^table:[^:\s/]+:[^:\s/]+:(read|create|update|delete|export|import|\*)$/;
const PAGE_GRANT = /^page:[^:\s/]+:(view|edit|\*)$/;

/**
 * Does this string parse as a §5.1 grant?
 *
 * The matrix's row identity is a `PermissionGrant` template-literal type, and
 * a catalog row arrives as a plain string — so something has to decide, and a
 * blind cast would let a malformed row become a switch that saves a grant the
 * server then rejects for the whole role. Deny-by-default, like the server's
 * own parser.
 */
export function isPermissionGrant(key: string): key is PermissionGrant {
  return SYSTEM_GRANT.test(key) || TABLE_GRANT.test(key) || PAGE_GRANT.test(key);
}

/** A catalog entry that survived {@link catalogPermissions} — key is a grant. */
export interface GrantableCatalogEntry extends PermissionCatalogEntry {
  key: PermissionGrant;
}

/**
 * Catalog reply → matrix rows, with reserved and unparseable keys dropped and
 * duplicates collapsed onto their first appearance (which also fixes the group
 * order — `PermissionMatrix` groups by `category` in first-appearance order).
 *
 * `label` and `category` are handed back RAW; localizing them needs `t()`,
 * which this module deliberately does not import so the whole file stays
 * unit-testable without i18n. `RolesPage` maps them on the way into the
 * component.
 */
export function catalogPermissions(reply: PermissionCatalogReply): GrantableCatalogEntry[] {
  const rows: GrantableCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of reply.system) {
    const key = entry.key;
    if (seen.has(key)) continue;
    if (RESERVED_GRANTS.includes(key)) continue;
    if (!isPermissionGrant(key)) continue;
    seen.add(key);
    rows.push({ key, label: entry.label, category: entry.category });
  }
  return rows;
}

/** `PermissionMatrixPermission` is what the component wants; this is the join. */
export function matrixRows(
  entries: readonly GrantableCatalogEntry[],
  label: (entry: GrantableCatalogEntry) => string,
  category: (entry: GrantableCatalogEntry) => string,
): PermissionMatrixPermission[] {
  return entries.map((entry) => ({
    key: entry.key,
    label: label(entry),
    category: category(entry),
  }));
}

// --- edit state (pure) -------------------------------------------------------

export type GrantMap = Readonly<Record<string, readonly PermissionGrant[]>>;

/**
 * One cell flip, immutably. Order is preserved for untouched roles so the
 * matrix does not re-key every column on every click.
 */
export function toggleGrant(
  grants: GrantMap,
  roleId: string,
  key: PermissionGrant,
  granted: boolean,
): GrantMap {
  const current = grants[roleId] ?? [];
  if (granted) {
    if (current.includes(key)) return grants;
    return { ...grants, [roleId]: [...current, key] };
  }
  if (!current.includes(key)) return grants;
  return { ...grants, [roleId]: current.filter((entry) => entry !== key) };
}

/**
 * Which roles have unsaved edits.
 *
 * This drives BOTH the save button and what the save actually sends: the API
 * is a full-matrix replace PER ROLE (`PUT /roles/:id/permissions`), so saving
 * every role on every click would rewrite — and audit-log — matrices nobody
 * touched. Set comparison rather than array comparison because a re-ordered
 * grant list is the same grant set.
 */
export function changedRoleIds(grants: GrantMap, baseline: GrantMap): string[] {
  const roleIds = new Set([...Object.keys(grants), ...Object.keys(baseline)]);
  const changed: string[] = [];
  for (const roleId of roleIds) {
    const current = new Set(grants[roleId] ?? []);
    const persisted = new Set(baseline[roleId] ?? []);
    if (current.size !== persisted.size || [...current].some((key) => !persisted.has(key))) {
      changed.push(roleId);
    }
  }
  return changed.sort();
}

/** Individual cell flips still pending — the save bar's count. */
export function pendingChangeCount(grants: GrantMap, baseline: GrantMap): number {
  const roleIds = new Set([...Object.keys(grants), ...Object.keys(baseline)]);
  let total = 0;
  for (const roleId of roleIds) {
    const current = new Set(grants[roleId] ?? []);
    const persisted = new Set(baseline[roleId] ?? []);
    for (const key of current) if (!persisted.has(key)) total++;
    for (const key of persisted) if (!current.has(key)) total++;
  }
  return total;
}

/**
 * `DELETE /roles/:id` — with the reassignment target when the role still has
 * members. The server 409s a populated role without it, which is the whole
 * reason the delete flow carries a picker.
 */
export function roleDeletePath(id: string, reassignTo: string | null): string {
  return reassignTo === null || reassignTo === ''
    ? `/api/v1/roles/${id}`
    : `/api/v1/roles/${id}?reassignTo=${encodeURIComponent(reassignTo)}`;
}

// --- queries + mutations -----------------------------------------------------

export const ROLES_QUERY_KEY = ['roles'] as const;

export function rolesQuery() {
  return queryOptions({
    queryKey: ROLES_QUERY_KEY,
    queryFn: async () => (await api.get<{ roles: RoleListItem[] }>('/api/v1/roles')).roles,
  });
}

export function permissionCatalogQuery() {
  return queryOptions({
    // The catalog is derived from a compiled-in closed set plus the connected
    // schema; it changes with a deploy or a remap, not with a navigation.
    queryKey: ['permissions', 'catalog'] as const,
    staleTime: 5 * 60_000,
    queryFn: () => api.get<PermissionCatalogReply>('/api/v1/permissions/catalog'),
  });
}

export function roleGrantsQuery(roleId: string) {
  return queryOptions({
    queryKey: ['roles', 'grants', roleId] as const,
    queryFn: async () =>
      (await api.get<{ roleId: string; grants: string[] }>(`/api/v1/roles/${roleId}/permissions`))
        .grants,
  });
}

export function createRole(body: { name: string; description?: string }): Promise<unknown> {
  return api.post<unknown>('/api/v1/roles', body);
}

export function renameRole(id: string, body: { name: string }): Promise<unknown> {
  return api.patch<unknown>(`/api/v1/roles/${id}`, body);
}

export function deleteRole(id: string, reassignTo: string | null): Promise<unknown> {
  return api.delete<unknown>(roleDeletePath(id, reassignTo));
}

export function putRoleGrants(id: string, grants: readonly PermissionGrant[]): Promise<unknown> {
  return api.put<unknown>(`/api/v1/roles/${id}/permissions`, { grants: [...grants] });
}
