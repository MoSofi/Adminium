// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure word-cloud geometry (`chart-wordcloud`, research/widget-registry.md §2):
 * terms sized by frequency and flowed into wrapped rows within a fixed width.
 * Widths are estimated from character count (no DOM text metrics) so the layout
 * is byte-identical in a report worker and the browser (04 §7.1). Terms flow
 * start→end; RTL mirrors each row's x per §7.4.
 */

export interface WordInput {
  term: string;
  weight: number;
}

export interface WordToken {
  term: string;
  weight: number;
  /** Resolved font size in px. */
  fontSize: number;
  x: number;
  y: number;
  /** Baseline-independent block width used for wrapping. */
  width: number;
  colorVar: string;
}

export interface WordCloudLayout {
  tokens: WordToken[];
  width: number;
  height: number;
}

export interface WordCloudOptions {
  width: number;
  /** Max terms rendered; the rest are dropped (default all). */
  maxTerms?: number;
  minFontSize?: number;
  maxFontSize?: number;
  /** Horizontal gap between terms, px (default 14). */
  gapX?: number;
  /** Extra line height above the font size, px (default 10). */
  lineGap?: number;
  rtl?: boolean;
}

function vizColor(index: number): string {
  return `var(--viz-${(index % 8) + 1})`;
}

/** Deterministic width estimate: average glyph advance ≈ 0.58em + padding. */
function estimateWidth(term: string, fontSize: number): number {
  return term.length * fontSize * 0.58 + fontSize * 0.5;
}

/**
 * Flow tokens into rows. Font size scales linearly with weight across the
 * observed [min,max]; a single distinct weight maps to the max size. Returns
 * empty tokens for a non-positive width or no terms.
 */
export function wordCloudLayout(input: readonly WordInput[], options: WordCloudOptions): WordCloudLayout {
  const {
    width,
    maxTerms = Infinity,
    minFontSize = 13,
    maxFontSize = 40,
    gapX = 14,
    lineGap = 10,
    rtl = false,
  } = options;

  const terms = input
    .filter((w) => Number.isFinite(w.weight) && w.weight > 0)
    .slice(0, Number.isFinite(maxTerms) ? maxTerms : undefined);
  if (width <= 0 || terms.length === 0) return { tokens: [], width: Math.max(0, width), height: 0 };

  const weights = terms.map((t) => t.weight);
  const lo = Math.min(...weights);
  const hi = Math.max(...weights);
  const fontFor = (weight: number): number => {
    if (hi === lo) return maxFontSize;
    return Math.round(minFontSize + ((weight - lo) / (hi - lo)) * (maxFontSize - minFontSize));
  };

  // First pass: assign sizes + widths, flow into rows (start-aligned).
  const rows: WordToken[][] = [];
  let row: WordToken[] = [];
  let cursorX = 0;
  let rowMaxFont = 0;
  let y = 0;

  const commitRow = (): void => {
    if (row.length === 0) return;
    const lineHeight = rowMaxFont + lineGap;
    for (const token of row) token.y = y + lineHeight / 2;
    rows.push(row);
    y += lineHeight;
    row = [];
    cursorX = 0;
    rowMaxFont = 0;
  };

  terms.forEach((term, index) => {
    const fontSize = fontFor(term.weight);
    const w = estimateWidth(term.term, fontSize);
    if (row.length > 0 && cursorX + gapX + w > width) commitRow();
    const token: WordToken = {
      term: term.term,
      weight: term.weight,
      fontSize,
      x: cursorX,
      y: 0,
      width: w,
      colorVar: vizColor(index),
    };
    row.push(token);
    cursorX += w + gapX;
    rowMaxFont = Math.max(rowMaxFont, fontSize);
  });
  commitRow();

  const tokens = rows.flat();
  if (rtl) {
    for (const token of tokens) token.x = width - token.x - token.width;
  }

  return { tokens, width, height: y };
}
