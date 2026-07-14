import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@adminium/tokens';

import { installMatchMedia } from '../test/match-media.js';
import { ThemeProvider, type ThemeProviderProps } from './ThemeProvider.js';
import { subscribeTheme } from './subscribe.js';
import { useTheme, useThemePrefs } from './useTheme.js';

const html = (): HTMLElement => document.documentElement;

function wrapper(props: Omit<ThemeProviderProps, 'children'> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ThemeProvider {...props}>{children}</ThemeProvider>;
  };
}

function renderTheme(props: Omit<ThemeProviderProps, 'children'> = {}) {
  return renderHook(
    () => {
      const resolved = useTheme();
      const { prefs, setPref } = useThemePrefs();
      return { resolved, prefs, setPref };
    },
    { wrapper: wrapper(props) },
  );
}

interface Captured {
  resolved: ReturnType<typeof useTheme>;
  prefs: ReturnType<typeof useThemePrefs>['prefs'];
  setPref: ReturnType<typeof useThemePrefs>['setPref'];
  clearSessionPref: ReturnType<typeof useThemePrefs>['clearSessionPref'];
}

/**
 * Render the provider with props that can change across renders (renderHook's
 * wrapper props are fixed), capturing the live context into `box.current`.
 */
function renderControllable(initial: Omit<ThemeProviderProps, 'children'> = {}) {
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
  };
}

describe('ThemeProvider — attribute stamping', () => {
  it('stamps baseline attributes on <html>', () => {
    renderTheme();
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(html().getAttribute('data-accent')).toBe('indigo');
    expect(html().getAttribute('data-density')).toBe('comfortable');
    expect(html().getAttribute('dir')).toBe('ltr');
    expect(html().getAttribute('lang')).toBe('en-US');
  });

  it('derives dir=rtl and BCP-47 lang for ar_EG', () => {
    renderTheme({ userPrefs: { locale: 'ar_EG' } });
    expect(html().getAttribute('dir')).toBe('rtl');
    expect(html().getAttribute('lang')).toBe('ar-EG');
  });

  it('stamps the resolved theme, never the literal "system"', () => {
    installMatchMedia({ prefersDark: true });
    renderTheme({ userPrefs: { theme: 'system' } });
    expect(html().getAttribute('data-theme')).toBe('dark');
  });
});

