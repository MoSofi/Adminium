/**
 * /settings/defaults integration (10-i18n-theming.md §7.3): super-admin
 * gating, adoption meters, the full-object PUT on save + success toast, and
 * the `settings.defaults.updated` realtime mapping → bootstrap invalidation.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { invalidateForRealtimeEvent } from '../api/realtime.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { SettingsDefaultsData } from './defaultsApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeDefaults(overrides: Partial<SettingsDefaultsData> = {}): SettingsDefaultsData {
  return {
    theme: 'system',
    accent: 'indigo',
    density: 'comfortable',
    locale: 'en_US',
    adoption: {
      totalUsers: 12,
      following: { theme: 8, accent: 10, density: 12, locale: 11 },
    },
    ...overrides,
  };
}

interface PutCall {
  body: Record<string, unknown>;
}

function stubFetch(roles: string[]) {
  const putCalls: PutCall[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles, nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/settings/defaults' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: makeDefaults() }));
    }
    if (url === '/api/v1/settings/defaults' && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      putCalls.push({ body });
      return Promise.resolve(
        jsonResponse(200, { data: makeDefaults(body as Partial<SettingsDefaultsData>) }),
      );
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, putCalls };
}

async function renderDefaults(roles: string[] = ['super-admin']) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(roles);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/settings/defaults'] }),
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

describe('GlobalDefaultsPage', () => {
  it('renders the four axis pickers with adoption meters for a super admin', async () => {
    await renderDefaults();
    expect(await screen.findByRole('heading', { name: 'Global defaults' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Appearance defaults' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Language & region defaults' })).toBeDefined();

    // Explainer copy (§7.3 exact copy, en-US source).
    expect(screen.getByText(/apply to all users unless they override them/)).toBeDefined();

    // Adoption meters from the payload — ICU-formatted per axis.
    expect(screen.getByText('8 of 12 users follow this default.')).toBeDefined();
    expect(screen.getByText('10 of 12 users follow this default.')).toBeDefined();
    expect(screen.getByText('12 of 12 users follow this default.')).toBeDefined();
    expect(screen.getByText('11 of 12 users follow this default.')).toBeDefined();

    // Controls reflect the stored defaults.
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Indigo' }).getAttribute('aria-checked')).toBe('true');
  });

  it('save: PUTs the full object and toasts success', async () => {
    const user = userEvent.setup();
    const { putCalls } = await renderDefaults();
    await screen.findByRole('heading', { name: 'Global defaults' });

    const save = screen.getByRole('button', { name: 'Save defaults' });
    expect(save.hasAttribute('disabled')).toBe(true); // pristine form

    await user.click(screen.getByRole('radio', { name: 'Teal' }));
    await user.click(screen.getByRole('radio', { name: 'Compact' }));
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));

    await waitFor(() => {
      expect(putCalls).toHaveLength(1);
    });
    // Full-object write (§7.2) — all four axes, changed or not.
    expect(putCalls[0]?.body).toEqual({
      theme: 'system',
      accent: 'teal',
      density: 'compact',
      locale: 'en_US',
    });
    expect(await screen.findByText('Workspace defaults updated')).toBeDefined();
  });

  it('renders the 403 system state for non-super-admins (client-side gate)', async () => {
    const { fetchMock } = await renderDefaults(['admin']);
    expect(await screen.findByText('You don’t have access')).toBeDefined();
    // The gated page never even asks for the defaults payload.
    const settingsCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).startsWith('/api/v1/settings/defaults'),
    );
    expect(settingsCalls).toHaveLength(0);
  });
});

describe('settings.defaults.updated realtime mapping', () => {
  it('invalidates bootstrap + the defaults query, leaving pages untouched', () => {
    const queryClient = createQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateForRealtimeEvent(queryClient, {
      channel: 'config-changed',
      type: 'settings.defaults.updated',
      data: { theme: 'dark', accent: 'teal', density: 'compact', locale: 'de_DE' },
      ts: '2026-07-14T00:00:00.000Z',
    });
    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(['bootstrap']);
    expect(keys).toContainEqual(['settings', 'defaults']);
    expect(keys).not.toContainEqual(['page']);
  });

  it('generic config-changed behavior is unchanged', () => {
    const queryClient = createQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateForRealtimeEvent(queryClient, {
      channel: 'config-changed',
      type: 'config-changed',
      data: {},
      ts: '2026-07-14T00:00:00.000Z',
    });
    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(['bootstrap']);
    expect(keys).toContainEqual(['page']);
  });
});
