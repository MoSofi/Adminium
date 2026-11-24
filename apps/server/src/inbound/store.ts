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

import { INBOUND_CRASHED_REASON, type InboundEventHead, type InboundEventRecord, type InboundReason, type InboundState } from './types.js';

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
  lostClaims: number;
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
  put(input: InboundPut): Promise<{ event: InboundEventHead; fresh: boolean }>;
  byId(id: string): Promise<InboundEventRecord | null>;
  /** Where it stands, without reading its body. */
  stateOf(id: string): Promise<InboundState | null>;
  /** The event held under any of these digests of one provider id (one per key version). */
  byProviderIds(channel: string, account: string, digests: readonly string[]): Promise<InboundEventHead | null>;
  /** Whether an event of these kinds from this person is waiting or running. A failed one is {@link InboundEventStore.failedFrom}'s. */
  anyWaiting(hashes: readonly AddressHash[], kinds: readonly string[]): Promise<boolean>;
  /** This person's failed events of these kinds that still hold their body, oldest first, at most `limit`. */
  failedFrom(hashes: readonly AddressHash[], kinds: readonly string[], limit: number): Promise<{ id: string; channel: string; kind: string; sealedBody: string }[]>;
  /** The sealed bodies of these failed events, by id. */
  failedBodies(ids: readonly string[]): Promise<Map<string, string>>;
  /** Takes a pending event, or one whose worker went quiet before `staleBefore`, which counts as a crash. Null when it is not there to take. */
  claim(id: string, at: number, staleBefore: number): Promise<InboundEventRecord | null>;
  /** Ends a claim. False when the claim was lost. A failed event keeps its body; every other state drops it. */
  finish(id: string, claimedAt: number, outcome: InboundFinish): Promise<boolean>;
  /** Gives a claim back, for the next try. */
  release(id: string, claimedAt: number, reason: InboundReason): Promise<boolean>;
  /** Gives a claim back without using a try: what it needed was away. */
  defer(id: string, claimedAt: number, reason: InboundReason): Promise<boolean>;
  /** Events a job should hold and does not: pending or working since before `before`. */
  stuck(before: number, limit: number): Promise<string[]>;
  failedPage(opts: { channel?: string | undefined; limit: number; after?: { receivedAt: number; id: string } | undefined }): Promise<InboundEventHead[]>;
  /** A failed event back to pending, with its counts cleared. False when it is not failed or its body has gone. */
  retry(id: string): Promise<boolean>;
  /** Failed events a bulk retry may take, oldest first: a body to read, and no history of killing the server. */
  retryableIds(opts: { channel?: string | undefined; limit: number }): Promise<string[]>;
  /** Staff closed a failed event: its body goes. */
  dismiss(id: string, at: number, retainUntil: number): Promise<boolean>;
  /** Wipes the body of failed events received before `before`, of one channel or all but some. Returns how many. */
  wipeFailedBodies(before: number, limit: number, scope?: { only?: string | undefined; except?: readonly string[] | undefined }): Promise<number>;
  /** Deletes finished rows past their `retain_until`. Returns how many. */
  deleteExpired(at: number, limit: number): Promise<number>;
  /** Their events keep only the mark that stops a re-delivery. Returns how many. */
  eraseSubject(hashes: readonly AddressHash[], at: number, retainUntil: number): Promise<number>;
  /** How many events still hold something of theirs: what an erasure would empty. */
  countSubject(hashes: readonly AddressHash[]): Promise<number>;
}

const orNull = (value: number | string | null): number | null => (value === null ? null : Number(value));

type InboundHeadRow = Omit<InboundEventsTable, 'sealedBody'>;

/** Everything but the body, named so that no list or repeat check ever carries one. */
const HEAD_COLUMNS = ['id', 'channel', 'account', 'providerId', 'source', 'kind', 'state', 'subjectHash', 'keyVersion', 'attempts', 'lostClaims', 'reason', 'occurredAt', 'receivedAt', 'claimedAt', 'finishedAt', 'retainUntil'] as const;

