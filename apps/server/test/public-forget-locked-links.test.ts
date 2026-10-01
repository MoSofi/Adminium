// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's own links, stopped or made again, on rows a lock keeps — over
 * the public API of a shop installed by the real installer, on every engine:
 *
 *  - "Delete my details" (`forget.links`) with a collected order (a lock
 *    whose `except` names only the stop flag), a departed stay (the hotel's
 *    shape) or an order under a closed booking (a parent's `changeIn`):
 *    the person is forgotten and every link stops; only the code changes;
 *    the renewal is audited as the system's;
 *  - "Make a new link" on such a row works the same way;
 *  - every other write to those rows is refused as before: a staff change,
 *    a change through the row's own link;
 *  - a forgetting is heard by no outbox producer: nothing it emptied is kept
 *    in a message's `was`, and a producer still hears a real change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';

import { adminPasswordHash, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const tables = (manifest: Doc) => (manifest['requiredSchema'] as { tables: Doc[] }).tables;
const tableOf = (manifest: Doc, ref: string) => tables(manifest).find((t) => t['ref'] === ref)!;

/** The shop whose forgetting stops a person's links, with "Make a new link" on their orders; `shape` gives the orders their lock. */
function lockedShop(shape: 'collected' | 'departed' | 'changeIn'): Doc {
  const manifest = shopManifest({
    orders: shape === 'changeIn' ? { columns: [{ ref: 'booking_id', type: 'fk', references: 'bookings', nullable: true }] } : {},
    entries: (entries) =>
      entries.map((entry) => {
        if (entry['table'] === 'customers') return { ...entry, forget: { ...(entry['forget'] as Doc), links: true } };
        if (entry['table'] === 'orders' && entry['key'] === undefined && entry['claimedBy'] !== undefined && (entry['methods'] as string[]).join() === 'GET') {
          return { ...entry, newLink: { column: 'link_token', kind: 'order-new-link' } };
        }
        return entry;
      }),
  });
  const messages = tableOf(manifest, 'messages');
  const columns = messages['columns'] as Doc[];
  columns.find((c) => c['ref'] === 'kind')!['enum'] = ['order-placed', 'order-new-link'];
  columns.push({ ref: 'repeat_key', type: 'text', maxLength: 64, nullable: true });
  const outbox = manifest['outbox'] as { kinds: Record<string, string>; columns: Record<string, string> };
  outbox.kinds['order-new-link'] = 'shop-order-new-link';
  outbox.columns['repeatKey'] = 'repeat_key';
  (manifest['emailTemplates'] as Doc[]).push({
    key: 'shop-order-new-link',
    name: 'New link',
    locales: { 'en-US': { subject: 'Your new link', blocks: [{ block: 'email.text', data: { text: 'Your new link: {{manage_url}}#{{order.link_token}}' } }] } },
  });
  const orders = tableOf(manifest, 'orders');
  if (shape === 'collected') {
    // The ordering app's shape: locked once collected, the stop flag alone excepted.
    orders['states'] = { column: 'status', initial: 'placed', moves: { placed: ['ready'], ready: ['collected'] }, lock: { when: ['collected'], except: ['link_stopped'] } };
  } else if (shape === 'departed') {
    // The hotel's shape: a stay locked once departed or cancelled, its stop flag and language excepted.
    const status = (orders['columns'] as Doc[]).find((c) => c['ref'] === 'status')!;
    status['enum'] = ['booked', 'in_house', 'departed', 'cancelled'];
    status['default'] = 'booked';
    (orders['columns'] as Doc[]).push({ ref: 'language', type: 'text', maxLength: 8, nullable: true });
    orders['states'] = {
      column: 'status',
      initial: 'booked',
      moves: { booked: ['in_house', 'cancelled'], in_house: ['departed'] },
      lock: { when: ['departed', 'cancelled'], except: ['link_stopped', 'language'] },
    };
  } else {
    // A booking the orders belong to, whose orders change only while it is open.
    tables(manifest).unshift({
      ref: 'bookings',
      columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'status', type: 'enum', enum: ['open', 'closed'], default: 'open' }],
      states: { column: 'status', initial: 'open', moves: { open: ['closed'] }, children: { orders: { via: 'booking_id', changeIn: ['open'] } } },
    });
  }
  return manifest;
}

