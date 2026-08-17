// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app translator keeps the stub's `t(key, fallback)` contract
 * (10-i18n-theming.md M8 assignment): before init it returns the fallback
 * verbatim (unit tests, pre-boot); after `initDashboardI18n` it resolves
 * through the i18next bundles with ICU args, falling back per the chain.
 *
 * The i18next-backed cases skip until @adminium/i18n's runtime deps are
 * installed (workspace integration step); the fallback contract and the
 * ICU-lite test stand-in are always exercised.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installTestI18n } from './testing.js';
import { setI18nInstance, t } from './t.js';

// Resolves once i18next (+ icu) are installed for @adminium/i18n; the page
// tests use the dep-free stand-in either way.
const i18nRuntime = await import('@adminium/i18n').then(
  (mod) => mod,
  () => null,
);

afterEach(() => {
  setI18nInstance(null);
  window.localStorage.clear();
});

describe('t() fallback contract (no runtime)', () => {
  it('returns the fallback verbatim before init (stub behavior)', () => {
    expect(t('account.title', 'Account fallback')).toBe('Account fallback');
    expect(t('no.such.key', 'plain text')).toBe('plain text');
  });

  it('the test stand-in resolves real en-US keys with ICU-lite args', () => {
    const restore = installTestI18n();
    expect(t('account.title', 'different fallback')).toBe('Account');
    expect(t('ui:action.cancel', 'x')).toBe('Cancel');
    expect(
      t('settings.defaults.adoption', '{following} of {total} users', { following: 1, total: 1 }),
    ).toBe('1 of 1 user follow this default.');
    restore();
  });
});

describe.skipIf(i18nRuntime === null)('t() backed by the real i18next runtime', () => {
  it('resolves bundle text over the fallback after init', async () => {
    setI18nInstance(await i18nRuntime!.createI18n({ locale: 'en_US' }));
    expect(t('account.title', 'different fallback')).toBe('Account');
    expect(t('ui:action.cancel', 'x')).toBe('Cancel');
    expect(t('missing.key', 'plain fallback', { name: 'Ava' })).toBe('plain fallback');
  });

  it('formats ICU args', async () => {
    setI18nInstance(await i18nRuntime!.createI18n({ locale: 'en_US' }));
    expect(
      t('settings.defaults.adoption', '{following} of {total} users', { following: 8, total: 12 }),
    ).toBe('8 of 12 users follow this default.');
  });

  it('initDashboardI18n boots from the cached locale and wires the module translator', async () => {
    const { initDashboardI18n } = await import('./setup.js');
    window.localStorage.setItem('adminium-locale', 'en_US');
    const i18n = await initDashboardI18n();
    expect(i18n.language).toBe('en-US');
    expect(t('account.preferences.title', 'x')).toBe('Preferences');
  });

  it('loads real locale bundles through the package lazy loader (M8-T02)', async () => {
    const { initDashboardI18n } = await import('./setup.js');
    const i18n = await initDashboardI18n({ locale: 'de_DE' });
    expect(i18n.language).toBe('de-DE');
    expect(t('account.title', 'x')).toBe('Konto');
    expect(t('ui:action.cancel', 'x')).toBe('Abbrechen');
  });

  it('serves all 8 locales, including RTL Arabic and distinct zh variants', async () => {
    const { initDashboardI18n } = await import('./setup.js');
    const ar = await initDashboardI18n({ locale: 'ar_EG' });
    expect(ar.language).toBe('ar-EG');
    expect(t('account.title', 'x')).toBe('الحساب');
    await initDashboardI18n({ locale: 'zh_CN' });
    expect(t('generated:app.title', 'x')).toBe('仪表盘');
    await initDashboardI18n({ locale: 'zh_TW' });
    expect(t('generated:app.title', 'x')).toBe('儀表板');
  });

  it('still falls back to en-US for keys a locale bundle lacks', async () => {
    setI18nInstance(
      await i18nRuntime!.createI18n({
        locale: 'de_DE',
        loadBundle: async (tag, ns) => (ns === 'common' ? null : i18nRuntime!.loadLocaleBundle(tag, ns)),
      }),
    );
    expect(t('account.title', 'x')).toBe('Account');
    expect(t('ui:action.cancel', 'x')).toBe('Abbrechen');
  });
});
