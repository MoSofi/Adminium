// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `nestBundle` turns a flat `a.b.c → text` map into the nested object i18next
 * wants. It does that by splitting on dots and assigning down the path, which is
 * the shape that pollutes: on an ordinary object, a segment named `__proto__`
 * writes through to `Object.prototype` and every object in the process gains the
 * property. Keys are not always ours — runtime translations come from the
 * database, and this is an exported entry point — so the test is here rather
 * than the assumption.
 */
import { describe, expect, it } from 'vitest';

import { nestBundle } from './keys.js';

describe('nestBundle', () => {
  it('nests a dotted path and keeps every leaf', () => {
    const bundle = nestBundle(
      new Map([
        ['save', 'Save'],
        ['errors.notFound', 'Not found'],
        ['errors.forbidden', 'Forbidden'],
        ['deep.a.b.c', 'Deep'],
      ]),
    );
    expect(bundle).toEqual({
      save: 'Save',
      errors: { notFound: 'Not found', forbidden: 'Forbidden' },
      deep: { a: { b: { c: 'Deep' } } },
    });
  });

  it('a __proto__ segment does not reach Object.prototype', () => {
    const before = Object.prototype.toString.call({});
    nestBundle(new Map([['__proto__.polluted', 'yes']]));
    // The assertion that matters: nothing outside the bundle changed.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.toString.call({})).toBe(before);
  });

  it('keeps __proto__ as an ordinary key instead of dropping it', () => {
    const bundle = nestBundle(new Map([['__proto__.polluted', 'yes']]));
    // Prototype-less nodes mean the segment round-trips as itself. Silently
    // losing a translation key would be its own bug.
    const nested = (bundle as Record<string, unknown>)['__proto__'] as Record<string, unknown>;
    expect(nested['polluted']).toBe('yes');
  });

  it('a constructor segment is an own property, not a call', () => {
    const bundle = nestBundle(new Map([['constructor.name', 'Nope']]));
    const nested = (bundle as Record<string, unknown>)['constructor'] as Record<string, unknown>;
    expect(nested['name']).toBe('Nope');
  });
});
