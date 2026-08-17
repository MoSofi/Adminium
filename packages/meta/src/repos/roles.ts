// SPDX-License-Identifier: AGPL-3.0-only
/**
 * rolesRepo — adminium_roles + adminium_user_roles
 * (07-meta-store.md §3.8, §3.10).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumRolesTable } from '../schema/tables.js';
import { readBool, writeBool } from './util.js';

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRoleInput {
  slug: string;
  name: string;
  description?: string | null;
  isBuiltin?: boolean;
}

function mapRole(row: Selectable<AdminiumRolesTable>): Role {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isBuiltin: readBool(row.isBuiltin),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function rolesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreateRoleInput, at: number = Date.now()): Promise<Role> {
      const row = {
        id: newId('role'),
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        isBuiltin: writeBool(meta, input.isBuiltin ?? false),
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_roles').values(row).execute();
      return mapRole(row as Selectable<AdminiumRolesTable>);
    },

    async findBySlug(slug: string): Promise<Role | null> {
      const row = await db.selectFrom('adminium_roles').selectAll().where('slug', '=', slug).executeTakeFirst();
      return row ? mapRole(row) : null;
    },

    async findById(id: string): Promise<Role | null> {
      const row = await db.selectFrom('adminium_roles').selectAll().where('id', '=', id).executeTakeFirst();
      return row ? mapRole(row) : null;
    },

    async list(): Promise<Role[]> {
      const rows = await db.selectFrom('adminium_roles').selectAll().orderBy('slug', 'asc').execute();
      return rows.map(mapRole);
    },

    async rename(roleId: string, name: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_roles')
        .set({ name, updatedAt: at })
        .where('id', '=', roleId)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Idempotent grant of a role to a user. */
    async assignToUser(userId: string, roleId: string, grantedBy: string | null = null, at: number = Date.now()): Promise<void> {
      const existing = await db
        .selectFrom('adminium_user_roles')
        .select('userId')
        .where('userId', '=', userId)
        .where('roleId', '=', roleId)
        .executeTakeFirst();
      if (existing) return;
      await db
        .insertInto('adminium_user_roles')
        .values({ userId, roleId, grantedBy, createdAt: at })
        .execute();
    },

    async removeFromUser(userId: string, roleId: string): Promise<boolean> {
      const res = await db
        .deleteFrom('adminium_user_roles')
        .where('userId', '=', userId)
        .where('roleId', '=', roleId)
        .executeTakeFirst();
      return Number(res.numDeletedRows) === 1;
    },

    async rolesForUser(userId: string): Promise<Role[]> {
      const rows = await db
        .selectFrom('adminium_user_roles')
        .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
        .selectAll('adminium_roles')
        .where('adminium_user_roles.userId', '=', userId)
        .orderBy('adminium_roles.slug', 'asc')
        .execute();
      return rows.map(mapRole);
    },
  };
}

export type RolesRepo = ReturnType<typeof rolesRepo>;
