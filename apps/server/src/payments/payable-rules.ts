// SPDX-License-Identifier: AGPL-3.0-only
/**
 * May this table be marked payable with this mapping?
 *
 * A pure check of a mapping against the table's effective schema (and the
 * payments table it names, when payments land in one), before anything is
 * saved. Every problem is reported, each with the mapping field it is about,
 * so the wizard can show it beside the right control:
 *
 *   - the amount is a number Adminium can count exactly: never a float; an
 *     integer column says whether it holds whole units or cents; a decimal
 *     column holds at least the currency's decimals;
 *   - the currency resolves to a code (a column, a fixed code, or the
 *     connection's own currency, which must be set);
 *   - a table that keeps its own payments names its balance column, and its
 *     payments table names a column that is UNIQUE for each payment, so a
 *     payment can never be written twice;
 *   - the status Adminium may set has a list of values (`valuesOf`: yes/no,
 *     an enum whatever its logical type, Adminium's own list), and never a key, a link, a column Adminium decides
 *     (a sequence, a formula, a stamp…), a personal or secret column;
 *   - the pay page shows only declared fields, none personal or secret;
 *   - no column belongs to a private table.
 *
 * Who may mark it (payments.manage, read and update with no row limit,
 * create on the payments table) is the route's to check: it needs the person.
 */
import { currencyScale } from '@adminium/manifest';
import type { ParsedPayableMapping } from '@adminium/meta';

import type { EffectiveColumn, EffectiveModel, EffectiveTable } from '../connections/effective-schema.js';

export const PAYABLE_ISSUES = [
  /** The table is private, excluded, or not in the schema. */
  'TABLE_UNAVAILABLE',
  /** A column the mapping names is not in the table. */
  'NO_SUCH_COLUMN',
  /** The amount (or balance) column does not hold a number Adminium can count exactly. */
  'NOT_A_MONEY_COLUMN',
  /** An integer amount column: say whether it holds whole units or the smallest unit. */
  'NEEDS_UNIT',
  /** A decimal column with fewer decimal places than the currency has. */
  'TOO_FEW_DECIMALS',
  /** The currency resolves to nothing (no column, code or connection currency). */
  'NO_CURRENCY',
  /** The payments table's reference column is not unique for each payment. */
  'REFERENCE_NOT_UNIQUE',
  /** The way-to-pay value map is empty. */
  'NO_METHOD_VALUES',
  /** The status column is not an enum, yes/no or text column with its own value list. */
  'STATUS_NOT_A_CHOICE',
  /** The status column is a key, a link, decided by Adminium, personal or secret. */
  'STATUS_NOT_WRITABLE',
  /** The paid (or refunded) value is not one of the status column's values. */
  'STATUS_VALUE_UNKNOWN',
  /** A pay page field is personal, secret or masked. */
  'FIELD_PERSONAL',
  /** A way-to-pay value is not one of the payments table's method column values. */
  'METHOD_VALUE_UNKNOWN',
] as const;
export type PayableIssueCode = (typeof PAYABLE_ISSUES)[number];

export interface PayableIssue {
  code: PayableIssueCode;
  /** The mapping field it is about (`amount`, `payments.reference`, `pageFields`…). */
  path: string;
  /** The column it is about, when there is one. */
  column: string | null;
}

export interface PayableRulesInput {
  model: Pick<EffectiveModel, 'tables' | 'enums'>;
  /** The table being marked, by id. */
  tableId: string;
  mapping: ParsedPayableMapping;
  /** The connection's own currency (Settings → Regional), or null. */
  connectionCurrency: string | null;
}

const NUMBER_TYPES = new Set(['integer', 'bigint', 'decimal']);
const WHOLE_TYPES = new Set(['integer', 'bigint']);

/** A column whose value Adminium works out itself: never one it may also set. */
function decided(column: EffectiveColumn): boolean {
  return (
    column.isGenerated === true ||
    column.sequence !== undefined ||
    column.code !== undefined ||
    column.formula !== undefined ||
    column.rollup !== undefined ||
    column.stamp !== undefined ||
    column.copy !== undefined ||
    column.fill !== undefined
  );
}

