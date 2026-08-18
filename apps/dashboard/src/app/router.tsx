// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TanStack Router tree — code-based, per 09-generated-app.md §2.3: a single
 * dynamic `/p/$slug` route resolves generated pages from the nav tree (the
 * nav is data, the route is code), auth screens are public, `/state/$stateId`
 * addresses every system state directly, and the catch-all renders the
 * branded 404. `hrefForPage`/`hrefForRecord` are the only way shell code
 * builds links.
 */
import type { QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { Suspense, lazy, useSyncExternalStore, type ComponentType } from 'react';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { allLocales, getI18nRevision, subscribeI18nRevision } from '@adminium/i18n';
import { ThemeProvider, TooltipProvider, type ThemePrefs } from '@adminium/ui';
import { ChartDirectionBridge, WidgetRuntimeProvider } from '@adminium/widgets';

import { dataIoRoutes } from '../data-io/routes.js';
import { reportsRoutes } from '../reports/routes.js';
import { SetupPage } from '../setup/SetupPage.js';
import { setupStateQuery } from '../setup/setupApi.js';
import { HomePage } from '../pages/HomePage.js';
import { PageRenderer } from '../pages/PageRenderer.js';
import { ForgotPage } from '../auth/ForgotPage.js';
import { LoginPage } from '../auth/LoginPage.js';
import { OtpPage } from '../auth/OtpPage.js';
import { ResetPage } from '../auth/ResetPage.js';
import { ShortcutsProvider } from '../shell/ShortcutsProvider.js';
import { useBrandedDocumentTitle } from '../shell/BrandMark.js';
import { AppShell } from '../shell/AppShell.js';
import { NotFoundPage } from '../states/NotFoundPage.js';
import { StatePage } from '../states/StatePage.js';
import { pageQuery } from '../api/pages.js';
import { StudioGuard } from '../studio/StudioGuard.js';
import { studioRoutes } from '../studio/routes.js';
import { widgetRuntimeEnv } from '../lib/widget-runtime.js';
import { api, ApiError } from './api.js';
import { bootstrapQuery, defaultPageSlug, findNavItemBySlug, type BootstrapData, type ResolvedPrefs } from './bootstrap.js';
import { isHostedPlanSurface } from './capabilities.js';
import { requestIdForError, stateIdForError } from './query.js';


// --- lazy route components --------------------------------------------------
/**
 * Every route component below is behind a dynamic import, and the reason is the
 * gate: `check-entry-budget` measures the SYNCHRONOUSLY loaded set, and a route
 * component statically imported here is in it by definition — on every route,
 * for every user, including the ones who never open that screen.
 *
 * What is NOT lazy is deliberate: the auth screens, `AppShell`, `HomePage`,
 * `PageRenderer`, `StatePage` and `NotFoundPage` are the first paint. Putting a
 * chunk fetch in front of those trades bytes for a blank frame, which is the
 * wrong trade at exactly the moment the app is being judged on speed.
 */
function lazyRoute(load: () => Promise<ComponentType>): ComponentType {
  const Lazy = lazy(async () => ({ default: await load() }));
  return function LazyRoute() {
    return (
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>
    );
  };
}

const AboutPageLazy = lazyRoute(async () => (await import('../about/AboutPage.js')).AboutPage);
const ApiKeysPageLazy = lazyRoute(async () => (await import('../api-keys/ApiKeysPage.js')).ApiKeysPage);
const ChangelogPageLazy = lazyRoute(async () => (await import('../changelog/ChangelogPage.js')).ChangelogPage);
const KnowledgeBasePageLazy = lazyRoute(async () => (await import('../kb/KnowledgeBasePage.js')).KnowledgeBasePage);
const AccountPageLazy = lazyRoute(async () => (await import('../pages/AccountPage.js')).AccountPage);
const NotificationSettingsPageLazy = lazyRoute(async () => (await import('../account/NotificationSettingsPage.js')).NotificationSettingsPage);
const PreferencesPageLazy = lazyRoute(async () => (await import('../account/PreferencesPage.js')).PreferencesPage);
const DesktopSettingsPageLazy = lazyRoute(async () => (await import('../desktop/DesktopSettingsPage.js')).DesktopSettingsPage);
const DesktopSetupHostLazy = lazyRoute(async () => (await import('../desktop/setup/desktopSetupHost.js')).DesktopSetupHost);
const GlobalDefaultsPageLazy = lazyRoute(async () => (await import('../settings/GlobalDefaultsPage.js')).GlobalDefaultsPage);
const OnboardingChecklistLazy = lazyRoute(async () => (await import('../onboarding/OnboardingChecklist.js')).OnboardingChecklist);

export interface RouterContext {
  queryClient: QueryClient;
}

// --- link helpers (§2.3: the only way shell code builds links) --------------

export { hrefForPage, hrefForRecord } from './links.js';

// --- root: theming + keyboard providers around every surface ----------------

function toThemePrefs(prefs: ResolvedPrefs): Partial<ThemePrefs> {
  return { theme: prefs.theme, accent: prefs.accent, density: prefs.density, locale: prefs.locale };
}

/**
 * Direction for a locale `@adminium/ui` cannot know about (23 §5.4). That
 * package has no dependency on `@adminium/i18n`, so the app injects the
 * lookup; `null` defers to the compiled table and the cached `dir` axis.
 */
function resolveLocaleDir(locale: string): 'ltr' | 'rtl' | null {
  const entry = allLocales().find((l) => l.id === locale);
  return entry?.dir ?? null;
}

function RootComponent() {
  // Cache subscription only — pre-auth surfaces render from the localStorage
  // pre-paint baseline; once bootstrap lands, server-resolved axes win
  // (ThemeProvider resolution order, 02-design-system.md §4.2).
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const authed = boot.data !== undefined;

  // Branding is fetched here rather than in the shell: `/branding` is public,
  // and the surfaces that need it most (sign-in, 404, the error heroes) are
  // the ones the shell never wraps.
  useBrandedDocumentTitle();

  // Re-render the route tree when runtime overrides change (23 §4.4). This is
  // a RE-RENDER, never a keyed remount: keying this subtree would remount
  // ThemeProvider — the owner of the locale axis and of the optimistic
  // `setPref` layer — which silently reverts a locale the user just chose and
  // destroys the Translations editor's own unsaved buffer on every save.
  useSyncExternalStore(subscribeI18nRevision, getI18nRevision, getI18nRevision);

  return (
    <ThemeProvider
      resolveDir={resolveLocaleDir}
      {...(boot.data === undefined ? {} : { userPrefs: toThemePrefs(boot.data.prefs) })}
      onPrefChange={(key, value) => {
        // Persist per-user axes once signed in (09 §5.1 ThemeProvider wiring).
        if (!authed) return;
        api.patch('/api/v1/me/prefs', { [key]: value }).catch(() => {
          // Non-fatal: the axis still applied locally; next boot re-resolves.
        });
      }}
    >
      <TooltipProvider>
        <ShortcutsProvider>
          {/* Bridge i18n dir → charts so chart chrome mirrors in RTL (§5.5). */}
          <ChartDirectionBridge>
            {/* The offline asset policy (11-electron.md §7). It belongs HERE, on
                the root route, rather than deeper: every widget in the product
                mounts through a WidgetHost under this Outlet — generated pages,
                the dashboard builder's canvas, the palette's previews — and each
                one reads this context to decide whether a `map-*` id may load a
                map engine. One provider below any of them is a page that can
                still pull Leaflet in the desktop shell. */}
            <WidgetRuntimeProvider env={widgetRuntimeEnv}>
              <Outlet />
            </WidgetRuntimeProvider>
          </ChartDirectionBridge>
        </ShortcutsProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: () => <NotFoundPage />,
});

// --- public: auth group + direct-address system states ----------------------

/** Authed users bounce off auth screens back into the app (09 §2.3 guard). */
function redirectIfAuthed(queryClient: QueryClient): void {
  if (queryClient.getQueryData(bootstrapQuery().queryKey) !== undefined) {
    throw redirect({ to: '/' });
  }
}

/**
 * First-run gate (M10-T04). A never-bootstrapped instance has no user to sign
 * in as, so every pre-auth surface routes to the wizard instead of showing a
 * sign-in form nobody can satisfy. `setupStateQuery` is `staleTime: Infinity`
 * and setup state is a one-way door, so this costs one request per session.
 *
 * Never fatal: if the probe itself fails (offline, 503 META_NOT_CONFIGURED),
 * fall through to the normal screen rather than trapping the user on a wizard
 * we cannot confirm they need.
 */
async function redirectIfSetupRequired(queryClient: QueryClient): Promise<void> {
  let required: boolean;
  try {
    required = (await queryClient.ensureQueryData(setupStateQuery())).required;
  } catch {
    return;
  }
  if (required) throw redirect({ to: '/setup' });
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } =>
    typeof search.returnTo === 'string' && search.returnTo.startsWith('/')
      ? { returnTo: search.returnTo }
      : {},
  beforeLoad: async ({ context }) => {
    redirectIfAuthed(context.queryClient);
    await redirectIfSetupRequired(context.queryClient);
  },
  component: LoginPage,
});

