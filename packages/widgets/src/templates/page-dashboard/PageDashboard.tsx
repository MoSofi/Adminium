/**
 * `page-dashboard` template renderer (04-widget-registry.md §10,
 * 09-generated-app.md §7.2, M4-T05).
 *
 * Renders a stored `config.layout` (pageLayoutSchema) on the static 12-col
 * DashboardGrid: every item becomes a WidgetHost fed by the
 * DashboardData adapter (one `queryBatch` round trip for all bound
 * widgets, per-item error isolation) or by deterministic demo data when
 * unbound. Responsive stacking below `lg` comes from the grid. Edit mode
 * (dashboard builder) is 04-T12/M7; the chrome toolbar
 * (`date-range-picker` publishing `dateRange.*` params) arrives with the
 * chrome family — `params` is already plumbed through to the adapter.
 */

import { useMemo } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import { WidgetHost } from '../../frame/WidgetHost.js';
import { DashboardGrid } from '../../grid/DashboardGrid.js';
import { pageLayoutSchema, type PageLayout } from '../../page-config/index.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from './data-adapter.js';

export interface PageDashboardProps {
  /** The page's `config.layout` document (raw — validated here). */
  layout: unknown;
  /** Transport for bound widgets; absent → full demo mode (04 §5.3). */
  adapter?: DashboardDataAdapter | undefined;
  /** Page-control params (e.g. `dateRange.*`) forwarded to every binding. */
  params?: Record<string, unknown> | undefined;
  /** Widget events (drill-through, record-open, mutate) bubble here. */
  onEvent?: ((instanceId: string, event: WidgetEvent) => void) | undefined;
  /** Test/story override — wins over adapter/demo resolution per instance. */
  states?: DashboardDataStates | undefined;
  className?: string | undefined;
}

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

export function PageDashboard({ layout, adapter, params, onEvent, states, className }: PageDashboardProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => {
    const result = pageLayoutSchema.safeParse(layout);
    if (result.success) return { layout: result.data, invalid: false };
    return { layout: EMPTY_LAYOUT, invalid: true };
  }, [layout]);

  const dataStates = useDashboardData(parsed.layout, adapter, params);

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-dashboard-invalid">
        {t(
          'ui:templates.dashboard.invalidLayout',
          'This dashboard’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  return (
    <DashboardGrid
      layout={parsed.layout}
      className={className}
      testId="page-dashboard"
      renderItem={(item) => (
        <WidgetHost
          widgetId={item.widget}
          instanceId={item.i}
          config={item.config}
          data={states?.[item.i] ?? dataStates[item.i] ?? { status: 'loading' }}
          onEvent={onEvent === undefined ? undefined : (event) => onEvent(item.i, event)}
        />
      )}
    />
  );
}
