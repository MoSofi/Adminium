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
      const email = input.email.trim().toLowerCase();
      if (email.length === 0 || email.length > 320 || !email.includes('@')) {
        throw new MetaValidationError(`invalid email: ${JSON.stringify(input.email)}`);
      }
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
  };
}

export type UsersRepo = ReturnType<typeof usersRepo>;
