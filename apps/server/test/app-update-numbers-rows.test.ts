// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE THAT NUMBERS A COLUMN NUMBERS THE ROWS ALREADY THERE, on SQLite,
 * Postgres and MySQL, through the real installer and the whole server.
 *
 * 0.1.0 keeps orders and their lines; a line's position is a plain column.
 * 0.1.1 numbers it per order without gaps, sample rows too (`sequence {
 * gapless, scope, sample }`), and labels a line by its order and position.
 * A number is only ever taken when a row is made, so the lines made by hand
 * on 0.1.0 would stay unnumbered for ever: the update numbers each order's
 * empty ones after the largest it holds, by key, keeps the numbers already
 * there, and works the label out over the numbers it gave. An invoice's
 * number (a series without `sample`) is a document's, given when it is made:
 * the update leaves its rows as they are.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.53' }));

const id = { ref: 'id', type: 'int', role: 'pk' };

function shop(version: '0.1.0' | '0.1.1'): Record<string, unknown> {
  const next = version === '0.1.1';
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version,
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.shop.desc', fallback: 'A shop.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'orders', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'lines',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'what', type: 'text', maxLength: 80 },
            { ref: 'position', type: 'int', nullable: true, ...(next ? { rules: { sequence: { gapless: true, scope: 'order_id', sample: true } } } : {}) },
            ...(next ? [{ ref: 'label', type: 'text', maxLength: 40, nullable: true, rules: { formula: { join: ['what', '/', 'position'] } } }] : []),
          ],
        },
        {
          ref: 'invoices',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'number_seq', type: 'int', nullable: true, ...(next ? { rules: { sequence: { gapless: true } } } : {}) },
          ],
        },
      ],
    },
    pages: [{ ref: 'shop-orders', template: 'page-crud', title: { key: 't.orders', fallback: 'Orders' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an update that numbers a column numbers the rows already there, on ${dialect}`, () => {
    let s: WholeServer;
    let updated: { statusCode: number; body: string };

    beforeAll(async () => {
      s = await wholeServer(dialect, shop('0.1.0'));
      await s.rows(`INSERT INTO shop_orders (id, name) VALUES (1, 'Atrium'), (2, 'Belvedere'), (3, 'Cloister')`);
      // Order 1: one line already numbered 4 (kept), three without, out of key order on purpose. Order 2: none numbered.
      await s.rows(
        `INSERT INTO shop_lines (id, order_id, what, position) VALUES (7, 1, 'a', NULL), (3, 1, 'b', 4), (5, 1, 'c', NULL), (9, 1, 'd', NULL), (2, 2, 'e', NULL), (8, 2, 'f', NULL)`,
      );
      await s.rows(`INSERT INTO shop_invoices (id, name, number_seq) VALUES (1, 'Kept empty', NULL)`);
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(shop('0.1.1')), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await s.app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: s.cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
      updated = await s.send('owner', 'POST', '/api/v1/apps/shop/update', {});
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('numbers each order’s empty lines after the largest it holds, by key, and keeps the numbers already there', async () => {
      expect(updated.statusCode, updated.body).toBe(200);
      const lines = await s.rows('SELECT id, order_id, position FROM shop_lines ORDER BY id');
      expect(lines.map((row) => [Number(row['id']), Number(row['order_id']), Number(row['position'])])).toEqual([
        [2, 2, 1],
        [3, 1, 4],
        [5, 1, 5],
        [7, 1, 6],
        [8, 2, 2],
        [9, 1, 7],
      ]);
    });

    it('works out what reads the number over the numbers it gave', async () => {
      const lines = await s.rows('SELECT id, label FROM shop_lines ORDER BY id');
      expect(lines.map((row) => [Number(row['id']), row['label']])).toEqual([
        [2, 'e/1'],
        [3, 'b/4'],
        [5, 'c/5'],
        [7, 'a/6'],
        [8, 'f/2'],
        [9, 'd/7'],
      ]);
    });

    it('leaves a document’s series (no sample rows in it) as it was', async () => {
      const [invoice] = await s.rows('SELECT number_seq FROM shop_invoices WHERE id = 1');
      expect(invoice!['number_seq']).toBeNull();
    });

    it('carries the series on from there for a line made after', async () => {
      expect(said(await s.make('owner', 'lines', { order_id: 1, what: 'g' }))).toBe('ok');
      const [line] = await s.rows("SELECT position FROM shop_lines WHERE what = 'g'");
      expect(Number(line!['position'])).toBe(8);
    });
  });
}
