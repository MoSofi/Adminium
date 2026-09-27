// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One live hold per buyer, over the public API of a box office installed by
 * the real installer, on every engine: a new hold made with the old hold's own
 * link lets the old one go in the same write (its places are there for the new
 * one), and so does a signed-in guest's new hold with their other holds; the
 * same address typed in another browser lets nothing go; two holds made at
 * once by one buyer leave exactly one live — never two.
 */
import { validateManifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readInstant } from '../src/crud/moments.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, ...more });

export function boxOffice(): Doc {
  const manifest = invoicingManifest([
    { ref: 'settings', columns: [id, { ref: 'hold_minutes', type: 'int', default: 10 }] },
    {
      ref: 'customers',
      columns: [id, text('email', 254, { nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } }), text('name', 60, { nullable: true })],
    },
    { ref: 'ticket_types', columns: [id, text('name', 60), { ref: 'capacity', type: 'int', nullable: true }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
        text('email', 254, { rules: { validation: { format: 'email' } } }),
        text('name', 120),
        { ref: 'status', type: 'enum', enum: ['held', 'confirmed', 'expired'], default: 'held' },
        { ref: 'held_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { minutes: { table: 'settings', column: 'hold_minutes' } } }, on: 'create' } } },
        text('link_token', 16, { nullable: true, rules: { code: { length: 16 } } }),
      ],
      states: {
        column: 'status',
        initial: 'held',
        moves: { held: ['confirmed', 'expired'] },
        timed: [{ from: 'held', to: 'expired', at: { column: 'held_until' } }],
      },
    },
    {
      ref: 'tickets',
      columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' }],
      capacity: {
        kind: 'parent',
        via: 'ticket_type_id',
        size: { column: 'capacity' },
        countWhere: { column: 'status', values: ['held', 'confirmed'], via: 'order_id' },
        hold: { column: 'held_until', states: ['held'], via: 'order_id' },
      },
    },
  ]);
  manifest['key'] = 'box';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicKeys'] = { link: {} };
  manifest['publicAccess'] = [
    { table: 'customers', methods: ['GET'], select: ['name', 'email'], writable: [], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
    { table: 'ticket_types', methods: ['GET'], select: ['id', 'name'] },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      level: 'verified',
      select: ['id', 'status'],
      writable: ['email', 'name'],
      requires: ['email', 'name'],
      claimedBy: { table: 'customers', column: 'customer_id', optional: true },
      identity: { table: 'customers', email: 'email', link: 'customer_id', fill: { name: 'name' } },
      shareLink: 'link_token',
      anonymous: { perValue: { columns: ['email'], n: 20 } },
      children: { tickets: { via: 'order_id', writable: ['ticket_type_id'], select: ['id'], min: 1, max: 6 } },
    },
    { table: 'orders', key: 'link', methods: ['GET'], select: ['id', 'status'], claim: { by: 'token', column: 'link_token', own: true, address: 'email' } },
  ];
  return manifest;
}

describe('the box office', () => {
  it('validates', () => {
    const result = validateManifest(boxOffice());
    expect(result.ok ? [] : result.issues).toEqual([]);
  });
});

