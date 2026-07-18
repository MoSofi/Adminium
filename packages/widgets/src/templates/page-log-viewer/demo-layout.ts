/**
 * The default `page-log-viewer` demo layout — the manifest's slot areas
 * (templates/page-log-viewer.json) filled the way the §14 archetype pass fills
 * them on an audit table: a KPI pair, the required `log` slot (`log-table`),
 * and the `trace` slot (`timeline-vertical`). No bindings → every widget
 * renders `demoData(hash(instanceId))` (04 §5.3 demo mode). Used by
 * Storybook, tests and first-run states.
 */

import type { PageLayout } from '../../page-config/index.js';

export const demoLogViewerLayout: PageLayout = {
  version: 1,
  items: [
    {
      i: 'kpi-row-1',
      widget: 'kpi-stat-card',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: { title: 'Events (24h)', metricLabel: 'Events (24h)', metricFormat: 'compact', iconName: 'zap', iconTone: 'accent' },
    },
    {
      i: 'kpi-row-2',
      widget: 'kpi-stat-card',
      x: 3,
      y: 0,
      w: 3,
      h: 3,
      config: { title: 'Error rate', metricLabel: 'Error rate', metricFormat: 'percent', iconName: 'alert', iconTone: 'danger', invertDeltaGood: true },
    },
    {
      i: 'log',
      widget: 'log-table',
      x: 0,
      y: 3,
      w: 12,
      h: 14,
      config: { title: 'Audit log' },
    },
    {
      i: 'trace',
      widget: 'timeline-vertical',
      x: 0,
      y: 17,
      w: 12,
      h: 8,
      config: { title: 'Latest activity', variant: 'trace' },
    },
  ],
};
