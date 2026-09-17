// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pickLocalized` against the two key spaces it actually
 * bridges.
 *
 * THE POINT OF THIS FILE IS THE PAIRING, NOT THE FUNCTION. A unit test that
 * invents its own record proves nothing here, because the defect it replaces
 * was never a logic error — it was `entry.name['en_US']` against a feed whose
 * keys are `en`/`de`/`zh-cn`. So the fixture below is the REAL shape
 * `adminium.dev/marketplace/catalog.json` serves (verified 2026-09-06), and
 * every one of the product's eight locales is asserted against it by name. A
 * ninth locale added to the product, or a feed that changes its key space,
 * fails here rather than in a rail nobody is looking at.
 */
import { describe, expect, it } from 'vitest';

import { pickLocalized } from '../src/add-ons/catalog.js';

/** Verbatim key space of the live feed (six add-ons all carry exactly these). */
const FEED_NAME = {
  en: 'Barcode Labels',
  de: 'Barcode-Etiketten',
  fr: 'Étiquettes code-barres',
  cs: 'Čárové kódy',
  da: 'Stregkodeetiketter',
  'zh-cn': '条形码标签',
  'zh-tw': '條碼標籤',
  ar: 'ملصقات الباركود',
};

/** The product's own locale ids, exactly as `userPrefs.locale` stores them. */
const PRODUCT_LOCALES = ['en_US', 'de_DE', 'fr_FR', 'cs_CZ', 'da_DK', 'zh_CN', 'zh_TW', 'ar_EG'];

describe('pickLocalized', () => {
  it('resolves every product locale against the real feed key space', () => {
    expect(PRODUCT_LOCALES.map((locale) => pickLocalized(FEED_NAME, locale))).toEqual([
      'Barcode Labels',
      'Barcode-Etiketten',
      'Étiquettes code-barres',
      'Čárové kódy',
      'Stregkodeetiketter',
      '条形码标签',
      '條碼標籤',
      'ملصقات الباركود',
    ]);
  });

  it('never falls through to English for a locale the feed carries', () => {
    // The regression in one assertion: `entry.name['en_US']` answered undefined
    // for ALL eight, and the caller's `?? key` then printed the slug.
    for (const locale of PRODUCT_LOCALES.filter((one) => one !== 'en_US')) {
      expect(pickLocalized(FEED_NAME, locale)).not.toBe(FEED_NAME.en);
    }
  });

  it('needs the normalised-tag leg for Chinese, not just the language subtag', () => {
    // `zh` is not a key any feed row carries, so leg 3 alone would hand both
    // Simplified and Traditional readers the English string.
    expect(pickLocalized(FEED_NAME, 'zh_CN')).toBe('条形码标签');
    expect(pickLocalized(FEED_NAME, 'zh_TW')).toBe('條碼標籤');
    expect(pickLocalized({ en: 'x' }, 'zh_CN')).toBe('x');
  });

  it('prefers an exact key when a feed does carry the product tag', () => {
    expect(pickLocalized({ en_US: 'exact', en: 'language' }, 'en_US')).toBe('exact');
  });

  it('treats an empty string as a missing translation, not a name', () => {
    expect(pickLocalized({ de: '', en: 'Barcode Labels' }, 'de_DE')).toBe('Barcode Labels');
  });

  it('returns null when nothing matches, leaving the fallback to the caller', () => {
    expect(pickLocalized({ fr: 'Étiquettes' }, 'de_DE')).toBeNull();
    expect(pickLocalized({}, 'en_US')).toBeNull();
    expect(pickLocalized(undefined, 'en_US')).toBeNull();
  });
});
