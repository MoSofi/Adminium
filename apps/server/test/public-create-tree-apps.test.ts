// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two other shapes of a guest's create with its rows: a ticket order —
 * one level, each ticket its own code, tickets counted, every ticket's type
 * of the order's own event — and a stay with its extras, whose guests fit the
 * room type; the price check on both, and the desk held to the same
 * agreement. On every engine.
 */
import { publicEndpointsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver } from './invoicing-routes.helpers.js';
import { cents } from './order-tree-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });

function app(key: string, tables: Record<string, unknown>[], rows: string, publicAccess: Record<string, unknown>[]): Record<string, unknown> {
  const manifest = invoicingManifest(tables);
  manifest['key'] = key;
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = publicAccess;
  return manifest;
}

/** A box office: two events, each with its ticket types; an order of tickets for one event. */
function boxOffice(): Record<string, unknown> {
  return app(
    'waves',
    [
      { ref: 'events', columns: [id, text('name')] },
      { ref: 'ticket_types', columns: [id, { ref: 'event_id', type: 'fk', references: 'events' }, text('name', 60), { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
      {
        ref: 'orders',
        columns: [
          id,
          { ref: 'event_id', type: 'fk', references: 'events' },
          text('email', 254, { rules: { validation: { format: 'email' } } }),
          text('name', 80),
          money('total', { rollup: { from: 'tickets', via: 'order_id', sum: 'price' } }),
          { ref: 'ticket_count', type: 'int', nullable: true, rules: { rollup: { from: 'tickets', via: 'order_id', count: true } } },
        ],
      },
      {
        ref: 'tickets',
        columns: [
          id,
          { ref: 'order_id', type: 'fk', references: 'orders' },
          { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' },
          text('holder_name', 80, { nullable: true }),
          money('price', { copy: { via: 'ticket_type_id', from: 'price' } }),
          text('code', 12, { nullable: true, rules: { code: { length: 8 } } }),
        ],
      },
    ],
    'orders',
    [
      { table: 'events', methods: ['GET'], select: ['id', 'name'] },
      { table: 'ticket_types', methods: ['GET'], select: ['id', 'event_id', 'name', 'price'] },
      {
        table: 'orders',
        methods: ['POST'],
        humanCheck: true,
        writable: ['event_id', 'email', 'name'],
        requires: ['email', 'name'],
        select: ['id', 'total', 'ticket_count'],
        children: {
          tickets: {
            via: 'order_id',
            writable: ['ticket_type_id', 'holder_name'],
            select: ['id', 'code', 'price'],
            min: 1,
            max: 12,
            plainText: ['holder_name'],
            // A ticket is for the order's own event: a cheap workshop's type in a concert's order is not offered.
            agrees: [{ column: 'ticket_type_id', path: ['event_id'], eq: { parent: 'event_id' } }],
          },
        },
        dryRun: true,
        expect: 'total',
      },
    ],
  );
}

/** An inn: room types that sleep so many, extras, a stay with its extras. */
function inn(): Record<string, unknown> {
  return app(
    'inn',
    [
      { ref: 'room_types', columns: [id, text('name', 60), { ref: 'sleeps', type: 'int', default: 2 }] },
      { ref: 'extras', columns: [id, text('name', 60), { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
      {
        ref: 'stays',
        columns: [
          id,
          { ref: 'room_type_id', type: 'fk', references: 'room_types' },
          text('email', 254, { rules: { validation: { format: 'email' } } }),
          text('name', 80),
          { ref: 'guests', type: 'int', default: 1, rules: { validation: { min: 1, max: 6 } } },
          money('extras_total', { rollup: { from: 'stay_extras', via: 'stay_id', sum: 'price' } }),
          { ref: 'extra_count', type: 'int', nullable: true, rules: { rollup: { from: 'stay_extras', via: 'stay_id', count: true } } },
          money('total', { formula: { add: [150, { coalesce: ['extras_total', 0] }] } }),
        ],
      },
      {
        ref: 'stay_extras',
        columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'extra_id', type: 'fk', references: 'extras' }, money('price', { copy: { via: 'extra_id', from: 'price' } })],
      },
    ],
    'stays',
    [
      { table: 'room_types', methods: ['GET'], select: ['id', 'name', 'sleeps'] },
      { table: 'extras', methods: ['GET'], select: ['id', 'name', 'price'] },
      {
        table: 'stays',
        methods: ['POST'],
        humanCheck: true,
        writable: ['room_type_id', 'email', 'name', 'guests'],
        requires: ['email', 'name'],
        select: ['id', 'extras_total', 'extra_count', 'total'],
        agrees: [{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }],
        children: { stay_extras: { via: 'stay_id', writable: ['extra_id'], select: ['id', 'price'], max: 10 } },
        dryRun: true,
        expect: 'total',
      },
    ],
  );
}

describe.each(LEGS)('a ticket order and a stay, over the public API — %s', (dialect, available) => {
  let tickets: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let stays: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let box: Served;
  let desk: Served;
  let ip = 0;
  beforeAll(async () => {
    if (!available) return;
    tickets = await installInvoicing(dialect, boxOffice());
    await tickets.rows(`INSERT INTO waves_events (id, name) VALUES (1, 'Night Tide'), (2, 'Glaze Workshop')`);
    await tickets.rows(`INSERT INTO waves_ticket_types (id, event_id, name, price) VALUES (1, 1, 'Standard', 45), (2, 1, 'Balcony', 60), (3, 2, 'Workshop', 20)`);
    box = await servePublic(tickets, (tickets.reply['publicAccess'] as { keyId: string }).keyId);
    stays = await installInvoicing(dialect, inn());
    await stays.rows(`INSERT INTO inn_room_types (id, name, sleeps) VALUES (1, 'Snug', 1), (2, 'Garden', 2)`);
    await stays.rows(`INSERT INTO inn_extras (id, name, price) VALUES (1, 'Breakfast', 32), (2, 'Parking', 15)`);
    desk = await servePublic(stays, (stays.reply['publicAccess'] as { keyId: string }).keyId);
  }, 240_000);
  afterAll(async () => {
    await box?.close();
    await desk?.close();
    await tickets?.close();
    await stays?.close();
  });

  const post = async (served: Served, url: string, payload: Record<string, unknown>, proof = true) => {
    ip += 1;
    const address = `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
    let headers = served.headers();
    if (proof) {
      const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers });
      const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
      headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    }
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${url}`, remoteAddress: address, headers, payload });
  };
  const order = (types: number[], event = 1, more: Record<string, unknown> = {}) => ({
    values: { event_id: event, email: 'mia@example.com', name: 'Mia' },
    children: { tickets: types.map((type) => ({ values: { ticket_type_id: type } })) },
    ...more,
  });
  const count = async (h: InvoicingHarness, ref: string) => Number((await h.rows(`select count(*) as n from ${h.real(ref)}`))[0]!['n']);

  it.runIf(available)('two Standard and one Balcony: three tickets, three codes, counted, in one write', async () => {
    const res = await post(box, 'waves_orders', order([1, 1, 2]));
    expect(res.statusCode, res.body).toBe(201);
    const reply = res.json() as { data: Record<string, unknown>; children: { tickets: { data: Record<string, unknown> }[] } };
    expect([cents(reply.data['total']), Number(reply.data['ticket_count'])]).toEqual(['150.00', 3]);
    const codes = reply.children.tickets.map((ticket) => String(ticket.data['code']));
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) expect(code).toHaveLength(8);
  });

  it.runIf(available)('shown $81.00 for two Standard, the order comes to $90.00: refused with the new total, nothing written', async () => {
    const before = await count(tickets!, 'tickets');
    const res = await post(box, 'waves_orders', order([1, 1], 1, { expect: { total: '81.00' } }));
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_PRICE_CHANGED', params: { total: '90.00' } } });
    expect(await count(tickets!, 'tickets')).toBe(before);
  });

  it.runIf(available)("a ticket of another event's type in this event's order is not offered", async () => {
    const before = await count(tickets!, 'orders');
    const res = await post(box, 'waves_orders', order([1, 3]));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { child: 'tickets', index: 1, path: ['tickets', 1], column: 'ticket_type_id', reason: 'not-offered' } } });
    expect(await count(tickets!, 'orders')).toBe(before);
  });

  it.runIf(available)("a dry run of tickets shows their prices, never their codes", async () => {
    const res = await post(box, 'waves_orders/dry-run', order([1, 2]), false);
    expect(res.statusCode, res.body).toBe(200);
    const quote = res.json() as { data: Record<string, unknown>; children: { tickets: { data: Record<string, unknown> }[] } };
    expect(cents(quote.data['total'])).toBe('105.00');
    expect(quote.children.tickets.map((ticket) => Object.keys(ticket.data))).toEqual([['price'], ['price']]);
  });

  const stay = (room: number, guests: number, extras: number[], more: Record<string, unknown> = {}) => ({
    values: { room_type_id: room, email: 'leo@example.com', name: 'Leo', guests },
    ...(extras.length === 0 ? {} : { children: { stay_extras: extras.map((extra) => ({ values: { extra_id: extra } })) } }),
    ...more,
  });

  it.runIf(available)('a stay with breakfast and parking settles its extras and total', async () => {
    const res = await post(desk, 'inn_stays', stay(2, 2, [1, 2]));
    expect(res.statusCode, res.body).toBe(201);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect([cents(data['extras_total']), Number(data['extra_count']), cents(data['total'])]).toEqual(['47.00', 2, '197.00']);
  });

  it.runIf(available)('three guests in a Snug that sleeps one are refused; so is a minus guest', async () => {
    const before = await count(stays!, 'stays');
    const many = await post(desk, 'inn_stays', stay(1, 3, [1]));
    expect(many.statusCode, many.body).toBe(400);
    expect(many.json()).toMatchObject({ error: { params: { column: 'guests', reason: 'too-many' } } });
    const minus = await post(desk, 'inn_stays', stay(2, -2, []));
    expect(minus.statusCode, minus.body).toBe(400);
    expect(minus.json()).toMatchObject({ error: { params: { column: 'guests', reason: 'too-small' } } });
    expect(await count(stays!, 'stays')).toBe(before);
  });

  it.runIf(available)('a stay with no extras takes the same path: the price is checked', async () => {
    const wrong = await post(desk, 'inn_stays', stay(2, 1, [], { expect: { total: '140.00' } }));
    expect(wrong.statusCode, wrong.body).toBe(409);
    expect(wrong.json()).toMatchObject({ error: { code: 'PUBLIC_PRICE_CHANGED', params: { total: '150.00' } } });
    const right = await post(desk, 'inn_stays', stay(2, 1, [], { expect: { total: '150.00' } }));
    expect(right.statusCode, right.body).toBe(201);
  });

  it.runIf(available)("the desk's own booking is held to the same fit: three guests in a Snug", async () => {
    const r = await dataRoutesOver(stays!, dialect);
    try {
      for (const row of await publicEndpointsRepo(stays!.meta).listByConnection(stays!.connectionId)) {
        await publicEndpointsRepo(r.t.meta).create({ connectionId: r.connectionId, ref: row.ref, origin: row.origin, definition: row.definition, managedBy: row.managedBy });
      }
      const extras = `fk:${r.table('stay_extras')}(stay_id)->${r.table('stays')}(id)`;
      const refused = await r.post('stays', { values: { room_type_id: 1, email: 'desk@example.com', name: 'Walk-in', guests: 3 }, children: { [extras]: [{ values: { extra_id: 1 } }] } });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json<{ error: { details: Record<string, unknown> } }>().error.details).toMatchObject({ fields: { guests: { code: 'too-many' } } });
      // A booking with no extras is held to it too.
      const bare = await r.post('stays', { values: { room_type_id: 1, email: 'desk@example.com', name: 'Walk-in', guests: 2 } });
      expect(bare.statusCode, bare.body).toBe(422);
      const fits = await r.post('stays', { values: { room_type_id: 2, email: 'desk@example.com', name: 'Walk-in', guests: 2 }, children: { [extras]: [{ values: { extra_id: 1 } }] } });
      expect(fits.statusCode, fits.body).toBe(201);
    } finally {
      await r.close();
    }
  });
});
