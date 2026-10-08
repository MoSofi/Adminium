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

import { forgetSeriesRead } from '../src/crud/decided-columns.js';
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

    it('a row that brings its own number moves the series past it: the next number is never one a row already holds', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const seqOf = async (key: unknown) => Number((await h.rows(`select seq from ${h.real('slips')} where id = ${String(key)}`))[0]!['seq']);
      // The series is counting: 1.
      expect(await seqOf((await w.create('slips', { note: 'first' }))['id'])).toBe(1);
      // An import, a sample, somebody's own number: written as it is given, and the series goes on after it.
      expect(await seqOf((await w.create('slips', { note: 'brought', seq: 5, number: 'SL-0005' }))['id'])).toBe(5);
      const next = await w.create('slips', { note: 'next' });
      expect(next).toMatchObject({ number: 'SL-0006' });
      expect(await seqOf(next['id'])).toBe(6);
      // A number brought from BEHIND the series moves nothing.
      await w.create('slips', { note: 'old', seq: 3, number: 'SL-0003' });
      expect(await seqOf((await w.create('slips', { note: 'after' }))['id'])).toBe(7);
    });

    it('a number near the end of what a series can count moves nothing: the series is not left with nowhere to go', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const seqOf = async (key: unknown) => Number((await h.rows(`select seq from ${h.real('slips')} where id = ${String(key)}`))[0]!['seq']);
      expect(await seqOf((await w.create('slips', { note: 'first' }))['id'])).toBe(1);
      // A typo, or somebody trying it: the row keeps its number, and the next one is still 2.
      await w.create('slips', { note: 'far', seq: 2_147_483_646, number: 'SL-FAR' });
      expect(await seqOf((await w.create('slips', { note: 'next' }))['id'])).toBe(2);
      // The same after a restart, when the series reads its table again.
      forgetSeriesRead();
      expect(await seqOf((await w.create('slips', { note: 'after the restart' }))['id'])).toBe(3);
    });

    it('a counter that is behind its table when the server starts is moved past it on the first number handed out', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const seqOf = async (key: unknown) => Number((await h.rows(`select seq from ${h.real('slips')} where id = ${String(key)}`))[0]!['seq']);
      expect(await seqOf((await w.create('slips', { note: 'first' }))['id'])).toBe(1);
      // Rows the write path never saw: restored from a backup, or written by hand while the server was down.
      await h.rows(`insert into ${h.real('slips')} (note, seq, number) values ('restored', 2, 'SL-0002'), ('restored', 9, 'SL-0009')`);
      forgetSeriesRead();
      const next = await w.create('slips', { note: 'after the restart' });
      expect(next).toMatchObject({ number: 'SL-0010' });
      expect(await seqOf(next['id'])).toBe(10);
    });
  });
}
