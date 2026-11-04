// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORMULA OVER A RUNNING NUMBER: an order's number as it is typed.
 *
 * `number_code` joins the order's number and is kept as a code (`BR-2291` →
 * `BR2291`), so a person who types "br-2291" finds the order. The number is
 * written when it is taken — a number without gaps at the row's INSERT, a
 * counted one when it is claimed — after the row's formulas are worked out;
 * the formulas that read it are worked out again on the number taken, in the
 * same statement. A problem report's link to its order, looked up from the
 * typed number on `number_code` and scoped by address, then finds it.
 *
 * On every engine this run reaches, through an app installed by the real
 * installer.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  const m = invoicingManifest([
    {
      ref: 'shop_orders',
      columns: [
        id,
        { ref: 'email', type: 'text', maxLength: 254 },
        { ref: 'number_seq', type: 'int', nullable: true, rules: { sequence: { gapless: true, start: 2291 } } },
        { ref: 'number', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { format: { from: 'number_seq', prefix: 'BR-' } } },
        { ref: 'number_code', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { formula: { join: ['number', ' '] }, normalize: 'code' } },
      ],
    },
    {
      // A counted number (no promise of no gaps), written out the same way.
      ref: 'slips',
      columns: [
        id,
        { ref: 'seq', type: 'int', nullable: true, rules: { sequence: { start: 1 } } },
        { ref: 'number', type: 'text', maxLength: 16, nullable: true, rules: { format: { from: 'seq', prefix: 'SL-', pad: 4 } } },
        { ref: 'number_code', type: 'text', maxLength: 16, nullable: true, rules: { formula: { join: ['number', ' '] }, normalize: 'code' } },
      ],
    },
    {
      ref: 'problem_reports',
      columns: [
        id,
        { ref: 'email', type: 'text', maxLength: 254 },
        { ref: 'order_ref', type: 'text', maxLength: 16, nullable: true },
        { ref: 'order_id', type: 'fk', references: 'shop_orders', nullable: true, rules: { lookup: { from: 'order_ref', table: 'shop_orders', column: 'number_code', scope: [{ column: 'email', equals: 'email' }] } } },
      ],
    },
  ]);
  return m;
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a formula over a running number, on ${dialect}`, () => {
    it('is worked out on the number taken, and a typed number finds its order', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const stored = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0]!;
      const order = await w.create('shop_orders', { email: 'ada@example.com' });
      expect(await stored('shop_orders', order['id'])).toMatchObject({ number: 'BR-2291', number_code: 'BR2291' });
      const next = await w.create('shop_orders', { email: 'bo@example.com' });
      expect(await stored('shop_orders', next['id'])).toMatchObject({ number: 'BR-2292', number_code: 'BR2292' });
      // A counted number too.
      const slip = await w.create('slips', {});
      expect(await stored('slips', slip['id'])).toMatchObject({ number: 'SL-0001', number_code: 'SL0001' });
      // Typed the way a person types it, by the order's own address.
      const report = await w.create('problem_reports', { email: 'ada@example.com', order_ref: 'br-2291' });
      expect(Number((await stored('problem_reports', report['id']))['order_id'])).toBe(Number(order['id']));
      // Another address's order is not found.
      await expect(w.create('problem_reports', { email: 'ada@example.com', order_ref: 'BR 2292' })).rejects.toMatchObject({ details: { fields: { order_ref: expect.anything() } } });
    });
  });
}
