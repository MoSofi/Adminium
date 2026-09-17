// SPDX-License-Identifier: AGPL-3.0-only
import { getFormatters, latnDataTag } from '@adminium/i18n';
import type { Tone } from '@adminium/ui';

import type {
  ColumnDisplay,
  GridColumnSpec,
  GridLogicalType,
  GridRow,
  GridTone,
} from '../../page-config/grid-column-spec.js';

/**
 * Column-spec helpers for the `tables` family + `page-crud` template
 * (research/widget-registry.md; `config.columns`).
 *
 * The schema + types themselves live in the page-config pure leaf
 * (`../../page-config/grid-column-spec.ts`) so the generator leaf's crud-body
 * composer and `@adminium/engine/config` can share them without touching
 * component code or this module's `@adminium/i18n` dependency. Re-exported
 * here verbatim — this stays the `tables`-family import site.
 */
export {
  COLUMN_DISPLAY_KINDS,
  COLUMN_FILE_REFS,
  GRID_LOGICAL_TYPES,
  GRID_SEMANTICS,
  columnDisplaySchema,
  columnFileSchema,
  fkDisplayAliasOf,
  gridColumnSpecSchema,
  gridLogicalTypeSchema,
  type ColumnDisplay,
  type ColumnDisplayKind,
  type ColumnFile,
  type ColumnFileRef,
  type GridColumnSpec,
  type GridColumnSpecInput,
  type GridLogicalType,
  type GridRow,
  type GridSemantic,
  type GridTone,
} from '../../page-config/grid-column-spec.js';

/**
 * Stored `GridTone` → `@adminium/ui` tone. `'muted'` (the generator/LLM
 * fallback for enum values outside the rule-7 keyword map) renders as the
 * neutral treatment (surface-3 + fg-muted) — the ui vocabulary has no separate
 * muted tone.
 */
export function uiToneOf(tone: GridTone): Tone {
  return tone === 'muted' ? 'neutral' : tone;
}

/** Server-mask marker (apps/server/src/crud/mask.ts): masked column names. */
export function maskedColumnsOf(row: GridRow): readonly string[] {
  const marker = row['_masked'];
  return Array.isArray(marker) ? (marker as string[]) : [];
}

const NUMERIC_TYPES: ReadonlySet<GridLogicalType> = new Set([
  'integer',
  'bigint',
  'decimal',
  'float',
]);

const TIME_TYPES: ReadonlySet<GridLogicalType> = new Set([
  'date',
  'time',
  'timestamp',
  'timestamptz',
]);

/** Numeric column: numeric logical type or money/percent/score semantics. */
export function isNumericColumn(column: GridColumnSpec): boolean {
  // An explicit `display` block is the strongest statement there is about a
  // column's kind — and a DERIVED column has no useful `logicalType` (it
  // defaults to `text`) or `semantic` to fall back on, so without this a
  // computed total would left-align and sort lexicographically.
  if (column.display !== undefined) return true;
  if (NUMERIC_TYPES.has(column.logicalType)) return true;
  return column.semantic === 'money' || column.semantic === 'percent' || column.semantic === 'score';
}

export function isTemporalColumn(column: GridColumnSpec): boolean {
  return TIME_TYPES.has(column.logicalType) || column.semantic === 'created-at' || column.semantic === 'updated-at' || column.semantic === 'event-timestamp';
}

/** End-align money and plain numbers (comp keeper: mono end-aligned). */
export function columnAlign(column: GridColumnSpec): 'start' | 'end' {
  if (column.align !== undefined) return column.align;
  return isNumericColumn(column) ? 'end' : 'start';
}

