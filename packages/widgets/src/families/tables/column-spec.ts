import { getFormatters, latnDataTag } from '@adminium/i18n';
import { z } from 'zod';

/**
 * Column specs for the `tables` family + `page-crud` template
 * (research/widget-registry.md §3 "column defs generated from schema";
 * 01-architecture.md §6.1 `config.columns`).
 *
 * These mirror the Engine snapshot's `ColumnModel` + `ColumnSemantics`
 * vocabulary (packages/engine/src/schema-model.ts) WITHOUT importing the
 * engine — @adminium/widgets may only touch the browser-safe
 * `@adminium/engine/config` leaf, and that leaf itself imports widgets'
 * page-config, so the spec types live here and the interpreter (dashboard)
 * projects snapshot columns into them.
 */

/** Logical column types the cell/form renderers branch on (engine §6 subset). */
export const GRID_LOGICAL_TYPES = [
  'text',
  'varchar',
  'integer',
  'bigint',
  'decimal',
  'float',
  'boolean',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'interval',
  'uuid',
  'json',
  'binary',
  'enum',
  'geometry',
  'inet',
  'unknown',
] as const;
export const gridLogicalTypeSchema = z.enum(GRID_LOGICAL_TYPES);
export type GridLogicalType = z.infer<typeof gridLogicalTypeSchema>;

/**
 * Column semantics the renderers act on (engine §7.1 SEMANTIC_TAGS — kept as
 * an open string so classifier additions never break stored configs; the
 * known ids below get dedicated treatments, everything else renders as text).
 */
export const GRID_SEMANTICS = [
  'pk-id',
  'fk',
  'money',
  'percent',
  'score',
  'status-workflow',
  'category-enum',
  'created-at',
  'updated-at',
  'event-timestamp',
  'duration',
  'person-name',
  'email',
  'phone',
  'image-url',
  'file-ref',
  'url',
  'boolean-flag',
  'color',
  'tags',
  'slug',
  'ip-address',
  'json-config',
  'external-id',
  'free-text',
  'plain',
] as const;
export type GridSemantic = (typeof GRID_SEMANTICS)[number] | (string & {});

const toneSchema = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);
export type GridTone = z.infer<typeof toneSchema>;

/**
 * One column definition — the `config.columns[]` entry of `page-crud`
 * (01 §6.1) and the column contract of `data-grid`/`detail-key-value`/
 * `mini-table` (annex §3: `{key, label, type, mono, align, pill?, fk?}`).
 */
export const gridColumnSpecSchema = z.object({
  /** Snapshot column name — the row-object key. */
  name: z.string().min(1),
  /** Humanized header/label ("Monthly revenue"). */
  label: z.string().min(1),
  logicalType: gridLogicalTypeSchema.default('text'),
  /** Primary semantic tag from the classifier (engine §7.1 id). */
  semantic: z.string().nullable().default(null),
  /** Format hint ('currency' | 'percent' | 'relative-time' | 'mono' | …). */
  format: z.string().nullable().default(null),
  /** ISO currency for money columns (config.format.currency wins per-widget). */
  currency: z.string().optional(),
  /** Enum members, when logicalType='enum'. */
  enumValues: z.array(z.string()).optional(),
  /** enum value → tone map (01 §6.1 `enumTones`) — never hardcoded tints. */
  enumTones: z.record(z.string(), toneSchema).optional(),
  /** Outbound FK — cell renders the display value as an avatar chip. */
  fk: z
    .object({
      /** Referenced qualified table ("public.team_members"). */
      table: z.string().min(1),
      /** Referenced column (usually its PK). */
      column: z.string().min(1),
      /**
       * Row key carrying the pre-joined display value for the chip
       * (interpreter aliases the joined display column into the row).
       * Falls back to the raw FK value when absent.
       */
      displayKey: z.string().optional(),
    })
    .optional(),
  /** PII column — masked-by-default treatment ('•••' + unmask affordance). */
  pii: z.boolean().default(false),
  /** JetBrains Mono value treatment (ids, amounts, emails). */
  mono: z.boolean().default(false),
  align: z.enum(['start', 'end']).optional(),
  sortable: z.boolean().default(true),
  /** Hidden from the grid but still available to forms/detail. */
  hidden: z.boolean().default(false),
  // --- form-generation facts (page-crud RecordForm) ------------------------
  primaryKey: z.boolean().default(false),
  nullable: z.boolean().default(true),
  /** Column has a DB default (serial/uuid/now) — omittable on create. */
  hasDefault: z.boolean().default(false),
  /** Unique index — the form runs the live uniqueness check (09 §7.1). */
  unique: z.boolean().default(false),
  /** Never editable (pk with default, created-at/updated-at, generated). */
  readOnly: z.boolean().default(false),
  maxLength: z.number().int().positive().nullable().default(null),
  /** The table's primary display column (09 §8.3 "key field" highlight). */
  isDisplay: z.boolean().default(false),
});

export type GridColumnSpec = z.infer<typeof gridColumnSpecSchema>;
export type GridColumnSpecInput = z.input<typeof gridColumnSpecSchema>;

export type GridRow = Record<string, unknown>;

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
  return getFormatters(options?.locale ?? 'en-US').number(amount, {
    style: 'currency',
    currency: options?.currency ?? 'USD',
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
