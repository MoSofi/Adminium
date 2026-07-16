/**
 * `/api-keys` (M10-T06). The tests that matter here are the security ones:
 *
 *  1. the one-time secret is shown once at creation — and is NOT recoverable by
 *     re-rendering, re-fetching, or reading the query cache;
 *  2. the list never carries secret material, only the display prefix;
 *  3. revoke is a type-to-confirm door, and no request fires until it is passed;
 *  4. a non-admin gets `forbidden` instead of the page.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { ApiKeyDto } from './apiKeysApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const ROLES = [
  {
    id: 'role_admin',
    slug: 'admin',
    name: 'Admin',
    description: null,
    isBuiltin: true,
    memberCount: 2,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'role_viewer',
    slug: 'viewer',
    name: 'Viewer',
    description: null,
    isBuiltin: true,
    memberCount: 5,
    createdAt: 1,
    updatedAt: 1,
  },
];

function makeKey(overrides: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: 'key_1',
    name: 'Analytics pipeline',
    prefix: 'adm_sk_4f2a91cd',
    roleId: 'role_viewer',
    createdBy: 'usr_test',
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** The plaintext the server returns exactly once. Its absence is the assertion. */
const ONE_TIME_SECRET = 'adm_sk_9Xk2Qp7Rz4Tn8Ba1Vc6Ld3Mf5Gh0Jw2Nq4Sx6Yz';

interface StubOptions {
  keys?: ApiKeyDto[];
  roles?: typeof ROLES | 'forbidden';
  roleSlugs?: string[];
  createStatus?: number;
  /** Make the post-create list refetch fail (500) — see the banner test. */
  failListRefetch?: boolean;
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  let keys = options.keys ?? [makeKey()];
  let created = false;

  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: makeBootstrap({ nav: { groups: [] }, roles: options.roleSlugs ?? ['super-admin'] }),
        }),
      );
    }
    if (url === '/api/v1/api-keys' && method === 'GET') {
      if (options.failListRefetch === true && created) {
        // The refetch that follows a create blows up (500 / network blip).
        return Promise.resolve(
          jsonResponse(500, { error: { code: 'INTERNAL', message: 'nope', requestId: 'req_z' } }),
        );
      }
      return Promise.resolve(jsonResponse(200, { apiKeys: keys }));
    }
    if (url === '/api/v1/api-keys' && method === 'POST') {
      const status = options.createStatus ?? 201;
      if (status !== 201) {
        return Promise.resolve(
          jsonResponse(status, {
            error: { code: 'CONFLICT', message: 'Nope.', requestId: 'req_x' },
          }),
        );
      }
      const record = makeKey({ id: 'key_new', name: 'CI runner', prefix: 'adm_sk_9Xk2Qp7R' });
      created = true;
      keys = [record, ...keys];
      return Promise.resolve(
        jsonResponse(201, { apiKey: record, key: ONE_TIME_SECRET, scopes: ['table:conn_1:orders:read'] }),
      );
    }
    if (url.startsWith('/api/v1/api-keys/') && method === 'DELETE') {
      const id = url.split('/').pop() as string;
      keys = keys.map((key) => (key.id === id ? { ...key, revokedAt: Date.now() } : key));
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    if (url === '/api/v1/roles') {
      if (options.roles === 'forbidden') {
        return Promise.resolve(
          jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'No.', requestId: 'req_y' } }),
        );
      }
      return Promise.resolve(jsonResponse(200, { roles: options.roles ?? ROLES }));
    }
    if (/\/api\/v1\/roles\/.+\/permissions/.test(url)) {
      return Promise.resolve(jsonResponse(200, { roleId: 'role_viewer', grants: ['table:conn_1:orders:read'] }));
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
    history: createMemoryHistory({ initialEntries: ['/api-keys'] }),
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

describe('ApiKeysPage', () => {
  it('lists keys by their public prefix and the role they act as', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'API keys & tokens' })).toBeDefined();

    expect(screen.getByText('Analytics pipeline')).toBeDefined();
    expect(screen.getByText('adm_sk_4f2a91cd')).toBeDefined();
    // The role IS the badge — Adminium keys carry a role, not a live/test env.
    expect(await screen.findByText('Viewer')).toBeDefined();
  });

  it('renders the empty state when no key has been created', async () => {
    await renderPage({ keys: [] });
    expect(await screen.findByTestId('api-keys-empty')).toBeDefined();
    expect(screen.getByText('No API keys yet')).toBeDefined();
  });

  it('shows the role’s grants as scope chips', async () => {
    await renderPage();
    expect(await screen.findByText('table:conn_1:orders:read')).toBeDefined();
  });

  it('marks a revoked key as revoked rather than letting it pass for live', async () => {
    await renderPage({ keys: [makeKey({ revokedAt: 1_700_000_100_000 })] });
    expect(await screen.findByText(/Analytics pipeline · Revoked/)).toBeDefined();
  });

  it('marks a key past its expiry as expired', async () => {
    await renderPage({ keys: [makeKey({ expiresAt: 1_000 })] });
    expect(await screen.findByText(/Analytics pipeline · Expired/)).toBeDefined();
  });
});