/**
 * `/setup` — the first-run wizard. Reachable ONLY while setup is required: once
 * the super admin exists this redirects to `/login`, so the wizard cannot be
 * re-opened on a configured instance. (The server's 409 is the actual
 * guarantee; this is the UX that keeps users away from a dead end.)
 */
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context }) => {
    const state = await context.queryClient.ensureQueryData(setupStateQuery());
    if (!state.required) throw redirect({ to: '/login' });
  },
  component: SetupPage,
});

/**
 * `/desktop/setup` — the DESKTOP first-run wizard (11-electron.md §6, 11-T07).
 *
 * NOT `/setup`, and the two are not variants of each other. `/setup` above is
 * M10's self-host bootstrap: an admin account and the consent answers, on a
 * server someone has already configured. This one also picks the data
 * directory, seeds the first database from one of §6's four source cards, and
 * writes `config.json` — none of which exists off the desktop shell.
 *
 * ─── THIS ROUTE IS THE SHELL'S FRONT DOOR ────────────────────────────────────
 *
 * `main/index.ts`'s `appUrl` navigates the window here on EVERY launch with no
 * `config.json` (§2.2 step 8), and only this wizard writes one. The route
 * missing is therefore not a dead link, it is an unusable product: the shipped
 * tree navigated here, TanStack fell through to `notFoundComponent`, and a
 * brand-new user's first and only screen was the branded 404 — with no account,
 * no database, and no way forward on this or any subsequent launch.
 *
 * ─── WHY THERE IS NO `beforeLoad` GUARD ──────────────────────────────────────
 *
 * `/setup` guards on `setupStateQuery().required` and bounces to `/login` when
 * setup is done. This one deliberately does not, because the checks that would
 * matter here cannot be made from a route guard:
 *
 *  - "is this the desktop app?" is a §4 BRIDGE question (`window.adminiumDesktop`),
 *    and `settingsDesktopRoute` below already establishes the house answer —
 *    the component owns that check, not the guard.
 *  - "is this a first run?" is a question about `config.json`, which the SERVER
 *    cannot see (§2.3: main owns that file) — so no server probe can answer it.
 *
 * The component is what degrades: off-desktop, or on a configured install, it
 * renders through and the server's own 409 on `POST /setup/super-admin` is the
 * real guarantee — the same division of labour `/setup`'s header states ("The
 * server's 409 is the actual guarantee; this is the UX").
 */
const desktopSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desktop/setup',
  component: DesktopSetupHostLazy,
});

const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot',
  beforeLoad: ({ context }) => redirectIfAuthed(context.queryClient),
  component: ForgotPage,
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset/$token',
  component: ResetPage,
});

const otpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/otp',
  beforeLoad: ({ context }) => redirectIfAuthed(context.queryClient),
  component: OtpPage,
});

/**
 * `/state/$stateId` addresses every system state directly (§6.1) — including
 * `suspended`, the 402 workspace-suspended screen (administrative copy since the
 * free-launch pivot, 17-deferred-monetization.md). 11-electron.md §8.2 row 1 says
 * hosted-plan surfaces are "not rendered at all" outside Cloud, and on
 * self-host/desktop its primary action already goes nowhere (`StatePage`'s
 * `suspended: () => undefined`), so this is the one hosted-plan surface the SPA
 * can actually reach. The 404 is the honest answer:
 * on a build with no billing, a billing page does not exist.
 */
function StateRouteComponent() {
  const { stateId } = stateRoute.useParams();
  if (isHostedPlanSurface(stateId)) return <NotFoundPage />;
  return <StatePage stateId={stateId} />;
}

const stateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/state/$stateId',
  component: StateRouteComponent,
});

// --- authed layout: session guard + error → system-state mapping ------------

