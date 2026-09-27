// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person found by address, when writers meet — on every engine, over the
 * public API of an app installed by the real installer:
 *
 *  - twenty orders at once, all by one new address, make ONE person and
 *    link every order to them, with no server error;
 *  - an address that only looks like one on file (MySQL's collation reads
 *    `adà@` as `ada@`) links nobody and makes nobody there — and is its own
 *    person where the database tells the two apart;
 *  - a role that may not add people is refused the same way for a known
 *    address and a new one, before the address is looked up.
 */
import { ForbiddenError } from '../src/errors.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolvePerson } from '../src/crud/person.js';
import { solveProof } from '../src/public-api/proof.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

/** The shop, with twenty orders a day allowed per address. */
const manifest = () =>
  shopManifest({
    entries: (entries) =>
      entries.map((entry) => (entry['identity'] !== undefined ? { ...entry, anonymous: { perValue: { columns: ['email'], n: 20 } } } : entry)),
  });

describe.each(LEGS)('a person found by address, when writers meet — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let ip = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    await h.rows(`insert into ${h.real('customers')} (email, name) values ('ada@example.com', 'Ada')`);
    shop = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  const from = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** A create ready to send: its proof already solved, so many can go at once. */
  const ready = async (email: string) => {
    const address = from();
    const res = await shop.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: shop.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = shop.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    return () => shop.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${h.real('orders')}_verified_2`, remoteAddress: address, headers, payload: { values: { email, name: 'Twin' } } });
  };

  it.skipIf(!available)('makes one person for twenty orders at once by one new address', async () => {
    const sends = await Promise.all(Array.from({ length: 20 }, () => ready('twins@example.com')));
    const results = await Promise.all(sends.map((send) => send()));
    for (const res of results) expect(res.statusCode, res.body).toBeLessThan(500);
    const made = results.filter((res) => res.statusCode === 201);
    // A lost race is a moment's wait, never an error; every other one is an order.
    for (const res of results.filter((r) => r.statusCode !== 201)) expect(shop.codeOf(res)).toBe('PUBLIC_SLOT_BUSY');
    expect(made.length).toBeGreaterThanOrEqual(18);
    const people = await h.rows(`select id from ${h.real('customers')} where email = 'twins@example.com'`);
    expect(people).toHaveLength(1);
    const linked = await h.rows(`select distinct customer_id from ${h.real('orders')} where email = 'twins@example.com'`);
    expect(linked.map((row) => Number(row['customer_id']))).toEqual([Number(people[0]!['id'])]);
    expect(Number((await h.rows(`select count(*) as n from ${h.real('orders')} where email = 'twins@example.com'`))[0]!['n'])).toBe(made.length);
  });

  it.skipIf(!available)('links nobody for an address that only looks like one on file', async () => {
    const res = await (await ready('adà@example.com'))();
    expect(res.statusCode, res.body).toBe(201);
    const order = (await h.rows(`select customer_id from ${h.real('orders')} where id = ${(res.json() as { data: { id: number } }).data.id}`))[0]!;
    const ada = await h.rows(`select id, email from ${h.real('customers')} where name = 'Ada'`);
    // Never Ada's: her rows are not a stranger's to be added to.
    expect(Number(order['customer_id'])).not.toBe(Number(ada[0]!['id']));
    if (dialect === 'mysql') {
      // The collation cannot tell them apart, so nobody is made either: the order stays unlinked for the desk.
      expect(order['customer_id']).toBeNull();
      expect(await h.rows(`select id from ${h.real('customers')} where email <> 'ada@example.com' and name = 'Twin'`)).toHaveLength(1);
    } else {
      expect(order['customer_id']).not.toBeNull();
    }
  });

  it.skipIf(!available)('refuses a role that may not add people alike for a known and a new address', async () => {
    const w = await writerFor(h);
    const identity = w.targetOf('customers');
    const noInsert = { insert: false, update: true, delete: false };
    const tryOne = (address: string) =>
      w.writes
        .transaction(identity, [], (db) => resolvePerson({ writes: w.writes, identity: { ...identity, db, rights: noInsert }, email: 'email', address, fill: { name: 'X' }, context: w.desk }))
        .catch((error: unknown) => error);
    const known = await tryOne('ada@example.com');
    const unknown = await tryOne('nobody-yet@example.com');
    expect(known).toBeInstanceOf(ForbiddenError);
    expect(unknown).toBeInstanceOf(ForbiddenError);
    expect((known as ForbiddenError).details).toEqual((unknown as ForbiddenError).details);
    expect(await h.rows(`select id from ${h.real('customers')} where email = 'nobody-yet@example.com'`)).toEqual([]);
  });
});
