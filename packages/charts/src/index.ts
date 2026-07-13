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
