// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Moves that wait for things, moves the clock makes, deadline stamps and a
 * public change allowed inside a window reach the store whole, on every
 * engine: installed through the real installer, read back from the rules
 * store and the public endpoint store, and compared key for key with what
 * the manifest said — every table a rule names at any depth (a settings row,
 * an hours table) swapped for its real id, nothing else changed. A key the
 * store did not know would be dropped on the way in, and the app would
 * install cleanly with a rule that never runs.
 */
import { overridesRepo, publicEndpointsRepo, type SchemaOverride } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { mapTableRefs } from '../src/apps/real-refs.js';
import { parseDefinition, printDefinition } from '../src/public-api/endpoint.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const setting = (column: string) => ({ table: 'settings', column });

const ticketStates: Doc = {
  column: 'status',
  initial: 'valid',
  strict: { show: ['door'] },
  moves: {
    valid: [
      {
        to: 'checked_in',
        requires: {
          linked: [{ via: 'order_id', where: [{ column: 'pay', in: ['paid', 'door', 'none'] }] }],
          time: { after: { via: 'event_id', column: 'doors_at', minus: { minutes: 30 } }, before: { column: 'valid_to' } },
          setting: [{ table: 'settings', column: 'door_on', eq: true }],
        },
      },
      'refund_asked',
    ],
  },
};
const orderStates: Doc = {
  column: 'status',
  initial: 'held',
  moves: { held: ['awaiting_transfer', 'paid', 'expired'], awaiting_transfer: ['paid', 'released'], paid: ['cancelled'] },
  timed: [
    { from: 'held', to: 'expired', at: { column: 'held_until' } },
    { from: 'awaiting_transfer', to: 'released', at: { column: 'pay_by', plus: { hours: 24 } } },
  ],
};
const stayStates: Doc = {
  column: 'status',
  initial: 'booked',
  moves: {
    booked: [{ to: 'in_house', requires: { linked: [{ via: 'room_id', where: [{ column: 'status', eq: 'ready' }] }] } }, 'cancelled', 'no_show'],
    in_house: ['departed'],
  },
  late: [
    {
      to: 'cancelled',
      from: ['booked'],
      moment: { column: 'arrive', time: setting('arrive_from'), or: [{ column: 'created_on', time: '12:00' }] },
      within: { hours: setting('cancel_hours') },
      mode: 'flag',
      flag: 'late_cancel',
    },
  ],
  timed: [{ from: 'booked', to: 'no_show', at: { column: 'arrive', plus: { days: 1 }, time: setting('no_show_at') } }],
  effects: [
    { on: { to: 'in_house' }, via: 'room_id', set: { status: 'occupied' } },
    { on: { to: 'departed' }, via: 'room_id', set: { status: 'cleaning' } },
  ],
};
const pickupStates: Doc = {
  column: 'status',
  initial: 'ready',
  moves: { ready: ['collected', 'not_collected'] },
  timed: [
    {
      from: 'ready',
      to: 'not_collected',
      at: { column: 'pickup_at', time: { hours: { table: 'hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' }, edge: 'closes' } },
    },
  ],
};
const holdStamp: Doc = { set: { addMinutes: { minutes: setting('hold_minutes') } }, on: 'create' };
const deadlineStamp: Doc = {
  set: { deadline: { days: setting('transfer_days'), time: setting('transfer_time'), notAfter: { via: 'event_id', column: 'starts_at', minus: { days: setting('cutoff_days') } } } },
  on: { column: 'status', values: ['awaiting_transfer'] },
};
const cancelByStamp: Doc = {
  set: { moment: { column: 'arrive', time: setting('arrive_from'), minus: { hours: setting('cancel_hours') } } },
  on: { columns: ['arrive'] },
};
const refundWindow: Doc = {
  status: ['paid'],
  event_id: {
    before: { column: 'refund_until', or: [{ via: 'event_id', column: 'starts_at', minus: { days: setting('refund_days') } }] },
    where: [{ column: 'refunds_on', eq: true }],
  },
};

