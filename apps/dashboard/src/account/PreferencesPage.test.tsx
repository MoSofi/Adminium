/**
 * /account/preferences integration (10-i18n-theming.md §7.4): inheritance
 * badges from the raw NULL-per-axis prefs, override → PATCH payload via the
 * app-root `onPrefChange` wiring, and per-axis reset → explicit `null`.
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
import type { MePrefsData, RawUserPrefs } from './prefsApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const NULL_PREFS: RawUserPrefs = { theme: null, accent: null, density: null, locale: null, dir: null };

function mePrefsReply(prefs: Partial<RawUserPrefs> = {}): { data: MePrefsData } {
  return {
    data: {
      prefs: { ...NULL_PREFS, ...prefs },
      resolved: makeBootstrap().prefs,
    },
  };
}

interface PatchCall {
  body: Record<string, unknown>;
}

function stubFetch() {
  const patchCalls: PatchCall[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/me/prefs' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, mePrefsReply()));
    }
    if (url === '/api/v1/me/prefs' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      patchCalls.push({ body });
      const overrides = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
      return Promise.resolve(jsonResponse(200, mePrefsReply(overrides as Partial<RawUserPrefs>)));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, patchCalls };
}

async function renderPreferences() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/account/preferences'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Preferences' });
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

describe('PreferencesPage', () => {
  it('shows inheritance affordances when every axis is NULL', async () => {
    await renderPreferences();
    expect(screen.getAllByText('Workspace default')).toHaveLength(4);
    expect(screen.queryAllByText('Personal')).toHaveLength(0);
    // Effective (workspace default) value surfaces in the caption.
    expect(screen.getByText('Using workspace default (Light)')).toBeDefined();
    expect(screen.queryByText('Reset to workspace default')).toBeNull();
  });

  it('override: picking a value PATCHes the axis and flips the badge to Personal', async () => {
    const user = userEvent.setup();
    const { patchCalls } = await renderPreferences();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    // ThemeProvider applied instantly + the root onPrefChange persisted it.
    await waitFor(() => {
      expect(patchCalls.some((call) => call.body['theme'] === 'dark')).toBe(true);
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getAllByText('Personal')).toHaveLength(1);
    expect(screen.getByText('Reset to workspace default')).toBeDefined();
  });

  it('reset: sends the explicit null and returns the axis to inheritance', async () => {
    const user = userEvent.setup();
    const { patchCalls } = await renderPreferences();

    await user.click(screen.getByRole('radio', { name: 'Compact' }));
    await waitFor(() => {
      expect(patchCalls.some((call) => call.body['density'] === 'compact')).toBe(true);
    });

    await user.click(screen.getByText('Reset to workspace default'));
    await waitFor(() => {
      expect(patchCalls.some((call) => call.body['density'] === null)).toBe(true);
    });
    // Badge back to inheritance for all four axes.
    await waitFor(() => {
      expect(screen.getAllByText('Workspace default')).toHaveLength(4);
    });
  });

  it('locale override PATCHes the locale axis', async () => {
    const user = userEvent.setup();
    const { patchCalls } = await renderPreferences();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de_DE');
    await waitFor(() => {
      expect(patchCalls.some((call) => call.body['locale'] === 'de_DE')).toBe(true);
    });
    expect(screen.getAllByText('Personal')).toHaveLength(1);
  });
});
