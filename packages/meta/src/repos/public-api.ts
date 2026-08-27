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

/**
 * A `json` column does not come back the same shape on every store.
 *
 * postgres and mysql hand back a PARSED value; sqlite hands back the text it
 * stored. `PublicScope.document` is declared `string` and every caller treats
 * it as one — `resolve.ts` calls `JSON.parse` on it, and the admin route
 * returns it under a `z.string()` response schema — so on the two production
 * stores that parse threw and that response failed validation, while the whole
 * suite stayed green on sqlite. Found by CI, which runs all three; the local
 * run skipped 334 store-gated tests.
 *
 * Normalising here rather than at each caller is the point of a repo layer:
 * the driver difference is this file's business and nobody else's.
 */
function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** One scope row, with its document normalised to text whatever the store did. */
function scopeRow(row: PublicScope): PublicScope {
  return { ...row, document: jsonText(row.document) };
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
      return row === undefined ? null : scopeRow(row);
    },

    async list(): Promise<PublicScope[]> {
      const rows = await db
        .selectFrom('adminium_public_scopes')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .execute();
      return rows.map(scopeRow);
    },

    async listByConnection(connectionId: string): Promise<PublicScope[]> {
      const rows = await db
        .selectFrom('adminium_public_scopes')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('createdAt', 'desc')
        .execute();
      return rows.map(scopeRow);
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
  /** Hosted app surface this key is bound to (29 D10), or absent/null. */
  appKey?: string | null;
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
        appKey: input.appKey ?? null,
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

    /**
     * The `surface-config.json` lookup (29 D10): the newest key for this app's
     * side that is neither revoked nor expired. Rotation keeps the row (and so
     * the binding); revoking the newest key falls back to the next live one, so
     * an operator can stage a replacement before killing the old key.
     */
    /**
     * The newest live key for an app whose SCOPE points at one connection.
     *
     * What `newestLiveByApp` answers once per app, this answers once per
     * database — the customer half of app instances (29 D9). A customer surface
     * has never named its connection directly and does not start now: its key
     * names a scope and the scope names the connection, so selecting the right
     * key IS selecting the right database, and nothing new has to be kept in
     * sync with anything.
     *
     * A join, not two queries: the pair "newest, and belonging to this
     * connection" has to be decided together, or a scope moved between
     * connections could hand back a key that was newest but no longer relevant.
     */
    async newestLiveByAppAndConnection(
      appKey: string,
      side: string,
      connectionId: string,
      at: number = Date.now(),
    ): Promise<PublicKey | null> {
      const row = await db
        .selectFrom('adminium_public_keys')
        .innerJoin(
          'adminium_public_scopes',
          'adminium_public_scopes.id',
          'adminium_public_keys.scopeId',
        )
        .selectAll('adminium_public_keys')
        .where('adminium_public_keys.appKey', '=', appKey)
        .where('adminium_public_keys.side', '=', side)
        .where('adminium_public_scopes.connectionId', '=', connectionId)
        .where('adminium_public_keys.revokedAt', 'is', null)
        .where((eb) =>
          eb.or([
            eb('adminium_public_keys.expiresAt', 'is', null),
            eb('adminium_public_keys.expiresAt', '>', at),
          ]),
        )
        .orderBy('adminium_public_keys.createdAt', 'desc')
        .executeTakeFirst();
      return row ?? null;
    },

    async newestLiveByApp(
      appKey: string,
      side: string,
      at: number = Date.now(),
    ): Promise<PublicKey | null> {
      const row = await db
        .selectFrom('adminium_public_keys')
        .selectAll()
        .where('appKey', '=', appKey)
        .where('side', '=', side)
        .where('revokedAt', 'is', null)
        .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', at)]))
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      return row ?? null;
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
