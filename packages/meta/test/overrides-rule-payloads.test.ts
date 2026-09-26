// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE STORE KEEPS EVERY KEY OF A LIMIT, A CODE RULE AND A LOOKUP.
 *
 * What an install writes is what `validateOverrideInput` gives back, so a key
 * its payload schema forgot would be dropped without a word: the rule would
 * read back smaller than the app wrote it, and its hash would change. Each
 * case here writes a rule with every key its kind takes and reads back the
 * same value; a key the store does not know is refused, never dropped.
 */
import { describe, expect, it } from 'vitest';

import { MetaValidationError, validateOverrideInput } from '../src/index.js';

const kept = (op: string, value: Record<string, unknown>, columnName: string | null = null) =>
  validateOverrideInput({ connectionId: 'con_1', op, tableName: 'main.shop_orders', columnName, value }).value;

const setting = (column: string) => ({ table: 'main.shop_settings', column });

/** A released slot rule, exactly as a point-of-sale install writes it. */
const LEGACY = {
  slot: 'starts_at',
  amount: 'party_size',
  perSlot: setting('seats'),
  countWhere: { column: 'status', values: ['confirmed', 'seated'] },
  slotMinutes: 15,
  windowDays: setting('booking_days'),
  opens: '17:00',
  closes: setting('closes_at'),
  cancelHours: 2,
};

const SLOT = {
  kind: 'slot',
  slot: 'pickup_at',
  amount: 1,
  perSlot: setting('slot_capacity'),
  countWhere: { column: 'status', values: ['placed', 'ready'] },
  slotMinutes: setting('slot_minutes'),
  windowDays: 1,
  hours: { table: 'main.shop_hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' },
  closures: { table: 'main.shop_closures', from: 'from_date', to: 'to_date', active: 'active' },
  pauses: { table: 'main.shop_slot_pauses', slot: 'slot_at', active: 'active' },
  noticeMinutes: setting('lead_minutes'),
  hold: { column: 'held_until', states: ['held'] },
};

const PARENT = {
  kind: 'parent',
  via: 'ticket_type_id',
  size: { column: 'capacity' },
  amount: 1,
  countWhere: [
    { column: 'status', values: ['valid', 'returned'] },
    { column: 'status', values: ['held', 'paid'], via: 'order_id' },
  ],
  window: { opens: 'sales_start', closes: 'sales_end' },
  perWrite: { max: { column: 'max_per_order' }, within: 'order_id' },
  also: [{ via: 'event_id', size: { via: 'room_id', column: 'capacity' } }],
  day: { column: 'pickup_at', via: 'order_id' },
  lockBy: 'event_id',
  hold: {
    column: { column: 'offered_until', via: 'waitlist_id', or: [{ column: 'held_until' }] },
    states: ['held'],
    via: 'order_id',
  },
  reserved: { states: ['returned'] },
};

const STOCK = { kind: 'parent', via: 'menu_item_id', size: { column: 'stock_today', onDay: 'stock_on' }, day: 'pickup_at' };

const NIGHT_TYPE = {
  kind: 'night',
  from: 'arrive',
  to: 'depart',
  countWhere: { column: 'status', values: ['booked', 'in_house'] },
  pool: {
    via: 'room_type_id',
    count: {
      table: 'main.hotel_rooms',
      column: 'room_type_id',
      outOfService: { table: 'main.hotel_room_closures', room: 'room_id', from: 'from_date', to: 'to_date', active: 'active' },
    },
    fits: { column: 'sleeps' },
    given: { via: 'room_id', column: 'room_type_id' },
  },
  nights: { min: 1, max: setting('max_nights'), minByArrival: { sat: 2 }, aheadDays: setting('ahead_days') },
  hold: { column: 'held_until', states: ['held'] },
};

const NIGHT_ROOM = { kind: 'night', from: 'arrive', to: 'depart', pool: { via: 'room_id', size: 1 } };

const NIGHT_CHILD = {
  kind: 'night',
  from: { via: 'stay_id', column: 'arrive' },
  to: { via: 'stay_id', column: 'depart' },
  countWhere: { column: 'status', values: ['booked', 'in_house'], via: 'stay_id' },
  pool: { via: 'extra_id', size: { column: 'limit' } },
};

describe('table.capacity', () => {
  it('keeps a released slot rule exactly as it was written, with no kind added', () => {
    expect(kept('table.capacity', LEGACY)).toEqual(LEGACY);
    expect(kept('table.capacity', LEGACY)).not.toHaveProperty('kind');
    expect(JSON.stringify(kept('table.capacity', LEGACY))).toBe(JSON.stringify(LEGACY));
  });

  it('keeps every key of each kind', () => {
    for (const rule of [SLOT, PARENT, STOCK, NIGHT_TYPE, NIGHT_ROOM, NIGHT_CHILD]) {
      expect(kept('table.capacity', rule)).toEqual(rule);
    }
  });

  it('keeps a list of up to three rules, and no more', () => {
    const list = { rules: [NIGHT_TYPE, NIGHT_ROOM, NIGHT_CHILD] };
    expect(kept('table.capacity', list)).toEqual(list);
    expect(() => kept('table.capacity', { rules: [NIGHT_TYPE, NIGHT_ROOM, NIGHT_CHILD, SLOT] })).toThrow(MetaValidationError);
    expect(() => kept('table.capacity', { rules: [] })).toThrow(MetaValidationError);
  });

  it('refuses a key it does not know rather than dropping it', () => {
    expect(() => kept('table.capacity', { ...PARENT, perOrder: 6 })).toThrow(MetaValidationError);
    expect(() => kept('table.capacity', { ...LEGACY, perDay: 4 })).toThrow(MetaValidationError);
    expect(() => kept('table.capacity', { ...NIGHT_TYPE, nights: { ...NIGHT_TYPE.nights, lateDays: 3 } })).toThrow(MetaValidationError);
    expect(() => kept('table.capacity', { ...PARENT, kind: 'shelf' })).toThrow(MetaValidationError);
  });
});

describe('column.code, column.normalize, column.lookup', () => {
  it('keeps a code renewed by a change or by a state', () => {
    const changed = { length: 8, renew: { on: { column: 'holder_email', changed: true } } };
    const moved = { prefix: 'TK-', length: 8, renew: { on: [{ column: 'holder_email', changed: true }, { column: 'status', values: ['valid'] }] } };
    expect(kept('column.code', changed, 'code')).toEqual(changed);
    expect(kept('column.code', moved, 'code')).toEqual(moved);
    expect(() => kept('column.code', { length: 8, renew: { on: { column: 'holder_email' } } }, 'code')).toThrow(MetaValidationError);
  });

  it('keeps normalize "code"', () => {
    expect(kept('column.normalize', { normalize: 'code' }, 'code')).toEqual({ normalize: 'code' });
  });

  it('keeps every key of a lookup, and needs its column', () => {
    const lookup = {
      from: 'code_text',
      table: 'main.shop_codes',
      column: 'code',
      where: [{ column: 'active', eq: true }, { column: 'valid_until', notBefore: 'now', orEmpty: true }, { column: 'valid_from', notAfter: 'today' }],
      scope: [{ column: 'event_id', equals: 'event_id', orEmpty: true }],
    };
    expect(kept('column.lookup', lookup, 'code_id')).toEqual(lookup);
    expect(() => kept('column.lookup', lookup)).toThrow(/requires columnName/);
    expect(() => kept('column.lookup', { ...lookup, fold: true }, 'code_id')).toThrow(MetaValidationError);
  });
});
