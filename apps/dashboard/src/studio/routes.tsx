// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio route factory (09 §8.1) — mounted under the authed app layout by
 * app/router.tsx. Routes this wave:
 *
 * - `/studio`                        → connections manager hub (M5-T05)
 * - `/studio/connect`                → connect wizard (M5-T01/02/03)
 * - `/studio/pages`                  → page manager (08 §2.6 lifecycle surface)
 * - `/studio/settings`               → workspace settings hub (M5-T05)
 * - `/studio/public-api`             → the scoped public API: switch, scopes, keys
 *   (28-public-surface.md §3, 28-T13). LAZY like its siblings — see the note below.
 * - `/studio/apps`                   → hosted app surfaces: placement + domain
 *   attachment (29-app-surfaces.md §3.1, 29-T17). LAZY like its siblings.
 * - `/studio/remap/$connectionId`    → schema remap editor — OWNED BY THE
 *   REMAP AGENT. Contract: `./remap/RemapEditor.tsx` exports
 *   `RemapEditor({ connectionId }: { connectionId: string })`. Loaded
 *   lazily via `import.meta.glob` so this wave builds before that file
 *   lands (a friendly placeholder renders meanwhile).
 *
 * All Studio surfaces are wrapped in `StudioGuard` (role ≥ Admin).
 */
import { Suspense, lazy, useState, type ComponentType } from 'react';
import { createRoute, useNavigate, type AnyRoute } from '@tanstack/react-router';
import { Alert, Spinner } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { PageSurface } from '../shell/PageSurface.js';
import { StudioGuard } from './StudioGuard.js';
import { takeBridgeTicket } from './connect/bridgeSeed.js';

// --- the four Studio surfaces, LAZY -------------------------------------------
//
// Same reasoning as `TranslationsPageLazy` in app/router.tsx: these are
// admin-only screens a handful of super-admins open occasionally, and static
// imports put every one of them — the multi-step connect wizard, the
// connections hub, the settings hub and the AI panel — in the synchronously
// loaded entry set for every user on every route. That is what pushed the build
// past `check-entry-budget`'s ratchet, and the gate prints the remedy: lazy-load
// the addition rather than raise the baseline (the v1.0 target is 350 KiB gz).
//
// `takeBridgeTicket` stays static: it is a tiny module read in a state
// initialiser before the wizard renders, so deferring it would race the ticket.

const ConnectWizardLazy = lazy(async () => {
  const mod = await import('./connect/ConnectWizard.js');
  return { default: mod.ConnectWizard };
});

const ConnectionsHubLazy = lazy(async () => {
  const mod = await import('./hub/ConnectionsHub.js');
  return { default: mod.ConnectionsHub };
});

const StudioSettingsPageLazy = lazy(async () => {
  const mod = await import('./settings/StudioSettingsPage.js');
  return { default: mod.StudioSettingsPage };
});

const PublicApiPageLazy = lazy(async () => {
  const mod = await import('./public-api/PublicApiPage.js');
  return { default: mod.PublicApiPage };
});

const HostedAppsPageLazy = lazy(async () => {
  const mod = await import('./apps/HostedAppsPage.js');
  return { default: mod.HostedAppsPage };
});

const StudioAiPageLazy = lazy(async () => {
  const mod = await import('./ai/StudioAiPage.js');
  return { default: mod.StudioAiPage };
});

const StudioPagesPageLazy = lazy(async () => {
  const mod = await import('./pages/StudioPagesPage.js');
  return { default: mod.StudioPagesPage };
});

const NewPageScreenLazy = lazy(async () => {
  const mod = await import('./pages/NewPageScreen.js');
  return { default: mod.NewPageScreen };
});

