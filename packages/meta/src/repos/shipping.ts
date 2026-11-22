// SPDX-License-Identifier: AGPL-3.0-only
/**
 * shippingRepo — adminium_shipping_settings and adminium_shipping_quotes
 * (0103): what one app install chose, and the quotes it was given.
 *
 * The JSON here (Ship from, the rates) is handed back as read, typed `unknown`:
 * the engine parses each with its schema before believing it.
 */
import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  SHIPPING_CARRIER_WIDTH,
  SHIPPING_HASH_WIDTH,
  SHIPPING_ID_WIDTH,
  SHIPPING_PURPOSE_WIDTH,
  SHIPPING_ROW_WIDTH,
  SHIPPING_TABLE_WIDTH,
} from '../migrations/0103_shipping.js';
import { affected, isDuplicateKeyError, packJson, readJson, readJsonOrNull } from './util.js';

export { SHIPPING_CARRIER_WIDTH, SHIPPING_HASH_WIDTH, SHIPPING_ID_WIDTH, SHIPPING_PURPOSE_WIDTH, SHIPPING_ROW_WIDTH, SHIPPING_TABLE_WIDTH };

export interface ShippingSettings {
  installId: string;
  activeCarrier: string | null;
  /** As stored; the engine parses it. */
  shipFrom: unknown;
  updatedBy: string | null;
  updatedAt: number;
}

/** One order's place in the quotes: a parcel of a purpose, on a row of a table, of an install. */
export interface ShippingSlot {
  installId: string;
  connectionId: string;
  tableRef: string;
  rowKey: string;
  purpose: string;
  parcelNumber: number;
}

export interface ShippingQuote extends ShippingSlot {
  id: string;
  carrierKey: string;
  detailsHash: string;
  /** As stored; the engine parses it. */
  rates: unknown;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
}

export type NewShippingQuote = Omit<ShippingQuote, 'id' | 'createdAt'>;

function checkSlot(slot: ShippingSlot): void {
  const fits = (value: string, width: number) => value.length > 0 && value.length <= width;
  if (!fits(slot.installId, SHIPPING_ID_WIDTH) || !fits(slot.connectionId, SHIPPING_ID_WIDTH)) throw new Error('A shipping slot has an empty or over-long install or connection id.');
  if (!fits(slot.tableRef, SHIPPING_TABLE_WIDTH) || !fits(slot.rowKey, SHIPPING_ROW_WIDTH)) throw new Error('A shipping slot has an empty or over-long table or row.');
  if (!fits(slot.purpose, SHIPPING_PURPOSE_WIDTH)) throw new Error('A shipping slot has an empty or over-long purpose.');
  if (!Number.isSafeInteger(slot.parcelNumber) || slot.parcelNumber < 1) throw new Error('A shipping slot has a parcel number from 1.');
}

const WRITE_ATTEMPTS = 6;

/** The write met another at the same slot: a duplicate key, or the database choosing one of two to stop. */
function gaveWay(error: unknown): boolean {
  if (isDuplicateKeyError(error)) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === '40P01' || code === '40001' || code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' || code === 'SQLITE_BUSY';
}

