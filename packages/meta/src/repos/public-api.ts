// SPDX-License-Identifier: AGPL-3.0-only
/**
 * publicScopesRepo / publicKeysRepo — the public surface's meta rows
 * (migration `0014_public_surface`).
 *
 * Deliberately NOT part of `apiKeysRepo`. A publishable key differs from an
 * `adm_sk_` key in two ways that both reach the storage layer: its secret is
 * re-readable, and it must never be resolvable as an `RbacPrincipal`.
 * Sharing a repo would put both kinds one `where` clause apart, which is how a
 * later "unify the key lookup" change would quietly break the property the
 * whole off switch rests on.
 */

import type { Kysely, Selectable, Transaction } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  AdminiumPublicKeysTable,
  AdminiumPublicScopesTable,
  AdminiumPublicSessionsTable,
  MetaDB,
} from '../schema/tables.js';

/** Either the store itself or an open transaction on it. */
type Executor = Kysely<MetaDB> | Transaction<MetaDB>;

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
  /** The key whose grants this document was compiled from; absent for a hand-written scope. */
  derivedForKey?: string | null;
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

/**
 * One key row, with its JSON columns normalised to text.
 *
 * The same driver difference as the scope document. `origins` reached
 * `resolve.ts` as a parsed array on Postgres and MySQL, so its `JSON.parse`
 * threw and the key was treated as having no narrowing. A key limited to one
 * origin answered every origin on the instance's list.
 */
function keyRow(row: PublicKey): PublicKey {
  return { ...row, origins: jsonText(row.origins), access: row.access === null ? null : jsonText(row.access) };
}

/**
 * One session row, with `grants` normalised to text. On Postgres and MySQL it
 * reached `parseGrant` parsed, failed, and the claimed session was ignored, so
 * every claim-gated resource answered 404 there.
 */
function sessionRow(row: PublicSession): PublicSession {
  return { ...row, grants: jsonText(row.grants) };
}

/** What owns a set of publishable keys: one scope, or every scope of a connection. */
export type PublicKeyOwner = { connectionId: string } | { scopeId: string };

/** A publishable key that would stop working if what it hangs off went. */
export interface LivePublicKeyRef {
  id: string;
  name: string;
  prefix: string;
  scopeId: string;
}

/**
 * A scope or connection delete refused: publishable keys under it are still
 * live. Revoking them is the operator's call, not a side effect of deleting
 * something else (0014).
 */
export class LivePublicKeysError extends Error {
  override name = 'LivePublicKeysError';
  constructor(readonly keys: readonly LivePublicKeyRef[]) {
    super(`${keys.length} live publishable key(s) still depend on this`);
  }
}

/**
 * The step before deleting a scope, or a connection whose scopes cascade: a
 * key is `restrict` on its scope (0014), so every key row under it has to go
 * first or the delete dies on the constraint.
 *
 * A LIVE key (neither revoked nor expired) is a working public surface
 * somebody shipped, so it refuses the whole delete with
 * {@link LivePublicKeysError} and nothing is removed. A revoked or expired key
 * breaks nothing, and nothing else in the product can remove its row, so it is
 * deleted here. Its sessions and challenges cascade with it. Run it inside the
 * delete's own transaction, so a refusal leaves every row where it was.
 */
export async function clearInertPublicKeys(
  trx: Kysely<MetaDB> | Transaction<MetaDB>,
  owner: PublicKeyOwner,
  at: number,
): Promise<void> {
  const keys = await trx
    .selectFrom('adminium_public_keys')
    .innerJoin('adminium_public_scopes', 'adminium_public_scopes.id', 'adminium_public_keys.scopeId')
    .select([
      'adminium_public_keys.id',
      'adminium_public_keys.name',
      'adminium_public_keys.prefix',
      'adminium_public_keys.scopeId',
      'adminium_public_keys.revokedAt',
      'adminium_public_keys.expiresAt',
    ])
    .where((eb) =>
      'scopeId' in owner
        ? eb('adminium_public_scopes.id', '=', owner.scopeId)
        : eb('adminium_public_scopes.connectionId', '=', owner.connectionId),
    )
    .orderBy('adminium_public_keys.createdAt')
    .orderBy('adminium_public_keys.id')
    .execute();
  const live = keys.filter((k) => k.revokedAt === null && (k.expiresAt === null || k.expiresAt > at));
  if (live.length > 0) {
    throw new LivePublicKeysError(live.map(({ id, name, prefix, scopeId }) => ({ id, name, prefix, scopeId })));
  }
  if (keys.length === 0) return;
  const ids = keys.map((k) => k.id);
  await trx.deleteFrom('adminium_public_keys').where('id', 'in', ids).execute();
  // Request counts carry no foreign key (wave 0038), so they go by hand.
  await trx.deleteFrom('adminium_public_request_stats').where('keyId', 'in', ids).execute();
}

