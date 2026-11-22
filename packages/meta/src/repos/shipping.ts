// SPDX-License-Identifier: AGPL-3.0-only
/**
 * shippingRepo — adminium_shipping_settings and adminium_shipping_quotes
 * (0103): what one app install chose, and the quotes it was given; and
 * adminium_shipping_accounts, _limits and _day_labels (0104): what a carrier
 * said of a saved key, and what people who do not manage shipping may spend.
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
import { SHIPPING_CURRENCY_WIDTH, SHIPPING_DAY_WIDTH, SHIPPING_KEY_HINT_WIDTH, SHIPPING_MONEY_WIDTH } from '../migrations/0104_shipping_keys.js';
import { SHIPPING_LABEL_SIZE_WIDTH } from '../migrations/0106_shipping_labels.js';
import { affected, isDuplicateKeyError, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

export { SHIPPING_CARRIER_WIDTH, SHIPPING_CURRENCY_WIDTH, SHIPPING_DAY_WIDTH, SHIPPING_HASH_WIDTH, SHIPPING_ID_WIDTH, SHIPPING_KEY_HINT_WIDTH, SHIPPING_MONEY_WIDTH, SHIPPING_PURPOSE_WIDTH, SHIPPING_ROW_WIDTH, SHIPPING_TABLE_WIDTH };

export interface ShippingSettings {
  installId: string;
  activeCarrier: string | null;
  /** As stored; the engine parses it. */
  shipFrom: unknown;
  /** The label size this shop asks carriers for, or null before anyone chose. */
  labelSize: string | null;
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
  /** The account this was priced under. Null: from before accounts were recorded, so it cannot be bought. */
  accountFingerprint: string | null;
  /** What was weighed and measured, as stored; the engine parses it. */
  parcel: unknown;
  detailsHash: string;
  /** As stored; the engine parses it. */
  rates: unknown;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
}

export type NewShippingQuote = Omit<ShippingQuote, 'id' | 'createdAt' | 'accountFingerprint' | 'parcel'> & { accountFingerprint?: string | null; parcel?: unknown };

export type ShippingKeyMode = 'live' | 'test';
export type ShippingAccountState = 'ok' | 'refused';

/** What a carrier said of the key saved for one carrier install. Never the key. */
export interface ShippingAccount {
  carrierInstallId: string;
  mode: ShippingKeyMode;
  /** A keyed hash that names the account. */
  fingerprint: string;
  /** A keyed hash of the saved key, so a key changed some other way reads as unchecked. */
  keyHash: string;
  /** The key's last four characters, or empty for a key too short to show any of. */
  keyHint: string;
  state: ShippingAccountState;
  /** The carriers that answered for the shop's country. */
  carriers: string[];
  checkedBy: string | null;
  checkedAt: number;
}