function venueManifest(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'venue',
    name: 'Venue',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'venue.description', fallback: 'A venue' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'settings',
          columns: [
            id,
            { ref: 'refund_days', type: 'int', default: 7 },
            { ref: 'cancel_hours', type: 'int', default: 48 },
            { ref: 'hold_minutes', type: 'int', default: 10 },
            { ref: 'transfer_days', type: 'int', default: 5 },
            { ref: 'cutoff_days', type: 'int', default: 3 },
            { ref: 'arrive_from', type: 'text', maxLength: 5, default: '15:00' },
            { ref: 'no_show_at', type: 'text', maxLength: 5, default: '10:00' },
            { ref: 'transfer_time', type: 'text', maxLength: 5, default: '18:00' },
            { ref: 'door_on', type: 'bool', default: true },
          ],
        },
        {
          ref: 'hours',
          columns: [
            id,
            { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
            { ref: 'open', type: 'bool', default: true },
            { ref: 'opens', type: 'text', maxLength: 5, nullable: true },
            { ref: 'closes', type: 'text', maxLength: 5, nullable: true },
          ],
        },
        {
          ref: 'events',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'starts_at', type: 'timestamptz' },
            { ref: 'doors_at', type: 'timestamptz' },
            { ref: 'refund_until', type: 'timestamptz', nullable: true },
            { ref: 'refunds_on', type: 'bool', default: true },
          ],
        },
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'event_id', type: 'fk', references: 'events' },
            { ref: 'email', type: 'text', maxLength: 200 },
            { ref: 'pay', type: 'enum', enum: ['paid', 'door', 'none', 'transfer'], default: 'none' },
            { ref: 'status', type: 'enum', enum: ['held', 'awaiting_transfer', 'paid', 'expired', 'released', 'cancelled'], default: 'held' },
            { ref: 'held_until', type: 'timestamptz', nullable: true, rules: { stamp: holdStamp } },
            { ref: 'pay_by', type: 'timestamptz', nullable: true, rules: { stamp: deadlineStamp } },
          ],
          states: orderStates,
        },
        {
          ref: 'tickets',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'event_id', type: 'fk', references: 'events' },
            { ref: 'status', type: 'enum', enum: ['valid', 'checked_in', 'refund_asked'], default: 'valid' },
            { ref: 'valid_to', type: 'timestamptz' },
            { ref: 'door', type: 'text', maxLength: 40, nullable: true },
          ],
          states: ticketStates,
        },
        {
          ref: 'rooms',
          columns: [id, { ref: 'status', type: 'enum', enum: ['ready', 'occupied', 'cleaning'], default: 'ready' }],
          states: { column: 'status', initial: 'ready', moves: { ready: ['occupied'], occupied: ['cleaning'], cleaning: ['ready'] } },
        },
        {
          ref: 'stays',
          columns: [
            id,
            { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
            { ref: 'arrive', type: 'date' },
            { ref: 'created_on', type: 'date', nullable: true },
            { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed', 'cancelled', 'no_show'], default: 'booked' },
            { ref: 'late_cancel', type: 'bool', default: false },
            { ref: 'cancel_by', type: 'timestamptz', nullable: true, rules: { stamp: cancelByStamp } },
          ],
          states: stayStates,
        },
        {
          ref: 'pickups',
          columns: [id, { ref: 'pickup_at', type: 'timestamptz' }, { ref: 'status', type: 'enum', enum: ['ready', 'collected', 'not_collected'], default: 'ready' }],
          states: pickupStates,
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'venue', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }, { side: 'customer', kind: 'spa' }],
    publicAccess: [
      {
        table: 'orders',
        methods: ['GET', 'PATCH'],
        select: ['status', 'event_id'],
        claim: { verify: 'email-link', email: 'email' },
        humanCheck: true,
        writable: ['status'],
        writableValues: { status: ['cancelled'] },
        writableWhen: refundWindow,
      },
    ],
  };
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`moves with conditions, stored on ${dialect}`, () => {
    it('keep every key they were given, with each table they name at its real id', async () => {
      const h = await installInvoicing(dialect, venueManifest());
      open = h;
      const rules = h.reply['rules'] as { skipped: unknown[] };
      expect(rules.skipped, JSON.stringify(rules.skipped)).toEqual([]);

      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.origin === 'app');
      const idOf = (ref: string): string => {
        const found = stored.find((o) => o.tableName === `venue_${ref}` || o.tableName.endsWith(`.venue_${ref}`));
        expect(found, `a rule on ${ref}`).toBeDefined();
        return found!.tableName;
      };
      // Rules on the settings and hours tables do not exist; their ids are those of their neighbours' schema.
      const schemaOf = idOf('orders').includes('.') ? `${idOf('orders').split('.')[0]!}.` : '';
      const real = (ref: string) => `${schemaOf}venue_${ref}`;
      const expected = <T,>(value: T): T => mapTableRefs(value, real).value;
      const rule = (op: string, table: string, column: string | null): SchemaOverride => {
        const found = stored.find((o) => o.op === op && o.tableName === idOf(table) && o.columnName === column);
        expect(found, `${op} on ${table}.${column ?? ''}`).toBeDefined();
        return found!;
      };

      expect(rule('table.states', 'tickets', null).value).toEqual(expected(ticketStates));
      expect(rule('table.states', 'orders', null).value).toEqual(expected(orderStates));
      expect(rule('table.states', 'stays', null).value).toEqual(expected(stayStates));
      expect(rule('table.states', 'pickups', null).value).toEqual(expected(pickupStates));
      expect(rule('column.stamp', 'orders', 'held_until').value).toEqual(expected(holdStamp));
      expect(rule('column.stamp', 'orders', 'pay_by').value).toEqual(expected(deadlineStamp));
      expect(rule('column.stamp', 'stays', 'cancel_by').value).toEqual(expected(cancelByStamp));
      // The settings row is named by its real id, not the app's short name.
      expect(JSON.stringify(rule('table.states', 'stays', null).value)).toContain(`"table":"${real('settings')}"`);
      expect(JSON.stringify(rule('table.states', 'pickups', null).value)).toContain(`"table":"${real('hours')}"`);

      // And they reach the effective model the write path reads.
      const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
      const model = applyOverrides(parseDatabaseModel(snapshot!.schema), stored);
      const stays = model.tables.find((t) => t.id === idOf('stays'))!;
      expect(stays.states?.effects).toEqual(stayStates['effects']);
      expect(stays.states?.late).toEqual(expected(stayStates['late']));
      expect(stays.columns.find((c) => c.name === 'cancel_by')?.stamp).toEqual(expected(cancelByStamp));
      const tickets = model.tables.find((t) => t.id === idOf('tickets'))!;
      expect(tickets.states?.strict).toEqual({ show: ['door'] });
      expect(tickets.states?.moves['valid']).toEqual(expected((ticketStates['moves'] as Doc)['valid']));
    });

    it('keep a public window read from moments, through the endpoint store and its printed text', async () => {
      const h = await installInvoicing(dialect, venueManifest());
      open = h;
      const endpoints = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
      const orders = endpoints.find((e) => e.ref.startsWith('venue_orders'));
      expect(orders, endpoints.map((e) => e.ref).join(', ')).toBeDefined();
      const parsed = parseDefinition(orders!.definition);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      if (!parsed.ok) return;
      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).find((o) => o.origin === 'app' && o.tableName.endsWith('venue_orders'))!;
      const schemaOf = stored.tableName.includes('.') ? `${stored.tableName.split('.')[0]!}.` : '';
      expect(parsed.definition.writable_when).toEqual(mapTableRefs(refundWindow, (ref) => `${schemaOf}venue_${ref}`).value);
      // Printed and read back, it is the same text.
      expect(printDefinition(parsed.definition)).toBe(orders!.definition);
    });
  });
}
