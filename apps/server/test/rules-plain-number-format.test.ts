// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PLAIN RUNNING NUMBER, WRITTEN OUT.
 *
 * A column that counts its rows may be written as people read it — a prefix
 * and padded digits — beside the number, in the save that claims it. Nothing
 * here promises a series without gaps: that is `gapless`. The prefix is a
 * fixed one, or a column of a settings row read when the number is claimed.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  return invoicingManifest([
    { ref: 'prefs', columns: [id, { ref: 'slip_prefix', type: 'text', maxLength: 8, nullable: true }] },
    {
      ref: 'slips',
      columns: [
        id,
        { ref: 'note', type: 'text', maxLength: 40, nullable: true },
        { ref: 'seq', type: 'int', nullable: true, rules: { sequence: { start: 1 } } },
        { ref: 'number', type: 'text', maxLength: 24, nullable: true, rules: { format: { from: 'seq', prefix: 'SL-', pad: 4 } } },
        // A second series on the same row, its prefix a setting's, with no padding.
        { ref: 'run', type: 'int', nullable: true, rules: { sequence: { start: 1001 } } },
        { ref: 'code', type: 'text', maxLength: 24, nullable: true, rules: { format: { from: 'run', prefixSetting: { table: 'prefs', column: 'slip_prefix' } } } },
      ],
    },
  ]);
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a plain running number written out, on ${dialect}`, () => {
    it('is written beside its number in the save that claims it, with the fixed prefix or the setting\'s', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const stored = async (key: unknown) => (await h.rows(`select seq, number, run, code from ${h.real('slips')} where id = ${String(key)}`))[0]!;
      const first = await w.create('slips', { note: 'a' });
      // No settings row yet: the number is written with no prefix, never left empty.
      expect(await stored(first['id'])).toMatchObject({ number: 'SL-0001', code: '1001' });
      expect(Number((await stored(first['id']))['seq'])).toBe(1);
      await h.rows(`insert into ${h.real('prefs')} (slip_prefix) values ('PO-')`);
      const second = await w.create('slips', { note: 'b' });
      expect(await stored(second['id'])).toMatchObject({ number: 'SL-0002', code: 'PO-1002' });
      // The save's own reply carries it: a screen shows the number without reading the row again.
      expect(second).toMatchObject({ number: 'SL-0002', code: 'PO-1002' });
      // A change claims nothing and rewrites nothing.
      await w.update('slips', second['id'], { note: 'c' });
      expect(await stored(second['id'])).toMatchObject({ number: 'SL-0002', code: 'PO-1002' });
    });
  });
}
