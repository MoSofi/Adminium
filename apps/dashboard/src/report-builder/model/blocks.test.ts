// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block vocabulary and the pure edits.
 *
 * The assertions that carry the wave:
 *
 *  · `BLOCK_KIND_META` is pinned entry by entry — the comp's `kindMeta` (473)
 *    returns `[icon, label]` for four of its 25 kinds, and this record is the
 *    fix (D13). A label that becomes a slug goes red here.
 *  · every kind round-trips encode → decode with its own fields.
 *  · `swapBlock` and `reorderBlock` are two DIFFERENT algorithms, both the
 *    comp's (537 vs 539), including `dest = from < to ? to − 1 : to` and the
 *    no-op drop on itself.
 */
import { describe, expect, it } from 'vitest';

import { BLOCK_KIND_META, DEFAULT_BLOCK_SEED, newBlock, paletteEntries, REPORT_BLOCK_KINDS } from './blocks.js';
import { emptyBody, isReportBlockKind, normalizeReportBody, unknownBlockText, type ReportBlock, type ReportBody } from './envelope.js';
import {
  addArrayItem,
  addBlock,
  addRow,
  deleteBlock,
  patchBlock,
  removeArrayItem,
  removeRow,
  reorderBlock,
  setHeaderField,
  swapBlock,
  updateArrayItem,
  updateRow,
} from './ops.js';

function bodyOf(...kinds: ReportBlock['kind'][]): ReportBody {
  return { ...emptyBody(), blocks: kinds.map((kind, i) => newBlock(kind, DEFAULT_BLOCK_SEED, `b${String(i)}`)) };
}

describe('BLOCK_KIND_META (D13 — the comp’s swapped pairs, fixed by construction)', () => {
  it('has one named entry per kind, in palette order', () => {
    expect(REPORT_BLOCK_KINDS).toHaveLength(25);
    expect(Object.keys(BLOCK_KIND_META)).toEqual([...REPORT_BLOCK_KINDS]);
    expect(paletteEntries().map((e) => e.kind)).toEqual([...REPORT_BLOCK_KINDS]);
  });

  it('every label is Title-cased copy and every icon is a kebab slug — pinned entry by entry', () => {
    expect(BLOCK_KIND_META).toEqual({
      heading: { label: 'Heading', icon: 'heading' },
      text: { label: 'Text', icon: 'align-left' },
      kpi: { label: 'KPI row', icon: 'layout-grid' },
      bar: { label: 'Bar chart', icon: 'bar-chart-3' },
      line: { label: 'Line chart', icon: 'trending-up' },
      table: { label: 'Table', icon: 'table-2' },
      signature: { label: 'Signature', icon: 'pen-line' },
      terms: { label: 'Terms', icon: 'square-check-big' },
      attachments: { label: 'Attachments', icon: 'paperclip' },
      approval: { label: 'Approval', icon: 'badge-check' },
      qr: { label: 'Payment QR', icon: 'qr-code' },
      latefees: { label: 'Late fees', icon: 'alarm-clock' },
      poterms: { label: 'PO terms', icon: 'scroll-text' },
      multicurrency: { label: 'Multi-currency', icon: 'coins' },
      recurring: { label: 'Recurring', icon: 'repeat' },
      discount: { label: 'Discount codes', icon: 'ticket-percent' },
      taxbreak: { label: 'Tax breakdown', icon: 'percent' },
      payhistory: { label: 'Payment history', icon: 'history' },
      legal: { label: 'Legal footer', icon: 'scale' },
      // The four the comp returns backwards (473) — a label here, a slug there.
      refund: { label: 'Refund policy', icon: 'rotate-ccw' },
      contact: { label: 'Contact', icon: 'life-buoy' },
      loyalty: { label: 'Loyalty points', icon: 'award' },
      delivery: { label: 'Delivery timeline', icon: 'truck' },
      image: { label: 'Image', icon: 'image' },
      divider: { label: 'Divider', icon: 'minus' },
    });
    for (const [kind, meta] of Object.entries(BLOCK_KIND_META)) {
      // A slug is lowercase-kebab; a label starts upper-case. Neither can pass for the other.
      expect(meta.icon, kind).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(meta.label[0], kind).toBe(meta.label[0]?.toUpperCase());
      expect(meta.label, kind).not.toBe(meta.icon);
    }
  });
});

