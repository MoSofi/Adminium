// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's own section of the rail: its generated pages and the pages of
 * its code in the order the server gave, each opening where it lives — and
 * no page drawn twice. Rendered through the real shell, because what is under
 * test is placement.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AddOnNav, BootstrapData } from '../app/bootstrap.js';
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

/*
 * `Invoice documents`, not `Invoices`: the ENGINE still ships an `/invoices`
 * platform row with that exact label until 51d moves it out, and a fixture that
 * reuses it makes every `findByRole` ambiguous. When 51d lands, this name is
 * free again — and a test that starts failing here is telling the truth about
 * two rows called the same thing.
 */
const invoicesPage = {
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

async function renderRail(addOnNav: AddOnNav, over: Partial<BootstrapData> = {}) {
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
          jsonResponse(200, { data: makeBootstrap({ addOnNav, ...over }) }),
        );
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
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/connect'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: 'Primary' });
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
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

const item = (over: Record<string, unknown>) => ({ pageId: 'p', slug: '', labelKey: 'x', fallback: 'x', icon: 'box', order: 1, connectionId: null, connectionName: null, currency: null, sourceTable: null, appKey: null, addOnKey: 'kit', ...over });
const SECTION = {
  kind: 'add-on' as const,
  appKey: 'kit',
  label: 'Stock kit',
  version: '1.2.0',
  staff: null,
  groups: [
    { key: '', label: null, items: [item({ pageId: 'page_1', slug: 'kit-overview', labelKey: 'nav.kit-overview', fallback: 'Overview' })] },
    {
      key: 'kit-stock',
      label: 'Stock',
      items: [
        item({ pageId: 'page_2', slug: 'kit-items', labelKey: 'nav.kit-items', fallback: 'Items', order: 10 }),
        item({ pageId: 'kit-count', labelKey: 'kit.count', fallback: 'Count', order: 15, addOnPage: { key: 'kit', ref: 'kit-count' } }),
      ],
    },
  ],
};
const page = (over: Record<string, unknown>) => ({ ...invoicesPage, addOnKey: 'kit', detail: false, inSection: false, unlisted: false, ...over });
const NAV: AddOnNav = {
  // The group of its code is listed here too, as a server might: the rail itself must not draw the section's page under it.
  groups: [{ key: 'kit-stock', labelKey: 'kit.group', fallback: 'Stock (code)', order: 5, addOnKey: 'kit' }],
  pages: [
    page({ ref: 'kit-transfer', labelKey: 'kit.transfer', fallback: 'Transfer', unlisted: true, order: 0 }),
    page({ ref: 'kit-count', labelKey: 'kit.count', fallback: 'Count', group: 'kit-stock', inSection: true, order: 15 }),
    page({ ref: 'kit-report', labelKey: 'kit.report', fallback: 'Stock report', order: 30 }),
  ],
};

describe('an add-on\'s section of the rail', () => {
  it('draws its generated pages and its code pages in order, each linking where it lives', async () => {
    await renderRail(NAV, { appSections: [SECTION] });
    const section = document.querySelector<HTMLElement>('[data-part="nav-app-section"]')!;
    expect(within(section).getByText('Stock kit')).toBeTruthy();
    expect(within(section).getByText('1.2.0')).toBeTruthy();
    const links = within(section).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Overview', '/p/kit-overview'],
      ['Items', '/p/kit-items'],
      // A page of its code opens at the add-on's own route, not by a slug.
      ['Count', '/add-ons/kit/kit-count'],
    ]);
  });

  it('a page in its section is not drawn a second time, and a page with no place in the rail is drawn nowhere', async () => {
    await renderRail(NAV, { appSections: [SECTION] });
    expect(screen.getAllByRole('link', { name: 'Count' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Transfer' })).toBeNull();
    // …and a heading with nothing under it is not drawn either.
    expect(screen.queryByText('Stock (code)')).toBeNull();
    // Its page in a built-in group stays in the shared rail, outside the section.
    const report = screen.getByRole('link', { name: 'Stock report' });
    expect(report.closest('[data-part="nav-app-section"]')).toBeNull();
    expect(report.getAttribute('href')).toBe('/add-ons/kit/kit-report');
  });
});
