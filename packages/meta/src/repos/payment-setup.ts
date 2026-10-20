// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The payments set-up repos (migration 0061, plan 70): pay links, payable
 * profiles, ways to pay, the small settings documents and the card-testing
 * counters. The rows money depends on are in `payments.ts`.
 *
 * ─── One current link per payable ──────────────────────────────────────────
 *
 * A link's `current_key` is its payable's key while it is the current link,
 * NULL otherwise, under a unique index. `mint` retires the previous current
 * link before inserting the new one; a concurrent mint that loses the race
 * gets a duplicate and tries once more.
 *
 * ─── A profile's mapping is parsed, never cast ─────────────────────────────
 *
 * The mapping is a JSON column an older build may have written, so it is read
 * through `payableMappingSchema`. A profile whose mapping no longer parses is
 * returned with `mapping: null`, and the payable it describes is not payable
 * until someone saves it again.
 */

import type { Insertable, Selectable } from 'kysely';
import { z } from 'zod';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumPayableProfilesTable, AdminiumPaymentLinksTable, AdminiumPaymentMethodsTable } from '../schema/tables.js';
import { payableKeyOf, type PayableKind, type PayableRef } from './payments.js';
import { affected, isDuplicateKeyError, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

// ─── Links ──────────────────────────────────────────────────────────────────

export interface PaymentLink {
  id: string;
  tokenHash: string;
  tokenSealed: string;
  payable: PayableRef;
  mode: 'test' | 'live';
  current: boolean;
  expiresAt: number;
  revokedAt: number | null;
  createdBy: string | null;
  createdAt: number;
}

export interface MintLinkInput {
  tokenHash: string;
  tokenSealed: string;
  payable: PayableRef;
  mode: 'test' | 'live';
  expiresAt: number;
  createdBy: string | null;
}

function decodeLink(row: Selectable<AdminiumPaymentLinksTable>): PaymentLink {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    tokenSealed: row.tokenSealed,
    payable: { kind: row.payableKind as PayableKind, connectionId: row.connectionId, tableName: row.tableName, rowKey: row.rowKey },
    mode: row.mode as 'test' | 'live',
    current: row.currentKey !== null,
    expiresAt: Number(row.expiresAt),
    revokedAt: row.revokedAt === null ? null : Number(row.revokedAt),
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
  };
}

