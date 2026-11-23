// SPDX-License-Identifier: AGPL-3.0-only
/**
 * shippingTrackingRepo — where a parcel is (0111).
 *
 * A carrier's word about a parcel is a claim. `applyStatus` is the one place a
 * status is written, and it is a single guarded UPDATE, so events arriving
 * twice, late or at the same moment on two processes cannot move a parcel
 * backwards on any of the three databases.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_URL_WIDTH } from '../migrations/0109_shipping_bookings.js';
import { SHIPPING_TRACK_WORD_WIDTH } from '../migrations/0111_shipping_tracking.js';
import type { AdminiumShippingParcelsTable, AdminiumShippingTrackEventsTable, AdminiumShippingTrackInstallsTable } from '../schema/tables.js';
import { moveLabelClock } from './shipping-bookings.js';
import { affected, isDuplicateKeyError } from './util.js';

/** How far along each status is. A delivered or returned parcel is final. */
export const SHIPPING_TRACK_RANKS = { UNKNOWN: 0, PRE_TRANSIT: 10, TRANSIT: 20, FAILURE: 30, RETURNED: 90, DELIVERED: 100 } as const;
export type ShippingTrackStatus = keyof typeof SHIPPING_TRACK_RANKS;
export const SHIPPING_TRACK_FINAL_RANK = SHIPPING_TRACK_RANKS.RETURNED;
/** How many earlier numbers one label remembers. */
const OLD_NUMBERS_MAX = 10;

export interface ShippingTrackInstall {
  carrierInstallId: string;
  tokenHash: string | null;
  tokenHint: string | null;
  tokenMadeAt: number | null;
  firstAt: number | null;
  lastAt: number | null;
  lastBadAt: number | null;
  refreshedAt: number | null;
  pollOnAt: number | null;
  pollMonth: string | null;
  pollCalls: number;
}

export interface ShippingParcel {
  bookingId: string;
  carrierInstallId: string;
  status: ShippingTrackStatus | null;
  statusRank: number;
  statusAt: number | null;
  triedAt: number | null;
  checkedAt: number | null;
  polledAt: number | null;
  flag: string | null;
  numberChangedAt: number | null;
  /** The carrier's time for the last number change. */
  numberAt: number | null;
  oldNumbers: string[];
  updatedAt: number;
}

export type ShippingTrackEventKind = 'track' | 'transaction';

export interface ShippingTrackEvent {
  id: string;
  carrierInstallId: string;
  kind: ShippingTrackEventKind;
  tracking: string | null;
  transactionId: string | null;
  rateRef: string | null;
  status: string;
  statusAt: number | null;
  trackingUrl: string | null;
  state: 'waiting' | 'done';
  outcome: string | null;
  receivedAt: number;
  processedAt: number | null;
}

export type NewShippingTrackEvent = Pick<ShippingTrackEvent, 'carrierInstallId' | 'kind' | 'tracking' | 'transactionId' | 'rateRef' | 'status' | 'statusAt' | 'trackingUrl'> & { dedupeHash: string };

/** One open parcel, as a refresh or a poll chooses it. */
export interface OpenParcel {
  bookingId: string;
  createdAt: number;
  rank: number;
  statusAt: number | null;
  checkedAt: number | null;
  polledAt: number | null;
}

/** Rolls a number change back when the booking has moved on. */
class NumberMoved extends Error {}

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function readNumbers(text: string | null): string[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === 'string') : [];
  } catch {
    return [];
  }
}

function toInstall(row: Selectable<AdminiumShippingTrackInstallsTable>): ShippingTrackInstall {
  return {
    carrierInstallId: row.carrierInstallId,
    tokenHash: row.tokenHash,
    tokenHint: row.tokenHint,
    tokenMadeAt: num(row.tokenMadeAt),
    firstAt: num(row.firstAt),
    lastAt: num(row.lastAt),
    lastBadAt: num(row.lastBadAt),
    refreshedAt: num(row.refreshedAt),
    pollOnAt: num(row.pollOnAt),
    pollMonth: row.pollMonth,
    pollCalls: Number(row.pollCalls),
  };
}

