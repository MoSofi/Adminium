// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A form's slug: the one rule the engine's door and the forms add-on's
 * builder both hold a slug to, reserved words included.
 */
import { describe, expect, it } from 'vitest';

import { FORM_SLUG, FORM_SLUG_MAX, FORM_SLUGS_RESERVED, isFormSlug } from '../src/forms/index.js';

describe('a form\'s slug', () => {
  it('takes lower-case letters, digits and dashes, with no dash at either end', () => {
    for (const slug of ['a', 'newsletter', 'fit-out', 'spring-2026', '9']) expect(isFormSlug(slug), slug).toBe(true);
    for (const slug of ['', '-a', 'a-', 'Fit-out', 'fit_out', 'fit out', 'fit/out', 'ünder', 'a.b']) expect(isFormSlug(slug), slug).toBe(false);
  });

  it('is at most eighty characters', () => {
    expect(FORM_SLUG_MAX).toBe(80);
    expect(isFormSlug('a'.repeat(80))).toBe(true);
    expect(isFormSlug('a'.repeat(81))).toBe(false);
    expect(FORM_SLUG.test('a'.repeat(81))).toBe(false);
  });

  it('is never a word the addresses use: the form reads under api, the staff page\'s surveys', () => {
    expect([...FORM_SLUGS_RESERVED].sort()).toEqual(['api', 'surveys']);
    for (const slug of FORM_SLUGS_RESERVED) {
      // The pattern alone takes it: the reserved list is what refuses it.
      expect(FORM_SLUG.test(slug)).toBe(true);
      expect(isFormSlug(slug)).toBe(false);
    }
    expect(isFormSlug('surveys-2026')).toBe(true);
    expect(isFormSlug('api-docs')).toBe(true);
  });

  it('is never a value that is not text', () => {
    for (const value of [null, undefined, 12, ['fit-out'], { slug: 'fit-out' }]) expect(isFormSlug(value)).toBe(false);
  });
});
