// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  ID_MAX_LENGTH,
  ID_PREFIXES,
  InvalidIdError,
  idTime,
  isId,
  newId,
  parseId,
  type IdPrefix,
} from '../src/ids.js';

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

describe('ids', () => {
  it('produces prefixed ULIDs in char(36) for every registered prefix', () => {
    for (const prefix of Object.keys(ID_PREFIXES) as IdPrefix[]) {
      const id = newId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(id.length).toBeLessThanOrEqual(ID_MAX_LENGTH);
      expect(id.slice(prefix.length + 1)).toMatch(CROCKFORD);
    }
  });

  it('rejects unknown prefixes', () => {
    expect(() => newId('nope' as IdPrefix)).toThrow(InvalidIdError);
  });

  it('is unique across many generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) seen.add(newId('usr'));
    expect(seen.size).toBe(10_000);
  });

  it('sorts lexicographically in generation order (monotonic within one ms)', () => {
    const ids = Array.from({ length: 5_000 }, () => newId('job'));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('embeds a sane timestamp', () => {
    const before = Date.now();
    const id = newId('sess');
    const after = Date.now();
    const t = idTime(id);
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(after + 1);
  });

  it('parses its own output', () => {
    const id = newId('conn');
    const parsed = parseId(id);
    expect(parsed.prefix).toBe('conn');
    expect(parsed.table).toBe('adminium_connections');
    expect(parsed.ulid).toHaveLength(26);
  });

  it('validates via isId', () => {
    const id = newId('page');
    expect(isId(id)).toBe(true);
    expect(isId(id, 'page')).toBe(true);
    expect(isId(id, 'view')).toBe(false);
    expect(isId('page_short')).toBe(false);
    expect(isId('unknown_01J8ME7Q2RZX4V9T6W3YB0KD5N')).toBe(false);
    // I, L, O, U are not Crockford characters.
    expect(isId('page_01J8ME7Q2RZX4V9T6W3YBIKD5L')).toBe(false);
    expect(isId(42)).toBe(false);
  });

  it('rejects malformed input in parseId', () => {
    expect(() => parseId('')).toThrow(InvalidIdError);
    expect(() => parseId('usr-01J8ME7Q2RZX4V9T6W3YB0KD5N')).toThrow(InvalidIdError);
    expect(() => parseId('01J8ME7Q2RZX4V9T6W3YB0KD5N')).toThrow(InvalidIdError);
  });
});
