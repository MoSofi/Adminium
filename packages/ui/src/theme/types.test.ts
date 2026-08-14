/**
 * Direction/lang derivation for the locale axis (23-runtime-translations.md
 * §5.4, §5.5).
 *
 * These are the helpers that had to stop assuming the eight compiled locales
 * are the only ones that exist. ThemeProvider's own suite drives them through
 * a mounted provider; this file pins the resolution table itself, where the
 * precedence between the four tiers is actually decided.
 */
import { describe, expect, it, vi } from 'vitest';

import * as themeBarrel from './index.js';
import { LOCALES, builtinLocaleDir, dirForLocale, langForLocale } from './types.js';

describe('theme barrel', () => {
  it('publishes the direction helpers', () => {
    // `builtinLocaleDir` shipped in 23 §5.4 but was left out of this barrel,
    // so the only way to reach it was a deep path into `types.js`. It answers
    // a question callers outside this package genuinely have — "is this one of
    // the eight, and which way does it run?" — so it stays exported.
    expect(themeBarrel.builtinLocaleDir).toBe(builtinLocaleDir);
    expect(themeBarrel.dirForLocale).toBe(dirForLocale);
    expect(themeBarrel.langForLocale).toBe(langForLocale);
  });
});

describe('builtinLocaleDir', () => {
  it('answers rtl for ar_EG and ltr for the other seven compiled locales', () => {
    expect(builtinLocaleDir('ar_EG')).toBe('rtl');
    for (const locale of LOCALES.filter((id) => id !== 'ar_EG')) {
      expect(builtinLocaleDir(locale)).toBe('ltr');
    }
  });

  it('returns null — not a direction — for anything it does not compile in', () => {
    // The null is load-bearing: `dirForLocale` distinguishes "known to be ltr"
    // from "unknown", and only the second defers to the cached axis. Answering
    // 'ltr' here would make every custom RTL locale flash on pre-auth screens.
    expect(builtinLocaleDir('he_IL')).toBeNull();
    expect(builtinLocaleDir('fa_IR')).toBeNull();
    expect(builtinLocaleDir('klingon')).toBeNull();
    expect(builtinLocaleDir('')).toBeNull();
  });

  it('matches ids exactly, without case folding', () => {
    expect(builtinLocaleDir('AR_EG')).toBeNull();
    expect(builtinLocaleDir('ar-EG')).toBeNull();
  });
});

describe('dirForLocale — four-tier precedence', () => {
  it('1. an injected resolver outranks the compiled table', () => {
    // The app's resolver is backed by the runtime registry, which is the only
    // source that knows an admin re-declared a locale's direction.
    expect(dirForLocale('ar_EG', { resolve: () => 'ltr' })).toBe('ltr');
    expect(dirForLocale('en_US', { resolve: () => 'rtl', cached: 'ltr' })).toBe('rtl');
  });

  it('the resolver is asked for the locale actually being resolved', () => {
    const resolve = vi.fn(() => 'rtl' as const);
    expect(dirForLocale('he_IL', { resolve })).toBe('rtl');
    expect(resolve).toHaveBeenCalledWith('he_IL');
  });

  it('2. a resolver that declines (null) falls through to the compiled table', () => {
    expect(dirForLocale('ar_EG', { resolve: () => null })).toBe('rtl');
    expect(dirForLocale('de_DE', { resolve: () => null, cached: 'rtl' })).toBe('ltr');
  });

  it('the compiled table outranks the cached axis', () => {
    // A stale cached 'rtl' must not survive a switch to a compiled LTR locale.
    expect(dirForLocale('de_DE', { cached: 'rtl' })).toBe('ltr');
    expect(dirForLocale('ar_EG', { cached: 'ltr' })).toBe('rtl');
  });

  it('3. the cached axis answers for a locale no tier above it knows', () => {
    expect(dirForLocale('he_IL', { cached: 'rtl' })).toBe('rtl');
    expect(dirForLocale('he_IL', { resolve: () => null, cached: 'rtl' })).toBe('rtl');
  });

  it('4. ltr is the floor — the function is total, never undefined', () => {
    expect(dirForLocale('he_IL')).toBe('ltr');
    expect(dirForLocale('he_IL', {})).toBe('ltr');
    expect(dirForLocale('he_IL', { resolve: () => null, cached: undefined })).toBe('ltr');
    expect(dirForLocale('')).toBe('ltr');
  });

  it('resolves the compiled table with no options at all', () => {
    expect(dirForLocale('ar_EG')).toBe('rtl');
    expect(dirForLocale('en_US')).toBe('ltr');
  });
});

describe('langForLocale', () => {
  it('converts the canonical id to a BCP-47 tag', () => {
    expect(langForLocale('en_US')).toBe('en-US');
    expect(langForLocale('ar_EG')).toBe('ar-EG');
    expect(langForLocale('zh_CN')).toBe('zh-CN');
  });

  it('replaces EVERY underscore, not just the first', () => {
    // 23 §5.5. A single `.replace('_', '-')` leaves `zh-Hant_TW`, which is not
    // a valid tag — it would reach the `lang` attribute and `Intl`, where an
    // invalid tag degrades silently to en-US.
    expect(langForLocale('zh_Hant_TW')).toBe('zh-Hant-TW');
    expect(langForLocale('sr_Latn_RS')).toBe('sr-Latn-RS');
  });

  it('emits tags Intl actually accepts', () => {
    for (const locale of [...LOCALES, 'zh_Hant_TW']) {
      expect(() => Intl.getCanonicalLocales(langForLocale(locale))).not.toThrow();
    }
  });

  it('leaves an id with no region untouched', () => {
    expect(langForLocale('en')).toBe('en');
  });
});