describe('ThemeProvider — resolution order', () => {
  it('uses the localStorage cache when no server prefs are supplied (pre-auth)', () => {
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    window.localStorage.setItem(STORAGE_KEYS.density, 'compact');
    renderTheme();
    expect(html().getAttribute('data-accent')).toBe('teal');
    expect(html().getAttribute('data-density')).toBe('compact');
  });

  it('ignores invalid cached values', () => {
    window.localStorage.setItem(STORAGE_KEYS.accent, 'hotpink');
    window.localStorage.setItem(STORAGE_KEYS.theme, 'sepia');
    renderTheme();
    expect(html().getAttribute('data-accent')).toBe('indigo');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('globalDefaults beat the cache; userPrefs beat globalDefaults (per axis)', () => {
    window.localStorage.setItem(STORAGE_KEYS.accent, 'teal');
    window.localStorage.setItem(STORAGE_KEYS.density, 'compact');
    renderTheme({
      globalDefaults: { accent: 'blue', theme: 'dark' },
      userPrefs: { accent: 'rose' },
    });
    // userPrefs > globalDefaults > cache > baseline
    expect(html().getAttribute('data-accent')).toBe('rose');
    // globalDefaults > cache
    expect(html().getAttribute('data-theme')).toBe('dark');
    // axis untouched by server props still falls back to the cache
    expect(html().getAttribute('data-density')).toBe('compact');
  });

  it('setPref beats every other source', () => {
    const { result } = renderTheme({ userPrefs: { accent: 'rose' } });
    act(() => result.current.setPref('accent', 'orange'));
    expect(html().getAttribute('data-accent')).toBe('orange');
    expect(result.current.prefs.accent).toBe('orange');
  });
});

describe('ThemeProvider — optimistic layer reconciliation', () => {
  it('reconciles a confirmed session override so a later props change is not masked', () => {
    const { box, rerenderWith } = renderControllable({ userPrefs: { accent: 'rose' } });

    // Optimistic override wins immediately.
    act(() => box.current.setPref('accent', 'orange'));
    expect(box.current.resolved.accent).toBe('orange');

    // Server persists it; the bootstrap refetch delivers the same value as a prop.
    rerenderWith({ userPrefs: { accent: 'orange' } });
    expect(box.current.resolved.accent).toBe('orange');

    // A later authoritative change (admin default, another device, a reset
    // elsewhere) must win — the reconciled session entry no longer masks it.
    rerenderWith({ userPrefs: { accent: 'violet' } });
    expect(box.current.resolved.accent).toBe('violet');
    expect(html().getAttribute('data-accent')).toBe('violet');
  });

  it('keeps an in-flight session override when a differing props value arrives', () => {
    const { box, rerenderWith } = renderControllable({ userPrefs: { accent: 'rose' } });

    // Optimistic override, not yet confirmed by the server.
    act(() => box.current.setPref('accent', 'orange'));

    // An unrelated refetch delivers a value that is NOT the user's choice; the
    // optimistic value must keep winning (§4 behavior 4 — no in-flight clobber).
    rerenderWith({ userPrefs: { accent: 'teal' } });
    expect(box.current.resolved.accent).toBe('orange');
  });

  it('preserves an in-flight override across benign re-renders (new object, same values)', () => {
    const { box, rerenderWith } = renderControllable({ userPrefs: { accent: 'rose' } });
    act(() => box.current.setPref('accent', 'orange'));

    // The app root re-derives `userPrefs` into a fresh object on every render;
    // identity churn alone (values unchanged) must not reconcile the override.
    rerenderWith({ userPrefs: { accent: 'rose' } });
    rerenderWith({ userPrefs: { accent: 'rose' } });
    expect(box.current.resolved.accent).toBe('orange');
  });
});

describe('ThemeProvider — clearSessionPref (reset to workspace default)', () => {
  it('drops the override so the axis falls back to the props value', () => {
    // Mirrors the M8 reset flow: the override rides `sessionPrefs` while
    // `userPrefs` holds the (unchanged) workspace default underneath.
    const { box } = renderControllable({ userPrefs: { theme: 'light' } });

    act(() => box.current.setPref('theme', 'dark'));
    expect(box.current.resolved.theme).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');

    // Reset: the server cleared the override; the session entry must go too, or
    // it keeps masking the workspace default until a reload.
    act(() => box.current.clearSessionPref('theme'));
    expect(box.current.resolved.theme).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('drops only the named axis, leaving other session overrides intact', () => {
    const { box } = renderControllable({ userPrefs: { theme: 'light', accent: 'rose' } });

    act(() => {
      box.current.setPref('theme', 'dark');
      box.current.setPref('accent', 'orange');
    });
    act(() => box.current.clearSessionPref('theme'));

    expect(box.current.resolved.theme).toBe('light'); // reset
    expect(box.current.resolved.accent).toBe('orange'); // untouched
  });

  it('is a no-op for an axis with no session override', () => {
    const { box } = renderControllable({ userPrefs: { accent: 'rose' } });
    act(() => box.current.clearSessionPref('accent'));
    expect(box.current.resolved.accent).toBe('rose');
  });
});

describe('ThemeProvider — system theme tracking', () => {
  it('follows prefers-color-scheme changes live while pref is system', () => {
    const media = installMatchMedia({ prefersDark: false });
    const { result } = renderTheme();
    expect(result.current.resolved.theme).toBe('light');

    act(() => media.setPrefersDark(true));
    expect(result.current.resolved.theme).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');

    act(() => media.setPrefersDark(false));
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('detaches the media listener once the pref becomes explicit', () => {
    const media = installMatchMedia({ prefersDark: false });
    const { result } = renderTheme();
    expect(media.listenerCount()).toBe(1);

    act(() => result.current.setPref('theme', 'light'));
    expect(media.listenerCount()).toBe(0);

    // OS flips must no longer affect an explicit pref.
    act(() => media.setPrefersDark(true));
    expect(html().getAttribute('data-theme')).toBe('light');
  });
});

describe('ThemeProvider — localStorage write-back', () => {
  it('writes resolved values (and the theme pref) on mount', () => {
    installMatchMedia({ prefersDark: true });
    renderTheme({ userPrefs: { accent: 'violet', locale: 'ar_EG' } });
    // theme key keeps the pref so `system` round-trips into pre-hydration
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe('system');
    expect(window.localStorage.getItem(STORAGE_KEYS.accent)).toBe('violet');
    expect(window.localStorage.getItem(STORAGE_KEYS.density)).toBe('comfortable');
    expect(window.localStorage.getItem(STORAGE_KEYS.locale)).toBe('ar_EG');
    expect(window.localStorage.getItem(STORAGE_KEYS.dir)).toBe('rtl');
  });

  it('writes through on setPref', () => {
    const { result } = renderTheme();
    act(() => {
      result.current.setPref('theme', 'dark');
      result.current.setPref('density', 'compact');
    });
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe('dark');
    expect(window.localStorage.getItem(STORAGE_KEYS.density)).toBe('compact');
  });
});

describe('ThemeProvider — change hooks', () => {
  it('calls onPrefChange with axis, value and the next prefs', () => {
    const onPrefChange = vi.fn();
    const { result } = renderTheme({ onPrefChange });
    act(() => result.current.setPref('accent', 'black'));
    expect(onPrefChange).toHaveBeenCalledTimes(1);
    expect(onPrefChange).toHaveBeenCalledWith(
      'accent',
      'black',
      expect.objectContaining({ accent: 'black', theme: 'system' }),
    );
  });

  it('notifies subscribeTheme listeners after attributes are committed', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeTheme((resolved) => {
      seen.push(`${resolved.theme}/${resolved.accent}`);
      // attributes already stamped when listeners fire
      expect(html().getAttribute('data-accent')).toBe(resolved.accent);
    });
    try {
      const { result } = renderTheme();
      expect(seen).toEqual(['light/indigo']);
      act(() => result.current.setPref('accent', 'teal'));
      expect(seen).toEqual(['light/indigo', 'light/teal']);
    } finally {
      unsubscribe();
    }
  });

  it('subscribeTheme unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    unsubscribe();
    renderTheme();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('theme hooks outside the provider', () => {
  it('useTheme throws a descriptive error', () => {
    expect(() => renderHook(() => useTheme())).toThrow(
      'useTheme() must be used inside <ThemeProvider>',
    );
  });

  it('useThemePrefs throws a descriptive error', () => {
    expect(() => renderHook(() => useThemePrefs())).toThrow(
      'useThemePrefs() must be used inside <ThemeProvider>',
    );
  });
});

describe('ThemeProvider — direction context', () => {
  it('renders children', () => {
    const { getByText } = render(
      <ThemeProvider>
        <span>child content</span>
      </ThemeProvider>,
    );
    expect(getByText('child content')).toBeDefined();
  });
});
