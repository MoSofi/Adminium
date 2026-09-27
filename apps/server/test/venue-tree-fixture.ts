// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A box office and an inn in one app, for the tests of a guest's and a
 * desk's writes with their child rows: ticket orders whose tickets climb into
 * what each type has sold (a total outside the order), stays that fit their
 * room, extras on a stay no more than each allows. With `limited`, each type
 * sells no more tickets than its capacity.
 */
import { invoicingManifest } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });

/** A box office and an inn in one app: ticket orders with their tickets, stays that fit their room, extras on a stay. */
export function venue(opts: { limited?: boolean } = {}): Record<string, unknown> {
  const manifest = invoicingManifest([
    { ref: 'events', columns: [id, text('name')] },
    {
      ref: 'ticket_types',
      columns: [
        id,
        { ref: 'event_id', type: 'fk', references: 'events' },
        text('name', 60),
        { ref: 'price', type: 'decimal', scale: 2, default: 0 },
        { ref: 'on_sale', type: 'bool', default: true },
        ...(opts.limited === true ? [{ ref: 'capacity', type: 'int', nullable: true }] : []),
        // What a type has sold: a total outside the order that the order's tickets climb into.
        { ref: 'sold', type: 'int', nullable: true, rules: { rollup: { from: 'tickets', via: 'ticket_type_id', count: true } } },
      ],
    },
    { ref: 'buyers', columns: [id, text('name', 80), text('email', 254), text('phone', 20)] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'buyer_id', type: 'fk', references: 'buyers', nullable: true },
        { ref: 'event_id', type: 'fk', references: 'events' },
        text('email', 254, { rules: { validation: { format: 'email' } } }),
        text('name', 80),
        { ref: 'status', type: 'enum', enum: ['open', 'done'], default: 'open' },
        text('client_key', 64, { nullable: true, unique: true }),
        money('total', { rollup: { from: 'tickets', via: 'order_id', sum: 'price' } }),
      ],
    },
    {
      ref: 'tickets',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'orders' },
        { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' },
        money('price', { copy: { via: 'ticket_type_id', from: 'price' } }),
        text('holder', 40, { nullable: true, rules: { validation: { maxLength: 40 } } }),
      ],
      ...(opts.limited === true ? { capacity: { kind: 'parent', via: 'ticket_type_id', size: { column: 'capacity' } } } : {}),
    },
    { ref: 'room_types', columns: [id, text('name', 60), { ref: 'sleeps', type: 'int', default: 2 }] },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'buyer_id', type: 'fk', references: 'buyers', nullable: true },
        { ref: 'room_type_id', type: 'fk', references: 'room_types' },
        { ref: 'guests', type: 'int', default: 1, rules: { validation: { min: 1, max: 6 } } },
        text('note', 200, { nullable: true }),
      ],
    },
    { ref: 'extras', columns: [id, text('name', 60), { ref: 'max_qty', type: 'int', default: 2 }] },
    {
      ref: 'stay_extras',
      columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'extra_id', type: 'fk', references: 'extras' }, { ref: 'qty', type: 'int', default: 1, rules: { validation: { min: 1, max: 9 } } }],
    },
  ]);
  manifest['key'] = 'rv';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  const fits = [{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }];
  manifest['publicAccess'] = [
    { table: 'events', methods: ['GET'], select: ['id', 'name'] },
    // A type taken off sale is hidden: no read of the key shows it.
    { table: 'ticket_types', methods: ['GET'], select: ['id', 'event_id', 'name', 'price'], filters: [{ column: 'on_sale', op: 'eq', value: true }] },
    { table: 'room_types', methods: ['GET'], select: ['id', 'name', 'sleeps'] },
    { table: 'extras', methods: ['GET'], select: ['id', 'name', 'max_qty'] },
    { table: 'buyers', methods: ['GET'], select: ['name'], claim: { match: ['email', 'phone'] }, humanCheck: true },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      writable: ['event_id', 'email', 'name', 'client_key'],
      requires: ['email', 'name'],
      select: ['id', 'total'],
      claimedBy: { table: 'buyers', column: 'buyer_id', optional: true },
      maxOpen: { column: 'status', values: ['open'], n: 1 },
      anonymous: { perValue: { columns: ['email'], n: 2 } },
      children: { tickets: { via: 'order_id', writable: ['ticket_type_id', 'holder'], select: ['id', 'price'], min: 1, max: 6, plainText: ['holder'] } },
      dryRun: true,
      clientKey: 'client_key',
    },
    // A stay anyone may ask for: its guests fit the room — nothing else makes this entry a tree.
    { table: 'stays', methods: ['POST'], humanCheck: true, writable: ['room_type_id', 'guests', 'note'], select: ['id', 'guests'], agrees: fits },
    // A signed-in guest's own stay: changed, and tried first, within what the room sleeps.
    { table: 'stays', methods: ['GET', 'PATCH'], select: ['id', 'guests', 'room_type_id'], writable: ['guests', 'room_type_id'], claimedBy: { table: 'buyers', column: 'buyer_id' }, agrees: fits, dryRun: true },
    // An extra added to a stay the guest can see, no more of it than it allows.
    {
      table: 'stay_extras',
      methods: ['POST'],
      writable: ['stay_id', 'extra_id', 'qty'],
      select: ['id', 'qty'],
      visibleWith: { table: 'stays', via: 'stay_id' },
      agrees: [{ column: 'qty', lte: { via: 'extra_id', column: 'max_qty' } }],
    },
  ];
  return manifest;
}

export const SEED = [
  "INSERT INTO rv_events (id, name) VALUES (1, 'Gala')",
  // Standard on sale; the preview night hidden (taken off sale).
  "INSERT INTO rv_ticket_types (id, event_id, name, price, on_sale) VALUES (1, 1, 'Standard', 25, true), (2, 1, 'Preview', 10, false)",
  "INSERT INTO rv_buyers (id, name, email, phone) VALUES (1, 'Ada', 'ada@example.com', '0700')",
  "INSERT INTO rv_room_types (id, name, sleeps) VALUES (1, 'Double', 2), (2, 'Family', 4)",
  "INSERT INTO rv_extras (id, name, max_qty) VALUES (1, 'Breakfast', 2)",
  // Stay 1, Ada's (its key left to the table, so the next is 2 on every engine).
  'INSERT INTO rv_stays (buyer_id, room_type_id, guests) VALUES (1, 1, 2)',
];

