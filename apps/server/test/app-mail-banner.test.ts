// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S MAIL WEARS THE BUSINESS'S NAME, NOT ADMINIUM'S, against the whole
 * server on SQLite, Postgres and MySQL, through an app installed by the real
 * installer:
 *
 *  - a message of the app's outbox whose template names no brand carries
 *    the business's name (its settings row's) in the header band, and no
 *    Adminium mark in front of it;
 *  - Adminium's own mail (no business named) keeps the workspace's name and
 *    the shipped mark, as before.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prepareEmail } from '../src/email/send.js';
import { LEGS, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

function shop(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.shop.desc', fallback: 'A shop.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, text('name', 80)] },
        { ref: 'customers', columns: [id, text('email', 254), text('name', 80)] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['hello'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'shop-customers', template: 'page-crud', title: { key: 't.customers', fallback: 'Customers' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'customers' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: {},
      recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name' },
      kinds: { hello: 'shop-hello' },
    },
    emailTemplates: [{ key: 'shop-hello', name: 'shop-hello', locales: { 'en-US': { subject: 'Hello', blocks: [{ block: 'email.text', data: { text: 'Your order is in.' } }] } } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

/** The header band of a rendered message: the first row of the card. */
const bandOf = (html: string): string => {
  const at = html.indexOf('padding:18px 24px;border-radius:12px 12px 0 0;');
  expect(at, 'the message has a header band').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</tr></table></td></tr>', at));
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's mail wears the business's name, on ${dialect}`, () => {
    let s: WholeServer;

    beforeAll(async () => {
      s = await wholeServer(dialect, shop(), { people: {}, smtp: true });
      await s.rows(`INSERT INTO shop_settings (id, name) VALUES (1, 'Birch Row')`);
      await s.rows(`INSERT INTO shop_customers (id, email, name) VALUES (1, 'wendy@birch.dev', 'Wendy Walker')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('names the business in the header band, with no Adminium mark in front of it', async () => {
      await s.emails();
      await s.rows(`INSERT INTO shop_messages (id, kind, status, customer_id) VALUES (1, 'hello', 'queued', 1)`);
      await s.app.outboxSender.sendApp('shop', Date.now());
      const mail = (await s.emails()).filter((one) => one.templateKey === 'shop-hello');
      expect(mail).toHaveLength(1);
      const band = bandOf(mail[0]!.html);
      expect(band).toContain('Birch Row');
      expect(band).not.toContain('Adminium');
      expect(mail[0]!.html).not.toContain('cid:mark');
    });

    it('leaves Adminium’s own mail as it was: the workspace’s name and the shipped mark', async () => {
      const doc = { subject: 'Reset', preheader: '', blocks: [], footer: '', brand: null, attachments: [] };
      const own = await prepareEmail(s.meta, doc as never);
      expect(own.render.mark).toEqual({ kind: 'mark', mark: 'hexagon' });
      expect(own.render.brand?.name).toBe('Adminium');
      // The same document as an app's mail: the business's name, and no mark.
      const app = await prepareEmail(s.meta, doc as never, { brandName: 'Birch Row' });
      expect(app.render.mark).toBeUndefined();
      expect(app.render.brand?.name).toBe('Birch Row');
      // A template that names a brand keeps it, mark and all.
      const branded = await prepareEmail(s.meta, { ...doc, brand: { name: 'Studio', mark: 'leaf', accent: '#336699', fromName: '', fromEmail: '' } } as never, { brandName: 'Birch Row' });
      expect(branded.render.brand?.name).toBe('Studio');
      expect(branded.render.mark).toEqual({ kind: 'mark', mark: expect.any(String) as string });
    });
  });
}