/** What one app install lets people spend who do not manage shipping. */
export interface ShippingLimits {
  installId: string;
  /** The most one label may cost, as an exact decimal. Null: no limit set, so the owner books. */
  labelLimit: string | null;
  labelCurrency: string | null;
  dailyLabels: number | null;
  packersAbroad: boolean;
  updatedBy: string | null;
  updatedAt: number;
}

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
  async function writeSettings(installId: string, fields: { activeCarrier?: string | null; shipFrom?: string | null; labelSize?: string | null }, by: string | null, at: number): Promise<void> {
    const change = { ...fields, updatedBy: by, updatedAt: at };
    const updated = await db.updateTable('adminium_shipping_settings').set(change).where('installId', '=', installId).executeTakeFirst();
    if (affected(updated.numUpdatedRows) > 0) return;
    try {
      await db
        .insertInto('adminium_shipping_settings')
        .values({ installId, activeCarrier: fields.activeCarrier ?? null, shipFrom: fields.shipFrom ?? null, labelSize: fields.labelSize ?? null, updatedBy: by, updatedAt: at })
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
      return { installId: row.installId, activeCarrier: row.activeCarrier, shipFrom: readJsonOrNull(row.shipFrom), labelSize: row.labelSize ?? null, updatedBy: row.updatedBy, updatedAt: Number(row.updatedAt) };
    },

    async setActiveCarrier(installId: string, carrier: string, by: string | null, at: number): Promise<void> {
      if (carrier.length === 0 || carrier.length > SHIPPING_CARRIER_WIDTH) throw new Error('A carrier key is empty or longer than its column.');
      await writeSettings(installId, { activeCarrier: carrier }, by, at);
    },

    async setShipFrom(installId: string, shipFrom: unknown, by: string | null, at: number): Promise<void> {
      await writeSettings(installId, { shipFrom: packJson(shipFrom) }, by, at);
    },

    /** The label size this shop asks carriers for. */
    async setLabelSize(installId: string, labelSize: string, by: string | null, at: number): Promise<void> {
      if (labelSize.length === 0 || labelSize.length > SHIPPING_LABEL_SIZE_WIDTH) throw new Error('A label size is empty or longer than its column.');
      await writeSettings(installId, { labelSize }, by, at);
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
      if (input.accountFingerprint != null && input.accountFingerprint.length !== SHIPPING_HASH_WIDTH) throw new Error('A quote holds a full account fingerprint.');
      const quote: ShippingQuote = { ...input, accountFingerprint: input.accountFingerprint ?? null, parcel: input.parcel ?? null, id: newId('shq'), createdAt: at };
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
              accountFingerprint: quote.accountFingerprint,
              parcel: quote.parcel === null ? null : packJson(quote.parcel),
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
        accountFingerprint: row.accountFingerprint,
        parcel: readJsonOrNull(row.parcel),
        detailsHash: row.detailsHash,
        rates: readJson(row.rates),
        createdBy: row.createdBy,
        createdAt: Number(row.createdAt),
        expiresAt: Number(row.expiresAt),
      };
    },

    /** A quote that has been bought from: never bought from twice. */
    async deleteQuote(id: string): Promise<void> {
      await db.deleteFrom('adminium_shipping_quotes').where('id', '=', id).execute();
    },

    /** Every quote of an install goes: the address they were given from, or the carrier, changed. Answers how many. */
    async clearQuotes(installId: string): Promise<number> {
      const deleted = await db.deleteFrom('adminium_shipping_quotes').where('installId', '=', installId).executeTakeFirst();
      return affected(deleted.numDeletedRows);
    },

    /** Every quote one carrier gave on one database: the key they were priced under changed. Answers how many. */
    async clearCarrierQuotes(connectionId: string, carrierKey: string): Promise<number> {
      const deleted = await db.deleteFrom('adminium_shipping_quotes').where('connectionId', '=', connectionId).where('carrierKey', '=', carrierKey).executeTakeFirst();
      return affected(deleted.numDeletedRows);
    },

    async account(carrierInstallId: string): Promise<ShippingAccount | null> {
      const row = await db.selectFrom('adminium_shipping_accounts').selectAll().where('carrierInstallId', '=', carrierInstallId).executeTakeFirst();
      if (row === undefined) return null;
      const carriers = readJson(row.carriers);
      return {
        carrierInstallId: row.carrierInstallId,
        // Anything but the two words this code writes reads as the one that spends nothing real.
        mode: row.mode === 'live' ? 'live' : 'test',
        fingerprint: row.fingerprint,
        keyHash: row.keyHash,
        keyHint: row.keyHint,
        state: row.state === 'ok' ? 'ok' : 'refused',
        carriers: Array.isArray(carriers) ? carriers.filter((one): one is string => typeof one === 'string') : [],
        checkedBy: row.checkedBy,
        checkedAt: Number(row.checkedAt),
      };
    },

    async saveAccount(account: ShippingAccount): Promise<void> {
      if (account.keyHash.length !== SHIPPING_HASH_WIDTH || account.fingerprint.length !== SHIPPING_HASH_WIDTH) throw new Error('A shipping account holds full hashes.');
      if (account.keyHint.length > SHIPPING_KEY_HINT_WIDTH) throw new Error('A key hint is at most its last four characters.');
      const { carrierInstallId, carriers, ...rest } = account;
      const fields = { ...rest, carriers: packJson(carriers) };
      const updated = await db.updateTable('adminium_shipping_accounts').set(fields).where('carrierInstallId', '=', carrierInstallId).executeTakeFirst();
      if (affected(updated.numUpdatedRows) > 0) return;
      try {
        await db.insertInto('adminium_shipping_accounts').values({ carrierInstallId, ...fields }).execute();
      } catch (error) {
        // MySQL counts an update that changed nothing as 0 rows, so a row that is there is met here.
        if (!isDuplicateKeyError(error)) throw error;
        await db.updateTable('adminium_shipping_accounts').set(fields).where('carrierInstallId', '=', carrierInstallId).execute();
      }
    },

    async forgetAccount(carrierInstallId: string): Promise<void> {
      await db.deleteFrom('adminium_shipping_accounts').where('carrierInstallId', '=', carrierInstallId).execute();
    },

    async limits(installId: string): Promise<ShippingLimits | null> {
      const row = await db.selectFrom('adminium_shipping_limits').selectAll().where('installId', '=', installId).executeTakeFirst();
      if (row === undefined) return null;
      return {
        installId: row.installId,
        labelLimit: row.labelLimit,
        labelCurrency: row.labelCurrency,
        dailyLabels: row.dailyLabels === null ? null : Number(row.dailyLabels),
        packersAbroad: readBool(row.packersAbroad),
        updatedBy: row.updatedBy,
        updatedAt: Number(row.updatedAt),
      };
    },

    async setLimits(limits: ShippingLimits): Promise<void> {
      if (limits.labelLimit !== null && limits.labelLimit.length > SHIPPING_MONEY_WIDTH) throw new Error('A label limit is longer than its column.');
      if (limits.labelCurrency !== null && limits.labelCurrency.length !== SHIPPING_CURRENCY_WIDTH) throw new Error('A label limit needs a three-letter currency.');
      const { installId, packersAbroad, ...rest } = limits;
      const fields = { ...rest, packersAbroad: writeBool(meta, packersAbroad) as boolean };
      const updated = await db.updateTable('adminium_shipping_limits').set(fields).where('installId', '=', installId).executeTakeFirst();
      if (affected(updated.numUpdatedRows) > 0) return;
      try {
        await db.insertInto('adminium_shipping_limits').values({ installId, ...fields }).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await db.updateTable('adminium_shipping_limits').set(fields).where('installId', '=', installId).execute();
      }
    },

    /** The labels counted against this shop day's limit. */
    async dayLabels(installId: string, day: string): Promise<number> {
      const row = await db.selectFrom('adminium_shipping_day_labels').select('labels').where('installId', '=', installId).where('day', '=', day).executeTakeFirst();
      return row === undefined ? 0 : Number(row.labels);
    },

    /**
     * One more label today, if `cap` leaves room. One conditional write, so
     * two purchases at once never pass the limit together. Answers whether it
     * was counted.
     */
    async reserveDayLabel(installId: string, day: string, cap: number): Promise<boolean> {
      if (day.length !== SHIPPING_DAY_WIDTH) throw new Error('A shop day is YYYY-MM-DD.');
      if (!Number.isSafeInteger(cap) || cap < 1) return false;
      for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
        try {
          const updated = await db
            .updateTable('adminium_shipping_day_labels')
            .set((eb) => ({ labels: eb('labels', '+', 1) }))
            .where('installId', '=', installId)
            .where('day', '=', day)
            .where('labels', '<', cap)
            .executeTakeFirst();
          if (affected(updated.numUpdatedRows) > 0) return true;
          const row = await db.selectFrom('adminium_shipping_day_labels').select('labels').where('installId', '=', installId).where('day', '=', day).executeTakeFirst();
          if (row !== undefined) return false;
          await db.insertInto('adminium_shipping_day_labels').values({ installId, day, labels: 1 }).execute();
          return true;
        } catch (error) {
          if (attempt >= WRITE_ATTEMPTS || !gaveWay(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 15 + Math.random() * 25));
        }
      }
      return false;
    },

    /** A label that turned out to be paid after its count was given back: counted whatever the limit, because it was bought. */
    async addDayLabel(installId: string, day: string): Promise<void> {
      for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
        try {
          const updated = await db.updateTable('adminium_shipping_day_labels').set((eb) => ({ labels: eb('labels', '+', 1) })).where('installId', '=', installId).where('day', '=', day).executeTakeFirst();
          if (affected(updated.numUpdatedRows) > 0) return;
          await db.insertInto('adminium_shipping_day_labels').values({ installId, day, labels: 1 }).execute();
          return;
        } catch (error) {
          if (attempt >= WRITE_ATTEMPTS || !gaveWay(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 15 + Math.random() * 25));
        }
      }
    },

    /** A reserved label that was clearly not bought goes back. Never below none. */
    async releaseDayLabel(installId: string, day: string): Promise<void> {
      await db
        .updateTable('adminium_shipping_day_labels')
        .set((eb) => ({ labels: eb('labels', '-', 1) }))
        .where('installId', '=', installId)
        .where('day', '=', day)
        .where('labels', '>', 0)
        .execute();
    },

    /** An app install is gone: its choice, its Ship from, its quotes, its limits and its count go too. */
    async forgetInstall(installId: string): Promise<void> {
      await db.deleteFrom('adminium_shipping_quotes').where('installId', '=', installId).execute();
      await db.deleteFrom('adminium_shipping_settings').where('installId', '=', installId).execute();
      await db.deleteFrom('adminium_shipping_limits').where('installId', '=', installId).execute();
      await db.deleteFrom('adminium_shipping_day_labels').where('installId', '=', installId).execute();
    },
  };
}

export type ShippingRepo = ReturnType<typeof shippingRepo>;
