// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN LINK KEY: the one key an add-on may have. Whoever holds a
 * card's link opens that card and only reads it; the key is the add-on's own
 * (no app's key carries its entry), is made only on somebody's say, and stops
 * with the add-on.
 */
import { publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { BALANCE_REF, CARDS_KIT, LINK_KEY, LINK_REF, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const TOKEN = '7K2M9QXA41TR8PZC';
const OTHER = '3HHW8PZC65NE9DDV';

describe.each(LEGS)("an add-on's own link key — %s", (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  const setUp = async (): Promise<{ shopKey: string; linkKey: string }> => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopManifest());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(cardsKitManifest());
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'], publicAccess: true } });
    expect(added.statusCode, added.body).toBe(200);
    await h.rows(
      `INSERT INTO cards_kit_cards (id, code, link_token, label, status, balance) VALUES (1, 'GC-7K2M9QXA41TR', '${TOKEN}', 'For Mia', 'active', 50), (2, 'GC-3HHW8PZC65NE', '${OTHER}', 'For Sam', 'active', 20)`,
    );
    const link = (await publicKeysRepo(h.meta).listManagedBy(CARDS_KIT)).find((key) => key.purpose === LINK_KEY)!;
    return { shopKey: installed.json().publicAccess.keyId as string, linkKey: link.id };
  };

  it.skipIf(!available)('the token opens one row and only reads', async () => {
    const { linkKey } = await setUp();
    const served = await servePublic(h as never, linkKey);
    try {
      const opened = await served.post('/claim/token', { token: TOKEN });
      expect(opened.statusCode, opened.body).toBe(200);
      const session = (opened.json() as { data: { session: string } }).data.session;
      const read = await served.get(`/records/${LINK_REF}`, session);
      expect(read.statusCode, read.body).toBe(200);
      // Its own card, and no other; what the entry shows, and never the code or the token.
      expect(read.json().data).toEqual([expect.objectContaining({ id: 1, label: 'For Mia' })]);
      expect(Object.keys(read.json().data[0] as object).sort()).toEqual(['balance', 'id', 'label']);
      expect((await served.get(`/records/${LINK_REF}/2`, session)).statusCode).not.toBe(200);
      // Without a link: nothing.
      expect((await served.get(`/records/${LINK_REF}`)).statusCode).not.toBe(200);
      // It only reads, and it serves nothing else: not the entry typed codes open, not the shop's own.
      for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
        const res = await served.composed.app.inject({ method, url: `/api/v1/public/records/${LINK_REF}${method === 'POST' ? '' : '/1'}`, headers: served.headers(session), payload: { values: { balance: 999 } } });
        expect(res.statusCode, `${method} ${res.body}`).toBeGreaterThanOrEqual(400);
      }
      expect(Number((await h.rows('SELECT balance FROM cards_kit_cards WHERE id = 1'))[0]!['balance'])).toBe(50);
      expect((await served.get(`/records/${BALANCE_REF}`, session)).statusCode).not.toBe(200);
      expect((await served.get('/records/shop_products', session)).statusCode).not.toBe(200);
      // A wrong token opens nothing.
      expect((await served.post('/claim/token', { token: 'AAAAAAAAAAAAAAAA' })).statusCode).not.toBe(200);
    } finally {
      await served.close();
    }
  });

  it.skipIf(!available)('is the add-on\'s own: bound to no staff, holding its one read, and no app\'s key carries its entry', async () => {
    const { shopKey, linkKey } = await setUp();
    const key = (await publicKeysRepo(h.meta).findById(linkKey))!;
    expect(key).toMatchObject({ managedBy: CARDS_KIT, purpose: LINK_KEY, kind: 'browser', requiresStaff: null });
    const refs = new Map((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => [endpoint.id, endpoint.ref]));
    const held = (id: string) => publicKeysRepo(h.meta).findById(id).then((row) => Object.entries((typeof row!.access === 'string' ? JSON.parse(row!.access) : row!.access) as Record<string, string[]>).map(([endpoint, methods]) => `${refs.get(endpoint) ?? endpoint}:${methods.join('+')}`).sort());
    expect(await held(linkKey)).toEqual([`${LINK_REF}:GET`]);
    expect(await held(shopKey)).not.toContain(`${LINK_REF}:GET`);
    // The shop's token opens no card by its link.
    const served = await servePublic(h as never, shopKey);
    try {
      expect((await served.post('/claim/token', { token: TOKEN })).statusCode).not.toBe(200);
    } finally {
      await served.close();
    }
  });

  it.skipIf(!available)('revoked at uninstall: the token it was given opens nothing', async () => {
    const { linkKey } = await setUp();
    const gone = await h.inject({ method: 'DELETE', url: `/add-ons/${CARDS_KIT}` });
    expect(gone.statusCode, gone.body).toBe(200);
    expect((await publicKeysRepo(h.meta).findById(linkKey))!.revokedAt).not.toBeNull();
    const served = await servePublic(h as never, linkKey);
    try {
      expect((await served.post('/claim/token', { token: TOKEN })).statusCode).toBe(401);
    } finally {
      await served.close();
    }
  });
});
