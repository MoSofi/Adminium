/**
 * @adminium/charts — bespoke SVG chart layer (workplan/04-widget-registry.md §7).
 * No chart library: d3-scale + d3-shape math only; colors strictly via CSS
 * custom properties from @adminium/tokens (viz.css). Consumers import
 * '@adminium/charts/styles.css' once for the structural/motion classes.
 *
 * geometry/ is pure and DOM-free (server-safe for scheduled-report rendering);
 * components/ are the React primitives. Storybook stories live in Wave B's
 * @adminium/widgets wrappers — this package hosts vitest render tests only.
 * Raster export (§7.6) is deferred; chart roots already carry data-export-node.
 */

// Core plumbing
export { ChartSurface } from './components/ChartSurface.js';
export type {
  ChartLabels,
  ChartPadding,
  ChartRenderContext,
  ChartSurfaceProps,
} from './components/ChartSurface.js';
export { ChartDirectionContext, useChartDir, useRtl } from './hooks/useRtl.js';
export type { ChartDir } from './hooks/useRtl.js';
export { prefersReducedMotion, useMountAnimation } from './hooks/useMountAnimation.js';
export { useMeasuredWidth } from './hooks/useChartSize.js';

// Primitives
export { LineAreaChart } from './components/LineAreaChart.js';
export type { LineAreaChartProps, LineAreaPoint } from './components/LineAreaChart.js';
export { BarChart } from './components/BarChart.js';
export type { BarChartProps, BarSeries } from './components/BarChart.js';
export { DonutChart } from './components/DonutChart.js';
export type { DonutChartProps } from './components/DonutChart.js';
export { Sparkline } from './components/Sparkline.js';
export type { SparklineProps, SparklineTone } from './components/Sparkline.js';

// Pure geometry (server-safe)
export {
  categoricalBandScale,
  categoricalPointScale,
  linearYScale,
  timeScale,
} from './geometry/scales.js';
export type { CategoricalScaleOptions } from './geometry/scales.js';
export { areaPath, linePath, nearestIndexByX } from './geometry/lineArea.js';
export type { XYPoint } from './geometry/lineArea.js';
export { highlightIndex, layoutBars } from './geometry/bars.js';
export type { BarLayout, BarLayoutOptions, BarRect, CategoryCenter, HighlightMode } from './geometry/bars.js';
export { bucketSlices, donutArcs } from './geometry/donut.js';
export type { DonutArcDatum, DonutArcsOptions, DonutSliceInput } from './geometry/donut.js';
export { sparkBars, sparkLine } from './geometry/sparkline.js';
export type { SparkBar, SparkLineLayout } from './geometry/sparkline.js';

// In-package math utils (no d3-array)
export { bins, extent, niceTicks, quantileSorted, tickStep } from './utils/stats.js';
export type { Bin } from './utils/stats.js';
export { formatCompact, formatShortDate } from './utils/format.js';

// Deterministic seeded demo data (§7.7)
export { fnv1a, mulberry32 } from './demo/mulberry32.js';
export {
  DEMO_EPOCH_MS,
  demoCategorical,
  demoComparisonSeries,
  demoDonut,
  demoGroupedBars,
  demoSparkline,
  demoTimeseries,
} from './demo/generators.js';
export type { DemoCategory, DemoGroupedBars, DemoPoint, DemoTimeseriesOptions } from './demo/generators.js';

// ── M7 Wave-1 chart primitives (04-T09) ──────────────────────────────────────
// One export block per widget family; geometry stays pure/DOM-free and the
// components remain bespoke SVG (no chart library). Widget wrappers in
// @adminium/widgets lazy-import these.

// Bars & ranking
export { BulletChart } from './components/BulletChart.js';
export type { BulletChartProps } from './components/BulletChart.js';
export { RankingBars } from './components/RankingBars.js';
export type { RankingBarsProps } from './components/RankingBars.js';
export { ParetoChart } from './components/ParetoChart.js';
export type { ParetoChartProps } from './components/ParetoChart.js';
export { WaterfallChart } from './components/WaterfallChart.js';
export type { WaterfallChartProps } from './components/WaterfallChart.js';
export { MarimekkoChart } from './components/MarimekkoChart.js';
export type { MarimekkoChartProps } from './components/MarimekkoChart.js';
export { StackedBar100 } from './components/StackedBar100.js';
export type { StackedBar100Props } from './components/StackedBar100.js';
export { SlopeChart } from './components/SlopeChart.js';
export type { SlopeChartProps } from './components/SlopeChart.js';

