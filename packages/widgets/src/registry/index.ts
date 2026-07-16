import { kpiWidgetDefinitions } from '../families/kpi/definitions.js';
import { chartsWidgetDefinitions } from '../families/charts/definitions.js';
import { barsRankingChartDefinitions } from '../families/charts/bars-ranking-definitions.js';
import { distributionCorrelationChartDefinitions } from '../families/charts/definitions.distribution-correlation.js';
import { partWholeChartDefinitions } from '../families/charts/def.part-whole.js';
import { matrixGeoChartDefinitions } from '../families/charts/defs.matrix-geo.js';
import { timeFlowChartDefinitions } from '../families/charts/time-flow-definitions.js';
import { tablesWidgetDefinitions } from '../families/tables/definitions.js';
import { tablesTrackFDefinitions } from '../families/tables/tables-track-f.definitions.js';
import { tablesTailDefinitions } from '../families/tables/tables-tail.definitions.js';
import { feedsTrackFDefinitions } from '../families/feeds/feeds-track-f.definitions.js';
import { calendarTrackDefinitions } from '../families/calendar/calendar-track.definitions.js';
import { boardsTrackDefinitions } from '../families/boards/boards-track.definitions.js';
import { geoTrackDefinitions } from '../families/geo/geo-track.definitions.js';
import { mediaTrackDefinitions } from '../families/media/media-track.definitions.js';
import { communicationTrackDefinitions } from '../families/communication/communication-track.definitions.js';
import { domainTrackDefinitions } from '../families/domain/domain-track.definitions.js';
import { blocksTrackDefinitions } from '../families/domain/blocks-track.definitions.js';
import { systemTrackDefinitions } from '../families/system/system-track.definitions.js';
import { chromeTrackDefinitions } from '../families/chrome/chrome-track.definitions.js';
import { formsTrackDefinitions } from '../families/forms/forms-track.definitions.js';
import { widgetMissingDefinition } from './widget-missing.js';
import type { WidgetDefinition, WidgetFamily } from './types.js';

/**
 * Typed widget registry (04-widget-registry.md §2.2). `registry/index.ts`
 * imports only the per-family `definitions.ts` metadata modules — component code loads
 * through the definitions' lazy refs, one Vite chunk per family (04 §2.3).
 */

export class DuplicateWidgetIdError extends Error {
  constructor(readonly widgetId: string) {
    super(`Duplicate widget registry id: '${widgetId}' — registry ids are globally unique (04 §2.1)`);
    this.name = 'DuplicateWidgetIdError';
  }
}

export class WidgetNotFoundError extends Error {
  constructor(readonly widgetId: string) {
    super(`Unknown widget registry id: '${widgetId}'`);
    this.name = 'WidgetNotFoundError';
  }
}

/** Build a registry map; duplicate id registration throws at module init (04 §2.2). */
export function buildRegistry(
  definitions: readonly WidgetDefinition[],
): ReadonlyMap<string, WidgetDefinition> {
  const map = new Map<string, WidgetDefinition>();
  for (const definition of definitions) {
    if (map.has(definition.id)) throw new DuplicateWidgetIdError(definition.id);
    map.set(definition.id, definition);
  }
  return map;
}

export const widgetRegistry: ReadonlyMap<string, WidgetDefinition> = buildRegistry([
  widgetMissingDefinition,
  // kpi
  ...kpiWidgetDefinitions,
  // charts (M4 slice + M7 Wave-1 04-T09 tracks)
  ...chartsWidgetDefinitions,
  ...barsRankingChartDefinitions,
  ...distributionCorrelationChartDefinitions,
  ...partWholeChartDefinitions,
  ...matrixGeoChartDefinitions,
  ...timeFlowChartDefinitions,
  // tables (M4 slice + Track F + the M7 Wave-4 tail that completes annex §3)
  ...tablesWidgetDefinitions,
  ...tablesTrackFDefinitions,
  ...tablesTailDefinitions,
  // feeds (Track F)
  ...feedsTrackFDefinitions,
  // calendar (Track CAL — M7 Wave 2)
  ...calendarTrackDefinitions,
  // boards (Track BOARDS — M7 Wave 2; dnd-kit stays behind the lazy
  // boards-track-components chunk — the definitions import metadata only)
  ...boardsTrackDefinitions,
  // geo (TRACK COMM-GEO — M7 Wave 4; annex §7, the last family to open. The
  // definitions are metadata only and MapBubble imports Leaflet dynamically
  // inside its mount effect, so neither this map nor the shared bundle pulls
  // Leaflet until a bubble map is actually placed — acceptance #3.)
  ...geoTrackDefinitions,
  // media (Track MEDIA — M7 Wave 3; annex §8, the file-browser exit criterion)
  ...mediaTrackDefinitions,
  // communication (Track COMM — M7 Wave 3; annex §9, the chat exit criterion)
  ...communicationTrackDefinitions,
  // domain (Track DOMAIN — M7 Wave 3; annex §13, the org-chart/gantt exit criteria)
  ...domainTrackDefinitions,
  // domain (TRACK BUILDER — M7 Wave 4; annex §13's document half: document-canvas
  // plus its 22 block-* widgets, behind the blocks-track-components lazy barrel)
  ...blocksTrackDefinitions,
  // system (Track FCS — M7 Wave 3; annex §12)
  ...systemTrackDefinitions,
  // chrome (Track FCS — M7 Wave 3; annex §11)
  ...chromeTrackDefinitions,
  // forms (Track FCS — M7 Wave 3; annex §10)
  ...formsTrackDefinitions,
]);

