// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page that waits does not take the shell with it.
 *
 * A generated page has no boundary of its own, and it may wait after the
 * shell is on screen: the dashboard builder waits for its words, which are
 * fetched after the first paint. That wait must end inside `<main>`. Before
 * the shell had a boundary there, the rail and the top bar left the screen
 * for as long as the words took, and came back. Rendered through the real
 * router, because where the wait lands is the router's tree, not the shell's
 * alone.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { use, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';

const wait = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
});

// The page under the shell's outlet: it waits as the builder waits for its words.
vi.mock('../pages/PageRenderer.js', () => ({
  PageRenderer: function WaitingPage(): ReactNode {
    use(wait.promise);
    return <p data-testid="page">the page</p>;
  },
}));

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a page that waits under the shell', () => {
  it('leaves the rail and the top bar on screen, and shows itself when its wait ends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.startsWith('/api/v1/branding')) {
          return Promise.resolve(jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }));
        }
        if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: makeBootstrap() }));
        if (url.startsWith('/api/v1/me/notifications')) {
          return Promise.resolve(jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }));
        }
        return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }));
      }),
    );
    const queryClient = createQueryClient();
    const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/p/anything'] }) });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // The page is still waiting, and the shell is there.
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.queryByTestId('page')).toBeNull();
    expect(document.querySelector('main')?.textContent).toBe('');

    await act(async () => {
      wait.release();
      await wait.promise;
    });
    expect((await screen.findByTestId('page')).textContent).toBe('the page');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
  });
});
