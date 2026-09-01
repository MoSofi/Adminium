// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A Studio route, end to end, on a REAL i18next instance (10-T06).
 *
 * Every other Studio page test installs the i18n stand-in, which resolves the
 * whole catalogue synchronously — so none of them exercises the thing the
 * namespace split actually introduced: a route that renders while its messages
 * do not exist yet, suspends on them through `use()`, and paints once the chunk
 * has landed. With the stand-in, `studioMessagesReady()` is already resolved
 * and the Suspense boundary never engages.
 *
 * de_DE on purpose. English proves nothing here: the inline fallback IS the
 * English, so a passing assertion cannot tell the catalogue from the fallback.
 * German can only have come from a bundle that was fetched.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n, loadLocaleBundle } from '@adminium/i18n';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { setI18nInstance } from '../i18n/t.js';
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

function stubFetch() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }),
        );
      }
      if (url.startsWith('/api/v1/surfaces')) {
        return Promise.resolve(jsonResponse(200, { instances: {}, surfaces: [], domains: {} }));
      }
      if (url.startsWith('/api/v1/connections')) {
        return Promise.resolve(jsonResponse(200, { connections: [] }));
      }
      if (url.startsWith('/api/v1/branding')) {
        return Promise.resolve(
          jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }),
        );
      }
      // Including `/api/v1/i18n/bundle/*/studio` — no overrides on this
      // instance, which is the ordinary case.
      return Promise.resolve(jsonResponse(200, { overrides: {} }));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setI18nInstance(null);
});

describe('a Studio route on a real i18n instance', () => {
  it('paints the German catalogue, not the English it was written with', async () => {
    stubFetch();
    setI18nInstance(await createI18n({ locale: 'de_DE', loadBundle: loadLocaleBundle }));

    const router = createAppRouter(createQueryClient(), {
      history: createMemoryHistory({ initialEntries: ['/studio/apps'] }),
    });
    render(
      <QueryClientProvider client={router.options.context.queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // The German heading exists only in the de-DE `studio` chunk, which is
    // fetched by `StudioBody` — the English 'Hosted apps' beside this call
    // site is what renders if any link in that chain is broken.
    expect(await screen.findByText('Gehostete Apps')).toBeTruthy();
    expect(screen.queryByText('Hosted apps')).toBeNull();
  });
});
