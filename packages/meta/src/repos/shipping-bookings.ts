// SPDX-License-Identifier: AGPL-3.0-only
/**
 * shippingBookingsRepo — adminium_shipping_bookings (0105): every label a shop
 * has tried to buy, and how each attempt stands.
 *
 *   reserved ──> calling ──> booked
 *      │            ├──────> refused
 *      │            └──────> unknown ──> booked | refused | released
 *      └──> released
 *
 * Every move is one guarded UPDATE, read by its affected rows, so two runs can
 * never both take the same step. `open_key` holds the order's slot while the
 * attempt is live: its unique index is the one-live-booking rule on all three
 * databases, and it is cleared by a refusal or a person's release.
 */
import { createHash } from 'node:crypto';

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { SHIPPING_CARRIER_WIDTH, SHIPPING_HASH_WIDTH, SHIPPING_ID_WIDTH, SHIPPING_ROW_WIDTH, SHIPPING_TABLE_WIDTH } from '../migrations/0103_shipping.js';
import { SHIPPING_MONEY_WIDTH } from '../migrations/0104_shipping_keys.js';
import { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_REASON_WIDTH, SHIPPING_URL_WIDTH } from '../migrations/0105_shipping_bookings.js';
import type { AdminiumShippingBookingsTable } from '../schema/tables.js';
import { affected, isDuplicateKeyError, readBool, writeBool } from './util.js';
import type { ShippingKeyMode, ShippingSlot } from './shipping.js';

export { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_REASON_WIDTH, SHIPPING_URL_WIDTH };

export const SHIPPING_BOOKING_STATES = ['reserved', 'calling', 'booked', 'refused', 'unknown', 'released'] as const;
export type ShippingBookingState = (typeof SHIPPING_BOOKING_STATES)[number];

/** A purchase that may have happened and has no final answer: the key it was made under cannot change. */
export const UNRESOLVED_BOOKING_STATES: readonly ShippingBookingState[] = ['reserved', 'calling', 'unknown'];

/** The states that give the slot up. */
const SLOT_FREED: readonly ShippingBookingState[] = ['refused', 'released'];

/** One parcel's place: the real table, because two apps on one database may both call theirs `orders`. */
export type ShippingBookingSlot = Pick<ShippingSlot, 'connectionId' | 'rowKey' | 'purpose' | 'parcelNumber'> & { tableName: string };

export interface ShippingBooking extends ShippingSlot {
  id: string;
  /** The real table the order is in. */
  tableName: string;
  carrierInstallId: string;
  carrierKey: string;
  reference: string;
  openKey: string | null;
  state: ShippingBookingState;
  mode: ShippingKeyMode;
  accountFingerprint: string;
  detailsHash: string;
  service: string;
  rateCode: string;
  /** The carrier's handle for the rate, sealed by the engine. */
  handleSealed: string | null;
  quotedAmount: string;
  quotedCurrency: string;
  /** What the carrier says it charged. */
  amount: string | null;
  currency: string | null;
  chargeDiffers: boolean;
  carrierShipmentId: string | null;
  tracking: string | null;
  carrierName: string | null;
  carrierToken: string | null;
  trackingUrl: string | null;
  labelRef: string | null;
  /** The shop day this attempt counts against the daily limit, when it was bound by one. */
  countedDay: string | null;
  /** Whether it counts now: a refusal gives it back, and a label that turns up late takes it again. */
  countHeld: boolean;
  /** Why it is unknown or refused, as a stable word. */
  reason: string | null;
  /** More labels the carrier found for this purchase: for a person to refund, never automatically. */
  duplicates: number;
  createdBy: string | null;
  releasedBy: string | null;
  createdAt: number;
  calledAt: number | null;
  answeredAt: number | null;
  releasedAt: number | null;
  checkedAt: number | null;
  copiedAt: number | null;
  appliedAt: number | null;
  updatedAt: number;
}

export type NewShippingBooking = Pick<
  ShippingBooking,
  | keyof ShippingSlot
  | 'tableName'
  | 'carrierInstallId'
  | 'carrierKey'
  | 'reference'
  | 'mode'
  | 'accountFingerprint'
  | 'detailsHash'
  | 'service'
  | 'rateCode'
  | 'handleSealed'
  | 'quotedAmount'
  | 'quotedCurrency'
  | 'createdBy'
> & { state?: Extract<ShippingBookingState, 'reserved' | 'unknown'>; reason?: string | null };