describe.each(LEGS)('one live hold per buyer — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let box: Served;
  let g: ReturnType<typeof guest>;
  let orders: string;
  let type = 0;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOffice());
    await mailReady(h.meta);
    orders = h.real('orders');
    await h.rows(`insert into ${h.real('settings')} (hold_minutes) values (10)`);
    for (const email of ['mia@example.com', 'noa@example.com']) await h.rows(`insert into ${h.real('customers')} (email, name) values ('${email}', 'M')`);
    box = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(box, h);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await box.close();
    await h.close();
  });

  /** A ticket type with this many places, of its own. */
  const places = async (n: number) => {
    type += 1;
    await h.rows(`insert into ${h.real('ticket_types')} (id, name, capacity) values (${type}, 'Type ${type}', ${n})`);
    return type;
  };
  const hold = (email: string, ticketType: number, more: Doc = {}, session?: string) =>
    g.request('POST', `/records/${orders}_verified`, {
      payload: { values: { email, name: 'Guest' }, children: { tickets: [{ values: { ticket_type_id: ticketType } }] }, ...more },
      proof: 'write',
      ...(session === undefined ? {} : { session }),
    });
  const live = async (where: string) => {
    const rows = await h.rows(`select id, status, held_until from ${orders} where ${where}`);
    return rows.filter((row) => {
      const end = readInstant(row['held_until']);
      return row['status'] === 'held' && (end === null || end.getTime() > Date.now());
    }).length;
  };

  it.skipIf(!available)("lets the old hold go when the page replaces it by its own link: its place is the new one's", async () => {
    const one = await places(1);
    const first = await hold('ana@example.com', one);
    expect(first.statusCode, first.body).toBe(201);
    const token = (first.json() as { link: { session: string } }).link.session;
    // Without the page's session, the one place is taken.
    const stranger = await hold('ana2@example.com', one);
    expect(stranger.statusCode).toBe(409);
    expect(box.codeOf(stranger)).toBe('PUBLIC_SOLD_OUT');
    const second = await hold('ana@example.com', one, { replaces: token });
    expect(second.statusCode, second.body).toBe(201);
    // The page keeps one session: it now opens the new hold.
    expect((second.json() as { link: { session: string } }).link.session).toBe(token);
    const firstId = (first.json() as { data: { id: number } }).data.id;
    expect(await live(`id = ${firstId}`)).toBe(0);
    // The timed move that follows a lapse moves it on.
    await runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, new Date(Date.now() + 1_000));
    expect((await h.rows(`select status from ${orders} where id = ${firstId}`))[0]!['status']).toBe('expired');
  });

  it.skipIf(!available)('lets nothing go for the same address typed in another browser', async () => {
    const one = await places(1);
    const first = await hold('ben@example.com', one);
    expect(first.statusCode).toBe(201);
    const again = await hold('ben@example.com', one);
    expect(again.statusCode).toBe(409);
    expect(box.codeOf(again)).toBe('PUBLIC_SOLD_OUT');
    expect(await live(`id = ${(first.json() as { data: { id: number } }).data.id}`)).toBe(1);
  });

  it.skipIf(!available)("lets a signed-in guest's other holds go", async () => {
    const one = await places(1);
    const session = await g.signIn('mia@example.com');
    const first = await hold('mia@example.com', one, {}, session);
    expect(first.statusCode, first.body).toBe(201);
    const second = await hold('mia@example.com', one, {}, session);
    expect(second.statusCode, second.body).toBe(201);
    const mia = (await h.rows(`select id from ${h.real('customers')} where email = 'mia@example.com'`))[0]!['id'];
    expect(await live(`customer_id = ${Number(mia)}`)).toBe(1);
  });

  it.skipIf(!available)('makes nothing of a link to a hold already over', async () => {
    const two = await places(2);
    const first = await hold('cy@example.com', two);
    const token = (first.json() as { link: { session: string } }).link.session;
    await h.rows(`update ${orders} set held_until = ${dialect === 'sqlite' ? `'2020-01-01T00:00:00.000Z'` : `'2020-01-01 00:00:00'`} where id = ${(first.json() as { data: { id: number } }).data.id}`);
    const next = await hold('cy@example.com', two, { replaces: token });
    expect(next.statusCode, next.body).toBe(201);
    // A session that opens nothing lets nothing go, and says so to nobody.
    const nonsense = await hold('cy@example.com', two, { replaces: `adm_pubs_${'Z'.repeat(40)}` });
    expect(nonsense.statusCode, nonsense.body).toBe(201);
  });

  it.skipIf(!available)('leaves one live hold when one signed-in buyer makes several at once', async () => {
    const many = await places(20);
    const session = await g.signIn('noa@example.com');
    const noa = Number((await h.rows(`select id from ${h.real('customers')} where email = 'noa@example.com'`))[0]!['id']);
    const results = await Promise.all(Array.from({ length: 6 }, () => hold('noa@example.com', many, {}, session)));
    for (const res of results) expect([201, 409], res.body).toContain(res.statusCode);
    expect(results.filter((res) => res.statusCode === 201).length).toBeGreaterThanOrEqual(1);
    for (const res of results.filter((r) => r.statusCode === 409)) expect(box.codeOf(res)).toBe('PUBLIC_SLOT_BUSY');
    expect(await live(`customer_id = ${noa}`)).toBe(1);
  });

  it.skipIf(!available)('holds once for a page that sends its session twice, one after the other or at once', async () => {
    const many = await places(20);
    const first = await hold('dee@example.com', many);
    const token = (first.json() as { link: { session: string } }).link.session;
    const again = await hold('dee@example.com', many, { replaces: token });
    const twice = await hold('dee@example.com', many, { replaces: token });
    expect([again.statusCode, twice.statusCode]).toEqual([201, 201]);
    expect(await live(`email = 'dee@example.com'`)).toBe(1);
    const results = await Promise.all(Array.from({ length: 4 }, () => hold('dee@example.com', many, { replaces: token })));
    for (const res of results) expect([201, 409], res.body).toContain(res.statusCode);
    expect(await live(`email = 'dee@example.com'`)).toBe(1);
  });
});
