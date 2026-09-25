// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-dashboard` binding: projects the page envelope onto the real
 * `PageDashboard` template from `@adminium/widgets`.
 *
 * Data flow: the host's `useDashboardData` (src/api/widgetData.ts) already
 * runs the ONE deduped `POST /api/v1/widget-data/batch` per page mount under
 * TanStack Query key `['widget-data', pageId, params]` — a live observer, so
 * WS `widget-data:*`/`table:*` invalidations refetch automatically. This
 * binding materializes those per-instance `WidgetDataState`s and hands them
 * to the template through its `states` prop (per-instance resolution:
 * `states` → adapter → demo), leaving the template's `adapter` unset so
 * unbound instances keep the deterministic demo-data path.
 *
 * Widget events re-enter the host sink (`adapters.onEvent`): record-open →
 * hrefForRecord navigation, drill-through → href push, mutate → CRUD + undo
 * toast (PageRenderer.usePageAdapters).
 *
 * The binding hands the resolved page + per-instance data states to the
 * `DashboardBuilder` shell: in view mode it renders the same live
 * `PageDashboard`; in edit mode it swaps in the builder (palette, inspector,
 * add/duplicate/remove, save/reset) over a demo-data working draft.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { WidgetDataState, WidgetEvent } from '@adminium/widgets';

import { extractBindings } from '../api/widgetData.js';
import { bootstrapQuery } from '../app/bootstrap.js';
import { DashboardBuilder } from './dashboard-builder/index.js';
import { STAFF_HREF, openStaffTarget, staffTargetFor } from './staffLink.js';
import type { PageTemplateProps } from './template-types.js';

export function PageDashboardBinding({ page, adapters, canEditLayout, currency }: PageTemplateProps) {
  const dashboard = adapters.dashboard;
  const router = useRouter();
  /*
   * `@staff`: the owning app's staff screens, opened where the sidebar opens
   * them. Resolved here, in the dashboard template's own chunk, rather than in
   * the page host every template shares: only a dashboard draws a page link.
   */
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const staff = useMemo(() => (bootstrap === undefined ? null : staffTargetFor(bootstrap, page.id)), [bootstrap, page.id]);
  const linkAvailable = useCallback((href: string) => (href.startsWith('@') ? href === STAFF_HREF && staff !== null : true), [staff]);
  const onEvent = useCallback(
    (event: WidgetEvent) => {
      if (event.type === 'drill-through' && event.href.startsWith('@')) {
        // Another `@` address names something this host does not know: it
        // opens nothing (and `linkAvailable` kept its button from being drawn).
        if (event.href === STAFF_HREF && staff !== null) openStaffTarget(staff, (href) => router.history.push(href));
        return undefined;
      }
      // Forward the host's result so optimistic widgets (kanban) get the
      // mutate promise and can roll back a rejected move.
      return adapters.onEvent(event);
    },
    [adapters, router, staff],
  );
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
      day={adapters.dashboardDay ?? null}
      // An `@staff` link is drawn only when the owning app has staff screens.
      linkAvailable={linkAvailable}
      // The connection's currency: a money card that names none reads in it.
      {...(currency === undefined || currency === null ? {} : { currency })}
      onEvent={(instanceId, event) => {
        void instanceId;
        return onEvent(event);
      }}
    />
  );
}
