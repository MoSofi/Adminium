// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What can be paid, and how much is due on it NOW.
 *
 * Three kinds, one rule: the amount due is re-read on the
 * server every time. A link never carries an amount and a browser never sends
 * one, so nothing here takes an amount from a caller.
 *
 *  1. `shape` — a table built on the Invoices add-on's `invoice@N` shape.
 *     Payable while `sent` with a balance above zero; due = `balance`. Online
 *     payments need `@2`, whose payments part carries the unique `payment_ref`
 *     that makes recording safe; a table on `@1` takes manual payments only.
 *  2. `document` — an invoice made on the Invoices add-on's own page (meta).
 *     Its payments are kept by Adminium; due = total − those payments.
 *  3. `profile` — any table an admin marked payable. Its payments land in its
 *     own payments table (mapped, with a unique reference column) or are kept
 *     by Adminium; due = a balance column, or amount − the kept payments.
 *
 * And staff's throwaway test payables (`test-payables.ts`), named as documents:
 * due = the pretend amount − the test payments kept on it.
 *
 * An amount that is not exact at its currency's decimals is refused, never
 * rounded: the customer would be asked for a different amount.
 */
import { currencyScale, ratioText, toRatio } from '@adminium/manifest';
import {
  appTablesRepo,
  connectionTenantConfig,
  invoiceDocumentsRepo,
  keptPaymentsRepo,
  payableProfilesRepo,
  realTableOf,
  type MetaDb,
  type ParsedPayableMapping,
  type PayableCondition,
  type ShapePayableMapping,
  type PayableRef,
} from '@adminium/meta';
import { sameAmount, subtractAmounts } from '@adminium/add-on-contracts';
import { sql } from 'kysely';

import type { ConnectionManager } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { sameValue } from '../crud/write-values.js';
import type { WriteTarget } from '../crud/write-context.js';
import { isDesignerCurrency } from '../invoices/document.js';
import { createPublicViews } from '../public-api/runtime.js';
import { isTestPayable, readTestPayable } from './test-payables.js';
import { realOfTableId, tableIdOrNull } from '../installs/table-id.js';

// ─── Row keys ───────────────────────────────────────────────────────────────

const INTEGER_TYPES = new Set(['integer', 'bigint', 'int', 'smallint', 'serial']);

/** A row's primary key in canonical text: the value of a one-column key, or a JSON list for several. */
export function rowKeyOf(table: Pick<ResolvedTable, 'primaryKey'>, row: Row): string {
  if (table.primaryKey.length === 1) return String(row[table.primaryKey[0]!]);
  return JSON.stringify(table.primaryKey.map((column) => row[column] ?? null));
}

