// SPDX-License-Identifier: AGPL-3.0-only
/**
 * visitorsRepo — adminium_visitors and adminium_visits (0097): the visitors
 * who said yes to "Per visitor", and the pages each of them saw.
 *
 * Written only by the engine: a "yes" makes a visitor (its id a keyed hash of
 * the cookie's random value, never the value); the counter's minute flush
 * writes their visits, many rows in one insert; a form they send joins the
 * address's keyed hash onto them. Deleted by a withdrawal ("Cookie choice"),
 * by an erasure (found by the address hash under every key version), by
 * going down from "Per visitor" (every row, at once) and by the daily sweep.
 *
 * A visitor's visits are always deleted before the visitor, so a visit is
 * never left without one.
 */
import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { VISITOR_ADDRESS_HASH_WIDTH, VISITOR_HOST_WIDTH, VISITOR_ID_WIDTH, VISITOR_WORDING_WIDTH } from '../migrations/0097_visitors.js';
import type { AddressHash } from './consent.js';
import { affected } from './util.js';
import { VIEW_INSTALL_WIDTH, VIEW_KIND_WIDTH, VIEW_THING_WIDTH } from './view-days.js';

export { VISITOR_ADDRESS_HASH_WIDTH, VISITOR_HOST_WIDTH, VISITOR_ID_WIDTH, VISITOR_WORDING_WIDTH };

/** A visitor who said yes. */
export interface Visitor {
  id: string;
  host: string;
  saidYesAt: number;
  wordingVersion: string;
  address: AddressHash | null;
  lastSeenAt: number;
}

/** One counted view of a visitor. */
export interface VisitInput {
  visitorId: string;
  installId: string;
  kind: string;
  thing: string;
  at: number;
}

export interface Visit extends VisitInput {
  id: string;
}

/** How many rows went. */
export interface VisitorsGone {
  visitors: number;
  visits: number;
}

/** How many rows one insert carries: well under every engine's bound parameters. */
const INSERT_BATCH = 200;
/** How many ids one IN list names. */
const IN_BATCH = 300;

function checkVisitorId(id: string): void {
  if (id.length === 0 || id.length > VISITOR_ID_WIDTH) throw new Error('A visitor id is empty or longer than its column.');
}

function checkVisit(visit: VisitInput): void {
  checkVisitorId(visit.visitorId);
  if (visit.installId.length === 0 || visit.installId.length > VIEW_INSTALL_WIDTH) throw new Error('A visit\'s install id is empty or longer than its column.');
  if (visit.kind.length === 0 || visit.kind.length > VIEW_KIND_WIDTH) throw new Error('A visit\'s kind is empty or longer than its column.');
  if (visit.thing.length === 0 || visit.thing.length > VIEW_THING_WIDTH) throw new Error('A visit\'s thing is empty or longer than its column.');
}