function toEpoch(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Type-aware cell comparator — THE Data Table string-mrr sort fix: pg
 * serializes `int8`/`decimal` as strings (type rules) and client-added rows
 * may carry strings too, so numeric columns coerce through `Number()` and
 * NEVER fall back to the lexicographic path ("980" < "6100", not "6100" <
 * "980").
 */
export function compareCellValues(column: GridColumnSpec, a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull && bNull ? 0 : aNull ? -1 : 1;
  if (isNumericColumn(column)) {
    const an = typeof a === 'number' ? a : Number(a);
    const bn = typeof b === 'number' ? b : Number(b);
    const aOk = Number.isFinite(an);
    const bOk = Number.isFinite(bn);
    if (aOk && bOk) return an < bn ? -1 : an > bn ? 1 : 0;
    if (aOk !== bOk) return aOk ? -1 : 1; // malformed values sort last, deterministically
  }
  if (column.logicalType === 'boolean') {
    return Number(a === true) - Number(b === true);
  }
  if (isTemporalColumn(column)) {
    return toEpoch(a) - toEpoch(b);
  }
  return String(a).localeCompare(String(b));
}

/**
 * What `Intl` will format exactly: a decimal string, with an optional sign and
 * an optional exponent. Deliberately NOT `Number(v)`: Postgres and MySQL hand
 * every decimal back as a string, and coercing one loses digits past 15
 * significant figures — the difference between `$1,234,567,890,123,456,789.55`
 * and `…800.00`.
 */
const DECIMAL_INPUT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A cell value in the shape `Intl` can format losslessly, or `null` when it is
 * not a number at all.
 *
 * A STRING passes through untouched — that is the whole change. Everything
 * else keeps the coercion this function has always done, so a boolean or a
 * `null` renders exactly what it rendered before.
 */
function numericInput(value: unknown): number | string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return DECIMAL_INPUT.test(trimmed) ? trimmed : null;
  }
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** Whether a value has no fractional part — the absent-`decimals` default. */
function isWholeInput(value: number | string): boolean {
  return typeof value === 'number' ? Number.isInteger(value) : !/\.\d*[1-9]/.test(value);
}

/**
 * Locale/currency formatting for money cells (Intl, config override wins).
 *
 * `decimals` is OPTIONAL and its absence keeps the historical behaviour
 * exactly: fraction digits flip per value (`Number.isInteger(x) ? 0: 2`),
 * which is how one column renders `$1,234` directly above `$1,234.50`.
 * `GroupedSummaryTable` calls this with `{locale}` only and must not move, so
 * the flip stays the default rather than becoming a special case. A column
 * that wants a stable width says so.
 */
