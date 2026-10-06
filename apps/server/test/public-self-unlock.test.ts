// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW OPENED BY ITS OWN CODE (`unlockBy.self`), over the public API — a
 * gift card's balance, read by whoever types the card's code.
 *
 * The code opens its own row and no other; a code of another length is a miss
 * before anything is looked up; and a wrong card code is held against the
 * cards' count, never the discount codes' — so guessing at cards cannot take
 * a discount code out of a cart, nor the other way. On every engine this run
 * can reach.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boxOffice, boxOfficeManifest } from './code-lookup-fixture.js';
import { LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const CARDS = {
  ref: 'cards',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'code', type: 'text', maxLength: 24, rules: { code: { prefix: 'GC-', length: 12 } } },
    { ref: 'status', type: 'enum', enum: ['active', 'blocked'], default: 'active' },
    { ref: 'balance', type: 'decimal', scale: 2, default: 0 },
    { ref: 'valid_until', type: 'date', nullable: true },
  ],
};
const ENTRY = {
  table: 'cards',
  methods: ['GET'],
  select: ['id', 'balance'],
  unlockBy: { header: true, column: 'code', self: true, length: 12, where: [{ column: 'status', eq: 'active' }, { column: 'valid_until', notBefore: 'today', orEmpty: true }] },
};

describe.each(LEGS)('a row opened by its own code — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const cards = '/records/bloom_cards_unlocked';
  const types = '/records/bloom_ticket_types_unlocked';
  const read = (url: string, typed: string | null, address = fresh()) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/public${url}`, remoteAddress: address, headers: served.headers(undefined, typed === null ? {} : { 'x-adminium-code': typed }) });
  const ids = (res: Awaited<ReturnType<typeof read>>) => (res.json() as { data: { id: number }[] }).data.map((row) => Number(row.id));

  beforeAll(async () => {
    if (!available) return;
    const manifest = boxOfficeManifest();
    (manifest['requiredSchema'] as { tables: unknown[] }).tables.push(CARDS);
    (manifest['publicAccess'] as unknown[]).push(ENTRY);
    // The word is read from the release that runs it.
    manifest['compatibility'] = { minAdminiumVersion: '0.3.18' };
    h = await boxOffice(dialect, manifest);
    // Today on the venue's own clock, which is what the entry reads — not UTC's, which is another day for some hours of every night.
    const zone = (await h.meta.db.selectFrom('adminium_connections').select('timezone').where('id', '=', h.connectionId).executeTakeFirst())?.timezone ?? 'UTC';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    await h.rows(
      `INSERT INTO ${h.real('cards')} (id, code, status, balance, valid_until) VALUES ` +
        `(1, 'GC-7K2M9QXA41TR', 'active', 50, NULL), (2, 'GC-3HHW8PZC65NE', 'active', 20, '${today}'), (3, 'GC-9DDV4MRB72KS', 'blocked', 75, NULL), ` +
        // A card moved from another system, with a shorter code: it works at a staffed door, never here.
        `(4, 'GC-AAAA2222', 'active', 10, NULL), (5, 'GC-5TTG6XJF83QY', 'active', 5, '2001-01-01')`,
    );
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('the row opens only with its own code', async () => {
    // No code: nothing, and never "not allowed".
    const none = await read(cards, null);
    expect(none.statusCode, none.body).toBe(200);
    expect(ids(none)).toEqual([]);
    const one = await read(cards, 'GC-7K2M9QXA41TR');
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().data).toEqual([expect.objectContaining({ id: 1 })]);
    // The code opens the row and is never shown back.
    expect(Object.keys(one.json().data[0] as object).sort()).toEqual(['balance', 'id']);
    // As a person types it: lower case, spaced, with no prefix.
    expect(ids(await read(cards, 'gc-7k2m 9qxa 41tr'))).toEqual([1]);
    expect(ids(await read(cards, '7K2M9QXA41TR'))).toEqual([1]);
    // A card whose last day is today still opens; a blocked one and one past its day do not.
    expect(ids(await read(cards, 'GC-3HHW8PZC65NE'))).toEqual([2]);
    expect(ids(await read(cards, 'GC-9DDV4MRB72KS'))).toEqual([]);
    expect(ids(await read(cards, 'GC-5TTG6XJF83QY'))).toEqual([]);
    // One row by its key, the same way.
    expect((await read(`${cards}/2`, 'GC-7K2M9QXA41TR')).statusCode).toBe(404);
  });

  it.skipIf(!available)('a wrong length is refused before the lookup and spends a card guess', async () => {
    const me = fresh();
    // The stored code is right there: a lookup would find it. It is never looked up.
    for (let i = 0; i < 5; i += 1) {
      const res = await read(cards, 'GC-AAAA2222', me);
      expect(res.statusCode, res.body).toBe(200);
      expect(ids(res)).toEqual([]);
    }
    // Five misses are spent: a good card is refused too, until the window opens.
    expect((await read(cards, 'GC-7K2M9QXA41TR', me)).statusCode).toBe(429);
    // Thirteen is no nearer than ten.
    expect(ids(await read(cards, 'GC-7K2M9QXA41TRX'))).toEqual([]);
  });

  it.skipIf(!available)('five misses a minute from one visitor stop the sixth; a discount code still works', async () => {
    const me = fresh();
    for (let i = 0; i < 5; i += 1) expect(ids(await read(cards, `GC-ZZZZZZZZZZZ${String(i)}`, me))).toEqual([]);
    expect((await read(cards, `GC-ZZZZZZZZZZZ9`, me)).statusCode).toBe(429);
    // The codes' count is another: the presale code opens its type for this same visitor.
    const presale = await read(types, 'BLOOMEARLY', me);
    expect(presale.statusCode, presale.body).toBe(200);
    expect(ids(presale)).toContain(3);
    // And the other way: wrong discount codes never spend a card's tries.
    const other = fresh();
    for (let i = 0; i < 5; i += 1) expect((await read(types, `NOPE${String(i)}`, other)).statusCode).toBe(200);
    expect((await read(types, 'BLOOMEARLY', other)).statusCode).toBe(429);
    expect(ids(await read(cards, 'GC-7K2M9QXA41TR', other))).toEqual([1]);
  });
});