const CASES = [
  { shape: 'collected', lock: (h: InvoicingHarness, orders: string, id: number) => h.rows(`update ${orders} set status = 'collected' where id = ${String(id)}`) },
  { shape: 'departed', lock: (h: InvoicingHarness, orders: string, id: number) => h.rows(`update ${orders} set status = 'departed' where id = ${String(id)}`) },
  {
    shape: 'changeIn',
    lock: async (h: InvoicingHarness, orders: string, id: number) => {
      await h.rows(`insert into ${h.real('bookings')} (name, status) values ('Party ${String(id)}', 'closed')`);
      const [booking] = await h.rows(`select max(id) as id from ${h.real('bookings')}`);
      await h.rows(`update ${orders} set booking_id = ${String(booking!['id'])} where id = ${String(id)}`);
    },
  },
] as const;

for (const { shape, lock } of CASES) {
  describe.each(LEGS)(`own links of a locked row (${shape}) — %s`, (dialect, available) => {
    let h: InvoicingHarness & { reply: Record<string, unknown> };
    let shop: Served;
    let link: Served;
    let g: ReturnType<typeof guest>;
    let own: ReturnType<typeof guest>;
    let orders: string;
    let ordersId: string;
    let staff = '';
    beforeAll(async () => {
      if (!available) return;
      h = await installInvoicing(dialect, lockedShop(shape));
      await mailReady(h.meta);
      const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
      shop = await servePublic(h, keys['customer']!);
      link = await servePublic(h, keys['link']!);
      g = guest(shop, h);
      own = guest(link, h, 40_000);
      orders = h.real('orders');
      const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
      ordersId = model.tables.find((t) => t.name === orders)!.id;
      const user = await usersRepo(h.meta).create({ email: 'desk@shop.dev', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
      await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
      staff = (await login(shop.composed.app as never, 'desk@shop.dev', ADMIN_PASSWORD)).cookie ?? '';
    }, 180_000);
    afterAll(async () => {
      if (!available) return;
      await shop.close();
      await link.close();
      await h.close();
    });

    const order = async (email: string, name: string) => {
      const res = await g.request('POST', `/records/${orders}_verified_2`, { payload: { values: { email, name }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write' });
      expect(res.statusCode, res.body).toBe(201);
      return res.json() as { data: { id: number }; link: { token: string; session: string } };
    };
    const rowOf = async (id: number) => (await h.rows(`select * from ${orders} where id = ${String(id)}`))[0]!;
    const withoutCode = (row: Doc) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'link_token'));
    const lockedOrder = async (email: string, name: string) => {
      const made = await order(email, name);
      await lock(h, orders, made.data.id);
      return made;
    };
    const renewalAudits = async () =>
      (await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'public.link.renewed').execute()) as unknown as { actorKind: string; actorLabel: string }[];

    it.skipIf(!available)('a person with a locked row is forgotten, and its link stops; only the code changes', async () => {
      const past = await lockedOrder('ivy@fieldmail.io', 'Ivy');
      const opened = await own.request('POST', '/claim/token', { payload: { token: past.link.token } });
      expect(opened.statusCode, opened.body).toBe(200);
      const before = await rowOf(past.data.id);
      const ivy = await g.signIn('ivy@fieldmail.io');
      const gone = await g.request('DELETE', '/account', { session: ivy });
      expect(gone.statusCode, gone.body).toBe(200);
      const after = await rowOf(past.data.id);
      expect(after['link_token']).not.toBe(past.link.token);
      expect(String(after['link_token'])).toMatch(/^[0-9A-Z]{16}$/);
      expect(withoutCode(after)).toEqual(withoutCode(before));
      expect((await own.request('POST', '/claim/token', { payload: { token: past.link.token } })).statusCode).toBe(404);
      expect(await h.rows(`select email, name from ${h.real('customers')} where email = 'ivy@fieldmail.io'`)).toEqual([]);
      // The last email says what the app did: the links she holds stopped. It used to promise they still opened.
      const notice = (await mailOf(h.meta)).filter((m) => m.template === 'details-deleted' && m.to === 'ivy@fieldmail.io').at(-1)!;
      expect(notice.text).toContain('no longer work');
      expect(notice.text).not.toContain('still open');
      expect(notice.text).not.toMatch(/tickets|bookings|\{\{/);
      // The system's own write, on the person's asking.
      const audits = await renewalAudits();
      expect(audits.length).toBeGreaterThan(0);
      expect(audits.every((row) => row.actorKind === 'system' && row.actorLabel === 'system')).toBe(true);
    });

    it.skipIf(!available)('a person makes a new link for a locked row; only the code changes', async () => {
      const past = await lockedOrder('jo@fieldmail.io', 'Jo');
      const before = await rowOf(past.data.id);
      const jo = await g.signIn('jo@fieldmail.io');
      const res = await g.request('POST', `/records/shop_orders_verified/${String(past.data.id)}/new-link`, { session: jo });
      expect(res.statusCode, res.body).toBe(202);
      const after = await rowOf(past.data.id);
      expect(after['link_token']).not.toBe(past.link.token);
      expect(withoutCode(after)).toEqual(withoutCode(before));
    });

    it.skipIf(!available)('every other write to a locked row is refused as before', async () => {
      const past = await lockedOrder('kai@fieldmail.io', 'Kai');
      const before = await rowOf(past.data.id);
      const byStaff = await shop.composed.app.inject({
        method: 'PATCH',
        url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(ordersId)}/${String(past.data.id)}`,
        headers: { cookie: staff },
        payload: { values: { note: 'changed' } },
      });
      expect(byStaff.statusCode, byStaff.body).toBe(409);
      expect(byStaff.json().error.code).toBe('RECORD_LOCKED');
      const opened = await own.request('POST', '/claim/token', { payload: { token: past.link.token } });
      const session = (opened.json() as { data: { session: string } }).data.session;
      const byLink = await own.request('PATCH', `/records/shop_orders_claimed/${String(past.data.id)}`, { session, payload: { values: { note: 'changed' } } });
      expect(byLink.statusCode, byLink.body).toBeGreaterThanOrEqual(400);
      expect(await rowOf(past.data.id)).toEqual(before);
    });
  });
}

/** The shop, whose outbox also tells a customer their details changed, keeping what they were (a column the app marks not personal). */
function wasShop(): Doc {
  const manifest = shopManifest({
    entries: (entries) => entries.map((entry) => (entry['table'] === 'customers' ? { ...entry, forget: { columns: ['email', 'name', 'phone', 'nickname'], stamp: 'forgotten_at' } } : entry)),
  });
  (tableOf(manifest, 'customers')['columns'] as Doc[]).push({ ref: 'nickname', type: 'text', maxLength: 40, nullable: true, rules: { personal: false } });
  const messages = tableOf(manifest, 'messages');
  const columns = messages['columns'] as Doc[];
  columns.find((c) => c['ref'] === 'kind')!['enum'] = ['order-placed', 'details-changed'];
  columns.push({ ref: 'was', type: 'text', nullable: true });
  const outbox = manifest['outbox'] as { kinds: Record<string, string>; columns: Record<string, string>; producers: Doc[] };
  outbox.kinds['details-changed'] = 'shop-details-changed';
  outbox.columns['was'] = 'was';
  outbox.producers.push({ kind: 'details-changed', link: 'customer_id', onChange: { table: 'customers', columns: ['nickname'], changed: true }, repeat: true, was: ['nickname'] });
  (manifest['emailTemplates'] as Doc[]).push({
    key: 'shop-details-changed',
    name: 'Details changed',
    locales: { 'en-US': { subject: 'Your details', blocks: [{ block: 'email.text', data: { text: 'You were {{was.nickname}}.' } }] } },
  });
  return manifest;
}

describe.each(LEGS)('a forgetting heard by no outbox producer — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let customersId: string;
  let staff = '';
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, wasShop());
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    customersId = model.tables.find((t) => t.name === h.real('customers'))!.id;
    const user = await usersRepo(h.meta).create({ email: 'desk@shop.dev', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    staff = (await login(shop.composed.app as never, 'desk@shop.dev', ADMIN_PASSWORD)).cookie ?? '';
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });
  const messages = async () => h.rows(`select kind, status, was from ${h.real('messages')} where kind = 'details-changed' order by id`);

  it.skipIf(!available)('keeps nothing a person asked to be forgotten, while a real change is still heard', async () => {
    const res = await g.request('POST', `/records/${h.real('orders')}_verified_2`, { payload: { values: { email: 'kim@fieldmail.io', name: 'Kim' }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    const [customer] = await h.rows(`select id from ${h.real('customers')} where email = 'kim@fieldmail.io'`);
    // A desk's change of the nickname: heard, and what it was kept.
    const changed = await shop.composed.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(customersId)}/${String(customer!['id'])}`,
      headers: { cookie: staff },
      payload: { values: { nickname: 'Kimmy K' } },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const heard = await messages();
    expect(heard).toHaveLength(1);
    expect(String(heard[0]!['was'])).toContain('"nickname":null');
    // The forgetting empties it: no message, and no message keeps it.
    const kim = await g.signIn('kim@fieldmail.io');
    const gone = await g.request('DELETE', '/account', { session: kim });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await h.rows(`select nickname from ${h.real('customers')} where id = ${String(customer!['id'])}`)).toEqual([{ nickname: null }]);
    expect(await messages()).toHaveLength(1);
    expect(JSON.stringify(await h.rows(`select * from ${h.real('messages')}`))).not.toContain('Kimmy');
  });
});
