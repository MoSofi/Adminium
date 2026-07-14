/**
 * Runtime factory tests (10-i18n-theming.md §2.3, §2.5): ICU plurals/args,
 * the missing-key fallback chain (locale → en-US → defaultValue), lazy bundle
 * loading, and the preloaded live locale switch.
 */
import { describe, expect, it, vi } from 'vitest';

import { createI18n, switchLocale } from './create-i18n.js';
import { loadLocaleBundle } from './resources/lazy.js';

const DE_COMMON = {
  greeting: 'Hallo {name}',
  tables: '{count, plural, one {Wir haben # Tabelle gefunden} other {Wir haben # Tabellen gefunden}}',
};

describe('createI18n', () => {
  it('starts in the requested locale with the bundled en-US resources', async () => {
    const i18n = await createI18n({ locale: 'en_US' });
    expect(i18n.language).toBe('en-US');
    expect(i18n.t('account.title')).toBe('Account');
    // ui/errors namespaces resolve via the ns: prefix.
    expect(i18n.t('ui:action.cancel')).toBe('Cancel');
    expect(i18n.t('errors:NOT_FOUND')).toBe('That resource doesn’t exist or was removed.');
  });

  it('formats ICU plurals and arguments', async () => {
    const i18n = await createI18n({
      locale: 'en_US',
      resources: {
        'en-US': {
          common: {
            tables: '{count, plural, one {We found # table} other {We found # tables}}',
            hello: 'Hello {name}',
          },
        },
      },
    });
    expect(i18n.t('tables', { count: 1 })).toBe('We found 1 table');
    expect(i18n.t('tables', { count: 8 })).toBe('We found 8 tables');
    expect(i18n.t('hello', { name: 'Ava' })).toBe('Hello Ava');
  });

  it('formats the settings adoption message with plural + number args', async () => {
    const i18n = await createI18n({ locale: 'en_US' });
    expect(i18n.t('settings.defaults.adoption', { following: 8, total: 12 })).toBe(
      '8 of 12 users follow this default.',
    );
    expect(i18n.t('settings.defaults.adoption', { following: 1, total: 1 })).toBe(
      '1 of 1 user follow this default.',
    );
  });

  it('falls back locale → en-US → defaultValue (§6.2 chain semantics)', async () => {
    const i18n = await createI18n({
      locale: 'de_DE',
      resources: { 'de-DE': { common: DE_COMMON } },
    });
    // Present in de.
    expect(i18n.t('greeting', { name: 'Ava' })).toBe('Hallo Ava');
    // Missing in de → bundled en-US text.
    expect(i18n.t('account.title')).toBe('Account');
    // Missing everywhere → provided fallback.
    expect(i18n.t('not.a.key', { defaultValue: 'Fallback copy' })).toBe('Fallback copy');
  });

  it('reports missing keys through onMissingKey', async () => {
    const onMissingKey = vi.fn();
    const i18n = await createI18n({ locale: 'en_US', onMissingKey });
    i18n.t('definitely.missing', { defaultValue: 'x' });
    expect(onMissingKey).toHaveBeenCalled();
    const call = onMissingKey.mock.calls[0] as [string, string, string];
    expect(call[1]).toBe('common');
    expect(call[2]).toBe('definitely.missing');
  });

  it('loads lazy bundles through loadBundle and switches without a half-translated frame', async () => {
    const loadBundle = vi.fn(async (tag: string, ns: string) => {
      if (tag === 'de-DE' && ns === 'common') return DE_COMMON;
      return null;
    });
    const i18n = await createI18n({ locale: 'en_US', loadBundle });
    expect(i18n.t('greeting', { name: 'Ava', defaultValue: 'missing' })).toBe('missing');

    await switchLocale(i18n, 'de_DE');
    expect(i18n.language).toBe('de-DE');
    // The de bundle was preloaded before changeLanguage resolved.
    expect(i18n.t('greeting', { name: 'Ava' })).toBe('Hallo Ava');
    expect(i18n.t('tables', { count: 1 })).toBe('Wir haben 1 Tabelle gefunden');
    // en-US remains the fallback for keys the lazy bundle lacks.
    expect(i18n.t('account.title')).toBe('Account');
    expect(loadBundle).toHaveBeenCalledWith('de-DE', 'common');
  });

  it('degrades to en-US when a locale has no bundles at all', async () => {
    const i18n = await createI18n({ locale: 'cs_CZ', loadBundle: async () => null });
    expect(i18n.language).toBe('cs-CZ');
    expect(i18n.t('account.title')).toBe('Account');
  });

  it('switchLocale is a no-op for the active locale', async () => {
    const loadBundle = vi.fn(async () => null);
    const i18n = await createI18n({ locale: 'en_US', loadBundle });
    loadBundle.mockClear();
    await switchLocale(i18n, 'en_US');
    expect(loadBundle).not.toHaveBeenCalled();
  });
});

describe('real locale bundles through loadLocaleBundle', () => {
  it('serves the shipped bundles and keeps en-US chunk-free (loader returns null)', async () => {
    expect(await loadLocaleBundle('en-US', 'common')).toBeNull();
    const de = await loadLocaleBundle('de-DE', 'common');
    expect(de).not.toBeNull();
  });

  it('renders German after a live switch', async () => {
    const i18n = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
    await switchLocale(i18n, 'de_DE');
    expect(i18n.t('account.title')).toBe('Konto');
    expect(i18n.t('ui:action.cancel')).toBe('Abbrechen');
    expect(i18n.t('errors:CONNECTION_FAILED')).toBe('Adminium konnte die Datenbank nicht erreichen.');
  });

  it('applies Czech plural categories (one/few/many/other)', async () => {
    const i18n = await createI18n({ locale: 'cs_CZ', loadBundle: loadLocaleBundle });
    // 1 → one (genitive sg), 2 → few, 5 → other.
    expect(i18n.t('settings.defaults.adoption', { following: 1, total: 1 })).toContain('1 uživatele');
    expect(i18n.t('settings.defaults.adoption', { following: 2, total: 2 })).toContain('2 uživatelů');
    expect(i18n.t('settings.defaults.adoption', { following: 3, total: 5 })).toContain('5 uživatelů');
  });

  it('applies the six Arabic plural categories', async () => {
    const i18n = await createI18n({ locale: 'ar_EG', loadBundle: loadLocaleBundle });
    expect(i18n.t('settings.defaults.adoption', { following: 1, total: 1 })).toContain('مستخدم واحد');
    expect(i18n.t('settings.defaults.adoption', { following: 2, total: 2 })).toContain('مستخدمَين');
    expect(i18n.t('settings.defaults.adoption', { following: 3, total: 5 })).toContain('مستخدمين');
    expect(i18n.t('settings.defaults.adoption', { following: 10, total: 15 })).toContain('مستخدمًا');
  });

  it('keeps zh_CN and zh_TW independent at runtime', async () => {
    const cn = await createI18n({ locale: 'zh_CN', loadBundle: loadLocaleBundle });
    const tw = await createI18n({ locale: 'zh_TW', loadBundle: loadLocaleBundle });
    expect(cn.t('generated:app.title')).toBe('仪表盘');
    expect(tw.t('generated:app.title')).toBe('儀表板');
    expect(cn.t('ui:action.save')).toBe('保存');
    expect(tw.t('ui:action.save')).toBe('儲存');
  });
});
