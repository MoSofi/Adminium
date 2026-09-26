// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A table's limits, a typed code's lookup and a renewing code against the
 * live snapshot: every column a rule names — the table's own, or of the row
 * a foreign key it names points at — and every table it reads by its id must
 * be there. A released slot rule is judged as it always was, in the same
 * words; several limits are judged one by one and the first problem answers.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { capacityRuleIssue, columnRuleIssue } from '../src/connections/column-rules-validation.js';

const int = (name: string, nullable = false) => ({ name, logicalType: 'integer', nullable });
const text = (name: string) => ({ name, logicalType: 'varchar', nullable: true });
const date = (name: string) => ({ name, logicalType: 'date', nullable: true });
const stamp = (name: string) => ({ name, logicalType: 'timestamptz', nullable: true });
const table = (name: string, columns: object[]) => ({ schema: 'public', name, primaryKey: ['id'], columns: [int('id'), ...columns] });
const fk = (from: string, column: string, to: string) => ({
  id: `fk:${from}-${column}`,
  kind: 'declared-fk',
  cardinality: 'one-to-many',
  from: { tableId: `public.${from}`, columns: [column] },
  to: { tableId: `public.${to}`, columns: ['id'] },
});

const model = parseDatabaseModel({
  dialect: 'postgres',
  name: 'venue',
  defaultSchema: 'public',
  schemas: ['public'],
  tables: [
    table('v_settings', [int('seats'), int('max_nights')]),
    table('v_hours', [text('weekday'), text('opens'), text('closes')]),
    table('v_halls', [int('capacity')]),
    table('v_events', [int('hall_id')]),
    table('v_types', [int('event_id'), int('capacity', true), stamp('sales_end')]),
    table('v_waitlist', [stamp('offered_until')]),
    table('v_orders', [text('status'), stamp('held_until'), stamp('pickup_at'), int('waitlist_id', true), text('code_text'), int('code_id', true)]),
    table('v_codes', [text('code'), int('event_id', true)]),
    table('v_tickets', [int('order_id'), int('type_id'), int('event_id'), text('status'), text('holder_email'), text('code')]),
    table('v_bookings', [stamp('starts_at'), int('party'), text('status')]),
    table('v_room_types', [int('sleeps')]),
    table('v_rooms', [int('room_type_id')]),
    table('v_room_closures', [int('room_id'), date('from_date'), date('to_date')]),
    table('v_stays', [int('room_type_id'), int('room_id', true), date('arrive'), date('depart'), text('status')]),
    table('v_extras', [int('limit', true)]),
    table('v_stay_extras', [int('stay_id'), int('extra_id')]),
  ],
  relations: [
    fk('v_events', 'hall_id', 'v_halls'),
    fk('v_types', 'event_id', 'v_events'),
    fk('v_orders', 'waitlist_id', 'v_waitlist'),
    fk('v_orders', 'code_id', 'v_codes'),
    fk('v_tickets', 'order_id', 'v_orders'),
    fk('v_tickets', 'type_id', 'v_types'),
    fk('v_tickets', 'event_id', 'v_events'),
    fk('v_rooms', 'room_type_id', 'v_room_types'),
    fk('v_room_closures', 'room_id', 'v_rooms'),
    fk('v_stays', 'room_type_id', 'v_room_types'),
    fk('v_stays', 'room_id', 'v_rooms'),
    fk('v_stay_extras', 'stay_id', 'v_stays'),
    fk('v_stay_extras', 'extra_id', 'v_extras'),
  ],
});
const of = (name: string) => model.tables.find((t) => t.name === name)!;
const column = (tableName: string, name: string) => of(tableName).columns.find((c) => c.name === name)!;

const LEGACY = { slot: 'starts_at', amount: 'party', perSlot: { table: 'public.v_settings', column: 'seats' }, countWhere: { column: 'status', values: ['booked'] }, slotMinutes: 15 };
const TICKETS = {
  kind: 'parent',
  via: 'type_id',
  size: { column: 'capacity' },
  countWhere: [{ column: 'status', values: ['valid'] }, { column: 'status', values: ['held'], via: 'order_id' }],
  window: { closes: 'sales_end' },
  also: [{ via: 'event_id', size: { via: 'hall_id', column: 'capacity' } }],
  hold: { column: { column: 'offered_until', via: 'waitlist_id', or: [{ column: 'held_until' }] }, states: ['held'], via: 'order_id' },
};
const STAYS = {
  rules: [
    {
      kind: 'night',
      from: 'arrive',
      to: 'depart',
      pool: {
        via: 'room_type_id',
        count: { table: 'public.v_rooms', column: 'room_type_id', outOfService: { table: 'public.v_room_closures', room: 'room_id', from: 'from_date', to: 'to_date' } },
        fits: { column: 'sleeps' },
        given: { via: 'room_id', column: 'room_type_id' },
      },
      nights: { max: { table: 'public.v_settings', column: 'max_nights' } },
    },
    { kind: 'night', from: 'arrive', to: 'depart', pool: { via: 'room_id', size: 1 } },
  ],
};
const EXTRAS = { kind: 'night', from: { via: 'stay_id', column: 'arrive' }, to: { via: 'stay_id', column: 'depart' }, pool: { via: 'extra_id', size: { column: 'limit' } } };

