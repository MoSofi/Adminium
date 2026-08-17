// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `looksLikeEmail()` — acceptance table + the ReDoS regression.
 *
 * The acceptance table is the contract the two auth screens shipped with under
 * the old `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; every case below was verified against
 * that pattern before it was replaced, including the odd ones (`.a.b` accepted,
 * `a..b` accepted) that a "tidier" rewrite would silently drop.
 */
import { describe, expect, it } from 'vitest';

import { looksLikeEmail } from './email.js';

describe('looksLikeEmail', () => {
  it.each([
    'ava@adminium.io',
    'ava.reed@adminium.io',
    'ava+billing@mail.adminium.io',
    "o'neill@example.co.uk",
    'a@b.c',
    'ünïcode@exämple.dev',
    // Odd, but the old regex took them: it only ever needed SOME dot with a
    // character on each side, not a well-formed label sequence.
    'a@..b',
    'a@.a.b',
    'a@a..b',
    'a@-.-',
  ])('accepts %j', (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each([
    '',
    'not-an-email',
    'ava@adminium', // no dot in the domain
    'ava@.io', // nothing before the domain's only dot
    'ava@adminium.', // nothing after it
    '@adminium.io', // empty local part
    'ava@@adminium.io', // two @
    'ava@adminium.io@x.io',
    'ava adminium@x.io', // whitespace anywhere disqualifies
    'ava@adminium.io ',
    ' ava@adminium.io',
    'ava@admin ium.io',
    'ava@adminium.io\n',
    'ava@adminium.io\u00a0', // JS `\s` is unicode-aware (NBSP), and so is the replacement
    '@',
    '.',
    'a@b',
  ])('rejects %j', (value) => {
    expect(looksLikeEmail(value)).toBe(false);
  });

  /**
   * CodeQL js/polynomial-redos #19/#20: "strings starting with '!@!.' and with
   * many repetitions of '!.'". `.` is itself a member of `[^\s@]`, so
   * `[^\s@]+\.[^\s@]+` could split that dotted run at every single dot; a
   * trailing character the domain class rejects (a second `@` here — a trailing
   * space would be removed by the forms' own `.trim()`) then made the engine
   * walk every one of those splits before failing.
   *
   * Measured against the pattern this replaced: 20k repetitions took 1.3s, and
   * the 60k below took 12.2s — on a screen that requires no authentication and
   * caps nothing.
   */
  it('rejects the pathological pre-auth input in linear time', () => {
    const attack = `!@!.${'!.'.repeat(60_000)}@`;
    const started = performance.now();
    const result = looksLikeEmail(attack);
    const elapsed = performance.now() - started;

    // Correctness first: a second `@` is a reject, exactly as before.
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('still accepts the same string without the rejecting suffix', () => {
    // The old pattern accepted this (`[^\s@]+` happily ends on a `.`), so the
    // replacement must too — a "fix" that quietly started rejecting it would
    // pass a timing assertion and break the form.
    const long = `!@!.${'!.'.repeat(60_000)}`;
    const started = performance.now();
    expect(looksLikeEmail(long)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