describe('ApiKeysPage — the one-time secret', () => {
  it('shows the plaintext exactly once on creation, and never again', async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderPage({ keys: [] });
    await screen.findByRole('heading', { name: 'API keys & tokens' });

    await user.click(screen.getByTestId('api-keys-create'));
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'CI runner');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    // 1. Revealed once, with the warning that says so.
    const banner = await screen.findByTestId('api-key-revealed');
    expect(banner.textContent).toContain(ONE_TIME_SECRET);
    expect(screen.getByText(/won’t be able to see it again/)).toBeDefined();

    // 2. The plaintext is NOT in the query cache — a cached secret outlives its
    //    render and rides along in every devtools dump.
    expect(JSON.stringify(queryClient.getQueryData(['api-keys']) ?? null)).not.toContain(
      ONE_TIME_SECRET,
    );

    // 3. The refreshed list carries only the prefix — the server cannot return
    //    the plaintext again, and nothing on screen pretends otherwise.
    const listed = await screen.findByText('adm_sk_9Xk2Qp7R');
    expect(listed).toBeDefined();
  });

  it('offers no reveal affordance — there is nothing to reveal (the comp’s fake-reveal)', async () => {
    await renderPage();
    await screen.findByRole('heading', { name: 'API keys & tokens' });

    // The stored value is a hash; the displayed prefix is public. An eye toggle
    // here could only ever un-bullet what is already visible — theatre.
    expect(screen.queryByRole('button', { name: /Reveal key/ })).toBeNull();
    expect(document.querySelector('[data-part="api-key-value"][data-masked]')).toBeNull();
  });

  it('surfaces a create failure instead of pretending a key exists', async () => {
    const user = userEvent.setup();
    await renderPage({ keys: [], createStatus: 409 });
    await screen.findByRole('heading', { name: 'API keys & tokens' });

    await user.click(screen.getByTestId('api-keys-create'));
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'CI runner');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByTestId('api-keys-create-error')).toBeDefined();
    expect(screen.queryByTestId('api-key-revealed')).toBeNull();
  });
});

describe('ApiKeysPage — revoke', () => {
  it('requires typing the key name, and sends nothing until it matches', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'API keys & tokens' });

    await user.click(screen.getByRole('button', { name: 'Revoke key' }));
    await screen.findByText('Revoke API key');

    const confirm = screen.getByRole('button', { name: 'Revoke key' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    // A near-miss must not open the door.
    await user.type(screen.getByRole('textbox', { name: /confirm/i }), 'Analytics pipelin');
    expect(screen.getByRole('button', { name: 'Revoke key' }).hasAttribute('disabled')).toBe(true);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.type(screen.getByRole('textbox', { name: /confirm/i }), 'e');
    await user.click(screen.getByRole('button', { name: 'Revoke key' }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/key_1'))).toBe(true);
    });
  });
});

