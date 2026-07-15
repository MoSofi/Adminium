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
 *
 * The binding hands the resolved page + per-instance data states to the
 * `DashboardBuilder` shell (04-T14): in view mode it renders the same live
 * `PageDashboard`; in edit mode it swaps in the builder (palette, inspector,
 * add/duplicate/remove, save/reset) over a demo-data working draft.
 */
import { useMemo } from 'react';
import type { WidgetDataState } from '@adminium/widgets';

import { extractBindings } from '../api/widgetData.js';
import { DashboardBuilder } from './dashboard-builder/index.js';
import type { PageTemplateProps } from './template-types.js';

export function PageDashboardBinding({ page, adapters, canEditLayout }: PageTemplateProps) {
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
    <DashboardBuilder
      page={page}
      canEditLayout={canEditLayout ?? false}
      states={states}
      onEvent={(instanceId, event) => {
        void instanceId;
        // Forward the host's result so optimistic widgets (kanban) get the
        // mutate promise and can roll back a rejected move.
        return adapters.onEvent(event);
      }}
    />
  );
}