/** The primary key a row key names, typed as its columns are; null when it does not fit the table. */
export function pkOfRowKey(table: Pick<ResolvedTable, 'primaryKey' | 'columns'>, rowKey: string): Row | null {
  const typed = (column: string, value: unknown): unknown => {
    const logical = table.columns.get(column)?.logicalType;
    if (logical !== undefined && INTEGER_TYPES.has(logical) && typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
    return value;
  };
  if (table.primaryKey.length === 0) return null;
  if (table.primaryKey.length === 1) {
    const column = table.primaryKey[0]!;
    return { [column]: typed(column, rowKey) };
  }
  let values: unknown;
  try {
    values = JSON.parse(rowKey);
  } catch {
    return null;
  }
  if (!Array.isArray(values) || values.length !== table.primaryKey.length) return null;
  return Object.fromEntries(table.primaryKey.map((column, i) => [column, typed(column, values[i])]));
}

// ─── Money from a stored value ──────────────────────────────────────────────

/**
 * A stored amount as decimal text at `scale` places, or null when it is
 * empty, negative, or not exact there (120.005 at 2 places is not 120.01).
 */
export function exactAmount(value: unknown, scale: number): string | null {
  const ratio = toRatio(value);
  if (ratio === null) return null;
  // Compared at 12 places: past any decimal column's scale (10.0000004 is not
  // 10.00), short of a float's noise (a REAL column's 0.30000000000000004 is 0.30).
  const fine = ratioText(ratio, 12);
  if (fine.startsWith('-')) return null;
  const at = ratioText(ratio, scale);
  return sameAmount(fine, at) ? at : null;
}

/** A whole number of minor units as decimal text at `scale` places. */
export function fromMinorUnits(value: unknown, scale: number): string | null {
  const ratio = toRatio(value);
  if (ratio === null) return null;
  const whole = ratioText(ratio, 0);
  if (!/^\d+$/.test(whole) || !sameAmount(ratioText(ratio, 12), whole)) return null;
  const padded = whole.padStart(scale + 1, '0');
  return scale === 0 ? whole : `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

/** A JSON object (not null, not an array): what a stored body is read through. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ─── What a payable resolves to ─────────────────────────────────────────────

export type PayableRefusalCode =
  | 'GONE'
  | 'NOT_PAYABLE'
  | 'NOT_SENT'
  | 'VOIDED'
  | 'NOTHING_DUE'
  | 'NEEDS_UPDATE'
  | 'NO_CURRENCY'
  | 'AMOUNT_UNCLEAR'
  /** Owed, but not payable online in the state the record is in now (an app's `payableWhen`). */
  | 'NOT_NOW';

export interface PayableRefusal {
  code: PayableRefusalCode;
  message: string;
}

/** Where a payment for this payable is written. */
export type RecordInto =
  | { kind: 'kept' }
  | {
      kind: 'table';
      /** The payments table's id, as the view knows it. */
      tableName: string;
      /** The column naming the payable's row, and the value it takes. */
      link: string;
      linkValue: unknown;
      amount: string;
      /** Whether the payments table counts whole units or the smallest unit. */
      amountUnit: 'units' | 'minor';
      date: string | null;
      method: { column: string; values: Readonly<Record<string, string>> } | null;
      note: string | null;
      reference: string;
      /** What has been refunded of each payment (the amount's unit), when the table keeps it; null when it does not. */
      refunded: string | null;
      /** Where an app that keeps refunds as rows of its own takes the money given back with no row of its (made at the provider, a lost dispute). */
      refundedElsewhere?: string | null;
      /** Where a card reader payment's tip goes, beside what was asked. */
      tip?: string | null;
      /** Columns the shape adds (currency, provider, recorded by). */
      shapeColumns: boolean;
      /** A profile's own columns for the moment paid, the service, a terminal's approval code, the last four and the currency; null when it keeps none. */
      paidAt?: string | null;
      provider?: string | null;
      approvalCode?: string | null;
      last4?: string | null;
      currency?: string | null;
    };

export interface ResolvedPayable {
  ref: PayableRef;
  /** The number the customer recognises ("INV-0042"). */
  label: string;
  currency: string;
  /** What the payable asks in full. */
  total: string;
  /** What is due now. */
  due: string;
  /** When it is due (`YYYY-MM-DD`), when the record says so plainly. */
  dueDate: string | null;
  /** A staff test payable: the one service the pay page offers for it. */
  onlyProvider?: string;
  /** Null when it can take an online payment now. */
  refusal: PayableRefusal | null;
  /** True when manual payments are possible even though online ones are not (a `@1` table). */
  manualOnly: boolean;
  customerEmail: string | null;
  customerCountry: string | null;
  /**
   * The status column to set when the due reaches zero (and back on a full refund);
   * `from`/`refundedFrom`, the states it is moved from (absent, any).
   */
  status: { column: string; paid: string; refunded: string | null; from?: readonly string[] | undefined; refundedFrom?: readonly string[] | undefined } | null;
  recordInto: RecordInto;
}

/** What the resolvers read. Real ones read the meta store and the shop's database; tests give fakes. */
export interface PayableSources {
  /** The table, its database and a write target, or null when the connection no longer has it. */
  table(connectionId: string, tableName: string): Promise<{ table: ResolvedTable; target: WriteTarget } | null>;
  readRow(connectionId: string, tableName: string, rowKey: string): Promise<Row | null>;
  /** The invoice shape a table is built on, and its payments part, or null. */
  shapeOf(connectionId: string, tableName: string): Promise<{ version: number; paymentsTable: string | null } | null>;
  connectionCurrency(connectionId: string): Promise<string | null>;
  /** A column of a one-row settings table (its id), or null when the table has not exactly one row. */
  setting?(connectionId: string, tableName: string, column: string): Promise<unknown>;
  profile(connectionId: string, tableName: string): Promise<{ id: string; enabled: boolean; mapping: ParsedPayableMapping | null; shape?: ShapePayableMapping | null; ownerApp?: string | null } | null>;
  /** What Adminium keeps as paid on a payable, live payments only. */
  keptPaid(ref: PayableRef, currency: string): Promise<string>;
  /** The lines a payable lists (an invoice's), in order, at most 50; null when it has none to show. */
  lines?(ref: PayableRef): Promise<PayableLine[] | null>;
  /** A staff test payable, and the test payments kept on it; null when there is none. */
  testPayable?(rowKey: string): Promise<{ label: string; currency: string; amount: string; provider: string; paid: string } | null>;
  /** A designer invoice's money, as stored. */
  document(id: string): Promise<{ status: string; number: string; currency: string | null; totalMinor: number | null; due?: string | null } | null>;
}

/** A calendar day as `YYYY-MM-DD`, from a date column or a date the designer typed; anything else is no date. */
export function calendarDay(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return null;
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value.trim())?.[1] ?? null;
  return day !== null && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? day : null;
}

function refused(code: PayableRefusalCode, message: string): PayableRefusal {
  return { code, message };
}

const ISO = /^[A-Z]{3}$/;

/** One line of what a payable is for, as the pay page lists it. */
export interface PayableLine {
  label: string;
  /** In the payable's currency, at its decimals. */
  amount: string;
}

/** The most lines the pay page lists. */
export const PAY_LINES_MAX = 50;

/** A designer invoice's line: quantity × rate, at the currency's decimals; null when either is not a number. */
export function designerLineAmount(qty: unknown, rate: unknown, scale: number): string | null {
  const q = toRatio(typeof qty === 'string' && qty.trim() === '' ? '1' : qty);
  const r = toRatio(rate);
  if (q === null || r === null) return null;
  return ratioText({ n: q.n * r.n, d: q.d * r.d }, scale);
}

/**
 * A designer invoice's total, kept in hundredths, as an amount in a currency
 * with `scale` decimals (0, 1 or 2), rounded half up the way the sheet prints
 * it: ¥1,357.40 is due as 1357. Null for a total that is not a whole number
 * of hundredths at or above zero.
 */
export function designerTotal(totalMinor: unknown, scale: number): string | null {
  if (typeof totalMinor !== 'number' || !Number.isSafeInteger(totalMinor) || totalMinor < 0 || scale > 2) return null;
  const divisor = 10 ** (2 - scale);
  return fromMinorUnits(Math.floor((totalMinor + divisor / 2) / divisor), scale);
}

/** How a payable is read: for a live payment (the default) or a test one. */
export interface ResolveOptions {
  /**
   * A test payment reads an app's own payable as switched on: an app is
   * rehearsed in test mode before anyone switches it on for real money. A
   * person's own payable that was switched off stays off in either mode.
   */
  mode?: 'live' | 'test';
  /**
   * Money already taken is followed whatever the switch says now: a refund
   * of it reaches its record after the app was switched off.
   */
  taken?: boolean;
}

/** Whether a stored profile takes this payment: switched on, or an app's own payable read for a test payment. */
function takes(profile: { enabled: boolean; ownerApp?: string | null }, opts: ResolveOptions): boolean {
  return profile.enabled || opts.taken === true || (opts.mode === 'test' && profile.ownerApp !== null && profile.ownerApp !== undefined);
}

/** Resolves a payable; null when it no longer exists at all. */
export async function resolvePayable(sources: PayableSources, ref: PayableRef, opts: ResolveOptions = {}): Promise<ResolvedPayable | null> {
  if (isTestPayable(ref)) return resolveTest(sources, ref);
  if (ref.kind === 'document') return resolveDocument(sources, ref);
  if (ref.connectionId === null || ref.tableName === null) return null;
  if (ref.kind === 'shape') return resolveShape(sources, ref, ref.connectionId, ref.tableName, opts);
  return resolveProfile(sources, ref, ref.connectionId, ref.tableName, opts);
}

async function resolveShape(sources: PayableSources, ref: PayableRef, connectionId: string, tableName: string, opts: ResolveOptions): Promise<ResolvedPayable | null> {
  const shape = await sources.shapeOf(connectionId, tableName);
  if (shape === null) return null;
  const row = await sources.readRow(connectionId, tableName, ref.rowKey);
  if (row === null) return null;
  const currency = typeof row['currency'] === 'string' && ISO.test(row['currency']) ? row['currency'] : await sources.connectionCurrency(connectionId);
  const label = String(row['number'] ?? ref.rowKey);
  const base = {
    ref,
    label,
    dueDate: calendarDay(row['due_on']),
    customerEmail: null,
    customerCountry: null,
    status: null,
    manualOnly: shape.version < 2,
  };
  if (currency === null || !ISO.test(currency)) {
    return { ...base, currency: '', total: '0', due: '0', refusal: refused('NO_CURRENCY', 'This invoice has no currency.'), recordInto: { kind: 'kept' } };
  }
  const scale = currencyScale(currency);
  const total = exactAmount(row['total'] ?? 0, scale);
  const due = exactAmount(row['balance'] ?? row['total'] ?? 0, scale);
  // A shape's payments always land in its own payments part, never in meta:
  // its balance column is what counts them. A part this server cannot reach
  // (missing, or a private table) makes the invoice unpayable online.
  if (shape.paymentsTable === null) {
    return { ...base, currency, total: '0', due: '0', refusal: refused('NOT_PAYABLE', "This invoice's payments table cannot be reached."), recordInto: { kind: 'kept' } };
  }
  const recordInto: RecordInto = {
    kind: 'table',
    tableName: shape.paymentsTable,
    link: 'document_id',
    linkValue: pkValue(row),
    amount: 'amount',
    amountUnit: 'units',
    date: 'paid_on',
    method: { column: 'method', values: SHAPE_METHODS },
    note: 'method_note',
    reference: 'payment_ref',
    // `@2` keeps each payment's refunds; its `paid` sums what is left of each.
    refunded: shape.version >= 2 ? 'refunded_amount' : null,
    shapeColumns: true,
  };
  if (total === null || due === null) {
    return { ...base, currency, total: '0', due: '0', refusal: refused('AMOUNT_UNCLEAR', `This invoice's amount is not exact in ${currency}.`), recordInto };
  }
  const status = String(row['status'] ?? '');
  let refusal: PayableRefusal | null = null;
  if (status === 'void') refusal = refused('VOIDED', 'This invoice was voided.');
  else if (status !== 'sent') refusal = refused('NOT_SENT', 'Send the invoice first. A payment can only be recorded against a sent invoice.');
  else if (!positive(due)) refusal = refused('NOTHING_DUE', 'This invoice is paid.');
  else if (shape.version < 2) refusal = refused('NEEDS_UPDATE', "This invoice table needs its app's update to take online payments.");
  else {
    // An app that declares its invoices (`{ shape: true }`) has them switched on and off in Payments → Apps: off as they arrive.
    // An invoice table no app declared keeps taking payments as it always has.
    const profile = await sources.profile(connectionId, tableName);
    if (profile !== null && profile.shape !== null && profile.shape !== undefined && !takes(profile, opts)) refusal = refused('NOT_NOW', "This app's invoices are not switched on for online payments.");
  }
  return { ...base, currency, total, due, refusal, recordInto };
}

