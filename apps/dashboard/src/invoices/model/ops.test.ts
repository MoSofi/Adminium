// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The structural edits: the three comp behaviours by line — `reorderBlk`
 * 1359, `addBuiltin` 1300-1305, `hideSec` 1361 vs `delCustom` 1320 — plus
 * the item, line and row helpers.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_BLOCK_ORDER, emptyBody, type CustomSection, type InvoiceBody } from './envelope.js';
import {
  addBuiltin,
  addCustom,
  addCustomRow,
  addItem,
  addLine,
  addRow,
  enableSection,
  hideSection,
  newCustomSection,
  removeCustom,
  removeCustomRow,
  removeItem,
  removeLine,
  removeRow,
  reorderBlocks,
  reorderItems,
  setImage,
  updateCustom,
  updateCustomImage,
  updateCustomRow,
  updateItem,
  updateLine,
  updateRow,
  type CustomSeed,
} from './ops.js';

const SEED: CustomSeed = {
  text: { title: 'Additional notes', body: 'Add your own copy here.' },
  image: { title: 'Image', caption: 'Add a caption' },
  kv: { title: 'Reference details', rows: [{ k: 'Cost centre', v: 'CC-4410' }] },
  gallery: { title: 'Images' },
};

function body(over: Partial<InvoiceBody> = {}): InvoiceBody {
  return { ...emptyBody(), ...over };
}

