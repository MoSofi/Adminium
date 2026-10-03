// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { EXAMPLES, SHOWN, examplesAt, nameFromRequest } from './examples.js';

describe('the examples', () => {
  it('are twelve, four at a time, each shown once in three turns', () => {
    expect(EXAMPLES).toHaveLength(12);
    const seen = [0, 1, 2].flatMap((turn) => examplesAt(turn).map((example) => example.key));
    expect(new Set(seen).size).toBe(12);
    expect(examplesAt(3).map((example) => example.key)).toEqual(examplesAt(0).map((example) => example.key));
    expect(examplesAt(0)).toHaveLength(SHOWN);
  });
});

describe('nameFromRequest', () => {
  it('names an app from the start of what was asked', () => {
    expect(nameFromRequest('A repair shop: customers drop off an item')).toBe('Repair shop');
    expect(nameFromRequest('I want a booking page for my studio. With reminders')).toBe('Booking page for my');
    expect(nameFromRequest('Stock for a plant nursery')).toBe('Stock for a plant');
    expect(nameFromRequest('   ')).toBe('My app');
    expect(nameFromRequest('!!!')).toBe('My app');
  });
});
