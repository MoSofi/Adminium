/**
 * `domain` family component barrel — the single lazy-import target for this
 * family's definitions, so the registry metadata graph reaches the widget
 * components only through a dynamic `import()` boundary (one lazy chunk per
 * family, 04 §2.3; chunk-budget gate). Mirrors the boards/kpi/charts/feeds
 * `*-components.ts` convention.
 */
export { GanttChartWidget } from './GanttChart.js';
export { OrgChartWidget } from './OrgChart.js';