export type ShippingBookingFields = Partial<
  Pick<
    ShippingBooking,
    | 'amount'
    | 'currency'
    | 'chargeDiffers'
    | 'carrierShipmentId'
    | 'tracking'
    | 'carrierName'
    | 'carrierToken'
    | 'trackingUrl'
    | 'labelRef'
    | 'reason'
    | 'duplicates'
    | 'releasedBy'
    | 'calledAt'
    | 'answeredAt'
    | 'releasedAt'
    | 'checkedAt'
    | 'copiedAt'
    | 'appliedAt'
  >
>;

/** The hash that holds one parcel's place. Test and live are separate places; the carrier is not part of it. */
export function shippingOpenKey(slot: ShippingBookingSlot, mode: ShippingKeyMode): string {
  return createHash('sha256')
    .update(JSON.stringify([slot.connectionId, slot.tableName, slot.rowKey, slot.purpose, slot.parcelNumber, mode]))
    .digest('hex');
}

const number = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function checkFields(fields: ShippingBookingFields): void {
  const fits = (value: string | null | undefined, width: number) => value === null || value === undefined || value.length <= width;
  for (const value of [fields.carrierShipmentId, fields.tracking, fields.carrierName, fields.carrierToken, fields.labelRef]) {
    if (!fits(value, SHIPPING_CARRIER_TEXT_WIDTH)) throw new Error('A carrier value is longer than its column.');
  }
  if (!fits(fields.trackingUrl, SHIPPING_URL_WIDTH)) throw new Error('A tracking address is longer than its column.');
  if (!fits(fields.amount, SHIPPING_MONEY_WIDTH)) throw new Error('A charge is longer than its column.');
  if (!fits(fields.reason, SHIPPING_REASON_WIDTH)) throw new Error('A reason is longer than its column.');
}

/** Rolls a hand-over back when one side of it has moved on. */
class SlotMoved extends Error {}

