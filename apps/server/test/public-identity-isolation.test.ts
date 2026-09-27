// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One person's session, and one order's own link, reach their own rows and
 * nothing else — over every ref of the shop's two keys, on every engine:
 * another person's orders are the one 404 by id and absent from every list,
 * whether read, changed or read through a parent; an order's own link opens
 * that order and its lines, not the same person's other order; and one
 * person deleting their details leaves another's session as it was.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

describe.each(LEGS)("one person's rows and nobody else's — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let own: ReturnType<typeof guest>;
  const made: Record<string, { id: number; session: string }> = {};
  let ana: string;
  let ben: string;
  let refs: { customer: string[]; link: string[] };
  const t = (ref: string) => `shop_${ref}`;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
    await mailReady(h.meta);
    await h.rows(`insert into ${t('customers')} (email, name) values ('ana@example.com', 'Ana'), ('ben@example.com', 'Ben')`);
    await h.rows(`insert into ${t('settings')} (bank_name, account_number) values ('Town Bank', '1')`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(shop, h);
    own = guest(link, h, 40_000);
    for (const [name, email] of [
      ['A1', 'ana@example.com'],
      ['A2', 'ana@example.com'],
      ['B1', 'ben@example.com'],
    ] as const) {
      const res = await g.request('POST', `/records/${t('orders')}_verified_2`, {
        payload: { values: { email, name }, children: { order_items: [{ values: { dish: `${name} soup`, qty: 1 } }] } },
        proof: 'write',
      });
      expect(res.statusCode, res.body).toBe(201);
      const body = res.json() as { data: { id: number }; link: { session: string } };
      made[name] = { id: body.data.id, session: body.link.session };
    }
    ana = await g.signIn('ana@example.com');
    ben = await g.signIn('ben@example.com');
    const refsOf = async (served: ReturnType<typeof guest>) => Object.keys(((await served.request('GET', '/config')).json() as { data: { refs: Doc } }).data.refs);
    refs = { customer: await refsOf(g), link: await refsOf(own) };
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await h.close();
  });

  /** Everything a list of a ref shows this session, as text. */
  const everything = async (served: ReturnType<typeof guest>, list: string[], session: string) => {
    const out: string[] = [];
    for (const ref of list) {
      const res = await served.request('GET', `/records/${ref}`, { session });
      if (res.statusCode === 200) out.push(res.body);
    }
    return out.join('\n');
  };

  it.skipIf(!available)("reads none of another person's rows from any ref, by list or by id, nor changes them", async () => {
    const seen = await everything(g, refs.customer, ana);
    expect(seen).toContain('"A1"');
    expect(seen).not.toContain('B1');
    expect(seen).not.toContain('ben@example.com');
    for (const ref of refs.customer) {
      const byId = await g.request('GET', `/records/${ref}/${made['B1']!.id}`, { session: ana });
      if (byId.statusCode === 200) expect(byId.body).not.toContain('B1');
    }
    expect((await g.request('GET', `/records/${t('orders')}_verified/${made['B1']!.id}`, { session: ana })).statusCode).toBe(404);
    const renamed = await g.request('PATCH', `/records/${t('customers')}_claimed/2`, { payload: { values: { name: 'Taken' } }, session: ana });
    expect(renamed.statusCode).toBe(404);
    expect((await h.rows(`select name from ${t('customers')} where email = 'ben@example.com'`))[0]!['name']).toBe('Ben');
  });

  it.skipIf(!available)("opens one order by its own link — not the same person's other order, nor anyone else's", async () => {
    const seen = await everything(own, refs.link, made['A1']!.session);
    expect(seen).toContain('A1 soup');
    expect(seen).not.toContain('A2');
    expect(seen).not.toContain('B1');
    for (const other of ['A2', 'B1']) {
      expect((await own.request('GET', `/records/${t('orders')}_claimed/${made[other]!.id}`, { session: made['A1']!.session })).statusCode).toBe(404);
      const note = await own.request('PATCH', `/records/${t('orders')}_claimed/${made[other]!.id}`, { payload: { values: { note: 'mine now' } }, session: made['A1']!.session });
      expect(note.statusCode).toBe(404);
    }
    expect(Number((await h.rows(`select count(*) as n from ${t('orders')} where note = 'mine now'`))[0]!['n'])).toBe(0);
    // Its own note it may change.
    const mine = await own.request('PATCH', `/records/${t('orders')}_claimed/${made['A1']!.id}`, { payload: { values: { note: 'no onions' } }, session: made['A1']!.session });
    expect(mine.statusCode, mine.body).toBe(200);
    // A row's own link is never a way into the person: the customer key does not take it.
    expect((await g.request('GET', `/records/${t('orders')}_verified`, { session: made['A1']!.session })).statusCode).toBe(404);
  });

  it.skipIf(!available)("leaves another person's session as it was when one deletes their details", async () => {
    const fresh = await g.signIn('ana@example.com');
    expect((await g.request('DELETE', '/account', { session: fresh })).statusCode).toBe(200);
    const theirs = await g.request('GET', `/records/${t('orders')}_verified`, { session: ben });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.body).toContain('ben@example.com');
    expect((await g.request('GET', `/records/${t('orders')}_verified`, { session: ana })).statusCode).toBe(404);
  });
});
