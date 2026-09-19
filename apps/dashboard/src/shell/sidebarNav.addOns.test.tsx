// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rail rows an add-on contributes (51b).
 *
 * Rendered through the real shell, like `branding.test.tsx`, because what is
 * under test is placement: which heading a row lands under, whether a heading
 * appears at all, and what a viewer without the admin grant sees. A shallow
 * render of the list component would assert none of that.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
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

/** The heading text above a row, walking up to the group wrapper. */
function groupHeadingOf(link: Element): string | null {
  const wrapper = link.closest('div.mb-1');
  return wrapper?.firstElementChild?.textContent ?? null;
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

describe('add-on rail rows', () => {
  it('draws nothing extra when no add-on declares a page', async () => {
    await renderRail({ groups: [], pages: [] });
    expect(document.querySelector('[data-part="nav-add-on-pages"]')).toBeNull();
    expect(document.querySelector('[data-part="nav-add-on-group"]')).toBeNull();
  });

  it('puts a page in the built-in group it asked for, linking under /add-ons', async () => {
    await renderRail({ groups: [], pages: [invoicesPage] });
    const link = await screen.findByRole('link', { name: 'Invoice documents' });
    expect(link.getAttribute('href')).toBe('/add-ons/invoices/documents');
    expect(groupHeadingOf(link)).toBe('Library');
  });

  it('draws a heading for a built-in group that has nothing else in it', async () => {
    // `planning` has no generated pages and no platform links on a stock
    // instance, so without its own branch the row would have nowhere to hang
    // and would silently not exist.
    await renderRail({
      groups: [],
      pages: [{ ...invoicesPage, group: 'planning' }],
    });
    const link = await screen.findByRole('link', { name: 'Invoice documents' });
    expect(groupHeadingOf(link)).toBe('Planning');
  });

  it('draws a group the add-on brought, with the label it brought', async () => {
    await renderRail({
      groups: [
        {
          key: 'documents',
          labelKey: 'addon.invoices.group',
          fallback: 'Documents',
          order: 10,
          addOnKey: 'invoices',
        },
      ],
      pages: [{ ...invoicesPage, group: 'documents' }],
    });
    const link = await screen.findByRole('link', { name: 'Invoice documents' });
    expect(groupHeadingOf(link)).toBe('Documents');
  });

  it('groups several pages of one add-on under one heading', async () => {
    await renderRail({
      groups: [
        {
          key: 'documents',
          labelKey: 'addon.invoices.group',
          fallback: 'Documents',
          order: 10,
          addOnKey: 'invoices',
        },
      ],
      pages: [
        { ...invoicesPage, group: 'documents' },
        { ...invoicesPage, ref: 'templates', labelKey: 'addon.invoices.templates', fallback: 'Templates', group: 'documents', order: 21 },
      ],
    });
    const rows = document.querySelectorAll('[data-part="nav-add-on-group"] a');
    expect([...rows].map((row) => row.textContent)).toEqual(['Invoice documents', 'Templates']);
  });

  it('hides an adminOnly row from a viewer who is not an admin', async () => {
    await renderRail({ groups: [], pages: [{ ...invoicesPage, adminOnly: true }] }, { roles: ['viewer'] });
    expect(screen.queryByRole('link', { name: 'Invoice documents' })).toBeNull();
  });

  it('draws NO heading when every row in a declared group is hidden from this viewer', async () => {
    // The empty heading is the failure this guards: the group's only page is
    // admin-only, so a viewer must see neither the row nor a stray label. This
    // is the case the server cannot filter, because it is the rail that knows
    // who is looking.
    await renderRail(
      {
        groups: [
          {
            key: 'documents',
            labelKey: 'addon.invoices.group',
            fallback: 'Documents',
            order: 10,
            addOnKey: 'invoices',
          },
        ],
        pages: [{ ...invoicesPage, group: 'documents', adminOnly: true }],
      },
      { roles: ['viewer'] },
    );
    expect(screen.queryByText('Documents')).toBeNull();
    expect(document.querySelector('[data-part="nav-add-on-group"]')).toBeNull();
  });
});
