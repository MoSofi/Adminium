// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A STRANGER LEARNS ABOUT A GIFT CARD.
 *
 * Offers' balance entry rides the key of an app that names it. Whoever sends
 * a card's own twelve characters is told three things about that card and
 * nothing else; whoever sends anything else — a wrong code, a cancelled,
 * unsold or expired card's, an older short code, a credit's address — is
 * answered the same empty list, so nobody learns whether a card exists. Five
 * wrong guesses a minute are all a visitor gets.
 */
import { publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from '../../app-add-ons.helpers.js';
import { shopManifest } from '../../fixtures/cards-kit/index.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { servePublic, type Served } from '../../public-lane.helpers.js';
import { builtAddOn } from '../harness.js';

const offers = builtAddOn('offers');
const BALANCE = 'offers_gift_cards_unlocked';
const LINK = 'offers_gift_cards_claimed';

describe.each(LEGS)('a gift card\'s balance, asked by a stranger — %s', (dialect, available) => {
  const run = available && offers !== null;
  let h: Harness;
  let served: Served;
  let keyId: string;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const read = (typed: string | null, address = fresh()) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${BALANCE}`, remoteAddress: address, headers: served.headers(undefined, typed === null ? {} : { 'x-adminium-code': typed }) });
  const codeOf = (res: Awaited<ReturnType<typeof read>>) => (res.json() as { error?: { code: string } }).error?.code;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    if (!run) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopManifest({ addOns: { suggests: [{ key: 'offers', range: '*', reason: { 'en-US': 'Sell and take gift cards.' } }] }, frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }, { side: 'customer', kind: 'spa', entry: 'index.html', routes: { shop: '/', giftCard: '/gift-card' } }] }));
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    keyId = installed.json().publicAccess.keyId as string;
    await h.stageAddOn(offers!.manifest, { bundled: true, files: offers!.files });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'offers', version: offers!.version, attachTo: ['shop'], publicAccess: true } });
    expect(added.statusCode, added.body).toBe(200);
    // Cards as they stand in the table: one of each kind a stranger might ask about.
    const cards: [id: number, kind: string, code: string | null, status: string, expires: string | null][] = [
      [1, 'card', 'GC-7K2MW3HNQ4XP', 'active', null],
      [2, 'card', 'GC-M9RD5PTC2HVT', 'active', day(0)],
      [3, 'card', 'GC-J5RME4WY6VXQ', 'void', null],
      [4, 'card', 'GC-D2NFH5GS9MXR', 'inactive', null],
      [5, 'card', 'GC-4TQ8B7YDWN6C', 'active', day(-1)],
      [6, 'card', 'GC-X8C4T2BVNP3H', 'expired', day(-30)],
      // An older card brought in from a till: eight characters.
      [7, 'card', 'GC-48219930', 'active', null],
      [8, 'credit', null, 'active', null],
    ];
    for (const [id, kind, code, status, expires] of cards) {
      await h.rows(`INSERT INTO offers_gift_cards (id, kind, code, label, status, opening, expires_on, recipient_name, recipient_email, owner_email, moved_table, moving) VALUES (${String(id)}, '${kind}', ${code === null ? 'NULL' : `'${code}'`}, ${code === null ? 'NULL' : `'${code.slice(-4)}'`}, '${status}', ${String(id * 10)}, ${expires === null ? 'NULL' : `'${expires}'`}, 'Ana', 'ana@calla.dev', ${kind === 'credit' ? `'ana@calla.dev'` : 'NULL'}, '', ${dialect === 'postgres' ? 'false' : '0'})`);
      await h.rows(`UPDATE offers_gift_cards SET balance = ${String(id * 10)} WHERE id = ${String(id)}`);
    }
    served = await servePublic(h as never, keyId);
  }, 600_000);
  afterAll(async () => {
    if (!run) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!run)('the app\'s key gains the balance entry, and the link has a key of its own', async () => {
    const endpoints = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).filter((endpoint) => endpoint.managedBy === 'offers').map((endpoint) => endpoint.ref).sort();
    expect(endpoints).toEqual([LINK, BALANCE].sort());
    const link = (await publicKeysRepo(h.meta).listManagedBy('offers')).filter((key) => key.revokedAt === null);
    expect(link.map((key) => key.purpose)).toEqual(['offers-link']);
  });

  it.skipIf(!run)('an active card answers status, balance and expiry and no other key', async () => {
    const res = await read('GC-7K2MW3HNQ4XP');
    expect(res.statusCode, res.body).toBe(200);
    const rows = (res.json() as { data: Record<string, unknown>[] }).data;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(['balance', 'expires_on', 'status']);
    expect(rows[0]!['status']).toBe('active');
    expect(Number(rows[0]!['balance'])).toBe(10);
    // Nothing of whose it is, anywhere in the reply.
    expect(res.body).not.toMatch(/Ana|calla|Q4XP|7K2M/);
    // Typed as a person reads it out, in groups and in small letters: the same card.
    const spoken = await read('gc-7k2m-w3hn-q4xp');
    expect(spoken.statusCode, spoken.body).toBe(200);
    // A card is good through its last day.
    const today = await read('GC-M9RD5PTC2HVT');
    expect(today.statusCode, today.body).toBe(200);
    expect(Number((today.json() as { data: Record<string, unknown>[] }).data[0]!['balance'])).toBe(20);
  });

  it.skipIf(!run)('unknown, cancelled, inactive, expired, eight-character and credit all answer the same nothing', async () => {
    const replies: string[] = [];
    for (const typed of ['GC-AAAABBBBCCCC', 'GC-J5RME4WY6VXQ', 'GC-D2NFH5GS9MXR', 'GC-4TQ8B7YDWN6C', 'GC-X8C4T2BVNP3H', 'GC-48219930', 'ana@calla.dev']) {
      const res = await read(typed);
      // An empty list, as for a code nothing has: never a row, and never a word about why.
      expect(res.statusCode, `${String(typed)}: ${res.body}`).toBe(200);
      expect((res.json() as { data: unknown[] }).data, String(typed)).toEqual([]);
      replies.push(res.body);
    }
    // Word for word the same answer: nobody learns which of these was a card.
    expect(new Set(replies).size).toBe(1);
    // With no code at all there is nothing to open: no row is answered either.
    const bare = await read(null);
    expect(bare.statusCode === 200 ? (bare.json() as { data: unknown[] }).data : [], bare.body).toEqual([]);
    // And the entry cannot be listed, filtered or counted without a code.
    for (const query of ['?limit=50', '?where=%7B%22column%22%3A%22status%22%2C%22op%22%3A%22eq%22%2C%22value%22%3A%22active%22%7D', '?count=exact']) {
      const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${BALANCE}${query}`, remoteAddress: fresh(), headers: served.headers() });
      if (res.statusCode === 200) expect((res.json() as { data: unknown[]; page?: { total?: unknown } }).data, `${query}: ${res.body}`).toEqual([]);
      expect(res.body, query).not.toMatch(/"total":\s*[1-9]/);
    }
  });

  it.skipIf(!run)('the sixth wrong card code in a minute is refused before any lookup, and a right one from somebody else still answers', async () => {
    const guesser = fresh();
    const seen: number[] = [];
    for (let n = 0; n < 7; n += 1) seen.push((await read(`GC-ZZZZZZZZ${String(1000 + n)}`, guesser)).statusCode);
    expect(seen.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(seen.slice(5)).toEqual([429, 429]);
    // Even the right code, from the one who has guessed too often.
    const late = await read('GC-7K2MW3HNQ4XP', guesser);
    expect(late.statusCode).toBe(429);
    expect(codeOf(late)).toBe('PUBLIC_RATE_LIMITED');
    expect((await read('GC-7K2MW3HNQ4XP')).statusCode).toBe(200);
  });

  it.skipIf(!run)('with Offers switched off for the app the door answers nothing, and on again it answers', async () => {
    const off = await h.inject({ method: 'PATCH', url: '/add-ons/offers', payload: { attachedTo: 'shop', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    const closed = await servePublic(h as never, keyId);
    try {
      const res = await closed.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${BALANCE}`, remoteAddress: fresh(), headers: closed.headers(undefined, { 'x-adminium-code': 'GC-7K2MW3HNQ4XP' }) });
      expect(res.statusCode, res.body).not.toBe(200);
    } finally {
      await closed.close();
    }
    const on = await h.inject({ method: 'PATCH', url: '/add-ons/offers', payload: { attachedTo: 'shop', enabled: true, publicAccess: true } });
    expect(on.statusCode, on.body).toBe(200);
  });
});
