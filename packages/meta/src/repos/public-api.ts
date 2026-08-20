// SPDX-License-Identifier: AGPL-3.0-only
/**
 * publicScopesRepo / publicKeysRepo — the public surface's meta rows
 * (28-public-surface.md §3.2–§3.3, migration `0014_public_surface`).
 *
 * Deliberately NOT part of `apiKeysRepo`. A publishable key differs from an
 * `adm_sk_` key in two ways that both reach the storage layer: its secret is
 * re-readable, and it must never be resolvable as an `RbacPrincipal` (D3).
 * Sharing a repo would put both kinds one `where` clause apart, which is how a
 * later "unify the key lookup" change would quietly break the property the
 * whole off switch rests on.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  AdminiumPublicKeysTable,
  AdminiumPublicScopesTable,
  AdminiumPublicSessionsTable,
} from '../schema/tables.js';

export type PublicScope = Selectable<AdminiumPublicScopesTable>;
export type PublicKey = Selectable<AdminiumPublicKeysTable>;
export type PublicSession = Selectable<AdminiumPublicSessionsTable>;

export interface CreatePublicScopeInput {
  connectionId: string;
  side: string;
  name: string;
  /** Canonical IANA zone; the compiler refuses anything else. */
  timezone: string;
  /** The scope document, already serialized. */
  document: string;
  proposedFromManifest?: string | null;
  createdBy?: string | null;
}

export function publicScopesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreatePublicScopeInput, at: number = Date.now()): Promise<PublicScope> {
      const row: PublicScope = {
        id: newId('psc'),
        connectionId: input.connectionId,
        side: input.side,
        name: input.name,
        timezone: input.timezone,
        document: input.document,
        proposedFromManifest: input.proposedFromManifest ?? null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_public_scopes').values(row).execute();
      return row;
    },

    async findById(id: string): Promise<PublicScope | null> {
      const row = await db
        .selectFrom('adminium_public_scopes')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    },

    async list(): Promise<PublicScope[]> {
      return db.selectFrom('adminium_public_scopes').selectAll().orderBy('createdAt', 'desc').execute();
    },

    async listByConnection(connectionId: string): Promise<PublicScope[]> {
      return db
        .selectFrom('adminium_public_scopes')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('createdAt', 'desc')
        .execute();
    },

    async update(
      id: string,
      patch: { name?: string; timezone?: string; document?: string },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_public_scopes')
        .set({ ...patch, updatedAt: at })
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Deleting a scope is refused while a key points at it — the FK is
     * `restrict`, so this surfaces the constraint as `false` rather than as a
     * driver error. Revoking the key first is the intended order, because it
     * makes the operator see what they are about to break.
     */
    async remove(id: string): Promise<boolean> {
      const attached = await db
        .selectFrom('adminium_public_keys')
        .select('id')
        .where('scopeId', '=', id)
        .executeTakeFirst();
      if (attached !== undefined) return false;
      const res = await db
        .deleteFrom('adminium_public_scopes')
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numDeletedRows) === 1;
    },
  };
}

export interface CreatePublicKeyInput {
  name: string;
  /** Display/lookup fragment, e.g. `adm_pub_4f2a91cd`. */
  prefix: string;
  tokenHash: string;
  /** AES-GCM envelope of the full token — the re-readable copy. */
  tokenEncrypted: string;
  scopeId: string;
  side: string;
  /** JSON array narrowing the instance origin list; `[]` = no narrowing. */
  origins?: string[];
  createdBy?: string | null;
  expiresAt?: number | null;
}

