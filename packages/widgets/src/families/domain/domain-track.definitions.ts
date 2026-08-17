// SPDX-License-Identifier: AGPL-3.0-only
import { lazy } from 'react';

import { ganttChartConfigSchema, ganttChartDemoData, orgChartConfigSchema, orgChartDemoData } from './domain-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * `domain` family registry metadata (annex §13; M7 Wave 3) — the two widgets
 * named directly in M7's exit criteria ("an org chart for a self-FK people
 * table, a gantt for start/end/progress").
 *
 * Metadata only — the components load through the `domain-track-components`
 * barrel via `lazy(() => import(...))`, so the family stays in ONE lazy chunk
 * and the registry metadata never eagerly pulls component code into a sibling
 * family's bundle (04 §2.3). The GREEN LOOP spreads `domainTrackDefinitions`
 * into the registry map. Widget ids match the annex catalog exactly
 * (acceptance #1).
 *
 * SIZING — annex "Grid: 12×6" for both. Heights are 40px HALF-units (04 §6.1),
 * so `defaultH = round(6 × 2) = 12`. The mins are the smallest cell at which
 * each stays legible: a gantt needs its label gutter + a readable axis, an org
 * chart needs at least a root + one report band.
 */

export const orgChartDefinition: WidgetDefinition = defineWidget({
  id: 'org-chart',
  family: 'domain',
  component: lazy(() =>
    import('./domain-track-components.js').then((m) => ({ default: m.OrgChartWidget })),
  ),
  configSchema: orgChartConfigSchema,
  /**
   * The annex declares `hierarchy/tree` ("from self-referencing FK
   * (manager_id)"), and that is the canonical envelope. `record-list` is
   * declared ALONGSIDE it because the flat self-FK people table this widget
   * auto-instantiates from is compiled by the server as a record-list — the
   * component adapts it (`orgRootsOf`). Declaring both also keeps the host's
   * shared `isEmptyData` correct for either payload: with several shapes a
   * payload is empty only when EVERY shape reads it as empty, so a populated
   * `{ rows: [...], total: n }` is never mistaken for empty just because it has
   * no `roots` key — and `{ roots: [], total: 0 }` still reads as empty because
   * the tree demo envelope carries `total` (see domain-types.ts).
   */
  dataContract: ['hierarchy/tree', 'record-list'],
  sizing: { minW: 6, minH: 8, defaultW: 12, defaultH: 12 }, // annex 12×6 → h = 6×2
  placement: 'grid',
  skeleton: 'block',
  demoData: orgChartDemoData,
  descriptionKey: 'widgets.domain.orgChart.description',
});

export const ganttChartDefinition: WidgetDefinition = defineWidget({
  id: 'gantt-chart',
  family: 'domain',
  component: lazy(() =>
    import('./domain-track-components.js').then((m) => ({ default: m.GanttChartWidget })),
  ),
  configSchema: ganttChartConfigSchema,
  /**
   * §3 has no gantt-specific envelope; the annex derives the chart "from
   * start/end date columns + progress + phase FK", which is a `record-list`
   * projection. Empty ⇔ `total === 0 && !cursor` (the shared predicate).
   */
  dataContract: 'record-list',
  sizing: { minW: 8, minH: 8, defaultW: 12, defaultH: 12 }, // annex 12×6 → h = 6×2
  placement: 'grid',
  skeleton: 'chart',
  demoData: ganttChartDemoData,
  descriptionKey: 'widgets.domain.ganttChart.description',
});

export const domainTrackDefinitions: readonly WidgetDefinition[] = [
  ganttChartDefinition,
  orgChartDefinition,
];