/** The invoice shape's `method` values: every online way lands as `online`, a card as `card`. */
const SHAPE_METHODS: Readonly<Record<string, string>> = {
  card: 'card',
  bank_debit: 'bank-transfer',
  sepa_debit: 'bank-transfer',
  bacs_debit: 'bank-transfer',
  us_bank_account: 'bank-transfer',
  '*': 'online',
};

function pkValue(row: Row): unknown {
  return row['id'];
}

function positive(amount: string): boolean {
  return subtractAmounts(amount, '0', 6) !== null && !sameAmount(amount, '0');
}

async function resolveProfile(sources: PayableSources, ref: PayableRef, connectionId: string, tableName: string, opts: ResolveOptions): Promise<ResolvedPayable | null> {
  const profile = await sources.profile(connectionId, tableName);
  if (profile === null) return null;
  const found = await sources.table(connectionId, tableName);
  if (found === null) return null;
  const row = await sources.readRow(connectionId, tableName, ref.rowKey);
  if (row === null) return null;
  const mapping = profile.mapping;
  const label = mapping?.label === null || mapping === null ? ref.rowKey : String(row[mapping.label] ?? ref.rowKey);
  const base = { ref, label, dueDate: null, manualOnly: false, customerEmail: null as string | null, customerCountry: null as string | null };
  if (mapping === null || !takes(profile, opts)) {
    return {
      ...base,
      currency: '',
      total: '0',
      due: '0',
      refusal: refused('NOT_PAYABLE', 'This table is not set up to be paid.'),
      status: null,
      recordInto: { kind: 'kept' },
    };
  }

  let currency: string | null;
  if ('column' in mapping.currency) currency = typeof row[mapping.currency.column] === 'string' ? (row[mapping.currency.column] as string).toUpperCase() : null;
  else if ('fixed' in mapping.currency) currency = mapping.currency.fixed;
  else if ('setting' in mapping.currency) {
    // A clinic's own currency, in its settings row.
    const held = (await sources.setting?.(connectionId, mapping.currency.setting.table, mapping.currency.setting.column)) ?? null;
    currency = typeof held === 'string' ? held.trim().toUpperCase() : null;
  } else currency = await sources.connectionCurrency(connectionId);

  const email = mapping.customerEmail === null ? null : row[mapping.customerEmail];
  const country = mapping.customerCountry === null ? null : row[mapping.customerCountry];
  const people = {
    customerEmail: typeof email === 'string' && email.includes('@') ? email : null,
    customerCountry: typeof country === 'string' && /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : null,
  };
  const recordInto: RecordInto =
    mapping.payments.kind === 'kept'
      ? { kind: 'kept' }
      : {
          kind: 'table',
          tableName: mapping.payments.table,
          link: mapping.payments.link,
          linkValue: found.table.primaryKey.length === 1 ? row[found.table.primaryKey[0]!] : null,
          amount: mapping.payments.amount,
          amountUnit: mapping.payments.amountUnit,
          date: mapping.payments.date,
          method: mapping.payments.method,
          note: mapping.payments.note,
          reference: mapping.payments.reference,
          refunded: mapping.payments.refunded ?? null,
          refundedElsewhere: mapping.payments.refundedElsewhere ?? null,
          tip: mapping.payments.tip ?? null,
          shapeColumns: false,
          paidAt: mapping.payments.paidAt ?? null,
          provider: mapping.payments.provider ?? null,
          approvalCode: mapping.payments.approvalCode ?? null,
          last4: mapping.payments.last4 ?? null,
          currency: mapping.payments.currency ?? null,
        };

  if (currency === null || !ISO.test(currency)) {
    // A value that is there but no code (an order number in the wrong column) is named, so the mapping can be put right.
    const held = 'column' in mapping.currency ? row[mapping.currency.column] : null;
    const shown = typeof held === 'string' || typeof held === 'number' ? String(held).trim().slice(0, 40) : '';
    const message = shown === '' ? 'This record has no currency.' : `${shown} is not a currency code.`;
    return { ...base, ...people, currency: '', total: '0', due: '0', refusal: refused('NO_CURRENCY', message), status: mapping.status, recordInto };
  }
  const scale = currencyScale(currency);
  const total = mapping.amount.unit === 'minor' ? fromMinorUnits(row[mapping.amount.column], scale) : exactAmount(row[mapping.amount.column], scale);
  if (total === null) {
    return { ...base, ...people, currency, total: '0', due: '0', refusal: refused('AMOUNT_UNCLEAR', `This record's amount is not exact in ${currency}.`), status: mapping.status, recordInto };
  }
  let due: string | null;
  // The balance is kept in the same unit as the amount: cents beside cents.
  if (mapping.due !== null) due = mapping.amount.unit === 'minor' ? fromMinorUnits(row[mapping.due.column] ?? 0, scale) : exactAmount(row[mapping.due.column] ?? 0, scale);
  else due = subtractAmounts(total, await sources.keptPaid(ref, currency), scale) ?? '0';
  if (due === null) {
    return { ...base, ...people, currency, total, due: '0', refusal: refused('AMOUNT_UNCLEAR', `This record's balance is not exact in ${currency}.`), status: mapping.status, recordInto };
  }
  const refusal = recordInto.kind === 'table' && recordInto.linkValue === null
    ? refused('NOT_PAYABLE', 'A table with a key of several columns cannot be paid into its own payments table.')
    : !positive(due)
      ? refused('NOTHING_DUE', 'Nothing is due on this record.')
      : mapping.payableWhen !== undefined && !mapping.payableWhen.every((condition) => conditionHolds(condition, row))
        ? refused('NOT_NOW', 'This record cannot be paid online now.')
        : null;
  return { ...base, ...people, currency, total, due, refusal, status: mapping.status, recordInto };
}

