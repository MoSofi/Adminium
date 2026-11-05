// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The settings of an add-on a reader keeps through the per-add-on grant
 * (`addOn:<key>:settings`, an app's role carries it), without managing
 * add-ons: one rail row each, in Library, opening that add-on's own settings
 * screen. None when the bootstrap names none. Rendered through the real
 * shell, because what is under test is placement.
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

describe('the settings an app role keeps of an add-on', () => {
  it('are one row each in Library, opening the add-on\'s settings screen', async () => {
    await renderRail({ groups: [], pages: [] }, { addOnSettings: [{ key: 'holiday-calendars', name: 'Holiday Calendars' }] });
    const rows = document.querySelector<HTMLElement>('[data-part="nav-add-on-settings"]')!;
    const links = within(rows).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['Holiday Calendars settings', '/add-on-settings/holiday-calendars']]);
  });

  it('are not drawn when the bootstrap names none', async () => {
    await renderRail({ groups: [], pages: [] });
    expect(document.querySelector('[data-part="nav-add-on-settings"]')).toBeNull();
  });
});
