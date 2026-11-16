// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The payments set-up repos (migration 0062): pay links, payable
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
 * A PUBLIC START's link (0090: `audience` public) is current beside the
 * shop's own, under its own key (`<payable key>:public`), never in its place:
 * a card tester's declines lock only it, and the link staff sent keeps
 * working. `retire` ends both.
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
  /** Why it was revoked, when its holder is told (`test-ended`). */
  revokeReason: string | null;
  createdBy: string | null;
  createdAt: number;
  /** Who it was made for: a public start's own link, or one staff or the system made. */
  audience: LinkAudience;
}

/** A link a public start made (`public`), or one staff or the system made (`staff`). */
export type LinkAudience = 'staff' | 'public';

export interface MintLinkInput {
  tokenHash: string;
  tokenSealed: string;
  payable: PayableRef;
  mode: 'test' | 'live';
  expiresAt: number;
  createdBy: string | null;
  /** `public` for a public start's own link; staff's when not said. */
  audience?: LinkAudience;
}

/** The key a payable's current link of one audience is held under. */
function currentKeyOf(payable: PayableRef, audience: LinkAudience): string {
  return audience === 'public' ? `${payableKeyOf(payable)}:public` : payableKeyOf(payable);
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
    revokeReason: row.revokeReason ?? null,
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
    audience: row.audience === 'public' ? 'public' : 'staff',
  };
}

