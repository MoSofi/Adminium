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
    // Sidebar: nav tree from bootstrap (groups + items), persona footer.
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Orders/ })).toBeDefined();
    expect(screen.getByText('ava@adminium.io')).toBeDefined();
    expect(screen.getByText('v0.0.0')).toBeDefined();
    // PageRenderer stub: Wave B note (pages API 404s in this fixture).
    expect(await screen.findByText(/Template not yet implemented/)).toBeDefined();
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the branded 404 for unknown routes', async () => {
    await renderAt('/totally/unknown', { authed: false });
    expect(await screen.findByText('This page went missing')).toBeDefined();
    expect(screen.getByText(/req_[0-9a-f]/)).toBeDefined();
    expect(screen.getByText('Popular destinations')).toBeDefined();
  });
});