function fieldsOf(row: InboundHeadRow): Omit<InboundEventRecord, 'sealedBody'> {
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
    attempts: Number(row.attempts),
    lostClaims: Number(row.lostClaims),
    reason: row.reason,
    occurredAt: orNull(row.occurredAt),
    receivedAt: Number(row.receivedAt),
    claimedAt: orNull(row.claimedAt),
    finishedAt: orNull(row.finishedAt),
    retainUntil: orNull(row.retainUntil),
  };
}

const decode = (row: InboundEventsTable): InboundEventRecord => ({ ...fieldsOf(row), sealedBody: row.sealedBody });
const decodeHead = (row: InboundHeadRow & { hasBody: number | string }): InboundEventHead => ({ ...fieldsOf(row), hasBody: Number(row.hasBody) === 1 });

export function createInboundEventStore(meta: MetaDb): InboundEventStore {
  const db = meta.db as unknown as Kysely<InboundTables>;
  const dialect = meta.dialect;
  const TABLE = 'adminium_inbound_events' as const;

  async function byId(id: string): Promise<InboundEventRecord | null> {
    const row = await db.selectFrom(TABLE).selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decode(row as InboundEventsTable);
  }

  const heads = () =>
    db
      .selectFrom(TABLE)
      .select(HEAD_COLUMNS)
      .select((eb) => eb.case().when('sealedBody', 'is not', null).then(eb.lit(1)).else(eb.lit(0)).end().as('hasBody'));

  const moved = (result: { numUpdatedRows: bigint }): boolean => result.numUpdatedRows > 0n;

  return {
    byId,

    async stateOf(id) {
      const row = await db.selectFrom(TABLE).select('state').where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : (row.state as InboundState);
    },

    async byProviderIds(channel, account, digests) {
      if (digests.length === 0) return null;
      const row = await heads().where('channel', '=', channel).where('account', '=', account).where('providerId', 'in', [...digests]).executeTakeFirst();
      return row === undefined ? null : decodeHead(row);
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

    async failedFrom(hashes, kinds, limit) {
      if (hashes.length === 0 || kinds.length === 0) return [];
      const rows = await db
        .selectFrom(TABLE)
        .select(['id', 'channel', 'kind', 'sealedBody'])
        .where('state', '=', 'failed')
        .where('sealedBody', 'is not', null)
        .where('kind', 'in', [...kinds])
        .where((eb) => eb.or(hashes.map((one) => eb.and([eb('subjectHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
        .orderBy('receivedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.flatMap((row) => (row.sealedBody === null ? [] : [{ id: row.id, channel: row.channel, kind: row.kind, sealedBody: row.sealedBody }]));
    },

    async failedBodies(ids) {
      const out = new Map<string, string>();
      if (ids.length === 0) return out;
      const rows = await db.selectFrom(TABLE).select(['id', 'sealedBody']).where('id', 'in', [...ids]).where('state', '=', 'failed').execute();
      for (const row of rows) if (row.sealedBody !== null) out.set(row.id, row.sealedBody);
      return out;
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
        lostClaims: 0,
        reason: null,
        occurredAt: input.occurredAt,
        receivedAt: input.receivedAt,
        claimedAt: null,
        finishedAt: null,
        retainUntil: null,
      };
      // Never a caught duplicate, and never MySQL's INSERT IGNORE, which would also swallow a value that does not fit.
      const insert = db.insertInto('adminium_inbound_events').values(row);
      if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
      else await insert.onConflict((conflict) => conflict.columns(['channel', 'account', 'providerId']).doNothing()).execute();
      const stored = await heads().where('channel', '=', input.channel).where('account', '=', input.account).where('providerId', '=', input.providerId).executeTakeFirst();
      if (stored === undefined) throw new Error('The inbound event was not there after it was written.');
      return { event: decodeHead(stored), fresh: stored.id === row.id };
    },

    async claim(id, at, staleBefore) {
      const waiting = await db
        .updateTable('adminium_inbound_events')
        .set((eb) => ({ state: 'working', claimedAt: at, attempts: eb('attempts', '+', 1) }))
        .where('id', '=', id)
        .where('state', '=', 'pending')
        .executeTakeFirst();
      if (moved(waiting)) return byId(id);
      // Two statements, because MySQL reads a column already set earlier in the same SET.
      const takenOver = await db
        .updateTable('adminium_inbound_events')
        .set((eb) => ({ claimedAt: at, attempts: eb('attempts', '+', 1), lostClaims: eb('lostClaims', '+', 1) }))
        .where('id', '=', id)
        .where('state', '=', 'working')
        .where('claimedAt', '<', staleBefore)
        .executeTakeFirst();
      return moved(takenOver) ? byId(id) : null;
    },

    async finish(id, claimedAt, outcome) {
      const result = await db
        .updateTable('adminium_inbound_events')
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
        .updateTable('adminium_inbound_events')
        .set({ state: 'pending', reason, claimedAt: null })
        .where('id', '=', id)
        .where('state', '=', 'working')
        .where('claimedAt', '=', claimedAt)
        .executeTakeFirst();
      return moved(result);
    },

    async defer(id, claimedAt, reason) {
      const result = await db
        .updateTable('adminium_inbound_events')
        .set((eb) => ({ state: 'pending', reason, claimedAt: null, attempts: eb('attempts', '-', 1) }))
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
      let query = heads().where('state', '=', 'failed');
      if (opts.channel !== undefined) query = query.where('channel', '=', opts.channel);
      const after = opts.after;
      if (after !== undefined) {
        query = query.where((eb) => eb.or([eb('receivedAt', '<', after.receivedAt), eb.and([eb('receivedAt', '=', after.receivedAt), eb('id', '<', after.id)])]));
      }
      const rows = await query.orderBy('receivedAt', 'desc').orderBy('id', 'desc').limit(opts.limit).execute();
      return rows.map(decodeHead);
    },

    async retry(id) {
      const result = await db
        .updateTable('adminium_inbound_events')
        .set({ state: 'pending', reason: null, finishedAt: null, retainUntil: null, claimedAt: null, attempts: 0, lostClaims: 0 })
        .where('id', '=', id)
        .where('state', '=', 'failed')
        .where('sealedBody', 'is not', null)
        .executeTakeFirst();
      return moved(result);
    },

    async retryableIds(opts) {
      let query = db
        .selectFrom(TABLE)
        .select('id')
        .where('state', '=', 'failed')
        .where('sealedBody', 'is not', null)
        .where((eb) => eb.or([eb('reason', 'is', null), eb('reason', '!=', INBOUND_CRASHED_REASON)]));
      if (opts.channel !== undefined) query = query.where('channel', '=', opts.channel);
      const rows = await query.orderBy('receivedAt', 'asc').orderBy('id', 'asc').limit(opts.limit).execute();
      return rows.map((row) => row.id);
    },

    async dismiss(id, at, retainUntil) {
      const result = await db
        .updateTable('adminium_inbound_events')
        .set({ state: 'ignored', reason: 'dismissed', sealedBody: null, finishedAt: at, retainUntil })
        .where('id', '=', id)
        .where('state', '=', 'failed')
        .executeTakeFirst();
      return moved(result);
    },

    async wipeFailedBodies(before, limit, scope) {
      let query = db.selectFrom(TABLE).select('id').where('state', '=', 'failed').where('sealedBody', 'is not', null).where('receivedAt', '<', before);
      if (scope?.only !== undefined) query = query.where('channel', '=', scope.only);
      if (scope?.except !== undefined && scope.except.length > 0) query = query.where('channel', 'not in', [...scope.except]);
      const rows = await query.orderBy('receivedAt', 'asc').limit(limit).execute();
      if (rows.length === 0) return 0;
      const result = await db
        .updateTable('adminium_inbound_events')
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
        .deleteFrom('adminium_inbound_events')
        .where('id', 'in', rows.map((row) => row.id))
        .where('state', 'in', ['processed', 'ignored', 'failed', 'erased'])
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async eraseSubject(hashes, at, retainUntil) {
      if (hashes.length === 0) return 0;
      const result = await db
        .updateTable('adminium_inbound_events')
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