export function paymentLinksRepo(meta: MetaDb) {
  const { db } = meta;

  async function retire(payable: PayableRef): Promise<number> {
    const res = await db
      .updateTable('adminium_payment_links')
      .set({ currentKey: null })
      .where('currentKey', '=', payableKeyOf(payable))
      .executeTakeFirst();
    return affected(res.numUpdatedRows);
  }

  return {
    /**
     * Makes a payable's new current link, retiring the one before it. Returns
     * the link and whether an older one was replaced (the panel says so).
     */
    async mint(input: MintLinkInput, at: number = Date.now()): Promise<{ link: PaymentLink; replaced: boolean }> {
      const row: Selectable<AdminiumPaymentLinksTable> = {
        id: newId('plk'),
        tokenHash: input.tokenHash,
        tokenSealed: input.tokenSealed,
        payableKind: input.payable.kind,
        connectionId: input.payable.connectionId,
        tableName: input.payable.tableName,
        rowKey: input.payable.rowKey,
        mode: input.mode,
        currentKey: payableKeyOf(input.payable),
        expiresAt: input.expiresAt,
        revokedAt: null,
        createdBy: input.createdBy,
        createdAt: at,
      };
      let replaced = (await retire(input.payable)) > 0;
      try {
        await db.insertInto('adminium_payment_links').values(row).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        // Another mint for the same payable landed between the retire and the insert: retire it too.
        replaced = (await retire(input.payable)) > 0 || replaced;
        await db.insertInto('adminium_payment_links').values(row).execute();
      }
      return { link: decodeLink(row), replaced };
    },

    async byHash(tokenHash: string): Promise<PaymentLink | null> {
      const row = await db.selectFrom('adminium_payment_links').selectAll().where('tokenHash', '=', tokenHash).executeTakeFirst();
      return row === undefined ? null : decodeLink(row);
    },

    async byId(id: string): Promise<PaymentLink | null> {
      const row = await db.selectFrom('adminium_payment_links').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decodeLink(row);
    },

    async currentFor(payable: PayableRef): Promise<PaymentLink | null> {
      const row = await db
        .selectFrom('adminium_payment_links')
        .selectAll()
        .where('currentKey', '=', payableKeyOf(payable))
        .executeTakeFirst();
      return row === undefined ? null : decodeLink(row);
    },

    /** Revokes a link. It stops being current at once. */
    async revoke(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_payment_links')
        .set({ revokedAt: at, currentKey: null })
        .where('id', '=', id)
        .where('revokedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Ends a payable's current link (it was paid, voided, deleted or removed with sample data). */
    retire,
  };
}

export type PaymentLinksRepo = ReturnType<typeof paymentLinksRepo>;

// ─── Payable profiles ───────────────────────────────────────────────────────

const column = z.string().min(1).max(255);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/** How a payment lands in a table's OWN payments table: column by column, with a unique reference. */
export const ownPaymentsMappingSchema = z
  .object({
    kind: z.literal('table'),
    table: column,
    /** The column naming the payable's row. */
    link: column,
    amount: column,
    date: column,
    method: z.object({ column, values: z.record(z.string().min(1).max(64), z.string().min(1).max(255)) }).strict(),
    note: column.nullable(),
    voided: column.nullable(),
    /** Unique for each payment: Adminium writes the attempt id here, so a payment is never written twice. */
    reference: column,
  })
  .strict();

export const payableMappingSchema = z
  .object({
    /** The column the record is known by on the pay page and in staff lists ("Order no."). */
    label: column.nullable(),
    amount: z.object({ column, unit: z.enum(['units', 'minor']).nullable() }).strict(),
    currency: z.union([
      z.object({ column }).strict(),
      z.object({ fixed: currencyCode }).strict(),
      z.object({ connection: z.literal(true) }).strict(),
    ]),
    /** A balance column, or null when the due is computed (amount − payments Adminium holds). */
    due: z.object({ column }).strict().nullable(),
    payments: z.union([z.object({ kind: z.literal('kept') }).strict(), ownPaymentsMappingSchema]),
    status: z.object({ column, paid: z.string().min(1).max(255), refunded: z.string().min(1).max(255).nullable() }).strict().nullable(),
    customerEmail: column.nullable(),
    customerCountry: column.nullable(),
    /** The only columns the pay page may show. */
    pageFields: z.array(column).max(50),
  })
  .strict();

export type PayableMapping = z.infer<typeof payableMappingSchema>;
export type OwnPaymentsMapping = z.infer<typeof ownPaymentsMappingSchema>;

export interface PayableProfile {
  id: string;
  connectionId: string;
  tableName: string;
  /** Null when the stored mapping no longer parses: the table is not payable until saved again. */
  mapping: PayableMapping | null;
  ownerApp: string | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

function decodeProfile(row: Selectable<AdminiumPayableProfilesTable>): PayableProfile {
  const parsed = payableMappingSchema.safeParse(readJson(row.mapping));
  return {
    id: row.id,
    connectionId: row.connectionId,
    tableName: row.tableName,
    mapping: parsed.success ? parsed.data : null,
    ownerApp: row.ownerApp,
    enabled: readBool(row.enabled),
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function payableProfilesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Marks a table payable. Null when it already is (one profile per table). */
    async create(
      input: { connectionId: string; tableName: string; mapping: PayableMapping; ownerApp: string | null; createdBy: string | null },
      at: number = Date.now(),
    ): Promise<PayableProfile | null> {
      const row: Insertable<AdminiumPayableProfilesTable> = {
        id: newId('ppf'),
        connectionId: input.connectionId,
        tableName: input.tableName,
        mapping: packJson(payableMappingSchema.parse(input.mapping)),
        ownerApp: input.ownerApp,
        enabled: writeBool(meta, true),
        createdBy: input.createdBy,
        createdAt: at,
        updatedAt: at,
      };
      try {
        await db.insertInto('adminium_payable_profiles').values(row).execute();
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
      return decodeProfile(row as unknown as Selectable<AdminiumPayableProfilesTable>);
    },

    async byTable(connectionId: string, tableName: string): Promise<PayableProfile | null> {
      const row = await db
        .selectFrom('adminium_payable_profiles')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('tableName', '=', tableName)
        .executeTakeFirst();
      return row === undefined ? null : decodeProfile(row);
    },

    async byId(id: string): Promise<PayableProfile | null> {
      const row = await db.selectFrom('adminium_payable_profiles').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decodeProfile(row);
    },

    async list(connectionId?: string): Promise<PayableProfile[]> {
      let query = db.selectFrom('adminium_payable_profiles').selectAll();
      if (connectionId !== undefined) query = query.where('connectionId', '=', connectionId);
      const rows = await query.orderBy('tableName', 'asc').execute();
      return rows.map(decodeProfile);
    },

    async update(id: string, patch: { mapping?: PayableMapping; enabled?: boolean }, at: number = Date.now()): Promise<boolean> {
      const set: Record<string, unknown> = { updatedAt: at };
      if (patch.mapping !== undefined) set['mapping'] = packJson(payableMappingSchema.parse(patch.mapping));
      if (patch.enabled !== undefined) set['enabled'] = writeBool(meta, patch.enabled);
      const res = await db.updateTable('adminium_payable_profiles').set(set).where('id', '=', id).executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async remove(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_payable_profiles').where('id', '=', id).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n) === 1;
    },
  };
}

export type PayableProfilesRepo = ReturnType<typeof payableProfilesRepo>;

// ─── Ways to pay ────────────────────────────────────────────────────────────

/** Per-market rules every way to pay can carry. Empty lists mean "any". */
export const paymentRulesSchema = z
  .object({
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
    currencies: z.array(currencyCode).max(200),
    min: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
    max: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
    /** Which payables it is offered for: profile ids, `shape`, `document`; empty means all. */
    onlyFor: z.array(z.string().min(1).max(64)).max(100),
  })
  .strict();

export type PaymentRules = z.infer<typeof paymentRulesSchema>;

export const NO_RULES: PaymentRules = { countries: [], currencies: [], min: null, max: null, onlyFor: [] };

export interface PaymentMethodRow {
  id: string;
  source: string;
  method: string;
  label: Record<string, string> | null;
  enabled: boolean;
  rules: PaymentRules;
  details: unknown;
  position: number;
  createdAt: number;
  updatedAt: number;
}

function decodeMethod(row: Selectable<AdminiumPaymentMethodsTable>): PaymentMethodRow {
  const rules = paymentRulesSchema.safeParse(readJson(row.rules));
  return {
    id: row.id,
    source: row.source,
    method: row.method,
    label: readJsonOrNull<Record<string, string>>(row.label),
    enabled: readBool(row.enabled),
    // Rules that no longer parse offer the way nowhere rather than everywhere.
    rules: rules.success ? rules.data : { ...NO_RULES, countries: ['--'] },
    details: readJsonOrNull(row.details),
    position: Number(row.position),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function paymentMethodsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async list(): Promise<PaymentMethodRow[]> {
      const rows = await db.selectFrom('adminium_payment_methods').selectAll().orderBy('position', 'asc').orderBy('method', 'asc').execute();
      return rows.map(decodeMethod);
    },

    async find(source: string, method: string): Promise<PaymentMethodRow | null> {
      const row = await db
        .selectFrom('adminium_payment_methods')
        .selectAll()
        .where('source', '=', source)
        .where('method', '=', method)
        .executeTakeFirst();
      return row === undefined ? null : decodeMethod(row);
    },

    /** Creates or replaces one way to pay, by (source, method). */
    async put(
      input: { source: string; method: string; label: Record<string, string> | null; enabled: boolean; rules: PaymentRules; details: unknown; position: number },
      at: number = Date.now(),
    ): Promise<PaymentMethodRow> {
      const values = {
        label: input.label === null ? null : packJson(input.label),
        enabled: writeBool(meta, input.enabled),
        rules: packJson(paymentRulesSchema.parse(input.rules)),
        details: input.details === null || input.details === undefined ? null : packJson(input.details),
        position: input.position,
        updatedAt: at,
      };
      const res = await db
        .updateTable('adminium_payment_methods')
        .set(values)
        .where('source', '=', input.source)
        .where('method', '=', input.method)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) {
        try {
          await db
            .insertInto('adminium_payment_methods')
            .values({ id: newId('pmt'), source: input.source, method: input.method, createdAt: at, ...values })
            .execute();
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          await db.updateTable('adminium_payment_methods').set(values).where('source', '=', input.source).where('method', '=', input.method).execute();
        }
      }
      const found = await this.find(input.source, input.method);
      if (found === null) throw new Error('A way to pay vanished while it was saved.');
      return found;
    },

    async remove(source: string, method: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_payment_methods').where('source', '=', source).where('method', '=', method).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n) === 1;
    },
  };
}

export type PaymentMethodsRepo = ReturnType<typeof paymentMethodsRepo>;

// ─── Settings documents ─────────────────────────────────────────────────────

export function paymentSettingsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** A document by name, parsed with its schema. Null when absent or no longer of that shape. */
    async get<T>(name: string, schema: z.ZodType<T>): Promise<T | null> {
      const row = await db.selectFrom('adminium_payment_settings').select('value').where('name', '=', name).executeTakeFirst();
      if (row === undefined) return null;
      const parsed = schema.safeParse(readJson(row.value));
      return parsed.success ? parsed.data : null;
    },

    async set<T>(name: string, schema: z.ZodType<T>, value: T, at: number = Date.now()): Promise<void> {
      const packed = packJson(schema.parse(value));
      const res = await db
        .updateTable('adminium_payment_settings')
        .set({ value: packed, updatedAt: at })
        .where('name', '=', name)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) > 0) return;
      try {
        await db.insertInto('adminium_payment_settings').values({ name, value: packed, updatedAt: at }).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await db.updateTable('adminium_payment_settings').set({ value: packed, updatedAt: at }).where('name', '=', name).execute();
      }
    },

    async remove(name: string): Promise<void> {
      await db.deleteFrom('adminium_payment_settings').where('name', '=', name).execute();
    },
  };
}