function toParcel(row: Selectable<AdminiumShippingParcelsTable>): ShippingParcel {
  return {
    bookingId: row.bookingId,
    carrierInstallId: row.carrierInstallId,
    status: row.status as ShippingTrackStatus | null,
    statusRank: Number(row.statusRank),
    statusAt: num(row.statusAt),
    triedAt: num(row.triedAt),
    checkedAt: num(row.checkedAt),
    polledAt: num(row.polledAt),
    flag: row.flag,
    numberChangedAt: num(row.numberChangedAt),
    numberAt: num(row.numberAt),
    oldNumbers: readNumbers(row.oldNumbers),
    updatedAt: Number(row.updatedAt),
  };
}

function toEvent(row: Selectable<AdminiumShippingTrackEventsTable>): ShippingTrackEvent {
  return {
    id: row.id,
    carrierInstallId: row.carrierInstallId,
    kind: row.kind === 'transaction' ? 'transaction' : 'track',
    tracking: row.tracking,
    transactionId: row.transactionId,
    rateRef: row.rateRef,
    status: row.status,
    statusAt: num(row.statusAt),
    trackingUrl: row.trackingUrl,
    state: row.state === 'done' ? 'done' : 'waiting',
    outcome: row.outcome,
    receivedAt: Number(row.receivedAt),
    processedAt: num(row.processedAt),
  };
}

