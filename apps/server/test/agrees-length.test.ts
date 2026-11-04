// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LENGTH AGREEMENT: a line's lettering no longer than its product allows.
 *
 * A maker's order line carries the words to engrave; each product says how
 * many characters it takes (`lettering_limit`). The order's entry holds each
 * line to it (`{ column: 'lettering', length: true, lte: { via: 'product_id',
 * column: 'lettering_limit' } }`): a line with more characters is refused as
 * `too-long` on the column, on a guest's order and on a quote of it, and
 * nothing is kept; characters are counted as a person counts them (an accent
 * or an emoji is one); a product with no limit sets none. As written, the rule is a word of 0.3.44, and only a text
 * compared at most with a number. On every engine.
 */
import { installFloorWords, validateManifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const FITS = { column: 'lettering', length: true, lte: { via: 'product_id', column: 'lettering_limit' } };

function maker(agree: Record<string, unknown> = FITS, floor = '0.3.44'): Record<string, unknown> {
  const manifest = invoicingManifest([
    { ref: 'products', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'lettering_limit', type: 'int', nullable: true }] },
    { ref: 'orders', columns: [id, { ref: 'email', type: 'text', maxLength: 254 }] },
    {
      ref: 'order_lines',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'orders' },
        { ref: 'product_id', type: 'fk', references: 'products' },
        { ref: 'lettering', type: 'text', maxLength: 80, nullable: true },
      ],
    },
  ]);
  manifest['key'] = 'mk';
  manifest['compatibility'] = { minAdminiumVersion: floor };
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'products', methods: ['GET'], select: ['id', 'name', 'lettering_limit'] },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      writable: ['email'],
      select: ['id'],
      dryRun: true,
      children: { order_lines: { via: 'order_id', writable: ['product_id', 'lettering'], select: ['id'], min: 1, max: 6, agrees: [agree] } },
    },
  ];
  return manifest;
}

describe('a length agreement, as written', () => {
  const issues = (agree: Record<string, unknown>) => {
    const read = validateManifest(maker(agree));
    return read.ok ? [] : read.issues.map((issue) => issue.message);
  };

  it('is a word of 0.3.44, refused under an older floor', () => {
    expect(installFloorWords(maker()).map((found) => found.word)).toContain('agrees.length');
    expect(validateManifest(maker(FITS, '0.3.43')).ok).toBe(false);
    expect(validateManifest(maker()).ok).toBe(true);
  });

  it('is a text at most a number, or a whole number', () => {
    expect(issues({ ...FITS, lte: undefined, gte: FITS.lte })).toEqual([expect.stringContaining('compared with lte')]);
    expect(issues({ ...FITS, column: 'product_id' })).toEqual([expect.stringContaining('is not text')]);
    expect(issues({ ...FITS, lte: { via: 'product_id', column: 'name' } })).toEqual([expect.stringContaining('is not a number')]);
    expect(issues({ ...FITS, lte: { value: 2.5 } })).toEqual([expect.stringContaining('whole number')]);
    expect(issues({ ...FITS, lte: { value: 12 } })).toEqual([]);
  });
});

describe.each(LEGS)("a line's lettering no longer than its product allows — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ip = 0;
  beforeAll(async () => {
    if (!available) return;
    h = (await installInvoicing(dialect, maker())) as typeof h;
    // A ring takes 10 characters, a plaque 30, a card as many as the column holds.
    await h.rows(`INSERT INTO mk_products (id, name, lettering_limit) VALUES (1, 'Ring', 10), (2, 'Plaque', 30), (3, 'Card', NULL)`);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  const call = async (url: string, payload: Record<string, unknown>) => {
    ip += 1;
    const address = `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
    const challenge = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: served.headers() });
    const c = (challenge.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public/records/${url}`,
      remoteAddress: address,
      headers: served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` }),
      payload,
    });
  };
  const order = (lines: Record<string, unknown>[]) => ({ values: { email: 'guest@example.com' }, children: { order_lines: lines.map((line) => ({ values: line })) } });
  const lines = async () => Number((await h.rows('select count(*) as n from mk_order_lines'))[0]!['n']);
  const refusal = (res: { json: () => unknown }) => (res.json() as { error: { code: string; params?: Record<string, unknown> } }).error;

  it.runIf(available)('refuses a line with more characters than its product takes as too-long, on a save and a quote, keeping nothing', async () => {
    const before = await lines();
    const tooLong = order([{ product_id: 2, lettering: 'Mum & Dad' }, { product_id: 1, lettering: 'Mum & Dad 1985' }]);
    const expected = { code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_lines', index: 1, column: 'lettering', reason: 'too-long' } };
    const saved = await call('mk_orders', tooLong);
    expect(saved.statusCode, saved.body).toBe(400);
    expect(refusal(saved)).toMatchObject(expected);
    const quoted = await call('mk_orders/dry-run', tooLong);
    expect(quoted.statusCode, quoted.body).toBe(400);
    expect(refusal(quoted)).toMatchObject(expected);
    expect(await lines()).toBe(before);
  });

  it.runIf(available)('takes a line at its limit, counted as a person counts (an accent, an emoji), and a product with no limit', async () => {
    const res = await call('mk_orders', order([{ product_id: 1, lettering: 'Zoë 💍 1985' }, { product_id: 1, lettering: '0123456789' }, { product_id: 3, lettering: 'x'.repeat(60) }, { product_id: 1 }]));
    expect(res.statusCode, res.body).toBe(201);
    // Eleven characters is one too many, however it is written.
    const over = await call('mk_orders', order([{ product_id: 1, lettering: 'Zoë 💍 19855' }]));
    expect(refusal(over)).toMatchObject({ params: { column: 'lettering', reason: 'too-long' } });
  });
});
