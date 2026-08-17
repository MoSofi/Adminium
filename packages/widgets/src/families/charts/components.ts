// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` family component barrel — the single lazy-import target of this
 * family's definitions (one Vite chunk per family, 04 §2.3).
 */
export {
  ChartBarWidget,
  ChartDonutWidget,
  ChartLineAreaWidget,
  ChartSparklineWidget,
} from './ChartWidgets.js';
