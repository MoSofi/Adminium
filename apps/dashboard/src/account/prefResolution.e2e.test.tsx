/**
 * M8-T06 — preference-resolution end-to-end contract, app half
 * (10-i18n-theming.md §7, 02-design-system.md §4).
 *
 * Drives the WHOLE chain through the real router: preHydrationScript stamps
 * the pre-paint frame from the localStorage cache → GET /api/v1/bootstrap
 * delivers the server resolution (user override ?? workspace default) into
 * the root ThemeProvider → PreferencesPage overrides ride setPref + the root
 * onPrefChange PATCH → refetches reconcile the optimistic layer. The
 * provider-boundary half (per-axis layering, media re-attach, write-through)
 * lives in packages/ui/src/theme/resolution.e2e.test.tsx.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Accent, Density, ThemePref } from '@adminium/tokens';
import { STORAGE_KEYS, THEME_ATTRIBUTES, preHydrationScript } from '@adminium/tokens';
import type { Locale } from '@adminium/ui';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import type { ResolvedPrefs } from '../app/bootstrap.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { RawUserPrefs } from './prefsApi.js';

const html = (): HTMLElement => document.documentElement;

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

// --- fake server: adminium_settings defaults + adminium_user_prefs row -------

interface AxisValues {
  theme: ThemePref;
  accent: Accent;
  density: Density;
  locale: Locale;
}

interface FakeServer {
  /** Workspace defaults (adminium_settings) — mutate to simulate an admin change. */
  defaults: AxisValues;
  /** Per-user overrides (adminium_user_prefs); `null` = inherit (§7.2). */
  raw: RawUserPrefs;
  patchCalls: Array<Partial<RawUserPrefs>>;
}

function makeServer(
  seed: { defaults?: Partial<AxisValues>; raw?: Partial<RawUserPrefs> } = {},
): FakeServer {
  return {
    defaults: {
      theme: 'light',
      accent: 'indigo',
      density: 'comfortable',
      locale: 'en_US',
      ...seed.defaults,
    },
    raw: { theme: null, accent: null, density: null, locale: null, dir: null, ...seed.raw },
    patchCalls: [],
  };
}

/** Server-side resolution (§7.1): user override ?? workspace default, dir derived. */
function resolvePrefs(server: FakeServer): ResolvedPrefs {
  const locale = server.raw.locale ?? server.defaults.locale;
  const sourceOf = (override: unknown): 'user' | 'global' => (override === null ? 'global' : 'user');
  return {
    theme: server.raw.theme ?? server.defaults.theme,
    accent: server.raw.accent ?? server.defaults.accent,
    density: server.raw.density ?? server.defaults.density,
    locale,
    dir: locale === 'ar_EG' ? 'rtl' : 'ltr',
    source: {
      theme: sourceOf(server.raw.theme),
      accent: sourceOf(server.raw.accent),
      density: sourceOf(server.raw.density),
      locale: sourceOf(server.raw.locale),
      dir: sourceOf(server.raw.locale),
    },
  };
}

function stubFetch(server: FakeServer) {
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, prefs: resolvePrefs(server) }) }),
      );
    }
    if (url === '/api/v1/me/prefs' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, { data: { prefs: { ...server.raw }, resolved: resolvePrefs(server) } }),
      );
    }
    if (url === '/api/v1/me/prefs' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Partial<RawUserPrefs>;
      server.patchCalls.push(body);
      if (body.theme !== undefined) server.raw.theme = body.theme;
      if (body.accent !== undefined) server.raw.accent = body.accent;
      if (body.density !== undefined) server.raw.density = body.density;
      if (body.locale !== undefined) server.raw.locale = body.locale;
      return Promise.resolve(
        jsonResponse(200, { data: { prefs: { ...server.raw }, resolved: resolvePrefs(server) } }),
      );
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_e2e' } }),
    );
  });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// --- harness ------------------------------------------------------------------

function renderApp(server: FakeServer, path = '/account/preferences') {
  const fetchMock = stubFetch(server);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { fetchMock, queryClient };
}

async function openPreferences(server: FakeServer) {
  const utils = renderApp(server);
  await screen.findByRole('heading', { name: 'Preferences' });
  return utils;
}

/**
 * Deliver a fresh server resolution to the running app. Prod path: a PATCH
 * reply or a WS `config-changed`/`settings.defaults.updated` frame invalidates
 * `['bootstrap']`; the AppShell observer refetches and the root re-renders
 * ThemeProvider with the new userPrefs. `refetchQueries` is the deterministic
 * test equivalent of that invalidation.
 */
async function deliverServerResolution(queryClient: QueryClient): Promise<void> {
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['bootstrap'] });
    // TanStack's notifyManager schedules observer notifications on a macrotask
    // (setTimeout); flush it so THIS resolution renders before the test moves
    // on — otherwise two back-to-back refetches coalesce into one render and
    // the intermediate server state never reaches the provider.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Execute the literal inline bootstrap exactly as index.html does before
 * React mounts (prehydration.test.ts pins the byte-for-byte copy). */
