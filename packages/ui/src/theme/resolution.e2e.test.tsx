// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M8-T06 — preference-resolution end-to-end contract, provider half
 * (10-i18n-theming.md §7.1/§7.5, 02-design-system.md §4).
 *
 * Drives the full chain the app boots through, at the ThemeProvider boundary:
 * localStorage pre-paint cache (stamped by `preHydrationScript` before React)
 * → per-axis resolution (baseline ← cache ← globalDefaults ← userPrefs ←
 * in-session setPref) → <html> attribute stamping → cache write-back →
 * change notification. The dashboard half (bootstrap fetch, PATCH wiring,
 * PreferencesPage reset) lives in
 * apps/dashboard/src/account/prefResolution.e2e.test.tsx.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, THEME_ATTRIBUTES, preHydrationScript } from '@adminium/tokens';

import { installMatchMedia } from '../test/match-media.js';
import { ThemeProvider, type ThemeProviderProps } from './ThemeProvider.js';
import { useTheme, useThemePrefs } from './useTheme.js';
import type { ThemePrefs } from './types.js';

const html = (): HTMLElement => document.documentElement;

interface Captured {
  resolved: ReturnType<typeof useTheme>;
  prefs: ReturnType<typeof useThemePrefs>['prefs'];
  setPref: ReturnType<typeof useThemePrefs>['setPref'];
  clearSessionPref: ReturnType<typeof useThemePrefs>['clearSessionPref'];
}

/**
 * Mount the provider with props that can change across renders, capturing the
 * live context into `box.current` (same pattern as ThemeProvider.test.tsx).
 */
function mountProvider(initial: Omit<ThemeProviderProps, 'children'> = {}) {
  const box = { current: null as unknown as Captured };
  function Capture(): null {
    const resolved = useTheme();
    const { prefs, setPref, clearSessionPref } = useThemePrefs();
    box.current = { resolved, prefs, setPref, clearSessionPref };
    return null;
  }
  function Harness(props: Omit<ThemeProviderProps, 'children'>) {
    return (
      <ThemeProvider {...props}>
        <Capture />
      </ThemeProvider>
    );
  }
  const utils = render(<Harness {...initial} />);
  return {
    box,
    rerenderWith: (props: Omit<ThemeProviderProps, 'children'>): void =>
      utils.rerender(<Harness {...props} />),
    unmount: (): void => utils.unmount(),
  };
}

/** Execute the literal inline bootstrap exactly as index.html would (the
 * byte-for-byte copy there is pinned by apps/dashboard prehydration.test.ts). */
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolution order per axis (§7.1: baseline ← cache ← globalDefaults ← userPrefs ← setPref)', () => {
  /** Walk one axis through every layer, re-seeding the cache before each mount
   * (each commit writes the cache back, which would destroy the seed). */
  function expectAxisChain<K extends keyof ThemePrefs>(
    axis: K,
    chain: {
      baseline: ThemePrefs[K];
      cached: ThemePrefs[K];
      globalDefaults: Partial<ThemePrefs>;
      globalValue: ThemePrefs[K];
      userPrefs: Partial<ThemePrefs>;
      userValue: ThemePrefs[K];
      session: ThemePrefs[K];
    },
  ): void {
    const seed = (): void => {
      window.localStorage.setItem(STORAGE_KEYS[axis], chain.cached);
    };

    // No sources at all → baseline.
    let h = mountProvider();
    expect(h.box.current.prefs[axis]).toBe(chain.baseline);
    h.unmount();

    // Cache only (pre-auth cold boot after a previous session).
    seed();
    h = mountProvider();
    expect(h.box.current.prefs[axis]).toBe(chain.cached);
    h.unmount();

    // Server global default beats the cache.
    seed();
    h = mountProvider({ globalDefaults: chain.globalDefaults });
    expect(h.box.current.prefs[axis]).toBe(chain.globalValue);
    h.unmount();

    // Per-user override beats the global default.
    seed();
    h = mountProvider({ globalDefaults: chain.globalDefaults, userPrefs: chain.userPrefs });
    expect(h.box.current.prefs[axis]).toBe(chain.userValue);

    // In-session setPref beats everything.
    act(() => h.box.current.setPref(axis, chain.session));
    expect(h.box.current.prefs[axis]).toBe(chain.session);
    h.unmount();
  }

  it('theme', () => {
    expectAxisChain('theme', {
      baseline: 'system',
      cached: 'dark',
      globalDefaults: { theme: 'light' },
      globalValue: 'light',
      userPrefs: { theme: 'dark' },
      userValue: 'dark',
      session: 'light',
    });
  });

  it('accent', () => {
    expectAxisChain('accent', {
      baseline: 'indigo',
      cached: 'teal',
      globalDefaults: { accent: 'blue' },
      globalValue: 'blue',
      userPrefs: { accent: 'rose' },
      userValue: 'rose',
      session: 'orange',
    });
  });

  it('density', () => {
    expectAxisChain('density', {
      baseline: 'comfortable',
      cached: 'compact',
      globalDefaults: { density: 'comfortable' },
      globalValue: 'comfortable',
      userPrefs: { density: 'compact' },
      userValue: 'compact',
      session: 'comfortable',
    });
  });

  it('locale', () => {
    expectAxisChain('locale', {
      baseline: 'en_US',
      cached: 'de_DE',
      globalDefaults: { locale: 'fr_FR' },
      globalValue: 'fr_FR',
      userPrefs: { locale: 'ar_EG' },
      userValue: 'ar_EG',
      session: 'cs_CZ',
    });
  });

  it('server-resolved values beat the cache; the cache only fills axes the props do not supply', () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, 'light');
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    window.localStorage.setItem(STORAGE_KEYS.density, 'compact');
    const { box } = mountProvider({
      globalDefaults: { accent: 'blue' },
      userPrefs: { theme: 'dark' },
    });
    expect(box.current.prefs).toEqual({
      theme: 'dark', // userPrefs beat the cached 'light'
      accent: 'blue', // globalDefaults beat the cached 'teal'
      density: 'compact', // server props silent on this axis → cache fills it
      locale: 'en_US', // no source anywhere → baseline
    });
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('blue');
    expect(html().getAttribute(THEME_ATTRIBUTES.density)).toBe('compact');
  });
});

