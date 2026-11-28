// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN INSTALLED APP'S SETTINGS TABLE KEEPS ONE ROW, against the whole server
 * through the real installer, with the app's database on SQLite, Postgres and
 * MySQL:
 *
 *  - the data route makes the first settings row and refuses a second, by
 *    name (409 `ONE_ROW_TABLE`); a table that is not the app's settings
 *    takes as many rows as it is given;
 *  - a settings table that holds a second row anyway (written straight in the
 *    database, with a LOWER key than the row Adminium made) is read by that
 *    lowest key: the reply address of the app's receipt is that row's. On
 *    Postgres the database hands the other row back first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS, said, wholeServer, type QueuedEmail, type WholeServer } from './whole-server.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });

const shop: Record<string, unknown> = {
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version: '0.1.0',
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'mft.shop.desc', fallback: 'A shop.' },
  categories: ['crm'],
  navGroups: [{ key: 'shop', label: { 'en-US': 'Shop' }, order: 1 }],
  compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'settings', columns: [id, text('name', 80), text('house_email', 254)] },
      { ref: 'customers', columns: [id, text('email', 254), text('name', 80)] },
      { ref: 'orders', columns: [id, fk('customer_id', 'customers'), text('item', 80)] },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: ['receipt'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          text('to_address', 254),
          fk('customer_id', 'customers'),
          fk('order_id', 'orders'),
          text('error', 200),
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
        ],
      },
    ],
  },
  pages: [{ ref: 'shop-settings', template: 'page-crud', title: { key: 't.settings', fallback: 'Settings' }, nav: { group: 'shop', icon: 'settings', order: 1 }, bindings: { rows: 'settings' } }],
  outbox: {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
    links: { order: 'order_id' },
    recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name' },
    settings: { table: 'settings', name: 'name', replyTo: 'house_email' },
    kinds: { receipt: 'shop-receipt' },
    producers: [{ kind: 'receipt', link: 'order_id', onCreate: { table: 'orders' } }],
  },
  emailTemplates: [{ key: 'shop-receipt', name: 'shop-receipt', locales: { 'en-US': { subject: 'Your receipt: {{order.item}}', blocks: [{ block: 'email.text', data: { text: 'Hello {{recipient.name}}.' } }] } } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's settings table keeps one row, on ${dialect}`, () => {
    let s: WholeServer;
    beforeAll(async () => {
      s = await wholeServer(dialect, shop, { smtp: true });
      await s.emails();
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('makes the first settings row and refuses a second, by name', async () => {
      expect(said(await s.make('owner', 'settings', { id: 5, name: 'Fernlight', house_email: 'made@fernlight.example' }))).toBe('ok');
      const second = await s.make('owner', 'settings', { id: 6, name: 'Second shop?', house_email: 'second@fernlight.example' });
      expect(said(second)).toBe('409 ONE_ROW_TABLE');
      expect((second.json() as { error: { message: string } }).error.message).toBe("This table holds the app's settings: it has one row. Edit that row.");
      expect(await s.rows(`SELECT id FROM shop_settings`)).toEqual([{ id: 5 }]);
      // Its row is still changed as before.
      expect(said(await s.change('owner', 'settings', 5, { name: 'Fernlight Studio' }))).toBe('ok');
    });

    it('a table that is not the settings takes as many rows as it is given', async () => {
      for (const key of [1, 2]) expect(said(await s.make('owner', 'customers', { id: key, email: `c${String(key)}@harbour.dev`, name: `C${String(key)}` }))).toBe('ok');
    });

    it('a second row written straight in the database: the lowest key is the settings row, for the receipt as for the rest', async () => {
      await s.rows(`INSERT INTO shop_settings (id, name, house_email) VALUES (1, 'Lowest', 'lowest@fernlight.example')`);
      expect(said(await s.make('owner', 'orders', { id: 1, customer_id: 1, item: 'Desk lamp' }))).toBe('ok');
      await s.app.outboxSender.sendApp('shop', Date.now());
      const mail = (await s.emails()).filter((one) => one.templateKey === 'shop-receipt') as (QueuedEmail & { replyTo?: string })[];
      expect(mail).toHaveLength(1);
      expect(mail[0]!.replyTo).toBe('lowest@fernlight.example');
    });
  });
}
