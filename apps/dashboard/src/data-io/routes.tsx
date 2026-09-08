// SPDX-License-Identifier: AGPL-3.0-only
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
 *
 * ─── Why both bodies are behind a dynamic import ─────────────────────────────
 *
 * `app/router.tsx` imports this factory STATICALLY — it has to, the routes are
 * built at module scope — so anything this file imports statically is in the
 * synchronously-loaded set `check-entry-budget` measures, on every route, for
 * every user, including the ones who never open either screen.
 *
 * For `ImportWizardPage` that was worse than a route body. It is ALSO the
 * `page-wizard` template body (`pages/PageWizardBinding.tsx`), so the lazy
 * binding that `pages/templates.tsx` registers for `page-wizard` was a no-op
 * while this file pulled the same module into the entry: the "lazy" chunk held
 * a 22-line wrapper and the body shipped on boot regardless. Thirteen of the
 * fourteen template bindings were genuinely deferred and the accounting said
 * fourteen. Both are deferred here, so both are now what they claim to be.
 */
import { Suspense, lazy } from 'react';
import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { Spinner } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';

const ImportWizardPageLazy = lazy(async () => {
  const mod = await import('./ImportWizardPage.js');
  return { default: mod.ImportWizardPage };
});

const DataExportsPageLazy = lazy(async () => {
  const mod = await import('./DataExportsPage.js');
  return { default: mod.DataExportsPage };
});

// The builder (41-export-builder.md) is the largest body under this factory —
// three steps, a column browser and a preview — and it pulls the Studio's
// column-spec composer with it. Deferred for the same reason as the wizard.
const ExportBuilderPageLazy = lazy(async () => {
  const mod = await import('./export-builder/ExportBuilderPage.js');
  return { default: mod.ExportBuilderPage };
});

/** Same shape as `studio/routes.tsx`'s: the frame holds, the body fills in. */
function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center p-10">
      <Spinner size="md" />
    </div>
  );
}

// Both take the shared `--container-page` column inside the standard gutter,
// the same as every other platform screen. They sat at the 900px reading
// column until the settings surfaces were unified on `page`, at which point
// being 180px narrower than their neighbours was the only thing distinguishing
// them. `ImportWizardPage` is also the `page-wizard` template body, which is
// why the surface is here and not in the component — that mount gets its own
// from PageRenderer, and still uses the template's own `content` column.
//
// The surface and its title stay OUTSIDE the Suspense boundary: the page names
// itself in the topbar on the first frame, and only the body waits for its
// chunk. Suspending the whole route would blank the title too, which reads as a
// navigation that did not happen.
function ImportsRouteComponent() {
  return (
    <PageSurface width="page" fill>
      <PageActions title={t('dataio.import.title', 'Import data')} />
      <Suspense fallback={<CenteredSpinner />}>
        <ImportWizardPageLazy />
      </Suspense>
    </PageSurface>
  );
}

function ExportsRouteComponent() {
  return (
    <PageSurface width="page" fill>
      <PageActions title={t('dataio.exports.title', 'Data exports')} />
      <Suspense fallback={<CenteredSpinner />}>
        <DataExportsPageLazy />
      </Suspense>
    </PageSurface>
  );
}

// The title, subtitle and back arrow are published by the body itself: the
// builder's header carries a "Based on …" chip the shell cannot know about
// until the export row has loaded, and the two publications must not race.
function ExportBuilderRouteComponent() {
  return (
    <PageSurface width="page" fill>
      <Suspense fallback={<CenteredSpinner />}>
        <ExportBuilderPageLazy />
      </Suspense>
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

  // `/exports/new?basedOn=<exportId>` — a static segment, so it wins over any
  // `/exports/:id` a later route might add; the search param pre-fills every
  // step from a finished export's stored definition (41 §4, "Based on").
  const exportBuilderRoute = createRoute({
    getParentRoute: () => parent,
    path: '/exports/new',
    validateSearch: (search: Record<string, unknown>): { basedOn?: string } =>
      typeof search['basedOn'] === 'string' && search['basedOn'].length > 0
        ? { basedOn: search['basedOn'] }
        : {},
    component: ExportBuilderRouteComponent,
  });

  return [importsRoute, exportsRoute, exportBuilderRoute];
}

// No re-export of the two page components. Nothing imported them from here —
// the tests and `PageWizardBinding` take them from their own modules — and a
// re-export out of a module the router imports statically is exactly the edge
// that would pull both bodies back into the entry chunk.