function AppErrorComponent({ error }: { error: Error }) {
  return <StatePage stateId={stateIdForError(error)} requestId={requestIdForError(error)} />;
}

const appRoute = createRoute({
  id: 'app',
  getParentRoute: () => rootRoute,
  beforeLoad: async ({ context, location }): Promise<{ bootstrap: BootstrapData }> => {
    try {
      const bootstrap = await context.queryClient.ensureQueryData(bootstrapQuery());
      return { bootstrap };
    } catch (error) {
      // 401 → login with returnTo (09 §2.1 failure branches); everything else
      // falls through to the errorComponent's system-state mapping.
      if (error instanceof ApiError && error.status === 401) {
        // ...unless nobody has bootstrapped this instance yet, in which case
        // there is no account to return to — send them to the wizard (M10-T04).
        await redirectIfSetupRequired(context.queryClient);
        throw redirect({ to: '/login', search: { returnTo: location.href } });
      }
      throw error;
    }
  },
  errorComponent: AppErrorComponent,
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    // `/` → the first Workspace nav item; empty nav renders the
    // empty-no-sources home (§2.3).
    const slug = defaultPageSlug(context.bootstrap.nav);
    if (slug !== null) throw redirect({ to: '/p/$slug', params: { slug } });
  },
  component: HomePage,
});

/**
 * Loader contract (09 §2.3): resolve the slug against the bootstrap nav tree
 * (unknown slug → 404 in-component, NO server round trip) and prime
 * `['page', pageId]` via ensureQueryData. Loader failures (403/404/5xx from
 * the pages API) render the matching system state inside the content outlet.
 */
async function loadPageDocument(
  queryClient: QueryClient,
  bootstrap: BootstrapData,
  slug: string,
): Promise<void> {
  const item = findNavItemBySlug(bootstrap.nav, slug);
  if (item === null) return; // PageRenderer renders the branded 404.
  await queryClient.ensureQueryData(pageQuery(item.pageId));
}

/** Page-scoped failure: system state inside the outlet — shell stays usable. */
function PageRouteErrorComponent({ error }: { error: Error }) {
  return (
    <StatePage stateId={stateIdForError(error)} requestId={requestIdForError(error)} fullPage={false} />
  );
}

const pageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/p/$slug',
  loader: ({ context, params }) => loadPageDocument(context.queryClient, context.bootstrap, params.slug),
  errorComponent: PageRouteErrorComponent,
  component: PageRenderer,
});

/** Record detail child route (09 §2.3): template-dependent rendering (§7.1). */
const pageRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/p/$slug/r/$recordId',
  loader: ({ context, params }) => loadPageDocument(context.queryClient, context.bootstrap, params.slug),
  errorComponent: PageRouteErrorComponent,
  component: PageRenderer,
});

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: AccountPageLazy,
});

/** First-run onboarding surface (M5-T06); admin-gated in-component. */
const welcomeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/welcome',
  component: OnboardingChecklistLazy,
});

// --- M8 preference surfaces (10-i18n-theming.md §7.3–§7.4) -------------------
// APPEND-ONLY additions coordinated with the concurrent /studio/* route work:
// this block adds exactly two routes and their two imports below.

const accountPreferencesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account/preferences',
  component: PreferencesPageLazy,
});

/**
 * Notification settings (M7 T6, ia-mapping §2A ACCOUNT group) — the
 * `page-settings` binding on a static route until the Engine seeds the
 * utility page (see account/NotificationSettingsPage.tsx). Per-user surface,
 * no role guard: `/me/notification-prefs` is session-scoped on the server.
 */
const accountNotificationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account/notifications',
  component: NotificationSettingsPageLazy,
});

/**
 * Email templates manager (M7 wave 2, TRACK BUILDERS; ia-mapping §2A LIBRARY
 * group). No client role guard: GET list/detail are session-scoped on the
 * server — the manager is read-useful to non-admins — and PUT is guarded by
 * `system:settings:manage`, whose 403 flows through the standard route error
 * mapping. The NAV entry (SidebarNav) is what gates discovery to admins.
 */
/**
 * LAZY, and this one paid more than any other split in this file. The editor
 * shares the block canvas with `page-builder`, so a static import reached
 * `@adminium/widgets`' `PageBuilder` → `WidgetHost` → the whole widget
 * REGISTRY: 23 families of definitions and Zod config schemas, 336 KiB
 * minified, in the entry chunk of every user on every route — for one admin
 * screen. It was the last thing holding the registry in the entry.
 */
const EmailTemplatesPageLazy = lazy(async () => {
  const mod = await import('../pages/builders/EmailTemplatesPage.js');
  return { default: mod.EmailTemplatesPage };
});

function EmailTemplatesRouteComponent() {
  return (
    <Suspense fallback={null}>
      <EmailTemplatesPageLazy />
    </Suspense>
  );
}

const emailTemplatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/email-templates',
  component: EmailTemplatesRouteComponent,
});

const settingsDefaultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/defaults',
  component: GlobalDefaultsPageLazy,
});

/**
 * Languages & translations (23-runtime-translations.md §7). No client role
 * guard here — the component renders the 403 state for non-super-admins and
 * the server enforces `system:settings:manage` on every write regardless.
 */
const settingsTranslationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/translations',
  component: TranslationsRouteComponent,
});

/**
 * LAZY, deliberately. The editor pulls the whole key-browser UI for a surface
 * a handful of super-admins open occasionally — statically importing it pushed
 * the entry chunk past `check-entry-budget`'s ratchet, and the right answer to
 * that gate is the one it prints: lazy-load the addition rather than raise the
 * baseline (the v1.0 target is 350 KiB gz and the entry is already ~664).
 */
const TranslationsPageLazy = lazy(async () => {
  const mod = await import('../settings/TranslationsPage.js');
  return { default: mod.TranslationsPage };
});

function TranslationsRouteComponent() {
  return (
    <Suspense fallback={null}>
      <TranslationsPageLazy />
    </Suspense>
  );
}

const accountSplatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account/$',
  component: AccountPageLazy,
});

/**
 * The desktop settings panel (11-electron.md §2.3/§8) — this device's own
 * settings, not the workspace's. Renders the 404 state outside the Electron
 * shell; the component owns that check, because "is this the desktop app?" is a
 * §4 bridge question and not something a route guard can ask the server.
 */
const settingsDesktopRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/desktop',
  component: DesktopSettingsPageLazy,
});

/** About / version / licence + the self-host update notice (M10-T04). */
const aboutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/about',
  component: AboutPageLazy,
});

// --- M10-T06 in-app product comms -------------------------------------------
// Two of these are for EVERYONE and one is not, and the split is the point:
// help and release notes are things any signed-in user needs (a viewer hitting
// a wall needs the docs more than an admin does), while API keys mint
// credentials and stay behind the same role ≥ Admin gate as the rest of the
// platform surfaces (`ia-mapping.md` §2B lists all three under Surface B).
// The server independently guards `/api-keys` with `system:api-keys:manage` —
// this gate is UX, not the security boundary.

const knowledgeBaseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/help',
  component: KnowledgeBasePageLazy,
});

const changelogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/changelog',
  component: ChangelogPageLazy,
});

function ApiKeysRouteComponent() {
  return (
    <StudioGuard>
      <ApiKeysPageLazy />
    </StudioGuard>
  );
}

const apiKeysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/api-keys',
  component: ApiKeysRouteComponent,
});