/** Whether the row meets one of a payable's conditions (`payableWhen`, `instantOnly`): the manifest's `requires` grammar. */
export function conditionHolds(condition: PayableCondition, row: Row): boolean {
  const value = row[condition.column];
  if (condition.isNull !== undefined) return (value === null || value === undefined) === condition.isNull;
  if (condition.eq !== undefined) return sameValue(condition.eq, value);
  if (condition.in !== undefined) return condition.in.some((one) => sameValue(one, value));
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (Number.isNaN(number)) return false;
  if (condition.gt !== undefined) return number > condition.gt;
  if (condition.gte !== undefined) return number >= condition.gte;
  if (condition.lt !== undefined) return number < condition.lt;
  if (condition.lte !== undefined) return number <= condition.lte;
  return false;
}

async function resolveTest(sources: PayableSources, ref: PayableRef): Promise<ResolvedPayable | null> {
  const test = sources.testPayable === undefined ? null : await sources.testPayable(ref.rowKey);
  if (test === null) return null;
  const scale = currencyScale(test.currency);
  const total = exactAmount(test.amount, scale);
  const due = total === null ? null : subtractAmounts(total, test.paid, scale);
  const base = { ref, label: test.label, dueDate: null, onlyProvider: test.provider, manualOnly: false, customerEmail: null, customerCountry: null, status: null, recordInto: { kind: 'kept' as const } };
  if (total === null || due === null) return { ...base, currency: test.currency, total: '0', due: '0', refusal: refused('AMOUNT_UNCLEAR', 'This test payment is not exact.') };
  return { ...base, currency: test.currency, total, due, refusal: positive(due) ? null : refused('NOTHING_DUE', 'This test payment is paid.') };
}