export function getWidget(id: string): WidgetDefinition | undefined {
  return widgetRegistry.get(id);
}

/** Unknown id → `WidgetNotFoundError`. Render paths use `getWidget` + the `widget-missing` fallback instead. */
export function assertWidget(id: string): WidgetDefinition {
  const definition = widgetRegistry.get(id);
  if (definition === undefined) throw new WidgetNotFoundError(id);
  return definition;
}

export function widgetsByFamily(family: WidgetFamily): WidgetDefinition[] {
  return [...widgetRegistry.values()].filter((d) => d.family === family);
}

/** Structured, loggable config-validation warning (04 §2.2). */
export interface ConfigWarning {
  widgetId: string;
  path: string;
  code: string;
  message: string;
}

export interface ParsedConfig {
  /** The validated config — invalid fields fell back to schema defaults per field. */
  config: Record<string, unknown>;
  warnings: ConfigWarning[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Validate a stored instance config against a resolved definition's schema —
 * the shared core of `validateInstanceConfig`, also used by WidgetHost (which
 * may resolve from an overridden registry). Invalid config falls back to
 * schema defaults per field and returns structured warnings — it NEVER throws
 * at render time (04 §2.2).
 */
export function validateConfigAgainst(definition: WidgetDefinition, config: unknown): ParsedConfig {
  const warnings: ConfigWarning[] = [];
  const id = definition.id;

  if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
    warnings.push({
      widgetId: id,
      path: '',
      code: 'config-not-object',
      message: `Instance config must be an object, got ${Array.isArray(config) ? 'array' : typeof config}`,
    });
  }
  const input = asRecord(config);

  const first = definition.configSchema.safeParse(input);
  if (first.success) {
    return { config: asRecord(first.data), warnings };
  }

  // Per-field fallback: drop each offending top-level field, keep the rest.
  const pruned = { ...input };
  for (const issue of first.error.issues) {
    const head = issue.path[0];
    warnings.push({
      widgetId: id,
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    });
    if (typeof head === 'string') delete pruned[head];
  }

  const second = definition.configSchema.safeParse(pruned);
  if (second.success) return { config: asRecord(second.data), warnings };

  // Root-level failure (e.g. schema-level refinement) — schema defaults only.
  const defaults = definition.configSchema.safeParse({});
  warnings.push({
    widgetId: id,
    path: '',
    code: 'config-reset',
    message: 'Config could not be partially recovered; reset to schema defaults',
  });
  return { config: defaults.success ? asRecord(defaults.data) : {}, warnings };
}

/**
 * Validate a stored instance config by registry id. Runs on every page load;
 * unknown widget ids validate against the `widget-missing` schema with an
 * `unknown-widget` warning (04 §2.2).
 */
export function validateInstanceConfig(id: string, config: unknown): ParsedConfig {
  const definition = widgetRegistry.get(id);
  if (definition !== undefined) return validateConfigAgainst(definition, config);
  const parsed = validateConfigAgainst(widgetMissingDefinition, config);
  return {
    config: parsed.config,
    warnings: [
      {
        widgetId: id,
        path: '',
        code: 'unknown-widget',
        message: `No widget registered as '${id}'; rendering the widget-missing fallback`,
      },
      ...parsed.warnings.map((w) => ({ ...w, widgetId: id })),
    ],
  };
}

/** Log config warnings in one structured line (04 §2.2 "logs a structured warning"). */
export function logConfigWarnings(instanceId: string, parsed: ParsedConfig): void {
  if (parsed.warnings.length === 0) return;
  console.warn('[widgets] invalid instance config', { instanceId, warnings: parsed.warnings });
}