describe('newBlock (536)', () => {
  it('seeds every kind with the comp’s content, full width and shown', () => {
    for (const kind of REPORT_BLOCK_KINDS) {
      const block = newBlock(kind, DEFAULT_BLOCK_SEED, 'x');
      expect(block, kind).toMatchObject({ id: 'x', kind, w: 'full', show: true, title: BLOCK_KIND_META[kind].label });
      // Nothing seeded is `undefined` — the canvas narrows on `kind` and reads fields directly.
      expect(Object.values(block).every((v) => v !== undefined), kind).toBe(true);
    }
    expect(newBlock('kpi', DEFAULT_BLOCK_SEED, 'k')).toMatchObject({
      kpis: [
        { label: 'Metric', value: '0', delta: '' },
        { label: 'Metric', value: '0', delta: '' },
      ],
    });
    expect(newBlock('bar', DEFAULT_BLOCK_SEED, 'b')).toMatchObject({ series: [{ label: 'A', value: 40 }, { label: 'B', value: 65 }, { label: 'C', value: 52 }] });
    expect(newBlock('table', DEFAULT_BLOCK_SEED, 't')).toMatchObject({ rows: [['Column', 'Value'], ['Row 1', '—'], ['Row 2', '—']] });
    expect(newBlock('latefees', DEFAULT_BLOCK_SEED, 'l')).toMatchObject({ lateRate: '1.5', lateDays: 7 });
    expect(newBlock('divider', DEFAULT_BLOCK_SEED, 'd')).toEqual({ id: 'd', kind: 'divider', title: 'Divider', w: 'full', show: true });
    // The image block carries a caption AND the O4 url slot, empty.
    expect(newBlock('image', DEFAULT_BLOCK_SEED, 'i')).toMatchObject({ text: 'image placeholder', url: '' });
    // Appendix D at the source: the loyalty LEVEL, and a contact who is not the company.
    expect(newBlock('loyalty', DEFAULT_BLOCK_SEED, 'y')).toMatchObject({ loyLevel: 'Gold' });
    expect(newBlock('contact', DEFAULT_BLOCK_SEED, 'c')).toMatchObject({ conName: 'Orchard Lane Studio' });
    expect(JSON.stringify(DEFAULT_BLOCK_SEED)).not.toMatch(/adminium/i);
    expect(JSON.stringify(DEFAULT_BLOCK_SEED)).not.toMatch(/pricing|plan|tier|billing|upgrade|\/mo|free/i);
  });

  it('mints a fresh id when none is given', () => {
    expect(newBlock('text', DEFAULT_BLOCK_SEED).id).not.toBe(newBlock('text', DEFAULT_BLOCK_SEED).id);
  });
});

describe('the envelope decodes leniently', () => {
  it('every kind round-trips, and a stranger becomes a labelled placeholder', () => {
    const body = bodyOf(...REPORT_BLOCK_KINDS);
    expect(normalizeReportBody(body)).toEqual(body);
    expect(isReportBlockKind('totals')).toBe(false);
    const odd = normalizeReportBody({ blocks: [{ id: 'z', kind: 'gantt', title: 'Timeline', w: 'half', show: false }] });
    expect(odd.blocks[0]).toEqual({ id: 'z', kind: 'text', title: 'Timeline', w: 'half', show: false, text: unknownBlockText('gantt') });
  });
});

