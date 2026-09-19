// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on page host, end to end, on a REAL i18next instance — the twin of
 * `studio/studioRoute.i18n.test.tsx`.
 *
 * `addOnPageHost.test.tsx` beside this one installs the i18n stand-in, which
 * resolves the whole en-US catalogue synchronously. That is the right tool for
 * asserting WHICH of the host's states renders, and it is structurally unable
 * to assert this: with the stand-in, `addOnMessagesReady()` is already
 * resolved, the Suspense boundary never engages, and no bundle is ever
 * fetched.
 *
 * de_DE on purpose. English proves nothing here, because every call site in
 * `AddOnPageHost.tsx` carries the English as its inline fallback — so an
 * English assertion passes just as happily when the German bundle was never
 * registered at all. That is not hypothetical: `addOns` shipped without its
 * entries in the lazy registry (`resources/lazy.ts`), and every add-ons screen
 * rendered English for all seven translated locales while every test stayed
 * green. German can only have come from a bundle that was fetched.
 *
 * NOT a second copy of `packages/i18n/src/create-i18n.test.ts`'s
 * `it.each(DEFERRED_NAMESPACES)` gate, which came out of the same incident and
 * covers strictly more namespaces. That one asks whether the i18n layer
 * RESOLVES a deferred namespace once something calls `loadNamespaces`. This
 * asks whether this SCREEN is the something — that the host awaits
 * `addOnMessagesReady()` and paints behind its own Suspense boundary, rather
 * than rendering its inline English first. Both can hold without the other:
 * a host that forgets the await resolves German perfectly and still shows
 * English. The same pair exists for `studio`, and this is the add-on twin of
 * its route half.
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

const PAGE = {
  addOnKey: 'invoices',
  ref: 'documents',
  labelKey: 'addon.invoices.nav',
  fallback: 'Invoice documents',
  icon: 'file-text',
  client: 'dist/pages/invoices.js',
  group: 'library',
  order: 20,
  adminOnly: false,
  detail: true,
};

/**
 * Neither state asserted below reaches `MountedPage`, so the add-ons list is
 * never queried — the only routes that matter are bootstrap (the nav these
 * states are decided from) and the i18n bundle fetch that
 * `deferredMessagesReady` makes for de_DE and en_US alike.
 */
function stubFetch(pages: unknown[]) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: makeBootstrap({ addOnNav: { groups: [], pages: pages as never } }),
          }),
        );
      }
      if (url.startsWith('/api/v1/branding')) {
        return Promise.resolve(
          jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }),
        );
      }
      if (url.startsWith('/api/v1/me/notifications')) {
        return Promise.resolve(
          jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }),
        );
      }
      // Including `/api/v1/i18n/bundle/*/addOns` — no overrides on this
      // instance, which is the ordinary case. An override would mask the very
      // thing under test: it is applied on top of the compiled bundle, so a
      // German override would render German even with no bundle registered.
      return Promise.resolve(jsonResponse(200, { overrides: {} }));
    }),
  );
}

async function renderAt(path: string) {
  setI18nInstance(await createI18n({ locale: 'de_DE', loadBundle: loadLocaleBundle }));
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setI18nInstance(null);
});

describe('an add-on page host route on a real i18n instance', () => {
  it('says an absent add-on is absent in German, not in the English it was written with', async () => {
    stubFetch([]);
    await renderAt('/add-ons/invoices/documents');

    expect(await screen.findByText('Dieses Add-on ist nicht installiert')).toBeTruthy();
    expect(screen.queryByText('This add-on is not installed')).toBeNull();
  });

  /*
   * A second key from the same namespace, reached down a different branch of
   * the host. One string could be carried by an accident of the fallback
   * chain; two, on two paths, can only be the `de-DE/addOns` chunk.
   */
  it('says an unknown page is unknown in German', async () => {
    stubFetch([PAGE]);
    await renderAt('/add-ons/invoices/keine-solche-seite');

    expect(await screen.findByText('Seite nicht vorhanden')).toBeTruthy();
    expect(screen.queryByText('No such page')).toBeNull();
  });
});
