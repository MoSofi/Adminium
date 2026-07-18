/**
 * Scheduled-reports route factory (M7 reports track) — mounted under the
 * authed app layout by app/router.tsx, the studioRoutes/dataIoRoutes pattern:
 * this module defines the surface, the router only wires it.
 *
 * - `/reports` — the Scheduled Reports manager.
 *
 * No client-side role guard by design: the server enforces the
 * `system:reports:manage` grant on every admin verb (list degrades to
 * mine-only), and 403s flow through the existing route error mapping.
 */
import { createRoute, type AnyRoute } from '@tanstack/react-router';

import { ScheduledReportsPage } from './ScheduledReportsPage.js';

export function reportsRoutes(parent: AnyRoute): AnyRoute[] {
  const reportsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/reports',
    component: ScheduledReportsPage,
  });

  return [reportsRoute];
}

export { ScheduledReportsPage };
