// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A price by the night, worked out: each night the base plus every
 * adjustment that applies to it, rounded once per night, and the nights added
 * up; and a text joined from columns.
 */
import { describe, expect, it } from 'vitest';

import { evaluateFormula, joinText, nightlyRates, NightlyRuleUnreadable, PER_NIGHT_MAX, weekdaysOf, type NightlyAdjustment } from '../src/index.js';

const weekend: NightlyAdjustment = { add: '25.00', name: 'Weekend', typeMatch: true, weekdays: 'fri,sat', from: null, to: null };
const august: NightlyAdjustment = { add: 20, name: 'August', typeMatch: true, weekdays: null, from: '2026-08-01', to: '2026-08-31' };

const garden = (from: string, to: string, adjustments: NightlyAdjustment[] = [weekend, august], scale = 2, base: unknown = '150.00') =>
  nightlyRates({ from, to, base, scale, adjustments });

describe('the nights of a stay', () => {
  it('prices Mon 3 – Wed 5 August at 170 a night: 340', () => {
    expect(garden('2026-08-03', '2026-08-05')).toEqual({
      nights: [
        { date: '2026-08-03', rate: '170.00', base: '150.00', tags: ['August'] },
        { date: '2026-08-04', rate: '170.00', base: '150.00', tags: ['August'] },
      ],
      total: '340.00',
    });
  });

  it('prices Fri 31 July – Sun 2 August at 175 and 195: 370', () => {
    expect(garden('2026-07-31', '2026-08-02')).toEqual({
      nights: [
        { date: '2026-07-31', rate: '175.00', base: '150.00', tags: ['Weekend'] },
        { date: '2026-08-01', rate: '195.00', base: '150.00', tags: ['Weekend', 'August'] },
      ],
      total: '370.00',
    });
  });

  it('takes a season through its last day, and not the day after', () => {
    const nights = garden('2026-08-30', '2026-09-02', [august])!.nights;
    expect(nights.map((n) => [n.date, n.rate])).toEqual([
      ['2026-08-30', '170.00'],
      ['2026-08-31', '170.00'],
      ['2026-09-01', '150.00'],
    ]);
  });

  it('leaves out a rule for another rate, and reads one with no rate for every rate', () => {
    const other = { ...weekend, typeMatch: false };
    expect(garden('2026-07-31', '2026-08-01', [other])!.total).toBe('150.00');
    expect(garden('2026-07-31', '2026-08-01', [weekend])!.total).toBe('175.00');
  });

  it('counts calendar nights across the clocks going back and forward, in any zone', () => {
    // Europe goes back on 25 October 2026, the US on 1 November: still one night each.
    expect(garden('2026-10-24', '2026-10-27', [])!.nights).toHaveLength(3);
    expect(garden('2026-10-31', '2026-11-02', [])!.nights.map((n) => n.date)).toEqual(['2026-10-31', '2026-11-01']);
    expect(garden('2026-03-28', '2026-03-30', [])!.nights).toHaveLength(2);
    // A Date as a driver hands a DATE back: local midnight.
    expect(nightlyRates({ from: new Date(2026, 7, 3), to: new Date(2026, 7, 5), base: 150, scale: 2, adjustments: [august] })!.total).toBe('340.00');
  });

  it('rounds each night to the currency, then adds the rounded nights', () => {
    const third = { add: '0.333', name: 'Third', typeMatch: true, weekdays: null, from: null, to: null };
    expect(garden('2026-08-03', '2026-08-06', [third], 2, '10.00')!.total).toBe('30.99');
    expect(garden('2026-08-03', '2026-08-05', [third], 0, '10000')!.nights[0]!.rate).toBe('10000');
    expect(garden('2026-08-03', '2026-08-05', [{ ...third, add: '0.0005' }], 3, '12.5')!.nights[0]!.rate).toBe('12.501');
  });

  it('prices a discount night below the base', () => {
    const off = { add: '-30', name: 'Midweek', typeMatch: true, weekdays: 'mon tue', from: null, to: null };
    expect(garden('2026-08-03', '2026-08-05', [off])!.total).toBe('240.00');
  });

  it('prices nothing for an empty date or base, a stay of no nights, or one longer than two years', () => {
    expect(garden('2026-08-03', '2026-08-03')).toBeNull();
    expect(garden('2026-08-05', '2026-08-03')).toBeNull();
    expect(nightlyRates({ from: null, to: '2026-08-05', base: 1, scale: 2, adjustments: [] })).toBeNull();
    expect(garden('2026-08-03', '2026-08-05', [], 2, null)).toBeNull();
    const start = Date.UTC(2026, 0, 1) / 86_400_000;
    const day = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
    expect(garden(day(start), day(start + PER_NIGHT_MAX), [])!.nights).toHaveLength(PER_NIGHT_MAX);
    expect(garden(day(start), day(start + PER_NIGHT_MAX + 1), [])).toBeNull();
  });

  it('refuses a rule of this rate it cannot read, and ignores one of another rate', () => {
    const bad = { ...weekend, weekdays: 'fri,sunday' };
    expect(() => garden('2026-08-03', '2026-08-05', [august, bad])).toThrow(NightlyRuleUnreadable);
    try {
      garden('2026-08-03', '2026-08-05', [august, bad]);
    } catch (error) {
      expect(error).toMatchObject({ index: 1, column: 'weekdays' });
    }
    expect(garden('2026-08-03', '2026-08-05', [{ ...bad, typeMatch: false }])!.total).toBe('300.00');
    expect(() => garden('2026-08-03', '2026-08-05', [{ ...august, to: '2026-02-30' }])).toThrow(NightlyRuleUnreadable);
  });
});

