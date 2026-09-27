// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Three venues whose tables carry limits, each on a fresh database of any
 * engine: a kitchen (orders in pickup slots, portions of a dish per day), a
 * show (tickets of a type within the room's cap, held for ten minutes) and a
 * house (stays by the night, a room per stay, parking per night).
 */
import { wallTimeToInstant } from '../src/crud/venue-time.js';
import { filled, types, type Dialect, type World } from './capacity.helpers.js';

/** Every venue's clock. */
export const KITCHEN_ZONE = 'Europe/London';
export const at = (wall: string) => wallTimeToInstant(wall, KITCHEN_ZONE)!;
export const iso = (wall: string) => at(wall).toISOString();

/** The show's "now": 243 sold, 3 held for ten minutes from it. */
export const NEON_NOW = new Date('2026-07-20T18:00:00.000Z');
const later = (minutes: number) => new Date(NEON_NOW.getTime() + minutes * 60_000).toISOString();

/* ------------------------------------------------------------ the kitchen */

function kitchenDdl(dialect: Dialect): string[] {
  const t = types(dialect);
  return [
    `create table settings (id ${t.key}, slot_capacity integer, slot_minutes integer, lead_minutes integer)`,
    `create table hours (id ${t.key}, weekday ${t.text(3)} not null, open ${t.bool} not null, opens ${t.text(5)}, closes ${t.text(5)})`,
    `create table closures (id ${t.key}, from_date date not null, to_date date null, active ${t.bool} not null)`,
    `create table slot_pauses (id ${t.key}, slot_at ${t.at} not null, active ${t.bool} not null)`,
    `create table menu_items (id ${t.key}, name ${t.text(40)}, stock_today integer null, stock_on date null)`,
    `create table orders (id ${t.key}, pickup_at ${t.at} null, status ${t.text(16)} not null default 'placed')`,
    `create table order_items (id ${t.key}, order_id integer not null, menu_item_id integer not null, qty integer not null, ${t.fk('order_id', 'orders')}, ${t.fk('menu_item_id', 'menu_items')})`,
  ];
}

const kitchenCounted = { column: 'status', values: ['placed', 'ready'] };

export async function kitchen(dialect: Dialect, endpoints?: Record<string, Record<string, unknown>>): Promise<World> {
  return filled(
    dialect,
    {
      zone: KITCHEN_ZONE,
      ddl: kitchenDdl,
      overrides: (id) => [
        {
          op: 'table.capacity',
          table: 'orders',
          value: {
            kind: 'slot',
            slot: 'pickup_at',
            amount: 1,
            perSlot: { table: id('settings'), column: 'slot_capacity' },
            slotMinutes: { table: id('settings'), column: 'slot_minutes' },
            countWhere: kitchenCounted,
            hours: { table: id('hours'), weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' },
            closures: { table: id('closures'), from: 'from_date', to: 'to_date', active: 'active' },
            pauses: { table: id('slot_pauses'), slot: 'slot_at', active: 'active' },
            noticeMinutes: { table: id('settings'), column: 'lead_minutes' },
            windowDays: 1,
          },
        },
        {
          op: 'table.capacity',
          table: 'order_items',
          value: {
            kind: 'parent',
            via: 'menu_item_id',
            size: { column: 'stock_today', onDay: 'stock_on' },
            amount: 'qty',
            countWhere: { ...kitchenCounted, via: 'order_id' },
            day: { via: 'order_id', column: 'pickup_at' },
          },
        },
      ],
      ...(endpoints === undefined ? {} : { endpoints }),
    },
    async (w) => {
      await w.seed('settings', [{ slot_capacity: 6, slot_minutes: 15, lead_minutes: 20 }]);
      await w.seed('hours', [
        { weekday: 'mon', open: false, opens: null, closes: null },
        ...['tue', 'wed', 'thu', 'sat', 'sun'].map((weekday) => ({ weekday, open: true, opens: '12:00', closes: '21:00' })),
        { weekday: 'fri', open: true, opens: '18:00', closes: '02:00' },
      ]);
      await w.seed('closures', [{ from_date: '2026-07-30', to_date: '2026-07-30', active: true }]);
      await w.seed('slot_pauses', [{ slot_at: iso('2026-07-28 12:30'), active: true }]);
      await w.seed('menu_items', [
        { id: 1, name: 'Diavola', stock_today: 2, stock_on: '2026-07-28' },
        { id: 2, name: 'Margherita', stock_today: null, stock_on: null },
        { id: 3, name: 'Calzone', stock_today: 0, stock_on: '2026-07-28' },
      ]);
      // Two orders already in the 12:15 slot.
      await w.seed('orders', [
        { pickup_at: iso('2026-07-28 12:15'), status: 'placed' },
        { pickup_at: iso('2026-07-28 12:15'), status: 'ready' },
      ]);
    },
  );
}

/* --------------------------------------------------------------- the show */

function neonDdl(dialect: Dialect): string[] {
  const t = types(dialect);
  return [
    `create table rooms (id ${t.key}, capacity integer not null)`,
    `create table events (id ${t.key}, room_id integer, name ${t.text(40)}, ${t.fk('room_id', 'rooms')})`,
    `create table ticket_types (id ${t.key}, event_id integer, name ${t.text(40)}, capacity integer, max_per_order integer, sales_start ${t.at} null, sales_end ${t.at} null, visibility ${t.text(8)} not null default 'public', ${t.fk('event_id', 'events')})`,
    `create table waitlist (id ${t.key}, email ${t.text(80)}, offered_until ${t.at} null)`,
    `create table orders (id ${t.key}, status ${t.text(16)} not null default 'held', held_until ${t.at} null, waitlist_id integer, ${t.fk('waitlist_id', 'waitlist')})`,
    `create table tickets (id ${t.key}, order_id integer not null, ticket_type_id integer not null, event_id integer, status ${t.text(16)} not null default 'valid', ${t.fk('order_id', 'orders')}, ${t.fk('ticket_type_id', 'ticket_types')}, ${t.fk('event_id', 'events')})`,
  ];
}

export const NEON_RULE = {
  kind: 'parent',
  via: 'ticket_type_id',
  size: { column: 'capacity' },
  countWhere: [
    { column: 'status', values: ['valid', 'returned'] },
    { via: 'order_id', column: 'status', values: ['held', 'offered', 'paid'] },
  ],
  window: { opens: 'sales_start', closes: 'sales_end' },
  perWrite: { max: { column: 'max_per_order' }, within: 'order_id' },
  also: [{ via: 'event_id', size: { via: 'room_id', column: 'capacity' } }],
  lockBy: 'event_id',
  hold: { via: 'order_id', states: ['held', 'offered'], column: { column: 'offered_until', via: 'waitlist_id', or: [{ column: 'held_until' }] } },
  reserved: { states: ['returned'] },
};

export async function neon(dialect: Dialect, roomCapacity = 300, endpoints?: Record<string, Record<string, unknown>>): Promise<World> {
  const spec = {
    zone: KITCHEN_ZONE,
    ddl: neonDdl,
    overrides: () => [
      { op: 'column.copy', table: 'tickets', column: 'event_id', value: { via: 'ticket_type_id', from: 'event_id' } },
      { op: 'table.capacity', table: 'tickets', value: NEON_RULE },
    ],
    ...(endpoints === undefined ? {} : { endpoints }),
  };
  return filled(dialect, spec, async (w) => {
  await w.seed('rooms', [{ id: 1, capacity: roomCapacity }]);
  await w.seed('events', [{ id: 1, room_id: 1, name: 'Neon' }]);
  await w.seed('ticket_types', [
    { id: 1, event_id: 1, name: 'Neon Standard', capacity: 260, max_per_order: 6, sales_start: later(-7 * 24 * 60), sales_end: later(24 * 60), visibility: 'public' },
    { id: 2, event_id: 1, name: 'Balcony', capacity: 40, max_per_order: 6, sales_start: later(24 * 60), sales_end: later(3 * 24 * 60), visibility: 'public' },
    // Sold at the box office only: never a guest's to see.
    { id: 3, event_id: 1, name: 'Guest list', capacity: 20, max_per_order: 2, sales_start: null, sales_end: null, visibility: 'box' },
  ]);
  // 243 sold on one paid order; 3 held for ten minutes.
  await w.seed('orders', [
    { id: 1, status: 'paid', held_until: later(-60) },
    { id: 2, status: 'held', held_until: later(10) },
  ]);
  await w.seed('tickets', [
    ...Array.from({ length: 243 }, () => ({ order_id: 1, ticket_type_id: 1, event_id: 1, status: 'valid' })),
    ...Array.from({ length: 3 }, () => ({ order_id: 2, ticket_type_id: 1, event_id: 1, status: 'valid' })),
  ]);
  });
}

/* -------------------------------------------------------------- the house */

function houseDdl(dialect: Dialect): string[] {
  const t = types(dialect);
  return [
    `create table settings (id ${t.key}, max_nights integer, ahead_days integer)`,
    `create table room_types (id ${t.key}, name ${t.text(40)}, sleeps integer)`,
    `create table rooms (id ${t.key}, room_type_id integer not null, number ${t.text(8)}, ${t.fk('room_type_id', 'room_types')})`,
    `create table room_closures (id ${t.key}, room_id integer not null, from_date date not null, to_date date null, ${t.fk('room_id', 'rooms')})`,
    `create table stays (id ${t.key}, arrive date not null, depart date not null, room_type_id integer not null, room_id integer null, status ${t.text(16)} not null default 'booked', ${t.fk('room_type_id', 'room_types')}, ${t.fk('room_id', 'rooms')})`,
    `create table extras (id ${t.key}, name ${t.text(40)}, spaces integer null)`,
    `create table stay_extras (id ${t.key}, stay_id integer not null, extra_id integer not null, ${t.fk('stay_id', 'stays')}, ${t.fk('extra_id', 'extras')})`,
  ];
}

const houseCounted = { column: 'status', values: ['booked', 'in_house'] };

export async function house(dialect: Dialect, endpoints?: Record<string, Record<string, unknown>>): Promise<World> {
  return filled(
    dialect,
    {
      ...(endpoints === undefined ? {} : { endpoints }),
      zone: KITCHEN_ZONE,
      ddl: houseDdl,
      overrides: (id) => [
        {
          op: 'table.capacity',
          table: 'stays',
          value: {
            rules: [
              {
                kind: 'night',
                from: 'arrive',
                to: 'depart',
                countWhere: houseCounted,
                pool: {
                  via: 'room_type_id',
                  count: { table: id('rooms'), column: 'room_type_id', outOfService: { table: id('room_closures'), room: 'room_id', from: 'from_date', to: 'to_date' } },
                  fits: { column: 'sleeps' },
                  given: { via: 'room_id', column: 'room_type_id' },
                },
                nights: { min: 1, max: { table: id('settings'), column: 'max_nights' }, minByArrival: { sat: 2 }, aheadDays: { table: id('settings'), column: 'ahead_days' } },
              },
              {
                kind: 'night',
                from: 'arrive',
                to: 'depart',
                countWhere: houseCounted,
                pool: { via: 'room_id', size: 1, outOfService: { table: id('room_closures'), room: 'room_id', from: 'from_date', to: 'to_date' } },
              },
            ],
          },
        },
        {
          op: 'table.capacity',
          table: 'stay_extras',
          value: {
            kind: 'night',
            from: { via: 'stay_id', column: 'arrive' },
            to: { via: 'stay_id', column: 'depart' },
            countWhere: { ...houseCounted, via: 'stay_id' },
            pool: { via: 'extra_id', size: { column: 'spaces' } },
          },
        },
      ],
    },
    async (w) => {
      await w.seed('settings', [{ max_nights: 14, ahead_days: 365 }]);
      await w.seed('room_types', [
        { id: 1, name: 'Loft', sleeps: 2 },
        { id: 2, name: 'Garden', sleeps: 3 },
        { id: 3, name: 'Harbour', sleeps: 2 },
      ]);
      const rooms = [
        ...[101, 102, 103, 104].map((n) => ({ room_type_id: 1, number: String(n) })),
        ...Array.from({ length: 14 }, (_, i) => ({ room_type_id: 2, number: String(105 + i) })),
        ...[204, 205, 206].map((n) => ({ room_type_id: 3, number: String(n) })),
      ];
      await w.seed('rooms', rooms.map((room, i) => ({ id: i + 1, ...room })));
      await w.seed('extras', [{ id: 1, name: 'Parking', spaces: 2 }]);
    },
  );
}

export const roomId = async (w: World, number: string) => (await w.query(`select id from rooms where number = '${number}'`))[0]!['id'];

