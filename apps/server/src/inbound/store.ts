// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where inbound events are kept: `adminium_inbound_events`, one row per
 * `(channel, account, provider_id)`.
 *
 * A store that cannot be written throws, so the door answers 503 and the
 * provider keeps the event.
 *
 * Each step that moves a row names the state it expects, and a job's finish
 * names the claim it holds. So a worker that lost its claim cannot overwrite
 * the worker that took over, or bring an erased row back.
 */
import { newId, type AddressHash, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { InboundEventRecord, InboundReason, InboundState } from './types.js';

interface InboundEventsTable {
  id: string;
  channel: string;
  account: string;
  providerId: string;
  source: string;
  kind: string;
  state: string;
  subjectHash: string | null;
  keyVersion: number | null;
  sealedBody: string | null;
  attempts: number;
  reason: string | null;
  occurredAt: number | null;
  receivedAt: number;
  claimedAt: number | null;
  finishedAt: number | null;
  retainUntil: number | null;
}

interface InboundTables {
  adminium_inbound_events: InboundEventsTable;
}

export type InboundPut = Pick<InboundEventRecord, 'channel' | 'account' | 'providerId' | 'source' | 'kind' | 'subject' | 'sealedBody' | 'occurredAt' | 'receivedAt'>;

export interface InboundFinish {
  state: Extract<InboundState, 'processed' | 'ignored' | 'failed'>;
  reason: InboundReason | null;
  at: number;
  retainUntil: number | null;
}

export interface InboundEventStore {
  /** Stores it once. A second put of the same key finds the first. */
  put(input: InboundPut): Promise<{ event: InboundEventRecord; fresh: boolean }>;
  byId(id: string): Promise<InboundEventRecord | null>;
  /** The event held under any of these digests of one provider id (one per key version). */
  byProviderIds(channel: string, account: string, digests: readonly string[]): Promise<InboundEventRecord | null>;
  /** Whether an event of these kinds from this person is stored and not yet finished. */
  anyWaiting(hashes: readonly AddressHash[], kinds: readonly string[]): Promise<boolean>;
  /** Takes a pending event, or one whose worker went quiet before `staleBefore`. Null when it is not there to take. */
  claim(id: string, at: number, staleBefore: number): Promise<InboundEventRecord | null>;
  /** Ends a claim. False when the claim was lost. A failed event keeps its body; every other state drops it. */
  finish(id: string, claimedAt: number, outcome: InboundFinish): Promise<boolean>;
  /** Gives a claim back, for the next try. */
  release(id: string, claimedAt: number, reason: InboundReason): Promise<boolean>;
  /** Events a job should hold and does not: pending or working since before `before`. */
  stuck(before: number, limit: number): Promise<string[]>;
  failedPage(opts: { channel?: string | undefined; limit: number; after?: { receivedAt: number; id: string } | undefined }): Promise<InboundEventRecord[]>;
  /** A failed event back to pending. False when it is not failed or its body has gone. */
  retry(id: string): Promise<boolean>;
  /** Staff closed a failed event: its body goes. */
  dismiss(id: string, at: number, retainUntil: number): Promise<boolean>;
  /** Wipes the body of failed events received before `before`. Returns how many. */
  wipeFailedBodies(before: number, limit: number): Promise<number>;
  /** Deletes finished rows past their `retain_until`. Returns how many. */
  deleteExpired(at: number, limit: number): Promise<number>;
  /** Their events keep only the mark that stops a re-delivery. Returns how many. */
  eraseSubject(hashes: readonly AddressHash[], at: number, retainUntil: number): Promise<number>;
  /** How many events still hold something of theirs: what an erasure would empty. */
  countSubject(hashes: readonly AddressHash[]): Promise<number>;
}

const orNull = (value: number | string | null): number | null => (value === null ? null : Number(value));

function decode(row: InboundEventsTable): InboundEventRecord {
  const version = orNull(row.keyVersion);
  return {
    id: row.id,
    channel: row.channel,
    account: row.account,
    providerId: row.providerId,
    source: row.source,
    kind: row.kind,
    state: row.state as InboundState,
    subject: row.subjectHash !== null && version !== null ? { hash: row.subjectHash, version } : null,
    sealedBody: row.sealedBody,
    attempts: Number(row.attempts),
    reason: row.reason,
    occurredAt: orNull(row.occurredAt),
    receivedAt: Number(row.receivedAt),
    claimedAt: orNull(row.claimedAt),
    finishedAt: orNull(row.finishedAt),
    retainUntil: orNull(row.retainUntil),
  };
}

export function createInboundEventStore(meta: MetaDb): InboundEventStore {
  const db = meta.db as unknown as Kysely<InboundTables>;
  const dialect = meta.dialect;
  const TABLE = 'adminium_inbound_events' as const;

  async function byId(id: string): Promise<InboundEventRecord | null> {
    const row = await db.selectFrom(TABLE).selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decode(row as InboundEventsTable);
  }

  const moved = (result: { numUpdatedRows: bigint }): boolean => result.numUpdatedRows > 0n;

  return {
    byId,

    async byProviderIds(channel, account, digests) {
      if (digests.length === 0) return null;
      const row = await db.selectFrom(TABLE).selectAll().where('channel', '=', channel).where('account', '=', account).where('providerId', 'in', [...digests]).executeTakeFirst();
      return row === undefined ? null : decode(row as InboundEventsTable);
    },

    async anyWaiting(hashes, kinds) {
      if (hashes.length === 0 || kinds.length === 0) return false;
      const row = await db
        .selectFrom(TABLE)
        .select('id')
        .where('state', 'in', ['pending', 'working'])
        .where('kind', 'in', [...kinds])
        .where((eb) => eb.or(hashes.map((one) => eb.and([eb('subjectHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async put(input) {
      const row: InboundEventsTable = {
        id: newId('ibe'),
        channel: input.channel,
        account: input.account,
        providerId: input.providerId,
        source: input.source,
        kind: input.kind,
        state: 'pending',
        subjectHash: input.subject?.hash ?? null,
        keyVersion: input.subject?.version ?? null,
        sealedBody: input.sealedBody,
        attempts: 0,
        reason: null,
        occurredAt: input.occurredAt,
        receivedAt: input.receivedAt,
        claimedAt: null,
        finishedAt: null,
        retainUntil: null,
      };
      // Never a caught duplicate, and never MySQL's INSERT IGNORE, which would also swallow a value that does not fit.
      const insert = db.insertInto(TABLE).values(row);
      if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
      else await insert.onConflict((conflict) => conflict.columns(['channel', 'account', 'providerId']).doNothing()).execute();
      const stored = await db
        .selectFrom(TABLE)
        .selectAll()
        .where('channel', '=', input.channel)
        .where('account', '=', input.account)
        .where('providerId', '=', input.providerId)
        .executeTakeFirst();
      if (stored === undefined) throw new Error('The inbound event was not there after it was written.');
      return { event: decode(stored as InboundEventsTable), fresh: stored.id === row.id };
    },

    async claim(id, at, staleBefore) {
      const result = await db
        .updateTable(TABLE)
        .set((eb) => ({ state: 'working', claimedAt: at, attempts: eb('attempts', '+', 1) }))
        .where('id', '=', id)
        .where((eb) => eb.or([eb('state', '=', 'pending'), eb.and([eb('state', '=', 'working'), eb('claimedAt', '<', staleBefore)])]))
        .executeTakeFirst();
      return moved(result) ? byId(id) : null;
    },

    async finish(id, claimedAt, outcome) {
      const result = await db
        .updateTable(TABLE)
        .set({
          state: outcome.state,
          reason: outcome.reason,
          finishedAt: outcome.at,
          retainUntil: outcome.retainUntil,
          claimedAt: null,
          ...(outcome.state === 'failed' ? {} : { sealedBody: null }),
        })
        .where('id', '=', id)
        .where('state', '=', 'working')
        .where('claimedAt', '=', claimedAt)
        .executeTakeFirst();
      return moved(result);
    },

    async release(id, claimedAt, reason) {
      const result = await db
        .updateTable(TABLE)
        .set({ state: 'pending', reason, claimedAt: null })
        .where('id', '=', id)
        .where('state', '=', 'working')
        .where('claimedAt', '=', claimedAt)
        .executeTakeFirst();
      return moved(result);
    },

    async stuck(before, limit) {
      const rows = await db
        .selectFrom(TABLE)
        .select('id')
        .where((eb) =>
          eb.or([eb.and([eb('state', '=', 'pending'), eb('receivedAt', '<', before)]), eb.and([eb('state', '=', 'working'), eb('claimedAt', '<', before)])]),
        )
        .orderBy('receivedAt', 'asc')
        .orderBy('id', 'asc')
        .limit(limit)
        .execute();
      return rows.map((row) => row.id);
    },

    async failedPage(opts) {
      let query = db.selectFrom(TABLE).selectAll().where('state', '=', 'failed');
      if (opts.channel !== undefined) query = query.where('channel', '=', opts.channel);
      const after = opts.after;
      if (after !== undefined) {
        query = query.where((eb) => eb.or([eb('receivedAt', '<', after.receivedAt), eb.and([eb('receivedAt', '=', after.receivedAt), eb('id', '<', after.id)])]));
      }
      const rows = await query.orderBy('receivedAt', 'desc').orderBy('id', 'desc').limit(opts.limit).execute();
      return rows.map((row) => decode(row as InboundEventsTable));
    },

    async retry(id) {
      const result = await db
        .updateTable(TABLE)
        .set({ state: 'pending', reason: null, finishedAt: null, retainUntil: null, claimedAt: null, attempts: 0 })
        .where('id', '=', id)
        .where('state', '=', 'failed')
        .where('sealedBody', 'is not', null)
        .executeTakeFirst();
      return moved(result);
    },

    async dismiss(id, at, retainUntil) {
      const result = await db
        .updateTable(TABLE)
        .set({ state: 'ignored', reason: 'dismissed', sealedBody: null, finishedAt: at, retainUntil })
        .where('id', '=', id)
        .where('state', '=', 'failed')
        .executeTakeFirst();
      return moved(result);
    },

    async wipeFailedBodies(before, limit) {
      const rows = await db
        .selectFrom(TABLE)
        .select('id')
        .where('state', '=', 'failed')
        .where('sealedBody', 'is not', null)
        .where('receivedAt', '<', before)
        .orderBy('receivedAt', 'asc')
        .limit(limit)
        .execute();
      if (rows.length === 0) return 0;
      const result = await db
        .updateTable(TABLE)
        .set({ sealedBody: null })
        .where('id', 'in', rows.map((row) => row.id))
        .where('state', '=', 'failed')
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    async deleteExpired(at, limit) {
      const rows = await db
        .selectFrom(TABLE)
        .select('id')
        .where('state', 'in', ['processed', 'ignored', 'failed', 'erased'])
        .where('retainUntil', 'is not', null)
        .where('retainUntil', '<=', at)
        .orderBy('retainUntil', 'asc')
        .limit(limit)
        .execute();
      if (rows.length === 0) return 0;
      const result = await db
        .deleteFrom(TABLE)
        .where('id', 'in', rows.map((row) => row.id))
        .where('state', 'in', ['processed', 'ignored', 'failed', 'erased'])
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async eraseSubject(hashes, at, retainUntil) {
      if (hashes.length === 0) return 0;
      const result = await db
        .updateTable(TABLE)
        .set({ state: 'erased', sealedBody: null, subjectHash: null, keyVersion: null, reason: null, claimedAt: null, finishedAt: at, retainUntil })
        .where((eb) => eb.or(hashes.map((one) => eb.and([eb('subjectHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    async countSubject(hashes) {
      if (hashes.length === 0) return 0;
      const row = await db
        .selectFrom(TABLE)
        .select((eb) => eb.fn.countAll<number | string>().as('count'))
        .where((eb) => eb.or(hashes.map((one) => eb.and([eb('subjectHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },
  };
}