describe('the stack (D17 — two reorder algorithms)', () => {
  const ids = (body: ReportBody) => body.blocks.map((b) => b.id);

  it('addBlock appends and selects; deleteBlock falls back to the header (535, 538)', () => {
    const body = bodyOf('text', 'kpi');
    const block = newBlock('bar', DEFAULT_BLOCK_SEED, 'new');
    const added = addBlock(body, block);
    expect(ids(added.body)).toEqual(['b0', 'b1', 'new']);
    expect(added.selection).toBe('new');
    // Deleting the selected block returns the inspector to the header.
    expect(deleteBlock(added.body, 'new', 'new')).toEqual({ body, selection: 'header' });
    // Deleting another block leaves the selection alone.
    expect(deleteBlock(added.body, 'b0', 'new').selection).toBe('new');
  });

  it('swapBlock EXCHANGES with the neighbour and is a no-op at the ends (537)', () => {
    const body = bodyOf('text', 'kpi', 'bar', 'line');
    expect(ids(swapBlock(body, 'b2', -1))).toEqual(['b0', 'b2', 'b1', 'b3']);
    expect(ids(swapBlock(body, 'b1', 1))).toEqual(['b0', 'b2', 'b1', 'b3']);
    expect(swapBlock(body, 'b0', -1)).toBe(body);
    expect(swapBlock(body, 'b3', 1)).toBe(body);
    expect(swapBlock(body, 'nope', 1)).toBe(body);
  });

  it('reorderBlock splices with dest = from < to ? to − 1 : to, and a drop on itself is a no-op (539)', () => {
    const body = bodyOf('text', 'kpi', 'bar', 'line');
    // Dragging 0 onto 2: dest = 1 — it lands BEFORE the block it was dropped on.
    expect(ids(reorderBlock(body, 0, 2))).toEqual(['b1', 'b0', 'b2', 'b3']);
    // Dragging 3 onto 1: dest = 1 — dragging up lands ON the target's index.
    expect(ids(reorderBlock(body, 3, 1))).toEqual(['b0', 'b3', 'b1', 'b2']);
    // Two places forward is NOT the same as two swaps — the algorithms differ.
    expect(ids(reorderBlock(body, 0, 3))).toEqual(['b1', 'b2', 'b0', 'b3']);
    expect(ids(swapBlock(swapBlock(body, 'b0', 1), 'b0', 1))).toEqual(['b1', 'b2', 'b0', 'b3']);
    // …but for one place forward the drag is a no-op where the swap is not.
    expect(reorderBlock(body, 0, 1)).toEqual(body);
    expect(ids(swapBlock(body, 'b0', 1))).toEqual(['b1', 'b0', 'b2', 'b3']);
    // A drop on itself, and anything out of range.
    expect(reorderBlock(body, 2, 2)).toBe(body);
    expect(reorderBlock(body, -1, 2)).toBe(body);
    expect(reorderBlock(body, 0, 9)).toBe(body);
    // A drop past the end lands last.
    expect(ids(reorderBlock(body, 0, 4))).toEqual(['b1', 'b2', 'b3', 'b0']);
  });

  it('show: false never removes or re-orders — the stack is the whole array (trap 2)', () => {
    const body = bodyOf('text', 'kpi', 'bar');
    const dimmed = patchBlock(body, 'b1', { show: false });
    expect(ids(dimmed)).toEqual(['b0', 'b1', 'b2']);
    // The index a drag speaks is still the block's index in `blocks[]`.
    expect(ids(reorderBlock(dimmed, 2, 0))).toEqual(['b2', 'b0', 'b1']);
    expect(dimmed.blocks[1]?.show).toBe(false);
  });
});

describe('the repeaters and the table (540-545)', () => {
  it('updates, adds and removes a row of any repeater', () => {
    let body = bodyOf('kpi');
    body = updateArrayItem(body, 'b0', 'kpis', 1, { value: '482', delta: '+12%' });
    const kpi = body.blocks[0];
    expect(kpi?.kind === 'kpi' && kpi.kpis[1]).toEqual({ label: 'Metric', value: '482', delta: '+12%' });
    body = addArrayItem(body, 'b0', 'kpis', { label: 'New', value: '0', delta: '' });
    expect((body.blocks[0] as { kpis: unknown[] }).kpis).toHaveLength(3);
    body = removeArrayItem(body, 'b0', 'kpis', 0);
    expect((body.blocks[0] as { kpis: { value: string }[] }).kpis.map((k) => k.value)).toEqual(['482', '0']);
    // A block that does not exist, and a repeater the kind does not carry.
    expect(updateArrayItem(body, 'nope', 'kpis', 0, {})).toBe(body);
    expect((addArrayItem(body, 'b0', 'series', { label: 'x', value: 1 }).blocks[0] as { series?: unknown[] }).series).toHaveLength(1);
  });

  it('the table edits one cell at a time and the header row is a row like any other', () => {
    let body = bodyOf('table');
    body = updateRow(body, 'b0', 0, 1, 'Revenue');
    body = updateRow(body, 'b0', 1, 0, 'Northwind');
    expect((body.blocks[0] as { rows: [string, string][] }).rows).toEqual([['Column', 'Revenue'], ['Northwind', '—'], ['Row 2', '—']]);
    body = addRow(body, 'b0', ['New', '—']);
    expect((body.blocks[0] as { rows: unknown[] }).rows).toHaveLength(4);
    body = removeRow(body, 'b0', 0);
    expect((body.blocks[0] as { rows: [string, string][] }).rows[0]).toEqual(['Northwind', '—']);
    // A non-table block is left alone.
    const text = bodyOf('text');
    expect(updateRow(text, 'b0', 0, 0, 'x')).toBe(text);
    expect(addRow(text, 'b0', ['a', 'b'])).toBe(text);
    expect(removeRow(text, 'b0', 0)).toBe(text);
  });

  it('setHeaderField writes the document header', () => {
    const body = setHeaderField(setHeaderField(emptyBody(), 'kicker', 'Quarterly'), 'bgTint', 0.4);
    expect(body).toMatchObject({ kicker: 'Quarterly', bgTint: 0.4 });
  });
});
