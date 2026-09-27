// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CODES TYPED AT ONCE — a visitor's five misses a minute hold however the
 * guesses arrive: thirty wrong codes sent together, over real sockets, look
 * up no more than five; the same through a save, a quote and a change. A
 * guess that was no miss (a code that worked, a write refused before any
 * code was looked up) is handed back. A code that already worked for a
 * visitor passes the whole key's count, so misses from many addresses cannot
 * take it out of that visitor's cart; a code typed for the first time while
 * the key's misses are spent waits. On every engine this run can reach.
 */
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boxOffice, boxOfficeManifest } from './code-lookup-fixture.js';
import { LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;

describe.each(LEGS)('codes typed at once — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let port = 0;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.8.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const unlocked = '/records/bloom_ticket_types_unlocked';
  const read = (url: string, typed: string | null, address = fresh()) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/public${url}`, remoteAddress: address, headers: served.headers(undefined, typed === null ? {} : { 'x-adminium-code': typed }) });
  const quote = (values: Record<string, unknown>, address: string, types: number[] = [1]) =>
    served.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/records/bloom_orders/dry-run',
      remoteAddress: address,
      headers: served.headers(),
      payload: { values: { event_id: 1, email: 'mia@example.com', name: 'Mia', ...values }, children: { tickets: types.map((type) => ({ values: { ticket_type_id: type } })) } },
    });
  const signup = (values: Record<string, unknown>, address: string) =>
    served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/bloom_signups', remoteAddress: address, headers: served.headers(), payload: { values } });
  const error = (res: Reply) => (res.json() as { error?: { code: string; params?: Record<string, unknown> } }).error;
  /** A GET over a real socket of its own, to the listening server. */
  const overSocket = (path: string, headers: Record<string, string>): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: `/api/v1/public${path}`, method: 'GET', headers, agent: false }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });

  beforeAll(async () => {
    if (!available) return;
    // The box office, and the uses left of each code asked as availability (no read of codes needs a code).
    const manifest = boxOfficeManifest();
    (manifest['publicAccess'] as unknown[]).push({ table: 'orders', kind: 'availability', methods: ['GET'] });
    h = await boxOffice(dialect, manifest);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    await served.composed.app.listen({ port: 0, host: '127.0.0.1' });
    port = (served.composed.app.server.address() as AddressInfo).port;
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('looks up no more than five of thirty wrong codes sent at once over their own sockets', async () => {
    const headers = served.headers(undefined, {});
    const statuses = await Promise.all(Array.from({ length: 30 }, (_, i) => overSocket(unlocked, { ...headers, 'x-adminium-code': `WRONG${String(i)}` })));
    // A wrong code that was looked up answers an empty list (200); one refused before the lookup answers 429.
    expect(statuses.filter((s) => s === 200).length, statuses.join(',')).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 200).length + statuses.filter((s) => s === 429).length).toBe(30);
    // Spent: a good code from this address is refused too, until the window opens.
    expect(await overSocket(unlocked, { ...headers, 'x-adminium-code': 'BLOOMEARLY' })).toBe(429);
  });

  it.skipIf(!available)('holds a save, a quote and a sign-up sent at once to the same five', async () => {
    const me = fresh();
    const replies = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => quote({ code_text: `NOPE${String(i)}` }, me)),
      ...Array.from({ length: 10 }, (_, i) => signup({ name: 'Ana', code_text: `NADA${String(i)}` }, me)),
      ...Array.from({ length: 10 }, (_, i) => read(unlocked, `NIL${String(i)}`, me)),
    ]);
    const looked = replies.filter((r) => r.statusCode !== 429);
    expect(looked.length, replies.map((r) => r.statusCode).join(',')).toBeLessThanOrEqual(5);
    for (const res of looked) {
      if (res.statusCode === 200) expect((res.json() as { data: unknown[] }).data).toEqual([]);
      else expect(error(res)?.params).toMatchObject({ reason: 'unknown' });
    }
  });

  it.skipIf(!available)('hands back a guess that was no miss: codes that worked, and a write refused before any code was looked up', async () => {
    const me = fresh();
    // A code that works costs nothing; once it has worked, ten asked at once all go through.
    expect((await read(unlocked, 'BLOOMEARLY', me)).statusCode).toBe(200);
    const hits = await Promise.all(Array.from({ length: 10 }, () => read(unlocked, 'BLOOMEARLY', me)));
    expect(hits.map((r) => r.statusCode)).toEqual(Array.from({ length: 10 }, () => 200));
    // A quote whose code works, refused for another reason (a type that code does not offer): nothing kept.
    for (let i = 0; i < 6; i += 1) {
      const res = await quote({ code_text: 'CREW5' }, me, [3]);
      expect(res.statusCode, res.body).toBe(400);
      expect(error(res)?.params).toMatchObject({ reason: 'not-offered' });
    }
    // Five misses are still this visitor's to spend; the sixth is not.
    for (let i = 0; i < 5; i += 1) expect((await read(unlocked, `MISS${String(i)}`, me)).statusCode).toBe(200);
    expect((await read(unlocked, 'BLOOMEARLY', me)).statusCode).toBe(429);
  });

  it.skipIf(!available)('charges nothing for availability asked with a code where no read needs one, once the visitor’s guesses are spent', async () => {
    const me = fresh();
    for (let i = 0; i < 5; i += 1) expect((await read(unlocked, `LOST${String(i)}`, me)).statusCode).toBe(200);
    // The uses left of each code: no read of codes is shown with a code, so the header asks nothing.
    const plain = await read('/availability/bloom_orders_availability', 'ANY', me);
    expect(plain.statusCode, plain.body).toBe(200);
    // Where a read does need one, the spent visitor is told so.
    expect((await read('/availability/bloom_tickets_availability?under=1', 'ANY', me)).statusCode).toBe(429);
  });

  it.skipIf(!available)('keeps a code that already worked in its visitor’s cart while misses from many addresses spend the key', async () => {
    const buyer = fresh();
    const kept = await quote({ code_text: 'student10' }, buyer);
    expect(kept.statusCode, kept.body).toBe(200);
    // Many addresses, each within its own five, spend what is left of the key's sixty.
    for (let round = 0; round < 14; round += 1) {
      const address = fresh();
      await Promise.all(Array.from({ length: 5 }, (_, i) => read(unlocked, `FLOOD${String(round)}X${String(i)}`, address)));
    }
    // Spent: another visitor's first code waits for the window…
    const stranger = await quote({ code_text: 'STUDENT10' }, fresh());
    expect(stranger.statusCode, stranger.body).toBe(429);
    // …but the buyer's own code, spelled another way, still quotes: $90.00 less $9.00.
    const again = await quote({ code_text: 'Student-10' }, buyer, [1, 1]);
    expect(again.statusCode, again.body).toBe(200);
    expect(Number((again.json() as { data: { total: unknown } }).data.total)).toBe(81);
    // A code the buyer never used is a new guess on the key: refused.
    expect((await quote({ code_text: 'CREW5' }, buyer)).statusCode).toBe(429);
  });
});
