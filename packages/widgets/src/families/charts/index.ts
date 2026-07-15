/**
 * `charts` family public surface (annex §2) — metadata only. Component code for
 * every chart widget loads through each definition's `lazy()` ref (one Vite
 * chunk per family, 04 §2.3), so this barrel deliberately re-exports the
 * per-track *definition arrays* rather than the widget components, keeping the
 * family's eager surface empty. The GREEN LOOP spreads these same arrays into
 * the central `widgetRegistry` (registry/index.ts).
 */
import type { WidgetDefinition } from '../../registry/types.js';

import { chartsWidgetDefinitions } from './definitions.js';
import { barsRankingChartDefinitions } from './bars-ranking-definitions.js';
import { distributionCorrelationChartDefinitions } from './definitions.distribution-correlation.js';
import { partWholeChartDefinitions } from './def.part-whole.js';
import { matrixGeoChartDefinitions } from './defs.matrix-geo.js';

export {
  chartsWidgetDefinitions,
  barsRankingChartDefinitions,
  distributionCorrelationChartDefinitions,
  partWholeChartDefinitions,
  matrixGeoChartDefinitions,
};

/** Every `charts`-family widget definition delivered so far (M4 slice + 04-T09 waves). */
export const chartsFamilyDefinitions: readonly WidgetDefinition[] = [
  ...chartsWidgetDefinitions,
  ...barsRankingChartDefinitions,
  ...distributionCorrelationChartDefinitions,
  ...partWholeChartDefinitions,
  ...matrixGeoChartDefinitions,
];
