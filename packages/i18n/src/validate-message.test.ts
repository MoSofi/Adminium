// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write-time validation for admin-authored overrides (23 §6.3).
 *
 * These are the assertions that keep a runtime override from doing what the
 * build-time gates can no longer see: rendering raw ICU to users, dropping a
 * placeholder a call site depends on, or writing plural branches the language
 * has no rules for.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { resetRuntimeLocales, setRuntimeLocales } from './locales.js';
import { validateMessage } from './validate-message.js';

const ok = (candidate: string, source: string, locale = 'de_DE'): boolean =>
  validateMessage({ candidate, source, locale }).ok;

const codes = (candidate: string, source: string, locale = 'de_DE'): string[] => {
  const result = validateMessage({ candidate, source, locale });
  return result.ok ? [] : result.errors.map((e) => e.code);
};

describe('validateMessage', () => {
  afterEach(() => {
    resetRuntimeLocales();
  });

  it('accepts a faithful translation', () => {
    expect(ok('Konto', 'Account')).toBe(true);
    expect(ok('Hallo {name}', 'Hello {name}')).toBe(true);
  });

  it('rejects malformed ICU with a message that names the actual problem', () => {
    const unbalanced = validateMessage({
      candidate: 'Hallo {name',
      source: 'Hello {name}',
      locale: 'de_DE',
    });
    expect(unbalanced.ok).toBe(false);
    if (!unbalanced.ok) {
      expect(unbalanced.errors[0]?.code).toBe('ICU_SYNTAX');
      expect(unbalanced.errors[0]?.message).toMatch(/braces/i);
    }

    // The parser rejects a plural with no `other` before any shape check can
    // run, so this arrives as a parse failure — but an admin editing German
    // copy needs to be told WHICH branch is missing, not "invalid ICU".
    const noOther = validateMessage({
      candidate: '{count, plural, one {x}',
      source: '{count, plural, one {x} other {y}}',
      locale: 'de_DE',
    });
    expect(noOther.ok).toBe(false);
    if (!noOther.ok) expect(noOther.errors[0]?.message).toMatch(/"other" branch/);
  });

  it('rejects missing and invented placeholders', () => {
    expect(codes('Hallo', 'Hello {name}')).toContain('ARG_MISMATCH');
    expect(codes('Hallo {name} {extra}', 'Hello {name}')).toContain('ARG_MISMATCH');
  });

  // The literal-token guard (23 §4.6). 48 call sites do their own
  // `.replace('{count}', …)` and pass NO ICU args, so `{count}` must stay a
  // plain placeholder — `{count, number}` passes every name-based check and
  // then renders raw ICU to the user.
  it('rejects a placeholder whose type changed', () => {
    expect(codes('{count, number} Änderungen', '{count} changes')).toContain('ARG_TYPE_MISMATCH');
    expect(codes('{when, date, short}', '{when}')).toContain('ARG_TYPE_MISMATCH');
    expect(ok('{count} Änderungen', '{count} changes')).toBe(true);
  });

  // Bidirectional, matching the compiled parity gate: neither dropping a
  // plural the source has nor inventing one it does not.
  it('rejects plural drift in both directions', () => {
    const source = '{count, plural, one {# table} other {# tables}}';
    expect(codes('{count} Tabellen', source)).toContain('PLURAL_MISMATCH');
    expect(codes('{count, plural, one {# Tabelle} other {# Tabellen}}', source)).toEqual([]);
    expect(codes('{count, plural, one {x} other {y}}', '{count} items')).toContain(
      'PLURAL_MISMATCH',
    );
  });

  it('rejects plural categories the language does not have', () => {
    // German has one/other; `few` is Czech/Arabic vocabulary.
    const source = '{count, plural, one {# item} other {# items}}';
    expect(codes('{count, plural, one {#} few {#} other {#}}', source)).toContain(
      'PLURAL_CATEGORY',
    );
    // Czech does have `few`.
    expect(
      codes('{count, plural, one {#} few {#} other {#}}', source, 'cs_CZ'),
    ).not.toContain('PLURAL_CATEGORY');
  });

  it('requires an other branch', () => {
    const source = '{count, plural, one {# item} other {# items}}';
    const result = codes('{count, plural, one {# Sache}}', source);
    expect(result).toContain('PLURAL_MISSING_OTHER');
  });

  it('treats blank as a state, not a syntax error, only when allowed', () => {
    expect(validateMessage({ candidate: '', source: 'Account', locale: 'de_DE' }).ok).toBe(false);
    expect(
      validateMessage({ candidate: '', source: 'Account', locale: 'de_DE', allowEmpty: true }).ok,
    ).toBe(true);
  });

  it('does not block an admin on a broken en-US source', () => {
    // A malformed SOURCE is a repo bug the admin cannot fix; refusing their
    // override would strand the key.
    expect(ok('Gültig', 'Broken {source')).toBe(true);
  });

  // A custom locale validates against its FROZEN categories, so the browser's
  // ICU and Node's cannot disagree about what is acceptable (23 §5.6).
  it('validates a custom locale against its frozen plural categories', () => {
    setRuntimeLocales([
      {
        id: 'tlh_KL',
        tag: 'tlh-KL',
        english: 'Klingon',
        native: 'tlhIngan Hol',
        dir: 'ltr',
        fontHint: 'latin',
        builtin: false,
        enabled: true,
        sortOrder: 1,
        intlTag: 'pl-PL',
        pluralCategories: ['one', 'few', 'many', 'other'],
      },
    ]);
    const source = '{count, plural, one {# item} other {# items}}';
    expect(codes('{count, plural, one {#} few {#} many {#} other {#}}', source, 'tlh_KL')).toEqual(
      [],
    );
    expect(codes('{count, plural, one {#} two {#} other {#}}', source, 'tlh_KL')).toContain(
      'PLURAL_CATEGORY',
    );
  });

  it('reports every problem at once so the editor can show them together', () => {
    const result = validateMessage({
      candidate: '{count, number} {bogus}',
      source: '{count} changes',
      locale: 'de_DE',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1);
  });
});
