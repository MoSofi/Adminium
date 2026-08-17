// SPDX-License-Identifier: AGPL-3.0-only
import type * as React from 'react';

import { ToggleMatrix } from '../toggle-matrix/ToggleMatrix.js';
import type { ToggleMatrixCellState, ToggleMatrixGroup } from '../toggle-matrix/ToggleMatrix.js';

/**
 * The RBAC grant-string grammar (apps/server/src/rbac/permissions.ts,
 * 08-server-api.md §5.1), mirrored as template-literal types so permission
 * keys are checked at the call site:
 *
 * ```
 * system:<area>:<verb>                    // closed set, e.g. system:roles:manage
 * table:<connectionId>:<table>:<action>   // read|create|update|delete|export|import
 * page:<pageId>:<view|edit>
 * ```
 *
 * `*` may stand in for any single `table:`/`page:` segment in *stored*
 * grants (`table:*:*:read`); `system:` grants are always concrete.
 */
export type TableGrantAction = 'read' | 'create' | 'update' | 'delete' | 'export' | 'import';
export type SystemGrant = `system:${string}:${string}`;
export type TableGrant = `table:${string}:${string}:${TableGrantAction | '*'}`;
export type PageGrant = `page:${string}:${'view' | 'edit' | '*'}`;
export type PermissionGrant = SystemGrant | TableGrant | PageGrant;

export interface PermissionMatrixRole {
  /** Server role id (`RoleDto.id`) — echoed in `onChange`. */
  id: string;
  /** Column header text. */
  name: string;
  /**
   * Hard-locks the whole column (the comp's "Owner column hard-locked"):
   * every cell renders locked-granted and never emits changes. Map the
   * server's super-admin role here — `PUT /roles/:id/permissions` 409s on it.
   */
  locked?: boolean | undefined;
}

export interface PermissionMatrixPermission {
  /** Grant string in the server grammar — the row identity. */
  key: PermissionGrant;
  /** Human row label ("Manage roles & access"). */
  label: string;
  /** Category group; rows group by first appearance, labeled with an `Eyebrow`. */
  category: string;
}

/** Change event: one cell flipped. */
export interface PermissionMatrixChange {
  roleId: string;
  permissionKey: PermissionGrant;
  granted: boolean;
}

export interface PermissionMatrixProps
  extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'onChange' | 'onToggle'> {
  /** Roles as columns, in display order. */
  roles: readonly PermissionMatrixRole[];
  /** Permission rows; grouped by `category` in first-appearance order. */
  permissions: readonly PermissionMatrixPermission[];
  /** Current (edited) grants per role id. */
  grants: Readonly<Record<string, readonly PermissionGrant[]>>;
  /**
   * Server-persisted grants per role id. When provided, cells whose value
   * differs from the baseline show the accent diff dot (dirty tracking for
   * the save bar).
   */
  baseline?: Readonly<Record<string, readonly PermissionGrant[]>> | undefined;
  /** Fires when an editable cell is toggled. */
  onChange?: ((change: PermissionMatrixChange) => void) | undefined;
  /** Accessible name for the grid (required — i18n). */
  label: string;
  /** First-column heading (e.g. "Permission"). */
  rowHeader: React.ReactNode;
  /** Optional Lucide icon per category, keyed by category label. */
  categoryIcons?: Readonly<Record<string, React.ReactNode>> | undefined;
  /** Disables all editing (viewer role / save in flight). */
  disabled?: boolean | undefined;
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * PermissionMatrix — the RBAC preset over `ToggleMatrix` per Roles
 * Permissions.dc.html: roles as columns (locked roles render the
 * hard-locked Owner column), permission rows grouped by category under
 * uppercase `Eyebrow` labels, diff-aware accent dots against a baseline, and
 * `onChange` emitting `{ roleId, permissionKey, granted }`.
 *
 * Endpoint contract (apps/server/src/routes/roles):
 * - `GET /api/v1/roles` → `{ roles: RoleDto & { memberCount }[] }` (columns);
 * - `GET /api/v1/roles/:id/permissions` → `{ roleId, grants: string[] }`
 *   (feed as `grants[roleId]` and snapshot into `baseline`);
 * - save = full-matrix replace per role:
 *   `PUT /api/v1/roles/:id/permissions` with `{ grants: string[] }` (max
 *   2000) → `{ roleId, grants }`. `422 VALIDATION_FAILED` lists grants
 *   outside the grammar; `409 CONFLICT` when `:id` is the super-admin role
 *   (hard-locked column) — mark that role `locked` so the UI never tries.
 * Requires `system:roles:manage`; every save writes an `rbac` audit entry.
 */
export function PermissionMatrix({
  roles,
  permissions,
  grants,
  baseline,
  onChange,
  label,
  rowHeader,
  categoryIcons,
  disabled = false,
  className,
  ...props
}: PermissionMatrixProps) {
  // Group rows by category, preserving first-appearance order.
  const rowsByCategory = new Map<string, { id: string; label: string }[]>();
  for (const permission of permissions) {
    let rows = rowsByCategory.get(permission.category);
    if (rows === undefined) {
      rows = [];
      rowsByCategory.set(permission.category, rows);
    }
    rows.push({ id: permission.key, label: permission.label });
  }
  const groups: ToggleMatrixGroup[] = [...rowsByCategory.entries()].map(([category, rows]) => ({
    id: `category-${slug(category)}`,
    label: category,
    rows,
    ...(categoryIcons?.[category] === undefined ? {} : { icon: categoryIcons[category] }),
  }));

  const grantSets = new Map<string, ReadonlySet<string>>(
    roles.map((role) => [role.id, new Set(grants[role.id] ?? [])]),
  );
  const baselineSets =
    baseline === undefined
      ? null
      : new Map<string, ReadonlySet<string>>(
          roles.map((role) => [role.id, new Set(baseline[role.id] ?? [])]),
        );

  const getCellState = (rowId: string, columnId: string): ToggleMatrixCellState =>
    grantSets.get(columnId)?.has(rowId) === true ? 'on' : 'off';

  const isDirty = (rowId: string, columnId: string): boolean => {
    if (baselineSets === null) return false;
    const current = grantSets.get(columnId)?.has(rowId) === true;
    const persisted = baselineSets.get(columnId)?.has(rowId) === true;
    return current !== persisted;
  };

  return (
    <ToggleMatrix
      data-part="permission-matrix"
      columns={roles.map((role) => ({
        id: role.id,
        label: role.name,
        ...(role.locked === undefined ? {} : { locked: role.locked }),
      }))}
      groups={groups}
      label={label}
      rowHeader={rowHeader}
      getCellState={getCellState}
      isDirty={isDirty}
      disabled={disabled}
      onToggle={(rowId, columnId, next) => {
        onChange?.({ roleId: columnId, permissionKey: rowId as PermissionGrant, granted: next });
      }}
      className={className}
      {...props}
    />
  );
}
