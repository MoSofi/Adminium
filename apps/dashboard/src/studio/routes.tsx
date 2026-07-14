/**
 * Studio route factory (09 §8.1) — mounted under the authed app layout by
 * app/router.tsx. Routes this wave:
 *
 * - `/studio`                        → redirects to the connect wizard (the
 *                                      connections-overview hub is 09-T14)
 * - `/studio/connect`                → connect wizard (M5-T01/02/03)
 * - `/studio/remap/$connectionId`    → schema remap editor — OWNED BY THE
 *   REMAP AGENT. Contract: `./remap/RemapEditor.tsx` exports
 *   `RemapEditor({ connectionId }: { connectionId: string })`. Loaded
 *   lazily via `import.meta.glob` so this wave builds before that file
 *   lands (a friendly placeholder renders meanwhile).
 *
 * All Studio surfaces are wrapped in `StudioGuard` (role ≥ Admin).
 */
import { Suspense, lazy, type ComponentType } from 'react';
import { createRoute, redirect, useNavigate, type AnyRoute } from '@tanstack/react-router';
import { Alert, Spinner } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { StudioGuard } from './StudioGuard.js';
import { ConnectWizard } from './connect/ConnectWizard.js';

// --- remap contract (file owned by the remap agent, may land later) ----------

interface RemapEditorModule {
  RemapEditor: ComponentType<{ connectionId: string }>;
}

const remapModules = import.meta.glob('./remap/RemapEditor.tsx');

function RemapUnavailable() {
  return (
    <div className="mx-auto max-w-narrow p-6">
      <Alert
        tone="info"
        title={t('studio.remap.unavailableTitle', 'Schema remap editor not available')}
        body={t(
          'studio.remap.unavailableBody',
          'This build does not include the remap editor yet (09-T12). Re-run generation after it lands to remap labels, types and relations.',
        )}
      />
    </div>
  );
}

const RemapEditorLazy = lazy(async (): Promise<{ default: ComponentType<{ connectionId: string }> }> => {
  const loader = remapModules['./remap/RemapEditor.tsx'];
  if (loader === undefined) return { default: RemapUnavailable };
  const mod = (await loader()) as RemapEditorModule;
  return { default: mod.RemapEditor };
});

function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center p-10">
      <Spinner size="md" />
    </div>
  );
}

// --- route components ---------------------------------------------------------

function ConnectRouteComponent() {
  const navigate = useNavigate();
  return (
    <StudioGuard>
      <ConnectWizard onOpenApp={() => void navigate({ to: '/' })} />
    </StudioGuard>
  );
}

// --- factory -------------------------------------------------------------------

/**
 * Builds the Studio child routes for the given authed layout route.
 * Kept here so app/router.tsx only wires, never defines, Studio surfaces.
 */
export function studioRoutes(parent: AnyRoute): AnyRoute[] {
  const studioIndexRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio',
    beforeLoad: () => {
      // Hub (connections overview) is 09-T14 — the wizard is the M5 landing.
      throw redirect({ to: '/studio/connect' });
    },
  });

  const connectRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/connect',
    component: ConnectRouteComponent,
  });

  const remapRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/remap/$connectionId',
    component: RemapRouteComponent,
  });

  function RemapRouteComponent() {
    const { connectionId } = remapRoute.useParams();
    return (
      <StudioGuard>
        <Suspense fallback={<CenteredSpinner />}>
          <RemapEditorLazy connectionId={connectionId} />
        </Suspense>
      </StudioGuard>
    );
  }

  return [studioIndexRoute, connectRoute, remapRoute];
}

/** Test seam: does the remap module exist in this build? */
export function remapEditorBundled(): boolean {
  return remapModules['./remap/RemapEditor.tsx'] !== undefined;
}

// Referenced by tests that render the wizard outside the router.
export { ConnectWizard };
