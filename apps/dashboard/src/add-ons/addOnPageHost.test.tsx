// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mounting a page an add-on owns (51c).
 *
 * Every assertion here is about a way this can go wrong, because the ways it
 * goes wrong all look the same from the outside — a blank screen — and telling
 * them apart is the entire job of this component. The happy path is asserted
 * once; the four failures are asserted individually, with the sentence each one
 * puts on screen.
 *
 * The module importer is a seam: happy-dom cannot `import()` from a URL, and
 * pointing the test at a real bundle would be testing the network.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { forgetAddOnModules, setAddOnModuleImporter } from './client.js';

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

const BUNDLE = {
  path: 'dist/pages/invoices.js',
  url: '/api/v1/add-ons/invoices/bundle/dist/pages/invoices.js',
  integrity: 'sha256-Zm9vYmFy',
};

const INSTALLED = {
  key: 'invoices',
  name: 'Invoices & Receipts',
  version: '1.0.1',
  connectKind: 'none',
  enabled: true,
  bundles: [BUNDLE],
};

function stubFetch(over: { addOns?: unknown[]; pages?: unknown[]; addOnsStatus?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/branding')) {
        return Promise.resolve(
          jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }),
        );
      }
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: makeBootstrap({
              addOnNav: { groups: [], pages: (over.pages ?? [PAGE]) as never },
            }),
          }),
        );
      }
      if (url.startsWith('/api/v1/add-ons/catalog')) {
        return Promise.resolve(jsonResponse(200, { data: { addOns: [], fetchedAt: 0 } }));
      }
      if (url.startsWith('/api/v1/add-ons')) {
        /*
         * BARE, not `{ data: … }`. `apiFetch` returns the whole body and this
         * route replies with `{ addOns: [...] }` at the top level — unlike
         * `/bootstrap`, whose handler wraps its own payload. A stub that gets
         * this wrong makes the query resolve to `undefined`, which react-query
         * reports as "data is undefined" and the host renders as "the package
         * does not ship that file" — a true sentence about a false premise.
         */
        if (over.addOnsStatus !== undefined && over.addOnsStatus >= 400) {
          return Promise.resolve(
            jsonResponse(over.addOnsStatus, {
              error: { code: 'INTERNAL', message: 'nope', requestId: 'req_b' },
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, { addOns: over.addOns ?? [INSTALLED] }));
      }
      if (url.startsWith('/api/v1/me/notifications')) {
        return Promise.resolve(
          jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }),
        );
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }),
      );
    }),
  );
}

async function renderAt(path: string) {
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

let restoreI18n: () => void;
let restoreImporter: (() => void) | null = null;

beforeAll(() => {
  restoreI18n = installTestI18n();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  /*
   * happy-dom really tries to FETCH a `modulepreload` link, and there is no
   * server behind these URLs — the rejection lands outside any test as an
   * unhandled error, which vitest correctly refuses to ignore. Turning the
   * environment's own file loading off leaves the link (and its integrity
   * attribute, which is what is under test) exactly where it was put.
   */
  const dom = (window as unknown as { happyDOM?: { settings?: Record<string, unknown> } }).happyDOM;
  if (dom?.settings !== undefined) {
    dom.settings['disableJavaScriptFileLoading'] = true;
    dom.settings['disableCSSFileLoading'] = true;
  }
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  forgetAddOnModules();
});
afterEach(() => {
  restoreImporter?.();
  restoreImporter = null;
  vi.unstubAllGlobals();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  document.head.querySelectorAll('link[data-adminium-add-on]').forEach((link) => link.remove());
});

describe('mounting an add-on page', () => {
  it('renders the module the manifest points at', async () => {
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() =>
      Promise.resolve({ default: () => <p>Drawn by the add-on</p> }),
    );
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('Drawn by the add-on')).toBeDefined();
  });

  it('pins the integrity the server recorded before importing anything', async () => {
    // The hash cannot ride on `import()`, so it rides on a preload link the
    // browser checks first. Without this the bytes are still fetched — they are
    // just no longer the bytes anybody vouched for.
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() => Promise.resolve({ default: () => <p>ok</p> }));
    await renderAt('/add-ons/invoices/documents');
    await screen.findByText('ok');
    const link = document.head.querySelector('link[data-adminium-add-on]');
    expect(link?.getAttribute('href')).toBe(BUNDLE.url);
    expect(link?.getAttribute('integrity')).toBe(BUNDLE.integrity);
    expect(link?.getAttribute('rel')).toBe('modulepreload');
  });

  it('resolves the add-on root to its first page', async () => {
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() => Promise.resolve({ default: () => <p>root</p> }));
    await renderAt('/add-ons/invoices/');
    expect(await screen.findByText('root')).toBeDefined();
  });

  it('says the add-on is not installed rather than rendering nothing', async () => {
    stubFetch({ pages: [] });
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('This add-on is not installed')).toBeDefined();
  });

  it('says there is no such page when the ref is not one of its own', async () => {
    stubFetch();
    await renderAt('/add-ons/invoices/nonsense');
    expect(await screen.findByText('No such page')).toBeDefined();
  });

  it('says so when the package does not ship the file the manifest names', async () => {
    stubFetch({ addOns: [{ ...INSTALLED, bundles: [] }] });
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('This page could not be loaded')).toBeDefined();
    // Not offered a retry: fetching again cannot conjure a file the package
    // does not contain.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('blames the LIST, not the package, when the add-ons request fails', async () => {
    // Two different sentences for two different problems: one is worth
    // retrying, the other needs the add-on reinstalled. Conflating them is
    // what this test exists to stop, and it is exactly what happened once.
    stubFetch({ addOnsStatus: 500 });
    await renderAt('/add-ons/invoices/documents');
    expect(
      await screen.findByText(/list of installed add-ons could not be read/),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('reports a refused or broken module, and retries on request', async () => {
    stubFetch();
    let attempts = 0;
    restoreImporter = setAddOnModuleImporter(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('integrity check failed'))
        : Promise.resolve({ default: () => <p>second time lucky</p> });
    });
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('This page could not be loaded')).toBeDefined();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('second time lucky')).toBeDefined();
    expect(attempts).toBe(2);
  });

  it('refuses a module whose default export is not a component', async () => {
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() => Promise.resolve({ default: { nope: true } }));
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('This page could not be loaded')).toBeDefined();
  });

  it('keeps a crashing page off the shell', async () => {
    // The add-on's code is code this repository did not write. A throw in its
    // render must land in the boundary, not take the rail and topbar with it.
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() =>
      Promise.resolve({
        default: () => {
          throw new Error('the add-on exploded');
        },
      }),
    );
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('This page could not be loaded')).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeDefined();
  });
});