export type PaymentSettingsRepo = ReturnType<typeof paymentSettingsRepo>;

// ─── Counters ───────────────────────────────────────────────────────────────

export const COUNTER_WINDOW_MS = 3_600_000;

export function paymentCountersRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /**
     * Counts one hit in `bucket`'s current hour and returns the new count.
     * Kept in meta, not in process memory, so every process and every
     * restart sees the same count.
     */
    async hit(bucket: string, at: number = Date.now()): Promise<number> {
      const windowStart = Math.floor(at / COUNTER_WINDOW_MS) * COUNTER_WINDOW_MS;
      for (let tries = 0; tries < 3; tries += 1) {
        const current = await db
          .selectFrom('adminium_payment_counters')
          .select('hits')
          .where('bucket', '=', bucket)
          .where('windowStart', '=', windowStart)
          .executeTakeFirst();
        if (current === undefined) {
          try {
            await db.insertInto('adminium_payment_counters').values({ bucket, windowStart, hits: 1 }).execute();
            return 1;
          } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
            continue;
          }
        }
        const next = Number(current.hits) + 1;
        const res = await db
          .updateTable('adminium_payment_counters')
          .set({ hits: next })
          .where('bucket', '=', bucket)
          .where('windowStart', '=', windowStart)
          .where('hits', '=', Number(current.hits))
          .executeTakeFirst();
        if (affected(res.numUpdatedRows) === 1) return next;
      }
      throw new Error(`The counter "${bucket}" kept changing under three tries.`);
    },

    /** The count in `bucket`'s current hour. */
    async read(bucket: string, at: number = Date.now()): Promise<number> {
      const windowStart = Math.floor(at / COUNTER_WINDOW_MS) * COUNTER_WINDOW_MS;
      const row = await db
        .selectFrom('adminium_payment_counters')
        .select('hits')
        .where('bucket', '=', bucket)
        .where('windowStart', '=', windowStart)
        .executeTakeFirst();
      return row === undefined ? 0 : Number(row.hits);
    },

    /** Deletes windows older than a day. */
    async gc(at: number): Promise<number> {
      const res = await db
        .deleteFrom('adminium_payment_counters')
        .where('windowStart', '<', at - 24 * COUNTER_WINDOW_MS)
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n);
    },
  };
}

export type PaymentCountersRepo = ReturnType<typeof paymentCountersRepo>;