/** A key, or a column that points at another row. */
function keyOrLink(column: EffectiveColumn): boolean {
  return (
    column.isPrimaryKey ||
    (column.references !== null && column.references !== undefined) ||
    column.lookup !== undefined ||
    column.addOnLink !== undefined ||
    column.addOnLookup !== undefined ||
    column.tableRef === true
  );
}

function personal(column: EffectiveColumn): boolean {
  return column.semantics?.flags.pii != null || column.semantics?.flags.secret === true || column.masked === true;
}

function unique(table: EffectiveTable, column: EffectiveColumn): boolean {
  if (column.isUnique === true || column.isPrimaryKey) return true;
  return (table.indexes ?? []).some((index) => index.unique === true && index.partial !== true && index.columns.length === 1 && index.columns[0] === column.name);
}

/**
 * The values a status (or way-to-pay) column may hold, or null when it has no
 * list. One rule, the wizard's too (`PayablesTab.tsx statusValuesOf`):
 *   - yes/no: `true`, `false`;
 *   - a column with an enum (`enumRef`), whatever its logical type: the enum's
 *     values (a SQLite CHECK list reads as a `text` column with an enum);
 *   - a column with Adminium's own value list: those values;
 *   - anything else: none.
 */
export function valuesOf(model: Pick<PayableRulesInput['model'], 'enums'>, column: EffectiveColumn): readonly string[] | null {
  if (column.logicalType === 'boolean') return ['true', 'false'];
  if (column.enumRef !== null && column.enumRef !== undefined && column.enumRef !== '') {
    const found = model.enums.find((one) => one.id === column.enumRef || one.name === column.enumRef);
    if (found !== undefined) return found.values.map(String);
  }
  const options = column.options;
  if (options !== undefined && 'values' in options) return options.values.map((item) => String((item as { value: unknown }).value));
  return null;
}

