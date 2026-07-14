/**
 * /studio/settings integration (M5-T05): workspace identity for super admins
 * with the review-then-confirm save modal (changed fields listed, branding
 * PUT), the admin fallback (no settings fetch, danger zone still present),
 * and the danger-zone type-to-confirm connection delete. Router-mounted like
 * the GlobalDefaultsPage suite.
 *
 * The `auth.*` security controls are not surfaced (no auth flow enforces them
 * yet), so there is no security section or /settings/security PUT to assert.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import type { WorkspaceSettingsData } from './workspaceApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeWorkspace(overrides: Partial<WorkspaceSettingsData> = {}): WorkspaceSettingsData {
  return {
    branding: { appName: 'Adminium' },
    ...overrides,
  };
}

function makeConnection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: 'conn_1',
    name: 'Production Postgres',
    engine: 'postgres',
    sourceKind: 'dsn',
    dsnMasked: 'postgres://ava@db.acme.io:5432/prod',
    readOnly: true,
    status: 'connected',
    lastTestedAt: null,
    lastLatencyMs: 42,
    lastError: null,
    snapshot: null,
    tableCount: 14,
    pageCount: 9,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(roles: string[], connections: ConnectionDto[] = [makeConnection()]) {
  const calls: Call[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles, nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/settings/workspace' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: makeWorkspace() }));
    }
    if (url === '/api/v1/settings/branding' && method === 'PUT') {
      const put = body as { appName: string };
      return Promise.resolve(
        jsonResponse(200, { data: makeWorkspace({ branding: { appName: put.appName } }) }),
      );
    }
    if (url === '/api/v1/connections' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { connections }));
    }
    if (method === 'DELETE' && url.startsWith('/api/v1/connections/')) {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderPage(roles: string[] = ['super-admin'], connections?: ConnectionDto[]) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(roles, connections);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/settings'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, queryClient, router };
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

describe('StudioSettingsPage', () => {
  it('renders workspace identity from the workspace payload for a super admin', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Workspace settings' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Workspace identity' })).toBeDefined();
    expect((screen.getByLabelText('Application name') as HTMLInputElement).value).toBe('Adminium');
    // No inert security controls are surfaced.
    expect(screen.queryByRole('switch', { name: 'Require two-factor auth' })).toBeNull();
    expect(screen.queryByLabelText('Session lifetime (hours)')).toBeNull();
    // Pristine form — nothing to save yet.
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
  });

  it('review-then-confirm: lists exactly the changed field, then PUTs branding', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Workspace settings' });

    const nameInput = screen.getByLabelText('Application name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Acme Ops');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Review your changes before saving.')).toBeDefined();
    // Only the dirty field appears in the review list.
    expect(within(dialog).getByText('Adminium → Acme Ops')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');

    const brandingPut = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/branding'));
    expect(brandingPut?.body).toEqual({ appName: 'Acme Ops' });
    // No security surface is ever hit.
    expect(calls.some((c) => c.url.endsWith('/settings/security'))).toBe(false);
  });

  it('admins get the super-admin notice, no settings fetch, but keep the danger zone', async () => {
    const { fetchMock } = await renderPage(['admin']);
    expect(
      await screen.findByText('Only a super admin can change workspace identity and security settings.'),
    ).toBeDefined();
    expect(await screen.findByRole('heading', { name: 'Danger zone' })).toBeDefined();
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/v1/settings/workspace'),
    ).toHaveLength(0);
  });

  it('danger zone: type-to-confirm gating before the DELETE fires', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Danger zone' });

    await user.click(screen.getByRole('button', { name: 'Delete connection' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete connection' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await user.type(within(dialog).getByRole('textbox'), 'Production Postgres');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);

    await screen.findByText('Connection “Production Postgres” deleted');
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('/api/v1/connections/conn_1');
    expect(del?.body).toEqual({ confirmName: 'Production Postgres' });
  });

  it('shows the empty danger zone note without connections', async () => {
    await renderPage(['super-admin'], []);
    expect(await screen.findByText('Nothing to delete — no connections yet.')).toBeDefined();
  });
});