async function resolveDocument(sources: PayableSources, ref: PayableRef): Promise<ResolvedPayable | null> {
  const document = await sources.document(ref.rowKey);
  if (document === null) return null;
  const base = { ref, label: document.number || ref.rowKey, dueDate: calendarDay(document.due ?? null), manualOnly: false, customerEmail: null, customerCountry: null, status: null, recordInto: { kind: 'kept' as const } };
  // The designer stores a currency SYMBOL; a payment needs the ISO code, which the invoice@2 work adds.
  if (document.currency === null || !ISO.test(document.currency)) {
    return { ...base, currency: '', total: '0', due: '0', refusal: refused('NO_CURRENCY', 'Choose the invoice currency first.') };
  }
  const scale = currencyScale(document.currency);
  if (!isDesignerCurrency(document.currency) || scale > 2) {
    return { ...base, currency: document.currency, total: '0', due: '0', refusal: refused('NOT_PAYABLE', `Invoices made here cannot be paid in ${document.currency}.`) };
  }
  // The designer keeps every total in hundredths, whatever the currency; a
  // currency with fewer decimals is due as the sheet prints it (rounded half up).
  const total = designerTotal(document.totalMinor, scale);
  if (total === null) {
    return { ...base, currency: document.currency, total: '0', due: '0', refusal: refused('AMOUNT_UNCLEAR', "This invoice's total is not clear.") };
  }
  const due = subtractAmounts(total, await sources.keptPaid(ref, document.currency), scale) ?? '0';
  let refusal: PayableRefusal | null = null;
  if (document.status === 'draft') refusal = refused('NOT_SENT', 'Send the invoice first. A payment can only be recorded against a sent invoice.');
  else if (document.status === 'paid' || !positive(due)) refusal = refused('NOTHING_DUE', 'This invoice is paid.');
  else if (!['sent', 'overdue', 'live'].includes(document.status)) refusal = refused('NOT_PAYABLE', 'This invoice cannot be paid.');
  return { ...base, currency: document.currency, total, due, refusal };
}

