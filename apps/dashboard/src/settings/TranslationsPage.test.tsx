/**
 * /settings/translations integration (23-runtime-translations.md §7):
 * super-admin gating, the key browser, saving an override, resetting to the
 * built-in, and the locale manager's enable/disable.
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

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const MANIFEST = {
  version: 3,
  locales: [
    {
      locale: 'de_DE',
      tag: 'de-DE',
      english: 'German',
      native: 'Deutsch',
      dir: 'ltr',
      fontHint: 'latin',
      intlTag: 'de-DE',
      pluralCategories: ['one', 'other'],
      builtin: true,
      enabled: true,
      sortOrder: 0,
      overrideCount: 1,
    },
    {
      locale: 'sw_KE',
      tag: 'sw-KE',
      english: 'Swahili',
      native: 'Kiswahili',
      dir: 'ltr',
      fontHint: 'latin',
      intlTag: 'sw-KE',
      pluralCategories: ['one', 'other'],
      builtin: false,
      enabled: true,
      sortOrder: 1,
      overrideCount: 0,
    },
  ],
};

const KEYS_PAGE = {
  version: 3,
  total: 1,
  groups: [{ group: 'account', count: 1 }],
  items: [
    {
      namespace: 'common',
      key: 'account.title',
      source: 'Account',
      builtin: 'Konto',
      override: 'Mein Konto',
      stale: false,
      a11yCritical: false,
      updatedAt: 1_750_000_000_000,
    },
  ],
};

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(roles: string[]) {
  const calls: Recorded[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ method, url, body });

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles, nav: { groups: [] } }) }));
    }
    if (url.startsWith('/api/v1/i18n/manifest')) {
      return Promise.resolve(jsonResponse(200, MANIFEST));
    }
    if (url.startsWith('/api/v1/i18n/bundle')) {
      return Promise.resolve(
        jsonResponse(200, { locale: 'de_DE', namespace: 'common', version: 3, overrides: {} }),
      );
    }
    if (url.startsWith('/api/v1/i18n/keys') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, KEYS_PAGE));
    }
    if (url.startsWith('/api/v1/i18n/keys') && method === 'PUT') {
      return Promise.resolve(jsonResponse(200, { ok: true, version: 4, row: null }));
    }
    if (url.startsWith('/api/v1/i18n/keys') && method === 'DELETE') {
      return Promise.resolve(jsonResponse(200, { ok: true, version: 5, row: null }));
    }
    if (url.startsWith('/api/v1/i18n/locales') && method === 'PATCH') {
      return Promise.resolve(jsonResponse(200, { ok: true, version: 6, locale: null }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

async function renderPage(roles: string[] = ['super-admin']) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(roles);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/settings/translations'] }),
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
  vi.restoreAllMocks();
});

describe('/settings/translations', () => {
  it('renders the 403 state for a non-super-admin', async () => {
    await renderPage(['admin']);
    expect(await screen.findByText(/don’t have access|do not have access|forbidden/i)).toBeTruthy();
  });

  it('lists the locales, including a custom one, with its override count', async () => {
    await renderPage();
    expect(await screen.findByText('Kiswahili')).toBeTruthy();
    expect(screen.getByText('Deutsch')).toBeTruthy();
    // The custom locale is labelled as such — a built-in cannot be deleted and
    // the UI has to make that distinction visible (23 §7).
    expect(screen.getAllByText(/Custom/).length).toBeGreaterThan(0);
  });

  it('saves an override through PUT /i18n/keys', async () => {
    const { calls } = await renderPage();
    const field = await screen.findByLabelText('Translation');
    await userEvent.clear(field);
    await userEvent.type(field, 'Konto neu');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/i18n/keys'));
      expect(put?.body).toMatchObject({
        locale: 'de_DE',
        namespace: 'common',
        key: 'account.title',
        value: 'Konto neu',
      });
    });
  });

  it('resets to the built-in with a DELETE, not an empty write', async () => {
    const { calls } = await renderPage();
    await screen.findByLabelText('Translation');
    await userEvent.click(screen.getByRole('button', { name: /Reset to built-in/ }));

    await waitFor(() => {
      const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('/i18n/keys'));
      expect(del).toBeDefined();
      // A blank write is a DIFFERENT operation ("render nothing", 23 §3.3), so
      // reset must never be implemented as one.
      expect(calls.some((c) => c.method === 'PUT' && c.body !== undefined && (c.body as { value?: string }).value === '')).toBe(false);
    });
  });

  it('turns a language off through PATCH /i18n/locales', async () => {
    const { calls } = await renderPage();
    await screen.findByText('Kiswahili');
    const offButtons = screen.getAllByRole('button', { name: 'Turn off' });
    await userEvent.click(offButtons[0] as HTMLElement);

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/i18n/locales'));
      expect(patch?.body).toMatchObject({ enabled: false });
    });
  });
});
