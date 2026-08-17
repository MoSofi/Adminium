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

import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { DataExportsPage } from './DataExportsPage.js';
import { ImportWizardPage } from './ImportWizardPage.js';

// Both are a short stack of controls rather than a grid, so they take the
// 900px reading column inside the standard gutter. `ImportWizardPage` is also
// the `page-wizard` template body, which is why the surface is here and not in
// the component — that mount gets its own from PageRenderer.
function ImportsRouteComponent() {
  return (
    <PageSurface width="content" fill>
      <PageActions title={t('dataio.import.title', 'Import data')} />
      <ImportWizardPage />
    </PageSurface>
  );
}

function ExportsRouteComponent() {
  return (
    <PageSurface width="content" fill>
      <PageActions title={t('dataio.exports.title', 'Data exports')} />
      <DataExportsPage />
    </PageSurface>
  );
}

export function dataIoRoutes(parent: AnyRoute): AnyRoute[] {
  const importsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/imports',
    component: ImportsRouteComponent,
  });

  const exportsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/exports',
    component: ExportsRouteComponent,
  });

  return [importsRoute, exportsRoute];
}

export { DataExportsPage, ImportWizardPage };
