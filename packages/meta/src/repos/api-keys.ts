/**
 * apiKeysRepo — adminium_api_keys (07-meta-store.md §3.7).
 * Stripe-style `adm_live_…`: the secret is shown once by the server; only the
 * SHA-256 hash lands here. The key acts with its role's permissions.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumApiKeysTable } from '../schema/tables.js';

export type ApiKey = Selectable<AdminiumApiKeysTable>;

export interface CreateApiKeyInput {
  name: string;
  /** Display fragment, e.g. `adm_live_4f2…`. */
  prefix: string;
  tokenHash: string;
  roleId: string;
  createdBy?: string | null;
  expiresAt?: number | null;
}

export function apiKeysRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreateApiKeyInput, at: number = Date.now()): Promise<ApiKey> {
      const row: ApiKey = {
        id: newId('key'),
        name: input.name,
        prefix: input.prefix,
        tokenHash: input.tokenHash,
        roleId: input.roleId,
        createdBy: input.createdBy ?? null,
        lastUsedAt: null,
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        createdAt: at,
      };
      await db.insertInto('adminium_api_keys').values(row).execute();
      return row;
    },

    async findByPrefix(prefix: string): Promise<ApiKey[]> {
      return db.selectFrom('adminium_api_keys').selectAll().where('prefix', '=', prefix).execute();
    },

    async findById(id: string): Promise<ApiKey | null> {
      const row = await db.selectFrom('adminium_api_keys').selectAll().where('id', '=', id).executeTakeFirst();
      return row ?? null;
    },

    /** Auth lookup: un-revoked and unexpired at `at`. */
    async findValidByTokenHash(tokenHash: string, at: number = Date.now()): Promise<ApiKey | null> {
      const row = await db
        .selectFrom('adminium_api_keys')
        .selectAll()
        .where('tokenHash', '=', tokenHash)
        .where('revokedAt', 'is', null)
        .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', at)]))
        .executeTakeFirst();
      return row ?? null;
    },

    async list(): Promise<ApiKey[]> {
      return db.selectFrom('adminium_api_keys').selectAll().orderBy('createdAt', 'desc').execute();
    },

    async revoke(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_api_keys')
        .set({ revokedAt: at })
        .where('id', '=', id)
        .where('revokedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Throttled by the caller (server) like session touches. */
    async touchLastUsed(id: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_api_keys').set({ lastUsedAt: at }).where('id', '=', id).execute();
    },
  };
}

export type ApiKeysRepo = ReturnType<typeof apiKeysRepo>;
