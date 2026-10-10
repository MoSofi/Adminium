// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PANEL, AS A DOCUMENT OF ITS OWN.
 *
 * On an app's own staff address the loader (`loader.ts`) opens this page in a
 * frame. It is the dashboard's panel and nothing else of the dashboard: no
 * shell, no bootstrap (a screens-only person may not read it, and the panel
 * does not need it). Who is signed in and the token their writes carry come
 * from the side's own `surface-config.json`, whose address the loader passes.
 *
 * The conversation is the general one, told which app it was opened over.
 * Same routes as in the dashboard, so the same grants, limits, masking,
 * switches, confirmation and allowance.
 *
 * A link in an answer that leads to a page of the dashboard cannot be opened
 * here: it opens the dashboard in a new tab instead, and the panel stays.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, useRouter } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@adminium/i18n/react';

import { setCsrfToken } from '../../app/api.js';
import { createQueryClient } from '../../app/query.js';
import { initDashboardI18n } from '../../i18n/setup.js';
import { PageActionsProvider } from '../../shell/PageActionsProvider.js';
import { AssistantDock } from '../dock/AssistantDock.js';
import { initDock, setDockOpen, useDockOpen, useDockSignal } from '../dock/dockStore.js';
import '../../styles.css';

/** What the loader passes in the address: read once, and only what each may be. */
export function panelQuery(search: string): { app: string; config: string; dir: 'ltr' | 'rtl'; theme: 'light' | 'dark' } {
  const query = new URLSearchParams(search);
  const app = (query.get('app') ?? '').replace(/[^a-z0-9-]/gi, '');
  const asked = query.get('config') ?? '';
  // The side's own configuration, on this origin: a path, never an address of somebody else's.
  const config = /^\/(?:apps\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)?staff\/)?surface-config\.json$/i.test(asked) ? asked : '/surface-config.json';
  return { app, config, dir: query.get('dir') === 'rtl' ? 'rtl' : 'ltr', theme: query.get('theme') === 'dark' ? 'dark' : 'light' };
}

function toParent(message: Record<string, unknown>): void {
  if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
}

/** The dock, filling the frame; closing it tells the page that holds the frame. */
function Panel() {
  const open = useDockOpen();
  const signal = useDockSignal();
  useEffect(() => {
    if (!open) toParent({ milo: 'close' });
  }, [open]);
  useEffect(() => {
    toParent({ milo: 'signal', signal });
  }, [signal]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      if ((event.data as { milo?: unknown } | null)?.milo === 'open') setDockOpen(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return (
    <PageActionsProvider>
      {/* The dock stands beside a page column in the dashboard; here there is none, and it has the frame to itself. */}
      <div className="flex h-dvh w-full justify-end bg-transparent">
        <div hidden />
        <AssistantDock visible={open} />
      </div>
    </PageActionsProvider>
  );
}

/** Anywhere else a link leads is a page of the dashboard: opened there, in a tab of its own. */
function Elsewhere() {
  const router = useRouter();
  useEffect(() => {
    const { pathname, searchStr } = router.state.location;
    window.open(`${pathname}${searchStr}`, '_blank', 'noopener');
    router.history.back();
  }, [router]);
  return null;
}

async function start(): Promise<void> {
  const asked = panelQuery(window.location.search);
  const root = document.documentElement;
  root.setAttribute('data-theme', asked.theme);
  root.setAttribute('dir', asked.dir);

  // Who is signed in, and the token their writes carry. Without them the panel cannot ask anything.
  const answer = await fetch(asked.config, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!answer.ok) throw new Error(`the side's configuration answered ${String(answer.status)}`);
  const config = (await answer.json()) as { user?: { id?: unknown }; csrfToken?: unknown };
  const userId = typeof config.user?.id === 'string' ? config.user.id : '';
  if (userId === '' || typeof config.csrfToken !== 'string') throw new Error('nobody is signed in on this side');
  setCsrfToken(config.csrfToken);
  initDock(userId);
  setDockOpen(true);

  const i18n = await initDashboardI18n();
  const queryClient = createQueryClient();

  const rootRoute = createRootRoute({ component: () => <Outlet />, notFoundComponent: Elsewhere });
  // The app's key rides in the route, where the dock reads which app a general question is asked over.
  const staff = createRoute({ getParentRoute: () => rootRoute, path: '/staff/$appKey', component: Panel });
  const router = createRouter({
    routeTree: rootRoute.addChildren([staff]),
    history: createMemoryHistory({ initialEntries: [`/staff/${asked.app === '' ? 'app' : asked.app}`] }),
  });

  const container = document.getElementById('root');
  if (container === null) throw new Error('missing #root container');
  createRoot(container).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nProvider>
    </StrictMode>,
  );
}

// Under a test `panelQuery` is read, and nothing is started.
if (typeof document !== 'undefined' && document.getElementById('root') !== null && window.location.pathname.endsWith('/panel.html')) void start();
