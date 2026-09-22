// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The endpoint half of the public surface's meta rows (wave 0038):
 *
 * - `publicEndpointsRepo`: the endpoints an operator saved or a key was
 *   granted;
 * - `publicRequestStatsRepo`: hourly request counts per key and ref;
 * - `publicApiStateRepo`: the one revision every change to keys, scopes or
 *   endpoints advances.
 *
 * Kept apart from `public-api.ts`, which owns keys, scopes and sessions: these
 * are the objects the endpoint builder and the keys page's counters stand on,
 * and none of them is ever read on a request's auth path.
 */

import type { Kysely, Selectable, Transaction } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  AdminiumPublicEndpointsTable,
  AdminiumPublicRequestStatsTable,
  MetaDB,
} from '../schema/tables.js';
import { affected, isDuplicateKeyError } from './util.js';

/** Either the store itself or an open transaction on it. */
type Executor = Kysely<MetaDB> | Transaction<MetaDB>;

export type PublicEndpoint = Selectable<AdminiumPublicEndpointsTable>;
export type PublicRequestStat = Selectable<AdminiumPublicRequestStatsTable>;

export interface CreatePublicEndpointInput {
  connectionId: string;
  ref: string;
  /** `generated` | `custom`. */
  origin: string;
  /** The definition exactly as it will be shown back — stored as text. */
  definition: string;
  createdBy?: string | null;
}

export function publicEndpointsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async create(input: CreatePublicEndpointInput, at: number = Date.now(), on: Executor = db): Promise<PublicEndpoint> {
      const row: PublicEndpoint = {
        id: newId('pep'),
        connectionId: input.connectionId,
        ref: input.ref,
        origin: input.origin,
        definition: input.definition,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await on.insertInto('adminium_public_endpoints').values(row).execute();
      return row;
    },

    /**
     * Store a generated endpoint the moment a key is granted it, or answer the
     * row somebody else stored first. Two key creates granting the same
     * virtual endpoint race on `(connection_id, ref)`, and the loser must get
     * the winner's row, not a 500.
     *
     * NOT for use inside a transaction: on Postgres a failed INSERT aborts the
     * transaction it ran in, so the re-read that follows could not run.
     * Materialize first, then open the transaction that uses the row.
     */
    async createOrGet(input: CreatePublicEndpointInput, at: number = Date.now()): Promise<PublicEndpoint> {
      try {
        return await this.create(input, at);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const existing = await this.findByRef(input.connectionId, input.ref);
        if (existing === null) throw error;
        return existing;
      }
    },

    async findById(id: string, on: Executor = db): Promise<PublicEndpoint | null> {
      const row = await on.selectFrom('adminium_public_endpoints').selectAll().where('id', '=', id).executeTakeFirst();
      return row ?? null;
    },

    async findByRef(connectionId: string, ref: string, on: Executor = db): Promise<PublicEndpoint | null> {
      const row = await on
        .selectFrom('adminium_public_endpoints')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('ref', '=', ref)
        .executeTakeFirst();
      return row ?? null;
    },

    async listByConnection(connectionId: string, on: Executor = db): Promise<PublicEndpoint[]> {
      return on
        .selectFrom('adminium_public_endpoints')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('ref')
        .execute();
    },

    async update(
      id: string,
      patch: { ref?: string; definition?: string },
      at: number = Date.now(),
      on: Executor = db,
    ): Promise<boolean> {
      const res = await on
        .updateTable('adminium_public_endpoints')
        .set({ ...patch, updatedAt: at })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async remove(id: string, on: Executor = db): Promise<boolean> {
      const res = await on.deleteFrom('adminium_public_endpoints').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },
  };
}

/** One hour's counts for one key and ref, as the flush hands them over. */
export interface PublicRequestCount {
  keyId: string;
  ref: string;
  /** Start of the hour, epoch ms. */
  bucket: number;
  requests: number;
  errors: number;
}

