// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE NEWEST ROW'S VALUE.
 *
 * A deal's amount is the total of its last sent quote: not a sum of its
 * quotes and not a count, but one row's value — `rollup.latest`. It is kept
 * in the statement that writes the quote, with the key of the row it took
 * beside it, on every engine: a quote sent, a later one sent, a line added
 * to the one that counts (two tables up), a send taken back, a quote
 * withdrawn, deleted, or moved to another deal.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { latestOf } from '../src/crud/write-service.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  return { ...invoicingManifest(tables()), compatibility: { minAdminiumVersion: '0.3.27' } };
}

function tables(): Record<string, unknown>[] {
  return [
    {
      ref: 'deals',
      columns: [
        id,
        { ref: 'typed', type: 'decimal', scale: 2, nullable: true },
        { ref: 'quoted', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'quotes', via: 'deal_id', latest: { of: 'total', by: 'sent_at', row: 'quote_id' }, unlessSet: 'withdrawn_at' } } },
        { ref: 'quote_id', type: 'int', nullable: true },
        { ref: 'amount', type: 'decimal', scale: 2, rules: { formula: { coalesce: [{ coalesce: ['quoted', 'typed'] }, 0] } } },
      ],
    },
    {
      ref: 'quotes',
      columns: [
        id,
        { ref: 'deal_id', type: 'fk', references: 'deals' },
        { ref: 'subtotal', type: 'decimal', scale: 2, default: 0, rules: { rollup: { from: 'quote_lines', via: 'quote_id', sum: 'amount' } } },
        { ref: 'total', type: 'decimal', scale: 2, default: 0, rules: { formula: { coalesce: ['subtotal', 0] } } },
        { ref: 'sent_at', type: 'timestamptz', nullable: true },
        { ref: 'withdrawn_at', type: 'timestamptz', nullable: true },
      ],
    },
    { ref: 'quote_lines', columns: [id, { ref: 'quote_id', type: 'fk', references: 'quotes' }, { ref: 'amount', type: 'decimal', scale: 2 }] },
  ];
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`the newest row's value, on ${dialect}`, () => {
    const setUp = async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const deal = async (key: unknown) => {
        const [row] = await h.rows(`select quoted, quote_id, amount from ${h.real('deals')} where id = ${String(key)}`);
        return [row!['quoted'] === null ? null : Number(row!['quoted']), row!['quote_id'] === null ? null : Number(row!['quote_id']), Number(row!['amount'])];
      };
      const quote = async (dealId: unknown, lines: number[], sent?: string) => {
        const made = await w.create('quotes', { deal_id: dealId });
        for (const amount of lines) await w.create('quote_lines', { quote_id: made['id'], amount });
        if (sent !== undefined) await w.update('quotes', made['id'], { sent_at: sent });
        return Number(made['id']);
      };
      const remove = (ref: string, key: unknown) => w.writes.delete({ target: w.targetOf(ref), pk: { id: key }, context: w.desk, announce: async () => {} });
      const h_lines = async (quoteId: number) => (await h.rows(`select id from ${h.real('quote_lines')} where quote_id = ${String(quoteId)}`)).map((row) => row['id']);
      return { h, w, deal, quote, remove, h_lines };
    };

    it('is empty until a quote is sent, then follows the last one sent', async () => {
      const { w, deal, quote } = await setUp();
      const d = (await w.create('deals', { typed: 48000 }))['id'];
      expect(await deal(d)).toEqual([null, null, 48000]);
      // Written, with its lines, and not sent: nothing to take yet.
      const first = await quote(d, [40000, 12800]);
      expect(await deal(d)).toEqual([null, null, 48000]);
      await w.update('quotes', first, { sent_at: '2026-06-30T11:20:00Z' });
      expect(await deal(d)).toEqual([52800, first, 52800]);
      // A second version, cheaper, approved or not: it counts only once it is sent.
      const second = await quote(d, [35000, 13000]);
      expect(await deal(d)).toEqual([52800, first, 52800]);
      await w.update('quotes', second, { sent_at: '2026-07-28T10:00:00Z' });
      expect(await deal(d)).toEqual([48000, second, 48000]);
    });

    it('moves with a line of the quote it took, two tables below the deal', async () => {
      const { w, deal, quote, remove } = await setUp();
      const d = (await w.create('deals', {}))['id'];
      const older = await quote(d, [100], '2026-07-01T09:00:00Z');
      const newer = await quote(d, [80], '2026-07-02T09:00:00Z');
      expect(await deal(d)).toEqual([80, newer, 80]);
      const line = await w.create('quote_lines', { quote_id: newer, amount: 5 });
      expect(await deal(d)).toEqual([85, newer, 85]);
      await w.update('quote_lines', line['id'], { amount: 7.5 });
      expect(await deal(d)).toEqual([87.5, newer, 87.5]);
      // A line of the older quote changes the older quote, and nothing the deal shows.
      await w.create('quote_lines', { quote_id: older, amount: 1 });
      expect(await deal(d)).toEqual([87.5, newer, 87.5]);
      await remove('quote_lines', line['id']);
      expect(await deal(d)).toEqual([80, newer, 80]);
    });

    it('falls back to the one before when the newest stops counting, and to nothing after the last', async () => {
      const { w, deal, quote, remove } = await setUp();
      const d = (await w.create('deals', { typed: 10 }))['id'];
      const a = await quote(d, [100], '2026-07-01T09:00:00Z');
      const b = await quote(d, [80], '2026-07-02T09:00:00Z');
      const c = await quote(d, [60], '2026-07-03T09:00:00Z');
      expect(await deal(d)).toEqual([60, c, 60]);
      // Withdrawn: the rule leaves it out.
      await w.update('quotes', c, { withdrawn_at: '2026-07-04T09:00:00Z' });
      expect(await deal(d)).toEqual([80, b, 80]);
      // The send taken back.
      await w.update('quotes', b, { sent_at: null });
      expect(await deal(d)).toEqual([100, a, 100]);
      // Sent again, later than everything: it is the newest once more.
      await w.update('quotes', b, { sent_at: '2026-07-05T09:00:00Z' });
      expect(await deal(d)).toEqual([80, b, 80]);
      await remove('quote_lines', (await w.create('quote_lines', { quote_id: b, amount: 1 }))['id']);
      await w.update('quotes', b, { withdrawn_at: '2026-07-06T09:00:00Z' });
      await w.update('quotes', a, { withdrawn_at: '2026-07-06T09:00:00Z' });
      expect(await deal(d)).toEqual([null, null, 10]);
    });

    it('takes the greater key of two quotes sent at the same moment, and follows a quote to another deal', async () => {
      const { w, deal, quote } = await setUp();
      const d = (await w.create('deals', {}))['id'];
      const other = (await w.create('deals', {}))['id'];
      const a = await quote(d, [100], '2026-07-01T09:00:00Z');
      const b = await quote(d, [80], '2026-07-01T09:00:00Z');
      expect(await deal(d)).toEqual([80, b, 80]);
      await w.update('quotes', b, { deal_id: other });
      expect(await deal(d)).toEqual([100, a, 100]);
      expect(await deal(other)).toEqual([80, b, 80]);
    });

    it('lets the quote it took be deleted, and falls back', async () => {
      const { w, deal, quote, remove, h_lines } = await setUp();
      const d = (await w.create('deals', { typed: 5 }))['id'];
      const a = await quote(d, [100], '2026-07-01T09:00:00Z');
      const b = await quote(d, [80], '2026-07-02T09:00:00Z');
      expect(await deal(d)).toEqual([80, b, 80]);
      for (const line of await h_lines(b)) await remove('quote_lines', line);
      await remove('quotes', b);
      expect(await deal(d)).toEqual([100, a, 100]);
      for (const line of await h_lines(a)) await remove('quote_lines', line);
      await remove('quotes', a);
      expect(await deal(d)).toEqual([null, null, 5]);
    });

    it('keeps the value and the row Adminium\'s: what a writer sends for them is dropped', async () => {
      const { w, deal, quote } = await setUp();
      const d = (await w.create('deals', { typed: 5, quoted: 999, quote_id: 42 }))['id'];
      expect(await deal(d)).toEqual([null, null, 5]);
      const a = await quote(d, [100], '2026-07-01T09:00:00Z');
      await w.update('deals', d, { quoted: 1, quote_id: 7, typed: 6 });
      expect(await deal(d)).toEqual([100, a, 100]);
    });
  });
}

