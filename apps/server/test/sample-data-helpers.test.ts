// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sample-data engine's pure parts: one spelling per value for the hashes,
 * the adding person's language, a venue's wall clock across a clock change,
 * and a refusal for a reference or an image that was never added.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  ledgerNameFor,
  normaliseValue,
  pickText,
  resolveSampleRow,
  sampleFileOf,
  zonedWallTime,
} from '../src/apps/sample-data.js';
import type { Manifest } from '@adminium/manifest';

describe('a value, spelled one way for its hash', () => {
  it('reads a decimal, a boolean, a timestamp and a JSON document the same whatever the engine sent', () => {
    expect(normaliseValue('4.50', 'decimal')).toBe('4.5');
    expect(normaliseValue(4.5, 'decimal')).toBe('4.5');
    expect(normaliseValue('3.000', 'decimal')).toBe('3');
    expect(normaliseValue('0.10', 'decimal')).toBe('0.1');
    expect(normaliseValue(1, 'boolean')).toBe('true');
    expect(normaliseValue('f', 'boolean')).toBe('false');
    expect(normaliseValue(new Date('2026-09-22T13:30:00Z'), 'timestamptz')).toBe('2026-09-22T13:30:00.000Z');
    expect(normaliseValue('2026-09-22T13:30:00+00:00', 'timestamptz')).toBe('2026-09-22T13:30:00.000Z');
    expect(normaliseValue('{"b":1,"a":2}', 'json')).toBe(normaliseValue({ a: 2, b: 1 }, 'json'));
    expect(normaliseValue(12.9, 'integer')).toBe('12');
    expect(normaliseValue(new Date('2026-09-22T00:00:00Z'), 'date')).toBe('2026-09-22');
    expect(normaliseValue(null, 'text')).toBeNull();
  });

  it('writes JSON with sorted keys, at every depth', () => {
    expect(canonicalJson({ b: { d: 1, c: [2, { f: 1, e: 0 }] }, a: null })).toBe('{"a":null,"b":{"c":[2,{"e":0,"f":1}],"d":1}}');
  });
});

describe('the adding person’s language', () => {
  const texts = { 'en-US': 'Coffee', 'de-DE': 'Kaffee', fr: 'Café' };
  it('takes their tag, then their language, then US English', () => {
    expect(pickText(texts, 'de-DE')).toBe('Kaffee');
    expect(pickText(texts, 'de_AT')).toBe('Kaffee');
    expect(pickText(texts, 'fr-FR')).toBe('Café');
    expect(pickText(texts, 'cs-CZ')).toBe('Coffee');
    expect(pickText({ 'da-DK': 'Kaffe' }, 'cs-CZ')).toBe('Kaffe');
  });
});

describe('a venue’s wall clock', () => {
  it('lands on the right instant either side of a clock change', () => {
    // Berlin: CEST (UTC+2) in summer, CET (UTC+1) after 25 October 2026.
    expect(zonedWallTime({ y: 2026, m: 10, d: 24 }, '09:30', 'Europe/Berlin').toISOString()).toBe('2026-10-24T07:30:00.000Z');
    expect(zonedWallTime({ y: 2026, m: 10, d: 26 }, '09:30', 'Europe/Berlin').toISOString()).toBe('2026-10-26T08:30:00.000Z');
    expect(zonedWallTime({ y: 2026, m: 9, d: 22 }, '09:30', 'UTC').toISOString()).toBe('2026-09-22T09:30:00.000Z');
  });
});

describe('a sample row, resolved', () => {
  const ctx = { now: Date.UTC(2026, 8, 23, 12), timeZone: 'UTC', locale: 'en-US', labels: new Map(), assets: new Map() };
  it('refuses a reference or an image that was never added', () => {
    expect(() => resolveSampleRow({ item_id: { '@ref': 'nope' } }, ctx)).toThrow(/was not written/);
    expect(() => resolveSampleRow({ image: { '@asset': 'nope' } }, ctx)).toThrow(/was not added/);
  });

  it('keeps plain values and drops the label', () => {
    expect(resolveSampleRow({ '@label': 'x', name: 'Tea', tags: ['hot'] }, ctx)).toEqual({ name: 'Tea', tags: ['hot'] });
  });
});

describe('where an app’s sample data lives', () => {
  it('names the ledger in the app’s prefix, or after its key when it has none', () => {
    expect(ledgerNameFor({ kind: 'app', key: 'pos', requiredSchema: { prefixed: true, tables: [] } } as unknown as Manifest)).toBe(
      'pos_sample_data',
    );
    expect(ledgerNameFor({ kind: 'app', key: 'clinic-desk', requiredSchema: { tables: [] } } as unknown as Manifest)).toBe(
      'clinic_desk_sample_data',
    );
    expect(sampleFileOf({ kind: 'app', key: 'pos', sampleData: { file: 'seeds/pos.sample.json' } } as unknown as Manifest)).toBe(
      'seeds/pos.sample.json',
    );
    expect(sampleFileOf({ kind: 'add-on', key: 'x' } as unknown as Manifest)).toBeUndefined();
  });
});