export function shippingBookingsRepo(meta: MetaDb) {
  const { db } = meta;

  function toBooking(row: Selectable<AdminiumShippingBookingsTable>): ShippingBooking {
    return {
      id: row.id,
      installId: row.installId,
      carrierInstallId: row.carrierInstallId,
      carrierKey: row.carrierKey,
      connectionId: row.connectionId,
      tableRef: row.tableRef,
      tableName: row.tableName,
      rowKey: row.rowKey,
      purpose: row.purpose,
      parcelNumber: Number(row.parcelNumber),
      reference: row.reference,
      openKey: row.openKey,
      state: row.state as ShippingBookingState,
      mode: row.mode === 'live' ? 'live' : 'test',
      accountFingerprint: row.accountFingerprint,
      detailsHash: row.detailsHash,
      service: row.service,
      rateCode: row.rateCode,
      handleSealed: row.handleSealed,
      quotedAmount: row.quotedAmount,
      quotedCurrency: row.quotedCurrency,
      amount: row.amount,
      currency: row.currency,
      chargeDiffers: readBool(row.chargeDiffers),
      carrierShipmentId: row.carrierShipmentId,
      tracking: row.tracking,
      carrierName: row.carrierName,
      carrierToken: row.carrierToken,
      trackingUrl: row.trackingUrl,
      labelRef: row.labelRef,
      countedDay: row.countedDay,
      countHeld: readBool(row.countHeld),
      reason: row.reason,
      duplicates: Number(row.duplicates),
      createdBy: row.createdBy,
      releasedBy: row.releasedBy,
      createdAt: Number(row.createdAt),
      calledAt: number(row.calledAt),
      answeredAt: number(row.answeredAt),
      releasedAt: number(row.releasedAt),
      checkedAt: number(row.checkedAt),
      copiedAt: number(row.copiedAt),
      appliedAt: number(row.appliedAt),
      updatedAt: Number(row.updatedAt),
    };
  }

  const packed = (fields: ShippingBookingFields) => {
    checkFields(fields);
    const { chargeDiffers, ...rest } = fields;
    return { ...rest, ...(chargeDiffers === undefined ? {} : { chargeDiffers: writeBool(meta, chargeDiffers) as boolean }) };
  };

  const repo = {
    async byId(id: string): Promise<ShippingBooking | null> {
      const row = await db.selectFrom('adminium_shipping_bookings').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : toBooking(row);
    },

    /** The live booking holding this slot, if any. */
    async open(slot: ShippingBookingSlot, mode: ShippingKeyMode): Promise<ShippingBooking | null> {
      const row = await db.selectFrom('adminium_shipping_bookings').selectAll().where('openKey', '=', shippingOpenKey(slot, mode)).executeTakeFirst();
      return row === undefined ? null : toBooking(row);
    },

    /**
     * The attempt, written before anything is called. Answers the booking that
     * already holds the slot instead when there is one: its unique key, not a
     * read before the write, is what decides.
     */
    async reserve(input: NewShippingBooking, at: number): Promise<{ ok: true; booking: ShippingBooking } | { ok: false; holder: ShippingBooking | null }> {
      const fits = (value: string, width: number) => value.length > 0 && value.length <= width;
      if (!fits(input.installId, SHIPPING_ID_WIDTH) || !fits(input.carrierInstallId, SHIPPING_ID_WIDTH) || !fits(input.connectionId, SHIPPING_ID_WIDTH)) throw new Error('A booking has an empty or over-long id.');
      if (!fits(input.tableRef, SHIPPING_TABLE_WIDTH) || !fits(input.tableName, SHIPPING_ROW_WIDTH) || !fits(input.rowKey, SHIPPING_ROW_WIDTH) || !fits(input.carrierKey, SHIPPING_CARRIER_WIDTH)) throw new Error('A booking has an empty or over-long slot.');
      if (input.detailsHash.length !== SHIPPING_HASH_WIDTH || input.accountFingerprint.length !== SHIPPING_HASH_WIDTH) throw new Error('A booking holds full hashes.');
      const reference = input.reference.slice(0, SHIPPING_CARRIER_TEXT_WIDTH);
      const service = input.service.slice(0, SHIPPING_CARRIER_TEXT_WIDTH);
      const rateCode = input.rateCode.slice(0, SHIPPING_CARRIER_TEXT_WIDTH);
      const openKey = shippingOpenKey(input, input.mode);
      const id = newId('shb');
      try {
        await db
          .insertInto('adminium_shipping_bookings')
          .values({
            id,
            installId: input.installId,
            carrierInstallId: input.carrierInstallId,
            carrierKey: input.carrierKey,
            connectionId: input.connectionId,
            tableRef: input.tableRef,
            tableName: input.tableName,
            rowKey: input.rowKey,
            purpose: input.purpose,
            parcelNumber: input.parcelNumber,
            reference,
            openKey,
            state: input.state ?? 'reserved',
            mode: input.mode,
            accountFingerprint: input.accountFingerprint,
            detailsHash: input.detailsHash,
            service,
            rateCode,
            handleSealed: input.handleSealed,
            quotedAmount: input.quotedAmount,
            quotedCurrency: input.quotedCurrency,
            chargeDiffers: writeBool(meta, false) as boolean,
            countHeld: writeBool(meta, false) as boolean,
            reason: input.reason ?? null,
            duplicates: 0,
            createdBy: input.createdBy,
            createdAt: at,
            updatedAt: at,
          })
          .execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        return { ok: false, holder: await repo.open(input, input.mode) };
      }
      return { ok: true, booking: (await repo.byId(id))! };
    },

    /** One step of the state machine, only from the states named. Answers whether this call took it. */
    async move(id: string, from: readonly ShippingBookingState[], to: ShippingBookingState, fields: ShippingBookingFields, at: number): Promise<boolean> {
      const change = { ...packed(fields), state: to, updatedAt: at, ...(SLOT_FREED.includes(to) ? { openKey: null } : {}) };
      const moved = await db.updateTable('adminium_shipping_bookings').set(change).where('id', '=', id).where('state', 'in', [...from]).executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /** A step that changes no state (a look-up's time, a copy made), only while it is still in one of these states. */
    async note(id: string, states: readonly ShippingBookingState[], fields: ShippingBookingFields, at: number): Promise<void> {
      await db.updateTable('adminium_shipping_bookings').set({ ...packed(fields), updatedAt: at }).where('id', '=', id).where('state', 'in', [...states]).execute();
    },

    /**
     * The carrier named this many more labels for the purchase. Only ever
     * raises the count: each is a paid label a person still has to refund, so
     * an answer that names fewer must not make one disappear.
     */
    async raiseDuplicates(id: string, atLeast: number, at: number): Promise<void> {
      if (atLeast <= 0) return;
      await db.updateTable('adminium_shipping_bookings').set({ duplicates: atLeast, updatedAt: at }).where('id', '=', id).where('duplicates', '<', atLeast).execute();
    },

    /** One more paid label for this parcel, counted in the UPDATE so two at once are both counted. */
    async addDuplicate(id: string, states: readonly ShippingBookingState[], at: number): Promise<void> {
      await db
        .updateTable('adminium_shipping_bookings')
        .set((eb) => ({ duplicates: eb('duplicates', '+', 1), updatedAt: at }))
        .where('id', '=', id)
        .where('state', 'in', [...states])
        .execute();
    },

    /**
     * A purchase read as "not bought" turned up after all: it takes its slot
     * back. Answers false if the slot is held, and then it stays as it was.
     */
    async reopenAsBooked(id: string, slot: ShippingBookingSlot, mode: ShippingKeyMode, fields: ShippingBookingFields, at: number): Promise<boolean> {
      try {
        const moved = await db
          .updateTable('adminium_shipping_bookings')
          .set({ ...packed(fields), state: 'booked', openKey: shippingOpenKey(slot, mode), updatedAt: at })
          .where('id', '=', id)
          .where('state', 'in', ['released', 'refused'])
          .executeTakeFirst();
        return affected(moved.numUpdatedRows) > 0;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },

    /** Says this attempt counts against that day. */
    async markCounted(id: string, day: string, at: number): Promise<void> {
      await db.updateTable('adminium_shipping_bookings').set({ countedDay: day, countHeld: writeBool(meta, true) as boolean, updatedAt: at }).where('id', '=', id).execute();
    },

    /** Takes this attempt off the day's count. Answers true for the one call that did. */
    async uncount(id: string, at: number): Promise<boolean> {
      const moved = await db.updateTable('adminium_shipping_bookings').set({ countHeld: writeBool(meta, false) as boolean, updatedAt: at }).where('id', '=', id).where('countHeld', '=', writeBool(meta, true) as boolean).executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /** A label given back turned out to be paid: it counts again. Answers true for the one call that did. */
    async recount(id: string, at: number): Promise<boolean> {
      const moved = await db
        .updateTable('adminium_shipping_bookings')
        .set({ countHeld: writeBool(meta, true) as boolean, updatedAt: at })
        .where('id', '=', id)
        .where('countedDay', 'is not', null)
        .where('countHeld', '=', writeBool(meta, false) as boolean)
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /**
     * A released purchase turned up while a new attempt holds its place: in one
     * transaction the new attempt lets go and the old one takes the place, so
     * no third press can slip in between. Answers false, changing nothing, if
     * either has moved on.
     */
    async takeBackSlot(reservedId: string, ownerId: string, slot: ShippingBookingSlot, mode: ShippingKeyMode, fields: ShippingBookingFields, reason: string, at: number): Promise<boolean> {
      const change = packed(fields);
      try {
        return await db.transaction().execute(async (trx) => {
          const freed = await trx.updateTable('adminium_shipping_bookings').set({ state: 'released', reason, openKey: null, updatedAt: at }).where('id', '=', reservedId).where('state', '=', 'reserved').executeTakeFirst();
          if (affected(freed.numUpdatedRows) === 0) throw new SlotMoved();
          const taken = await trx.updateTable('adminium_shipping_bookings').set({ ...change, state: 'booked', openKey: shippingOpenKey(slot, mode), updatedAt: at }).where('id', '=', ownerId).where('state', '=', 'released').executeTakeFirst();
          if (affected(taken.numUpdatedRows) === 0) throw new SlotMoved();
          return true;
        });
      } catch (error) {
        if (error instanceof SlotMoved || isDuplicateKeyError(error)) return false;
        throw error;
      }
    },

    /** Every attempt on one row, oldest first. */
    async forRow(connectionId: string, tableName: string, rowKey: string): Promise<ShippingBooking[]> {
      const rows = await db
        .selectFrom('adminium_shipping_bookings')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('tableName', '=', tableName)
        .where('rowKey', '=', rowKey)
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(toBooking);
    },

    /** Attempts on this carrier install with no final answer. */
    async unresolved(carrierInstallId: string, limit = 200): Promise<ShippingBooking[]> {
      const rows = await db
        .selectFrom('adminium_shipping_bookings')
        .selectAll()
        .where('carrierInstallId', '=', carrierInstallId)
        .where('state', 'in', [...UNRESOLVED_BOOKING_STATES])
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(toBooking);
    },

    /** Attempts of this app install with no final answer: it cannot be removed while they stand. */
    async unresolvedOfInstall(installId: string, limit = 20): Promise<ShippingBooking[]> {
      const rows = await db
        .selectFrom('adminium_shipping_bookings')
        .selectAll()
        .where('installId', '=', installId)
        .where('state', 'in', [...UNRESOLVED_BOOKING_STATES])
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(toBooking);
    },

    /** Bought labels whose steps after the purchase did not finish, last touched before `before`. */
    async unapplied(before: number, limit = 200): Promise<ShippingBooking[]> {
      const rows = await db
        .selectFrom('adminium_shipping_bookings')
        .selectAll()
        .where('state', '=', 'booked')
        .where('appliedAt', 'is', null)
        .where('updatedAt', '<', before)
        .orderBy('updatedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(toBooking);
    },
  };
  return repo;
}

export type ShippingBookingsRepo = ReturnType<typeof shippingBookingsRepo>;
