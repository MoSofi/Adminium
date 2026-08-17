// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import {
  gridColumnSpecSchema,
  gridToneSchema,
  pageLayoutSchema,
  queryDescriptorSchema,
  type GridColumnSpec,
  type GridRow,
  type GridTone,
  type LayoutItem,
  type PageLayout,
  type QueryDescriptor,
} from '../page-config/index.js';

/**
 * Shared vocabulary for the M7 archetype template renderers
 * (`page-directory`, `page-master-detail`, `page-queue-inbox`, …).
 *
 * These templates receive the STORED page config body the Engine persisted —
 * `{ templateVersion, toolbar, overlays, archetype, layout }` (01 §6.1 wrap of
 * `composeTemplate`'s output, 04 §10) — and re-compose existing family widgets
 * from it. Everything here is pure parsing/derivation over that document:
 *
 * - `parseTemplateBody` — tolerant envelope-body parse (invalid → never crash,
 *   the caller renders the page-dashboard-style invalid notice);
 * - slot lookup by composed instance id (`composeTemplate` names instances
 *   `<slot>` / `<slot>-<n>`, compose.ts `instanceId`);
 * - `recordRowsOf` — the family-idiom `record-list` payload unwrap;
 * - field-map guessing for generated candidate configs, which carry
 *   generator-vocabulary keys (`titleColumn`, `groupBy`, `parentColumn`…)
 *   rather than the widget-schema `*Field` keys;
 * - `specForColumn` — minimal `GridColumnSpec`s derived client-side from live
 *   rows so `detail-key-value` can render archetype pages that (unlike
 *   `page-crud`) store no `columns[]` body, with `enumTones` flowing through
 *   config instead of hardcoded tints (M7-T04 / 09 §7.3).
 */

/** The stored config body of an archetype page (04 §10 envelope wrap). */
export interface TemplateBody {
  layout: PageLayout;
  toolbar: readonly string[];
  overlays: readonly string[];
  /** False ⇔ the stored document failed validation (render the notice). */
  valid: boolean;
}

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

const bodySchema = z.object({
  layout: pageLayoutSchema,
  toolbar: z.array(z.string()).default([]),
  overlays: z.array(z.string()).default([]),
});

/** Parse a stored config body; never throws (09 §3.1 never-crash rules). */
export function parseTemplateBody(config: unknown): TemplateBody {
  const parsed = bodySchema.safeParse(config);
  if (!parsed.success) return { layout: EMPTY_LAYOUT, toolbar: [], overlays: [], valid: false };
  return { ...parsed.data, valid: true };
}

/**
 * The layout item composed into `slot` — matched by instance id first
 * (compose.ts names non-repeating instances after their slot), then by the
 * widget-id allowlist so hand-edited documents still resolve.
 */
export function slotItemOf(
  layout: PageLayout,
  slot: string,
  widgets: readonly string[] = [],
): LayoutItem | undefined {
  return (
    layout.items.find((item) => item.i === slot) ??
    layout.items.find((item) => widgets.includes(item.widget))
  );
}

/** Every instance of a repeating slot (`<slot>-1`, `<slot>-2`, …), in order. */
export function slotItemsOf(layout: PageLayout, slot: string): LayoutItem[] {
  const prefix = `${slot}-`;
  return layout.items
    .filter((item) => item.i === slot || item.i.startsWith(prefix))
    .sort((a, b) => a.i.localeCompare(b.i, 'en', { numeric: true }));
}

/**
 * `record-list` payload unwrap. The canonical widget-data wire shape is
 * `{ shape: 'record-list', rows, columns, total }` (apps/server
 * widget-data/shapers.ts `ShapedRecordList`); demo/story payloads also come
 * as bare arrays or `{ data: [...] }` (the tables-family tolerance).
 */
export function recordRowsOf(data: unknown): GridRow[] {
  if (Array.isArray(data)) return data as GridRow[];
  if (typeof data === 'object' && data !== null) {
    const record = data as { rows?: unknown; data?: unknown };
    if (Array.isArray(record.rows)) return record.rows as GridRow[];
    if (Array.isArray(record.data)) return record.data as GridRow[];
  }
  return [];
}

/**
 * The single primary-key column name from a `record-list` payload's `columns`
 * meta (server shapers.ts `columnMetaOf` carries `isPrimaryKey`). Undefined
 * for demo/bare-array payloads, empty meta, or composite keys — callers fall
 * back to the `id` key and, last, the row index (which must then never be
 * sent to a server as a PK value).
 */
export function recordPkOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const columns = (data as { columns?: unknown }).columns;
  if (!Array.isArray(columns)) return undefined;
  const pks = columns.filter(
    (column): column is { name: string } =>
      typeof column === 'object' &&
      column !== null &&
      (column as { isPrimaryKey?: unknown }).isPrimaryKey === true &&
      typeof (column as { name?: unknown }).name === 'string',
  );
  return pks.length === 1 ? pks[0]?.name : undefined;
}

/** Loose string projection for row cells (undefined ⇔ null/absent). */
export function cellText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') return undefined;
  return String(value);
}

