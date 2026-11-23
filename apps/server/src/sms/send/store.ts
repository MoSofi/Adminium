// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where deliveries and the day's count are kept: `adminium_text_deliveries`
 * and `adminium_text_send_days`.
 *
 * A store that cannot be read throws, and a job that throws sends nothing.
 *
 * ─── THE TWO GUARANTEES ─────────────────────────────────────────────────────
 *
 * One hand-over at a time: every step is a compare-and-set on `version`, so of
 * two workers holding the same row only one gets past {@link TextSendStore.begin}.
 *
 * The limit holds under concurrency: a slot is one `UPDATE … WHERE used < limit`,
 * which every engine re-checks against the committed row after taking its lock.
 * The row's claim on that slot is written in the same transaction, so a slot
 * can neither be counted twice for one message nor given back twice.
 *
 * One open delivery per message: `open_message_hash` holds the message's hash
 * while a delivery is queued, being handed over or unknown, and is cleared when
 * it ends. Its unique index makes a second open delivery impossible on every
 * engine (each treats NULLs as distinct), whatever two workers do at once.
 *
 * What the source row is owed: `settle_owed_at` is written in the same update
 * as the state, and cleared only once the source row has been told. A failed
 * telling is tried again by the sweep.
 *
 * The row holds no message body and no number, only its keyed hash and a mask.
 */
import { newId, type AddressHash, type MetaDb } from '@adminium/meta';
import { sql, type Kysely, type Updateable } from 'kysely';

import { deliveryMoves, deliveryStatusOf } from '../inbound/delivery.js';
import type { SmsPrice, SmsProviderKey } from '../types.js';
import { readReportTarget } from './job.js';
import { warningAt } from './policy.js';
import { TEXT_DELIVERY_STATES, TEXT_OPEN_STATES, TEXT_UNSETTLED_STATES, type TextDelivery, type TextDeliveryReason, type TextDeliveryState, type TextSendReport } from './types.js';

