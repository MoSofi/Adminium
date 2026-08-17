/**
 * usersRepo — adminium_users (07-meta-store.md §3.3).
 * Thin data access only: password hashing happens in the server.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { recoveryCodesSchema, userStatusSchema, type UserStatus } from '../schema/json-payloads.js';
import type { AdminiumUsersTable } from '../schema/tables.js';
import { MetaValidationError, packJson, readBool, readJsonOrNull, writeBool } from './util.js';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  status: UserStatus;
  totpSecretEncrypted: string | null;
  totpEnabled: boolean;
  recoveryCodes: string[] | null;
  avatarFileId: string | null;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash?: string | null;
  status?: UserStatus;
}

/** Profile columns an administrator may rewrite (`me` owns the self-serve path). */
export interface UpdateUserProfileInput {
  name?: string | undefined;
  email?: string | undefined;
}

/** Keyset anchor: the page returns rows strictly older than this pair. */
export interface UserListCursor {
  createdAt: number;
  id: string;
}

export interface ListUsersFilter {
  /** Case-insensitive substring over name + email. */
  q?: string | undefined;
  status?: UserStatus | undefined;
  /** Only users holding this role (`adminium_user_roles`). */
  roleId?: string | undefined;
  cursor?: UserListCursor | undefined;
  /** Page size; callers ask for one extra row to detect a next page. */
  limit?: number | undefined;
}

/** Lowercase + shape check — the same rule `create` has always applied. */
function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > 320 || !email.includes('@')) {
    throw new MetaValidationError(`invalid email: ${JSON.stringify(input)}`);
  }
  return email;
}

/** Escape LIKE wildcards in the user-supplied search term. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function mapUser(row: Selectable<AdminiumUsersTable>): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    status: userStatusSchema.parse(row.status),
    totpSecretEncrypted: row.totpSecretEncrypted,
    totpEnabled: readBool(row.totpEnabled),
    recoveryCodes: readJsonOrNull<string[]>(row.recoveryCodes),
    avatarFileId: row.avatarFileId,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function usersRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreateUserInput, at: number = Date.now()): Promise<User> {
      const status = userStatusSchema.parse(input.status ?? 'active');
      const email = normalizeEmail(input.email);
      const row = {
        id: newId('usr'),
        email,
        name: input.name,
        passwordHash: input.passwordHash ?? null,
        status,
        totpSecretEncrypted: null,
        totpEnabled: writeBool(meta, false),
        recoveryCodes: null,
        avatarFileId: null,
        lastLoginAt: null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_users').values(row).execute();
      return mapUser(row as Selectable<AdminiumUsersTable>);
    },

    async findByEmail(email: string): Promise<User | null> {
      const row = await db
        .selectFrom('adminium_users')
        .selectAll()
        .where('email', '=', email.trim().toLowerCase())
        .executeTakeFirst();
      return row ? mapUser(row) : null;
    },

    async findById(id: string): Promise<User | null> {
      const row = await db.selectFrom('adminium_users').selectAll().where('id', '=', id).executeTakeFirst();
      return row ? mapUser(row) : null;
    },

    /**
     * Directory page, newest first, keyset-paginated on `(createdAt, id)` —
     * the same anchor the audit list uses (ids are time-ordered ULIDs, so the
     * pair is a total order). `q` matches name or email; `email` is stored
     * lowercased, so only `name` needs the portable `lower()` wrapper.
     */
    async list(filter: ListUsersFilter = {}): Promise<User[]> {
      let q = db.selectFrom('adminium_users').selectAll();
      if (filter.status !== undefined) {
        q = q.where('status', '=', userStatusSchema.parse(filter.status));
      }
      const roleId = filter.roleId;
      if (roleId !== undefined) {
        q = q.where('id', 'in', (eb) =>
          eb.selectFrom('adminium_user_roles').select('userId').where('roleId', '=', roleId),
        );
      }
      const term = filter.q?.trim() ?? '';
      if (term.length > 0) {
        const needle = `%${escapeLike(term.toLowerCase())}%`;
        q = q.where((eb) =>
          eb.or([
            eb(eb.fn<string>('lower', ['name']), 'like', needle),
            eb('email', 'like', needle),
          ]),
        );
      }
      const cursor = filter.cursor;
      if (cursor !== undefined) {
        q = q.where((eb) =>
          eb.or([
            eb('createdAt', '<', cursor.createdAt),
            eb.and([eb('createdAt', '=', cursor.createdAt), eb('id', '<', cursor.id)]),
          ]),
        );
      }
      const rows = await q
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(filter.limit ?? 50)
        .execute();
      return rows.map(mapUser);
    },

    /** Name/email rewrite; uniqueness is the caller's check (409 vs 500). */
    async updateProfile(
      userId: string,
      patch: UpdateUserProfileInput,
      at: number = Date.now(),
    ): Promise<boolean> {
      const set: { name?: string; email?: string; updatedAt: number } = { updatedAt: at };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.email !== undefined) set.email = normalizeEmail(patch.email);
      const res = await db
        .updateTable('adminium_users')
        .set(set)
        .where('id', '=', userId)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async updatePassword(userId: string, passwordHash: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_users')
        .set({ passwordHash, updatedAt: at })
        .where('id', '=', userId)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async updateStatus(userId: string, status: UserStatus, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_users')
        .set({ status: userStatusSchema.parse(status), updatedAt: at })
        .where('id', '=', userId)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async setRecoveryCodes(userId: string, codes: string[] | null, at: number = Date.now()): Promise<boolean> {
      const value = codes === null ? null : packJson(recoveryCodesSchema.parse(codes));
      const res = await db
        .updateTable('adminium_users')
        .set({ recoveryCodes: value, updatedAt: at })
        .where('id', '=', userId)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async recordLogin(userId: string, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_users')
        .set({ lastLoginAt: at, updatedAt: at })
        .where('id', '=', userId)
        .execute();
    },

    async count(): Promise<number> {
      const row = await db
        .selectFrom('adminium_users')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /** Directory tab counts; every status key is present, zero-filled. */
    async countByStatus(): Promise<Record<UserStatus, number>> {
      const rows = await db
        .selectFrom('adminium_users')
        .select(['status', ({ fn }) => fn.countAll<number>().as('n')])
        .groupBy('status')
        .execute();
      const counts: Record<UserStatus, number> = { active: 0, invited: 0, suspended: 0 };
      for (const row of rows) {
        const parsed = userStatusSchema.safeParse(row.status);
        if (parsed.success) counts[parsed.data] = Number(row.n);
      }
      return counts;
    },
  };
}

export type UsersRepo = ReturnType<typeof usersRepo>;
