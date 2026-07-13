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
