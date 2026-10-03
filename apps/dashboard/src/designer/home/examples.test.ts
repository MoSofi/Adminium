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
    expect(nameFromRequest('I want a booking page for my studio. With reminders')).toBe('Booking page for my studio');
    expect(nameFromRequest('Stock for a plant nursery')).toBe('Stock for a plant nursery');
    expect(nameFromRequest('Create an Adminium app for a small bike repair shop. I want to track customers')).toBe('Bike repair shop');
    expect(nameFromRequest("Create an Adminium app for my bakery's cake orders. My staff need a screen")).toBe("Bakery's cake orders");
    expect(nameFromRequest('Create an Adminium app for my small design studio. I track clients')).toBe('Design studio');
    expect(nameFromRequest('A tracker for the orders of my — well, shop')).toBe('Tracker for the orders');
    expect(nameFromRequest('Build me an app')).toBe('My app');
    // Words that belong to the thing are kept.
    expect(nameFromRequest('Tool rental shop')).toBe('Tool rental shop');
    expect(nameFromRequest('New York pizza orders')).toBe('New York pizza orders');
    expect(nameFromRequest('Design studio client tracker')).toBe('Design studio client tracker');
    expect(nameFromRequest('Design me an app for dog walkers')).toBe('Dog walkers');
    expect(nameFromRequest('A to do list for my family')).toBe('To do list');
    expect(nameFromRequest('an app that tracks jobs')).toBe('Tracks jobs');
    expect(nameFromRequest('订单管理，给我的面包店')).toBe('订单管理');
    expect(nameFromRequest('   ')).toBe('My app');
    expect(nameFromRequest('!!!')).toBe('My app');
  });
});