function decode(row: { id: string; host: string; saidYesAt: number; wordingVersion: string; addressHash: string | null; keyVersion: number | null; lastSeenAt: number }): Visitor {
  return {
    id: row.id,
    host: row.host,
    saidYesAt: Number(row.saidYesAt),
    wordingVersion: row.wordingVersion,
    address: row.addressHash === null || row.keyVersion === null ? null : { hash: row.addressHash, version: Number(row.keyVersion) },
    lastSeenAt: Number(row.lastSeenAt),
  };
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function visitorsRepo(meta: MetaDb) {
  const { db } = meta;
  const visitors = 'adminium_visitors' as const;
  const visits = 'adminium_visits' as const;

  /** Deletes these visitors and their visits, visits first. */
  async function remove(ids: readonly string[]): Promise<VisitorsGone> {
    let gone = { visitors: 0, visits: 0 };
    for (const part of chunks([...new Set(ids)], IN_BATCH)) {
      const v = await db.deleteFrom(visits).where('visitorId', 'in', part).executeTakeFirst();
      const p = await db.deleteFrom(visitors).where('id', 'in', part).executeTakeFirst();
      gone = { visitors: gone.visitors + affected(p.numDeletedRows), visits: gone.visits + affected(v.numDeletedRows) };
    }
    return gone;
  }

  return {
    /** A "yes": the visitor, with the proof of it. */
    async create(input: { id: string; host: string; saidYesAt: number; wordingVersion: string }): Promise<Visitor> {
      checkVisitorId(input.id);
      if (input.host.length === 0 || input.host.length > VISITOR_HOST_WIDTH) throw new Error('A visitor\'s host is empty or longer than its column.');
      if (input.wordingVersion.length === 0 || input.wordingVersion.length > VISITOR_WORDING_WIDTH) throw new Error('A visitor\'s wording version is empty or longer than its column.');
      const row = { id: input.id, host: input.host, saidYesAt: input.saidYesAt, wordingVersion: input.wordingVersion, addressHash: null, keyVersion: null, lastSeenAt: input.saidYesAt };
      await db.insertInto(visitors).values(row).execute();
      return decode(row);
    },

    async find(id: string): Promise<Visitor | null> {
      const row = await db.selectFrom(visitors).selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** Which of these visitors are there. */
    async existing(ids: readonly string[]): Promise<Set<string>> {
      const out = new Set<string>();
      for (const part of chunks([...new Set(ids)], IN_BATCH)) {
        for (const row of await db.selectFrom(visitors).select('id').where('id', 'in', part).execute()) out.add(row.id);
      }
      return out;
    },

    /**
     * Visits, many in one insert each batch, and each visitor's last-seen
     * moment. Only visitors still there get theirs: a visit for a visitor
     * withdrawn or deleted since it was counted is dropped. Answers how many
     * were written.
     */
    async addVisits(list: readonly VisitInput[]): Promise<number> {
      for (const visit of list) checkVisit(visit);
      const there = await this.existing(list.map((visit) => visit.visitorId));
      const kept = list.filter((visit) => there.has(visit.visitorId));
      for (const part of chunks(kept, INSERT_BATCH)) {
        await db
          .insertInto(visits)
          .values(part.map((visit) => ({ id: newId('vst'), visitorId: visit.visitorId, installId: visit.installId, kind: visit.kind, thing: visit.thing, at: visit.at })))
          .execute();
      }
      const last = new Map<string, number>();
      for (const visit of kept) last.set(visit.visitorId, Math.max(last.get(visit.visitorId) ?? 0, visit.at));
      for (const [id, at] of last) await db.updateTable(visitors).set({ lastSeenAt: at }).where('id', '=', id).where('lastSeenAt', '<', at).execute();
      return kept.length;
    },

    /** A form sent by this visitor: the answer's address, as the address keys hash it, joined onto them. */
    async join(id: string, address: AddressHash): Promise<boolean> {
      if (address.hash.length === 0 || address.hash.length > VISITOR_ADDRESS_HASH_WIDTH) throw new Error('A visitor\'s address hash is empty or longer than its column.');
      const res = await db.updateTable(visitors).set({ addressHash: address.hash, keyVersion: address.version }).where('id', '=', id).executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** A withdrawal: the visitor and their visits. */
    async forget(id: string): Promise<VisitorsGone> {
      return remove([id]);
    },

    /** The visitors any of these hashes name (an address under each key version). */
    async byAddress(hashes: readonly AddressHash[]): Promise<Visitor[]> {
      const out: Visitor[] = [];
      for (const part of chunks(hashes, IN_BATCH)) {
        const rows = await db
          .selectFrom(visitors)
          .selectAll()
          .where((eb) => eb.or(part.map((one) => eb.and([eb('addressHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
          .orderBy('saidYesAt')
          .orderBy('id')
          .execute();
        out.push(...rows.map(decode));
      }
      return out;
    },

    /** These visitors' visits, oldest first, at most `limit`; and how many there are. */
    async visitsOf(ids: readonly string[], limit: number): Promise<{ count: number; visits: Visit[] }> {
      let count = 0;
      const out: Visit[] = [];
      for (const part of chunks([...new Set(ids)], IN_BATCH)) {
        const counted = await db.selectFrom(visits).select((eb) => eb.fn.countAll<number | string | bigint>().as('n')).where('visitorId', 'in', part).executeTakeFirst();
        count += Number(counted?.n ?? 0);
        if (out.length >= limit) continue;
        const rows = await db
          .selectFrom(visits)
          .selectAll()
          .where('visitorId', 'in', part)
          .orderBy('at')
          .orderBy('id')
          .limit(limit - out.length)
          .execute();
        out.push(...rows.map((row) => ({ ...row, at: Number(row.at) })));
      }
      return { count, visits: out };
    },

    /** An erasure: every visitor any of these hashes names, and their visits. */
    async eraseByAddress(hashes: readonly AddressHash[]): Promise<VisitorsGone> {
      const found = await this.byAddress(hashes);
      return remove(found.map((one) => one.id));
    },

    /** How many visitors and visits there are (what going down from "Per visitor" would delete). */
    async counts(): Promise<VisitorsGone> {
      const a = await db.selectFrom(visitors).select((eb) => eb.fn.countAll<number | string | bigint>().as('n')).executeTakeFirst();
      const b = await db.selectFrom(visits).select((eb) => eb.fn.countAll<number | string | bigint>().as('n')).executeTakeFirst();
      return { visitors: Number(a?.n ?? 0), visits: Number(b?.n ?? 0) };
    },

    /** Going down from "Per visitor": every visit and every visitor, at once. */
    async deleteAll(): Promise<VisitorsGone> {
      const v = await db.deleteFrom(visits).executeTakeFirst();
      const p = await db.deleteFrom(visitors).executeTakeFirst();
      return { visitors: affected(p.numDeletedRows), visits: affected(v.numDeletedRows) };
    },

    /**
     * The daily sweep: every visit made before `before` (epoch ms), then
     * every visitor last seen before it with no visit left.
     */
    async sweep(before: number): Promise<VisitorsGone> {
      const v = await db.deleteFrom(visits).where('at', '<', before).executeTakeFirst();
      const p = await db
        .deleteFrom(visitors)
        .where('lastSeenAt', '<', before)
        .where((eb) => eb.not(eb.exists(eb.selectFrom(visits).select('id').whereRef('adminium_visits.visitorId', '=', 'adminium_visitors.id'))))
        .executeTakeFirst();
      return { visitors: affected(p.numDeletedRows), visits: affected(v.numDeletedRows) };
    },
  };
}

export type VisitorsRepo = ReturnType<typeof visitorsRepo>;