function runPreHydration(): void {
  new Function('document', 'localStorage', 'matchMedia', preHydrationScript)(
    document,
    window.localStorage,
    window.matchMedia.bind(window),
  );
}

function spyOnHtmlAttributes() {
  return vi.spyOn(document.documentElement, 'setAttribute');
}

/** Every value written to one attribute, in order. */
function writesTo(spy: ReturnType<typeof spyOnHtmlAttributes>, attribute: string): string[] {
  return spy.mock.calls.filter(([name]) => name === attribute).map(([, value]) => String(value));
}

/** Controllable prefers-color-scheme (the setup-file stub is static). */
const DARK_QUERY = '(prefers-color-scheme: dark)';

function installControllableMatchMedia(initial: { prefersDark: boolean }) {
  let prefersDark = initial.prefersDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const makeList = (query: string) => ({
    get matches() {
      return query === DARK_QUERY ? prefersDark : false;
    },
    media: query,
    onchange: null,
    addEventListener(type: string, listener: (event: MediaQueryListEvent) => void): void {
      if (query === DARK_QUERY && type === 'change') listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void): void {
      listeners.delete(listener);
    },
    addListener(listener: (event: MediaQueryListEvent) => void): void {
      if (query === DARK_QUERY) listeners.add(listener);
    },
    removeListener(listener: (event: MediaQueryListEvent) => void): void {
      listeners.delete(listener);
    },
    dispatchEvent: (): boolean => false,
  });
  window.matchMedia = ((query: string) => makeList(query)) as unknown as typeof window.matchMedia;
  return {
    listenerCount: (): number => listeners.size,
    setPrefersDark(next: boolean): void {
      prefersDark = next;
      const event = { matches: next, media: DARK_QUERY } as MediaQueryListEvent;
      for (const listener of [...listeners]) listener(event);
    },
  };
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

// --- boot ----------------------------------------------------------------------

describe('boot — pre-auth surfaces', () => {
  it('login renders from the pre-paint cache without an authenticated resolution (§4.2 pre-auth)', async () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, 'dark');
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    runPreHydration();

    const { fetchMock } = renderApp(makeServer(), '/login');
    await screen.findByText('Welcome back');

    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('dark');
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('teal');
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).startsWith('/api/v1/bootstrap')),
    ).toBe(false);
  });
});

describe('boot — flash-free hydration through the full app', () => {
  it('warm boot with an unchanged server never thrashes a stamped attribute', async () => {
    const server = makeServer({
      raw: { theme: 'dark', accent: 'teal', density: 'compact', locale: 'ar_EG' },
    });
    // Cache from the previous session, matching the server resolution.
    window.localStorage.setItem(STORAGE_KEYS.theme, 'dark');
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    window.localStorage.setItem(STORAGE_KEYS.density, 'compact');
    window.localStorage.setItem(STORAGE_KEYS.locale, 'ar_EG');
    window.localStorage.setItem(STORAGE_KEYS.dir, 'rtl');
    runPreHydration();
    const spy = spyOnHtmlAttributes();

    renderApp(server);
    await screen.findByRole('heading', { name: 'Preferences' });

    for (const [attribute, expected] of [
      [THEME_ATTRIBUTES.theme, 'dark'],
      [THEME_ATTRIBUTES.accent, 'teal'],
      [THEME_ATTRIBUTES.density, 'compact'],
      [THEME_ATTRIBUTES.dir, 'rtl'],
      [THEME_ATTRIBUTES.lang, 'ar-EG'],
    ] as const) {
      const writes = writesTo(spy, attribute);
      expect(writes.length).toBeGreaterThan(0); // React did commit the axis…
      expect(new Set(writes)).toEqual(new Set([expected])); // …never with another value
      expect(html().getAttribute(attribute)).toBe(expected);
    }
  });

  it('an axis changed on another device transitions once — no baseline flash, cache rewritten', async () => {
    const server = makeServer({ raw: { accent: 'rose' } });
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal'); // stale cache
    runPreHydration();
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('teal'); // pre-paint frame
    const spy = spyOnHtmlAttributes();

    renderApp(server);
    await screen.findByRole('heading', { name: 'Preferences' });
    await waitFor(() => {
      expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('rose');
    });

    // teal (pre-paint) → rose (server-resolved): nothing else in between — in
    // particular never the indigo baseline — and no revert after the flip.
    const sequence = writesTo(spy, THEME_ATTRIBUTES.accent);
    expect(sequence.length).toBeGreaterThan(0);
    expect(sequence.every((value) => value === 'teal' || value === 'rose')).toBe(true);
    expect(sequence.at(-1)).toBe('rose');
    expect(sequence.lastIndexOf('teal')).toBeLessThan(sequence.indexOf('rose'));
    // The cache now carries the server value for the next cold boot.
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('rose');
  });
});

// --- system theme ----------------------------------------------------------------

