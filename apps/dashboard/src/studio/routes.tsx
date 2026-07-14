/**
 * Studio route factory (09 §8.1) — mounted under the authed app layout by
 * app/router.tsx. Routes this wave:
 *
 * - `/studio`                        → connections manager hub (M5-T05)
 * - `/studio/connect`                → connect wizard (M5-T01/02/03)
 * - `/studio/settings`               → workspace settings hub (M5-T05)
 * - `/studio/remap/$connectionId`    → schema remap editor — OWNED BY THE
 *   REMAP AGENT. Contract: `./remap/RemapEditor.tsx` exports
 *   `RemapEditor({ connectionId }: { connectionId: string })`. Loaded
 *   lazily via `import.meta.glob` so this wave builds before that file
 *   lands (a friendly placeholder renders meanwhile).
 *
 * All Studio surfaces are wrapped in `StudioGuard` (role ≥ Admin).
 */
import { Suspense, lazy, type ComponentType } from 'react';
import { createRoute, useNavigate, type AnyRoute } from '@tanstack/react-router';
import { Alert, Spinner } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { StudioGuard } from './StudioGuard.js';
import { ConnectWizard } from './connect/ConnectWizard.js';
import { ConnectionsHub } from './hub/ConnectionsHub.js';
import { StudioSettingsPage } from './settings/StudioSettingsPage.js';
import { StudioAiPage } from './ai/StudioAiPage.js';

// --- remap contract (file owned by the remap agent, may land later) ----------

interface RemapEditorModule {
  RemapEditor: ComponentType<{ connectionId: string }>;
}

const remapModules = import.meta.glob('./remap/RemapEditor.tsx');

// --- review contract (screen owned by T14, may land later) -------------------
// The LLM-run review-diff screen (06 §10.3) is delivered separately. We register
// its route here — the single registration point, mirroring the remap contract —
// so the run-history rows on Settings → AI can navigate to it. It is loaded
// lazily from `./llm-runs/ReviewScreen.tsx` exporting
// `ReviewScreen({ runId }: { runId: string })`; a friendly placeholder renders
// until that file lands.

interface ReviewScreenModule {
  ReviewScreen: ComponentType<{ runId: string }>;
}

const reviewModules = import.meta.glob('./llm-runs/ReviewScreen.tsx');

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

function ReviewUnavailable() {
  return (
    <div className="mx-auto max-w-narrow p-6">
      <Alert
        tone="info"
        title={t('studio.review.unavailableTitle', 'Review screen not available')}
        body={t(
          'studio.review.unavailableBody',
          'This build does not include the enrichment review screen yet (06-T14). It lands with the diff-and-apply flow.',
        )}
      />
    </div>
  );
}

const ReviewScreenLazy = lazy(async (): Promise<{ default: ComponentType<{ runId: string }> }> => {
  const loader = reviewModules['./llm-runs/ReviewScreen.tsx'];
  if (loader === undefined) return { default: ReviewUnavailable };
  const mod = (await loader()) as ReviewScreenModule;
  return { default: mod.ReviewScreen };
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
      <ConnectWizard
        onOpenApp={() => void navigate({ to: '/' })}
        onOpenReview={(runId) => void navigate({ to: '/studio/llm-runs/$runId/review', params: { runId } })}
      />
    </StudioGuard>
  );
}

function HubRouteComponent() {
  const navigate = useNavigate();
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <ConnectionsHub
          onConnectNew={() => void navigate({ to: '/studio/connect' })}
          onOpenRemap={(connectionId) =>
            void navigate({ to: '/studio/remap/$connectionId', params: { connectionId } })
          }
        />
      </Suspense>
    </StudioGuard>
  );
}

function SettingsRouteComponent() {
  const navigate = useNavigate();
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <StudioSettingsPage
          onOpenGlobalDefaults={() => void navigate({ to: '/settings/defaults' })}
          onOpenAiSettings={() => void navigate({ to: '/studio/settings/ai' })}
        />
      </Suspense>
    </StudioGuard>
  );
}

function AiSettingsRouteComponent() {
  const navigate = useNavigate();
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <StudioAiPage
          onOpenReview={(runId) =>
            void navigate({ to: '/studio/llm-runs/$runId/review', params: { runId } })
          }
        />
      </Suspense>
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
    component: HubRouteComponent,
  });

  const connectRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/connect',
    component: ConnectRouteComponent,
  });

  const settingsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/settings',
    component: SettingsRouteComponent,
  });

  const aiSettingsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/settings/ai',
    component: AiSettingsRouteComponent,
  });

  const reviewRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/llm-runs/$runId/review',
    component: ReviewRouteComponent,
  });

  function ReviewRouteComponent() {
    const { runId } = reviewRoute.useParams();
    return (
      <StudioGuard>
        <Suspense fallback={<CenteredSpinner />}>
          <ReviewScreenLazy runId={runId} />
        </Suspense>
      </StudioGuard>
    );
  }

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

  return [studioIndexRoute, connectRoute, settingsRoute, aiSettingsRoute, reviewRoute, remapRoute];
}

/** Test seam: does the remap module exist in this build? */
export function remapEditorBundled(): boolean {
  return remapModules['./remap/RemapEditor.tsx'] !== undefined;
}

// Referenced by tests that render the wizard outside the router.
export { ConnectWizard };