/** Every problem with marking this table payable this way. Empty when it may be saved. */
export function payableIssues(input: PayableRulesInput): PayableIssue[] {
  const { model, mapping } = input;
  const issues: PayableIssue[] = [];
  const add = (code: PayableIssueCode, path: string, column: string | null = null) => issues.push({ code, path, column });
  const table = model.tables.find((one) => one.id === input.tableId);
  if (table === undefined || table.private === true || table.excluded === true) {
    add('TABLE_UNAVAILABLE', 'table');
    return issues;
  }
  const columnOf = (owner: EffectiveTable, name: string, path: string): EffectiveColumn | null => {
    const found = owner.columns.find((one) => one.name === name);
    if (found === undefined) add('NO_SUCH_COLUMN', path, name);
    return found ?? null;
  };

  // ─── The currency, first: the amount's decimals are judged against it ────
  let currency: string | null = null;
  if ('fixed' in mapping.currency) currency = mapping.currency.fixed;
  else if ('connection' in mapping.currency) {
    currency = input.connectionCurrency;
    if (currency === null) add('NO_CURRENCY', 'currency');
  } else columnOf(table, mapping.currency.column, 'currency');

  // ─── The amount ──────────────────────────────────────────────────────────
  const amount = columnOf(table, mapping.amount.column, 'amount');
  if (amount !== null) {
    if (!NUMBER_TYPES.has(amount.logicalType)) add('NOT_A_MONEY_COLUMN', 'amount', amount.name);
    else if (WHOLE_TYPES.has(amount.logicalType) && mapping.amount.unit === null) add('NEEDS_UNIT', 'amount.unit', amount.name);
    else if (amount.logicalType === 'decimal' && currency !== null) {
      const scale = amount.numericScale ?? (typeof amount.scale === 'number' ? amount.scale : null);
      if (scale !== null && scale < currencyScale(currency)) add('TOO_FEW_DECIMALS', 'amount', amount.name);
    }
  }

  // ─── The balance ─────────────────────────────────────────────────────────
  if (mapping.due !== null) {
    const due = columnOf(table, mapping.due.column, 'due');
    if (due !== null && !NUMBER_TYPES.has(due.logicalType)) add('NOT_A_MONEY_COLUMN', 'due', due.name);
    // The balance is read in the amount's unit: an integer balance needs that unit said.
    else if (due !== null && WHOLE_TYPES.has(due.logicalType) && mapping.amount.unit === null) add('NEEDS_UNIT', 'amount.unit', due.name);
    else if (due !== null && due.logicalType === 'decimal' && currency !== null) {
      const scale = due.numericScale ?? (typeof due.scale === 'number' ? due.scale : null);
      if (scale !== null && scale < currencyScale(currency)) add('TOO_FEW_DECIMALS', 'due', due.name);
    }
  }

  // ─── Where payments land ─────────────────────────────────────────────────
  if (mapping.payments.kind === 'table') {
    const own = mapping.payments;
    const payments = model.tables.find((one) => one.id === own.table || one.name === own.table);
    if (payments === undefined || payments.private === true || payments.excluded === true) {
      add('TABLE_UNAVAILABLE', 'payments.table');
    } else {
      columnOf(payments, own.link, 'payments.link');
      const paid = columnOf(payments, own.amount, 'payments.amount');
      if (paid !== null && !NUMBER_TYPES.has(paid.logicalType)) add('NOT_A_MONEY_COLUMN', 'payments.amount', paid.name);
      else if (paid !== null && paid.logicalType === 'decimal' && currency !== null && own.amountUnit === 'units') {
        const scale = paid.numericScale ?? (typeof paid.scale === 'number' ? paid.scale : null);
        if (scale !== null && scale < currencyScale(currency)) add('TOO_FEW_DECIMALS', 'payments.amount', paid.name);
      }
      columnOf(payments, own.date, 'payments.date');
      const way = columnOf(payments, own.method.column, 'payments.method');
      if (Object.keys(own.method.values).length === 0) add('NO_METHOD_VALUES', 'payments.method.values');
      // A method column with its own value list takes only those values.
      const allowed = way === null ? null : valuesOf(model, way);
      if (allowed !== null && Object.values(own.method.values).some((value) => !allowed.includes(value))) add('METHOD_VALUE_UNKNOWN', 'payments.method.values', way!.name);
      if (own.note !== null) columnOf(payments, own.note, 'payments.note');
      if (own.voided !== null) columnOf(payments, own.voided, 'payments.voided');
      const reference = columnOf(payments, own.reference, 'payments.reference');
      if (reference !== null && !unique(payments, reference)) add('REFERENCE_NOT_UNIQUE', 'payments.reference', reference.name);
    }
  }

  // ─── The status Adminium may set ─────────────────────────────────────────
  if (mapping.status !== null) {
    const status = columnOf(table, mapping.status.column, 'status');
    if (status !== null) {
      const values = valuesOf(model, status);
      if (keyOrLink(status) || decided(status) || personal(status)) add('STATUS_NOT_WRITABLE', 'status', status.name);
      else if (values === null) add('STATUS_NOT_A_CHOICE', 'status', status.name);
      else {
        if (!values.includes(mapping.status.paid)) add('STATUS_VALUE_UNKNOWN', 'status.paid', status.name);
        if (mapping.status.refunded !== null && !values.includes(mapping.status.refunded)) add('STATUS_VALUE_UNKNOWN', 'status.refunded', status.name);
      }
    }
  }

  // ─── What the pay page and staff lists show ──────────────────────────────
  for (const name of [...mapping.pageFields, ...(mapping.label === null ? [] : [mapping.label])]) {
    const shown = columnOf(table, name, name === mapping.label ? 'label' : 'pageFields');
    if (shown !== null && personal(shown)) add('FIELD_PERSONAL', name === mapping.label ? 'label' : 'pageFields', shown.name);
  }
  if (mapping.customerEmail !== null) columnOf(table, mapping.customerEmail, 'customerEmail');
  if (mapping.customerCountry !== null) columnOf(table, mapping.customerCountry, 'customerCountry');
  return issues;
}