interface TextDeliveryTable {
  id: string;
  claimHash: string;
  messageHash: string;
  openMessageHash: string | null;
  phoneHash: string | null;
  keyVersion: number | null;
  phoneMasked: string | null;
  textClass: string;
  state: string;
  reason: string | null;
  provider: string | null;
  providerMessageId: string | null;
  providerStatus: string | null;
  providerErrorCode: string | null;
  segments: number | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  estimatedSegments: number;
  encoding: string;
  version: number;
  attempts: number;
  attemptStartedAt: number | null;
  attemptAccount: string | null;
  mayHaveGoneAt: number | null;
  mayHaveGoneAccount: string | null;
  slotDay: string | null;
  stopOwedAt: number | null;
  reportTarget: string | null;
  settleOwedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface JobKeyTable {
  dedupeKey: string | null;
  status: string;
}

interface TextSendDayTable {
  day: string;
  used: number;
  updatedAt: number;
}

interface SendTables {
  adminium_text_deliveries: TextDeliveryTable;
  adminium_text_send_days: TextSendDayTable;
  adminium_jobs: JobKeyTable;
}

export type TextDeliveryInput = Pick<TextDelivery, 'claimHash' | 'messageHash' | 'phone' | 'phoneMasked' | 'textClass' | 'estimatedSegments' | 'encoding' | 'createdAt'> & {
  /** The source row to tell how this ended; null when there is none. */
  reportTarget: TextSendReport | null;
};

/** A claim's row, or `row: null` when another delivery of this message is still open. */
export type TextDeliveryCreated = { row: TextDelivery; created: boolean } | { row: null; created: false };

/** What ending or moving a delivery writes. */
export interface TextSettleFields {
  state: TextDeliveryState;
  reason: TextDeliveryReason | null;
  at: number;
  /** Clears the marker: the try it stood for has an answer. */
  clearMarker?: boolean | undefined;
  mayHaveGone?: { at: number; account: string | null } | undefined;
  provider?: SmsProviderKey | null | undefined;
  stopOwed?: boolean | undefined;
  /** Gives the day's slot back, in the same transaction. Only for a message that certainly did not go. */
  releaseSlot?: boolean | undefined;
}

export interface TextAcceptFields {
  state: 'accepted' | 'provider-failed';
  provider: SmsProviderKey;
  messageId: string;
  status: string | null;
  segments: number | null;
  price: SmsPrice | null;
  at: number;
}

export interface TextReport {
  provider: SmsProviderKey;
  messageId: string;
  /** The provider's own word (`delivery_unconfirmed`, `undelivered`), never a translation of it. */
  status: string;
  errorCode?: string | null | undefined;
  segments?: number | null | undefined;
  price?: SmsPrice | null | undefined;
  at: number;
}

export type TextSlot =
  | { outcome: 'held'; row: TextDelivery; used: number; crossedWarning: boolean }
  | { outcome: 'full'; used: number }
  /** Another worker moved the row: this one does nothing. */
  | { outcome: 'lost' };

export interface TextSendStore {
  /** One row per claim: a second create finds the first. One open delivery per message: a second claim gets `row: null`. */
  create(input: TextDeliveryInput): Promise<TextDeliveryCreated>;
  byId(id: string): Promise<TextDelivery | null>;
  byProviderMessage(provider: SmsProviderKey, messageId: string): Promise<TextDelivery | null>;
  /** Saves the marker. Null means another worker moved the row, and this one must not call the provider. */
  begin(id: string, version: number, marker: { at: number; account: string | null; earlier: { mayHaveGoneAt: number; account: string | null } | null }): Promise<TextDelivery | null>;
  settle(id: string, version: number, fields: TextSettleFields): Promise<TextDelivery | null>;
  /** The provider's id always lands, even when a worker that reclaimed the job already wrote `unknown`. */
  accept(id: string, fields: TextAcceptFields): Promise<TextDelivery | null>;
  stopWritten(id: string, at: number): Promise<void>;
  reserve(id: string, version: number, day: string, limit: number, at: number): Promise<TextSlot>;
  usedOn(day: string): Promise<number>;
  /**
   * Deliveries nothing will come back for. A marker older than `before` becomes
   * `unknown`. A queued or retrying row untouched since `before` with no live job
   * ends too, or it would hold its message's open slot for good.
   */
  settleAbandoned(before: number, at: number): Promise<number>;
  /** Ended deliveries whose source row has not been told yet, oldest first. */
  owedSettlements(limit: number): Promise<TextDelivery[]>;
  /** The source row was told about the end written at `owedAt`. A newer end stays owed. */
  settlementWritten(id: string, owedAt: number): Promise<void>;
  /** A person's answer to an `unknown`. The slot stays used either way. */
  resolveUnknown(id: string, to: 'checked-went' | 'checked-not-sent', at: number): Promise<TextDelivery | null>;
  applyReport(report: TextReport): Promise<TextDelivery | null>;
  /** Removes every delivery of these hashes. */
  eraseFor(hashes: readonly AddressHash[]): Promise<number>;
  /** How many delivery records {@link TextSendStore.eraseFor} would delete. */
  countFor(hashes: readonly AddressHash[]): Promise<number>;
}

const STATE_SET: ReadonlySet<string> = new Set(TEXT_DELIVERY_STATES);
/** Statuses that mean the provider gave up on the message. */
const FAILED_STATUS: ReadonlySet<string> = new Set(['failed', 'undelivered', 'sending_failed', 'delivery_failed', 'canceled']);

export const isFailedStatus = (status: string | null): boolean => status !== null && FAILED_STATUS.has(status);

const orNull = (value: number | string | null): number | null => (value === null ? null : Number(value));

/** Rows looked at in one sweep for a lost job. */
const ABANDONED_BATCH = 200;

/** Owed only by a row with a source to tell. The moment is a clock value, written inline so every engine reads it as a number. */
const owedWhenTargeted = (at: number) => sql<number | null>`case when ${sql.ref('reportTarget')} is null then null else ${sql.lit(at)} end`;

function decode(row: TextDeliveryTable): TextDelivery {
  if (!STATE_SET.has(row.state)) throw new Error('A text delivery holds a state this version cannot read.');
  const version = orNull(row.keyVersion);
  return {
    id: row.id,
    claimHash: row.claimHash,
    messageHash: row.messageHash,
    phone: row.phoneHash !== null && version !== null ? { hash: row.phoneHash, version } : null,
    phoneMasked: row.phoneMasked,
    textClass: row.textClass === 'marketing' ? 'marketing' : 'service',
    state: row.state as TextDeliveryState,
    reason: row.reason as TextDeliveryReason | null,
    provider: row.provider === 'twilio' || row.provider === 'telnyx' ? row.provider : null,
    providerMessageId: row.providerMessageId,
    providerStatus: row.providerStatus,
    providerErrorCode: row.providerErrorCode,
    segments: orNull(row.segments),
    price: row.priceAmount !== null && row.priceCurrency !== null ? { amount: row.priceAmount, currency: row.priceCurrency } : null,
    estimatedSegments: Number(row.estimatedSegments),
    encoding: row.encoding === 'ucs-2' ? 'ucs-2' : 'gsm-7',
    version: Number(row.version),
    attempts: Number(row.attempts),
    attemptStartedAt: orNull(row.attemptStartedAt),
    attemptAccount: row.attemptAccount,
    mayHaveGoneAt: orNull(row.mayHaveGoneAt),
    mayHaveGoneAccount: row.mayHaveGoneAccount,
    slotDay: row.slotDay,
    stopOwedAt: orNull(row.stopOwedAt),
    reportTarget: readReportTarget(row.reportTarget),
    settleOwedAt: orNull(row.settleOwedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

/** Thrown inside a transaction to roll it back; never leaves this file. */
class RollBack extends Error {}

export function createTextSendStore(meta: MetaDb): TextSendStore {
  const db = meta.db as unknown as Kysely<SendTables>;
  const dialect = meta.dialect;

  async function byId(id: string): Promise<TextDelivery | null> {
    const row = await db.selectFrom('adminium_text_deliveries').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decode(row as TextDeliveryTable);
  }

  async function usedOn(day: string): Promise<number> {
    const row = await db.selectFrom('adminium_text_send_days').select('used').where('day', '=', day).executeTakeFirst();
    return row === undefined ? 0 : Number(row.used);
  }

  /** Outside any transaction: on MySQL an insert that finds the key would hold a gap lock across the count. */
  async function ensureDay(day: string, at: number): Promise<void> {
    const insert = db.insertInto('adminium_text_send_days').values({ day, used: 0, updatedAt: at });
    if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ day: sql`day` }).execute();
    else await insert.onConflict((conflict) => conflict.column('day').doNothing()).execute();
  }

  async function settle(id: string, version: number, fields: TextSettleFields): Promise<TextDelivery | null> {
    const before = fields.releaseSlot === true ? await byId(id) : null;
    const day = before?.version === version ? before.slotDay : null;
    const patch: Updateable<TextDeliveryTable> = { state: fields.state, reason: fields.reason, version: version + 1, updatedAt: fields.at };
    if (fields.clearMarker === true) {
      patch.attemptStartedAt = null;
      patch.attemptAccount = null;
    }
    if (fields.mayHaveGone !== undefined) {
      patch.mayHaveGoneAt = fields.mayHaveGone.at;
      patch.mayHaveGoneAccount = fields.mayHaveGone.account;
    }
    if (fields.provider !== undefined) patch.provider = fields.provider;
    if (fields.stopOwed === true) patch.stopOwedAt = fields.at;
    if (day !== null) patch.slotDay = null;
    if (!TEXT_UNSETTLED_STATES.includes(fields.state)) patch.openMessageHash = null;
    const moved = await db.transaction().execute(async (trx) => {
      let update = trx.updateTable('adminium_text_deliveries').set(patch);
      if (!TEXT_OPEN_STATES.includes(fields.state)) update = update.set({ settleOwedAt: owedWhenTargeted(fields.at) });
      const result = await update.where('id', '=', id).where('version', '=', version).executeTakeFirst();
      if (Number(result.numUpdatedRows) !== 1) return false;
      if (day !== null) {
        await trx.updateTable('adminium_text_send_days').set((eb) => ({ used: eb('used', '-', 1), updatedAt: fields.at })).where('day', '=', day).where('used', '>', 0).execute();
      }
      return true;
    });
    return moved ? byId(id) : null;
  }

  /** Whether a job that can still run holds this delivery, under its plain key or a window's. */
  async function hasLiveJob(id: string): Promise<boolean> {
    const key = `sms.send:${id}`;
    const row = await db
      .selectFrom('adminium_jobs')
      .select('status')
      .where('status', 'in', ['pending', 'running'])
      .where((eb) => eb.or([eb('dedupeKey', '=', key), eb('dedupeKey', 'like', `${key}:%`)]))
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  return {
    byId,
    usedOn,

    async create(input) {
      const id = newId('tdl');
      const row: TextDeliveryTable = {
        id,
        claimHash: input.claimHash,
        messageHash: input.messageHash,
        openMessageHash: input.messageHash,
        phoneHash: input.phone?.hash ?? null,
        keyVersion: input.phone?.version ?? null,
        phoneMasked: input.phoneMasked,
        textClass: input.textClass,
        state: 'prepared',
        reason: null,
        provider: null,
        providerMessageId: null,
        providerStatus: null,
        providerErrorCode: null,
        segments: null,
        priceAmount: null,
        priceCurrency: null,
        estimatedSegments: input.estimatedSegments,
        encoding: input.encoding,
        version: 1,
        attempts: 0,
        attemptStartedAt: null,
        attemptAccount: null,
        mayHaveGoneAt: null,
        mayHaveGoneAccount: null,
        slotDay: null,
        stopOwedAt: null,
        reportTarget: input.reportTarget === null ? null : JSON.stringify(input.reportTarget),
        settleOwedAt: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      const insert = db.insertInto('adminium_text_deliveries').values(row);
      // Either unique key may refuse it: this claim is already here, or the message has another open delivery.
      if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
      else await insert.onConflict((conflict) => conflict.doNothing()).execute();
      const found = await db.selectFrom('adminium_text_deliveries').selectAll().where('claimHash', '=', input.claimHash).executeTakeFirst();
      if (found === undefined) return { row: null, created: false };
      return { row: decode(found as TextDeliveryTable), created: found.id === id };
    },

    async byProviderMessage(provider, messageId) {
      const row = await db.selectFrom('adminium_text_deliveries').selectAll().where('provider', '=', provider).where('providerMessageId', '=', messageId).executeTakeFirst();
      return row === undefined ? null : decode(row as TextDeliveryTable);
    },

    async begin(id, version, marker) {
      const result = await db
        .updateTable('adminium_text_deliveries')
        .set((eb) => ({
          state: 'handing-over',
          attemptStartedAt: marker.at,
          attemptAccount: marker.account,
          mayHaveGoneAt: marker.earlier?.mayHaveGoneAt ?? null,
          mayHaveGoneAccount: marker.earlier?.account ?? null,
          attempts: eb('attempts', '+', 1),
          version: version + 1,
          updatedAt: marker.at,
        }))
        .where('id', '=', id)
        .where('version', '=', version)
        .where('state', 'in', ['prepared', 'retrying', 'handing-over'])
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1 ? byId(id) : null;
    },

    settle,

    async accept(id, fields) {
      const result = await db
        .updateTable('adminium_text_deliveries')
        .set((eb) => ({
          state: fields.state,
          reason: null,
          provider: fields.provider,
          providerMessageId: fields.messageId,
          providerStatus: fields.status,
          openMessageHash: null,
          settleOwedAt: owedWhenTargeted(fields.at),
          segments: fields.segments,
          priceAmount: fields.price?.amount ?? null,
          priceCurrency: fields.price?.currency ?? null,
          attemptStartedAt: null,
          attemptAccount: null,
          version: eb('version', '+', 1),
          updatedAt: fields.at,
        }))
        .where('id', '=', id)
        .where('state', 'in', ['prepared', 'retrying', 'handing-over', 'unknown'])
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1 ? byId(id) : null;
    },

    async stopWritten(id, at) {
      await db.updateTable('adminium_text_deliveries').set({ stopOwedAt: null, updatedAt: at }).where('id', '=', id).execute();
    },

    async reserve(id, version, day, limit, at) {
      await ensureDay(day, at);
      let used = 0;
      try {
        const moved = await db.transaction().execute(async (trx) => {
          const claim = await trx
            .updateTable('adminium_text_deliveries')
            .set({ slotDay: day, version: version + 1, updatedAt: at })
            .where('id', '=', id)
            .where('version', '=', version)
            .where('slotDay', 'is', null)
            .executeTakeFirst();
          if (Number(claim.numUpdatedRows) !== 1) return false;
          const counted = await trx
            .updateTable('adminium_text_send_days')
            .set((eb) => ({ used: eb('used', '+', 1), updatedAt: at }))
            .where('day', '=', day)
            .where('used', '<', limit)
            .executeTakeFirst();
          if (Number(counted.numUpdatedRows) !== 1) throw new RollBack();
          const row = await trx.selectFrom('adminium_text_send_days').select('used').where('day', '=', day).executeTakeFirstOrThrow();
          used = Number(row.used);
          return true;
        });
        if (!moved) return { outcome: 'lost' };
      } catch (error) {
        if (error instanceof RollBack) return { outcome: 'full', used: await usedOn(day) };
        throw error;
      }
      const row = await byId(id);
      if (row === null) return { outcome: 'lost' };
      const line = warningAt(limit);
      return { outcome: 'held', row, used, crossedWarning: used >= line && used - 1 < line };
    },

    async settleAbandoned(before, at) {
      const marked = await db
        .updateTable('adminium_text_deliveries')
        .set((eb) => ({
          state: 'unknown',
          reason: 'earlier-attempt-unknown',
          mayHaveGoneAt: eb.fn.coalesce('mayHaveGoneAt', 'attemptStartedAt'),
          mayHaveGoneAccount: eb.fn.coalesce('mayHaveGoneAccount', 'attemptAccount'),
          attemptStartedAt: null,
          attemptAccount: null,
          settleOwedAt: owedWhenTargeted(at),
          version: eb('version', '+', 1),
          updatedAt: at,
        }))
        .where('state', '=', 'handing-over')
        .where('attemptStartedAt', '<', before)
        .executeTakeFirst();
      let ended = Number(marked.numUpdatedRows);
      const idle = await db.selectFrom('adminium_text_deliveries').selectAll().where('state', 'in', ['prepared', 'retrying']).where('updatedAt', '<', before).orderBy('updatedAt', 'asc').limit(ABANDONED_BATCH).execute();
      for (const raw of idle) {
        const row = decode(raw as TextDeliveryTable);
        if (await hasLiveJob(row.id)) continue;
        const done = await settle(
          row.id,
          row.version,
          row.mayHaveGoneAt === null
            ? { state: 'not-sent', reason: 'could-not-queue', at, clearMarker: true, releaseSlot: true }
            : { state: 'unknown', reason: 'earlier-attempt-unknown', at, clearMarker: true },
        );
        if (done !== null) ended += 1;
      }
      return ended;
    },

    async owedSettlements(limit) {
      const rows = await db.selectFrom('adminium_text_deliveries').selectAll().where('settleOwedAt', 'is not', null).where('reportTarget', 'is not', null).orderBy('settleOwedAt', 'asc').limit(limit).execute();
      return rows.map((row) => decode(row as TextDeliveryTable));
    },

    async settlementWritten(id, owedAt) {
      await db.updateTable('adminium_text_deliveries').set({ settleOwedAt: null }).where('id', '=', id).where('settleOwedAt', '=', owedAt).execute();
    },

    async resolveUnknown(id, to, at) {
      const result = await db
        .updateTable('adminium_text_deliveries')
        .set((eb) => ({ state: to, openMessageHash: null, settleOwedAt: owedWhenTargeted(at), version: eb('version', '+', 1), updatedAt: at }))
        .where('id', '=', id)
        .where('state', '=', 'unknown')
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1 ? byId(id) : null;
    },

    async applyReport(report) {
      for (let turn = 0; turn < 4; turn += 1) {
        const row = await db.selectFrom('adminium_text_deliveries').selectAll().where('provider', '=', report.provider).where('providerMessageId', '=', report.messageId).executeTakeFirst();
        if (row === undefined) return null;
        const current = decode(row as TextDeliveryTable);
        const incoming = deliveryStatusOf(report.provider, report.status);
        const held = deliveryStatusOf(report.provider, current.providerStatus);
        // A report out of order, or a word nobody listed, moves nothing.
        if (incoming === null || (held !== null && !deliveryMoves(held, incoming))) return current;
        const state = isFailedStatus(report.status) ? 'provider-failed' : 'accepted';
        const patch: Updateable<TextDeliveryTable> = {
          providerStatus: report.status,
          state,
          openMessageHash: null,
          version: current.version + 1,
          updatedAt: report.at,
        };
        if (report.errorCode !== undefined && report.errorCode !== null) patch.providerErrorCode = report.errorCode;
        if (report.segments !== undefined && report.segments !== null) patch.segments = report.segments;
        if (report.price !== undefined && report.price !== null) {
          patch.priceAmount = report.price.amount;
          patch.priceCurrency = report.price.currency;
        }
        let update = db.updateTable('adminium_text_deliveries').set(patch);
        // Only a change of state is news to the source row: sent to delivered is not.
        if (state !== current.state) update = update.set({ settleOwedAt: owedWhenTargeted(report.at) });
        const result = await update.where('id', '=', current.id).where('version', '=', current.version).executeTakeFirst();
        if (Number(result.numUpdatedRows) === 1) return byId(current.id);
      }
      return null;
    },

    async eraseFor(hashes) {
      if (hashes.length === 0) return 0;
      const result = await db
        .deleteFrom('adminium_text_deliveries')
        .where((eb) => eb.or(hashes.map((one) => eb.and([eb('phoneHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async countFor(hashes) {
      if (hashes.length === 0) return 0;
      const row = await db
        .selectFrom('adminium_text_deliveries')
        .select((eb) => eb.fn.countAll<number | string>().as('count'))
        .where((eb) => eb.or(hashes.map((one) => eb.and([eb('phoneHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },
  };
}