describe('capacityRuleIssue', () => {
  it('keeps a released slot rule, and refuses it in the words it always had', () => {
    expect(capacityRuleIssue(LEGACY, of('v_bookings'), model)).toBeNull();
    expect(capacityRuleIssue({ ...LEGACY, slot: 'when' }, of('v_bookings'), model)).toBe('v_bookings has no column "when".');
    expect(capacityRuleIssue({ ...LEGACY, amount: 'status' }, of('v_bookings'), model)).toBe('status is not a number, so it cannot be counted.');
    expect(capacityRuleIssue({ ...LEGACY, perSlot: { table: 'public.v_settings', column: 'nope' } }, of('v_bookings'), model)).toBe(
      'There is no column "nope" in "public.v_settings" to read.',
    );
  });

  it('keeps a parent rule, and follows every link it names', () => {
    expect(capacityRuleIssue(TICKETS, of('v_tickets'), model)).toBeNull();
    expect(capacityRuleIssue({ ...TICKETS, via: 'status' }, of('v_tickets'), model)).toBe('v_tickets.status does not point at another table.');
    expect(capacityRuleIssue({ ...TICKETS, size: { column: 'cap' } }, of('v_tickets'), model)).toBe('v_types has no column "cap".');
    expect(capacityRuleIssue({ ...TICKETS, also: [{ via: 'event_id', size: { via: 'hall_id', column: 'seats' } }] }, of('v_tickets'), model)).toBe('v_halls has no column "seats".');
    expect(capacityRuleIssue({ ...TICKETS, hold: { column: { column: 'ends', via: 'waitlist_id' }, states: ['held'], via: 'order_id' } }, of('v_tickets'), model)).toBe(
      'v_waitlist has no column "ends".',
    );
    expect(capacityRuleIssue({ ...TICKETS, countWhere: { column: 'state', values: ['held'], via: 'order_id' } }, of('v_tickets'), model)).toBe('v_orders has no column "state".');
  });

  it('judges each of several limits, and a night pool on a child row', () => {
    expect(capacityRuleIssue(STAYS, of('v_stays'), model)).toBeNull();
    expect(capacityRuleIssue(EXTRAS, of('v_stay_extras'), model)).toBeNull();
    const broken = structuredClone(STAYS);
    (broken.rules[0]!.pool as { count: { table: string } }).count.table = 'v_rooms';
    expect(capacityRuleIssue(broken, of('v_stays'), model)).toBe('There is no table "v_rooms" for the rooms counted to read.');
    expect(capacityRuleIssue({ ...EXTRAS, from: { via: 'stay_id', column: 'arrival' } }, of('v_stay_extras'), model)).toBe('v_stays has no column "arrival".');
    expect(capacityRuleIssue({ rules: [STAYS.rules[1], { ...STAYS.rules[1], pool: { via: 'room_type_id', given: { via: 'room_id', column: 'kind' }, count: { table: 'public.v_rooms', column: 'room_type_id' } } }] }, of('v_stays'), model)).toBe(
      'v_rooms has no column "kind".',
    );
  });
});

describe('columnRuleIssue for typed and renewing codes', () => {
  const lookup = { from: 'code_text', table: 'public.v_codes', column: 'code', scope: [{ column: 'event_id', equals: 'waitlist_id' }] };

  it('fills a link from a code typed into text', () => {
    expect(columnRuleIssue('column.lookup', lookup, column('v_orders', 'code_id'), model)).toBeNull();
    expect(columnRuleIssue('column.lookup', { ...lookup, table: 'public.v_types' }, column('v_orders', 'code_id'), model)).toBe(
      '"code_id" does not link this table to "public.v_types", so a typed code cannot fill it.',
    );
    expect(columnRuleIssue('column.lookup', { ...lookup, from: 'waitlist_id' }, column('v_orders', 'code_id'), model)).toBe('A code is typed into text; "waitlist_id" is integer.');
    expect(columnRuleIssue('column.lookup', { ...lookup, column: 'text' }, column('v_orders', 'code_id'), model)).toBe(
      'There is no column "text" in "public.v_codes" to find a code by.',
    );
    expect(columnRuleIssue('column.lookup', { ...lookup, scope: [{ column: 'event_id', equals: 'show_id' }] }, column('v_orders', 'code_id'), model)).toBe('v_orders has no column "show_id".');
  });

  it('renews a code by another column of the row', () => {
    const code = column('v_tickets', 'code');
    expect(columnRuleIssue('column.code', { length: 8, renew: { on: { column: 'holder_email', changed: true } } }, code, model)).toBeNull();
    expect(columnRuleIssue('column.code', { length: 8, renew: { on: [{ column: 'holder_email', changed: true }, { column: 'owner', values: ['x'] }] } }, code, model)).toBe(
      'v_tickets has no column "owner" to renew the code by.',
    );
    expect(columnRuleIssue('column.code', { length: 8, renew: { on: { column: 'code', changed: true } } }, code, model)).toBe('A code is renewed by another column of the row.');
  });
});