export function publicScopesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreatePublicScopeInput, at: number = Date.now(), on: Executor = db): Promise<PublicScope> {
      const row: PublicScope = {
        id: newId('psc'),
        connectionId: input.connectionId,
        side: input.side,
        name: input.name,
        timezone: input.timezone,
        document: input.document,
        proposedFromManifest: input.proposedFromManifest ?? null,
        derivedForKey: input.derivedForKey ?? null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await on.insertInto('adminium_public_scopes').values(row).execute();
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
      on: Executor = db,
    ): Promise<boolean> {
      const res = await on
        .updateTable('adminium_public_scopes')
        .set({ ...patch, updatedAt: at })
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Deleting a scope is refused while a LIVE key points at it, with
     * {@link LivePublicKeysError}: revoking the key first is the intended
     * order, because it makes the operator see what they are about to break.
     * Revoked and expired keys go with the scope — otherwise a scope that
     * ever had a key could never be deleted, since nothing removes a key row.
     */
    async remove(id: string, at: number = Date.now()): Promise<boolean> {
      return db.transaction().execute(async (trx) => {
        await clearInertPublicKeys(trx, { scopeId: id }, at);
        const res = await trx.deleteFrom('adminium_public_scopes').where('id', '=', id).executeTakeFirst();
        return Number(res.numDeletedRows) === 1;
      });
    },
  };
}

export interface CreatePublicKeyInput {
  /**
   * A `pbk_` id minted by the caller. A derived scope names its key, and the key
   * names its scope, so the key's id has to exist before either row is written.
   * Absent, the repo mints one.
   */
  id?: string;
  name: string;
  /** Display/lookup fragment, e.g. `adm_pub_4f2a91cd`. */
  prefix: string;
  tokenHash: string;
  /** AES-GCM envelope of the full token — the re-readable copy. */
  tokenEncrypted: string;
  scopeId: string;
  side: string;
  /** Hosted app surface this key is bound to, or absent/null. */
  appKey?: string | null;
  /** JSON array narrowing the instance origin list; `[]` = no narrowing. */
  origins?: string[];
  /** `{ endpointId: Method[] }`; absent for a key bound to a hand-written scope. */
  access?: Record<string, readonly string[]> | null;
  /** `browser` (default) | `server`. */
  kind?: string;
  createdBy?: string | null;
  expiresAt?: number | null;
}

