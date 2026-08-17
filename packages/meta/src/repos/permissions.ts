// SPDX-License-Identifier: AGPL-3.0-only
/**
 * permissionsRepo — adminium_role_permissions (07-meta-store.md §3.9).
 * The `actions` JSON is Zod-validated per resource kind and never queried in
 * SQL (the server layers an in-memory cache on top).
 */

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  permissionActionsSchemaFor,
  resourceKindSchema,
  type PermissionActions,
  type ResourceKind,
} from '../schema/json-payloads.js';
import { packJson, readJson } from './util.js';

export interface RolePermission {
  id: string;
  roleId: string;
  resourceKind: ResourceKind;
  resourceRef: string;
  actions: PermissionActions;
}

export function permissionsRepo(meta: MetaDb) {
  const { db } = meta;

  async function find(roleId: string, resourceKind: ResourceKind, resourceRef: string): Promise<RolePermission | null> {
    const row = await db
      .selectFrom('adminium_role_permissions')
      .selectAll()
      .where('roleId', '=', roleId)
      .where('resourceKind', '=', resourceKind)
      .where('resourceRef', '=', resourceRef)
      .executeTakeFirst();
    if (!row) return null;
    const kind = resourceKindSchema.parse(row.resourceKind);
    return {
      id: row.id,
      roleId: row.roleId,
      resourceKind: kind,
      resourceRef: row.resourceRef,
      actions: permissionActionsSchemaFor(kind).parse(readJson(row.actions)),
    };
  }

  return {
    find,

    /** Upsert one matrix row keyed by (role, kind, ref). */
    async grant(
      roleId: string,
      resourceKind: ResourceKind,
      resourceRef: string,
      actions: PermissionActions,
    ): Promise<RolePermission> {
      const kind = resourceKindSchema.parse(resourceKind);
      const validated = permissionActionsSchemaFor(kind).parse(actions);
      const value = packJson(validated);
      const res = await db
        .updateTable('adminium_role_permissions')
        .set({ actions: value })
        .where('roleId', '=', roleId)
        .where('resourceKind', '=', kind)
        .where('resourceRef', '=', resourceRef)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        await db
          .insertInto('adminium_role_permissions')
          .values({ id: newId('perm'), roleId, resourceKind: kind, resourceRef, actions: value })
          .execute();
      }
      const row = await find(roleId, kind, resourceRef);
      if (!row) throw new Error('permission row disappeared during grant');
      return row;
    },

    async revoke(roleId: string, resourceKind: ResourceKind, resourceRef: string): Promise<boolean> {
      const res = await db
        .deleteFrom('adminium_role_permissions')
        .where('roleId', '=', roleId)
        .where('resourceKind', '=', resourceKind)
        .where('resourceRef', '=', resourceRef)
        .executeTakeFirst();
      return Number(res.numDeletedRows) === 1;
    },

    /**
     * Drop every role's grants for one resource — the cleanup a page delete
     * owes.
     *
     * `resource_ref` is polymorphic across the three kinds, so it is a plain
     * `varchar(255)` with no foreign key; nothing cascades page grants the way
     * `adminium_views` and `adminium_scheduled_reports` cascade. Without this,
     * deleting a page leaves dead `page:<id>:*` rows behind forever — and page
     * ids are deterministic for generated pages, so a page later regenerated
     * at the same id would silently inherit the deleted page's access list.
     * Returns the number of rows removed.
     */
    async revokeAllForResource(resourceKind: ResourceKind, resourceRef: string): Promise<number> {
      const res = await db
        .deleteFrom('adminium_role_permissions')
        .where('resourceKind', '=', resourceKindSchema.parse(resourceKind))
        .where('resourceRef', '=', resourceRef)
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n);
    },

    /** Every role that holds a grant on one resource (page-access editor). */
    async listForResource(
      resourceKind: ResourceKind,
      resourceRef: string,
    ): Promise<RolePermission[]> {
      const kind = resourceKindSchema.parse(resourceKind);
      const rows = await db
        .selectFrom('adminium_role_permissions')
        .selectAll()
        .where('resourceKind', '=', kind)
        .where('resourceRef', '=', resourceRef)
        .orderBy('roleId', 'asc')
        .execute();
      return rows.map((row) => ({
        id: row.id,
        roleId: row.roleId,
        resourceKind: kind,
        resourceRef: row.resourceRef,
        actions: permissionActionsSchemaFor(kind).parse(readJson(row.actions)),
      }));
    },

    async listForRole(roleId: string): Promise<RolePermission[]> {
      const rows = await db
        .selectFrom('adminium_role_permissions')
        .selectAll()
        .where('roleId', '=', roleId)
        .orderBy('resourceKind', 'asc')
        .orderBy('resourceRef', 'asc')
        .execute();
      return rows.map((row) => {
        const kind = resourceKindSchema.parse(row.resourceKind);
        return {
          id: row.id,
          roleId: row.roleId,
          resourceKind: kind,
          resourceRef: row.resourceRef,
          actions: permissionActionsSchemaFor(kind).parse(readJson(row.actions)),
        };
      });
    },

    /**
     * Single matrix-cell check: `action` is `read`/`update`/… for tables,
     * `view`/`edit` for pages, and ignored (the ref IS the action) for system.
     */
    async isAllowed(roleId: string, resourceKind: ResourceKind, resourceRef: string, action?: string): Promise<boolean> {
      const row = await find(roleId, resourceKind, resourceRef);
      if (!row) return false;
      if (resourceKind === 'system') return (row.actions as { allowed: boolean }).allowed;
      if (action === undefined) return false;
      const value = (row.actions as Record<string, unknown>)[action];
      return value === true;
    },
  };
}

export type PermissionsRepo = ReturnType<typeof permissionsRepo>;