describe('a weekdays value', () => {
  it('reads three-letter days in any case, by commas or spaces', () => {
    expect([...weekdaysOf('Fri, SAT')!]).toEqual([5, 6]);
    expect(weekdaysOf('')!.size).toBe(0);
    expect(weekdaysOf(null)!.size).toBe(0);
    expect(weekdaysOf('fri,sunday')).toBeNull();
    expect(weekdaysOf(5)).toBeNull();
  });
});

describe('a joined text', () => {
  it('joins columns and text, leaving out an empty column and the text beside it', () => {
    expect(joinText(['first_name', ' ', 'last_name'], { first_name: 'Mia', last_name: 'Okada' })).toBe('Mia Okada');
    expect(joinText(['first_name', ' ', 'last_name'], { first_name: 'Mia', last_name: null })).toBe('Mia');
    expect(joinText(['first_name', ' ', 'last_name'], { first_name: '  ', last_name: 'Okada' })).toBe('Okada');
    expect(joinText(['first_name', ' ', 'last_name'], { first_name: null, last_name: null })).toBeNull();
    expect(joinText(['ref_prefix', '-', 'ref_code'], { ref_prefix: 'WH', ref_code: 3283 })).toBe('WH-3283');
    expect(joinText(['Room ', 'number'], { number: 12 })).toBe('Room 12');
    expect(joinText(['Room ', 'number'], { number: null })).toBeNull();
    // Only text and whole numbers join: a decimal, a yes or no or a moment would read differently on each engine.
    expect(joinText(['first_name', ' ', 'last_name'], { first_name: 'Mia', last_name: 8.25 })).toBe('Mia');
    expect(joinText(['first_name', ' ', 'last_name'], { first_name: 'Mia', last_name: true })).toBe('Mia');
    expect(joinText(['first_name', ' ', 'last_name'], { first_name: 'Mia', last_name: new Date('2026-07-31T00:00:00Z') })).toBe('Mia');
    expect(joinText(['ref_prefix', '-', 'ref_code'], { ref_prefix: 'WH', ref_code: 3283n })).toBe('WH-3283');
  });

  it('is what a join formula works out', () => {
    expect(evaluateFormula({ join: ['first_name', ' ', 'last_name'] }, { first_name: 'Teodor', last_name: 'Blank' }, 2)).toBe('Teodor Blank');
  });
});