describe('system theme through the full chain', () => {
  it('workspace default "system" follows OS flips live; an explicit pick detaches', async () => {
    const media = installControllableMatchMedia({ prefersDark: true });
    const server = makeServer({ defaults: { theme: 'system' } });
    const user = userEvent.setup();
    await openPreferences(server);
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('dark');

    act(() => media.setPrefersDark(false));
    await waitFor(() => {
      expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('light');
    });

    // An explicit pick via the UI persists and detaches OS tracking.
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => {
      expect(server.patchCalls.some((call) => call.theme === 'light')).toBe(true);
    });
    expect(media.listenerCount()).toBe(0);

    act(() => media.setPrefersDark(true));
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('light'); // flip ignored
  });
});

// --- locale → direction ------------------------------------------------------------

describe('locale → direction through the full chain', () => {
  it('picking Arabic flips dir/lang instantly and persists; switching back restores ltr', async () => {
    const server = makeServer();
    const user = userEvent.setup();
    await openPreferences(server);
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('ltr');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ar_EG');
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('rtl');
    expect(html().getAttribute(THEME_ATTRIBUTES.lang)).toBe('ar-EG');
    await waitFor(() => {
      expect(server.patchCalls.some((call) => call.locale === 'ar_EG')).toBe(true);
    });
    expect(window.localStorage.getItem(STORAGE_KEYS.locale)).toBe('ar_EG');
    expect(window.localStorage.getItem(STORAGE_KEYS.dir)).toBe('rtl');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'en_US');
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('ltr');
    expect(html().getAttribute(THEME_ATTRIBUTES.lang)).toBe('en-US');
    expect(window.localStorage.getItem(STORAGE_KEYS.dir)).toBe('ltr');
  });
});

// --- optimistic layer across server round trips -------------------------------------

describe('optimistic session layer across server round trips', () => {
  it('setPref wins instantly, reconciles on catch-up, and a later authoritative change applies (9bc94fd regression)', async () => {
    const server = makeServer();
    const user = userEvent.setup();
    const { queryClient } = await openPreferences(server);

    // 1. Optimistic: instant, ahead of any server reply…
    await user.click(screen.getByRole('radio', { name: 'Orange' }));
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('orange');
    // …the root wiring persisted it, and the cache got the write-through.
    await waitFor(() => {
      expect(server.patchCalls.some((call) => call.accent === 'orange')).toBe(true);
    });
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('orange');

    // 2. Server catch-up: the refetched bootstrap resolves the same value, so
    //    the session entry has served its purpose (no visible change).
    await deliverServerResolution(queryClient);
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('orange');

    // 3. LATER authoritative change: the override is cleared and the workspace
    //    default changes (another device / admin console). Pre-9bc94fd the
    //    spent session entry kept masking this until a reload.
    server.raw.accent = null;
    server.defaults.accent = 'violet';
    await deliverServerResolution(queryClient);
    await waitFor(() => {
      expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('violet');
    });
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('violet');
  });
});

// --- reset to workspace default -----------------------------------------------------

describe('reset to workspace default', () => {
  it('resetting a same-session override PATCHes null, drops the session entry, and the default applies without reload', async () => {
    const server = makeServer({ defaults: { density: 'comfortable' } });
    const user = userEvent.setup();
    await openPreferences(server);

    await user.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(html().getAttribute(THEME_ATTRIBUTES.density)).toBe('compact');
    await waitFor(() => {
      expect(server.patchCalls.some((call) => call.density === 'compact')).toBe(true);
    });
    expect(screen.getAllByText('Personal')).toHaveLength(1);

    await user.click(screen.getByText('Reset to workspace default'));
    await waitFor(() => {
      expect(server.patchCalls.some((call) => call.density === null)).toBe(true);
    });
    // clearSessionPref + the refetched resolution: the axis returns to
    // inheritance and the workspace default shows immediately.
    await waitFor(() => {
      expect(screen.getAllByText('Workspace default')).toHaveLength(4);
    });
    expect(html().getAttribute(THEME_ATTRIBUTES.density)).toBe('comfortable');
    expect(window.localStorage.getItem(STORAGE_KEYS.density)).toBe('comfortable');
  });

  it('resetting an override persisted in a PREVIOUS session falls back via the refetched resolution', async () => {
    const server = makeServer({ defaults: { theme: 'light' }, raw: { theme: 'dark' } });
    const user = userEvent.setup();
    await openPreferences(server);
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('dark');
    expect(screen.getAllByText('Personal')).toHaveLength(1);

    // No optimistic entry exists this session — the fallback must arrive
    // through PATCH null → bootstrap invalidation → refetched resolution.
    await user.click(screen.getByText('Reset to workspace default'));
    await waitFor(() => {
      expect(server.patchCalls.some((call) => call.theme === null)).toBe(true);
    });
    await waitFor(() => {
      expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('light');
    });
    expect(screen.getAllByText('Workspace default')).toHaveLength(4);
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe('light');
  });
});
