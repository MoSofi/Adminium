// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE FILLS THE COLUMNS IT ADDS THAT ADMINIUM WORKS OUT, for the rows
 * already there, on SQLite, Postgres and MySQL, through the real installer
 * and the whole server.
 *
 * 0.1.0 keeps deals and their lines. 0.1.1 adds, on rows that already exist:
 * two copies of the deal on each line (its owner, its state), a line's amount
 * worked out from its quantity and price, the deal's total of those amounts
 * with the balance beside it, a count of its lines, and a tax worked out from
 * the total — each read by the next, so the order they are filled in matters.
 *
 * And a line removed and put back by an undo takes the deal's owner as it is
 * now, not the one it was removed with.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'money', nullable: true, ...(rules === undefined ? {} : { rules }) });
const STATES = ['open', 'won', 'lost'];

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
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'state', type: 'enum', enum: STATES, default: 'open' },
            money('fee'),
            ...(next
              ? [
                  money('lines_total', { rollup: { from: 'lines', via: 'deal_id', sum: 'amount', balance: { column: 'left_to_pay', of: 'fee' } } }),
                  money('left_to_pay'),
                  { ref: 'line_count', type: 'int', nullable: true, rules: { rollup: { from: 'lines', via: 'deal_id', count: true } } },
                  money('vat', { formula: { mul: ['lines_total', 0.2] } }),
                ]
              : []),
          ],
        },
        {
          ref: 'lines',
          columns: [
            id,
            { ref: 'deal_id', type: 'fk', references: 'deals' },
            { ref: 'qty', type: 'int', default: 1 },
            money('price'),
            ...(next
              ? [
                  { ref: 'deal_owner_id', type: 'text', maxLength: 36, nullable: true, rules: { copy: { via: 'deal_id', from: 'owner_id', mode: 'always', follow: true } } },
                  { ref: 'deal_state', type: 'enum', enum: STATES, nullable: true, rules: { copy: { via: 'deal_id', from: 'state', mode: 'always', follow: true } } },
                  money('amount', { formula: { mul: ['qty', 'price'] } }),
                ]
              : []),
          ],
        },
      ],
    },
    pages: [{ ref: 'shop-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

/** A number as the three engines hand a money value back (`'25.5000'`, `25.5`), or null. */
const n = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an update fills the columns it adds that Adminium works out, on ${dialect}`, () => {
    let s: WholeServer;
    let updated: { statusCode: number; body: string };

    beforeAll(async () => {
      s = await wholeServer(dialect, shop('0.1.0'), { people: { ann: [], ron: [] } });
      const ann = s.ids['ann']!;
      const ron = s.ids['ron']!;
      // Rows made on 0.1.0, before any of the new columns exist.
      await s.rows(`INSERT INTO shop_deals (id, name, owner_id, state, fee) VALUES (1, 'Atrium', '${ann}', 'open', 100), (2, 'Belvedere', '${ron}', 'won', 50), (3, 'Cloister', NULL, 'lost', 10)`);
      await s.rows(`INSERT INTO shop_lines (id, deal_id, qty, price) VALUES (1, 1, 2, 10), (2, 1, 1, 5.5), (3, 2, 3, 4), (4, 2, 1, NULL)`);
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(shop('0.1.1')), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await s.app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: s.cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
      updated = await s.send('owner', 'POST', '/api/v1/apps/shop/update', {});
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('fills every line already there: both copies of its deal, and its amount', async () => {
      expect(updated.statusCode, updated.body).toBe(200);
      const lines = await s.rows('SELECT id, deal_owner_id, deal_state, amount FROM shop_lines ORDER BY id');
      expect(lines.map((row) => [Number(row['id']), row['deal_owner_id'], row['deal_state'], n(row['amount'])])).toEqual([
        [1, s.ids['ann'], 'open', 20],
        [2, s.ids['ann'], 'open', 5.5],
        [3, s.ids['ron'], 'won', 12],
        // No price yet: no amount, as a save of the line would leave it.
        [4, s.ids['ron'], 'won', null],
      ]);
    });

    it('fills every deal already there: the total of the amounts just worked out, its balance, its count, and the tax over the total', async () => {
      const deals = await s.rows('SELECT id, lines_total, left_to_pay, line_count, vat FROM shop_deals ORDER BY id');
      expect(deals.map((row) => [Number(row['id']), n(row['lines_total']), n(row['left_to_pay']), n(row['line_count']), n(row['vat'])])).toEqual([
        [1, 25.5, 74.5, 2, 5.1],
        [2, 12, 38, 2, 2.4],
        // A deal with no lines: a total of nothing, its whole fee left.
        [3, 0, 10, 0, 0],
      ]);
    });

    it('keeps them in step from then on, as any copy follows its deal', async () => {
      expect(said(await s.change('owner', 'deals', 2, { state: 'lost' }))).toBe('ok');
      expect((await s.rows('SELECT deal_state FROM shop_lines WHERE deal_id = 2 ORDER BY id')).map((row) => row['deal_state'])).toEqual(['lost', 'lost']);
    });

    it('puts a line removed and brought back by an undo under the deal’s owner as it is now', async () => {
      const table = s.t('lines');
      const removed = await s.send('owner', 'DELETE', `/api/v1/data/${s.connectionId}/${table}/1`);
      expect(removed.statusCode, removed.body).toBe(200);
      const { undoToken } = removed.json() as { undoToken: string };
      // The deal changes hands while the line is away.
      expect(said(await s.change('owner', 'deals', 1, { owner_id: s.ids['ron'] }))).toBe('ok');
      expect((await s.rows('SELECT deal_owner_id FROM shop_lines WHERE id = 2'))[0]!['deal_owner_id']).toBe(s.ids['ron']);
      const undone = await s.send('owner', 'POST', `/api/v1/data/undo/${undoToken}`, {});
      expect(undone.statusCode, undone.body).toBe(200);
      const [line] = await s.rows('SELECT deal_owner_id, deal_state, amount FROM shop_lines WHERE id = 1');
      expect(line!['deal_owner_id']).toBe(s.ids['ron']);
      expect(line!['deal_state']).toBe('open');
      expect(n(line!['amount'])).toBe(20);
    });
  });
}