describe('system theme (prefers-color-scheme)', () => {
  it('an explicit "system" from the server resolves via the OS and beats a cached explicit theme', () => {
    installMatchMedia({ prefersDark: true });
    window.localStorage.setItem(STORAGE_KEYS.theme, 'light');
    const { box } = mountProvider({ globalDefaults: { theme: 'system' } });
    expect(box.current.prefs.theme).toBe('system');
    expect(box.current.resolved.theme).toBe('dark');
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('dark');
  });

  it('media flips re-resolve only while the pref is system, and re-attach when it returns', () => {
    const media = installMatchMedia({ prefersDark: false });
    const { box } = mountProvider();
    expect(box.current.resolved.theme).toBe('light');

    act(() => media.setPrefersDark(true));
    expect(box.current.resolved.theme).toBe('dark');
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('dark');

    // An explicit pick detaches the listener: OS flips no longer re-resolve.
    act(() => box.current.setPref('theme', 'light'));
    expect(media.listenerCount()).toBe(0);
    act(() => media.setPrefersDark(false));
    act(() => media.setPrefersDark(true));
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('light');

    // Returning to system re-attaches and re-resolves against the current OS…
    act(() => box.current.setPref('theme', 'system'));
    expect(media.listenerCount()).toBe(1);
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('dark');
    // …and follows subsequent flips again.
    act(() => media.setPrefersDark(false));
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('light');
  });
});

describe('locale → direction coupling', () => {
  it('ar_EG stamps dir=rtl + BCP-47 lang; leaving ar_EG restores ltr', () => {
    const { rerenderWith } = mountProvider({ userPrefs: { locale: 'ar_EG' } });
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('rtl');
    expect(html().getAttribute(THEME_ATTRIBUTES.lang)).toBe('ar-EG');
    expect(window.localStorage.getItem(STORAGE_KEYS.dir)).toBe('rtl');

    rerenderWith({ userPrefs: { locale: 'de_DE' } });
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('ltr');
    expect(html().getAttribute(THEME_ATTRIBUTES.lang)).toBe('de-DE');
    expect(window.localStorage.getItem(STORAGE_KEYS.dir)).toBe('ltr');
  });

  it('the coupling also rides the in-session layer', () => {
    const { box } = mountProvider();
    act(() => box.current.setPref('locale', 'ar_EG'));
    expect(box.current.resolved.dir).toBe('rtl');
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('rtl');
    expect(html().getAttribute(THEME_ATTRIBUTES.lang)).toBe('ar-EG');

    act(() => box.current.setPref('locale', 'en_US'));
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('ltr');
    expect(html().getAttribute(THEME_ATTRIBUTES.lang)).toBe('en-US');
  });
});

describe('full lifecycle — boot → override → confirm → authoritative change → reset', () => {
  it('walks one M8 session end-to-end on the accent axis', () => {
    // 1. Previous session cached teal; this boot starts pre-auth (no props).
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    const { box, rerenderWith } = mountProvider();
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('teal');

    // 2. Bootstrap lands: workspace default blue, no user override → the
    //    server resolution beats the cache and rewrites it.
    rerenderWith({ globalDefaults: { accent: 'blue' } });
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('blue');
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('blue');

    // 3. The user picks orange → optimistic, applies instantly.
    act(() => box.current.setPref('accent', 'orange'));
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('orange');

    // 4. The PATCH round trip confirms: refetched props now carry the override
    //    (the session entry reconciles away; nothing changes visually).
    rerenderWith({ globalDefaults: { accent: 'blue' }, userPrefs: { accent: 'orange' } });
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('orange');

    // 5. A LATER authoritative change (override reset on another device, admin
    //    default now violet) must not be masked by the spent session entry —
    //    the 9bc94fd regression, pinned at chain level.
    rerenderWith({ globalDefaults: { accent: 'violet' } });
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('violet');

    // 6. New in-session override, then reset-to-default in THIS session: the
    //    caller clears the axis server-side and drops the session entry.
    act(() => box.current.setPref('accent', 'rose'));
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('rose');
    act(() => box.current.clearSessionPref('accent'));
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('violet');
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('violet');
  });
});

