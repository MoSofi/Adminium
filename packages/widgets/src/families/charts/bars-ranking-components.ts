/**
 * "Bars & ranking" component barrel — the single lazy-import target for this
 * group's definitions, so Vite keeps the whole group in the one `charts` family
 * chunk (04 §2.3). The family barrels (`components.ts`, `definitions.ts`) are
 * assembled by the green loop; this group-scoped barrel avoids editing them.
 */
export {
  ChartBulletWidget,
  ChartMarimekkoWidget,
  ChartParetoWidget,
  ChartRankingBarsWidget,
  ChartSlopeWidget,
  ChartStackedBar100Widget,
  ChartWaterfallWidget,
} from './BarsRankingWidgets.js';