// ─── The real sources ───────────────────────────────────────────────────────

export interface PayableSourceDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  viewFor?: ReturnType<typeof createPublicViews>['viewFor'];
}

/** The sources the server reads: the meta store and each connection's own database. */
export function createPayableSources(deps: PayableSourceDeps): PayableSources {
  const viewFor = deps.viewFor ?? createPublicViews(deps.meta).viewFor;

  /**
   * A payable's table (a snapshot id, `public.invoices`) as an app's record
   * names it: only the default schema's prefix comes off, so `sales.invoices`
   * stays itself. With no view yet, the bare name, as before there were schemas.
   */
  const recordedAs = (view: Awaited<ReturnType<typeof viewFor>>, tableName: string): string =>
    view !== null ? realOfTableId(view.model, tableName) : tableName.includes('.') ? tableName.slice(tableName.indexOf('.') + 1) : tableName;

  async function table(connectionId: string, tableName: string): Promise<{ table: ResolvedTable; target: WriteTarget } | null> {
    const view = await viewFor(connectionId);
    // No view yet (the schema is being read again) is a moment, not a missing
    // table: thrown, so the job tries again rather than calling the row gone.
    if (view === null) throw new Error(`The schema of connection ${connectionId} is not ready.`);
    let resolved: ResolvedTable;
    try {
      resolved = view.table(tableName);
    } catch {
      return null;
    }
    const { db, dialect } = await deps.manager.data(connectionId);
    const timezone = (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? 'UTC';
    return { table: resolved, target: { connectionId, view, table: resolved, db, dialect, timezone } };
  }

  return {
    table,
    async readRow(connectionId, tableName, rowKey) {
      const found = await table(connectionId, tableName);
      if (found === null) return null;
      const pk = pkOfRowKey(found.table, rowKey);
      if (pk === null) return null;
      return (await fetchByPk(found.target.db, found.table, pk)) ?? null;
    },
    async shapeOf(connectionId, tableName) {
      const view = await viewFor(connectionId);
      const records = await appTablesRepo(deps.meta).byTable(connectionId, recordedAs(view, tableName));
      const document = records.find((record) => /^invoices\/invoice@\d+#document$/.test(record.builtOn ?? ''));
      if (document === undefined) return null;
      const version = Number(/@(\d+)#/.exec(document.builtOn!)![1]);
      const siblings = await appTablesRepo(deps.meta).forInstall(connectionId, document.appKey);
      const payments = siblings.find((record) => record.builtOn === `invoices/invoice@${version}#payments`);
      if (payments === undefined) return { version, paymentsTable: null };
      const id = view === null ? null : tableIdOrNull(view.model, realTableOf(payments));
      return { version, paymentsTable: id };
    },
    async connectionCurrency(connectionId) {
      return (await connectionTenantConfig(deps.meta, connectionId))?.currency ?? null;
    },
    async setting(connectionId, tableName, column) {
      const found = await table(connectionId, tableName);
      if (found === null || !found.table.columns.has(column)) return null;
      // One row, or no setting at all: two rows would make the answer a guess.
      const rows = (await found.target.db.selectFrom(found.table.id as never).select(sql.ref(column).as('v')).limit(2).execute()) as { v?: unknown }[];
      return rows.length === 1 ? (rows[0]!.v ?? null) : null;
    },
    async profile(connectionId, tableName) {
      const profile = await payableProfilesRepo(deps.meta).byTable(connectionId, tableName);
      return profile === null ? null : { id: profile.id, enabled: profile.enabled, mapping: profile.mapping, shape: profile.shape, ownerApp: profile.ownerApp };
    },
    keptPaid: (ref, currency) => keptPaymentsRepo(deps.meta).paid(ref, currency, 'live'),
    async lines(ref) {
      if (isTestPayable(ref)) return null;
      if (ref.kind === 'document') {
        const document = await invoiceDocumentsRepo(deps.meta).findById(ref.rowKey);
        if (document === null || document.kind !== 'invoice') return null;
        const body = (isPlainRecord(document.body) ? document.body : {}) as { items?: unknown; currencyCode?: unknown };
        const currency = typeof body.currencyCode === 'string' && ISO.test(body.currencyCode) ? body.currencyCode : null;
        if (currency === null || !Array.isArray(body.items)) return null;
        const out: PayableLine[] = [];
        for (const item of body.items.slice(0, PAY_LINES_MAX) as unknown[]) {
          if (!isPlainRecord(item)) continue;
          const amount = designerLineAmount(item.qty, item.rate, currencyScale(currency));
          if (amount === null || typeof item.desc !== 'string' || item.desc.trim() === '') continue;
          out.push({ label: item.desc.trim().slice(0, 200), amount });
        }
        return out.length === 0 ? null : out;
      }
      if (ref.kind !== 'shape' || ref.connectionId === null || ref.tableName === null) return null;
      const { connectionId, tableName } = ref;
      const view = await viewFor(connectionId);
      const records = await appTablesRepo(deps.meta).byTable(connectionId, recordedAs(view, tableName));
      const document = records.find((record) => /^invoices\/invoice@\d+#document$/.test(record.builtOn ?? ''));
      if (document === undefined) return null;
      const version = /@(\d+)#/.exec(document.builtOn!)![1];
      const part = (await appTablesRepo(deps.meta).forInstall(connectionId, document.appKey)).find((record) => record.builtOn === `invoices/invoice@${version}#lines`);
      if (part === undefined) return null;
      const linesId = view === null ? null : tableIdOrNull(view.model, realTableOf(part));
      const head = await table(connectionId, tableName);
      if (linesId === null || head === null) return null;
      const lines = await table(connectionId, linesId);
      const pk = pkOfRowKey(head.table, ref.rowKey);
      if (lines === null || pk === null) return null;
      const docRow = await fetchByPk(head.target.db, head.table, pk);
      const currency = typeof docRow?.['currency'] === 'string' && ISO.test(docRow['currency']) ? docRow['currency'] : await connectionTenantConfig(deps.meta, connectionId).then((config) => config?.currency ?? null);
      if (docRow === undefined || currency === null) return null;
      const rows = await lines.target.db
        .selectFrom(lines.table.id)
        .select([lines.target.db.dynamic.ref('description'), lines.target.db.dynamic.ref('amount')])
        .where(lines.target.db.dynamic.ref('document_id'), '=', pkValue(docRow))
        .orderBy(lines.target.db.dynamic.ref('position'))
        .limit(PAY_LINES_MAX)
        .execute();
      const out: PayableLine[] = [];
      for (const row of rows as Record<string, unknown>[]) {
        const amount = exactAmount(row['amount'] ?? 0, currencyScale(currency));
        if (amount === null || typeof row['description'] !== 'string') continue;
        out.push({ label: row['description'].slice(0, 200), amount });
      }
      return out.length === 0 ? null : out;
    },
    async testPayable(rowKey) {
      const test = await readTestPayable(deps.meta, rowKey);
      if (test === null) return null;
      const ref: PayableRef = { kind: 'document', connectionId: null, tableName: null, rowKey };
      return { label: test.label, currency: test.currency, amount: test.amount, provider: test.provider, paid: await keptPaymentsRepo(deps.meta).paid(ref, test.currency, 'test') };
    },
    async document(id) {
      const document = await invoiceDocumentsRepo(deps.meta).findById(id);
      if (document === null || document.kind !== 'invoice') return null;
      const body: Record<string, unknown> = isPlainRecord(document.body) ? document.body : {};
      const summary: Record<string, unknown> = isPlainRecord(document.summary) ? document.summary : {};
      const code = typeof body['currencyCode'] === 'string' ? body['currencyCode'] : null;
      return {
        status: document.status,
        number: document.number ?? '',
        currency: code,
        totalMinor: typeof summary['totalMinor'] === 'number' ? summary['totalMinor'] : null,
        due: typeof body['due'] === 'string' ? body['due'] : null,
      };
    },
  };
}