export function publicRequestStatsRepo(meta: MetaDb) {
  const { db } = meta;

  /** Add to an existing bucket; answers whether one was there. */
  const addTo = async (count: PublicRequestCount): Promise<boolean> => {
    const res = await db
      .updateTable('adminium_public_request_stats')
      .set((eb) => ({
        requests: eb('requests', '+', count.requests),
        errors: eb('errors', '+', count.errors),
      }))
      .where('keyId', '=', count.keyId)
      .where('ref', '=', count.ref)
      .where('bucket', '=', count.bucket)
      .executeTakeFirst();
    return affected(res.numUpdatedRows) === 1;
  };

  return {
    /**
     * ADD these counts to the bucket, never replace it: every server process
     * flushes its own counts into the same hour, and the total is their sum.
     *
     * UPDATE, then INSERT when no bucket existed — the meta store's portable
     * upsert. Two processes can both find the hour empty and both INSERT; the
     * loser's duplicate is answered by adding to the winner's row. Not for use
     * inside a transaction, for the Postgres reason in `createOrGet`.
     */
    async add(count: PublicRequestCount): Promise<void> {
      if (await addTo(count)) return;
      try {
        await db.insertInto('adminium_public_request_stats').values(count).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await addTo(count);
      }
    },

    /** Summed counts from `since` on, for some keys or for all of them. */
    async totals(opts: { since: number; keyIds?: readonly string[] }): Promise<{ requests: number; errors: number }> {
      if (opts.keyIds !== undefined && opts.keyIds.length === 0) return { requests: 0, errors: 0 };
      let query = db
        .selectFrom('adminium_public_request_stats')
        .select((eb) => [eb.fn.sum<number | string | null>('requests').as('requests'), eb.fn.sum<number | string | null>('errors').as('errors')])
        .where('bucket', '>=', opts.since);
      if (opts.keyIds !== undefined) query = query.where('keyId', 'in', opts.keyIds);
      const row = await query.executeTakeFirst();
      // SUM is a string on Postgres (numeric) and MySQL (decimal), and null
      // over no rows.
      return { requests: Number(row?.requests ?? 0), errors: Number(row?.errors ?? 0) };
    },

    /** The retention sweep: buckets that started before `at`. */
    async purgeBefore(at: number): Promise<number> {
      const res = await db.deleteFrom('adminium_public_request_stats').where('bucket', '<', at).executeTakeFirst();
      return affected(res.numDeletedRows);
    },
  };
}

/** The one row's key. */
const STATE_ID = 'public';

export function publicApiStateRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** The current revision; 0 before anything has advanced it. */
    async read(on: Executor = db): Promise<number> {
      const row = await on
        .selectFrom('adminium_public_api_state')
        .select('revision')
        .where('id', '=', STATE_ID)
        .executeTakeFirst();
      return row === undefined ? 0 : Number(row.revision);
    },

    /**
     * Create the row if it is missing. Call it at boot, OUTSIDE any
     * transaction: the INSERT can lose a race to another process, and on
     * Postgres a failed statement aborts the transaction around it.
     */
    async ensure(at: number = Date.now()): Promise<void> {
      const existing = await db
        .selectFrom('adminium_public_api_state')
        .select('id')
        .where('id', '=', STATE_ID)
        .executeTakeFirst();
      if (existing !== undefined) return;
      try {
        await db.insertInto('adminium_public_api_state').values({ id: STATE_ID, revision: 0, updatedAt: at }).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    },

    /**
     * Advance the revision unconditionally. Safe inside a transaction once the
     * row exists (`ensure`); before that, it creates the row.
     */
    async bump(at: number = Date.now(), on: Executor = db): Promise<void> {
      const res = await on
        .updateTable('adminium_public_api_state')
        .set((eb) => ({ revision: eb('revision', '+', 1), updatedAt: at }))
        .where('id', '=', STATE_ID)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) {
        await on.insertInto('adminium_public_api_state').values({ id: STATE_ID, revision: 1, updatedAt: at }).execute();
      }
    },

    /**
     * Compare-and-set: advance only if the revision is still `expected`.
     * False means another change landed since `expected` was read, and the
     * caller must derive again from what is stored now.
     *
     * `read` answers 0 before the row exists, so advancing from 0 creates it.
     * Two first-ever advances racing would both insert; `ensure` at boot is
     * what keeps that from happening.
     */
    async advanceFrom(expected: number, at: number = Date.now(), on: Executor = db): Promise<boolean> {
      const res = await on
        .updateTable('adminium_public_api_state')
        .set({ revision: expected + 1, updatedAt: at })
        .where('id', '=', STATE_ID)
        .where('revision', '=', expected)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 1) return true;
      if (expected !== 0) return false;
      const existing = await on
        .selectFrom('adminium_public_api_state')
        .select('id')
        .where('id', '=', STATE_ID)
        .executeTakeFirst();
      if (existing !== undefined) return false;
      await on.insertInto('adminium_public_api_state').values({ id: STATE_ID, revision: 1, updatedAt: at }).execute();
      return true;
    },
  };
}

export type PublicEndpointsRepo = ReturnType<typeof publicEndpointsRepo>;
export type PublicRequestStatsRepo = ReturnType<typeof publicRequestStatsRepo>;
export type PublicApiStateRepo = ReturnType<typeof publicApiStateRepo>;