describe('flash-free hydration — preHydrationScript + first provider commit', () => {
  it('a pre-auth mount after the script re-affirms every attribute without ever changing it', () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, 'dark');
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    window.localStorage.setItem(STORAGE_KEYS.density, 'compact');
    window.localStorage.setItem(STORAGE_KEYS.locale, 'ar_EG');
    window.localStorage.setItem(STORAGE_KEYS.dir, 'rtl');
    runPreHydration();

    // The pre-paint frame is fully stamped before React exists.
    expect(html().getAttribute(THEME_ATTRIBUTES.theme)).toBe('dark');
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('teal');
    expect(html().getAttribute(THEME_ATTRIBUTES.density)).toBe('compact');
    expect(html().getAttribute(THEME_ATTRIBUTES.dir)).toBe('rtl');
    expect(html().getAttribute(THEME_ATTRIBUTES.lang)).toBe('ar-EG');

    const spy = spyOnHtmlAttributes();
    mountProvider(); // pre-auth: no server props yet

    for (const [attribute, expected] of [
      [THEME_ATTRIBUTES.theme, 'dark'],
      [THEME_ATTRIBUTES.accent, 'teal'],
      [THEME_ATTRIBUTES.density, 'compact'],
      [THEME_ATTRIBUTES.dir, 'rtl'],
      [THEME_ATTRIBUTES.lang, 'ar-EG'],
    ] as const) {
      const writes = writesTo(spy, attribute);
      expect(writes.length).toBeGreaterThan(0); // the first commit did stamp…
      expect(new Set(writes)).toEqual(new Set([expected])); // …only the pre-paint value
      expect(html().getAttribute(attribute)).toBe(expected);
    }
  });

  it('server props changing one axis transition exactly that attribute, with no intermediate value', () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, 'dark');
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    runPreHydration();
    expect(html().getAttribute(THEME_ATTRIBUTES.accent)).toBe('teal');

    const spy = spyOnHtmlAttributes();
    // Authed boot: the accent changed on another device since the cache was
    // written; the theme did not.
    mountProvider({ userPrefs: { theme: 'dark', accent: 'rose' } });

    // The changed axis went straight to the server value — never through the
    // indigo baseline, never back to the stale cached teal.
    expect(new Set(writesTo(spy, THEME_ATTRIBUTES.accent))).toEqual(new Set(['rose']));
    // The unchanged axis never left its pre-paint value.
    expect(new Set(writesTo(spy, THEME_ATTRIBUTES.theme))).toEqual(new Set(['dark']));
    // The cache is rewritten for the next cold boot.
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('rose');
  });
});

describe('persistence — cache write-through + change notification', () => {
  it('setPref writes the cache through (incl. derived dir) and onPrefChange gets the axis + next snapshot', () => {
    const onPrefChange = vi.fn();
    const { box } = mountProvider({
      globalDefaults: { accent: 'blue' },
      userPrefs: { theme: 'dark' },
      onPrefChange,
    });

    act(() => box.current.setPref('locale', 'ar_EG'));

    expect(onPrefChange).toHaveBeenCalledTimes(1);
    expect(onPrefChange).toHaveBeenCalledWith('locale', 'ar_EG', {
      theme: 'dark',
      accent: 'blue',
      density: 'comfortable',
      locale: 'ar_EG',
    });
    // Write-through: the pre-paint cache reproduces this exact state next boot.
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe('dark');
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('blue');
    expect(window.localStorage.getItem(STORAGE_KEYS.density)).toBe('comfortable');
    expect(window.localStorage.getItem(STORAGE_KEYS.locale)).toBe('ar_EG');
    expect(window.localStorage.getItem(STORAGE_KEYS.dir)).toBe('rtl');
  });

  it('clearSessionPref is not a preference change: no onPrefChange, but the fallback is cached', () => {
    const onPrefChange = vi.fn();
    const { box } = mountProvider({ globalDefaults: { density: 'comfortable' }, onPrefChange });
    act(() => box.current.setPref('density', 'compact'));
    expect(window.localStorage.getItem(STORAGE_KEYS.density)).toBe('compact');
    onPrefChange.mockClear();

    act(() => box.current.clearSessionPref('density'));
    expect(onPrefChange).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEYS.density)).toBe('comfortable');
  });
});
