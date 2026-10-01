// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A yes/no column answers `true` or `false` on every engine, at every door.
 *
 * Postgres has a boolean. MySQL keeps one as `tinyint(1)` and SQLite as
 * `integer`, and both hand back `1` and `0` — which is what the staff API and
 * the public API used to pass on. An order page testing `open !== false` then
 * stayed open with the kitchen closed, and a folio testing `voided === true`
 * never drew a voided charge. The app's manifest says which columns are
 * answers (`type: "bool"`), and the reply spells them the one way.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { overridesRepo } from '@adminium/meta';

import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver } from './invoicing-routes.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

function cafe(): Record<string, unknown> {
  const manifest = invoicingManifest([
    {
      ref: 'days',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 20 },
        { ref: 'open', type: 'bool', default: true },
        // A count that happens to hold 0 and 1: a number, and it stays one.
        { ref: 'tables_free', type: 'int', default: 0 },
      ],
    },
  ]);
  manifest['key'] = 'cafe';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'days' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [{ table: 'days', methods: ['GET'], select: ['id', 'name', 'open', 'tables_free'] }];
  return manifest;
}

describe.each(LEGS)('a yes/no column over the staff and public APIs — %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let shop: Served;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, cafe());
    const no = dialect === 'postgres' ? 'false' : '0';
    const yes = dialect === 'postgres' ? 'true' : '1';
    await h.rows(`INSERT INTO ${h.real('days')} (name, open, tables_free) VALUES ('Monday', ${no}, 0), ('Tuesday', ${yes}, 1)`);
    shop = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 240_000);
  afterAll(async () => {
    await shop?.close();
    await h?.close();
  });

  it.runIf(available)('is kept as what it is: the install says which columns are answers', async () => {
    const rules = (await overridesRepo(h!.meta).listForConnection(h!.connectionId, { status: 'active' })).filter((rule) => (rule.op as string) === 'column.yesNo');
    expect(rules.map((rule) => [rule.columnName, rule.value])).toEqual([['open', { yesNo: true }]]);
  });

  it.runIf(available)('reads true and false on the public API, and leaves a number a number', async () => {
    const res = await shop.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${h!.real('days')}`, headers: shop.headers() });
    expect(res.statusCode, res.body).toBe(200);
    const rows = (res.json() as { data: Record<string, unknown>[] }).data.sort((a, b) => Number(a['id']) - Number(b['id']));
    expect(rows.map((row) => [row['name'], row['open'], Number(row['tables_free'])])).toEqual([
      ['Monday', false, 0],
      ['Tuesday', true, 1],
    ]);
  });

  it.runIf(available)('reads and writes true and false on the staff API', async () => {
    const r = await dataRoutesOver(h!, dialect);
    try {
      const made = await r.post('days', { values: { name: 'Wednesday', open: false, tables_free: 1 } });
      expect(made.statusCode, made.body).toBe(201);
      const row = made.json<{ data: Record<string, unknown> }>().data;
      expect([row['open'], Number(row['tables_free'])]).toEqual([false, 1]);
      const turned = await r.patch('days', Number(row['id']), { values: { open: true } });
      expect(turned.statusCode, turned.body).toBe(200);
      expect(turned.json<{ data: Record<string, unknown> }>().data['open']).toBe(true);
    } finally {
      await r.close();
    }
  });
});