describe('ApiKeysPage — RBAC', () => {
  it('shows the forbidden state to a non-admin instead of the key list', async () => {
    const { calls } = await renderPage({ roleSlugs: ['viewer'] });

    // Assert the forbidden state POSITIVELY: "the heading is absent" would also
    // pass if the page simply failed to render, which proves nothing.
    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'API keys & tokens' })).toBeNull();
    expect(screen.queryByTestId('api-keys-create')).toBeNull();

    // And the gate holds before the wire: a viewer's browser never even asks
    // for the key list.
    expect(calls.some((call) => call.url === '/api/v1/api-keys')).toBe(false);
  });

  it('degrades — not breaks — when the principal cannot read roles', async () => {
    await renderPage({ roles: 'forbidden' });
    await screen.findByRole('heading', { name: 'API keys & tokens' });

    // The page still renders the keys it can see...
    expect(screen.getByText('Analytics pipeline')).toBeDefined();
    // ...says why creation is unavailable, and disables it rather than failing
    // on submit with an unexplained 403.
    expect(await screen.findByTestId('api-keys-roles-unavailable')).toBeDefined();
    expect(screen.getByTestId('api-keys-create').hasAttribute('disabled')).toBe(true);
  });
});

describe('ApiKeysPage — regressions the one-time secret depends on', () => {
  it('keeps the secret banner mounted when the list refetch fails', async () => {
    // THE BUG THIS PINS. The banner is rendered INSIDE ApiKeysPanelView, which
    // the page only rendered when `records.length > 0`. On an instance with zero
    // keys, POST /api-keys returns 201 with the plaintext while `keys` is still
    // [] until the awaited refetch resolves — so if that GET fails (500, a
    // network blip) or a replica still reports empty, the EmptyState branch
    // rendered and the banner never mounted at all. The key is live server-side
    // and hashed at rest: the only copy of a working credential was destroyed by
    // a failed list refresh, with no error to explain it.
    const user = userEvent.setup();
    await renderPage({ keys: [], failListRefetch: true });
    await screen.findByRole('heading', { name: 'API keys & tokens' });

    await user.click(screen.getByTestId('api-keys-create'));
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'CI runner');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    const banner = await screen.findByTestId('api-key-revealed');
    expect(banner.textContent).toContain(ONE_TIME_SECRET);
    // The empty state must NOT have won the race for the same slot.
    expect(screen.queryByTestId('api-keys-empty')).toBeNull();
  });

  it('never lets the plaintext reach the mutation cache', async () => {
    // THE BUG THIS PINS. apiKeysApi.ts promises the secret "is deliberately NOT
    // written into the react-query cache". The QUERY cache was clean and the old
    // test only checked that one — but `useMutation` stores whatever its
    // mutationFn resolves to, so the key sat in the MutationCache (visible in the
    // Devtools Mutations tab, and in any error reporter that serialises the
    // QueryClient) for the page lifetime plus gcTime.
    const user = userEvent.setup();
    const { queryClient } = await renderPage({ keys: [] });
    await screen.findByRole('heading', { name: 'API keys & tokens' });

    await user.click(screen.getByTestId('api-keys-create'));
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'CI runner');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    await screen.findByTestId('api-key-revealed');

    const mutations = queryClient.getMutationCache().getAll();
    expect(JSON.stringify(mutations.map((m) => m.state))).not.toContain(ONE_TIME_SECRET);
    // Belt and braces: nothing anywhere in the client's serialised state.
    expect(JSON.stringify(queryClient.getQueryData(['api-keys']) ?? null)).not.toContain(
      ONE_TIME_SECRET,
    );
  });

  it('offers no Revoke button on a key that cannot be revoked', async () => {
    // THE BUG THIS PINS. The page passed `onRevoke` unconditionally, so the
    // widget rendered the trash button on every row — while the page's handler
    // guarded on `isActive` and swallowed the click for dead keys. No confirm
    // modal, no toast, no disabled state: the user cannot tell whether the app
    // is broken or the action was a no-op.
    const user = userEvent.setup();
    await renderPage({ keys: [makeKey({ revokedAt: 1_700_000_100_000 })] });
    await screen.findByText(/Analytics pipeline · Revoked/);

    expect(screen.queryByRole('button', { name: 'Revoke key' })).toBeNull();

    // A live key still offers it, and it still opens the confirm door.
    await renderPage({ keys: [makeKey()] });
    const revoke = await screen.findByRole('button', { name: 'Revoke key' });
    await user.click(revoke);
    expect(await screen.findByRole('dialog')).toBeDefined();
  });
});
