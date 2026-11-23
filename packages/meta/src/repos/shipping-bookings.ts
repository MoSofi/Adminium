// SPDX-License-Identifier: AGPL-3.0-only
/**
 * shippingBookingsRepo — adminium_shipping_bookings (0109): every label a shop
 * has tried to buy, and how each attempt stands.
 *
 *   reserved ──> calling ──> booked
 *      │            ├──────> refused
 *      │            └──────> unknown ──> booked | refused | released
 *      └──> released
 *
 *   booked ──> voiding ──> voided
 *      ^          │
 *      └──────────┘  a refund the carrier refused: the label is live again
 *
 * Every move is one guarded UPDATE, read by its affected rows, so two runs can
 * never both take the same step. `open_key` holds the order's slot while the
 * attempt is live: its unique index is the one-live-booking rule on all three
 * databases, and it is cleared by a refusal, a person's release or a refund
 * that landed.
 */
import { createHash } from 'node:crypto';

import { sql, type Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { SHIPPING_CARRIER_WIDTH, SHIPPING_HASH_WIDTH, SHIPPING_ID_WIDTH, SHIPPING_ROW_WIDTH, SHIPPING_TABLE_WIDTH } from '../migrations/0107_shipping.js';
import { SHIPPING_MONEY_WIDTH } from '../migrations/0108_shipping_keys.js';
import { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_REASON_WIDTH, SHIPPING_URL_WIDTH } from '../migrations/0109_shipping_bookings.js';
import { SHIPPING_LABEL_GONE_WIDTH, SHIPPING_LABEL_SIZE_WIDTH } from '../migrations/0110_shipping_labels.js';
import { SHIPPING_VOID_MESSAGE_WIDTH } from '../migrations/0112_shipping_refunds.js';
import type { AdminiumShippingBookingsTable } from '../schema/tables.js';
import { affected, isDuplicateKeyError, readBool, writeBool } from './util.js';
import type { ShippingKeyMode, ShippingSlot } from './shipping.js';

export { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_LABEL_SIZE_WIDTH, SHIPPING_REASON_WIDTH, SHIPPING_URL_WIDTH, SHIPPING_VOID_MESSAGE_WIDTH };

/** What a stored label file is filed as. */
export const SHIPPING_LABEL_FILE_KIND = 'ship-label';

/** The documents a booking can hold a stored file of. */
export type ShippingDocumentKind = 'label' | 'customs-invoice';

/** Why a booking's files are gone for good: past their keeping time, or their person was erased. */
export type ShippingLabelGoneWhy = 'kept-90' | 'erased';

export const SHIPPING_BOOKING_STATES = ['reserved', 'calling', 'booked', 'refused', 'unknown', 'released', 'voiding', 'voided'] as const;
export type ShippingBookingState = (typeof SHIPPING_BOOKING_STATES)[number];

/** A purchase or a refund with no final answer: the key it was made under cannot change, or nobody could ever hear the answer. */
export const UNRESOLVED_BOOKING_STATES: readonly ShippingBookingState[] = ['reserved', 'calling', 'unknown', 'voiding'];

/** What a carrier last said about a refund. */
export type ShippingVoidState = 'requested' | 'pending' | 'refunded' | 'refused';

/** What a carrier's answer about a refund adds to the booking. */
export interface ShippingVoidAnswer {
  reference?: string | undefined;
  amount?: string | undefined;
  currency?: string | undefined;
  message?: string | undefined;
}

/** The states that give the slot up. */
const SLOT_FREED: readonly ShippingBookingState[] = ['refused', 'released', 'voided'];

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
  /** The stored label file (`adminium_files`), never a carrier's address for it. */
  labelRef: string | null;
  /** The stored customs invoice, when the parcel has one. */
  customsRef: string | null;
  /** The size asked for when it was bought. */
  labelSize: string | null;
  /** The size the stored file really is: `a4`, `a6`, `4x6`, `other`, or null when the file cannot say. */
  labelSizeGot: string | null;
  /** The label's last state after the purchase: delivery, the last tracking event, or a settled refund. */
  labelClockAt: number | null;
  /** Set once its files are deleted for good: nothing may fetch them again. */
  labelGoneAt: number | null;
  labelGoneWhy: ShippingLabelGoneWhy | null;
  /** The carrier's last word on a refund, if one was ever asked for. */
  voidState: ShippingVoidState | null;
  voidBy: string | null;
  /** Written before the carrier is called. */
  voidAskedAt: number | null;
  /** The carrier answered the request at all. Null means it may never have arrived. */
  voidHeardAt: number | null;
  voidSettledAt: number | null;
  voidReference: string | null;
  /** Only what the carrier reported. */
  voidAmount: string | null;
  voidCurrency: string | null;
  voidMessage: string | null;
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
> & { state?: Extract<ShippingBookingState, 'reserved' | 'unknown'>; reason?: string | null; labelSize?: string | null };

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

/**
 * Moves a label's keeping clock forward. Never backwards, so an old event
 * arriving late cannot shorten the time, and never to before the purchase,
 * which is where the clock already stands.
 */
export async function moveLabelClock(db: MetaDb['db'], id: string, at: number): Promise<void> {
  await db
    .updateTable('adminium_shipping_bookings')
    .set({ labelClockAt: at })
    .where('id', '=', id)
    .where('labelGoneAt', 'is', null)
    .where('createdAt', '<=', at)
    .where((eb) => eb.or([eb('labelClockAt', 'is', null), eb('labelClockAt', '<', at)]))
    .execute();
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
      customsRef: row.customsRef ?? null,
      labelSize: row.labelSize ?? null,
      labelSizeGot: row.labelSizeGot ?? null,
      labelClockAt: number(row.labelClockAt),
      labelGoneAt: number(row.labelGoneAt),
      labelGoneWhy: row.labelGoneWhy === 'kept-90' || row.labelGoneWhy === 'erased' ? row.labelGoneWhy : null,
      voidState: row.voidState === 'requested' || row.voidState === 'pending' || row.voidState === 'refunded' || row.voidState === 'refused' ? row.voidState : null,
      voidBy: row.voidBy ?? null,
      voidAskedAt: number(row.voidAskedAt),
      voidHeardAt: number(row.voidHeardAt),
      voidSettledAt: number(row.voidSettledAt),
      voidReference: row.voidReference ?? null,
      voidAmount: row.voidAmount ?? null,
      voidCurrency: row.voidCurrency ?? null,
      voidMessage: row.voidMessage ?? null,
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

  const voidAnswer = (answer: ShippingVoidAnswer) => {
    const fits = (value: string | undefined, width: number) => (value === undefined || value.length > width ? undefined : value);
    const reference = fits(answer.reference, SHIPPING_CARRIER_TEXT_WIDTH);
    const amount = fits(answer.amount, SHIPPING_MONEY_WIDTH);
    const currency = fits(answer.currency, 3);
    const message = answer.message === undefined ? undefined : answer.message.slice(0, SHIPPING_VOID_MESSAGE_WIDTH);
    return {
      ...(reference === undefined ? {} : { voidReference: reference }),
      // An amount and its currency are kept together, or not at all.
      ...(amount === undefined || currency === undefined ? {} : { voidAmount: amount, voidCurrency: currency }),
      ...(message === undefined ? {} : { voidMessage: message }),
    };
  };

  const repo = {
    async byId(id: string): Promise<ShippingBooking | null> {
      const row = await db.selectFrom('adminium_shipping_bookings').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : toBooking(row);
    },

    /** These bookings, in the order asked for. One that is gone is left out. */
    async byIds(ids: readonly string[]): Promise<ShippingBooking[]> {
      if (ids.length === 0) return [];
      const rows = await db.selectFrom('adminium_shipping_bookings').selectAll().where('id', 'in', [...ids]).execute();
      const found = new Map(rows.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = found.get(id);
        return row === undefined ? [] : [toBooking(row)];
      });
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
            labelSize: input.labelSize ?? null,
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

    /**
     * A refund is asked for, written before the carrier is called. From here the
     * label must not be used. Answers true for the one call that took the step.
     */
    async askVoid(id: string, by: string, at: number): Promise<boolean> {
      const moved = await db
        .updateTable('adminium_shipping_bookings')
        .set({ state: 'voiding', voidState: 'requested', voidBy: by, voidAskedAt: at, voidHeardAt: null, voidSettledAt: null, voidReference: null, voidAmount: null, voidCurrency: null, voidMessage: null, updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'booked')
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /** The carrier answered and has not decided yet. */
    async voidHeard(id: string, state: 'requested' | 'pending', answer: ShippingVoidAnswer, at: number): Promise<boolean> {
      const moved = await db
        .updateTable('adminium_shipping_bookings')
        .set({ voidState: state, voidHeardAt: at, ...voidAnswer(answer), updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'voiding')
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /** The refund landed: the place is free, and the label's keeping clock moves to now. */
    async settleVoided(id: string, answer: ShippingVoidAnswer, at: number): Promise<boolean> {
      const moved = await db
        .updateTable('adminium_shipping_bookings')
        .set({ state: 'voided', openKey: null, voidState: 'refunded', voidHeardAt: at, voidSettledAt: at, ...voidAnswer(answer), updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'voiding')
        .executeTakeFirst();
      if (affected(moved.numUpdatedRows) === 0) return false;
      await moveLabelClock(db, id, at);
      return true;
    },

    /**
     * The carrier said no: the label is live again. If a replacement took the
     * place meanwhile, both are paid, and the answer names who holds it so a
     * person can be told.
     */
    async settleVoidRefused(id: string, answer: ShippingVoidAnswer, at: number): Promise<{ moved: boolean; holder: ShippingBooking | null }> {
      const moved = await db
        .updateTable('adminium_shipping_bookings')
        .set({ state: 'booked', voidState: 'refused', voidHeardAt: at, voidSettledAt: at, ...voidAnswer(answer), updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'voiding')
        .executeTakeFirst();
      if (affected(moved.numUpdatedRows) === 0) return { moved: false, holder: null };
      await moveLabelClock(db, id, at);
      const booking = (await repo.byId(id))!;
      if (booking.openKey !== null) return { moved: true, holder: null };
      try {
        await db.updateTable('adminium_shipping_bookings').set({ openKey: shippingOpenKey(booking, booking.mode), updatedAt: at }).where('id', '=', id).where('openKey', 'is', null).execute();
        return { moved: true, holder: null };
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        return { moved: true, holder: await repo.open(booking, booking.mode) };
      }
    },

    /** Someone chose to book a replacement while the refund is pending: this label gives up its place, and stays blocked. */
    async letGoForReplacement(id: string, at: number): Promise<boolean> {
      const moved = await db.updateTable('adminium_shipping_bookings').set({ openKey: null, updatedAt: at }).where('id', '=', id).where('state', '=', 'voiding').where('openKey', 'is not', null).executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
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

    /**
     * A fetched file takes its place on a bought label. Answers false, changing
     * nothing, when the booking has moved on, its files were deleted for good,
     * or another fetch got there first: the caller then removes its copy.
     */
    async storeDocument(id: string, kind: ShippingDocumentKind, fileId: string, sizeGot: string | null, at: number): Promise<boolean> {
      if (fileId.length === 0 || fileId.length > SHIPPING_CARRIER_TEXT_WIDTH) throw new Error('A file id is empty or longer than its column.');
      if (sizeGot !== null && sizeGot.length > SHIPPING_LABEL_SIZE_WIDTH) throw new Error('A label size is longer than its column.');
      const column = kind === 'label' ? 'labelRef' : 'customsRef';
      const moved = await db
        .updateTable('adminium_shipping_bookings')
        .set({ [column]: fileId, ...(kind === 'label' ? { labelSizeGot: sizeGot } : {}), updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'booked')
        .where('labelGoneAt', 'is', null)
        .where(column, 'is', null)
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /** A stored file whose bytes are lost: the booking owes it again. */
    async dropDocument(id: string, kind: ShippingDocumentKind, fileId: string, at: number): Promise<boolean> {
      const column = kind === 'label' ? 'labelRef' : 'customsRef';
      const moved = await db
        .updateTable('adminium_shipping_bookings')
        .set({ [column]: null, ...(kind === 'label' ? { labelSizeGot: null } : {}), updatedAt: at })
        .where('id', '=', id)
        .where(column, '=', fileId)
        .executeTakeFirst();
      return affected(moved.numUpdatedRows) > 0;
    },

    /**
     * The label's last state moved on (delivery, a tracking event, a settled
     * refund): its 90 days count from here.
     */
    async noteLabelClock(id: string, at: number): Promise<void> {
      await moveLabelClock(db, id, at);
    },

    /** Bought labels whose last state is older than `before`, and whose files are not yet gone. In id order. */
    async labelsPast(before: number, limit = 200, afterId?: string): Promise<ShippingBooking[]> {
      let query = db
        .selectFrom('adminium_shipping_bookings')
        .selectAll()
        .where('labelGoneAt', 'is', null)
        .where('carrierShipmentId', 'is not', null)
        .where(sql<number>`coalesce(${sql.ref('labelClockAt')}, ${sql.ref('answeredAt')}, ${sql.ref('createdAt')})`, '<', before);
      if (afterId !== undefined) query = query.where('id', '>', afterId);
      const rows = await query.orderBy('id', 'asc').limit(limit).execute();
      return rows.map(toBooking);
    },

    /**
     * Its files are deleted for good, and nothing may fetch them again. Written
     * BEFORE the bytes go, so a download or a re-fetch cannot slip in between.
     * Answers the file ids it held, for the caller to remove.
     */
    async markLabelGone(id: string, why: ShippingLabelGoneWhy, at: number): Promise<string[]> {
      if (why.length > SHIPPING_LABEL_GONE_WIDTH) throw new Error('A reason is longer than its column.');
      // Gone first: from here no fetch can store a file, so the refs read next are all there will ever be.
      const moved = await db.updateTable('adminium_shipping_bookings').set({ labelGoneAt: at, labelGoneWhy: why, updatedAt: at }).where('id', '=', id).where('labelGoneAt', 'is', null).executeTakeFirst();
      if (affected(moved.numUpdatedRows) === 0) return [];
      const row = await db.selectFrom('adminium_shipping_bookings').select(['labelRef', 'customsRef']).where('id', '=', id).executeTakeFirst();
      await db.updateTable('adminium_shipping_bookings').set({ labelRef: null, customsRef: null, labelSizeGot: null }).where('id', '=', id).execute();
      return [row?.labelRef ?? null, row?.customsRef ?? null].filter((one): one is string => one !== null);
    },

    /** The real tables of this database that have ever had a booking. */
    async tablesOn(connectionId: string): Promise<string[]> {
      const rows = await db.selectFrom('adminium_shipping_bookings').select('tableName').distinct().where('connectionId', '=', connectionId).execute();
      return rows.map((row) => row.tableName);
    },

    /** Every attempt on these rows of one database, by the real table. */
    async ofRows(connectionId: string, tableNames: readonly string[], rowKeys: readonly string[]): Promise<ShippingBooking[]> {
      if (tableNames.length === 0 || rowKeys.length === 0) return [];
      const rows = await db
        .selectFrom('adminium_shipping_bookings')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('tableName', 'in', [...tableNames])
        .where('rowKey', 'in', [...rowKeys])
        .orderBy('id', 'asc')
        .execute();
      return rows.map(toBooking);
    },

    /**
     * Stored label files no booking names, older than `before`: a process that
     * died between storing and recording one, or a removal that failed.
     */
    async orphanLabelFiles(before: number, limit = 100, afterId?: string): Promise<string[]> {
      let query = db
        .selectFrom('adminium_files as f')
        .select('f.id')
        .where('f.kind', '=', SHIPPING_LABEL_FILE_KIND)
        .where('f.createdAt', '<', before);
      if (afterId !== undefined) query = query.where('f.id', '>', afterId);
      const rows = await query
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('adminium_shipping_bookings as b')
                .select('b.id')
                // A booking marked gone no longer holds its files, even if a crash left the refs on it.
                .where('b.labelGoneAt', 'is', null)
                .where((inner) => inner.or([inner('b.labelRef', '=', inner.ref('f.id')), inner('b.customsRef', '=', inner.ref('f.id'))])),
            ),
          ),
        )
        .orderBy('f.id', 'asc')
        .limit(limit)
        .execute();
      return rows.map((row) => row.id);
    },

    /** Labels whose steps after the purchase, or after a refund, did not finish, last touched before `before`. */
    async unapplied(before: number, limit = 200): Promise<ShippingBooking[]> {
      const rows = await db
        .selectFrom('adminium_shipping_bookings')
        .selectAll()
        // A bought label with steps owed, or a refunded one whose steps are still to undo.
        .where((eb) => eb.or([eb.and([eb('state', '=', 'booked'), eb('appliedAt', 'is', null)]), eb.and([eb('state', '=', 'voided'), eb('appliedAt', 'is not', null)])]))
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
