// SPDX-License-Identifier: AGPL-3.0-only
import { lazy } from 'react';

import {
  accordionListConfigSchema,
  accordionListDemoData,
  chipCloudConfigSchema,
  chipCloudDemoData,
  comparisonMatrixConfigSchema,
  comparisonMatrixDemoData,
  rankedEntityListConfigSchema,
  rankedEntityListDemoData,
  sparklineTableConfigSchema,
  sparklineTableDemoData,
  topMoversListConfigSchema,
  topMoversListDemoData,
} from './tables-tail-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * M7 Wave-4 TAIL additions to the `tables` family (annex §3) — the six list
 * widgets left after the M4 slice and Track F: sparkline-table, top-movers-list,
 * ranked-entity-list, accordion-list, comparison-matrix, chip-cloud. With these
 * the family is complete against the annex catalog (acceptance #1).
 *
 * Metadata only — the components load through the `tables-tail-components`
 * barrel via `lazy(() => import(...))`, so the family stays in one lazy chunk
 * and the registry metadata never eagerly pulls the component code (04 §2.3;
 * `qa/chunk-budget.test.ts` walks the definitions' static imports and fails on a
 * `.tsx` edge). Schemas + `demoData` come from the PURE `tables-tail-config.ts`
 * for the same reason. The GREEN LOOP spreads `tablesTailDefinitions` into the
 * registry map beside `tablesWidgetDefinitions` / `tablesTrackFDefinitions`.
 *
 * Sizing is the annex's grid note converted to 40px half-units
 * (04 §6.1: `h = round(annexRows × 2)`); widths map 1:1.
 */

export const sparklineTableDefinition: WidgetDefinition = defineWidget({
  id: 'sparkline-table',
  family: 'tables',
  component: lazy(() => import('./tables-tail-components.js').then((m) => ({ default: m.SparklineTableWidget }))),
  configSchema: sparklineTableConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 4, defaultW: 4, defaultH: 6 }, // annex min 4×2, default 4×3
  placement: 'grid',
  skeleton: 'list',
  demoData: sparklineTableDemoData,
  descriptionKey: 'widgets.tables.sparklineTable.description',
});

export const topMoversListDefinition: WidgetDefinition = defineWidget({
  id: 'top-movers-list',
  family: 'tables',
  component: lazy(() => import('./tables-tail-components.js').then((m) => ({ default: m.TopMoversListWidget }))),
  configSchema: topMoversListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 }, // annex min 3×2, default 4×3
  placement: 'grid',
  skeleton: 'list',
  demoData: topMoversListDemoData,
  descriptionKey: 'widgets.tables.topMoversList.description',
});

export const rankedEntityListDefinition: WidgetDefinition = defineWidget({
  id: 'ranked-entity-list',
  family: 'tables',
  component: lazy(() => import('./tables-tail-components.js').then((m) => ({ default: m.RankedEntityListWidget }))),
  configSchema: rankedEntityListConfigSchema,
  // Genuinely reads BOTH: `rankedEntitiesOf` projects each row's `label` + `value`
  // through `tailRowsOf`, which unwraps `{items}` as readily as `{rows}`/`{data}`
  // — and `{items, total}` IS the categorical envelope. Declaring `record-list`
  // alone understated it, and once the apply planner started binding from the
  // contract that omission would have re-bound a working "top N by count" tile
  // ("Busiest agents": group by assignee, count) as a list of raw recent rows.
  // Sibling `record-list` tiles are NOT lenient this way and must not copy this:
  // `grouped-summary-table` reads `data`/`columns`, so a categorical payload
  // renders it empty.
  dataContract: ['record-list', 'categorical'],
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 }, // annex min 3×2 (no default given)
  placement: 'grid',
  skeleton: 'list',
  demoData: rankedEntityListDemoData,
  descriptionKey: 'widgets.tables.rankedEntityList.description',
});

export const accordionListDefinition: WidgetDefinition = defineWidget({
  id: 'accordion-list',
  family: 'tables',
  component: lazy(() => import('./tables-tail-components.js').then((m) => ({ default: m.AccordionListWidget }))),
  configSchema: accordionListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 6, defaultW: 8, defaultH: 8 }, // annex min 4×3, default 8×4
  placement: 'grid',
  skeleton: 'list',
  demoData: accordionListDemoData,
  descriptionKey: 'widgets.tables.accordionList.description',
});

export const comparisonMatrixDefinition: WidgetDefinition = defineWidget({
  id: 'comparison-matrix',
  family: 'tables',
  component: lazy(() => import('./tables-tail-components.js').then((m) => ({ default: m.ComparisonMatrixWidget }))),
  configSchema: comparisonMatrixConfigSchema,
  // annex §3: "static or config-driven rows {label, cells[bool|string]}" — the
  // payload IS the composition (a pricing grid is authored, not queried), which
  // is the `static` shape, exactly as `upload-dropzone` (§8) and `empty-state`
  // (§12) use it.
  dataContract: 'static',
  sizing: { minW: 6, minH: 6, defaultW: 12, defaultH: 12 }, // annex "full-width section"
  placement: 'grid',
  skeleton: 'table',
  demoData: comparisonMatrixDemoData,
  descriptionKey: 'widgets.tables.comparisonMatrix.description',
});

export const chipCloudDefinition: WidgetDefinition = defineWidget({
  id: 'chip-cloud',
  family: 'tables',
  component: lazy(() => import('./tables-tail-components.js').then((m) => ({ default: m.ChipCloudWidget }))),
  configSchema: chipCloudConfigSchema,
  // annex §3: "string array (+ optional icon per chip)" — carried in the
  // canonical `categorical` envelope (`{ items: [...] }`) so the host's shared
  // `isEmptyByShape` routes an empty cloud to the empty state.
  dataContract: 'categorical',
  sizing: { minW: 3, minH: 2, defaultW: 4, defaultH: 4 }, // annex "inline / min 3×1"
  placement: 'inline',
  skeleton: 'block',
  demoData: chipCloudDemoData,
  descriptionKey: 'widgets.tables.chipCloud.description',
});

export const tablesTailDefinitions: readonly WidgetDefinition[] = [
  sparklineTableDefinition,
  topMoversListDefinition,
  rankedEntityListDefinition,
  accordionListDefinition,
  comparisonMatrixDefinition,
  chipCloudDefinition,
];