describe('the newest of some rows, as a quote of a change works it out', () => {
  const pick = (rows: Record<string, unknown>[]) => latestOf(rows, { by: 'at', key: 'id' })?.['id'];

  it('is judged on the server too, by kind: the value, what tells the newest, and the key it names', async () => {
    const h = await installInvoicing('sqlite', manifest());
    open = h;
    const model = applyOverrides(parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' }));
    const deals = model.tables.find((table) => table.name === h.real('deals'))!;
    const quotes = model.tables.find((table) => table.name === h.real('quotes'))!;
    const quoted = deals.columns.find((column) => column.name === 'quoted')!;
    const judge = (latest: Record<string, unknown>, into = quoted) => columnRuleIssue('column.rollup', { from: quotes.id, via: 'deal_id', latest }, into, model, new Set());
    expect(judge({ of: 'total', by: 'sent_at', row: 'quote_id' })).toBeNull();
    // A moment kept in a number column, a newest told by a number of money (allowed) and by nothing with an order (refused).
    expect(judge({ of: 'sent_at', by: 'sent_at' })).toMatch(/kept in a column of its own kind/);
    expect(judge({ of: 'total', by: 'subtotal' })).toBeNull();
    // The key it names is a whole number: a decimal column is of that kind, a moment is not.
    expect(judge({ of: 'total', by: 'sent_at', row: 'typed' })).toBeNull();
    expect(judge({ of: 'total', by: 'sent_at', row: 'nowhere' })).toMatch(/has no column "nowhere"/);
  });

  it('reads a moment however the engine hands it back, and leaves out a row with none', () => {
    expect(pick([{ id: 1, at: '2026-07-01 09:00:00' }, { id: 2, at: new Date('2026-07-02T09:00:00Z') }, { id: 3, at: null }])).toBe(2);
    expect(pick([{ id: 1, at: '2026-07-03T09:00:00.000Z' }, { id: 2, at: '2026-07-02 09:00:00+00' }])).toBe(1);
    expect(pick([{ id: 1, at: '2026-07-02' }, { id: 2, at: '2026-07-01' }])).toBe(1);
    // A day against a moment: the day is its midnight.
    expect(pick([{ id: 1, at: '2026-07-02' }, { id: 2, at: '2026-07-01 23:00:00' }, { id: 3, at: '2026-06-30' }])).toBe(1);
    expect(pick([{ id: 1, at: null }, { id: 2 }])).toBeUndefined();
    expect(pick([])).toBeUndefined();
  });

  it('reads a number as a number, and gives a tie to the greater key', () => {
    expect(pick([{ id: 1, at: 9 }, { id: 2, at: '10' }, { id: 3, at: 2n }])).toBe(2);
    expect(pick([{ id: 7, at: '2026-07-01 09:00:00' }, { id: 12, at: '2026-07-01T09:00:00Z' }, { id: 3, at: '2026-07-01 09:00:00' }])).toBe(12);
  });
});
