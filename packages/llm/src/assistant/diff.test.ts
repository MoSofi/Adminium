// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { ASSISTANT_DIFF_MAX_LINES, assistantLineDiff } from './diff.js';

/** Render a diff the way the result card's diff tab lists it: one signed line each. */
function signed(diff: ReturnType<typeof assistantLineDiff>): string[] {
  return diff.lines.map((line) => `${line.sign} ${line.text}`);
}

/*
 * The four fixtures below are the four diffs the design draws, one per page —
 * the same sequence of kept, removed and added lines — so the differ is proven
 * against the shapes the result card was designed around.
 */
describe('assistantLineDiff — the four diffs the result card was designed around', () => {
  it('email: a reworded subject, a new preheader, a new block', () => {
    const base = ['subject: {{ }}', 'Action required: your invoice is unpaid', 'blocks:'];
    const draft = [
      'subject: {{ }}',
      'Your invoice is still open',
      'preheader: Pay online in two minutes',
      'blocks:',
      '  box: invoice.number, invoice.total, invoice.due_date',
    ];
    const diff = assistantLineDiff(base, draft);
    expect(signed(diff)).toEqual([
      '  subject: {{ }}',
      '- Action required: your invoice is unpaid',
      '+ Your invoice is still open',
      '+ preheader: Pay online in two minutes',
      '  blocks:',
      '+   box: invoice.number, invoice.total, invoice.due_date',
    ]);
    expect([diff.adds, diff.dels, diff.truncated]).toEqual([3, 1, false]);
  });

  it('invoice template: a new party field, a swapped tax row, a new note', () => {
    const base = ['header: brand.logo, invoice.number, invoice.dates', 'tax_row: vat_21_percent'];
    const draft = [
      'header: brand.logo, invoice.number, invoice.dates',
      'bill_to: + account.vat_number (required)',
      'tax_row: vat_0_percent (reverse charge)',
      'note: "VAT reverse charged — art. 196 EU VAT Directive"',
    ];
    const diff = assistantLineDiff(base, draft);
    // A removal sorts above the additions of the same changed run, as every
    // diff tool prints it; the design's hand-written order interleaves them.
    expect(signed(diff)).toEqual([
      '  header: brand.logo, invoice.number, invoice.dates',
      '- tax_row: vat_21_percent',
      '+ bill_to: + account.vat_number (required)',
      '+ tax_row: vat_0_percent (reverse charge)',
      '+ note: "VAT reverse charged — art. 196 EU VAT Directive"',
    ]);
    expect([diff.adds, diff.dels]).toEqual([3, 1]);
  });

  it('invoice: a new record has no base, so every field it will write is an addition', () => {
    const draft = [
      'template: standard',
      'number: (minted when saved)',
      'period: 2026-09-01 → 2026-09-30',
      'lines: 4 (from time_entries, 38 rows)',
      'total: computed when saved',
      'due_date: 2026-10-14',
      'status: draft',
    ];
    const diff = assistantLineDiff(null, draft);
    expect(diff.lines.every((line) => line.sign === '+')).toBe(true);
    expect([diff.adds, diff.dels]).toEqual([7, 0]);
  });

  it('report: a new report is all additions too', () => {
    const draft = [
      'kicker: Support',
      'title: Where the support hours go',
      'block: kpi "Headline numbers" (full)',
      'block: bar "Top 6 customers by hours" (half)',
      'block: table "Customer, hours, per seat" (full)',
    ];
    expect(assistantLineDiff(null, draft)).toMatchObject({ adds: 5, dels: 0, truncated: false });
  });
});

describe('assistantLineDiff — edges', () => {
  it('identical sides are all context', () => {
    const lines = ['a', 'b', 'c'];
    expect(assistantLineDiff(lines, lines)).toEqual({
      adds: 0,
      dels: 0,
      truncated: false,
      lines: lines.map((text) => ({ sign: ' ', text })),
    });
  });

  it('an emptied document is all removals; an empty base is all additions', () => {
    expect(signed(assistantLineDiff(['a', 'b'], []))).toEqual(['- a', '- b']);
    expect(signed(assistantLineDiff([], ['a', 'b']))).toEqual(['+ a', '+ b']);
    expect(assistantLineDiff([], [])).toEqual({ adds: 0, dels: 0, lines: [], truncated: false });
  });

  it('a moved line is one removal and one addition, and the rest stays context', () => {
    const diff = assistantLineDiff(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a']);
    expect(signed(diff)).toEqual(['- a', '  b', '  c', '  d', '+ a']);
  });

  it('trailing removals and trailing additions are both emitted', () => {
    expect(signed(assistantLineDiff(['keep', 'gone'], ['keep']))).toEqual(['  keep', '- gone']);
    expect(signed(assistantLineDiff(['keep'], ['keep', 'new']))).toEqual(['  keep', '+ new']);
  });

  it('repeated lines still produce a minimal diff', () => {
    const diff = assistantLineDiff(['x', 'x', 'y'], ['x', 'y', 'y']);
    expect(diff.adds).toBe(1);
    expect(diff.dels).toBe(1);
    expect(diff.lines.filter((line) => line.sign === ' ')).toHaveLength(2);
  });

  it('cuts an over-long side and says so', () => {
    const long = Array.from({ length: ASSISTANT_DIFF_MAX_LINES + 10 }, (_, i) => `line ${i}`);
    const asDraft = assistantLineDiff(null, long);
    expect(asDraft.lines).toHaveLength(ASSISTANT_DIFF_MAX_LINES);
    expect(asDraft.truncated).toBe(true);

    const asBase = assistantLineDiff(long, ['line 0']);
    expect(asBase.truncated).toBe(true);
    expect(asBase.dels).toBe(ASSISTANT_DIFF_MAX_LINES - 1);

    const bothLong = assistantLineDiff(['line 0'], long);
    expect(bothLong.truncated).toBe(true);
    expect(bothLong.adds).toBe(ASSISTANT_DIFF_MAX_LINES - 1);
  });
});
