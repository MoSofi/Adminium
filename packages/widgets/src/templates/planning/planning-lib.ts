// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared helpers for the PLANNING archetype templates — `page-board`,
 * `page-calendar`, `page-scheduler` (annex).
 *
 * These templates render a stored page config body (the engine's
 * `composeTemplate` output wrapped by generate/archetype.ts):
 *
 *   config = { templateVersion, toolbar[], overlays[], archetype?, layout }
 *
 * where `layout.items[].config` carries the CANDIDATE vocabulary
 * (`statusColumn`/`laneColumn`/`titleColumn`/`startColumn`/`personColumn`/
 * `dateColumn`/`typeColumn` — packages/widgets/src/registry/candidates.ts),
 * NOT the widget config schemas' `columnField`/`titleField` vocabulary. The
 * translation between the two lives here, so the templates can compose the
 * families' presentational components with correctly-mapped props — the bug
 * class where a stored archetype page renders "Unknown page template" (or a
 * widget with default field names against real columns) dies in this folder.
 *
 * PURE module apart from the two React hooks at the bottom (no family
 * component imports) — safe for template tests and the dashboard bindings'
 * unit tests alike.
 */
import { fnv1a } from '@adminium/charts';
import { useMemo } from 'react';

import { dateOnlyValue } from '../../families/tables/column-spec.js';
import type { WidgetDataState } from '../../frame/WidgetHost.js';
import { useWidgetRuntimeEnv } from '../../frame/WidgetRuntimeContext.js';
import { pageLayoutSchema, type PageLayout } from '../../page-config/index.js';
import type { LayoutItem } from '../../grid/layout-schema.js';
import { widgetRegistry } from '../../registry/index.js';
import { resolveOfflineWidgetId } from '../../registry/offline.js';
import type { WidgetDefinition } from '../../registry/types.js';

// --- stored-config readers ----------------------------------------------------

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

export interface ParsedTemplateConfig {
  layout: PageLayout;
  toolbar: readonly string[];
  overlays: readonly string[];
  /** True when `config.layout` failed `pageLayoutSchema` (never-crash). */
  invalid: boolean;
}

/** Parse the stored page config body; invalid layouts degrade, never throw. */
export function parseTemplateConfig(config: unknown): ParsedTemplateConfig {
  const body = (typeof config === 'object' && config !== null ? config : {}) as Record<string, unknown>;
  const strings = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  const layout = pageLayoutSchema.safeParse(body['layout']);
  return {
    layout: layout.success ? layout.data : EMPTY_LAYOUT,
    toolbar: strings(body['toolbar']),
    overlays: strings(body['overlays']),
    invalid: !layout.success,
  };
}

