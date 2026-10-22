// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  columnAlign,
  compareCellValues,
  dateOnlyValue,
  displayValueOf,
  formatCalendarDate,
  formatDisplayValue,
  currencyExponent,
  formatMoney,
  formatMoneyCell,
  formatRelativeTime,
  gridColumnSpecSchema,
  isNumericColumn,
  isMinorUnitMoney,
  maskedColumnsOf,
  minorToMajor,
  rowCurrencyOf,
  rowIdOf,
} from './column-spec.js';
import type { GridColumnSpec, GridColumnSpecInput } from './column-spec.js';

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

describe('gridColumnSpecSchema', () => {
  it('applies defaults', () => {
    const column = spec({ name: 'mrr', label: 'MRR' });
    expect(column.logicalType).toBe('text');
    expect(column.sortable).toBe(true);
    expect(column.pii).toBe(false);
    expect(column.nullable).toBe(true);
  });

  /**
   * Both new blocks are opt-in, and the claim that opt-in "changes nothing"
   * is only worth making if something asserts it: a stored column carrying
   * neither must parse to the same keys, in the same order, with the same
   * values as it did before they existed.
   */
  it('parses a column carrying neither new block exactly as it did before', () => {
    const parsed = spec({
      name: 'mrr',
      label: 'MRR',
      logicalType: 'decimal',
      semantic: 'money',
      format: 'currency',
    });
    expect(Object.keys(parsed)).toEqual([
      'name',
      'label',
      'logicalType',
      'semantic',
      'format',
      'pii',
      'mono',
      'sortable',
      'hidden',
      'primaryKey',
      'nullable',
      'hasDefault',
      'unique',
      'readOnly',
      'maxLength',
      'isDisplay',
    ]);
    expect('derived' in parsed).toBe(false);
    expect('display' in parsed).toBe(false);
  });
});

describe('the derived + display blocks', () => {
  it('reads a derived column pointing at a page-level definition', () => {
    const column = spec({
      name: 'total',
      label: 'Total',
      derived: { ref: 'total' },
      display: { kind: 'currency', decimals: 2 },
      sortable: false,
      readOnly: true,
    });
    expect(column.derived).toEqual({ ref: 'total' });
    expect(column.display).toEqual({ kind: 'currency', decimals: 2 });
  });

  it('refuses a ref the server would 422 on', () => {
    // Measure ids are SQL aliases as well as row keys.
    expect(() => spec({ name: 'x', label: 'X', derived: { ref: '1total' } })).toThrow();
    expect(() => spec({ name: 'x', label: 'X', derived: { ref: 'a-b' } })).toThrow();
  });

  it('requires percentScale on a percent column', () => {
    // `8` is 8% in a 0-100 tax_rate and 800% in a 0-1 ratio; guessing is a
    // 100x error on screen, so the scale is declared or the block is refused.
    expect(() => spec({ name: 'r', label: 'R', display: { kind: 'percent' } })).toThrow();
    expect(
      spec({ name: 'r', label: 'R', display: { kind: 'percent', percentScale: 'unit' } }).display,
    ).toEqual({ kind: 'percent', percentScale: 'unit' });
  });

  it('bounds currency and decimals', () => {
    expect(
      spec({ name: 'x', label: 'X', display: { kind: 'currency', currency: 'EUR' } }).display
        ?.currency,
    ).toBe('EUR');
    expect(() =>
      spec({ name: 'x', label: 'X', display: { kind: 'currency', currency: 'EURO' } }),
    ).toThrow();
    expect(() => spec({ name: 'x', label: 'X', display: { kind: 'decimal', decimals: 7 } })).toThrow();
    // `parse` rather than the typed helper: an unknown kind is a compile
    // error at an authoring site, and this asserts the runtime refusal a
    // hand-edited stored config would hit.
    expect(() =>
      gridColumnSpecSchema.parse({ name: 'x', label: 'X', display: { kind: 'money' } }),
    ).toThrow();
  });
});

