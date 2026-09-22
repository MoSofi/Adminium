// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rail offers a platform surface only to a session holding the `system:`
 * key that surface's routes check.
 *
 * The rail used to ask one question — "is this an Admin?" — and the built-in
 * Admin holds `users.manage` and `audit.read` but NOT `roles.manage`,
 * `api-keys.manage` or `automations.manage`, so it was shown four rows that
 * opened onto a 403. Rendered through the real shell for the same reason the
 * add-on rail test is: what matters is which rows exist, not a list component.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootstrapData } from '../app/bootstrap.js';
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
async function renderRail(over: Partial<BootstrapData>, path = '/account/security') {
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
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap(over) }));
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
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: 'Primary' });
}

function railLinks(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  return [...nav.querySelectorAll('a')].map((link) => link.textContent ?? '');
}

/** What the built-in Admin role is seeded with. */
const ADMIN_KEYS = [
  'users.manage',
  'audit.read',
  'connections.manage',
  'schema.remap',
  'llm.run',
  'project.read',
  'assistant.use',
];

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

describe('platform rail rows follow the session\'s system keys', () => {
  it('shows the built-in Admin only the surfaces its keys open', async () => {
    await renderRail({ roles: ['admin'], systemActions: ADMIN_KEYS });
    const links = railLinks();
    expect(links).toContain('Team');
    expect(links).toContain('Audit log');
    for (const refused of ['Roles & permissions', 'Automations', 'Workflow logs']) {
      expect(links, refused).not.toContain(refused);
    }
  });

  it('shows a custom role exactly what it was granted, whatever its slug', async () => {
    await renderRail({ roles: ['support-lead'], systemActions: ['roles.manage', 'automations.manage'] });
    const links = railLinks();
    expect(links).toContain('Roles & permissions');
    expect(links).toContain('Automations');
    expect(links).toContain('Workflow logs');
    expect(links).not.toContain('Team');
  });

  it('shows a Super Admin every row', async () => {
    await renderRail({ roles: ['super-admin'] });
    const links = railLinks();
    for (const row of ['Team', 'Roles & permissions', 'Audit log', 'Automations', 'Workflow logs']) {
      expect(links, row).toContain(row);
    }
  });

  it('tells a role with no shared pages so, rather than to connect a database', async () => {
    await renderRail({ roles: ['admin'], systemActions: ADMIN_KEYS, nav: { groups: [] }, pagesWithheld: true });
    const empty = document.querySelector('[data-part="nav-empty"]');
    expect(empty?.textContent).toBe(
      'No pages have been shared with your role yet. Ask an administrator for access.',
    );
  });

  it('keeps the connect prompt when there are genuinely no pages', async () => {
    await renderRail({ roles: ['admin'], systemActions: ADMIN_KEYS, nav: { groups: [] }, pagesWithheld: false });
    const empty = document.querySelector('[data-part="nav-empty"]');
    expect(empty?.textContent).toBe('Pages appear here once a database is connected.');
  });

  it('answers a typed URL the rail no longer offers with the forbidden state', async () => {
    await renderRail({ roles: ['admin'], systemActions: ADMIN_KEYS }, '/settings/roles');
    expect(await screen.findByText('You don’t have access')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Roles & permissions' })).toBeNull();
  });
});