const EditPageScreenLazy = lazy(async () => {
  const mod = await import('./pages/EditPageScreen.js');
  return { default: mod.EditPageScreen };
});

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
    <PageSurface width="narrow">
      <Alert
        tone="info"
        title={t('studio.remap.unavailableTitle', 'Schema remap editor not available')}
        body={t(
          'studio.remap.unavailableBody',
          'This build does not include the remap editor yet (09-T12). Re-run generation after it lands to remap labels, types and relations.',
        )}
      />
    </PageSurface>
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
    <PageSurface width="narrow">
      <Alert
        tone="info"
        title={t('studio.review.unavailableTitle', 'Review screen not available')}
        body={t(
          'studio.review.unavailableBody',
          'This build does not include the enrichment review screen yet (06-T14). It lands with the diff-and-apply flow.',
        )}
      />
    </PageSurface>
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
  // Read (and strip from history) once, in a state initialiser rather than an
  // effect: an effect would run after the first paint, so a fast re-render or a
  // StrictMode double-invoke could read a ticket the wizard had already spent.
  const [bridgeTicket] = useState(takeBridgeTicket);
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <ConnectWizardLazy
          bridgeTicket={bridgeTicket}
          onOpenApp={() => void navigate({ to: '/' })}
          onOpenReview={(runId) => void navigate({ to: '/studio/llm-runs/$runId/review', params: { runId } })}
        />
      </Suspense>
    </StudioGuard>
  );
}

function HubRouteComponent() {
  const navigate = useNavigate();
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <ConnectionsHubLazy
          onConnectNew={() => void navigate({ to: '/studio/connect' })}
          onOpenRemap={(connectionId) =>
            void navigate({ to: '/studio/remap/$connectionId', params: { connectionId } })
          }
          onOpenHostedApps={() => void navigate({ to: '/studio/apps' })}
        />
      </Suspense>
    </StudioGuard>
  );
}

function PagesRouteComponent() {
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <StudioPagesPageLazy />
      </Suspense>
    </StudioGuard>
  );
}

function NewPageRouteComponent() {
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <NewPageScreenLazy />
      </Suspense>
    </StudioGuard>
  );
}

function SettingsRouteComponent() {
  const navigate = useNavigate();
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <StudioSettingsPageLazy
          onOpenGlobalDefaults={() => void navigate({ to: '/settings/defaults' })}
          onOpenTranslations={() => void navigate({ to: '/settings/translations' })}
          onOpenAiSettings={() => void navigate({ to: '/studio/settings/ai' })}
          onOpenPages={() => void navigate({ to: '/studio/pages' })}
        />
      </Suspense>
    </StudioGuard>
  );
}

function PublicApiRouteComponent() {
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <PublicApiPageLazy />
      </Suspense>
    </StudioGuard>
  );
}

function HostedAppsRouteComponent() {
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <HostedAppsPageLazy />
      </Suspense>
    </StudioGuard>
  );
}

function AiSettingsRouteComponent() {
  const navigate = useNavigate();
  return (
    <StudioGuard>
      <Suspense fallback={<CenteredSpinner />}>
        <StudioAiPageLazy
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

  const pagesRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/pages',
    component: PagesRouteComponent,
  });

  // `/new` is registered BEFORE the `$pageId` param route so the literal wins.
  // Registered after, `new` would be matched as a page id and the create screen
  // would render "that page no longer exists".
  const newPageRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/pages/new',
    component: NewPageRouteComponent,
  });

  const editPageRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/pages/$pageId',
    component: EditPageRouteComponent,
  });

  function EditPageRouteComponent() {
    const { pageId } = editPageRoute.useParams();
    return (
      <StudioGuard>
        <Suspense fallback={<CenteredSpinner />}>
          <EditPageScreenLazy pageId={pageId} />
        </Suspense>
      </StudioGuard>
    );
  }

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

  const publicApiRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/public-api',
    component: PublicApiRouteComponent,
  });

  const hostedAppsRoute = createRoute({
    getParentRoute: () => parent,
    path: '/studio/apps',
    component: HostedAppsRouteComponent,
  });

  return [
    studioIndexRoute,
    connectRoute,
    pagesRoute,
    newPageRoute,
    editPageRoute,
    settingsRoute,
    aiSettingsRoute,
    publicApiRoute,
    hostedAppsRoute,
    reviewRoute,
    remapRoute,
  ];
}

/** Test seam: does the remap module exist in this build? */
export function remapEditorBundled(): boolean {
  return remapModules['./remap/RemapEditor.tsx'] !== undefined;
}
