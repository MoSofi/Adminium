// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runtime override layer (23 §4.3).
 *
 * The assertions that matter here are the ones the naive implementation gets
 * wrong: en-US overrides must not wipe their namespace, reset must actually
 * restore the built-in, and a blank must render blank rather than falling
 * through to English.
 */
import { describe, expect, it } from 'vitest';

import { createI18nWithOverrides, mergeOverrides } from './overrides.js';
import { loadLocaleBundle } from './resources/lazy.js';

describe('mergeOverrides', () => {
  it('writes a dotted path into a nested clone without touching the source', () => {
    const base = { account: { title: 'Account', subtitle: 'Yours' } };
    const merged = mergeOverrides(base, { 'account.title': 'MY ACCOUNT' });
    expect(merged).toEqual({ account: { title: 'MY ACCOUNT', subtitle: 'Yours' } });
    expect(base.account.title).toBe('Account');
  });

  it('builds a tree from nothing for a locale with no compiled bundle', () => {
    expect(mergeOverrides(null, { 'a.b.c': 'x' })).toEqual({ a: { b: { c: 'x' } } });
  });

  it('keeps an empty value — it is the "render nothing" state, not a deletion', () => {
    expect(mergeOverrides({ a: 'A' }, { a: '' })).toEqual({ a: '' });
  });
});

describe('createI18nWithOverrides', () => {
  it('overrides a bundled en-US key WITHOUT dropping its siblings', async () => {
    // The trap: createI18n's `resources` option replaces a whole namespace, so
    // routing a sparse override through it would delete the other ~1,500
    // `common` keys.
    const i18n = await createI18nWithOverrides({
      locale: 'en_US',
      overrides: { 'en-US': { common: { 'account.title': 'MY ACCOUNT' } } },
    });
    expect(i18n.t('account.title')).toBe('MY ACCOUNT');
    expect(i18n.t('settings.defaults.title')).not.toBe('settings.defaults.title');
    expect(i18n.t('ui:action.cancel')).toBe('Cancel');
  });

  it('overrides a lazily loaded locale and leaves the rest of the bundle intact', async () => {
    const i18n = await createI18nWithOverrides({
      locale: 'de_DE',
      loadBundle: loadLocaleBundle,
      overrides: { 'de-DE': { common: { 'account.title': 'MEIN KONTO' } } },
    });
    expect(i18n.t('account.title')).toBe('MEIN KONTO');
    expect(i18n.t('ui:action.cancel')).toBe('Abbrechen');
  });

  it('renders a blank override as blank rather than falling back to English', async () => {
    const i18n = await createI18nWithOverrides({
      locale: 'de_DE',
      loadBundle: loadLocaleBundle,
      overrides: { 'de-DE': { common: { 'account.title': '' } } },
    });
    expect(i18n.t('account.title')).toBe('');
  });

  // Reset-to-built-in is a DELETE of the row, so it shows up here as the
  // override simply being absent from the next build. This is the operation
  // an `addResourceBundle`-based design provably cannot express.
  it('restores the built-in when the override is gone from the next build', async () => {
    const withOverride = await createI18nWithOverrides({
      locale: 'de_DE',
      loadBundle: loadLocaleBundle,
      overrides: { 'de-DE': { common: { 'account.title': 'MEIN KONTO' } } },
    });
    expect(withOverride.t('account.title')).toBe('MEIN KONTO');

    const afterReset = await createI18nWithOverrides({
      locale: 'de_DE',
      loadBundle: loadLocaleBundle,
      overrides: {},
    });
    expect(afterReset.t('account.title')).toBe('Konto');
  });

  it('serves a custom locale entirely from overrides, falling back to en-US', async () => {
    const i18n = await createI18nWithOverrides({
      locale: 'tlh_KL',
      loadBundle: loadLocaleBundle,
      overrides: { 'tlh-KL': { common: { 'account.title': 'Qapla Account' } } },
    });
    expect(i18n.t('account.title')).toBe('Qapla Account');
    // Untranslated keys fall through the chain to compiled English.
    expect(i18n.t('ui:action.cancel')).toBe('Cancel');
  });
});
