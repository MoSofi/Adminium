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
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { ThemeProvider, TooltipProvider, type ThemePrefs } from '@adminium/ui';

import { AccountPage } from '../pages/AccountPage.js';
import { HomePage } from '../pages/HomePage.js';
import { PageRenderer } from '../pages/PageRenderer.js';
import { ForgotPage } from '../auth/ForgotPage.js';
import { LoginPage } from '../auth/LoginPage.js';
import { OtpPage } from '../auth/OtpPage.js';
import { ResetPage } from '../auth/ResetPage.js';
import { ShortcutsProvider } from '../shell/ShortcutsProvider.js';
import { AppShell } from '../shell/AppShell.js';
import { NotFoundPage } from '../states/NotFoundPage.js';
import { StatePage } from '../states/StatePage.js';
import { api, ApiError } from './api.js';
import { bootstrapQuery, defaultPageSlug, type BootstrapData, type ResolvedPrefs } from './bootstrap.js';
import { requestIdForError, stateIdForError } from './query.js';

export interface RouterContext {
  queryClient: QueryClient;
}

// --- link helpers (§2.3: the only way shell code builds links) --------------

export function hrefForPage(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

export function hrefForRecord(slug: string, recordId: string): string {
  return `/p/${encodeURIComponent(slug)}/r/${encodeURIComponent(recordId)}`;
}

// --- root: theming + keyboard providers around every surface ----------------

function toThemePrefs(prefs: ResolvedPrefs): Partial<ThemePrefs> {
  return { theme: prefs.theme, accent: prefs.accent, density: prefs.density, locale: prefs.locale };
}

function RootComponent() {
  // Cache subscription only — pre-auth surfaces render from the localStorage
  // pre-paint baseline; once bootstrap lands, server-resolved axes win
  // (ThemeProvider resolution order, 02-design-system.md §4.2).
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const authed = boot.data !== undefined;

  return (
    <ThemeProvider
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
          <Outlet />
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

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } =>
    typeof search.returnTo === 'string' && search.returnTo.startsWith('/')
      ? { returnTo: search.returnTo }
      : {},
  beforeLoad: ({ context }) => redirectIfAuthed(context.queryClient),
  component: LoginPage,
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

function StateRouteComponent() {
  const { stateId } = stateRoute.useParams();
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

const pageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/p/$slug',
  component: PageRenderer,
});

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: AccountPage,
});

const accountSplatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account/$',
  component: AccountPage,
});

// --- assembly ----------------------------------------------------------------

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotRoute,
  resetRoute,
  otpRoute,
  stateRoute,
  appRoute.addChildren([indexRoute, pageRoute, accountRoute, accountSplatRoute]),
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
