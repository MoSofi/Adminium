// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/public-api` (28-T13).
 *
 * Router-mounted rather than bare, because three of the things worth proving
 * only exist through the router: the route is LAZY (it must be — the entry
 * chunk has ~1 KiB of headroom), it sits behind `StudioGuard`, and the page
 * publishes its heading through the PageActions channel, so a bare render has
 * no `<h1>` at all.
 *
 * The tests that matter here are the ones about what the page REFUSES to do:
 *
 *  1. `registered: false` renders a stated fact, never a toggle — the remedy is
 *     an env var and a restart, so a control could only look broken;
 *  2. a scope that will not compile shows every issue the server found, because
 *     the operator is the only person who can fix it;
 *  3. deleting a scope is a type-to-confirm door and fires nothing until passed;
 *  4. a revealed token is never written into the query cache.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { PublicKeyDto, PublicScopeDto } from './publicSurfaceApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const REVEALED = 'adm_pub_ZZZZZZZZ1111111111111111111111111111111111';

function makeScope(over: Partial<PublicScopeDto> = {}): PublicScopeDto {
  return {
    id: 'psc_1',
    connectionId: 'conn_1',
    side: 'customer',
    name: 'storefront',
    timezone: 'Europe/London',
    document: '{"version":1}',
    proposedFromManifest: null,
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
    keyCount: 1,
    ...over,
  };
}

function makeKey(over: Partial<PublicKeyDto> = {}): PublicKeyDto {
  return {
    id: 'pbk_1',
    name: 'shop web',
    prefix: 'adm_pub_4f2a91cd',
    scopeId: 'psc_1',
    side: 'customer',
    origins: [],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

interface StubOptions {
  /** Roles the signed-in principal holds — StudioGuard needs admin or above. */
  roleSlugs?: string[];
  registered?: boolean;
  enabled?: boolean;
  scopes?: PublicScopeDto[];
  keys?: PublicKeyDto[];
  /** Make POST /public-scopes fail the way an uncompilable document does. */
  scopeIssues?: boolean;
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) as unknown }),
    });

    // The router boots from this before any route renders; without it every
    // test lands on the 404 page instead of the surface under test.
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: makeBootstrap({ nav: { groups: [] }, roles: options.roleSlugs ?? ['super-admin'] }),
        }),
      );
    }
    if (url === '/api/v1/public-api') {
      return Promise.resolve(
        jsonResponse(200, {
          enabled: options.enabled ?? true,
          registered: options.registered ?? true,
          origins: ['https://shop.example.com'],
        }),
      );
    }
    if (url === '/api/v1/public-scopes' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { scopes: options.scopes ?? [makeScope()] }));
    }
    if (url === '/api/v1/public-scopes' && method === 'POST') {
      if (options.scopeIssues === true) {
        return Promise.resolve(
          jsonResponse(422, {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'The scope document did not compile.',
              requestId: 'req_a',
              details: {
                issues: [
                  {
                    code: 'SCOPE_TIMEZONE_INVALID',
                    message: '"BST" is not a canonical IANA time zone.',
                  },
                  {
                    code: 'SCOPE_EXPOSE_UNKNOWN_COLUMN',
                    message: '"margin" is not a column of public.menu_items',
                    ref: 'menu',
                    column: 'margin',
                  },
                ],
              },
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse(201, { scopes: [makeScope()] }));
    }
    if (url.startsWith('/api/v1/public-scopes/') && method === 'DELETE') {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    if (url === '/api/v1/public-keys' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { keys: options.keys ?? [makeKey()] }));
    }
    if (url.endsWith('/reveal')) {
      return Promise.resolve(jsonResponse(200, { token: REVEALED }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

async function renderPage(options: StubOptions = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(options);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/public-api'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, queryClient };
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
});

describe('PublicApiPage', () => {
  it('resolves the lazy route and renders the scopes and keys it was given', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Scopes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Keys' })).toBeTruthy();
    // `storefront` appears twice on purpose — once in the scope list and once
    // as an <option> in the key form's picker — so scope the query.
    expect(screen.getAllByText('storefront').length).toBeGreaterThan(0);
    expect(screen.getByText(/adm_pub_4f2a91cd/)).toBeTruthy();
  });

  it('states the env-var fact instead of rendering a toggle when the server never opted in', async () => {
    // Level 1 needs a restart. A switch here could only ever look broken.
    await renderPage({ registered: false });
    expect(await screen.findByText(/Not enabled on this server/)).toBeTruthy();
    expect(screen.getByText(/ADMINIUM_PUBLIC_API_ORIGINS/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('offers the toggle when the instance IS opted in, reflecting the current state', async () => {
    await renderPage({ registered: true, enabled: false });
    const toggle = await screen.findByRole('switch');
    expect(toggle.getAttribute('data-state')).toBe('unchecked');
  });

  it('sends the toggle as a PUT and does not touch anything else', async () => {
    const { calls } = await renderPage({ enabled: false });
    await userEvent.click(await screen.findByRole('switch'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/public-api')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: true });
  });

  it('shows EVERY compile issue the server returned', async () => {
    // The operator wrote the document and is the only person who can fix it.
    // The anonymous surface still says nothing at all — that asymmetry is §3.2.
    await renderPage({ scopeIssues: true });
    await screen.findByRole('heading', { name: 'Scopes' });
    // Both cards have a "Name" field; the forms carry accessible names so a
    // reader — and this test — can tell them apart.
    const form = screen.getByRole('form', { name: 'Create a scope' });
    await userEvent.type(within(form).getByLabelText(/^Name/), 'broken');
    await userEvent.type(within(form).getByLabelText(/Connection ID/), 'conn_1');
    await userEvent.click(within(form).getByRole('button', { name: 'Create scope' }));

    expect(await screen.findByText('SCOPE_TIMEZONE_INVALID')).toBeTruthy();
    expect(screen.getByText('SCOPE_EXPOSE_UNKNOWN_COLUMN')).toBeTruthy();
    expect(screen.getByText(/is not a canonical IANA time zone/)).toBeTruthy();
  });

  it('does not delete a scope until the type-to-confirm door is passed', async () => {
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Scopes' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The modal is open and nothing has been sent.
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    const confirm = screen.getByRole('button', { name: 'Delete scope' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await userEvent.type(screen.getByRole('textbox', { name: /Type the scope name/ }), 'storefront');
    await userEvent.click(screen.getByRole('button', { name: 'Delete scope' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('psc_1'))).toBe(true);
    });
  });

  it('reveals a token on demand and never writes it into the query cache', async () => {
    const { queryClient } = await renderPage();
    await screen.findByRole('heading', { name: 'Keys' });
    await userEvent.click(screen.getByRole('button', { name: 'Show key' }));

    expect(await screen.findByTestId('revealed-token')).toBeTruthy();
    expect(screen.getByTestId('revealed-token').textContent).toBe(REVEALED);

    // A cached secret outlives its render and rides along with every devtools
    // dump and every cache serialisation. It lives in component state instead.
    const dumped = JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data));
    expect(dumped).not.toContain(REVEALED);
  });

  it('never lists a full token — only the display prefix', async () => {
    await renderPage();
    await screen.findByRole('heading', { name: 'Keys' });
    expect(document.body.textContent).not.toContain(REVEALED);
  });
});
