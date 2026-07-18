/**
 * Shared helpers for the PLANNING archetype templates — `page-board`,
 * `page-calendar`, `page-scheduler` (09-generated-app.md §7.5/§7.6,
 * 04-widget-registry.md §10, annex §14).
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
  /** True when `config.layout` failed `pageLayoutSchema` (09 §3.1 never-crash). */
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
 * descriptor (04 §5.1 — `binding.source.name` + optional `schema`). `null` for
 * unbound (demo) items: a demo widget must never emit a write against a table
 * that is not there (the boards/calendar family convention).
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

/** Column ids the annex classifies as "Completed" (09 §7.5: drop → pct = 100). */
const COMPLETED_COLUMN_RE = /^(done|completed?|closed|shipped|resolved|finished)$/i;

export function isCompletedColumn(columnId: string): boolean {
  return COMPLETED_COLUMN_RE.test(columnId.trim());
}

// --- roadmap quarter bucketing (09 §7.5) ---------------------------------------

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

// --- calendar/scheduler date plumbing -------------------------------------------

/** `2026-07-14T15:30:00Z` → `{ day: '2026-07-14', time: '15:30' }`. */
export function splitInstant(value: unknown): { day: string; time: string | undefined } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (match === null) return null;
  const time = match[2] !== undefined && match[3] !== undefined ? `${match[2]}:${match[3]}` : undefined;
  return { day: match[1] as string, time };
}

/** Wall-clock today as `YYYY-MM-DD` in UTC-day terms (matches the grid keys). */
export function todayIso(): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return utc.toISOString().slice(0, 10);
}

// --- per-instance data states ----------------------------------------------------

export type TemplateDataStates = Record<string, WidgetDataState>;

function demoStateFor(item: LayoutItem, registry: ReadonlyMap<string, WidgetDefinition>, resolvedId: string): WidgetDataState {
  return { status: 'success', data: registry.get(resolvedId)?.demoData(fnv1a(item.i)) };
}

/**
 * Resolve every layout item to a `WidgetDataState`: the host-provided state
 * wins; items the host did not bind fall back to the widget's deterministic
 * `demoData(hash(instanceId))` (04 §5.3 demo mode) — resolved through the
 * offline asset policy exactly like `useDashboardData` does, so desktop demo
 * pages seed the widget that will actually mount.
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
