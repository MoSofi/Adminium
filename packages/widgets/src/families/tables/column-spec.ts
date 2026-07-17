import { getFormatters, latnDataTag } from '@adminium/i18n';
import type { Tone } from '@adminium/ui';

import type {
  GridColumnSpec,
  GridLogicalType,
  GridRow,
  GridTone,
} from '../../page-config/grid-column-spec.js';

/**
 * Column-spec helpers for the `tables` family + `page-crud` template
 * (research/widget-registry.md §3 "column defs generated from schema";
 * 01-architecture.md §6.1 `config.columns`).
 *
 * The schema + types themselves live in the page-config pure leaf
 * (`../../page-config/grid-column-spec.ts`) so the generator leaf's crud-body
 * composer and `@adminium/engine/config` can share them without touching
 * component code or this module's `@adminium/i18n` dependency. Re-exported
 * here verbatim — this stays the `tables`-family import site.
 */
export {
  GRID_LOGICAL_TYPES,
  GRID_SEMANTICS,
  gridColumnSpecSchema,
  gridLogicalTypeSchema,
  type GridColumnSpec,
  type GridColumnSpecInput,
  type GridLogicalType,
  type GridRow,
  type GridSemantic,
  type GridTone,
} from '../../page-config/grid-column-spec.js';

/**
 * Stored `GridTone` → `@adminium/ui` tone. `'muted'` (the generator/LLM
 * fallback for enum values outside the §7.1 rule-7 keyword map) renders as the
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
 * Type-aware cell comparator — THE Data Table string-mrr sort fix
 * (research/ia-mapping.md §5 item 4): pg serializes `int8`/`decimal` as
 * strings (01 §5 type rules) and client-added rows may carry strings too, so
 * numeric columns coerce through `Number()` and NEVER fall back to the
 * lexicographic path ("980" < "6100", not "6100" < "980").
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

/** Locale/currency formatting for money cells (Intl, config override wins). */
export function formatMoney(
  value: unknown,
  options?: { locale?: string | undefined; currency?: string | undefined },
): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value ?? '');
  // Money is a mono grid cell → data context (latn digits) via the format layer.
  // `|| 'USD'` (not `??`) so a schema-valid empty currency code coalesces too —
  // `{ style: 'currency', currency: '' }` would otherwise throw a RangeError.
  return getFormatters(options?.locale ?? 'en-US').number(amount, {
    style: 'currency',
    currency: options?.currency || 'USD',
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
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
  // Grid-cell relative time is a mono/data cell → latn digits (§4.2); the
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
  // Data context (latn digits + gregorian, §4.2) via the format layer.
  return getFormatters(locale ?? 'en-US').dateTime(time);
}

/** Stable row id from the spec's PK columns (composite → JSON tuple, §2.7.2). */
export function rowIdOf(columns: readonly GridColumnSpec[], row: GridRow): string {
  const pk = columns.filter((column) => column.primaryKey);
  if (pk.length === 0) return JSON.stringify(row);
  if (pk.length === 1) return String(row[(pk[0] as GridColumnSpec).name]);
  return JSON.stringify(pk.map((column) => row[column.name]));
}

/** The row's display value ("key field", 09 §8.3) — confirm words, titles. */
export function displayValueOf(columns: readonly GridColumnSpec[], row: GridRow): string {
  const display = columns.find((column) => column.isDisplay) ?? columns.find((column) => column.semantic === 'person-name');
  if (display !== undefined) {
    const value = row[display.name];
    if (value !== null && value !== undefined && String(value) !== '') return String(value);
  }
  return rowIdOf(columns, row);
}