export function paymentLinksRepo(meta: MetaDb) {
  const { db } = meta;

  async function retireKey(key: string): Promise<number> {
    const res = await db.updateTable('adminium_payment_links').set({ currentKey: null }).where('currentKey', '=', key).executeTakeFirst();
    return affected(res.numUpdatedRows);
  }

  /** Ends a payable's current links, the shop's and a public start's (it was paid, voided, deleted or removed with sample data). */
  async function retire(payable: PayableRef): Promise<number> {
    return (await retireKey(currentKeyOf(payable, 'staff'))) + (await retireKey(currentKeyOf(payable, 'public')));
  }

  return {
    /**
     * Makes a payable's new current link of its audience, retiring the one
     * before it of that audience only. Returns the link and whether an older
     * one was replaced (the panel says so).
     */
    async mint(input: MintLinkInput, at: number = Date.now()): Promise<{ link: PaymentLink; replaced: boolean }> {
      const audience = input.audience ?? 'staff';
      const key = currentKeyOf(input.payable, audience);
      const row: Selectable<AdminiumPaymentLinksTable> = {
        id: newId('plk'),
        tokenHash: input.tokenHash,
        tokenSealed: input.tokenSealed,
        payableKind: input.payable.kind,
        connectionId: input.payable.connectionId,
        tableName: input.payable.tableName,
        rowKey: input.payable.rowKey,
        mode: input.mode,
        currentKey: key,
        expiresAt: input.expiresAt,
        revokedAt: null,
        revokeReason: null,
        createdBy: input.createdBy,
        createdAt: at,
        audience: audience === 'public' ? 'public' : null,
      };
      let replaced = (await retireKey(key)) > 0;
      try {
        await db.insertInto('adminium_payment_links').values(row).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        // Another mint for the same payable landed between the retire and the insert: retire it too.
        replaced = (await retireKey(key)) > 0 || replaced;
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

    /** The payable's current link: the shop's own, or (`public`) the one public starts reuse. */
    async currentFor(payable: PayableRef, audience: LinkAudience = 'staff'): Promise<PaymentLink | null> {
      const row = await db
        .selectFrom('adminium_payment_links')
        .selectAll()
        .where('currentKey', '=', currentKeyOf(payable, audience))
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

    retire,

    /** Revokes every current test link (live payments were switched on), saying why. */
    async revokeTestLinks(at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_payment_links')
        .set({ revokedAt: at, currentKey: null, revokeReason: 'test-ended' })
        .where('mode', '=', 'test')
        .where('currentKey', 'is not', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
    },
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
    /** The day it was paid; null where a column stamps itself (`paidAt`, or a create stamp). */
    date: column.nullable(),
    /** The moment it was paid (a till's shift counts by it). */
    paidAt: column.nullable().optional(),
    method: z.object({ column, values: z.record(z.string().min(1).max(64), z.string().min(1).max(255)) }).strict(),
    note: column.nullable(),
    voided: column.nullable(),
    /** Unique for each payment: Adminium writes the attempt id here, so a payment is never written twice. */
    reference: column,
    /** What has been refunded of each payment, in the amount's unit; a refund then reopens the balance. */
    refunded: column.nullable().optional(),
    /** The service it was taken by; a terminal's approval code and the card's last four; its currency. Written by Adminium alone. */
    provider: column.nullable().optional(),
    approvalCode: column.nullable().optional(),
    last4: column.nullable().optional(),
    currency: column.nullable().optional(),
    /**
     * Money given back that no refund row of the app's says (a refund made in
     * the provider's dashboard, a lost dispute), in the amount's unit: written
     * by Adminium alone, where the app keeps refunds as rows of its own.
     */
    refundedElsewhere: column.nullable().optional(),
    /** The tip a customer added on a card reader, in the amount's unit: written by Adminium beside what was asked. */
    tip: column.nullable().optional(),
    /** Whether `amount` holds whole units ("12.50") or the smallest unit (1250). */
    amountUnit: z.enum(['units', 'minor']).default('units'),
  })
  .strict();

/** A condition on the payable row (the manifest's `requires` grammar, by column name): one of eq, in, isNull, gt, gte, lt, lte. */
export const payableConditionSchema = z
  .object({
    column,
    eq: z.union([z.string(), z.number(), z.boolean()]).optional(),
    in: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(32).optional(),
    isNull: z.boolean().optional(),
    gt: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    lt: z.number().finite().optional(),
    lte: z.number().finite().optional(),
  })
  .strict();
export type PayableCondition = z.infer<typeof payableConditionSchema>;

/** Where the pay page sends the customer back: a path on the app's own customer side, never a query or a fragment. */
const returnTo = z
  .string()
  .max(200)
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/?)*$/);

/** A state a refund starts from or goes to, by its value. */
const stateValue = z.string().min(1).max(64);

/**
 * Refunds an app keeps as rows of its own refund table (E4, the rows model):
 * its staff write the row as they always did, and Adminium sends the money
 * back for it, stamping the provider's reference and where the refund stands.
 * Adminium writes no amount into the app's formulas.
 */
export const refundRowsMappingSchema = z
  .object({
    model: z.literal('rows'),
    /** The refund table (its id). */
    table: column,
    /** Its column naming the payment row refunded. */
    payment: column,
    /** What is given back, in the payment amount's unit: read once, after the write. */
    amount: column,
    /** Which of its rows send money back (`method eq online`): all of these hold. */
    when: z.array(payableConditionSchema).min(1).max(8),
    /** Stamped by Adminium alone: the provider's refund reference, and `asked`, `pending`, `done` or `not-sent`. */
    providerRef: column,
    state: column,
    /** The staff screen a refund is made on (Activity's "Refund in {app}"). */
    openIn: returnTo.optional(),
    /** A free cancellation's refund row, written by Adminium as the system: the values it writes beside the payment link and the amount. */
    auto: z.object({ values: z.record(column, z.union([z.string().max(255), z.number(), z.boolean()])) }).strict().optional(),
  })
  .strict();
export type RefundRowsMapping = z.infer<typeof refundRowsMappingSchema>;

/** Who made a move that may refund by itself: the customer through the app's public side, Adminium's timed move, or staff holding the refund right. */
export const REFUND_ON_WHO = ['customer', 'system', 'refund-right'] as const;

/**
 * The moves after which the full refund starts by itself (`refundOn`): a
 * show cancelled, a customer's free cancellation. Judged at the move, on the
 * server; anyone else's move leaves "Refund owed" for a person.
 */
export const refundOnSchema = z
  .object({
    moves: z
      .array(z.object({ from: z.array(stateValue).min(1).max(16).optional(), to: stateValue, by: z.array(z.enum(REFUND_ON_WHO)).min(1).max(3) }).strict())
      .min(1)
      .max(8),
    /** The app's own switch ("Refund free cancellations automatically"), a boolean column of its one-row settings table, read at the move. */
    switch: z.object({ table: column, column }).strict().optional(),
    /** Only while the moment in this column is still this many hours ahead (a clinic's late-cancel window), read from the settings row. */
    before: z.object({ column, hours: z.object({ table: column, column }).strict() }).strict().optional(),
  })
  .strict();
export type RefundOn = z.infer<typeof refundOnSchema>;

export const payableMappingSchema = z
  .object({
    /** The column the record is known by on the pay page and in staff lists ("Order no."). */
    label: column.nullable(),
    amount: z.object({ column, unit: z.enum(['units', 'minor']).nullable() }).strict(),
    currency: z.union([
      z.object({ column }).strict(),
      z.object({ fixed: currencyCode }).strict(),
      z.object({ connection: z.literal(true) }).strict(),
      /** A column of a one-row settings table (its id here). */
      z.object({ setting: z.object({ table: column, column }).strict() }).strict(),
    ]),
    /** A balance column, or null when the due is computed (amount − payments Adminium holds). */
    due: z.object({ column }).strict().nullable(),
    payments: z.union([z.object({ kind: z.literal('kept') }).strict(), ownPaymentsMappingSchema]),
    status: z
      .object({
        column,
        paid: z.string().min(1).max(255),
        refunded: z.string().min(1).max(255).nullable(),
        /** The states a row is moved to `paid` from; absent, from any (as the payments screen maps it). */
        from: z.array(z.string().min(1).max(64)).min(1).max(16).optional(),
        refundedFrom: z.array(z.string().min(1).max(64)).min(1).max(16).optional(),
        /** Further plain columns an online payment's move to paid writes, with fixed values (never money, keys or links). */
        set: z.record(column, z.union([z.string().max(255), z.number().finite(), z.boolean()])).optional(),
      })
      .strict()
      .nullable(),
    customerEmail: column.nullable(),
    customerCountry: column.nullable(),
    /** The only columns the pay page may show. */
    pageFields: z.array(column).max(50),
    /** While the row meets all of these it may be paid; absent, whenever something is due. */
    payableWhen: z.array(payableConditionSchema).min(1).max(8).optional(),
    returnTo: returnTo.optional(),
    /** Who sends the receipt: the app's own email, or Adminium's (the default). */
    receipt: z.enum(['app', 'engine']).optional(),
    /** The pay page offers no way to pay by hand. */
    onlyOnline: z.boolean().optional(),
    /** Only ways that settle at once: always, or while the row meets these. */
    instantOnly: z.union([z.literal(true), z.object({ where: z.array(payableConditionSchema).min(1).max(8) }).strict()]).optional(),
    /** How the table keeps refunds: a running total on the payment row (the column model, the default), or rows of its own. */
    refunds: z.union([z.object({ model: z.literal('column') }).strict(), refundRowsMappingSchema]).optional(),
    /** The moves after which the full refund starts by itself. */
    refundOn: refundOnSchema.optional(),
  })
  .strict()
  // Payments written into the table's own payments table are not Adminium's to
  // count: the due must come from a balance column the table keeps, or a paid
  // record would read as still owed and be paid again.
  .refine((mapping) => mapping.payments.kind === 'kept' || mapping.due !== null, {
    message: 'a table that keeps its own payments names its balance column',
    path: ['due'],
  });

export type PayableMapping = z.input<typeof payableMappingSchema>;

/**
 * An invoice table built on the Invoices shape, as an app declares it: the
 * shape maps its columns; the profile is its on/off switch and what the app
 * says beyond the shape.
 */
export const shapePayableMappingSchema = z
  .object({
    kind: z.literal('shape'),
    returnTo: returnTo.optional(),
    receipt: z.enum(['app', 'engine']).optional(),
    onlyOnline: z.boolean().optional(),
  })
  .strict();
export type ShapePayableMapping = z.infer<typeof shapePayableMappingSchema>;
export type ParsedPayableMapping = z.output<typeof payableMappingSchema>;
export type OwnPaymentsMapping = z.output<typeof ownPaymentsMappingSchema>;

export interface PayableProfile {
  id: string;
  connectionId: string;
  tableName: string;
  /** Null when the stored mapping no longer parses: the table is not payable until saved again (and for an invoice shape's profile). */
  mapping: ParsedPayableMapping | null;
  /** An invoice shape's profile: what the app says beyond the shape. Null for every other profile. */
  shape: ShapePayableMapping | null;
  ownerApp: string | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A mapping as stored: an invoice shape's own, or a table's column by column. */
function packedMapping(mapping: PayableMapping | ShapePayableMapping): unknown {
  return 'kind' in mapping && mapping.kind === 'shape' ? shapePayableMappingSchema.parse(mapping) : payableMappingSchema.parse(mapping);
}

function decodeProfile(row: Selectable<AdminiumPayableProfilesTable>): PayableProfile {
  const stored = readJson(row.mapping);
  const parsed = payableMappingSchema.safeParse(stored);
  const shape = parsed.success ? null : shapePayableMappingSchema.safeParse(stored);
  return {
    id: row.id,
    connectionId: row.connectionId,
    tableName: row.tableName,
    mapping: parsed.success ? parsed.data : null,
    shape: shape?.success === true ? shape.data : null,
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
      input: {
        connectionId: string;
        tableName: string;
        mapping: PayableMapping | ShapePayableMapping;
        ownerApp: string | null;
        createdBy: string | null;
        /** Switched on as it is made (a person's own, a file saved here), or off (a catalog app's, for a payments manager to switch on). */
        enabled?: boolean;
      },
      at: number = Date.now(),
    ): Promise<PayableProfile | null> {
      const row: Insertable<AdminiumPayableProfilesTable> = {
        id: newId('ppf'),
        connectionId: input.connectionId,
        tableName: input.tableName,
        mapping: packJson(packedMapping(input.mapping)),
        ownerApp: input.ownerApp,
        enabled: writeBool(meta, input.enabled ?? true),
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

    /** One database's, or any of a list (a workspace's databases; empty matches nothing), or every one. */
    async list(connectionId?: string | readonly string[]): Promise<PayableProfile[]> {
      let query = db.selectFrom('adminium_payable_profiles').selectAll();
      if (typeof connectionId === 'string') query = query.where('connectionId', '=', connectionId);
      else if (connectionId !== undefined) {
        if (connectionId.length === 0) return [];
        query = query.where('connectionId', 'in', [...connectionId]);
      }
      const rows = await query.orderBy('tableName', 'asc').execute();
      return rows.map(decodeProfile);
    },

    async update(id: string, patch: { mapping?: PayableMapping | ShapePayableMapping; enabled?: boolean }, at: number = Date.now()): Promise<boolean> {
      const set: Record<string, unknown> = { updatedAt: at };
      if (patch.mapping !== undefined) set['mapping'] = packJson(packedMapping(patch.mapping));
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

    /** Which of these names have a document: one read for many, in chunks. */
    async existing(names: readonly string[]): Promise<Set<string>> {
      const out = new Set<string>();
      for (let start = 0; start < names.length; start += 500) {
        const chunk = names.slice(start, start + 500);
        if (chunk.length === 0) continue;
        for (const row of await db.selectFrom('adminium_payment_settings').select('name').where('name', 'in', chunk).execute()) out.add(row.name);
      }
      // A store that compares names without regard to case answers a near-twin: only exact names count.
      return new Set([...out].filter((name) => names.includes(name)));
    },

    /**
     * Writes a document only when there is none of that name: true for the
     * caller that made it. What a "tell once" rides on, in every process.
     */
    async claim<T>(name: string, schema: z.ZodType<T>, value: T, at: number = Date.now()): Promise<boolean> {
      try {
        await db.insertInto('adminium_payment_settings').values({ name, value: packJson(schema.parse(value)), updatedAt: at }).execute();
        return true;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },

    /** Removes the documents whose name starts with `prefix` (letters, digits, `-` and `:` only) and that were last written before `before`. */
    async gcPrefix(prefix: string, before: number): Promise<number> {
      if (!/^[a-z0-9:-]+$/.test(prefix)) throw new Error(`gcPrefix takes a plain prefix, not "${prefix}".`);
      const res = await db.deleteFrom('adminium_payment_settings').where('name', 'like', `${prefix}%`).where('updatedAt', '<', before).executeTakeFirst();
      return affected(res.numDeletedRows);
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
      // One statement adds one, so a burst counts every hit; the value always
      // changes, so MySQL reports the row as touched.
      const bumped = await db
        .updateTable('adminium_payment_counters')
        .set((eb) => ({ hits: eb('hits', '+', 1) }))
        .where('bucket', '=', bucket)
        .where('windowStart', '=', windowStart)
        .executeTakeFirst();
      if (affected(bumped.numUpdatedRows) === 0) {
        try {
          await db.insertInto('adminium_payment_counters').values({ bucket, windowStart, hits: 1 }).execute();
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          await db
            .updateTable('adminium_payment_counters')
            .set((eb) => ({ hits: eb('hits', '+', 1) }))
            .where('bucket', '=', bucket)
            .where('windowStart', '=', windowStart)
            .execute();
        }
      }
      return this.read(bucket, at);
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

    /**
     * The count in `bucket` over the last hour or two: this hour's and the
     * one before it, so a run that starts late in an hour cannot spend a
     * whole new hour's allowance a minute later.
     */
    async readRecent(bucket: string, at: number = Date.now()): Promise<number> {
      return (await this.read(bucket, at)) + (await this.read(bucket, at - COUNTER_WINDOW_MS));
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
