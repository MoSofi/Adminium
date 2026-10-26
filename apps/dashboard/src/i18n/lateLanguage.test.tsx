// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The reader's language lands after boot, and the words follow it everywhere.
 *
 * A new browser boots its strings in the browser's language; the session says
 * the reader reads German a moment later (ThemeProvider → `subscribeTheme`).
 * Meanwhile boot rebuilds the instance with the owner's overrides
 * (`refreshOverrides`), which swaps in a NEW instance. Two ways that went wrong:
 *
 * 1. the rebuild was made in the BOOT language and could land after the switch:
 *    every `t()` then read English, and nothing switched it back until a reload;
 * 2. the React provider kept the boot instance, so a switch (made on the live
 *    one) never reached what reads its words through the provider — every
 *    widget's chrome.
 */
import { createI18n, loadLocaleBundle, switchLocale } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveI18nProvider } from './LiveI18nProvider.js';
import { clearOverrideCache } from './overrideCache.js';
import { initDashboardI18n } from './setup.js';
import { getI18nInstance, setI18nInstance, t } from './t.js';

type ThemeListener = (theme: { locale: string }) => void;
const themeListeners = vi.hoisted(() => [] as ThemeListener[]);

vi.mock('@adminium/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@adminium/ui')>()),
  subscribeTheme: (listener: ThemeListener) => {
    themeListeners.push(listener);
    return () => undefined;
  },
}));

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as unknown as Response;
}

/** Serves the manifest and empty override bundles; nothing answers until `release()`. */
function holdOverrides(): { release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      await gate;
      if (path.endsWith('/api/v1/i18n/manifest')) return jsonResponse({ version: 3, locales: [] });
      const bundle = /\/api\/v1\/i18n\/bundle\/([^/]+)\/([^/]+)$/.exec(path);
      if (bundle !== null) return jsonResponse({ locale: bundle[1], namespace: bundle[2], version: 3, overrides: {} });
      throw new Error(`unexpected request: ${path}`);
    }),
  );
  return { release };
}

/** What ThemeProvider does once the session says the reader's language. */
function sessionSays(locale: string): void {
  for (const listener of themeListeners) listener({ locale });
}

afterEach(() => {
  themeListeners.length = 0;
  setI18nInstance(null);
  clearOverrideCache();
  vi.unstubAllGlobals();
});

describe('a language that lands after boot', () => {
  it('survives the boot-time override rebuild landing after the switch', async () => {
    const { release } = holdOverrides();
    const boot = await initDashboardI18n({ locale: 'en_US' });

    // The switch lands first…
    sessionSays('de_DE');
    await vi.waitFor(() => expect(boot.language).toBe('de-DE'));
    expect(t('account.title', 'Account')).toBe('Konto');

    // …then the rebuild that boot asked for.
    release();
    await vi.waitFor(() => expect(getI18nInstance()).not.toBe(boot));

    await vi.waitFor(() => expect(getI18nInstance()?.language).toBe('de-DE'));
    expect(t('account.title', 'Account')).toBe('Konto');
  });

  it('reaches what reads its words through the provider, after the instance was rebuilt', async () => {
    const { release } = holdOverrides();
    const boot = await initDashboardI18n({ locale: 'en_US' });
    function Chrome() {
      const say = useMaybeT();
      return <p>{say('account.title', 'Account')}</p>;
    }
    render(
      <LiveI18nProvider>
        <Chrome />
      </LiveI18nProvider>,
    );
    expect(screen.getByText('Account')).toBeTruthy();

    // The rebuild lands first; the reader then switches (the menu acts on the live instance).
    release();
    await vi.waitFor(() => expect(getI18nInstance()).not.toBe(boot));
    await act(() => switchLocale(getI18nInstance()!, 'de_DE'));

    expect(await screen.findByText('Konto')).toBeTruthy();
  });

  it('a stand-in instance set by a test is what the provider hands down', async () => {
    setI18nInstance(await createI18n({ locale: 'de_DE', loadBundle: loadLocaleBundle }));
    function Chrome() {
      const say = useMaybeT();
      return <p>{say('account.title', 'Account')}</p>;
    }
    render(
      <LiveI18nProvider>
        <Chrome />
      </LiveI18nProvider>,
    );
    expect(screen.getByText('Konto')).toBeTruthy();
  });
});
