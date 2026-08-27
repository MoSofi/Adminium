// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled-reports route factory (M7 reports track) — mounted under the
 * authed app layout by app/router.tsx, the studioRoutes/dataIoRoutes pattern:
 * this module defines the surface, the router only wires it.
 *
 * - `/reports` — the Scheduled Reports manager.
 *
 * LAZY, like the admin screens in app/router.tsx: this factory is imported
 * statically by the router, so a static page import here puts the whole
 * manager — and the `ScheduledJobsList` calendar family it pulls from
 * `@adminium/widgets` (~4 KiB gz together) — in the synchronously-loaded
 * entry set for every user on every route. An occasionally-opened admin
 * surface pays for itself on first open instead (check-entry-budget).
 *
 * No client-side role guard by design: the server enforces the
 * `system:reports:manage` grant on every admin verb (list degrades to
 * mine-only), and 403s flow through the existing route error mapping.
 */
import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

const ScheduledReportsPageLazy = lazy(async () => {
  const mod = await import('./ScheduledReportsPage.js');
  return { default: mod.ScheduledReportsPage };
});

function ReportsRouteComponent() {
  return (
    <Suspense fallback={null}>
      <ScheduledReportsPageLazy />
    </Suspense>
  );
}

export function reportsRoutes(parent: AnyRoute): AnyRoute[] {
  const reportsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/reports',
    component: ReportsRouteComponent,
  });

  return [reportsRoute];
}
