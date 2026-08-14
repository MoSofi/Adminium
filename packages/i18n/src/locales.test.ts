/**
 * Locale registry tests (10-i18n-theming.md §2.1): the 8 BRIEF locales with
 * native names, derived direction, tags, and the tag → id inverse mapping.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_LOCALE_IDS,
  LOCALES,
  allLocales,
  availableLocales,
  dirForLocale,
  intlTagForLocale,
  isBuiltinLocaleId,
  isLocaleId,
  isRtlLocale,
  localeEntry,
  localeFromTag,
  pluralCategoriesForLocale,
  resetRuntimeLocales,
  setRuntimeLocales,
  tagForLocale,
  tagFromLocaleId,
} from './locales.js';

describe('locale registry', () => {
  afterEach(() => {
    resetRuntimeLocales();
  });

  it('compiles exactly the 8 BRIEF locales', () => {
    expect(BUILTIN_LOCALE_IDS).toEqual(['en_US', 'de_DE', 'fr_FR', 'cs_CZ', 'da_DK', 'zh_CN', 'zh_TW', 'ar_EG']);
  });

  it('carries native names and font hints', () => {
    expect(localeEntry('de_DE').native).toBe('Deutsch');
    expect(localeEntry('zh_TW').native).toBe('繁體中文');
    expect(localeEntry('ar_EG').fontHint).toBe('arabic');
    expect(localeEntry('zh_CN').fontHint).toBe('cjk');
    expect(localeEntry('en_US').fontHint).toBe('latin');
  });

  it('derives dir from the registry — rtl iff ar_EG today', () => {
    for (const locale of LOCALES) {
      expect(dirForLocale(locale.id)).toBe(locale.id === 'ar_EG' ? 'rtl' : 'ltr');
    }
    expect(isRtlLocale('ar_EG')).toBe(true);
    expect(isRtlLocale('en_US')).toBe(false);
  });

  it('maps ids to BCP-47 tags and back', () => {
    expect(tagForLocale('ar_EG')).toBe('ar-EG');
    expect(localeFromTag('ar-EG')).toBe('ar_EG');
    expect(localeFromTag('de')).toBe('de_DE');
    expect(localeFromTag('xx-YY')).toBe('en_US');
  });

  // 23 §5.1/§5.2. `isLocaleId` is a SHAPE check and `isBuiltinLocaleId` the
  // membership check — the split exists because a cached preference may name
  // a locale this build does not compile in, and rejecting it would strand
  // that user on en-US.
  it('separates shape from compiled membership', () => {
    expect(isLocaleId('en_US')).toBe(true);
    expect(isLocaleId('he_IL')).toBe(true);
    expect(isLocaleId('zh_Hant_TW')).toBe(true);
    expect(isLocaleId('not a locale')).toBe(false);
    expect(isLocaleId('')).toBe(false);

    expect(isBuiltinLocaleId('en_US')).toBe(true);
    expect(isBuiltinLocaleId('he_IL')).toBe(false);
  });

  // 23 §5.2. These helpers run inside a theme subscriber. `emitTheme` isolates
  // each listener now, so a throw is no longer a white screen — it is a locale
  // switch that stamps `dir`/`lang` and then abandons the string swap, which
  // nothing on screen explains. The orphan id (deleted locale, restored
  // backup, imported bundle) is the normal aftermath of this feature.
  it('never throws on an id no registry knows', () => {
    expect(() => localeEntry('sw_KE')).not.toThrow();
    expect(tagForLocale('sw_KE')).toBe('sw-KE');
    expect(dirForLocale('sw_KE')).toBe('ltr');
    expect(isRtlLocale('sw_KE')).toBe(false);
  });

  // 23 §5.5. A single-replacement converter leaves `zh-Hant_TW`, which is not
  // a valid BCP-47 tag — and the formatter layer coalesces invalid tags to
  // en-US, silently degrading exactly what `intlTag` exists to prevent.
  it('converts every underscore, not just the first', () => {
    expect(tagFromLocaleId('en_US')).toBe('en-US');
    expect(tagFromLocaleId('zh_Hant_TW')).toBe('zh-Hant-TW');
    expect(() => Intl.getCanonicalLocales(tagFromLocaleId('zh_Hant_TW'))).not.toThrow();
  });

  describe('runtime overlay', () => {
    it('adds a custom locale with its own direction and borrowed Intl tag', () => {
      setRuntimeLocales([
        {
          id: 'he_IL',
          tag: 'he-IL',
          english: 'Hebrew',
          native: 'עברית',
          dir: 'rtl',
          fontHint: 'latin',
          builtin: false,
          enabled: true,
          sortOrder: 1,
          intlTag: 'he-IL',
          pluralCategories: ['one', 'two', 'many', 'other'],
        },
      ]);
      expect(dirForLocale('he_IL')).toBe('rtl');
      expect(isRtlLocale('he_IL')).toBe(true);
      expect(localeEntry('he_IL').native).toBe('עברית');
      expect(localeFromTag('he-IL')).toBe('he_IL');
      expect(intlTagForLocale('he_IL')).toBe('he-IL');
      expect(pluralCategoriesForLocale('he_IL')).toEqual(['one', 'two', 'many', 'other']);
      expect(allLocales().map((l) => l.id)).toContain('he_IL');
    });

    // 23 §3.1 field lock: a built-in row carries enabled/sortOrder ONLY, so an
    // admin cannot flip ar_EG to ltr and corrupt a shipped bundle's rendering.
    it('lets a built-in row change only enabled and order', () => {
      setRuntimeLocales([
        {
          ...LOCALES[7],
          dir: 'ltr',
          native: 'HIJACKED',
          builtin: true,
          enabled: false,
          sortOrder: 9,
          intlTag: 'en-US',
          pluralCategories: ['other'],
        },
      ]);
      expect(dirForLocale('ar_EG')).toBe('rtl');
      expect(localeEntry('ar_EG').native).toBe('العربية (مصر)');
      expect(allLocales().find((l) => l.id === 'ar_EG')?.enabled).toBe(false);
      expect(availableLocales().map((l) => l.id)).not.toContain('ar_EG');
    });

    it('falls back to compiled behaviour when the overlay is empty', () => {
      resetRuntimeLocales();
      expect(availableLocales().map((l) => l.id)).toEqual([...BUILTIN_LOCALE_IDS].sort());
      expect(intlTagForLocale('de_DE')).toBe('de-DE');
    });
  });
});
