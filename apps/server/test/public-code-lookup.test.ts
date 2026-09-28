// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CODES A GUEST TYPES, THROUGH THE PUBLIC API — on every engine this run can
 * reach, through an app installed by the real installer and the whole server.
 *
 * A discount code comes off the order's total, a code whose uses are gone is
 * `used-up`, and every other miss is `unknown`, named on the column the guest
 * typed into. A presale code shows its ticket type, and lets an order name
 * it; without the code the type is never listed, never read by id, never
 * counted by availability and never offered in an order. A code travels in a
 * header, never a URL. Each miss is a guess spent — on a save, a quote, a
 * read and availability alike — and a visitor's guesses run out; a code that
 * works costs nothing.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { boxOffice } from './code-lookup-fixture.js';
import { LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents } from './order-tree-fixture.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { ORIGIN, servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;

describe.each(LEGS)('codes a guest types, on the public API — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.6.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const code = (typed: string) => ({ 'x-adminium-code': typed });
  const read = (url: string, extra: Record<string, string> = {}, address = fresh()) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/public${url}`, remoteAddress: address, headers: served.headers(undefined, extra) });
  const post = async (url: string, payload: Record<string, unknown>, address = fresh(), proof = !url.endsWith('dry-run') && url.startsWith('bloom_orders')) => {
    let headers = served.headers();
    if (proof) {
      const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers });
      const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
      headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    }
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${url}`, remoteAddress: address, headers, payload });
  };
  const order = (types: number[], more: Record<string, unknown> = {}, values: Record<string, unknown> = {}) => ({
    values: { event_id: 1, email: 'mia@example.com', name: 'Mia', ...values },
    children: { tickets: types.map((type) => ({ values: { ticket_type_id: type } })) },
    ...more,
  });
  const ids = (res: Reply) => ((res.json() as { data: { id: unknown }[] }).data ?? []).map((row) => Number(row.id)).sort();
  const error = (res: Reply) => (res.json() as { error: { code: string; params?: Record<string, unknown> } }).error;
  const count = async (ref: string) => Number((await h.rows(`select count(*) as n from ${h.real(ref)}`))[0]!['n']);
  const paid = async (codeId: number, n: number) => {
    for (let i = 0; i < n; i += 1) {
      await h.rows(`INSERT INTO ${h.real('orders')} (status, event_id, email, name, code_id) VALUES ('paid', 1, 'seed@example.com', 'Seed', ${String(codeId)})`);
    }
  };

  beforeAll(async () => {
    if (!available) return;
    h = await boxOffice(dialect);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('lists a presale type only with its code, sent in a header', async () => {
    const plain = await read('/records/bloom_ticket_types');
    expect(plain.statusCode, plain.body).toBe(200);
    expect(ids(plain)).toEqual([1, 2, 5]);
    // The plain list never shows the presale or the comps, however it is asked.
    expect(ids(await read('/records/bloom_ticket_types?where=' + encodeURIComponent(JSON.stringify({ column: 'visibility', op: 'eq', value: 'code' }))))).toEqual([]);

    const unlocked = '/records/bloom_ticket_types_unlocked';
    expect(ids(await read(unlocked))).toEqual([]);
    const withCode = await read(unlocked, code('bloom-early'));
    expect(ids(withCode)).toEqual([3]);
    // What a code unlocks is its holder's: never kept by a browser. The plain list keeps its caching.
    expect(withCode.headers['cache-control']).toBe('no-store');
    expect(plain.headers['cache-control']).toBeUndefined();
    // A code switched off or past its day unlocks nothing; nor does one for the comps, which the entry never shows.
    expect(ids(await read(unlocked, code('switchedoff')))).toEqual([]);
    expect(ids(await read(unlocked, code('LASTYEAR')))).toEqual([]);
    expect(ids(await read(unlocked, code('COMPS')))).toEqual([]);
    // Never in a URL.
    const inUrl = await read(`${unlocked}?code=BLOOMEARLY`);
    expect(inUrl.statusCode, inUrl.body).toBe(400);
    expect(error(inUrl).code).toBe('PUBLIC_QUERY_REFUSED');
    // By id: the same code, or the one 404.
    expect((await read(`${unlocked}/3`)).statusCode).toBe(404);
    const one = await read(`${unlocked}/3`, code('BLOOMEARLY'));
    expect(one.statusCode, one.body).toBe(200);
    expect((one.json() as { data: { name: string } }).data.name).toBe('Presale');
    // A page learns from its config that the list needs a code.
    const config = (await read('/config')).json() as { data: { refs: Record<string, { unlock?: boolean }> } };
    expect(config.data.refs['bloom_ticket_types_unlocked']?.unlock).toBe(true);
    expect(config.data.refs['bloom_ticket_types']?.unlock).toBeUndefined();
  });

  it.skipIf(!available)('counts a presale type in availability only with its code', async () => {
    const ask = '/availability/bloom_tickets_availability?under=1';
    const without = await read(ask);
    expect(without.statusCode, without.body).toBe(200);
    expect(ids(without)).toEqual([1, 2]);
    expect(ids(await read(ask, code('BLOOMEARLY')))).toEqual([1, 2, 3]);
    expect(ids(await read(ask, code('NOTACODE')))).toEqual([1, 2]);
    const inUrl = await read(`${ask}&code=BLOOMEARLY`);
    expect(inUrl.statusCode, inUrl.body).toBe(400);
  });

  it.skipIf(!available)('lets an order name the presale type with its code, and never without it; never a comp', async () => {
    const before = await count('orders');
    const bare = await post('bloom_orders', order([1, 3]));
    expect(bare.statusCode, bare.body).toBe(400);
    expect(error(bare)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'tickets', index: 1, column: 'ticket_type_id', reason: 'not-offered' } });
    expect(await count('orders')).toBe(before);
    const coded = await post('bloom_orders', order([1, 3], {}, { code_text: 'BloomEarly' }));
    expect(coded.statusCode, coded.body).toBe(201);
    const comp = await post('bloom_orders', order([4], {}, { code_text: 'COMPS' }));
    expect(comp.statusCode, comp.body).toBe(400);
    expect(error(comp).params).toMatchObject({ child: 'tickets', column: 'ticket_type_id', reason: 'not-offered' });
  });

  it.skipIf(!available)('names a code that finds nothing on the column typed, on a save, a quote and a plain create', async () => {
    const saved = await post('bloom_orders', order([1], {}, { code_text: 'NOPE' }));
    expect(saved.statusCode, saved.body).toBe(400);
    expect(error(saved)).toEqual(expect.objectContaining({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'code_text', reason: 'unknown' } }));
    const quoted = await post('bloom_orders/dry-run', order([1], {}, { code_text: 'lastyear' }));
    expect(quoted.statusCode, quoted.body).toBe(400);
    expect(error(quoted).params).toEqual({ column: 'code_text', reason: 'unknown' });
    const signup = await post('bloom_signups', { values: { name: 'Ana', code_text: 'nope' } });
    expect(signup.statusCode, signup.body).toBe(400);
    expect(error(signup).params).toEqual({ column: 'code_text', reason: 'unknown' });
    // The link itself is never the guest's to write.
    const named = await post('bloom_signups', { values: { name: 'Ana', code_id: 1 } });
    expect(named.statusCode, named.body).toBe(400);
  });

  it.skipIf(!available)('takes STUDENT10 off two Standard: $90.00 less $9.00 is $81.00, in the quote and the save', async () => {
    const quote = await post('bloom_orders/dry-run', order([1, 1], {}, { code_text: 'student10' }));
    expect(quote.statusCode, quote.body).toBe(200);
    const q = (quote.json() as { data: Record<string, unknown> }).data;
    expect([cents(q['subtotal']), cents(q['discount']), cents(q['total'])]).toEqual(['90.00', '9.00', '81.00']);
    const saved = await post('bloom_orders', order([1, 1], { expect: { total: '81.00' } }, { code_text: 'student10' }));
    expect(saved.statusCode, saved.body).toBe(201);
    const s = (saved.json() as { data: Record<string, unknown> }).data;
    expect([cents(s['subtotal']), cents(s['discount']), cents(s['total'])]).toEqual(['90.00', '9.00', '81.00']);
    // CREW5: $5 off a Standard, and nothing off the Balcony.
    const crew = await post('bloom_orders', order([1, 2], {}, { code_text: 'CREW5' }));
    expect(crew.statusCode, crew.body).toBe(201);
    const c = (crew.json() as { data: Record<string, unknown> }).data;
    expect([cents(c['subtotal']), cents(c['discount']), cents(c['total'])]).toEqual(['105.00', '5.00', '100.00']);
  });

  it.skipIf(!available)('refuses the twenty-first use of a twenty-use code as used up; a lapsed hold gives its use back', async () => {
    await paid(10, 19);
    // A hold that ran out counts for nothing.
    await h.rows(`INSERT INTO ${h.real('orders')} (status, held_until, event_id, email, name, code_id) VALUES ('held', '2001-01-01 00:00:00', 1, 'late@example.com', 'Late', 10)`);
    const twentieth = await post('bloom_orders', order([1], {}, { code_text: 'twenty' }));
    expect(twentieth.statusCode, twentieth.body).toBe(201);
    const before = await count('orders');
    const next = await post('bloom_orders', order([1], { expect: { total: '44.00' } }, { code_text: 'TWENTY' }));
    expect(next.statusCode, next.body).toBe(400);
    expect(error(next)).toEqual(expect.objectContaining({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'code_text', reason: 'used-up' } }));
    expect(await count('orders')).toBe(before);
  });

  it.skipIf(!available)('gives the last use of a code to exactly one of five orders placed at once', async () => {
    await h.rows(`INSERT INTO ${h.real('codes')} (code, kind, value, active, event_id, max_uses) VALUES ('LASTONE', 'amount', 1, ${dialect === 'postgres' ? 'true' : '1'}, 1, 20)`);
    const last = Number((await h.rows(`select id from ${h.real('codes')} where code = 'LASTONE'`))[0]!['id']);
    await paid(last, 19);
    const replies = await Promise.all(Array.from({ length: 5 }, () => post('bloom_orders', order([2], {}, { code_text: 'lastone' }))));
    const statuses = replies.map((res) => res.statusCode).sort();
    expect(statuses.filter((s) => s === 201), replies.map((r) => r.body).join('\n')).toHaveLength(1);
    // The others: used up, or asked to try again a moment later.
    for (const res of replies.filter((r) => r.statusCode !== 201)) {
      expect(['PUBLIC_WRITE_REFUSED', 'PUBLIC_SLOT_BUSY']).toContain(error(res).code);
      if (error(res).code === 'PUBLIC_WRITE_REFUSED') expect(error(res).params).toEqual({ column: 'code_text', reason: 'used-up' });
    }
    expect(Number((await h.rows(`select count(*) as n from ${h.real('orders')} where code_id = ${String(last)} and status in ('held', 'paid')`))[0]!['n'])).toBe(20);
  });

  it.skipIf(!available)('finds a code typed into a change, and counts a change that misses as a guess', async () => {
    // A page that changes a sign-up's code (an entry written by hand: an app's change needs a claim).
    const desk = await usersRepo(h.meta).create({ email: 'desk@bloom.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const cookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@bloom.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
    const sources = (await served.composed.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${h.connectionId}`, headers: { cookie } })).json() as { sources: { id: string }[] };
    const table = sources.sources.find((x) => x.id.endsWith('bloom_signups'))!.id;
    const saved = await served.composed.app.inject({
      method: 'PUT',
      url: `/api/v1/public-endpoints/${h.connectionId}/signup_code`,
      headers: { cookie },
      payload: {
        definition: JSON.stringify({
          path: '/signup_code',
          source: table,
          methods: ['PATCH'],
          select: ['id', 'name'],
          writable: ['code_text'],
          pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
          auth: { role: 'anon' },
          rate_limit: { requests: 120, window: '1m' },
          response: { shape: 'object', envelope: 'data' },
        }),
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const key = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public-keys', headers: { cookie }, payload: { name: 'Codes', connectionId: h.connectionId, access: [{ ref: 'signup_code', methods: ['PATCH'] }] } });
    expect(key.statusCode, key.body).toBe(201);
    const token = (key.json() as { token: string }).token;
    await h.rows(`INSERT INTO ${h.real('signups')} (name) VALUES ('Ana')`);
    const row = Number((await h.rows(`select max(id) as id from ${h.real('signups')}`))[0]!['id']);
    const me = fresh();
    const change = (typed: string) =>
      served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/signup_code/${String(row)}`, remoteAddress: me, headers: { authorization: `Bearer ${token}`, origin: ORIGIN }, payload: { values: { code_text: typed } } });
    const good = await change('student-10');
    expect(good.statusCode, good.body).toBe(200);
    expect(Number((await h.rows(`select code_id from ${h.real('signups')} where id = ${String(row)}`))[0]!['code_id'])).toBe(1);
    for (let i = 0; i < 5; i += 1) {
      const miss = await change(`WRONG${String(i)}`);
      expect(miss.statusCode, miss.body).toBe(400);
      expect(error(miss).params).toEqual({ column: 'code_text', reason: 'unknown' });
    }
    expect((await change('STUDENT10')).statusCode).toBe(429);
    // The code it had is kept: nothing a miss typed was written.
    expect(Number((await h.rows(`select code_id from ${h.real('signups')} where id = ${String(row)}`))[0]!['code_id'])).toBe(1);
  });

  it.skipIf(!available)('counts every miss alike — a save, a quote, a read, availability, a code gone by date or by count — and never a hit', async () => {
    const me = fresh();
    await paid(12, 2);
    // Hits cost nothing, however many.
    for (let i = 0; i < 6; i += 1) expect((await read('/records/bloom_ticket_types_unlocked', code('BLOOMEARLY'), me)).statusCode).toBe(200);
    // Five misses, each by another door.
    expect(error(await post('bloom_orders', order([1], {}, { code_text: 'NOPE1' }), me)).params).toEqual({ column: 'code_text', reason: 'unknown' });
    expect(error(await post('bloom_orders/dry-run', order([1], {}, { code_text: 'LASTYEAR' }), me)).params).toEqual({ column: 'code_text', reason: 'unknown' });
    expect(error(await post('bloom_orders', order([1], {}, { code_text: 'TWO' }), me)).params).toEqual({ column: 'code_text', reason: 'used-up' });
    expect(ids(await read('/records/bloom_ticket_types_unlocked', code('NOPE2'), me))).toEqual([]);
    expect(ids(await read('/availability/bloom_tickets_availability?under=1', code('NOPE3'), me))).toEqual([1, 2]);
    // The sixth code is refused before it is looked up — a good one too.
    const spent = await read('/records/bloom_ticket_types_unlocked', code('BLOOMEARLY'), me);
    expect(spent.statusCode, spent.body).toBe(429);
    expect(error(spent).code).toBe('PUBLIC_RATE_LIMITED');
    const typed = await post('bloom_orders', order([1], {}, { code_text: 'STUDENT10' }), me);
    expect(typed.statusCode, typed.body).toBe(429);
    const signup = await post('bloom_signups', { values: { name: 'Ana', code_text: 'STUDENT10' } }, me);
    expect(signup.statusCode, signup.body).toBe(429);
    // An order with no code still goes through, from the same visitor.
    const bare = await post('bloom_orders', order([1]), me);
    expect(bare.statusCode, bare.body).toBe(201);
    // Another visitor is not held to this one's misses.
    expect(ids(await read('/records/bloom_ticket_types_unlocked', code('BLOOMEARLY')))).toEqual([3]);
  });
});
