// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The internal placement, host side.
 *
 * Three things are worth testing here and one is not. The bridge's WIRE
 * behaviour is proven at the child end (`embed.test.ts` in each app repo,
 * synced); what only this end can prove is that the SHELL renders the sections,
 * that `/a/` resolves the way D5 says it does, and that a bare app key stays a
 * 404 — acceptance criterion 7, which is a decision rather than an accident and
 * therefore has to be pinned rather than assumed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { activeHostedItem, type HostedApp } from '../app/bootstrap.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';

const OUTLINE: HostedApp = {
  appKey: 'clients',
  label: 'Outline',
  items: [
    { id: 'home', path: 'home', label: 'Home', icon: 'house' },
    { id: 'invoices', path: 'invoices', label: 'Invoices', icon: 'receipt' },
    { id: 'archive', path: 'archive', label: 'Archive', icon: 'archive' },
  ],
};

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

async function renderAt(
  path: string,
  hostedApps: HostedApp[] = [OUTLINE],
  // A URL outside `appRoute` renders the ROOT `notFoundComponent`, which is
  // deliberately shell-less — there is no sidebar to wait for, and waiting for
  // one would time out on the very case being asserted.
  opts: { shell?: boolean; bootstrap?: Record<string, unknown> } = {},
) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, { data: makeBootstrap({ hostedApps, ...(opts.bootstrap ?? {}) }) }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
    }),
  );
  const queryClient: QueryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  if (opts.shell !== false) await screen.findByRole('navigation', { name: 'Primary' });
}

describe('activeHostedItem — longest match', () => {
  it('picks the deepest item, and null for a screen the app does not list', () => {
    expect(activeHostedItem(OUTLINE, 'invoices')?.id).toBe('invoices');
    // A detail screen still renders; it just highlights its section.
    expect(activeHostedItem(OUTLINE, 'invoices/INV-204')?.id).toBe('invoices');
    expect(activeHostedItem(OUTLINE, 'somewhere-else')).toBeNull();
  });

  it('does not let a root item (path "") match everything', () => {
    /*
     * The reason this is not `Link`'s default prefix matching. A surface whose
     * only screen is its root has `path: ''`, and `''` is a prefix of every
     * string — so prefix matching would light up every row in the rail.
     */
    const portal: HostedApp = {
      appKey: 'shop',
      label: 'Shop',
      items: [{ id: 'entry', path: '', label: 'Portal' }],
    };
    expect(activeHostedItem(portal, '')?.id).toBe('entry');
    expect(activeHostedItem(portal, 'track')).toBeNull();
  });
});

/**
 * The hosted section's OWN rows. The platform rail carries an `Invoices` row of
 * its own (`/invoices`), so a document-wide `getByRole('link', { name:
 * 'Invoices' })` finds two — and D7's claim is about the app's section, not the
 * rail around it.
 */
function hostedLink(name: string): HTMLElement {
  const section = document.querySelector('[data-part="nav-hosted-app"]');
  if (section === null) throw new Error('no hosted section rendered');
  return within(section as HTMLElement).getByRole('link', { name });
}

describe('the sidebar section (D7)', () => {
  it('renders the app as its own labelled section with its own rows', async () => {
    await renderAt('/a/clients/home');
    expect(screen.getByText('Outline')).toBeTruthy();
    for (const label of ['Home', 'Invoices', 'Archive']) {
      expect(hostedLink(label)).toBeTruthy();
    }
  });

  it('marks only the active row active', async () => {
    await renderAt('/a/clients/invoices');
    expect(hostedLink('Invoices').getAttribute('data-status')).toBe('active');
    expect(hostedLink('Home').getAttribute('data-status')).toBeNull();
  });

  it('keeps the highlight on the section when the app is on an unlisted screen', async () => {
    // The app navigated to an invoice detail. The rail must not go blank.
    await renderAt('/a/clients/invoices/INV-204');
    expect(hostedLink('Invoices').getAttribute('data-status')).toBe('active');
  });

  it('renders no section at all when no app is blended', async () => {
    await renderAt('/a/clients/home', []);
    expect(screen.queryByText('Outline')).toBeNull();
  });

  it('leaves the five fixed groups untouched', async () => {
    // `NAV_GROUP_KEYS` is a closed set; an app section is a PARALLEL thing, not
    // a sixth group, and the generated pages must still be there beside it.
    await renderAt('/a/clients/home');
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeTruthy();
  });
});

