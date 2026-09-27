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
import { holdsOf, replaceHolds } from '../src/public-api/hold-replace.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { boxOffice } from './hold-replace-fixture.js';

export { boxOffice };

type Doc = Record<string, unknown>;
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
    for (const email of ['mia@example.com', 'noa@example.com', 'gus@example.com', 'hal@example.com']) await h.rows(`insert into ${h.real('customers')} (email, name) values ('${email}', 'M')`);
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

  it.skipIf(!available)('keeps two signed-in buyers apart when both hold at once: a moment\'s wait at most, one live hold each', async () => {
    const many = await places(40);
    const [gus, hal] = [await g.signIn('gus@example.com'), await g.signIn('hal@example.com')];
    const sends = [gus, hal, gus, hal, gus, hal].map((session, i) => hold(i % 2 === 0 ? 'gus@example.com' : 'hal@example.com', many, {}, session));
    const results = await Promise.all(sends);
    for (const res of results) expect([201, 409], res.body).toContain(res.statusCode);
    for (const res of results.filter((r) => r.statusCode === 409)) expect(box.codeOf(res)).toBe('PUBLIC_SLOT_BUSY');
    for (const email of ['gus@example.com', 'hal@example.com']) {
      const person = Number((await h.rows(`select id from ${h.real('customers')} where email = '${email}'`))[0]!['id']);
      expect(await live(`customer_id = ${String(person)}`)).toBe(1);
    }
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

  it.skipIf(!available)('holds once for a page that sends its session with other tickets at once, whose places are counted apart', async () => {
    const first = await hold('eve@example.com', await places(20));
    const token = (first.json() as { link: { session: string } }).link.session;
    // Each its own ticket type: no shared limit queues them, so they meet at the held row itself.
    const types = [await places(20), await places(20), await places(20), await places(20)];
    const results = await Promise.all(types.map((ticketType) => hold('eve@example.com', ticketType, { replaces: token })));
    for (const res of results) expect([201, 409], res.body).toContain(res.statusCode);
    expect(results.filter((res) => res.statusCode === 201).length).toBeGreaterThanOrEqual(1);
    expect(await live(`email = 'eve@example.com'`)).toBe(1);
  });

  it.skipIf(!available)("follows a page's session that moved on while the row it pointed at was waited for, and lets that hold go", async () => {
    const many = await places(20);
    const first = await hold('fay@example.com', many);
    const moved = await hold('fay@example.com', many);
    const [was, now] = [(first.json() as { data: { id: number } }).data.id, (moved.json() as { data: { id: number } }).data.id];
    // The hold the page's session pointed at is over already (another write let it go); the session now points at the next.
    await h.rows(`update ${orders} set held_until = ${dialect === 'sqlite' ? `'2020-01-01T00:00:00.000Z'` : `'2020-01-01 00:00:00'`} where id = ${String(was)}`);
    const w = await writerFor(h);
    const target = w.targetOf('orders');
    const asked = [was, now, now];
    const released = await w.writes.transaction(target, [], (db) =>
      replaceHolds({ db, dialect: target.dialect, connectionId: h.connectionId, table: target.table, holds: holdsOf(target.view, target.table), begun: new Date(), page: { rowKey: async () => asked.shift() ?? now } }),
    );
    expect(released).toBe(1);
    expect(await live(`id = ${String(now)}`)).toBe(0);
  });
});
