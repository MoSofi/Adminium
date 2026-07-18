/**
 * Data-io route factory (M7-T07, 09-generated-app.md §11) — mounted under the
 * authed app layout by app/router.tsx, the studioRoutes pattern: this module
 * defines the surfaces, the router only wires them.
 *
 * - `/imports` — the Import Wizard (§11.1)
 * - `/exports` — the Data Exports manager (§11.2)
 *
 * No role guard: both surfaces are useful to anyone holding a per-table
 * import/export grant, and the server is the security boundary
 * (`table:<conn>:<table>:import|export` on every route).
 */
import { createRoute, type AnyRoute } from '@tanstack/react-router';

import { DataExportsPage } from './DataExportsPage.js';
import { ImportWizardPage } from './ImportWizardPage.js';

export function dataIoRoutes(parent: AnyRoute): AnyRoute[] {
  const importsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/imports',
    component: ImportWizardPage,
  });

  const exportsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/exports',
    component: DataExportsPage,
  });

  return [importsRoute, exportsRoute];
}

export { DataExportsPage, ImportWizardPage };