export function publicKeysRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreatePublicKeyInput, at: number = Date.now(), on: Executor = db): Promise<PublicKey> {
      const row: PublicKey = {
        id: input.id ?? newId('pbk'),
        name: input.name,
        prefix: input.prefix,
        tokenHash: input.tokenHash,
        tokenEncrypted: input.tokenEncrypted,
        scopeId: input.scopeId,
        side: input.side,
        appKey: input.appKey ?? null,
        origins: JSON.stringify(input.origins ?? []),
        access: input.access === undefined || input.access === null ? null : JSON.stringify(input.access),
        kind: input.kind ?? 'browser',
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        lastUsedAt: null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await on.insertInto('adminium_public_keys').values(row).execute();
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
     * so it can answer every failure identically on the wire instead of
     * letting "no row" and "revoked row" take different code paths.
     */
    async findByPrefix(prefix: string): Promise<PublicKey[]> {
      const rows = await db
        .selectFrom('adminium_public_keys')
        .selectAll()
        .where('prefix', '=', prefix)
        .execute();
      return rows.map(keyRow);
    },

    async findById(id: string): Promise<PublicKey | null> {
      const row = await db
        .selectFrom('adminium_public_keys')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row === undefined ? null : keyRow(row);
    },

    async listByScope(scopeId: string): Promise<PublicKey[]> {
      const rows = await db
        .selectFrom('adminium_public_keys')
        .selectAll()
        .where('scopeId', '=', scopeId)
        .orderBy('createdAt', 'desc')
        .execute();
      return rows.map(keyRow);
    },

    /**
     * Keys under one scope, or under every scope of one connection, that no
     * longer work — revoked, or past `expiresAt`. They are what a scope or
     * connection delete clears on its way out (see `clearInertPublicKeys`).
     */
    async listInert(owner: PublicKeyOwner, at: number = Date.now()): Promise<PublicKey[]> {
      const rows = await db
        .selectFrom('adminium_public_keys')
        .innerJoin('adminium_public_scopes', 'adminium_public_scopes.id', 'adminium_public_keys.scopeId')
        .selectAll('adminium_public_keys')
        .where((eb) =>
          'scopeId' in owner
            ? eb('adminium_public_scopes.id', '=', owner.scopeId)
            : eb('adminium_public_scopes.connectionId', '=', owner.connectionId),
        )
        .where((eb) =>
          eb.or([
            eb('adminium_public_keys.revokedAt', 'is not', null),
            eb('adminium_public_keys.expiresAt', '<=', at),
          ]),
        )
        .orderBy('adminium_public_keys.createdAt')
        .execute();
      return rows.map(keyRow);
    },

    /**
     * The `surface-config.json` lookup: the newest key for this app's side that
     * is neither revoked nor expired. Rotation keeps the row (and so the
     * binding); revoking the newest key falls back to the next live one, so an
     * operator can stage a replacement before killing the old key.
     */
    /**
     * The newest live key for an app whose SCOPE points at one connection.
     *
     * What `newestLiveByApp` answers once per app, this answers once per
     * database — the customer half of app instances. A customer surface has
     * never named its connection directly and does not start now: its key names
     * a scope and the scope names the connection, so selecting the right key IS
     * selecting the right database, and nothing new has to be kept in sync with
     * anything.
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
        // A hosted surface is a browser: a server key is never served to one.
        .where('adminium_public_keys.kind', '=', 'browser')
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
      return row === undefined ? null : keyRow(row);
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
        .where('kind', '=', 'browser')
        .where('revokedAt', 'is', null)
        .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', at)]))
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      return row === undefined ? null : keyRow(row);
    },

    async list(): Promise<PublicKey[]> {
      const rows = await db.selectFrom('adminium_public_keys').selectAll().orderBy('createdAt', 'desc').execute();
      return rows.map(keyRow);
    },

    /**
     * Every LIVE key of one connection whose scope was derived from endpoint
     * grants, with that scope's id and document — the set an
     * endpoint save regenerates. A revoked or expired key keeps its document
     * frozen and is not returned.
     *
     * Which endpoints a key grants is decided by the caller parsing `access`,
     * never by a JSON operator in SQL: the three stores disagree about JSON.
     */
    async listLiveDerived(
      connectionId: string,
      at: number = Date.now(),
    ): Promise<(PublicKey & { scopeDocument: string })[]> {
      const rows = await db
        .selectFrom('adminium_public_keys')
        .innerJoin('adminium_public_scopes', 'adminium_public_scopes.id', 'adminium_public_keys.scopeId')
        .selectAll('adminium_public_keys')
        .select('adminium_public_scopes.document as scopeDocument')
        .where('adminium_public_scopes.connectionId', '=', connectionId)
        .where('adminium_public_scopes.derivedForKey', 'is not', null)
        .where('adminium_public_keys.revokedAt', 'is', null)
        .where((eb) =>
          eb.or([eb('adminium_public_keys.expiresAt', 'is', null), eb('adminium_public_keys.expiresAt', '>', at)]),
        )
        .orderBy('adminium_public_keys.createdAt')
        .orderBy('adminium_public_keys.id')
        .execute();
      return rows.map((row) => ({ ...keyRow(row), scopeDocument: jsonText(row.scopeDocument) }));
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

    /**
     * Throttled by the caller (`public-api/runtime.ts`). Monotonic here: each
     * replica throttles on its own clock, so a write carrying an older time
     * than the stored one is dropped rather than moving the column backwards.
     */
    async touchLastUsed(id: string, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_public_keys')
        .set({ lastUsedAt: at })
        .where('id', '=', id)
        .where((eb) => eb.or([eb('lastUsedAt', 'is', null), eb('lastUsedAt', '<', at)]))
        .execute();
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
      return row === undefined ? null : sessionRow(row);
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
