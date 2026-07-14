/**
 * Locale registry tests (10-i18n-theming.md §2.1): the 8 BRIEF locales with
 * native names, derived direction, tags, and the tag → id inverse mapping.
 */
import { describe, expect, it } from 'vitest';

import {
  LOCALES,
  LOCALE_IDS,
  dirForLocale,
  isLocaleId,
  isRtlLocale,
  localeEntry,
  localeFromTag,
  tagForLocale,
} from './locales.js';

describe('locale registry', () => {
  it('contains exactly the 8 BRIEF locales', () => {
    expect(LOCALE_IDS).toEqual(['en_US', 'de_DE', 'fr_FR', 'cs_CZ', 'da_DK', 'zh_CN', 'zh_TW', 'ar_EG']);
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

  it('guards unknown ids', () => {
    expect(isLocaleId('en_US')).toBe(true);
    expect(isLocaleId('he_IL')).toBe(false);
    expect(() => localeEntry('nope' as never)).toThrow(/unknown locale/);
  });
});
