/**
 * Router guards + shell integration (09-generated-app.md §2.3):
 * - unauthenticated `/` → `/login?returnTo=…`;
 * - authenticated `/` → first Workspace nav item, sidebar renders the nav
 *   tree from bootstrap, PageRenderer stub shows the Wave B note;
 * - `/state/$stateId` renders publicly; unknown routes render the branded 404.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { createQueryClient } from './query.js';
import { createAppRouter } from './router.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function stubFetch(authed: boolean) {
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        authed
          ? jsonResponse(200, { data: makeBootstrap() })
          : jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no session', requestId: 'req_a' } }),
      );
    }
    if (url.startsWith('/api/v1/pages/')) {
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no such route', requestId: 'req_b' } }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_c' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderAt(path: string, { authed }: { authed: boolean }) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const fetchMock = stubFetch(authed);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, fetchMock, queryClient };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('route guards', () => {
  it('redirects an unauthenticated / to /login with returnTo', async () => {
    const { router } = await renderAt('/', { authed: false });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeDefined();
  });

  it('sends an authed / to the first Workspace page and renders the shell', async () => {
    const { router, fetchMock } = await renderAt('/', { authed: true });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/p/customers');
    });
    // Sidebar: nav tree from bootstrap (groups + items) + the version chip.
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Orders/ })).toBeDefined();
    expect(screen.getByText('v0.0.0')).toBeDefined();
    // The persona is no longer a sidebar footer — identity now hangs off the
    // topbar account menu, so the email sits behind a closed dropdown and only
    // the trigger is assertable from the shell's resting state.
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeDefined();
    // Pages API 404s in this fixture → page-scoped not-found state inside the
    // outlet (shell + nav stay usable), never a crash.
    expect(await screen.findByText('This page went missing')).toBeDefined();
    // Boot discipline: exactly one bootstrap fetch.
    const bootstrapCalls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/v1/bootstrap'));
    expect(bootstrapCalls).toHaveLength(1);
  });

  it('renders unknown slugs as the branded 404 without a pages round trip', async () => {
    const { fetchMock } = await renderAt('/p/definitely-not-a-page', { authed: true });
    expect(await screen.findByText('This page went missing')).toBeDefined();
    const pageCalls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/v1/pages/'));
    expect(pageCalls).toHaveLength(0);
  });
});

describe('system-state routes', () => {
  it('serves /state/$stateId publicly', async () => {
    const { fetchMock } = await renderAt('/state/maintenance', { authed: false });
    expect(await screen.findByRole('heading', { name: 'Scheduled maintenance' })).toBeDefined();
    // Nothing session-shaped: this screen exists for visitors who have none.
    // `/branding` is the one call it does make, and it is public by design —
    // the state screens carry the workspace's own mark.
    const gated = fetchMock.mock.calls.filter(
      (call) => !String(call[0]).startsWith('/api/v1/branding'),
    );
    expect(gated).toHaveLength(0);
  });

  /**
   * 11-electron.md §8.2 row 1: hosted-plan surfaces are "not rendered at all"
   * outside Cloud. `/state/suspended` is the one the SPA can reach — the 402
   * workspace-suspended screen, which a self-host/desktop instance can never
   * legitimately produce.
   */
  it('404s the Cloud-only suspended state rather than rendering it', async () => {
    await renderAt('/state/suspended', { authed: false });
    expect(await screen.findByText('This page went missing')).toBeDefined();
    expect(screen.queryByText('This workspace is suspended')).toBeNull();
    expect(screen.queryByRole('button', { name: /Contact owner/ })).toBeNull();
  });

  it('renders the branded 404 for unknown routes', async () => {
    await renderAt('/totally/unknown', { authed: false });
    expect(await screen.findByText('This page went missing')).toBeDefined();
    expect(screen.getByText(/req_[0-9a-f]/)).toBeDefined();
    expect(screen.getByText('Popular destinations')).toBeDefined();
  });

  /**
   * ─── THE DESKTOP APP'S FRONT DOOR (11-electron.md §6, §2.2 step 8) ─────────
   *
   * `apps/desktop/src/main/index.ts`'s `appUrl({ firstRun: true, … })` navigates
   * the BrowserWindow to `<origin>/desktop/setup` on EVERY launch with no
   * `config.json`, and only the wizard at that path writes one. So this route
   * missing is not a dead link — it is a product that can never be set up: the
   * user lands on the 404, cannot create the super-admin, `firstRun` stays true,
   * and the next launch does it again.
   *
   * That shipped. The route did not exist, TanStack fell through to
   * `notFoundComponent`, and `main/index.test.ts` asserted
   * `appUrl({firstRun: true, …})` === 'http://127.0.0.1:4600/desktop/setup' and
   * PASSED the whole time — because string-comparing a URL builder never asks
   * whether anything answers at that URL.
   *
   * This test asks. It drives the REAL route tree at the REAL path and requires
   * something other than the 404, which is the one assertion the URL-builder
   * test structurally could not make.
   */
  it('serves the desktop first-run wizard at /desktop/setup — the URL main navigates to', async () => {
    // `authed: false` is the honest fixture: a first run has ZERO users, so
    // bootstrap 401s. A wizard behind an auth guard would be unreachable exactly
    // when it is needed, which is why the route is a child of root and not of
    // `appRoute`.
    await renderAt('/desktop/setup', { authed: false });

    expect(await screen.findByText('Where should Adminium keep your data?')).toBeDefined();
    // The 404 this route used to render. Named explicitly: "the heading is
    // present" would also pass if the wizard rendered *underneath* a 404.
    expect(screen.queryByText('This page went missing')).toBeNull();
    // And it did not bounce to the login nobody can satisfy on a fresh install.
    expect(screen.queryByText('Welcome back')).toBeNull();
  });

  it('does not send the desktop wizard to /login the way an app-route child would', async () => {
    // The regression a future refactor is most likely to introduce: moving
    // `desktopSetupRoute` under `appRoute` for tidiness. `appRoute.beforeLoad`
    // ensures a bootstrap and redirects a 401 to `/login?returnTo=…`, so the
    // wizard would vanish behind a sign-in form on precisely the install that
    // has no account to sign in with.
    const { router } = await renderAt('/desktop/setup', { authed: false });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/desktop/setup');
    });
  });
});