// --- people & accountability (08-T08, M2-T05, 09-T14) ------------------------
// All four are LAZY for the same reason `TranslationsPage` is: they are admin
// surfaces opened occasionally, and the entry chunk is already ~664 KiB gz
// against a 350 KiB v1.0 target. Statically importing a permission matrix, an
// audit table and a session list would spend the ratchet's remaining headroom
// on screens most sessions never open.
//
// Team/roles/audit sit behind `StudioGuard` like `apiKeysRoute` — role ≥ Admin.
// That gate is UX; the server independently enforces `system:users:manage`,
// `system:roles:manage` and `system:audit:read`. Account security is NOT
// guarded: it acts on the caller's own account, so every signed-in user needs
// it (a viewer changing their own password is the common case).

const TeamPageLazy = lazy(async () => {
  const mod = await import('../team/TeamPage.js');
  return { default: mod.TeamPage };
});

const RolesPageLazy = lazy(async () => {
  const mod = await import('../team/RolesPage.js');
  return { default: mod.RolesPage };
});

const AuditLogPageLazy = lazy(async () => {
  const mod = await import('../audit/AuditLogPage.js');
  return { default: mod.AuditLogPage };
});

const SecurityPageLazy = lazy(async () => {
  const mod = await import('../account/SecurityPage.js');
  return { default: mod.SecurityPage };
});

function TeamRouteComponent() {
  return (
    <StudioGuard>
      <Suspense fallback={null}>
        <TeamPageLazy />
      </Suspense>
    </StudioGuard>
  );
}

function RolesRouteComponent() {
  return (
    <StudioGuard>
      <Suspense fallback={null}>
        <RolesPageLazy />
      </Suspense>
    </StudioGuard>
  );
}

function AuditRouteComponent() {
  return (
    <StudioGuard>
      <Suspense fallback={null}>
        <AuditLogPageLazy />
      </Suspense>
    </StudioGuard>
  );
}

function AccountSecurityRouteComponent() {
  return (
    <Suspense fallback={null}>
      <SecurityPageLazy />
    </Suspense>
  );
}

const settingsTeamRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/team',
  component: TeamRouteComponent,
});

const settingsRolesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/roles',
  component: RolesRouteComponent,
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  component: AuditRouteComponent,
});

const accountSecurityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account/security',
  component: AccountSecurityRouteComponent,
});

// --- assembly ----------------------------------------------------------------

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotRoute,
  resetRoute,
  otpRoute,
  stateRoute,
  setupRoute,
  // §6's wizard. A CHILD OF ROOT, not of `appRoute`: `appRoute`'s beforeLoad
  // demands a bootstrap, and at first run there is no user to bootstrap as — it
  // would redirect the wizard to `/login`, which is the screen nobody can
  // satisfy on an install with zero accounts.
  desktopSetupRoute,
  appRoute.addChildren([
    indexRoute,
    pageRoute,
    pageRecordRoute,
    accountRoute,
    welcomeRoute,
    accountPreferencesRoute,
    accountNotificationsRoute,
    // BEFORE `accountSplatRoute`: `/account/$` would otherwise swallow
    // `/account/security` and render the generic account page instead.
    accountSecurityRoute,
    accountSplatRoute,
    aboutRoute,
    settingsDefaultsRoute,
    settingsTranslationsRoute,
    settingsDesktopRoute,
    knowledgeBaseRoute,
    changelogRoute,
    apiKeysRoute,
    settingsTeamRoute,
    settingsRolesRoute,
    auditRoute,
    emailTemplatesRoute,
    // Studio (09 §8.1): connect wizard + remap route contract, role ≥ Admin.
    ...studioRoutes(appRoute),
    // M7 wave 2 SPA surfaces (data-io §11, scheduled reports): same factory
    // pattern as studioRoutes — the modules define the surfaces, the router
    // only wires them. Server-side grants are the security boundary.
    ...dataIoRoutes(appRoute),
    ...reportsRoutes(appRoute),
  ]),
]);

export function createAppRouter(
  queryClient: QueryClient,
  options: { history?: RouterHistory | undefined } = {},
) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    ...(options.history === undefined ? {} : { history: options.history }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