describe('compareCellValues — the string-mrr numeric sort fix (ia-mapping)', () => {
  const mrr = spec({ name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money' });

  it('sorts numerically when pg serializes decimals as strings', () => {
    // Lexicographic would order "1290" < "290" < "6100" < "980" — wrong.
    const values = ['980', '6100', '290', '1290'];
    const sorted = [...values].sort((a, b) => compareCellValues(mrr, a, b));
    expect(sorted).toEqual(['290', '980', '1290', '6100']);
  });

  it('sorts mixed number/string values numerically (client-added row defect)', () => {
    const values: unknown[] = [4820, '980', 6100, '1290'];
    const sorted = [...values].sort((a, b) => compareCellValues(mrr, a, b));
    expect(sorted).toEqual(['980', '1290', 4820, 6100]);
  });

  it('keeps malformed numerics deterministic (sorted last)', () => {
    const values: unknown[] = ['n/a', '10', 5];
    const sorted = [...values].sort((a, b) => compareCellValues(mrr, a, b));
    expect(sorted).toEqual([5, '10', 'n/a']);
  });

  it('nulls sort first, booleans false<true, timestamps chronologically', () => {
    expect(compareCellValues(mrr, null, '5')).toBeLessThan(0);
    const flag = spec({ name: 'ok', label: 'OK', logicalType: 'boolean' });
    expect(compareCellValues(flag, false, true)).toBeLessThan(0);
    const at = spec({ name: 'at', label: 'At', logicalType: 'timestamptz' });
    expect(compareCellValues(at, '2026-01-02T00:00:00Z', '2026-01-10T00:00:00Z')).toBeLessThan(0);
  });

  it('integer logicalType counts as numeric even without semantics', () => {
    expect(isNumericColumn(spec({ name: 'seats', label: 'Seats', logicalType: 'integer' }))).toBe(true);
    expect(isNumericColumn(spec({ name: 'name', label: 'Name', logicalType: 'varchar' }))).toBe(false);
  });
});

describe('columnAlign', () => {
  it('end-aligns a plain number and start-aligns an FK chip over an integer id', () => {
    expect(columnAlign(spec({ name: 'seats', label: 'Seats', logicalType: 'integer' }))).toBe('end');
    const fk = { table: 'main.employees', column: 'id' };
    expect(columnAlign(spec({ name: 'manager_id', label: 'Manager', logicalType: 'integer', fk }))).toBe('start');
    expect(columnAlign(spec({ name: 'manager_id', label: 'Manager', logicalType: 'integer', fk, align: 'end' }))).toBe('end');
  });
});

describe('formatMoney with an explicit decimals', () => {
  it('renders a whole and a fractional value at the SAME width', () => {
    // The defect: `maximumFractionDigits: Number.isInteger(x) ? 0 : 2` makes
    // one money column render `$1,234` directly above `$1,234.50`.
    expect(formatMoney('1234', { locale: 'en-US', currency: 'USD', decimals: 2 })).toBe('$1,234.00');
    expect(formatMoney('1234.50', { locale: 'en-US', currency: 'USD', decimals: 2 })).toBe('$1,234.50');
  });

  it('keeps the historical per-value flip when decimals is absent', () => {
    // `GroupedSummaryTable` calls formatMoney with `{locale}` only.
    expect(formatMoney(1234, { locale: 'en-US', currency: 'USD' })).toBe('$1,234');
    expect(formatMoney(1234.5, { locale: 'en-US', currency: 'USD' })).toBe('$1,234.50');
    expect(formatMoney('1234', { locale: 'en-US', currency: 'USD' })).toBe('$1,234');
    expect(formatMoney('1234.00', { locale: 'en-US', currency: 'USD' })).toBe('$1,234');
  });

  it('formats a decimal STRING exactly, where Number() would lose digits', () => {
    // Measured: the same value through `Number()` renders ...800.00.
    expect(formatMoney('1234567890123456789.55', { locale: 'en-US', currency: 'USD', decimals: 2 })).toBe(
      '$1,234,567,890,123,456,789.55',
    );
  });

  it('leaves a non-numeric value alone rather than rendering $0', () => {
    expect(formatMoney('n/a', { locale: 'en-US' })).toBe('n/a');
    expect(formatMoney('', { locale: 'en-US' })).toBe('');
  });

  it('honours a per-column currency', () => {
    expect(formatMoney('1234.50', { locale: 'en-US', currency: 'EUR', decimals: 2 })).toBe(
      '€1,234.50',
    );
  });
});

describe('formatDisplayValue — the opt-in display block (D8/D9)', () => {
  it('renders each kind', () => {
    expect(formatDisplayValue('1367.28', { kind: 'currency', decimals: 2 }, { locale: 'en-US', currency: 'USD' })).toBe(
      '$1,367.28',
    );
    expect(formatDisplayValue('1266', { kind: 'decimal', decimals: 3 }, { locale: 'en-US' })).toBe(
      '1,266.000',
    );
    expect(formatDisplayValue('1266.7', { kind: 'integer' }, { locale: 'en-US' })).toBe('1,267');
  });

  it('reads percentScale, which is why it is mandatory', () => {
    // The same `8` is 8% on a 0-100 tax_rate and 800% on a 0-1 ratio.
    expect(
      formatDisplayValue('8', { kind: 'percent', percentScale: 'unit', decimals: 2 }, { locale: 'en-US' }),
    ).toBe('8.00%');
    expect(
      formatDisplayValue(
        '0.08',
        { kind: 'percent', percentScale: 'fraction', decimals: 2 },
        { locale: 'en-US' },
      ),
    ).toBe('8.00%');
  });

  it('ranks the block currency above the connection currency', () => {
    expect(
      formatDisplayValue('10', { kind: 'currency', currency: 'GBP' }, { locale: 'en-US', currency: 'EUR' }),
    ).toBe('£10.00');
    expect(formatDisplayValue('10', { kind: 'currency' }, { locale: 'en-US', currency: 'EUR' })).toBe(
      '€10.00',
    );
    // No currency anywhere: the number, never a guessed dollar (walk fix E3).
    expect(formatDisplayValue('10', { kind: 'currency' }, { locale: 'en-US' })).toBe('10.00');
  });

  it('leaves a value it cannot read alone', () => {
    expect(formatDisplayValue('draft', { kind: 'currency' }, { locale: 'en-US' })).toBe('draft');
  });
});

describe('formatMoney / formatRelativeTime', () => {
  it('formats currency from string amounts', () => {
    expect(formatMoney('4820', { currency: 'USD' })).toBe('$4,820');
    expect(formatMoney(12.5, { currency: 'EUR' })).toBe('€12.50');
  });
  it('falls back to the raw value for non-numbers', () => {
    expect(formatMoney('n/a')).toBe('n/a');
  });
  it('renders relative time', () => {
    const now = Date.UTC(2026, 5, 1, 12, 0, 0);
    expect(formatRelativeTime('2026-06-01T09:00:00Z', { now })).toMatch(/3\s?hr?\.? ago/i);
  });
});

describe('dateOnlyValue / formatCalendarDate — DATE wire decode', () => {
  it('recovers the writer calendar day from a server-local-midnight instant', () => {
    expect(dateOnlyValue('2026-05-28T22:00:00.000Z')).toBe('2026-05-29'); // UTC+2 writer (audit repro)
    expect(dateOnlyValue('2026-05-29T00:00:00.000Z')).toBe('2026-05-29'); // UTC writer
    expect(dateOnlyValue('2026-05-29T04:00:00.000Z')).toBe('2026-05-29'); // UTC−4 writer
    expect(dateOnlyValue('2026-05-29')).toBe('2026-05-29'); // sqlite/plain passthrough
  });

  it('formats the recovered day at UTC so no viewer zone re-shifts it', () => {
    expect(formatCalendarDate('2026-05-28T22:00:00.000Z')).toBe('May 29, 2026');
    // Locale plumbing: any rendering carries day 29, never the UTC day 28.
    const de = formatCalendarDate('2026-05-28T22:00:00.000Z', 'de');
    expect(de).toContain('29');
    expect(de).not.toContain('28');
    // Raw fallback for non-dates, like formatMoney; empties stay empty.
    expect(formatCalendarDate('n/a')).toBe('n/a');
    expect(formatCalendarDate(null)).toBe('');
  });
});

describe('row identity helpers', () => {
  const columns = [
    spec({ name: 'id', label: 'ID', primaryKey: true }),
    spec({ name: 'name', label: 'Name', isDisplay: true }),
  ];
  it('rowIdOf uses the PK; composite PKs serialize as JSON tuples', () => {
    expect(rowIdOf(columns, { id: 7, name: 'Acme' })).toBe('7');
    const composite = [
      spec({ name: 'a', label: 'A', primaryKey: true }),
      spec({ name: 'b', label: 'B', primaryKey: true }),
    ];
    expect(rowIdOf(composite, { a: 1, b: 'x' })).toBe('[1,"x"]');
  });
  it('displayValueOf prefers the display column, falls back to the PK', () => {
    expect(displayValueOf(columns, { id: 7, name: 'Acme' })).toBe('Acme');
    expect(displayValueOf(columns, { id: 7, name: '' })).toBe('7');
  });
  it('maskedColumnsOf reads the server _masked marker', () => {
    expect(maskedColumnsOf({ phone: null, _masked: ['phone'] })).toEqual(['phone']);
    expect(maskedColumnsOf({ phone: '+1' })).toEqual([]);
  });
});

/**
 * Walk fix E3 (2026-10-22): an `orders.amount_cents` of 4900 on an EUR row
 * read "$4,900" — no minor-unit scale, the row's own currency ignored, and a
 * US dollar nobody chose.
 */
describe('money in minor units and the row currency (walk fix E3)', () => {
  const cents = spec({ name: 'amount_cents', label: 'Amount Cents', logicalType: 'integer', semantic: 'money', format: 'currency-cents' });
  const total = spec({ name: 'total', label: 'Total', logicalType: 'decimal', semantic: 'money', format: 'currency' });

  it('reads the owner\'s row as €49.00', () => {
    expect(formatMoneyCell(cents, { amount_cents: 4900, currency: 'EUR' }, { locale: 'en-US' })).toBe('€49.00');
  });

  it('scales by the currency\'s own exponent: JPY 0, KWD 3', () => {
    expect(formatMoneyCell(cents, { amount_cents: 4900, currency: 'JPY' }, { locale: 'en-US' })).toBe('¥4,900');
    expect(formatMoneyCell(cents, { amount_cents: 15000, currency: 'KWD' }, { locale: 'en-US' })).toMatch(/^KWD\s15\.000$/);
    expect(formatMoneyCell(cents, { amount_cents: '4900', currency: 'usd' }, { locale: 'en-US' })).toBe('$49.00');
  });

  it('the row currency beats the page\'s; the page\'s is used when the row has none', () => {
    expect(formatMoneyCell(cents, { amount_cents: 4900, currency: 'EUR' }, { locale: 'en-US', currency: 'USD' })).toBe('€49.00');
    expect(formatMoneyCell(cents, { amount_cents: 4900 }, { locale: 'en-US', currency: 'GBP' })).toBe('£49.00');
    expect(formatMoneyCell(cents, { amount_cents: 4900, currency: '' }, { locale: 'en-US', currency: 'GBP' })).toBe('£49.00');
  });

  it('with no currency anywhere: the plain number, scaled, never a "$"', () => {
    expect(formatMoneyCell(cents, { amount_cents: 4900 }, { locale: 'en-US' })).toBe('49.00');
    expect(formatMoneyCell(total, { total: 1234.5 }, { locale: 'en-US' })).toBe('1,234.50');
    expect(formatMoney(1234, { locale: 'en-US' })).toBe('1,234');
    expect(formatMoney(1234, { locale: 'en-US', currency: '' })).toBe('1,234');
  });

  it('money in major units is not rescaled, but takes the row currency too', () => {
    expect(formatMoneyCell(total, { total: '49.5', currency: 'EUR' }, { locale: 'en-US' })).toBe('€49.50');
  });

  it('a column retagged away from money, or one without the minor format, is never divided', () => {
    // An override keeps the stored format but changes the tag: the tag decides.
    expect(isMinorUnitMoney({ semantic: 'plain', format: 'currency-cents' })).toBe(false);
    expect(isMinorUnitMoney({ semantic: 'money', format: 'currency' })).toBe(false);
    expect(isMinorUnitMoney({ semantic: 'money', format: null })).toBe(false);
    expect(isMinorUnitMoney(cents)).toBe(true);
  });

  it('prefers the column\'s own *_currency, then currency/currency_code, and only an ISO code', () => {
    expect(rowCurrencyOf({ amount_cents: 1, amount_currency: 'JPY', currency: 'EUR' }, 'amount_cents')).toBe('JPY');
    expect(rowCurrencyOf({ amount_cents: 1, fee_currency: 'JPY', currency: 'EUR' }, 'amount_cents')).toBe('EUR');
    expect(rowCurrencyOf({ amount_cents: 1, currency_code: 'kwd' }, 'amount_cents')).toBe('KWD');
    expect(rowCurrencyOf({ amount_cents: 1, currencyCode: 'CHF' }, 'amount_cents')).toBe('CHF');
    expect(rowCurrencyOf({ amount_cents: 1, currency_id: 'EUR' }, 'amount_cents')).toBeUndefined();
    expect(rowCurrencyOf({ amount_cents: 1, currency: 7 }, 'amount_cents')).toBeUndefined();
    expect(rowCurrencyOf({ amount_cents: 1, currency: 'euro' }, 'amount_cents')).toBeUndefined();
  });

  it('shifts the decimal point exactly, bigint strings included', () => {
    expect(minorToMajor(4900, 2)).toBe('49.00');
    expect(minorToMajor(5, 2)).toBe('0.05');
    expect(minorToMajor(-125, 2)).toBe('-1.25');
    expect(minorToMajor(15000, 3)).toBe('15.000');
    expect(minorToMajor(4900, 0)).toBe('4900');
    expect(minorToMajor('123456789012345678901', 2)).toBe('1234567890123456789.01');
    expect(minorToMajor('n/a', 2)).toBeNull();
  });

  it('knows each currency\'s exponent from Intl', () => {
    expect([currencyExponent('EUR'), currencyExponent('USD'), currencyExponent('JPY')]).toEqual([2, 2, 0]);
    expect(['KWD', 'BHD', 'JOD', 'OMR', 'TND'].map(currencyExponent)).toEqual([3, 3, 3, 3, 3]);
    expect(currencyExponent(undefined)).toBe(2);
  });
});