export function formatMoney(
  value: unknown,
  options?: {
    locale?: string | undefined;
    currency?: string | undefined;
    decimals?: number | undefined;
  },
): string {
  const amount = numericInput(value);
  if (amount === null) return String(value ?? '');
  const decimals = options?.decimals;
  // Money is a mono grid cell → data context (latn digits) via the format layer.
  // `|| 'USD'` (not `??`) so a schema-valid empty currency code coalesces too —
  // `{ style: 'currency', currency: '' }` would otherwise throw a RangeError.
  return getFormatters(options?.locale ?? 'en-US').number(amount, {
    style: 'currency',
    currency: options?.currency || 'USD',
    ...(decimals === undefined
      ? { maximumFractionDigits: isWholeInput(amount) ? 0 : 2 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  });
}

/** Digits a `display` block shows when it does not say. */
const DEFAULT_DISPLAY_DECIMALS = 2;

/**
 * Render one value through an explicit {@link ColumnDisplay} block — the
 * opt-in override of the semantic chain.
 *
 * The percent branch is the reason `percentScale` is mandatory: `8` means 8%
 * in a 0-100 `tax_rate` column and 800% in a 0-1 ratio column, and `Intl`'s
 * `style: 'percent'` multiplies by 100. `'unit'` therefore formats the number
 * and appends the sign; `'fraction'` hands it to Intl. Guessing either way is
 * a 100x error on screen (D9).
 */
export function formatDisplayValue(
  value: unknown,
  display: ColumnDisplay,
  options?: { locale?: string | undefined; currency?: string | undefined },
): string {
  const amount = numericInput(value);
  if (amount === null) return String(value ?? '');
  const locale = options?.locale ?? 'en-US';
  const decimals = display.decimals ?? DEFAULT_DISPLAY_DECIMALS;
  if (display.kind === 'currency') {
    return formatMoney(amount, {
      locale: options?.locale,
      currency: display.currency ?? options?.currency,
      decimals,
    });
  }
  if (display.kind === 'percent') {
    if (display.percentScale === 'fraction') {
      return getFormatters(locale).percent(amount, { fractionDigits: decimals });
    }
    return `${getFormatters(locale).number(amount, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}%`;
  }
  if (display.kind === 'integer') {
    return getFormatters(locale).number(amount, { maximumFractionDigits: 0 });
  }
  return getFormatters(locale).number(amount, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const RELATIVE_STEPS: readonly { limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60_000, divisor: 1000, unit: 'second' },
  { limit: 3_600_000, divisor: 60_000, unit: 'minute' },
  { limit: 86_400_000, divisor: 3_600_000, unit: 'hour' },
  { limit: 2_592_000_000, divisor: 86_400_000, unit: 'day' },
  { limit: 31_536_000_000, divisor: 2_592_000_000, unit: 'month' },
];

/** Relative timestamp ("3h ago") with an absolute ISO fallback for bad input. */
export function formatRelativeTime(value: unknown, options?: { locale?: string | undefined; now?: number | undefined }): string {
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  if (Number.isNaN(time)) return String(value ?? '');
  const delta = time - (options?.now ?? Date.now());
  const magnitude = Math.abs(delta);
  // Grid-cell relative time is a mono/data cell → latn digits; the
  // format layer's relative() is prose-only, so pin the numbering here.
  const formatter = new Intl.RelativeTimeFormat(latnDataTag(options?.locale ?? 'en-US'), {
    numeric: 'auto',
    style: 'narrow',
  });
  for (const step of RELATIVE_STEPS) {
    if (magnitude < step.limit) return formatter.format(Math.round(delta / step.divisor), step.unit);
  }
  return formatter.format(Math.round(delta / 31_536_000_000), 'year');
}

/** Absolute timestamp for the cell `title` tooltip. */
export function formatAbsoluteTime(value: unknown, locale?: string): string {
  const time = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(time.getTime())) return String(value ?? '');
  // Data context (latn digits + gregorian) via the format layer.
  return getFormatters(locale ?? 'en-US').dateTime(time);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a `date` column value to its `YYYY-MM-DD` calendar day — the
 * shape the native date input, the server's write path (apps/server
 * data-io/coerce.ts stores dates as plain date strings), and
 * `formatCalendarDate` below all want.
 *
 * A postgres DATE crosses the wire as the driver's server-local-midnight
 * Date, JSON-serialized to a UTC instant: `date '2026-05-29'` read on a
 * UTC+2 host arrives as '2026-05-28T22:00:00.000Z'. Slicing that instant
 * (or reading it with local getters) lands one day off whenever reader
 * midnight and writer midnight straddle the instant — the audit-visible
 * −1-day shift on untouched edit saves. Reading the instant at +12h
 * recovers the writer's calendar day for any writer offset in (−12, +12]
 * without knowing the writer's zone. Plain date strings (sqlite rows, csv
 * imports, user-picked input values) pass through, and unparseable values
 * pass through for the database to reject.
 */
export function dateOnlyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Date(parsed.getTime() + 12 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Locale calendar day for `date` cells — decoded via `dateOnlyValue`, then
 * formatted AT UTC so no viewer zone can re-shift the recovered day.
 */
export function formatCalendarDate(value: unknown, locale?: string): string {
  const day = dateOnlyValue(value);
  if (!DATE_ONLY.test(day)) return day; // '' and unparseable values fall through raw
  return getFormatters(locale ?? 'en-US').date(new Date(`${day}T00:00:00Z`), 'medium', { timeZone: 'UTC' });
}

/** Stable row id from the spec's PK columns (composite → JSON tuple). */
export function rowIdOf(columns: readonly GridColumnSpec[], row: GridRow): string {
  const pk = columns.filter((column) => column.primaryKey);
  if (pk.length === 0) return JSON.stringify(row);
  if (pk.length === 1) return String(row[(pk[0] as GridColumnSpec).name]);
  return JSON.stringify(pk.map((column) => row[column.name]));
}

/** The row's display value ("key field") — confirm words, titles. */
export function displayValueOf(columns: readonly GridColumnSpec[], row: GridRow): string {
  const display = columns.find((column) => column.isDisplay) ?? columns.find((column) => column.semantic === 'person-name');
  if (display !== undefined) {
    const value = row[display.name];
    if (value !== null && value !== undefined && String(value) !== '') return String(value);
  }
  return rowIdOf(columns, row);
}
