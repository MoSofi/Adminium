/**
 * `page-dashboard` binding (09-generated-app.md §4.1, §7.2): projects the
 * page envelope onto the real `PageDashboard` template from
 * `@adminium/widgets`.
 *
 * Data flow: the host's `useDashboardData` (src/api/widgetData.ts) already
 * runs the ONE deduped `POST /api/v1/widget-data/batch` per page mount under
 * TanStack Query key `['widget-data', pageId, params]` — a live observer, so
 * WS `widget-data:*`/`table:*` invalidations refetch automatically. This
 * binding materializes those per-instance `WidgetDataState`s and hands them
 * to the template through its `states` prop (per-instance resolution:
 * `states` → adapter → demo), leaving the template's `adapter` unset so
 * unbound instances keep the deterministic demo-data path (04 §5.3).
 *
 * Widget events re-enter the host sink (`adapters.onEvent`): record-open →
 * hrefForRecord navigation, drill-through → href push, mutate → CRUD + undo
 * toast (PageRenderer.usePageAdapters).
 */
import { useMemo } from 'react';
import { PageDashboard, type WidgetDataState } from '@adminium/widgets';

import { extractBindings } from '../api/widgetData.js';
import type { PageTemplateProps } from './template-types.js';

export function PageDashboardBinding({ page, adapters }: PageTemplateProps) {
  const dashboard = adapters.dashboard;
  const { requests, invalid } = useMemo(() => extractBindings(page), [page]);

  const states = useMemo(() => {
    if (dashboard === null) return undefined;
    const record: Record<string, WidgetDataState> = {};
    const instanceIds = [...requests.map((request) => request.instanceId), ...invalid.keys()];
    for (const instanceId of instanceIds) {
      const state = dashboard.stateFor(instanceId);
      if (state !== null) record[instanceId] = state;
    }
    return record;
  }, [dashboard, requests, invalid]);

  return (
    <PageDashboard
      layout={page.config['layout']}
      states={states}
      onEvent={(instanceId, event) => {
        void instanceId;
        adapters.onEvent(event);
      }}
    />
  );
}