/** Tolerant string reader over an untrusted stored item config. */
export function configString(config: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

export function configNumber(config: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** A layout item's raw config as a plain record (never null). */
export function itemConfigOf(item: LayoutItem): Record<string, unknown> {
  return (typeof item.config === 'object' && item.config !== null ? item.config : {}) as Record<string, unknown>;
}

// --- binding source -------------------------------------------------------------

export interface PlanningSource {
  connectionId: string | undefined;
  table: string;
}

/**
 * The `connectionId` + schema-qualified table a widget's `mutate`/`record-open`
 * events must carry, read STRUCTURALLY from the stored `config.binding`
 * descriptor (`binding.source.name` + optional `schema`). `null` for unbound
 * (demo) items: a demo widget must never emit a write against a table that is
 * not there (the boards/calendar family convention).
 */
export function planningSourceOf(config: Record<string, unknown>): PlanningSource | null {
  const binding = config['binding'];
  if (typeof binding !== 'object' || binding === null) return null;
  const b = binding as { connectionId?: unknown; source?: { schema?: unknown; name?: unknown } };
  const name = b.source?.name;
  if (typeof name !== 'string' || name === '') return null;
  const schema = typeof b.source?.schema === 'string' ? b.source.schema : undefined;
  return {
    connectionId: typeof b.connectionId === 'string' ? b.connectionId : undefined,
    table: schema === undefined ? name : `${schema}.${name}`,
  };
}

// --- board vocabulary -----------------------------------------------------------

/** Column ids the annex classifies as "Completed" (drop → pct = 100). */
const COMPLETED_COLUMN_RE = /^(done|completed?|closed|shipped|resolved|finished)$/i;

export function isCompletedColumn(columnId: string): boolean {
  return COMPLETED_COLUMN_RE.test(columnId.trim());
}

// --- roadmap quarter bucketing ---------------------------------------

/** `2026-08-14…` → `2026-Q3`; empty for unparseable dates. */
export function quarterKeyOf(dateIso: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(dateIso);
  if (match === null) return '';
  const month = Number(match[2]);
  if (!Number.isFinite(month) || month < 1 || month > 12) return '';
  return `${match[1]}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** `2026-Q3` → `Q3 2026` (board column label). */
export function quarterLabelOf(quarterKey: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarterKey);
  return match === null ? quarterKey : `Q${match[2]} ${match[1]}`;
}

/** `2026-Q3` → `2026-07-01` — the write a cross-quarter card drop issues. */
export function quarterStartIso(quarterKey: string): string | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarterKey);
  if (match === null) return null;
  const month = (Number(match[2]) - 1) * 3 + 1;
  return `${match[1]}-${String(month).padStart(2, '0')}-01`;
}

// --- calendar/scheduler/roadmap date plumbing -------------------------------------
//
// ONE rule for every planning page: a day is a day IN THE RENDERING ZONE.
//
// The rendering zone is the template's `timeZone` prop, and absent that the
// viewer's own — the zone the staff grid and the record drawer already draw
// instants in (`formatAbsoluteTime`), so a calendar never files an event on a
// day its own record drawer disagrees with. A host that renders for a
// business rather than a viewer (a hosted surface: the connection's zone)
// passes the zone in.
//
// What a stored value means depends on the column's logical type, read from
// the record-list payload's `columns[]`:
//
//  - `date`: a calendar day with no zone. SQLite hands back the plain string;
//    postgres/mysql hand back the driver's SERVER-local midnight as a UTC
//    instant, decoded by `dateOnlyValue`'s +12 h read — never by the viewer's
//    zone, which would move it a day for anyone the server is east of.
//  - `timestamp`/`timestamptz`: an instant. A zoned string (`Z`, `+02:00`) or
//    a `Date` is converted INTO the rendering zone before its day and time
//    are taken — the string's own prefix is the UTC day, which is the
//    previous day for everyone east of UTC near midnight. A zone-less string
//    (SQLite's naive text) is already a wall clock and is read as written.
//
// And writes go the other way: a day becomes `YYYY-MM-DD` for a `date`
// column, and the INSTANT of that day's midnight in the rendering zone for a
// timestamp — never a bare date, which the database would read at its own
// session zone's midnight.

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/;
const ZONED_RE = /[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** How a planning column's stored values are to be read and written. */
export type PlanningDateKind = 'date' | 'instant';

/** Options every planning date helper takes. */
export interface PlanningDateOptions {
  /** IANA zone the page renders in; undefined = the viewer's zone. */
  timeZone?: string | undefined;
  /** The column's kind; undefined = unknown (read by the value's own shape). */
  kind?: PlanningDateKind | undefined;
}

/**
 * The kind of `column` as the record-list payload describes it
 * (`{ rows, columns: [{ name, logicalType }] }`). Undefined when the payload
 * carries no column metadata (demo data, a `{ events }` envelope) or the
 * column is not a date/timestamp.
 */
export function planningDateKindOf(data: unknown, column: string | undefined): PlanningDateKind | undefined {
  if (column === undefined || typeof data !== 'object' || data === null) return undefined;
  const columns = (data as { columns?: unknown }).columns;
  if (!Array.isArray(columns)) return undefined;
  for (const entry of columns) {
    if (typeof entry !== 'object' || entry === null) continue;
    const meta = entry as { name?: unknown; logicalType?: unknown };
    if (meta.name !== column) continue;
    if (meta.logicalType === 'date') return 'date';
    if (meta.logicalType === 'timestamp' || meta.logicalType === 'timestamptz') return 'instant';
    return undefined;
  }
  return undefined;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let fmt = zoneFormatters.get(key);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat('en-US', {
      ...(timeZone === undefined ? {} : { timeZone }),
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneFormatters.set(key, fmt);
  }
  return fmt;
}

/** The wall clock of `ms` in `timeZone`, as numbers. */
function wallClockOf(ms: number, timeZone: string | undefined) {
  const parts: Record<string, number> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts['year'] ?? 1970,
    month: parts['month'] ?? 1,
    day: parts['day'] ?? 1,
    // Some engines still print midnight as 24 under h23.
    hour: (parts['hour'] ?? 0) % 24,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function isoDayOf(clock: { year: number; month: number; day: number }): string {
  return `${String(clock.year).padStart(4, '0')}-${pad2(clock.month)}-${pad2(clock.day)}`;
}

/** `timeZone`'s offset from UTC at instant `ms`, in milliseconds. */
function zoneOffsetMs(ms: number, timeZone: string | undefined): number {
  const c = wallClockOf(ms, timeZone);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The day (and time, when there is one) a stored value falls on in the
 * rendering zone — see the section comment for the rule. `null` for values
 * that are not dates.
 *
 * `2026-09-20T22:00:00Z` in `Europe/Berlin` → `{ day: '2026-09-21', time: '00:00' }`.
 */
export function splitInstant(
  value: unknown,
  options: PlanningDateOptions = {},
): { day: string; time: string | undefined } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (options.kind === 'date') return { day: dateOnlyValue(value), time: undefined };
    const c = wallClockOf(value.getTime(), options.timeZone);
    return { day: isoDayOf(c), time: `${pad2(c.hour)}:${pad2(c.minute)}` };
  }
  if (typeof value !== 'string') return null;
  if (options.kind === 'date') {
    const day = dateOnlyValue(value);
    return DATE_ONLY_RE.test(day) ? { day, time: undefined } : null;
  }
  const trimmed = value.trim();
  if (ZONED_RE.test(trimmed)) {
    const ms = new Date(trimmed.replace(' ', 'T')).getTime();
    if (!Number.isNaN(ms)) {
      const c = wallClockOf(ms, options.timeZone);
      return { day: isoDayOf(c), time: `${pad2(c.hour)}:${pad2(c.minute)}` };
    }
  }
  const match = WALL_CLOCK_RE.exec(trimmed);
  if (match === null) return null;
  const time = match[2] !== undefined && match[3] !== undefined ? `${match[2]}:${match[3]}` : undefined;
  return { day: match[1] as string, time };
}

/** Today as `YYYY-MM-DD` in the rendering zone (the viewer's by default). */
export function todayIso(timeZone?: string): string {
  return isoDayOf(wallClockOf(Date.now(), timeZone));
}

/**
 * The instant `day` begins in `timeZone`, as a UTC ISO string.
 * `('2026-09-21', 'Europe/Berlin')` → `'2026-09-20T22:00:00.000Z'`.
 *
 * On a day whose midnight a DST jump skips, this is the first instant of the
 * day that exists — still the same day.
 */
export function zoneMidnightInstant(day: string, timeZone?: string): string | null {
  if (!DATE_ONLY_RE.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // Two passes: the offset at the guess, then at the corrected instant (the
  // two differ only when a DST change falls between them).
  let instant = guess - zoneOffsetMs(guess, timeZone);
  instant = guess - zoneOffsetMs(instant, timeZone);
  if (isoDayOf(wallClockOf(instant, timeZone)) !== day) {
    // Midnight did not exist (a spring-forward AT midnight): step to the hour
    // that did.
    instant += 3_600_000;
  }
  return new Date(instant).toISOString();
}

/**
 * The value a planning write stores for "this day": the plain day for a
 * `date` column (and for a column of unknown kind — the old behaviour, which
 * is right for dates and SQLite text), the zone's midnight instant for a
 * timestamp.
 */
export function dayStartValue(day: string, options: PlanningDateOptions = {}): string {
  if (options.kind !== 'instant') return day;
  return zoneMidnightInstant(day, options.timeZone) ?? day;
}

// --- per-instance data states ----------------------------------------------------

export type TemplateDataStates = Record<string, WidgetDataState>;

function demoStateFor(item: LayoutItem, registry: ReadonlyMap<string, WidgetDefinition>, resolvedId: string): WidgetDataState {
  return { status: 'success', data: registry.get(resolvedId)?.demoData(fnv1a(item.i)) };
}

/**
 * Resolve every layout item to a `WidgetDataState`: the host-provided state
 * wins; items the host did not bind fall back to the widget's deterministic
 * `demoData(hash(instanceId))` (demo mode) — resolved through the offline
 * asset policy exactly like `useDashboardData` does, so desktop demo pages
 * seed the widget that will actually mount.
 */
export function useTemplateStates(
  layout: PageLayout,
  states: TemplateDataStates | undefined,
  registry: ReadonlyMap<string, WidgetDefinition> = widgetRegistry,
): TemplateDataStates {
  const runtimeEnv = useWidgetRuntimeEnv();
  return useMemo(() => {
    const resolved: TemplateDataStates = {};
    for (const item of layout.items) {
      resolved[item.i] =
        states?.[item.i] ?? demoStateFor(item, registry, resolveOfflineWidgetId(item.widget, runtimeEnv));
    }
    return resolved;
  }, [layout, states, registry, runtimeEnv]);
}