describe('reorderBlocks — comp 1359', () => {
  it('moves forward with dest = to − 1', () => {
    const next = reorderBlocks(body({ blockOrder: ['a', 'b', 'c', 'd', 'e'] }), 0, 3);
    expect(next.blockOrder).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('moves backward with dest = to', () => {
    const next = reorderBlocks(body({ blockOrder: ['a', 'b', 'c', 'd', 'e'] }), 3, 0);
    expect(next.blockOrder).toEqual(['d', 'a', 'b', 'c', 'e']);
  });

  it('is the identity for from === to and for an out-of-range source', () => {
    const start = body({ blockOrder: ['a', 'b', 'c'] });
    expect(reorderBlocks(start, 1, 1).blockOrder).toEqual(['a', 'b', 'c']);
    expect(reorderBlocks(start, 7, 0).blockOrder).toEqual(['a', 'b', 'c']);
    expect(reorderBlocks(start, 1, 1)).not.toBe(start);
  });

  it('a hidden block keeps its slot: indexes are pre-filter', () => {
    // `shipping` (1) is off; moving `items` (3) before `parties` (0) walks past it and leaves it in place.
    const start = body({ shipShow: false });
    const next = reorderBlocks(start, 3, 0);
    expect(next.blockOrder.slice(0, 5)).toEqual(['items', 'parties', 'shipping', 'meta', 'totals']);
    expect(next.shipShow).toBe(false);
    expect(next.blockOrder).toHaveLength(DEFAULT_BLOCK_ORDER.length);
  });
});

describe('addBuiltin — comp 1300-1305', () => {
  it('with at != null re-splices the key to the index, correcting when the key sat before it', () => {
    // `signature` sits at 6; asked for pre-filter index 10 (before `qr`), the correction is at − 1 = 9 after the removal.
    const next = addBuiltin(body(), 'signature', 'sigShow', 10);
    expect(next.sigShow).toBe(true);
    expect(next.blockOrder.indexOf('signature')).toBe(9);
    expect(next.blockOrder[10]).toBe('qr');
    expect(next.blockOrder).toHaveLength(DEFAULT_BLOCK_ORDER.length);
  });

  it('with at <= cur the index is used as-is', () => {
    const next = addBuiltin(body(), 'signature', 'sigShow', 2);
    expect(next.blockOrder.slice(0, 4)).toEqual(['parties', 'shipping', 'signature', 'meta']);
    expect(next.blockOrder).toHaveLength(DEFAULT_BLOCK_ORDER.length);
  });

  it('with at = null leaves the order alone and only flips the flag', () => {
    const start = body();
    const next = addBuiltin(start, 'qr', 'qrShow', null);
    expect(next.qrShow).toBe(true);
    expect(next.blockOrder).toEqual(start.blockOrder);
  });

  it('with at = null appends a key the order had lost', () => {
    const start = body({ blockOrder: DEFAULT_BLOCK_ORDER.filter((key) => key !== 'qr') });
    const next = addBuiltin(start, 'qr', 'qrShow', null);
    expect(next.blockOrder.at(-1)).toBe('qr');
  });
});

describe('hideSection vs removeCustom — comp 1361 vs 1320', () => {
  it('hideSection flips the flag and keeps the key', () => {
    const start = body({ shipShow: true });
    const next = hideSection(start, 'shipShow');
    expect(next.shipShow).toBe(false);
    expect(next.blockOrder).toContain('shipping');
    expect(enableSection(next, 'shipShow').shipShow).toBe(true);
  });

  it('removeCustom drops the section AND its key', () => {
    const section: CustomSection = { id: 'note', type: 'text', title: 'Scope', body: '' };
    const start = addCustom(body(), section, 2);
    expect(start.blockOrder[2]).toBe('cus:note');
    expect(start.custom).toEqual([section]);
    const next = removeCustom(start, 'note');
    expect(next.custom).toEqual([]);
    expect(next.blockOrder).not.toContain('cus:note');
    expect(next.blockOrder).toEqual([...DEFAULT_BLOCK_ORDER]);
  });

  it('addCustom with at = null appends the key', () => {
    const section: CustomSection = { id: 'note', type: 'text', title: 'Scope', body: '' };
    expect(addCustom(body(), section, null).blockOrder.at(-1)).toBe('cus:note');
    expect(addCustom(body(), section, 99).blockOrder.at(-1)).toBe('cus:note');
  });
});

describe('custom sections', () => {
  it('newCustomSection builds the four shapes from the seed', () => {
    expect(newCustomSection('text', SEED, 'a')).toEqual({ id: 'a', type: 'text', title: 'Additional notes', body: 'Add your own copy here.' });
    expect(newCustomSection('image', SEED, 'b')).toEqual({ id: 'b', type: 'image', title: 'Image', url: '', caption: 'Add a caption', height: 200 });
    expect(newCustomSection('kv', SEED, 'c')).toEqual({ id: 'c', type: 'kv', title: 'Reference details', rows: [{ k: 'Cost centre', v: 'CC-4410' }] });
    expect(newCustomSection('gallery', SEED, 'd')).toEqual({ id: 'd', type: 'gallery', title: 'Images', images: [{ id: 'da', url: '' }, { id: 'db', url: '' }, { id: 'dc', url: '' }] });
    expect(newCustomSection('text', SEED).id).toMatch(/^cs_[0-9a-f]{10}$/);
  });

  it('updates a section, a kv row and a gallery slot in place', () => {
    const kv = newCustomSection('kv', SEED, 'k');
    const gallery = newCustomSection('gallery', SEED, 'g');
    let next = addCustom(addCustom(body(), kv, null), gallery, null);
    next = updateCustom(next, 'k', { title: 'Order details' });
    next = updateCustomRow(next, 'k', 0, 'v', 'CC-9');
    next = addCustomRow(next, 'k', { k: 'Label', v: 'Value' });
    next = updateCustomImage(next, 'g', 'gb', 'data:image/png;base64,AA');
    expect(next.custom[0]).toEqual({ id: 'k', type: 'kv', title: 'Order details', rows: [{ k: 'Cost centre', v: 'CC-9' }, { k: 'Label', v: 'Value' }] });
    expect((next.custom[1] as { images: { id: string; url: string }[] }).images[1]).toEqual({ id: 'gb', url: 'data:image/png;base64,AA' });
    next = removeCustomRow(next, 'k', 0);
    expect((next.custom[0] as { rows: unknown[] }).rows).toEqual([{ k: 'Label', v: 'Value' }]);
  });
});

describe('line items — comp 1355-1358', () => {
  it('adds, updates, reorders and removes', () => {
    let next = addItem(body(), 'New item', 'i1');
    next = addItem(next, 'New item', 'i2');
    next = addItem(next, 'New item', 'i3');
    expect(next.items.map((item) => item.id)).toEqual(['i1', 'i2', 'i3']);
    expect(next.items[0]).toEqual({ id: 'i1', desc: 'New item', qty: '1', rate: '0' });
    next = updateItem(next, 'i2', { desc: 'Consulting — 12 hours', rate: '145' });
    expect(next.items[1]).toEqual({ id: 'i2', desc: 'Consulting — 12 hours', qty: '1', rate: '145' });
    // The same algorithm as the blocks: forward is to − 1.
    next = reorderItems(next, 0, 3);
    expect(next.items.map((item) => item.id)).toEqual(['i2', 'i3', 'i1']);
    next = reorderItems(next, 2, 0);
    expect(next.items.map((item) => item.id)).toEqual(['i1', 'i2', 'i3']);
    next = removeItem(next, 'i2');
    expect(next.items.map((item) => item.id)).toEqual(['i1', 'i3']);
  });
});

describe('string lists and row lists — comp 1363-1366', () => {
  it('line helpers edit the four string lists', () => {
    let next = addLine(body(), 'from');
    next = updateLine(next, 'from', 0, 'Northwind Studio');
    next = addLine(next, 'from');
    expect(next.from).toEqual(['Northwind Studio', '']);
    next = removeLine(next, 'from', 1);
    expect(next.from).toEqual(['Northwind Studio']);
    expect(updateLine(body({ payment: ['a', 'b'] }), 'payment', 1, 'c').payment).toEqual(['a', 'c']);
  });

  it('row helpers edit the six object lists', () => {
    let next = addRow(body(), 'taxLines', { label: 'State tax', rate: '6' });
    next = addRow(next, 'taxLines', { label: 'City tax', rate: '2' });
    next = updateRow(next, 'taxLines', 1, { rate: '2.5' });
    expect(next.taxLines).toEqual([{ label: 'State tax', rate: '6' }, { label: 'City tax', rate: '2.5' }]);
    next = removeRow(next, 'taxLines', 0);
    expect(next.taxLines).toEqual([{ label: 'City tax', rate: '2.5' }]);
    next = addRow(next, 'delSteps', { label: 'Ordered', status: 'done' });
    expect(next.delSteps).toEqual([{ label: 'Ordered', status: 'done' }]);
  });

  it('setImage writes one slot', () => {
    const next = setImage(body(), 'stampImage', 'data:image/png;base64,ZZ');
    expect(next.stampImage).toBe('data:image/png;base64,ZZ');
    expect(next.logoImage).toBe('');
  });
});
