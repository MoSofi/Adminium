// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Studio half of the deferred-namespace contract (10-T06).
 *
 * `@adminium/i18n`'s own tests prove what `loadNamespaces('studio')` does to
 * an instance. What only this side can prove is the wiring around it: that a
 * Studio route gets the CATALOGUE rather than its inline fallbacks, that the
 * admin's overrides arrive with the compiled text instead of being left
 * behind by a boot path that only fetches the eager namespaces, and that a
 * REBUILT instance reloads — the override layer replaces the instance rather
 * than patching it, so anything memoised per module would report a namespace
 * present on an instance that never loaded it.
 *
 * Real i18next instances, not the test stand-in: the stand-in resolves every
 * namespace synchronously, which is exactly the condition under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, loadLocaleBundle } from '@adminium/i18n';

import { setI18nInstance, t } from '../i18n/t.js';
import { studioMessagesReady } from './studioMessages.js';

const STUDIO_BUNDLE = /\/api\/v1\/i18n\/bundle\/(\w+)\/studio$/;

/** Serves override rows for `de_DE`; every other locale has none. */
function stubBundles(overrides: Record<string, Record<string, string>>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      calls.push(url);
      const match = STUDIO_BUNDLE.exec(url);
      if (match !== null) {
        const locale = match[1] ?? '';
        return Promise.resolve(
          // Top-level, not wrapped in `data`: `apiFetch` returns the body as
          // it comes, and the i18n bundle route replies unenveloped.
          new Response(
            JSON.stringify({ locale, namespace: 'studio', version: 1, overrides: overrides[locale] ?? {} }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
  return calls;
}

describe('studioMessagesReady', () => {
  beforeEach(() => {
    stubBundles({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setI18nInstance(null);
  });

  it('resolves immediately with no instance, so fallback-only tests are unaffected', async () => {
    setI18nInstance(null);
    await expect(studioMessagesReady()).resolves.toBeUndefined();
  });

  it('turns a fallback render into a catalogue render', async () => {
    const i18n = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
    setI18nInstance(i18n);

    // Before: the inline fallback answers. A deliberately wrong one proves
    // which side is talking.
    expect(t('studio:hub.title', 'WRONG')).toBe('WRONG');

    await studioMessagesReady();
    expect(t('studio:hub.title', 'WRONG')).toBe('Data connections');
  });

  it('brings the admin’s overrides with the compiled bundle', async () => {
    const calls = stubBundles({ de_DE: { 'hub.title': 'Datenquellen' } });
    const i18n = await createI18n({ locale: 'de_DE', loadBundle: loadLocaleBundle });
    setI18nInstance(i18n);

    await studioMessagesReady();
    // The compiled German is 'Datenverbindungen'; the override wins, which is
    // only true if the override was applied AFTER the chunk landed.
    expect(t('studio:hub.title', 'WRONG')).toBe('Datenquellen');
    // en-US rides along as the fallback layer, same as the boot path.
    expect(calls).toContain('/api/v1/i18n/bundle/de_DE/studio');
    expect(calls).toContain('/api/v1/i18n/bundle/en_US/studio');
  });

  it('still renders the compiled text when the override route is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const i18n = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
    setI18nInstance(i18n);

    await expect(studioMessagesReady()).resolves.toBeUndefined();
    expect(t('studio:hub.title', 'WRONG')).toBe('Data connections');
  });

  it('is memoised per instance — one load, one fetch pair', async () => {
    const calls = stubBundles({});
    const i18n = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
    setI18nInstance(i18n);

    const first = studioMessagesReady();
    expect(studioMessagesReady()).toBe(first);
    await first;
    await studioMessagesReady();
    expect(calls.filter((u) => STUDIO_BUNDLE.test(u))).toHaveLength(1);
  });

  it('reloads for a rebuilt instance, which is what the override layer produces', async () => {
    const first = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
    setI18nInstance(first);
    await studioMessagesReady();

    // `refreshOverrides` / `resyncOverrides` both swap the instance out.
    const second = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
    setI18nInstance(second);
    expect(second.hasResourceBundle('en-US', 'studio')).toBe(false);
    await studioMessagesReady();
    expect(second.hasResourceBundle('en-US', 'studio')).toBe(true);
  });
});