// Distribution & correlation
export { BoxPlotChart } from './components/BoxPlotChart.js';
export type { BoxPlotChartProps } from './components/BoxPlotChart.js';
export { ViolinChart } from './components/ViolinChart.js';
export type { ViolinChartProps } from './components/ViolinChart.js';
export { RidgelineChart } from './components/RidgelineChart.js';
export type { RidgelineChartProps } from './components/RidgelineChart.js';
export { HexbinChart } from './components/HexbinChart.js';
export type { HexbinChartProps } from './components/HexbinChart.js';
export { ScatterBubbleChart, vizColorAt } from './components/ScatterBubbleChart.js';
export type { ScatterBubbleChartProps } from './components/ScatterBubbleChart.js';
export { CorrelationMatrixChart } from './components/CorrelationMatrixChart.js';
export type { CorrelationMatrixChartProps } from './components/CorrelationMatrixChart.js';
export { ParallelCoordinatesChart } from './components/ParallelCoordinatesChart.js';
export type { ParallelCoordinatesChartProps } from './components/ParallelCoordinatesChart.js';
export type { ScatterPointInput, ParallelAxisInput, ParallelRecordInput } from './geometry/correlation.js';

// Part-to-whole
export { Treemap } from './components/Treemap.js';
export type { TreemapChartProps } from './components/Treemap.js';
export { Sunburst } from './components/Sunburst.js';
export type { SunburstChartProps } from './components/Sunburst.js';
export { Funnel } from './components/Funnel.js';
export type { FunnelChartProps } from './components/Funnel.js';
export { RadialBar } from './components/RadialBar.js';
export type { RadialBarChartProps } from './components/RadialBar.js';
export { Radar } from './components/Radar.js';
export type { RadarChartProps } from './components/Radar.js';
export { Chord } from './components/Chord.js';
export type { ChordChartProps, ChordLink } from './components/Chord.js';
export { WordCloud } from './components/WordCloud.js';
export type { WordCloudChartProps } from './components/WordCloud.js';

// Matrix & geo
export { CohortMatrixChart } from './components/CohortMatrixChart.js';
export type { CohortMatrixChartProps } from './components/CohortMatrixChart.js';
export { HeatCalendarChart } from './components/HeatCalendarChart.js';
export type { HeatCalendarChartProps } from './components/HeatCalendarChart.js';
export { HeatMonthChart } from './components/HeatMonthChart.js';
export type { HeatMonthChartProps } from './components/HeatMonthChart.js';
export { ChoroplethGridChart } from './components/ChoroplethGridChart.js';
export type { ChoroplethGridChartProps } from './components/ChoroplethGridChart.js';
// Pure geometry (server-safe): the tilegram-placeability predicate the geo
// widget uses to degrade an empty `us-tilegram` to the code-agnostic `grid`.
export { hasUsTilegramTiles } from './geometry/choropleth.js';
export { SankeyChart } from './components/SankeyChart.js';
export type { SankeyChartProps } from './components/SankeyChart.js';

// Time & flow (primitives; widget wrappers land in a later wave)
export { MultiLineChart } from './components/MultiLineChart.js';
export type { MultiLineChartProps, MultiLinePoint, MultiLineSeries } from './components/MultiLineChart.js';
export { StreamChart } from './components/StreamChart.js';
export type { StreamChartProps } from './components/StreamChart.js';
export { ForecastChart } from './components/ForecastChart.js';
export type { ForecastChartProps, ForecastPoint, ForecastBandPoint } from './components/ForecastChart.js';
export { AnomalyChart } from './components/AnomalyChart.js';
export type { AnomalyChartProps, AnomalyPoint } from './components/AnomalyChart.js';
export { CandlestickChart } from './components/CandlestickChart.js';
export type { CandlestickChartProps } from './components/CandlestickChart.js';
export { BumpChart } from './components/BumpChart.js';
export type { BumpChartProps } from './components/BumpChart.js';
export { TimelineLanesChart } from './components/TimelineLanesChart.js';
export type { TimelineLanesChartProps } from './components/TimelineLanesChart.js';
