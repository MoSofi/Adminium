// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `resyncOverrides()` locale resolution (23-runtime-translations.md §4.4).
 *
 * Regression guard for the fix that made it read the locale off the LIVE i18n
 * instance instead of accepting one from the caller. Every call site had the
 * same handle to offer — `bootstrap.prefs.locale`, the value the bootstrap
 * query last returned — which is not necessarily the locale the user is
 * reading: the locale axis moves through ThemeProvider, and the bootstrap
 * query does not refetch on a locale switch. Resyncing at the wrong locale
 * refetches another locale's overrides and installs them under the active
 * language, so an admin's customisations silently disappear.
 *
 * The seam is `fetch`, not `./overrides.js`: mocking the module would only
 * replay the locale this test passed in, whereas the whole question is which
 * locale reaches the wire. Asserting on the requested URL answers it directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n, loadLocaleBundle } from '@adminium/i18n';

import { resyncOverrides } from './setup.js';
import { clearOverrideCache } from './overrideCache.js';
import { getI18nInstance, setI18nInstance, t } from './t.js';

const DE_COMMON = '/api/v1/i18n/bundle/de_DE/common';
const EN_COMMON = '/api/v1/i18n/bundle/en_US/common';

/** A manifest locale row — only the shape matters here. */
function manifestLocale(locale: string) {
  const tag = locale.replaceAll('_', '-');
  return {
    locale,
    tag,
    english: locale,
    native: locale,
    dir: 'ltr',
    fontHint: 'latin',
    intlTag: tag,
    pluralCategories: ['one', 'other'],
    builtin: true,
    enabled: true,
    sortOrder: 0,
    overrideCount: 0,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/**
 * Serve the i18n manifest + override bundles, recording every path requested.
 * `overrides` is keyed `"<locale>/<namespace>"`; anything unlisted serves an
 * empty override set, exactly as a locale with no customisations would.
 */
function installFetch(overrides: Record<string, Record<string, string>> = {}) {
  const paths: string[] = [];
  const version = 7; // any value ≠ the empty cache's -1, so the resync proceeds
  // `stubGlobal`, not a bare assignment: `unstubAllGlobals` in afterEach is
  // what puts the real fetch back, so a stray request in a later test in this
  // worker fails loudly instead of landing in this recorder.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      paths.push(path);
      if (path.endsWith('/api/v1/i18n/manifest')) {
        return jsonResponse({
          version,
          locales: [manifestLocale('en_US'), manifestLocale('de_DE')],
        });
      }
      const bundle = /\/api\/v1\/i18n\/bundle\/([^/]+)\/([^/]+)$/.exec(path);
      if (bundle !== null) {
        const [, locale, namespace] = bundle;
        return jsonResponse({
          locale,
          namespace,
          version,
          overrides: overrides[`${locale}/${namespace}`] ?? {},
        });
      }
      throw new Error(`unexpected request: ${path}`);
    }),
  );
  return { paths, bundlePaths: (): string[] => paths.filter((p) => p.includes('/bundle/')) };
}

/** The live instance the user is actually reading, in German. */
async function bootGerman(): Promise<void> {
  setI18nInstance(await createI18n({ locale: 'de_DE', loadBundle: loadLocaleBundle }));
  expect(t('account.title', 'x')).toBe('Konto');
}

const GERMAN_OVERRIDE = { 'de_DE/common': { 'account.title': 'Benutzerkonto' } };

afterEach(() => {
  setI18nInstance(null);
  clearOverrideCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resyncOverrides — locale comes from the live instance', () => {
  it('resyncs the locale being read, not the one bootstrap last returned', async () => {
    // The divergence the fix is about: the session reads de_DE while
    // `bootstrap.prefs.locale` — the only locale a call site could have
    // supplied — still says en_US.
    await bootGerman();
    const { paths, bundlePaths } = installFetch(GERMAN_OVERRIDE);

    await resyncOverrides();

    // The de_DE overrides endpoint is the one that was fetched…
    expect(paths).toContain(DE_COMMON);
    // …and installed: the rebuilt instance is still German and carries the
    // admin's copy, not the compiled 'Konto'.
    expect(getI18nInstance()?.language).toBe('de-DE');
    expect(t('account.title', 'x')).toBe('Benutzerkonto');

    // en_US rides along as the fallback layer (fetchOverrides always adds it),
    // so its presence is expected — what must not happen is en_US INSTEAD of
    // de_DE, which is exactly the buggy shape.
    expect(bundlePaths()).toContain(EN_COMMON);
    expect(bundlePaths().some((p) => p.includes('/bundle/de_DE/'))).toBe(true);
  });

  it('ignores a caller-supplied locale (the pre-fix call shape)', async () => {
    await bootGerman();
    const { paths } = installFetch(GERMAN_OVERRIDE);

    // Verbatim the old call: `resyncOverrides(bootstrap.prefs.locale)`. The
    // cast is the point — the parameter is gone, and passing one anyway must
    // not steer the resync.
    await (resyncOverrides as unknown as (locale: string) => Promise<void>)('en_US');

    expect(paths).toContain(DE_COMMON);
    expect(getI18nInstance()?.language).toBe('de-DE');
    expect(t('account.title', 'x')).toBe('Benutzerkonto');
  });

  it('leaves the instance alone when the server has nothing new', async () => {
    await bootGerman();
    const before = getI18nInstance();
    // A resync that finds no version bump must not rebuild — the shell fires
    // this on every reconnect and every visibilitychange.
    installFetch(GERMAN_OVERRIDE);
    await resyncOverrides(); // primes the cache at version 7
    const rebuilt = getI18nInstance();
    expect(rebuilt).not.toBe(before);

    installFetch(GERMAN_OVERRIDE); // same version, fresh recorder
    await resyncOverrides();
    expect(getI18nInstance()).toBe(rebuilt);
  });

  it('is a no-op before i18n has booted', async () => {
    setI18nInstance(null);
    const { paths } = installFetch(GERMAN_OVERRIDE);
    await resyncOverrides();
    // No live instance means no locale to resolve — it must not guess en_US.
    expect(paths).toEqual([]);
    expect(getI18nInstance()).toBeNull();
  });
});
