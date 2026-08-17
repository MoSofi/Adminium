// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `kpi` family component barrel — the single lazy-import target of this
 * family's definitions, so Vite emits one chunk for the whole family
 * (04 §2.3). The ONLY module in the family that imports component code:
 * `definitions.ts` reaches it exclusively through `lazy(() => import(...))`,
 * which keeps the @adminium/ui-heavy widgets out of the registry's eager graph
 * (enforced by `qa/chunk-budget.test.ts`).
 */
export { KpiStatCard } from './KpiStatCard.js';
export { UsageMeter } from './UsageMeter.js';
export { KpiStatTileCompact } from './KpiStatTileCompact.js';
export { MetricHero } from './MetricHero.js';
export { StatPairCard } from './StatPairCard.js';
export { GaugeRing } from './GaugeRing.js';
export { GaugeArc } from './GaugeArc.js';
export { PeriodComparison } from './PeriodComparison.js';
export { MicroKpiSubtitle } from './MicroKpiSubtitle.js';
export { AutoInsights } from './AutoInsights.js';