export function publicKeysRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreatePublicKeyInput, at: number = Date.now()): Promise<PublicKey> {
      const row: PublicKey = {
        id: newId('pbk'),
        name: input.name,
        prefix: input.prefix,
        tokenHash: input.tokenHash,
        tokenEncrypted: input.tokenEncrypted,
        scopeId: input.scopeId,
        side: input.side,
        origins: JSON.stringify(input.origins ?? []),
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        lastUsedAt: null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_public_keys').values(row).execute();
      return row;
    },

    /**
     * The AUTH lookup, by prefix.
     *
     * Returns every candidate rather than filtering on the hash in SQL, because
     * the caller compares hashes in CONSTANT TIME. A `where tokenHash = ?`
     * makes the database do a byte comparison whose timing an attacker can
     * measure; the prefix is a public display fragment and leaks nothing.
     *
     * Revocation and expiry are NOT filtered here either — the caller decides,
     * so it can answer every failure identically on the wire (§3.2) instead of
     * letting "no row" and "revoked row" take different code paths.
     */
    async findByPrefix(prefix: string): Promise<PublicKey[]> {
      return db
        .selectFrom('adminium_public_keys')
        .selectAll()
        .where('prefix', '=', prefix)
        .execute();
    },

    async findById(id: string): Promise<PublicKey | null> {
      const row = await db
        .selectFrom('adminium_public_keys')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    },

    async listByScope(scopeId: string): Promise<PublicKey[]> {
      return db
        .selectFrom('adminium_public_keys')
        .selectAll()
        .where('scopeId', '=', scopeId)
        .orderBy('createdAt', 'desc')
        .execute();
    },

    async list(): Promise<PublicKey[]> {
      return db.selectFrom('adminium_public_keys').selectAll().orderBy('createdAt', 'desc').execute();
    },

    /** Rotation: a new secret against the same row, keeping scope and origins. */
    async rotate(
      id: string,
      next: { prefix: string; tokenHash: string; tokenEncrypted: string },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_public_keys')
        .set({ ...next, updatedAt: at })
        .where('id', '=', id)
        .where('revokedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    async revoke(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_public_keys')
        .set({ revokedAt: at, updatedAt: at })
        .where('id', '=', id)
        .where('revokedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Throttled by the caller, like session and api-key touches. */
    async touchLastUsed(id: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_public_keys').set({ lastUsedAt: at }).where('id', '=', id).execute();
    },
  };
}

export interface CreatePublicSessionInput {
  keyId: string;
  tokenHash: string;
  /** The RESOLVED claim — see the table comment on why it is not re-derived. */
  grants: string;
  expiresAt: number;
}

export function publicSessionsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreatePublicSessionInput, at: number = Date.now()): Promise<PublicSession> {
      const row: PublicSession = {
        id: newId('pss'),
        keyId: input.keyId,
        tokenHash: input.tokenHash,
        grants: input.grants,
        expiresAt: input.expiresAt,
        createdAt: at,
        lastSeenAt: null,
      };
      await db.insertInto('adminium_public_sessions').values(row).execute();
      return row;
    },

    /**
     * Resolve a session token.
     *
     * Unlike `publicKeysRepo.findByPrefix`, matching on the hash in SQL is fine
     * here: a session token has no public display fragment to look up by, so
     * there is nothing to narrow on first. Expiry IS filtered, because an
     * expired session and an unknown one are the same thing to the caller and
     * there is no reason to carry the difference back up.
     */
    async findValid(tokenHash: string, at: number = Date.now()): Promise<PublicSession | null> {
      const row = await db
        .selectFrom('adminium_public_sessions')
        .selectAll()
        .where('tokenHash', '=', tokenHash)
        .where('expiresAt', '>', at)
        .executeTakeFirst();
      return row ?? null;
    },

    async touch(id: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_public_sessions').set({ lastSeenAt: at }).where('id', '=', id).execute();
    },

    async remove(tokenHash: string): Promise<boolean> {
      const res = await db
        .deleteFrom('adminium_public_sessions')
        .where('tokenHash', '=', tokenHash)
        .executeTakeFirst();
      return Number(res.numDeletedRows) > 0;
    },

    /** Housekeeping: drop everything that has lapsed. */
    async purgeExpired(at: number = Date.now()): Promise<number> {
      const res = await db
        .deleteFrom('adminium_public_sessions')
        .where('expiresAt', '<=', at)
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type PublicSessionsRepo = ReturnType<typeof publicSessionsRepo>;
export type PublicScopesRepo = ReturnType<typeof publicScopesRepo>;
export type PublicKeysRepo = ReturnType<typeof publicKeysRepo>;
