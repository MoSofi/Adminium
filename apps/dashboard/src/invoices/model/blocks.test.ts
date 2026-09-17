// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block vocabulary: the gate filters and keeps pre-filter indexes, the
 * Add-section modal lists exactly the off blocks, and the vocabulary the CI
 * gate compares is 27 kinds long.
 */
import { describe, expect, it } from 'vitest';

import { BLOCK_GATE, BLOCK_VOCABULARY, BUILTIN_BLOCK_KEYS, OPTIONAL_SECTIONS, customIdOf, customKeyOf, isCustomKey, offSections, visibleBlocks } from './blocks.js';
import { DEFAULT_BLOCK_ORDER, emptyBody, type InvoiceBody } from './envelope.js';

describe('visibleBlocks', () => {
  it('keeps the pre-filter index and drops off blocks', () => {
    const body: InvoiceBody = { ...emptyBody(), sigShow: true, termsShow: true };
    const visible = visibleBlocks(body);
    expect(visible.map((block) => block.key)).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes', 'signature', 'terms']);
    // `shipping` sits at 1 and is off; `signature` keeps its unfiltered slot, 6.
    expect(visible.map((block) => block.index)).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(visible.every((block) => block.custom === null)).toBe(true);
  });

  it('shows every built-in when every flag is on', () => {
    const body = { ...emptyBody() };
    for (const section of OPTIONAL_SECTIONS) body[section.flag] = true;
    expect(visibleBlocks(body).map((block) => block.key)).toEqual([...DEFAULT_BLOCK_ORDER]);
  });

  it('carries a custom section with its key and drops an orphan cus: key', () => {
    const section = { id: 'note', type: 'text' as const, title: 'Scope', body: '' };
    const body: InvoiceBody = { ...emptyBody(), custom: [section], blockOrder: ['parties', 'cus:note', 'cus:ghost', 'meta', 'items', 'totals', 'paynotes'] };
    const visible = visibleBlocks(body);
    expect(visible.map((block) => block.key)).toEqual(['parties', 'cus:note', 'meta', 'items', 'totals', 'paynotes']);
    expect(visible[1]).toEqual({ key: 'cus:note', index: 1, custom: section });
    // The orphan at 2 is dropped, and `meta` keeps 3.
    expect(visible[2]?.index).toBe(3);
  });
});

describe('offSections', () => {
  it('lists exactly the off ones, in the modal order', () => {
    const body: InvoiceBody = { ...emptyBody(), sigShow: true, qrShow: true };
    const off = offSections(body);
    expect(off).toHaveLength(OPTIONAL_SECTIONS.length - 2);
    expect(off.map((section) => section.flag)).not.toContain('sigShow');
    expect(off.map((section) => section.flag)).not.toContain('qrShow');
    expect(off.map((section) => section.flag)).toEqual(OPTIONAL_SECTIONS.map((section) => section.flag).filter((flag) => flag !== 'sigShow' && flag !== 'qrShow'));
  });

  it('is empty once every standard block is on', () => {
    const body = { ...emptyBody() };
    for (const section of OPTIONAL_SECTIONS) body[section.flag] = true;
    expect(offSections(body)).toEqual([]);
  });
});

describe('the vocabulary', () => {
  it('BLOCK_VOCABULARY has 27 entries — 23 built-ins and the four custom kinds — sorted', () => {
    expect(BLOCK_VOCABULARY).toHaveLength(27);
    expect([...BLOCK_VOCABULARY].sort()).toEqual([...BLOCK_VOCABULARY]);
    expect(new Set(BLOCK_VOCABULARY).size).toBe(27);
    for (const key of BUILTIN_BLOCK_KEYS) expect(BLOCK_VOCABULARY).toContain(key);
    for (const kind of ['custom.text', 'custom.image', 'custom.kv', 'custom.gallery']) expect(BLOCK_VOCABULARY).toContain(kind);
  });

  it('gates 18 of the 23 built-ins and none of the five permanent blocks', () => {
    const gated = BUILTIN_BLOCK_KEYS.filter((key) => BLOCK_GATE[key] !== null);
    expect(gated).toHaveLength(18);
    expect(BUILTIN_BLOCK_KEYS.filter((key) => BLOCK_GATE[key] === null)).toEqual(['parties', 'meta', 'items', 'totals', 'paynotes']);
    expect(OPTIONAL_SECTIONS.map((section) => section.block).sort()).toEqual([...gated].sort());
  });

  it('cus: keys round-trip through customKeyOf/customIdOf', () => {
    expect(customKeyOf('abc')).toBe('cus:abc');
    expect(customIdOf('cus:abc')).toBe('abc');
    expect(customIdOf('parties')).toBeNull();
    expect(isCustomKey('cus:x')).toBe(true);
    expect(isCustomKey('items')).toBe(false);
  });
});