/** "monthly_revenue" / "monthlyRevenue" → "Monthly revenue". */
export function humanizeName(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words === '' ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

/** A string-valued config key, tolerating absent/None. */
export function configString(config: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/**
 * First candidate field present on ANY loaded row. Generated candidate
 * configs rarely carry full field maps, so the renderers fall back to the
 * classifier-adjacent name conventions (05 §7 vocabulary) over live rows —
 * scanning every row because sparse columns (an expense `amount`, a leave
 * request's `days`) may be absent from the first row.
 */
export function guessField(
  rows: readonly GridRow[],
  candidates: readonly string[],
): string | undefined {
  if (rows.length === 0) return undefined;
  return candidates.find((candidate) => rows.some((row) => candidate in row));
}

export const TITLE_FIELD_CANDIDATES = [
  'name',
  'title',
  'subject',
  'label',
  'full_name',
  'display_name',
  'email',
] as const;

export const SUBTITLE_FIELD_CANDIDATES = [
  'role',
  'job_title',
  'position',
  'department',
  'category',
  'description',
  'summary',
  'email',
] as const;

export const UPDATED_FIELD_CANDIDATES = ['updated_at', 'created_at', 'submitted_at', 'requested_at'] as const;

export const AMOUNT_FIELD_CANDIDATES = ['amount', 'total', 'total_amount', 'cost', 'price', 'value'] as const;

/** Stored `enumTones` maps (01 §6.1) — value → tone, validated leniently. */
export function enumTonesOf(config: Record<string, unknown>): Record<string, GridTone> | undefined {
  const raw = config['enumTones'];
  const parsed = z.record(z.string(), gridToneSchema).safeParse(raw);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
}

export interface SpecOptions {
  enumTones?: Record<string, GridTone> | undefined;
  enumValues?: readonly string[] | undefined;
  isDisplay?: boolean | undefined;
}

/** Minimal column spec derived from a live row value (detail rendering). */
export function specForColumn(name: string, value: unknown, options: SpecOptions = {}): GridColumnSpec {
  const logicalType =
    typeof value === 'boolean'
      ? 'boolean'
      : typeof value === 'number'
        ? Number.isInteger(value)
          ? 'integer'
          : 'decimal'
        : options.enumValues !== undefined || options.enumTones !== undefined
          ? 'enum'
          : typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/.test(value)
            ? 'timestamp'
            : 'text';
  return gridColumnSpecSchema.parse({
    name,
    label: humanizeName(name),
    logicalType,
    ...(options.enumValues === undefined ? {} : { enumValues: [...options.enumValues] }),
    ...(options.enumTones === undefined ? {} : { enumTones: options.enumTones, semantic: 'status-workflow' }),
    ...(options.isDisplay === undefined ? {} : { isDisplay: options.isDisplay }),
  });
}

export interface RecordSpecOptions {
  /** field name → value→tone map (enum pills tint from config, never hardcoded). */
  toneFields?: Record<string, Record<string, GridTone> | undefined> | undefined;
  displayField?: string | undefined;
}

/** Detail specs for one record: `_masked` marker dropped. */
export function specsForRecord(row: GridRow, options: RecordSpecOptions = {}): GridColumnSpec[] {
  const toneFields = options.toneFields ?? {};
  return Object.keys(row)
    .filter((key) => key !== '_masked')
    .map((key) => {
      const enumTones = toneFields[key];
      return specForColumn(key, row[key], {
        ...(enumTones === undefined ? {} : { enumTones }),
        ...(key === options.displayField ? { isDisplay: true } : {}),
      });
    });
}

/** The parsed query descriptor stored on a layout item, when present/valid. */
export function itemDescriptorOf(item: LayoutItem | undefined): QueryDescriptor | undefined {
  if (item === undefined) return undefined;
  const parsed = queryDescriptorSchema.safeParse(item.config['binding']);
  return parsed.success ? parsed.data : undefined;
}

/** Qualified `schema.table` of an item's binding (mutate/record-open events). */
export function itemTableOf(item: LayoutItem | undefined): { connectionId: string; table: string } | undefined {
  const descriptor = itemDescriptorOf(item);
  if (descriptor === undefined) return undefined;
  const source = descriptor.source;
  const table = source.schema === undefined ? source.name : `${source.schema}.${source.name}`;
  return { connectionId: descriptor.connectionId, table };
}

/**
 * Bridge a GENERATOR candidate config onto a widget's `*Field` schema keys.
 * The candidate rules store classifier vocabulary (`parentColumn`,
 * `startColumn`, `groupColumn`, `titleColumn`, `labelColumn` — see
 * registry/candidates.ts); the domain widget schemas read `parentField`,
 * `startField`, `phaseField`, … (families/domain/domain-config.ts). The
 * renderers translate at the boundary so the stored document stays canonical.
 */
export function bridgeFieldConfig(config: Record<string, unknown>): Record<string, unknown> {
  const MAP: Record<string, string> = {
    parentColumn: 'parentField',
    labelColumn: 'labelField',
    titleColumn: 'titleField',
    startColumn: 'startField',
    endColumn: 'endField',
    progressColumn: 'progressField',
    groupColumn: 'phaseField',
    imageColumn: 'imageField',
    readColumn: 'readField',
  };
  const out: Record<string, unknown> = { ...config };
  for (const [from, to] of Object.entries(MAP)) {
    if (from in config && !(to in config)) out[to] = config[from];
  }
  return out;
}
