/**
 * `utils/text` — DOM-free SVG label measurement (the `chart-ranking-bars`
 * overflow fix). Pure module, so these are plain value assertions.
 */
import { describe, expect, it } from 'vitest';

import { estimateTextWidth, truncateToWidth } from './text.js';

describe('estimateTextWidth', () => {
  it('scales linearly with font size', () => {
    expect(estimateTextWidth('abcd', 20)).toBeCloseTo(estimateTextWidth('abcd', 10) * 2);
  });

  it('counts CJK glyphs as roughly twice a Latin one', () => {
    // Four ideographs are ~1em each; four Latin letters are ~0.52em each.
    expect(estimateTextWidth('日本語版', 10)).toBeCloseTo(40);
    expect(estimateTextWidth('abcd', 10)).toBeCloseTo(20.8);
  });

  it('is zero for the empty string', () => {
    expect(estimateTextWidth('', 10)).toBe(0);
  });
});

describe('truncateToWidth', () => {
  it('returns a label that already fits untouched', () => {
    expect(truncateToWidth('Billing', 96, 10)).toBe('Billing');
  });

  it('ellipsizes a label that would overflow its gutter', () => {
    // The field case: article titles in a 104px gutter (96px budget).
    const long = 'Ea dolor sint incididunt ipsum dolor';
    const out = truncateToWidth(long, 96, 10);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(long.length);
    expect(estimateTextWidth(out, 10)).toBeLessThanOrEqual(96);
  });

  it('keeps the result within budget for CJK too', () => {
    const out = truncateToWidth('日本語版のドキュメントを読む', 96, 10);
    expect(estimateTextWidth(out, 10)).toBeLessThanOrEqual(96);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never splits an astral character into lone surrogates', () => {
    const out = truncateToWidth('🎧🎧🎧🎧🎧🎧🎧🎧🎧🎧🎧🎧', 30, 10);
    // A lone surrogate would round-trip through the iterator as a replacement
    // pair; iterating by code point keeps every emoji whole.
    expect([...out].every((c) => c === '…' || c === '🎧')).toBe(true);
  });

  it('drops trailing whitespace before the ellipsis', () => {
    expect(truncateToWidth('Alpha beta gamma delta', 40, 10)).not.toContain(' …');
  });

  it('returns empty when not even the ellipsis fits', () => {
    expect(truncateToWidth('anything', 2, 10)).toBe('');
    expect(truncateToWidth('anything', 0, 10)).toBe('');
  });
});
