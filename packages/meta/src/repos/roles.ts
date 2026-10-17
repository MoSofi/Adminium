// SPDX-License-Identifier: AGPL-3.0-only
/**
 * rolesRepo — adminium_roles + adminium_user_roles.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumRolesTable } from '../schema/tables.js';
import { packJson, readBool, readJsonOrNull, writeBool } from './util.js';

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
  /** The app whose manifest created this role; null for every other role. */
  appKey: string | null;
  /** Opens the app's own screens and never the dashboard. */
  screensOnly: boolean;
  /** The parts of its app the role belongs to; null when it names none (it is then always offered). */
  modules: string[] | null;
  /** The name its manifest gave it, and that name in other languages; null when it gave one language. */
  names: RoleNames | null;
}

/** A role's name as its manifest wrote it: shown in the reader's language while the role still carries `from`. */
export interface RoleNames {
  from: string;
  names: Record<string, string>;
}

/** The name of a role for a reader: their language while the owner has not renamed it. */
export function roleNameFor(role: Pick<Role, 'name' | 'names'>, pick: (names: Record<string, string>) => string | undefined): string {
  if (role.names === null || role.names.from !== role.name) return role.name;
  return pick(role.names.names) ?? role.name;
}

export interface CreateRoleInput {
  slug: string;
  name: string;
  description?: string | null;
  isBuiltin?: boolean;
  appKey?: string | null;
  screensOnly?: boolean;
  modules?: readonly string[] | null;
  names?: RoleNames | null;
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
    appKey: row.appKey ?? null,
    screensOnly: readBool(row.screensOnly ?? false),
    modules: partsOf(row.modules),
    names: namesOf(row.names),
  };
}

function partsOf(value: unknown): string[] | null {
  const read = value === null || value === undefined ? null : readJsonOrNull<unknown>(value);
  return Array.isArray(read) && read.every((id) => typeof id === 'string') && read.length > 0 ? (read as string[]) : null;
}

function namesOf(value: unknown): RoleNames | null {
  const read = value === null || value === undefined ? null : readJsonOrNull<{ from?: unknown; names?: unknown }>(value);
  if (read === null || typeof read !== 'object' || typeof read.from !== 'string' || typeof read.names !== 'object' || read.names === null) return null;
  return { from: read.from, names: Object.fromEntries(Object.entries(read.names as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) };
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
        appKey: input.appKey ?? null,
        screensOnly: writeBool(meta, input.screensOnly ?? false),
        // Written only when there is something to write: a store part-way through its waves has neither column yet.
        ...(input.modules === undefined || input.modules === null || input.modules.length === 0 ? {} : { modules: packJson(input.modules) }),
        ...(input.names === undefined || input.names === null ? {} : { names: packJson(input.names) }),
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

    /** What a manifest says of its role beside the grants: its parts and its name in other languages. */
    async setParts(roleId: string, input: { modules: readonly string[] | null; names: RoleNames | null }, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_roles')
        .set({
          modules: input.modules === null || input.modules.length === 0 ? null : packJson(input.modules),
          names: input.names === null ? null : packJson(input.names),
          updatedAt: at,
        })
        .where('id', '=', roleId)
        .execute();
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

    /**
     * Every user holding this role. Added for ("notify everyone with a
     * role"), which is the first caller that needs the assignment table read
     * in this direction — `rolesForUser` reads it in the other.
     */
    async usersInRole(roleId: string): Promise<string[]> {
      const rows = await db
        .selectFrom('adminium_user_roles')
        .select('userId')
        .where('roleId', '=', roleId)
        .execute();
      return rows.map((row) => row.userId);
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
