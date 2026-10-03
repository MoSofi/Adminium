// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The update toaster is loaded only where the desktop bridge is (a browser
 * never downloads it), and there it still hears a new version app-wide.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function renderApp(): void {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) =>
      Promise.resolve(String(input).includes('/api/v1/bootstrap') ? jsonResponse(200, { data: makeBootstrap() }) : jsonResponse(200, { data: null })),
    ),
  );
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
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
  delete (window as { adminiumDesktop?: unknown }).adminiumDesktop;
});

describe('the desktop update toaster', () => {
  it('is loaded on desktop and says a new version is available', async () => {
    let emit: ((event: { type: string; version?: string }) => void) | null = null;
    (window as { adminiumDesktop?: unknown }).adminiumDesktop = {
      onUpdateEvent: (cb: (event: { type: string; version?: string }) => void) => {
        emit = cb;
        return () => undefined;
      },
      setMenuLabels: vi.fn(async () => Promise.resolve()),
    };
    renderApp();
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit?.({ type: 'available', version: '9.9.9' }));
    expect(await screen.findByText('A new version of Adminium is available')).toBeTruthy();
  });
});
