// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The at-least-once floor for `config-changed`, on the FIRST open and not
 * only after a drop.
 *
 * `app.realtime.publish` is fire-and-forget: one emit, no replay. The shell
 * fetches its bootstrap before its socket is up, so anything published in that
 * gap reached nobody — and `['bootstrap']` is `staleTime: Infinity`, so
 * without a resync on open the tab holds that payload for its whole life.
 * That is how `/p/<slug>` could sit on "This page is not in the running build"
 * until a reload, and a project cell report an unknown widget.
 *
 * Drives the real `createRealtimeClient` against a fake socket, so what is
 * asserted is the shell's actual wiring, not a restatement of the map in
 * `api/realtime.ts` (covered by `realtime.test.ts`).
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor() {
    sockets.push(this);
  }
  send(): void {}
  close(): void {}
}

/** How many times the app has asked the server for its bootstrap. */
let bootstrapCalls = 0;

function stubFetch() {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/api/v1/bootstrap')) {
      bootstrapCalls += 1;
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap() }));
    }
    // Everything else the shell happens to ask for. The assertion is on the
    // bootstrap count alone, so these only have to not throw.
    return Promise.resolve(jsonResponse(200, { data: null }));
  });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp() {
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

let restoreI18n: () => void;

beforeAll(() => {
  restoreI18n = installTestI18n();
});

afterAll(() => {
  restoreI18n();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sockets.length = 0;
  bootstrapCalls = 0;
});

describe('the shell resyncs when its socket opens', () => {
  it('refetches the bootstrap on open, so an event missed before the subscription was live is recovered', async () => {
    renderApp();
    await waitFor(() => {
      expect(bootstrapCalls).toBe(1);
    });
    const socket = sockets[0];
    expect(socket, 'the shell opened no socket').toBeDefined();

    // The server published while this tab had no live subscription. Nothing
    // delivers it; only the open itself says "resync".
    await act(async () => {
      socket?.onopen?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(bootstrapCalls).toBe(2);
    });
  });
});