describe('an installed app’s own section', () => {
  const MENU = { pageId: 'page_menu', slug: 'pos-menu', labelKey: 'nav.pos-menu', fallback: 'Menu', icon: 'book-open', order: 1, appKey: 'clients' };
  const OVERVIEW = { ...MENU, pageId: 'page_overview', slug: 'pos-overview', fallback: 'Overview', icon: 'layout-dashboard', order: 0 };
  const section = (staff: unknown) => ({
    appSections: [
      {
        appKey: 'clients',
        label: 'Outline',
        version: '0.2.0',
        groups: [
          { key: '', label: null, items: [OVERVIEW] },
          { key: 'manage', label: 'Manage', items: [MENU] },
        ],
        staff,
      },
    ],
  });

  it('draws the app’s name and version, its ungrouped pages, then its own groups', async () => {
    await renderAt('/a/clients/home', [OUTLINE], { bootstrap: section({ placement: 'internal', items: OUTLINE.items }) });
    const rail = screen.getByRole('navigation', { name: 'Primary' });
    const part = rail.querySelector('[data-part="nav-app-section"]') as HTMLElement;
    expect(within(part).getByText('Outline')).toBeTruthy();
    expect(within(part).getByText('0.2.0')).toBeTruthy();
    expect(within(part).getByText('Manage')).toBeTruthy();
    const links = within(part).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(['Overview', 'Menu', 'Home', 'Invoices', 'Archive']);
    // Its staff screens are in the section, so the hosted section is not drawn twice.
    expect(rail.querySelector('[data-part="nav-hosted-app"]')).toBeNull();
  });

  it('links out to staff screens that open on their own address', async () => {
    await renderAt('/p/pos-menu', [], { bootstrap: section({ placement: 'external', url: 'https://till.example.test/' }) });
    const open = await screen.findByRole('link', { name: 'Open the staff screens' });
    expect(open.getAttribute('href')).toBe('https://till.example.test/');
    expect(open.getAttribute('target')).toBe('_blank');
  });
});

describe('the /a/ route (D5)', () => {
  it('frames the surface, titled by the active nav item', async () => {
    await renderAt('/a/clients/invoices');
    const frame = await screen.findByTitle('Invoices');
    expect(frame.getAttribute('src')).toBe('/apps/clients/staff/invoices');
    // No `sandbox`: the content is first-party code at this same origin, and
    // the minimum this needs is equivalent to none while reading as protection.
    expect(frame.hasAttribute('sandbox')).toBe(false);
  });

  it('serves the app root for the bare /a/<key> form', async () => {
    /*
     * Two routes, one screen: TanStack's splat does not match an empty
     * remainder, so `/a/clients` alone would 404 without the redirect.
     *
     * The frame is titled with the APP's name here, not a nav item's: this
     * app's staff nav has no entry at the root, so there is no active item to
     * name. That fallback is what stops a frame from being an untitled region
     * for a screen reader.
     */
    await renderAt('/a/clients');
    const frame = await screen.findByTitle('Outline');
    expect(frame.getAttribute('src')).toBe('/apps/clients/staff/');
  });

  it('404s an unknown app key rather than framing nothing', async () => {
    await renderAt('/a/nope/home');
    await screen.findByRole('heading', { name: /went missing/i });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('404s a BARE app key at the root — acceptance criterion 7', async () => {
    /*
     * The D5 deviation, pinned rather than assumed. `/clients/home` must never
     * resolve: the dashboard owns ~22 top-level segments and grows, the
     * installer will accept arbitrary third-party keys, and the failure mode of
     * a collision is silent shadowing years later. If someone later "improves"
     * the URLs to bare keys, this is what tells them the policy went with it.
     */
    await renderAt('/clients/home', [OUTLINE], { shell: false });
    await screen.findByRole('heading', { name: /went missing/i });
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('an installed app the dashboard does not show', () => {
  const OFF = (reason: 'app-disabled' | 'side-off' | 'external', href?: string) => ({
    unavailableApps: [{ appKey: 'pos', label: 'Point of Sale', reason, ...(href === undefined ? {} : { href }) }],
  });

  it('says a switched-off app is switched off, not that it went missing', async () => {
    await renderAt('/a/pos/home', [], { bootstrap: OFF('app-disabled') });
    await screen.findByRole('heading', { name: 'This app is switched off' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('says so for its staff screens alone, and for an instance of it', async () => {
    await renderAt('/a/pos~north/home', [], { bootstrap: OFF('side-off') });
    await screen.findByRole('heading', { name: 'These screens are switched off' });
  });

  it('points at an app placed on its own address', async () => {
    await renderAt('/a/pos/home', [], { bootstrap: OFF('external', '/apps/pos/staff/') });
    await screen.findByRole('heading', { name: 'This app opens on its own' });
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe('/apps/pos/staff/');
  });

  it('answers a bookmarked page of a switched-off app with the same state', async () => {
    await renderAt('/p/pos-menu', [], {
      bootstrap: {
        disabledAppPages: [
          { pageId: 'page_menu', slug: 'pos-menu', labelKey: 'nav.pos-menu', fallback: 'Menu', icon: 'list', order: 1, connectionId: null, sourceTable: null },
        ],
      },
    });
    await screen.findByRole('heading', { name: 'This app is switched off' });
  });
});

