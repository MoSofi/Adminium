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
  onVenueGrid,
  pickText,
  releaseSlots,
  resolveSampleRow,
  slotKey,
  sampleFileOf,
  zonedMonthDay,
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

describe('a time ahead, on the venue’s grid', () => {
  it('rounds up to the next step of the venue’s own clock, and keeps a time already on it', () => {
    // Kolkata is UTC+05:30: 09:41Z is 15:11 there, and the next quarter hour is 15:15 (09:45Z).
    expect(onVenueGrid(Date.UTC(2026, 6, 28, 9, 41), 15, 'Asia/Kolkata').toISOString()).toBe('2026-07-28T09:45:00.000Z');
    expect(onVenueGrid(Date.UTC(2026, 6, 28, 9, 45), 15, 'Asia/Kolkata').toISOString()).toBe('2026-07-28T09:45:00.000Z');
    expect(onVenueGrid(Date.UTC(2026, 6, 28, 9, 45, 1), 15, 'Asia/Kolkata').toISOString()).toBe('2026-07-28T10:00:00.000Z');
  });

  it('never rounds past the next midnight', () => {
    expect(onVenueGrid(Date.UTC(2026, 6, 28, 23, 55), 13, 'UTC').toISOString()).toBe('2026-07-29T00:00:00.000Z');
  });

  it('resolves a row: a duration after now, on the grid or as it falls', () => {
    const ctx = { now: Date.UTC(2026, 6, 28, 15, 0), timeZone: 'Europe/London', locale: 'en-US', labels: new Map(), assets: new Map() };
    // 15:00Z is 16:00 in London (BST); 20 minutes on is 16:20, the next quarter hour 16:30 (15:30Z).
    const row = resolveSampleRow({ pickup_at: { '@in': 'PT20M', '@grid': 15 }, due_at: { '@in': 'PT20M' } }, ctx);
    expect((row?.['pickup_at'] as Date).toISOString()).toBe('2026-07-28T15:30:00.000Z');
    expect((row?.['due_at'] as Date).toISOString()).toBe('2026-07-28T15:20:00.000Z');
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

describe('a day of a month, from the adding moment', () => {
  // 3 October 2026, 08:00 in New York (12:00 UTC).
  const now = Date.parse('2026-10-03T12:00:00Z');
  const zone = 'America/New_York';
  const context = { now, timeZone: zone, locale: 'en-US', labels: new Map(), assets: new Map() };

  it('keeps the day of the month, whatever day it is added on', () => {
    expect(zonedMonthDay(now, zone, -2, 14)).toEqual({ y: 2026, m: 8, d: 14, today: false });
    expect(zonedMonthDay(now, zone, -9, 20)).toEqual({ y: 2026, m: 1, d: 20, today: false });
    expect(zonedMonthDay(now, zone, -10, 20)).toEqual({ y: 2025, m: 12, d: 20, today: false });
  });

  it('takes a short month’s last day, and today for a day not yet come', () => {
    expect(zonedMonthDay(now, zone, -1, 31)).toEqual({ y: 2026, m: 9, d: 30, today: false });
    expect(zonedMonthDay(now, zone, -8, 30)).toEqual({ y: 2026, m: 2, d: 28, today: false });
    expect(zonedMonthDay(now, zone, 0, 2)).toEqual({ y: 2026, m: 10, d: 2, today: false });
    expect(zonedMonthDay(now, zone, 0, 3)).toEqual({ y: 2026, m: 10, d: 3, today: true });
    expect(zonedMonthDay(now, zone, 0, 28)).toEqual({ y: 2026, m: 10, d: 3, today: true });
  });

  it('counts months on the venue’s calendar, not the server’s', () => {
    // 1 November 02:00 UTC is still 31 October in New York.
    const edge = Date.parse('2026-11-01T02:00:00Z');
    expect(zonedMonthDay(edge, zone, -1, 15)).toEqual({ y: 2026, m: 9, d: 15, today: false });
  });

  it('writes a date, a wall time, and never a time still to come', () => {
    const row = resolveSampleRow(
      {
        issued_on: { '@month': -3, '@dom': 12 },
        paid_at: { '@month': -1, '@dom': 5, '@time': '10:00' },
        later: { '@month': 0, '@dom': 20, '@time': '17:00' },
        earlier: { '@month': 0, '@dom': 20, '@time': '07:30' },
      },
      context,
    );
    expect(row).toEqual({
      issued_on: '2026-07-12',
      paid_at: new Date('2026-09-05T14:00:00Z'),
      later: new Date(now),
      earlier: new Date('2026-10-03T11:30:00Z'),
    });
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

describe('a row left out of the sample, on a slot limit', () => {
  it('still takes its place in the queue of slot times, so the row after it gets the time meant for it', () => {
    const now = Date.parse('2026-09-30T08:00:00Z');
    const first = new Date('2026-09-30T09:15:00Z');
    const second = new Date('2026-09-30T09:30:00Z');
    const slotTimes = new Map([[slotKey('pickups', now + 3_600_000), [first, second]]]);
    const ctx = { now, timeZone: 'Europe/London', locale: 'en-US', labels: new Map(), assets: new Map(), slotTimes };
    const asks = { ready_at: { '@in': 'PT1H', '@slot': 'pickups' } };
    // The first row is left out; the second is written, at the second time.
    releaseSlots(asks, ctx);
    expect(resolveSampleRow(asks, ctx)!['ready_at']).toEqual(second);
    // A column that asks no slot takes nothing from the queue.
    slotTimes.set(slotKey('pickups', now + 3_600_000), [first]);
    releaseSlots({ ready_at: { '@in': 'PT1H' }, '@byClock': { at: 'ready_at', after: { ready_at: { '@in': 'PT1H', '@slot': 'pickups' } } } }, ctx);
    expect(slotTimes.get(slotKey('pickups', now + 3_600_000))).toEqual([first]);
  });
});
