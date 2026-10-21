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
  type MetaDb,
  type ParsedPayableMapping,
  type PayableRef,
} from '@adminium/meta';
import { sameAmount, subtractAmounts } from '@adminium/add-on-contracts';

import type { ConnectionManager } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import type { WriteTarget } from '../crud/write-context.js';
import { createPublicViews } from '../public-api/runtime.js';
import { isTestPayable, readTestPayable } from './test-payables.js';

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

// ─── What a payable resolves to ─────────────────────────────────────────────

export type PayableRefusalCode =
  | 'GONE'
  | 'NOT_PAYABLE'
  | 'NOT_SENT'
  | 'VOIDED'
  | 'NOTHING_DUE'
  | 'NEEDS_UPDATE'
  | 'NO_CURRENCY'
  | 'AMOUNT_UNCLEAR';

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
      /** Columns the shape adds (currency, provider, recorded by). */
      shapeColumns: boolean;
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
  /** The status column to set when the due reaches zero (and back on a full refund). */
  status: { column: string; paid: string; refunded: string | null } | null;
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
  profile(connectionId: string, tableName: string): Promise<{ id: string; enabled: boolean; mapping: ParsedPayableMapping | null } | null>;
  /** What Adminium keeps as paid on a payable, live payments only. */
  keptPaid(ref: PayableRef, currency: string): Promise<string>;
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

/** Resolves a payable; null when it no longer exists at all. */
export async function resolvePayable(sources: PayableSources, ref: PayableRef): Promise<ResolvedPayable | null> {
  if (isTestPayable(ref)) return resolveTest(sources, ref);
  if (ref.kind === 'document') return resolveDocument(sources, ref);
  if (ref.connectionId === null || ref.tableName === null) return null;
  if (ref.kind === 'shape') return resolveShape(sources, ref, ref.connectionId, ref.tableName);
  return resolveProfile(sources, ref, ref.connectionId, ref.tableName);
}

async function resolveShape(sources: PayableSources, ref: PayableRef, connectionId: string, tableName: string): Promise<ResolvedPayable | null> {
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

async function resolveProfile(sources: PayableSources, ref: PayableRef, connectionId: string, tableName: string): Promise<ResolvedPayable | null> {
  const profile = await sources.profile(connectionId, tableName);
  if (profile === null) return null;
  const found = await sources.table(connectionId, tableName);
  if (found === null) return null;
  const row = await sources.readRow(connectionId, tableName, ref.rowKey);
  if (row === null) return null;
  const mapping = profile.mapping;
  const label = mapping?.label === null || mapping === null ? ref.rowKey : String(row[mapping.label] ?? ref.rowKey);
  const base = { ref, label, dueDate: null, manualOnly: false, customerEmail: null as string | null, customerCountry: null as string | null };
  if (mapping === null || !profile.enabled) {
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
  else currency = await sources.connectionCurrency(connectionId);

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
          shapeColumns: false,
        };

  if (currency === null || !ISO.test(currency)) {
    return { ...base, ...people, currency: '', total: '0', due: '0', refusal: refused('NO_CURRENCY', 'This record has no currency.'), status: mapping.status, recordInto };
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
    : positive(due)
      ? null
      : refused('NOTHING_DUE', 'Nothing is due on this record.');
  return { ...base, ...people, currency, total, due, refusal, status: mapping.status, recordInto };
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
  // The designer keeps every total in hundredths, whatever the currency; the
  // amount must then be exact in the currency's own decimals (no yen cents).
  const hundredths = fromMinorUnits(document.totalMinor, 2);
  const total = hundredths === null ? null : exactAmount(hundredths, currencyScale(document.currency));
  if (total === null) {
    return { ...base, currency: document.currency, total: '0', due: '0', refusal: refused('AMOUNT_UNCLEAR', "This invoice's total is not clear.") };
  }
  const scale = currencyScale(document.currency);
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
      const records = await appTablesRepo(deps.meta).byTable(connectionId, tableName.includes('.') ? tableName.slice(tableName.indexOf('.') + 1) : tableName);
      const document = records.find((record) => /^invoices\/invoice@\d+#document$/.test(record.builtOn ?? ''));
      if (document === undefined) return null;
      const version = Number(/@(\d+)#/.exec(document.builtOn!)![1]);
      const siblings = await appTablesRepo(deps.meta).forInstall(connectionId, document.appKey);
      const payments = siblings.find((record) => record.builtOn === `invoices/invoice@${version}#payments`);
      if (payments === undefined) return { version, paymentsTable: null };
      const view = await viewFor(connectionId);
      const id = view?.model.tables.find((candidate) => candidate.name === payments.tableName)?.id ?? null;
      return { version, paymentsTable: id };
    },
    async connectionCurrency(connectionId) {
      return (await connectionTenantConfig(deps.meta, connectionId))?.currency ?? null;
    },
    async profile(connectionId, tableName) {
      const profile = await payableProfilesRepo(deps.meta).byTable(connectionId, tableName);
      return profile === null ? null : { id: profile.id, enabled: profile.enabled, mapping: profile.mapping };
    },
    keptPaid: (ref, currency) => keptPaymentsRepo(deps.meta).paid(ref, currency, 'live'),
    async testPayable(rowKey) {
      const test = await readTestPayable(deps.meta, rowKey);
      if (test === null) return null;
      const ref: PayableRef = { kind: 'document', connectionId: null, tableName: null, rowKey };
      return { label: test.label, currency: test.currency, amount: test.amount, provider: test.provider, paid: await keptPaymentsRepo(deps.meta).paid(ref, test.currency, 'test') };
    },
    async document(id) {
      const document = await invoiceDocumentsRepo(deps.meta).findById(id);
      if (document === null || document.kind !== 'invoice') return null;
      const body = document.body as Record<string, unknown>;
      const summary = (document.summary ?? {}) as Record<string, unknown>;
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