export function shippingRepo(meta: MetaDb) {
  const { db } = meta;

  /**
   * Update first, so a save of one field never writes over another that a
   * second person saved a moment ago. MySQL reports 0 rows for an update that
   * changed nothing, so a row that is there is met by the insert's duplicate
   * key and the update runs once more.
   */
  async function writeSettings(installId: string, fields: { activeCarrier?: string | null; shipFrom?: string | null }, by: string | null, at: number): Promise<void> {
    const change = { ...fields, updatedBy: by, updatedAt: at };
    const updated = await db.updateTable('adminium_shipping_settings').set(change).where('installId', '=', installId).executeTakeFirst();
    if (affected(updated.numUpdatedRows) > 0) return;
    try {
      await db
        .insertInto('adminium_shipping_settings')
        .values({ installId, activeCarrier: fields.activeCarrier ?? null, shipFrom: fields.shipFrom ?? null, updatedBy: by, updatedAt: at })
        .execute();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      await db.updateTable('adminium_shipping_settings').set(change).where('installId', '=', installId).execute();
    }
  }

  return {
    async settings(installId: string): Promise<ShippingSettings | null> {
      const row = await db.selectFrom('adminium_shipping_settings').selectAll().where('installId', '=', installId).executeTakeFirst();
      if (row === undefined) return null;
      return { installId: row.installId, activeCarrier: row.activeCarrier, shipFrom: readJsonOrNull(row.shipFrom), updatedBy: row.updatedBy, updatedAt: Number(row.updatedAt) };
    },

    async setActiveCarrier(installId: string, carrier: string, by: string | null, at: number): Promise<void> {
      if (carrier.length === 0 || carrier.length > SHIPPING_CARRIER_WIDTH) throw new Error('A carrier key is empty or longer than its column.');
      await writeSettings(installId, { activeCarrier: carrier }, by, at);
    },

    async setShipFrom(installId: string, shipFrom: unknown, by: string | null, at: number): Promise<void> {
      await writeSettings(installId, { shipFrom: packJson(shipFrom) }, by, at);
    },

    /**
     * The slot's one quote, in one transaction: the old one goes as the new one
     * arrives, and whatever has expired anywhere goes with it. Two quotes at
     * once for one slot both end with one row, the later one's.
     */
    async replaceQuote(input: NewShippingQuote, at: number): Promise<ShippingQuote> {
      checkSlot(input);
      if (input.carrierKey.length === 0 || input.carrierKey.length > SHIPPING_CARRIER_WIDTH) throw new Error('A carrier key is empty or longer than its column.');
      if (input.detailsHash.length !== SHIPPING_HASH_WIDTH) throw new Error('A quote holds a full details hash.');
      const quote: ShippingQuote = { ...input, id: newId('shq'), createdAt: at };
      const write = () =>
        db.transaction().execute(async (trx) => {
          await trx.deleteFrom('adminium_shipping_quotes').where('expiresAt', '<=', at).execute();
          await trx
            .deleteFrom('adminium_shipping_quotes')
            .where('installId', '=', input.installId)
            .where('connectionId', '=', input.connectionId)
            .where('tableRef', '=', input.tableRef)
            .where('rowKey', '=', input.rowKey)
            .where('purpose', '=', input.purpose)
            .where('parcelNumber', '=', input.parcelNumber)
            .execute();
          await trx
            .insertInto('adminium_shipping_quotes')
            .values({
              id: quote.id,
              installId: input.installId,
              connectionId: input.connectionId,
              tableRef: input.tableRef,
              rowKey: input.rowKey,
              purpose: input.purpose,
              parcelNumber: input.parcelNumber,
              carrierKey: input.carrierKey,
              detailsHash: input.detailsHash,
              rates: packJson(input.rates),
              createdBy: input.createdBy,
              createdAt: at,
              expiresAt: input.expiresAt,
            })
            .execute();
        });
      // Two quotes at once for a slot with no row yet lock the same gap on MySQL, so one is told to give way. It writes again and is the later.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await write();
          return quote;
        } catch (error) {
          if (attempt >= WRITE_ATTEMPTS || !gaveWay(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 15 + Math.random() * 25));
        }
      }
    },

    async quote(id: string): Promise<ShippingQuote | null> {
      const row = await db.selectFrom('adminium_shipping_quotes').selectAll().where('id', '=', id).executeTakeFirst();
      if (row === undefined) return null;
      return {
        id: row.id,
        installId: row.installId,
        connectionId: row.connectionId,
        tableRef: row.tableRef,
        rowKey: row.rowKey,
        purpose: row.purpose,
        parcelNumber: Number(row.parcelNumber),
        carrierKey: row.carrierKey,
        detailsHash: row.detailsHash,
        rates: readJson(row.rates),
        createdBy: row.createdBy,
        createdAt: Number(row.createdAt),
        expiresAt: Number(row.expiresAt),
      };
    },

    /** Every quote of an install goes: the address they were given from, or the carrier, changed. Answers how many. */
    async clearQuotes(installId: string): Promise<number> {
      const deleted = await db.deleteFrom('adminium_shipping_quotes').where('installId', '=', installId).executeTakeFirst();
      return affected(deleted.numDeletedRows);
    },

    /** An install is gone: its choice, its Ship from and its quotes go too. */
    async forgetInstall(installId: string): Promise<void> {
      await db.deleteFrom('adminium_shipping_quotes').where('installId', '=', installId).execute();
      await db.deleteFrom('adminium_shipping_settings').where('installId', '=', installId).execute();
    },
  };
}

export type ShippingRepo = ReturnType<typeof shippingRepo>;
