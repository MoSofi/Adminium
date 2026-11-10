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
import { useEffect, useState } from 'react';
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

/** Each request the page made to its add-on's own routes, with the install it named. */
const asked: { url: string; install: string | null }[] = [];

function stubFetch(over: { addOns?: unknown[]; pages?: unknown[]; addOnsStatus?: number } = {}) {
  asked.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/v1/add-ons/invoices/kit')) {
        asked.push({ url, install: new Headers(init?.headers).get('x-adminium-install') });
        return Promise.resolve(jsonResponse(200, { tables: {} }));
      }
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
  return render(
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

  it('names the page in the top bar and the browser tab, not "Home"', async () => {
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() => Promise.resolve({ default: () => <p>Drawn by the add-on</p> }));
    await renderAt('/add-ons/invoices/documents');
    await screen.findByText('Drawn by the add-on');
    expect(await screen.findByRole('heading', { level: 1, name: 'Invoice documents' })).toBeDefined();
    expect(document.title).toContain('Invoice documents');
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

  it('loads a page kept behind its own permission from that page\'s own address, never from a file\'s shared one', async () => {
    // The same file is also a slot fill's: the list names it twice, and only the entry with the page's ref is the page's.
    const own = { path: BUNDLE.path, url: '/api/v1/add-ons/invoices/pages/documents/bundle', integrity: 'sha256-cGFnZQ==', ref: 'documents' };
    const other = { ...own, url: '/api/v1/add-ons/invoices/pages/other/bundle', ref: 'other' };
    stubFetch({ addOns: [{ ...INSTALLED, bundles: [BUNDLE, other, own] }] });
    restoreImporter = setAddOnModuleImporter(() => Promise.resolve({ default: () => <p>ok</p> }));
    await renderAt('/add-ons/invoices/documents');
    await screen.findByText('ok');
    const link = document.head.querySelector('link[data-adminium-add-on]');
    expect(link?.getAttribute('href')).toBe(own.url);
    expect(link?.getAttribute('integrity')).toBe(own.integrity);
  });

  it('never takes another page\'s address for a file two pages share', async () => {
    const other = { path: BUNDLE.path, url: '/api/v1/add-ons/invoices/pages/other/bundle', integrity: 'sha256-cGFnZQ==', ref: 'other' };
    stubFetch({ addOns: [{ ...INSTALLED, bundles: [other] }] });
    await renderAt('/add-ons/invoices/documents');
    // No address is this page's: it says the package does not ship it, and loads nothing.
    await screen.findByRole('heading');
    expect(document.head.querySelector(`link[href="${other.url}"]`)).toBeNull();
  });

  it('resolves the add-on root to its first page', async () => {
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() => Promise.resolve({ default: () => <p>root</p> }));
    await renderAt('/add-ons/invoices/');
    expect(await screen.findByText('root')).toBeDefined();
  });

  it('opens every staff link the engine sends for a forms add-on on its one page, whose ref is its key', async () => {
    // The links the server builds (`formsStaffLink`; `forms-door-hookups.test.ts` holds it to these): the page ref an add-on may always use, then the page's own path.
    const forms = { ...PAGE, addOnKey: 'forms', ref: 'forms', labelKey: 'addon.forms.nav', fallback: 'Forms', client: 'dist/pages/forms.js' };
    const bundle = { path: 'dist/pages/forms.js', url: '/api/v1/add-ons/forms/bundle/dist/pages/forms.js', integrity: 'sha256-Zm9ybXM=' };
    for (const link of ['/add-ons/forms/forms/showroom-visit/answers?answer=ans_1', '/add-ons/forms/forms/surveys/fit-out/results?answer=ans_2', '/add-ons/forms/forms/capped?settings=limits']) {
      stubFetch({ pages: [forms], addOns: [{ ...INSTALLED, key: 'forms', name: 'Forms', bundles: [bundle] }] });
      restoreImporter = setAddOnModuleImporter(() => Promise.resolve({ default: () => <p>the forms page</p> }));
      const { unmount } = await renderAt(link);
      expect(await screen.findByText('the forms page'), link).toBeDefined();
      expect(screen.queryByText('No such page')).toBeNull();
      unmount();
      restoreImporter();
      forgetAddOnModules();
      vi.unstubAllGlobals();
      vi.stubGlobal('WebSocket', FakeWebSocket);
    }
    restoreImporter = null;
  });

  it('opens each copy of an add-on kept on two databases at its own address, every call naming that copy', async () => {
    const copies = [
      { ...PAGE, address: 'invoices', installId: 'mft_birch', connectionId: 'conn_a', connectionName: 'Birch Row' },
      { ...PAGE, address: 'invoices~print', installId: 'mft_print', connectionId: 'conn_b', connectionName: 'Marlow Press' },
    ];
    const { api } = await import('../app/api.js');
    for (const [path, install] of [
      ['/add-ons/invoices~print/documents', 'mft_print'],
      ['/add-ons/invoices/documents', 'mft_birch'],
    ] as const) {
      stubFetch({ pages: copies });
      restoreImporter = setAddOnModuleImporter(() =>
        Promise.resolve({
          default: function Page() {
            const [done, setDone] = useState(false);
            useEffect(() => {
              void api.get('/api/v1/add-ons/invoices/kit').then(() => setDone(true));
            }, []);
            return <p>{done ? 'kit read' : 'reading'}</p>;
          },
        }),
      );
      const { unmount } = await renderAt(path);
      expect(await screen.findByText('kit read')).toBeDefined();
      expect(asked.map((one) => one.install)).toEqual([install]);
      unmount();
      restoreImporter();
      restoreImporter = null;
      forgetAddOnModules();
    }
  });

  it("lists the copies the reader has at an address of none of theirs, and opens none of them", async () => {
    stubFetch({ pages: [{ ...PAGE, address: 'invoices~print', installId: 'mft_print', connectionId: 'conn_b', connectionName: 'Marlow Press' }] });
    let imported = 0;
    restoreImporter = setAddOnModuleImporter(() => {
      imported += 1;
      return Promise.resolve({ default: () => <p>never drawn</p> });
    });
    await renderAt('/add-ons/invoices/documents');
    const retired = await screen.findByTestId('retired-address');
    expect(retired.querySelector('a')?.getAttribute('href')).toBe('/add-ons/invoices~print/documents');
    expect(retired.textContent).toContain('Marlow Press');
    expect(imported).toBe(0);
  });

  it('says what the server refused when a request of the page is refused, and blames no fingerprint', async () => {
    stubFetch();
    const { ApiError } = await import('../app/api.js');
    restoreImporter = setAddOnModuleImporter(() =>
      Promise.resolve({
        default: function Page(): never {
          throw new ApiError(409, 'APP_INSTALL_AMBIGUOUS', 'invoices is installed on 2 databases. Say which one.', 'req_c');
        },
      }),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText(/the server refused something it asked for: invoices is installed on 2 databases/)).toBeDefined();
    expect(screen.queryByText(/fingerprint/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    spy.mockRestore();
  });

  it('says the page stopped, with its error, when its own code breaks', async () => {
    stubFetch();
    restoreImporter = setAddOnModuleImporter(() =>
      Promise.resolve({
        default: function Page(): never {
          throw new Error('cannot read the base');
        },
      }),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText(/stopped with an error: cannot read the base/)).toBeDefined();
    expect(screen.queryByText(/fingerprint/)).toBeNull();
    spy.mockRestore();
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

  it('a page built for a newer Adminium is told so — it is not fetched, and a retry is not offered', async () => {
    stubFetch({ addOns: [{ ...INSTALLED, hostApi: 3 }] });
    let fetched = 0;
    restoreImporter = setAddOnModuleImporter(() => {
      fetched += 1;
      return Promise.resolve({ default: () => <p>never drawn</p> });
    });
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('This page needs a newer Adminium')).toBeDefined();
    expect(fetched).toBe(0);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('This page could not be loaded')).toBeNull();
  });

  it('a page whose own code says the host is too old shows the same words, not a broken file', async () => {
    stubFetch({ addOns: [{ ...INSTALLED, hostApi: 2 }] });
    const { AddOnHostTooOld } = await import('@adminium/add-on-contracts/runtime');
    // What the kit's shim throws as it loads on a host whose kit is older than the page's.
    restoreImporter = setAddOnModuleImporter(() => Promise.reject(new AddOnHostTooOld(2, 1)));
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('This page needs a newer Adminium')).toBeDefined();
  });

  it('a page that needs the data kit is given it, and is told whose page it is', async () => {
    stubFetch({ addOns: [{ ...INSTALLED, hostApi: 2 }] });
    const { requireAddOnHost, DATA_KIT_VERSION, ADD_ON_DATA_EXPORTS } = await import('@adminium/add-on-contracts/runtime');
    const { useAddOnKey } = await import('./data-kit/context.js');
    let kitAtImport: unknown = 'not asked';
    restoreImporter = setAddOnModuleImporter(() => {
      // The kit is on the host BEFORE the page's module runs: its shim reads it as it loads.
      kitAtImport = requireAddOnHost().data;
      return Promise.resolve({ default: function Page() { return <p>page of {useAddOnKey()}</p>; } });
    });
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('page of invoices')).toBeDefined();
    const kit = kitAtImport as Record<string, unknown>;
    expect(kit['version']).toBe(DATA_KIT_VERSION);
    expect(Object.keys(kit).filter((name) => name !== 'version').sort()).toEqual([...ADD_ON_DATA_EXPORTS].sort());
    // The host's own version did not move for it.
    expect(requireAddOnHost().version).toBe(1);
  });

  it('a page built before the kit never loads it', async () => {
    const { resetAddOnRuntime } = await import('./runtime.js');
    const { requireAddOnHost } = await import('@adminium/add-on-contracts/runtime');
    resetAddOnRuntime();
    stubFetch();
    let kitAtImport: unknown = 'not asked';
    restoreImporter = setAddOnModuleImporter(() => {
      kitAtImport = requireAddOnHost().data;
      return Promise.resolve({ default: () => <p>an older page</p> });
    });
    await renderAt('/add-ons/invoices/documents');
    expect(await screen.findByText('an older page')).toBeDefined();
    expect(kitAtImport).toBeUndefined();
    expect(requireAddOnHost().data).toBeUndefined();
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
