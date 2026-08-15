/**
 * The default `page-dashboard` demo layout — a straight port of the
 * "Adminium Dashboard" comp's core composition per the template manifest
 * areas (04 §10): a 4-card KPI row (3×3 each), the hero line-area (8×6),
 * the donut breakdown (4×6), a secondary bar chart, and the recent
 * mini-table slot. `mini-table` ships with the tables family (page-crud
 * slice); until it registers, WidgetHost renders the `widget-missing`
 * fallback card — by design, never a crash (04 §2.2).
 *
 * No bindings → every widget renders `demoData(hash(instanceId))`
 * (04 §5.3 demo mode). Used by Storybook, tests and first-run states.
 */

import type { PageLayout } from '../../page-config/index.js';

export const demoDashboardLayout: PageLayout = {
  version: 1,
  items: [
    // --- KPI row (slot kpi-row: 4 × 3w×3h) ---------------------------------
    {
      i: 'demo-kpi-revenue',
      widget: 'kpi-stat-card',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: {
        title: 'Revenue',
        metricLabel: 'Revenue (30d)',
        metricFormat: 'currency',
        iconName: 'dollar',
        iconTone: 'accent',
      },
    },
    {
      i: 'demo-kpi-projects',
      widget: 'kpi-stat-card',
      x: 3,
      y: 0,
      w: 3,
      h: 3,
      config: {
        title: 'Active projects',
        metricFormat: 'plain',
        iconName: 'package',
        iconTone: 'info',
        showSparkline: false,
      },
    },
    {
      i: 'demo-kpi-members',
      widget: 'kpi-stat-card',
      x: 6,
      y: 0,
      w: 3,
      h: 3,
      config: {
        title: 'Team members',
        metricFormat: 'compact',
        iconName: 'users',
        iconTone: 'pos',
        deltaMode: 'abs',
      },
    },
    {
      i: 'demo-kpi-errors',
      widget: 'kpi-stat-card',
      x: 9,
      y: 0,
      w: 3,
      h: 3,
      config: {
        title: 'Error rate',
        metricFormat: 'percent',
        iconName: 'zap',
        iconTone: 'danger',
        invertDeltaGood: true,
        showSparkline: false,
      },
    },
    // --- Hero chart (slot hero-chart: 8×6) + breakdown (4×6) ----------------
    {
      i: 'demo-hero-revenue',
      widget: 'chart-line-area',
      x: 0,
      y: 3,
      w: 8,
      h: 6,
      config: { title: 'Revenue over time' },
    },
    {
      i: 'demo-breakdown-tasks',
      widget: 'chart-donut',
      x: 8,
      y: 3,
      w: 4,
      h: 6,
      config: { title: 'Task breakdown', centerLabel: 'Total' },
    },
    // --- Secondary row: weekly activity bars + recent mini-table ------------
    {
      i: 'demo-weekly-activity',
      widget: 'chart-bar',
      x: 0,
      y: 9,
      w: 6,
      h: 6,
      config: { title: 'Weekly activity' },
    },
    {
      i: 'demo-recent-orders',
      widget: 'mini-table',
      x: 6,
      y: 9,
      w: 6,
      h: 6,
      config: { title: 'Recent orders' },
    },
  ],
};