export function shippingTrackingRepo(meta: MetaDb) {
  const { db } = meta;

  async function ensureInstall(carrierInstallId: string, at: number): Promise<void> {
    try {
      await db.insertInto('adminium_shipping_track_installs').values({ carrierInstallId, pollCalls: 0, updatedAt: at }).execute();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  const repo = {
    async install(carrierInstallId: string): Promise<ShippingTrackInstall | null> {
      const row = await db.selectFrom('adminium_shipping_track_installs').selectAll().where('carrierInstallId', '=', carrierInstallId).executeTakeFirst();
      return row === undefined ? null : toInstall(row);
    },

    /** A new webhook token. The old one stops working in the same write. */
    async setToken(carrierInstallId: string, tokenHash: string, tokenHint: string, at: number): Promise<void> {
      await ensureInstall(carrierInstallId, at);
      await db.updateTable('adminium_shipping_track_installs').set({ tokenHash, tokenHint, tokenMadeAt: at, updatedAt: at }).where('carrierInstallId', '=', carrierInstallId).execute();
    },

    /** The key behind this webhook changed or went: its address stops working. */
    async clearToken(carrierInstallId: string, at: number): Promise<void> {
      // `tokenMadeAt` stays: it is how a screen tells an address that ended from one never made.
      await db.updateTable('adminium_shipping_track_installs').set({ tokenHash: null, tokenHint: null, updatedAt: at }).where('carrierInstallId', '=', carrierInstallId).execute();
    },

    /** A webhook accepted. Only this writes the health a screen reads as "last update received". */
    async heard(carrierInstallId: string, at: number): Promise<void> {
      await db.updateTable('adminium_shipping_track_installs').set({ lastAt: at, updatedAt: at }).where('carrierInstallId', '=', carrierInstallId).execute();
      await db.updateTable('adminium_shipping_track_installs').set({ firstAt: at }).where('carrierInstallId', '=', carrierInstallId).where('firstAt', 'is', null).execute();
    },

    /** A wrong token, written at most once a minute however many arrive. */
    async badToken(carrierInstallId: string, at: number): Promise<void> {
      await db
        .updateTable('adminium_shipping_track_installs')
        .set({ lastBadAt: at })
        .where('carrierInstallId', '=', carrierInstallId)
        .where((eb) => eb.or([eb('lastBadAt', 'is', null), eb('lastBadAt', '<=', at - 60_000)]))
        .execute();
    },

    /** One "Refresh open parcels" per install per cool-down, decided by the UPDATE. */
    async claimRefresh(carrierInstallId: string, at: number, coolMs: number): Promise<boolean> {
      await ensureInstall(carrierInstallId, at);
      const moved = await db
        .updateTable('adminium_shipping_track_installs')
        .set({ refreshedAt: at, updatedAt: at })
        .where('carrierInstallId', '=', carrierInstallId)
        .where((eb) => eb.or([eb('refreshedAt', 'is', null), eb('refreshedAt', '<=', at - coolMs)]))
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    async setPolling(carrierInstallId: string, on: boolean, at: number): Promise<void> {
      await ensureInstall(carrierInstallId, at);
      await db.updateTable('adminium_shipping_track_installs').set({ pollOnAt: on ? at : null, updatedAt: at }).where('carrierInstallId', '=', carrierInstallId).execute();
    },

    /** Takes one call from this month's allowance, or answers false. */
    async takePollCall(carrierInstallId: string, month: string, cap: number, at: number): Promise<boolean> {
      await db
        .updateTable('adminium_shipping_track_installs')
        .set({ pollMonth: month, pollCalls: 0, updatedAt: at })
        .where('carrierInstallId', '=', carrierInstallId)
        .where((eb) => eb.or([eb('pollMonth', 'is', null), eb('pollMonth', '!=', month)]))
        .execute();
      const moved = await db
        .updateTable('adminium_shipping_track_installs')
        .set((eb) => ({ pollCalls: eb('pollCalls', '+', 1), updatedAt: at }))
        .where('carrierInstallId', '=', carrierInstallId)
        .where('pollMonth', '=', month)
        .where('pollCalls', '<', cap)
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    // ── Events ─────────────────────────────────────────────────────────────

    /** Stores an event once. Answers its id, or null for one already held. */
    async storeEvent(input: NewShippingTrackEvent, at: number): Promise<string | null> {
      const fits = (value: string | null, width: number) => value === null || value.length <= width;
      if (!fits(input.tracking, SHIPPING_CARRIER_TEXT_WIDTH) || !fits(input.transactionId, SHIPPING_CARRIER_TEXT_WIDTH) || !fits(input.rateRef, SHIPPING_CARRIER_TEXT_WIDTH) || !fits(input.trackingUrl, SHIPPING_URL_WIDTH) || !fits(input.status, SHIPPING_TRACK_WORD_WIDTH)) {
        throw new Error('A tracking event is longer than its columns.');
      }
      const id = newId('ste');
      try {
        await db
          .insertInto('adminium_shipping_track_events')
          .values({
            id,
            carrierInstallId: input.carrierInstallId,
            dedupeHash: input.dedupeHash,
            kind: input.kind,
            tracking: input.tracking,
            transactionId: input.transactionId,
            rateRef: input.rateRef,
            status: input.status,
            statusAt: input.statusAt,
            trackingUrl: input.trackingUrl,
            state: 'waiting',
            receivedAt: at,
          })
          .execute();
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
      return id;
    },

    async event(id: string): Promise<ShippingTrackEvent | null> {
      const row = await db.selectFrom('adminium_shipping_track_events').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : toEvent(row);
    },

    async waitingCount(carrierInstallId: string): Promise<number> {
      const row = await db
        .selectFrom('adminium_shipping_track_events')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('carrierInstallId', '=', carrierInstallId)
        .where('state', '=', 'waiting')
        .executeTakeFirst();
      return Number(row?.count ?? 0);
    },

    async waitingEvents(before: number, limit: number): Promise<ShippingTrackEvent[]> {
      const rows = await db.selectFrom('adminium_shipping_track_events').selectAll().where('state', '=', 'waiting').where('receivedAt', '<=', before).orderBy('receivedAt').limit(limit).execute();
      return rows.map(toEvent);
    },

    async finishEvent(id: string, outcome: string, at: number): Promise<boolean> {
      const moved = await db.updateTable('adminium_shipping_track_events').set({ state: 'done', outcome: outcome.slice(0, SHIPPING_TRACK_WORD_WIDTH), processedAt: at }).where('id', '=', id).where('state', '=', 'waiting').executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /** Events past their use. One that matched nothing goes sooner. */
    async pruneEvents(doneBefore: number, unmatchedBefore: number): Promise<void> {
      await db.deleteFrom('adminium_shipping_track_events').where('state', '=', 'done').where('processedAt', '<=', doneBefore).execute();
      await db.deleteFrom('adminium_shipping_track_events').where('state', '=', 'done').where('outcome', '=', 'no-match').where('processedAt', '<=', unmatchedBefore).execute();
    },

    // ── Which booking a claim is about, inside one install ─────────────────

    async liveBookedByShipment(carrierInstallId: string, shipmentId: string): Promise<string[]> {
      const rows = await db.selectFrom('adminium_shipping_bookings').select('id').where('carrierInstallId', '=', carrierInstallId).where('carrierShipmentId', '=', shipmentId).where('state', '=', 'booked').where('mode', '=', 'live').limit(5).execute();
      return rows.map((row) => row.id);
    },

    /** The live label with a refund pending that a carrier's event is about. */
    async liveVoidingByShipment(carrierInstallId: string, shipmentId: string): Promise<string[]> {
      const rows = await db.selectFrom('adminium_shipping_bookings').select('id').where('carrierInstallId', '=', carrierInstallId).where('carrierShipmentId', '=', shipmentId).where('state', '=', 'voiding').where('mode', '=', 'live').limit(5).execute();
      return rows.map((row) => row.id);
    },

    /** Test bookings are never in this list: test numbers repeat. */
    async liveBookedByTracking(carrierInstallId: string, tracking: string): Promise<string[]> {
      const rows = await db.selectFrom('adminium_shipping_bookings').select('id').where('carrierInstallId', '=', carrierInstallId).where('tracking', '=', tracking).where('state', '=', 'booked').where('mode', '=', 'live').limit(5).execute();
      return rows.map((row) => row.id);
    },

    async liveUnknown(carrierInstallId: string, limit: number): Promise<string[]> {
      const rows = await db.selectFrom('adminium_shipping_bookings').select('id').where('carrierInstallId', '=', carrierInstallId).where('state', '=', 'unknown').where('mode', '=', 'live').where('handleSealed', 'is not', null).limit(limit).execute();
      return rows.map((row) => row.id);
    },

    // ── Parcels ────────────────────────────────────────────────────────────

    async parcel(bookingId: string): Promise<ShippingParcel | null> {
      const row = await db.selectFrom('adminium_shipping_parcels').selectAll().where('bookingId', '=', bookingId).executeTakeFirst();
      return row === undefined ? null : toParcel(row);
    },

    async parcels(bookingIds: readonly string[]): Promise<Map<string, ShippingParcel>> {
      if (bookingIds.length === 0) return new Map();
      const rows = await db.selectFrom('adminium_shipping_parcels').selectAll().where('bookingId', 'in', [...bookingIds]).execute();
      return new Map(rows.map((row) => [row.bookingId, toParcel(row)]));
    },

    async ensureParcel(bookingId: string, carrierInstallId: string, at: number): Promise<void> {
      try {
        await db.insertInto('adminium_shipping_parcels').values({ bookingId, carrierInstallId, statusRank: -1, updatedAt: at }).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    },

    /**
     * The forward-only rule, in the UPDATE itself. A later status replaces an
     * earlier one only if it is at least as far along, except that a failed
     * delivery can be followed by anything real (a parcel sent out again).
     * UNKNOWN only ever fills an empty row, and any real status replaces it
     * whatever its date. `sameNumberSince` is the `numberChangedAt` read before
     * a carrier was asked: if the number has changed since, the answer was
     * about the old one and is not written. Answers whether it moved.
     */
    async applyStatus(bookingId: string, status: ShippingTrackStatus, statusAt: number, at: number, sameNumberSince?: number | null): Promise<boolean> {
      const rank = SHIPPING_TRACK_RANKS[status];
      return db.transaction().execute(async (trx) => {
      const moved = await trx
        .updateTable('adminium_shipping_parcels')
        .set({ status, statusRank: rank, statusAt, updatedAt: at })
        .where('bookingId', '=', bookingId)
        .$if(sameNumberSince !== undefined, (query) => query.where('numberChangedAt', sameNumberSince === null ? 'is' : '=', sameNumberSince ?? null))
        .where((eb) => {
          if (rank === SHIPPING_TRACK_RANKS.UNKNOWN) return eb('statusRank', '=', -1);
          return eb.or([
            eb('statusRank', '<=', SHIPPING_TRACK_RANKS.UNKNOWN),
            eb.and([
              eb.or([eb('statusAt', '<', statusAt), eb.and([eb('statusAt', '=', statusAt), eb('statusRank', '<', rank)])]),
              eb.or([eb('statusRank', '<=', rank), eb('statusRank', '=', SHIPPING_TRACK_RANKS.FAILURE)]),
            ]),
          ]);
        })
        .executeTakeFirst();
      if (affected(moved.numUpdatedRows) === 0) return false;
      // A real event is the label's latest state: its file is kept 90 days from here, in the same step.
      if (status !== 'UNKNOWN') await moveLabelClock(trx, bookingId, statusAt);
      return true;
      });
    },

    /** One person's refresh of one parcel per cool-down, decided by the UPDATE. */
    async claimTry(bookingId: string, at: number, coolMs: number): Promise<boolean> {
      const moved = await db
        .updateTable('adminium_shipping_parcels')
        .set({ triedAt: at })
        .where('bookingId', '=', bookingId)
        .where((eb) => eb.or([eb('triedAt', 'is', null), eb('triedAt', '<=', at - coolMs)]))
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /** The carrier answered a person's refresh. */
    async markChecked(bookingId: string, at: number): Promise<void> {
      await db.updateTable('adminium_shipping_parcels').set({ checkedAt: at, updatedAt: at }).where('bookingId', '=', bookingId).execute();
    },

    async clearFlag(bookingId: string, at: number): Promise<void> {
      await db.updateTable('adminium_shipping_parcels').set({ flag: null, updatedAt: at }).where('bookingId', '=', bookingId).execute();
    },

    /** Counts as a try too, so a parcel just polled goes to the back of the line. */
    async markPolled(bookingId: string, at: number): Promise<void> {
      await db.updateTable('adminium_shipping_parcels').set({ polledAt: at, triedAt: at, updatedAt: at }).where('bookingId', '=', bookingId).execute();
    },

    async flag(bookingId: string, carrierInstallId: string, flag: string, at: number): Promise<void> {
      await repo.ensureParcel(bookingId, carrierInstallId, at);
      await db.updateTable('adminium_shipping_parcels').set({ flag: flag.slice(0, SHIPPING_TRACK_WORD_WIDTH), updatedAt: at }).where('bookingId', '=', bookingId).execute();
    },

    /**
     * The label's number changed, in one transaction: the old number is
     * remembered (the order may still show it), the status starts again (it
     * was about the old number), and the booking takes the new one only if it
     * still holds `from`. Answers `older` for a change the carrier made before
     * the last one, and `moved` when the booking changed under this call.
     */
    async changeNumber(input: { bookingId: string; carrierInstallId: string; from: string | null; to: string; trackingUrl: string | null; carrierAt: number; at: number }): Promise<'changed' | 'older' | 'moved'> {
      const { bookingId, from, to, trackingUrl, carrierAt, at } = input;
      if (to.length > SHIPPING_CARRIER_TEXT_WIDTH || (trackingUrl !== null && trackingUrl.length > SHIPPING_URL_WIDTH)) throw new Error('A carrier value is longer than its column.');
      await repo.ensureParcel(bookingId, input.carrierInstallId, at);
      try {
        return await db.transaction().execute(async (trx) => {
          const current = await trx.selectFrom('adminium_shipping_parcels').select('oldNumbers').where('bookingId', '=', bookingId).executeTakeFirst();
          const known = readNumbers(current?.oldNumbers ?? null);
          const kept = from === null ? known : [...known.filter((one) => one !== from), from].slice(-OLD_NUMBERS_MAX);
          const parcel = await trx
            .updateTable('adminium_shipping_parcels')
            .set({ oldNumbers: JSON.stringify(kept), numberChangedAt: at, numberAt: carrierAt, status: null, statusRank: -1, statusAt: null, updatedAt: at })
            .where('bookingId', '=', bookingId)
            .where((eb) => eb.or([eb('numberAt', 'is', null), eb('numberAt', '<', carrierAt)]))
            .executeTakeFirst();
          if (affected(parcel.numUpdatedRows) === 0) return 'older' as const;
          const booking = await trx
            .updateTable('adminium_shipping_bookings')
            .set({ tracking: to, trackingUrl, updatedAt: at })
            .where('id', '=', bookingId)
            .where('state', '=', 'booked')
            .where((eb) => (from === null ? eb('tracking', 'is', null) : eb('tracking', '=', from)))
            .executeTakeFirst();
          if (affected(booking.numUpdatedRows) === 0) throw new NumberMoved();
          return 'changed' as const;
        });
      } catch (error) {
        if (error instanceof NumberMoved) return 'moved';
        throw error;
      }
    },

    /**
     * Live, booked, not yet final, longest-untried first: what "Refresh open
     * parcels" and a poll choose from. Test bookings are never here.
     */
    async openParcels(scope: { carrierInstallId: string; connectionId?: string; installId?: string }, since: number, limit: number, offset = 0): Promise<OpenParcel[]> {
      let query = db
        .selectFrom('adminium_shipping_bookings as b')
        .leftJoin('adminium_shipping_parcels as p', 'p.bookingId', 'b.id')
        .select(['b.id as bookingId', 'b.createdAt as createdAt', 'p.statusRank as rank', 'p.statusAt as statusAt', 'p.checkedAt as checkedAt', 'p.polledAt as polledAt'])
        .where('b.carrierInstallId', '=', scope.carrierInstallId)
        // A label with a refund pending stays open: a press is how a private install hears the answer.
        .where('b.state', 'in', ['booked', 'voiding'])
        .where('b.mode', '=', 'live')
        .where('b.tracking', 'is not', null)
        .where('b.createdAt', '>=', since)
        .where((eb) => eb.or([eb('p.statusRank', 'is', null), eb('p.statusRank', '<', SHIPPING_TRACK_FINAL_RANK)]));
      if (scope.connectionId !== undefined) query = query.where('b.connectionId', '=', scope.connectionId);
      if (scope.installId !== undefined) query = query.where('b.installId', '=', scope.installId);
      const rows = await query
        // By the last TRY: a parcel the carrier keeps failing on must not hold the front of the line for ever.
        .orderBy((eb) => eb.fn.coalesce('p.triedAt', 'p.checkedAt', eb.val(0)))
        .orderBy('b.createdAt')
        .orderBy('b.id')
        .limit(limit)
        .offset(offset)
        .execute();
      return rows.map((row) => ({
        bookingId: row.bookingId,
        createdAt: Number(row.createdAt),
        rank: row.rank === null || row.rank === undefined ? -1 : Number(row.rank),
        statusAt: num(row.statusAt),
        checkedAt: num(row.checkedAt),
        polledAt: num(row.polledAt),
      }));
    },

    /**
     * The bookings of one app install that may need a person: purchases with
     * no answer first, then newest first, so rows that stay on the list for
     * good (a returned parcel, a changed number) never hide a new one. One
     * page of a list to judge, not a verdict: the caller works out each row's
     * reasons and who reaches it. Reads through the connection's index.
     */
    async attentionIds(scope: { connectionId: string; installId: string; calledBefore: number; openSince: number; quietBefore: number; refusedSince: number }, limit: number, offset = 0): Promise<string[]> {
      const rows = await db
        .selectFrom('adminium_shipping_bookings as b')
        .leftJoin('adminium_shipping_parcels as p', 'p.bookingId', 'b.id')
        .select('b.id as id')
        .where('b.connectionId', '=', scope.connectionId)
        .where('b.installId', '=', scope.installId)
        .where((eb) =>
          eb.or([
            eb('b.state', '=', 'unknown'),
            eb.and([eb('b.state', '=', 'calling'), eb(eb.fn.coalesce('b.calledAt', 'b.updatedAt'), '<=', scope.calledBefore)]),
            // Test numbers repeat and are never tracked, so nothing below is about a test label.
            eb.and([
              eb('b.mode', '=', 'live'),
              eb.or([
                eb('b.duplicates', '>', 0),
                eb('b.state', '=', 'voiding'),
                eb.and([eb('b.state', '=', 'booked'), eb('b.voidState', '=', 'refused'), eb('b.voidSettledAt', '>=', scope.refusedSince)]),
                eb.and([
                  eb('b.state', '=', 'booked'),
                  eb.or([
                    eb.and([eb('b.labelRef', 'is', null), eb('b.labelGoneAt', 'is', null)]),
                    eb('p.numberChangedAt', 'is not', null),
                    eb('p.status', 'in', ['FAILURE', 'RETURNED']),
                    eb('p.flag', '=', 'ambiguous'),
                    eb.and([
                      eb('b.tracking', 'is not', null),
                      eb('b.createdAt', '>=', scope.openSince),
                      eb.or([eb('p.statusRank', 'is', null), eb('p.statusRank', '<', SHIPPING_TRACK_FINAL_RANK)]),
                      eb(eb.fn.coalesce('p.statusAt', 'b.createdAt'), '<=', scope.quietBefore),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        )
        .orderBy((eb) =>
          eb
            .case()
            .when(eb.or([eb('b.state', '=', 'unknown'), eb.and([eb('b.state', '=', 'calling'), eb(eb.fn.coalesce('b.calledAt', 'b.updatedAt'), '<=', scope.calledBefore)])]))
            .then(eb.lit(0))
            .else(eb.lit(1))
            .end(),
        )
        .orderBy('b.createdAt', 'desc')
        .orderBy('b.id', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();
      return rows.map((row) => row.id);
    },
  };
  return repo;
}

export type ShippingTrackingRepo = ReturnType<typeof shippingTrackingRepo>;
