/**
 * DOM-free text measurement for SVG labels.
 *
 * SVG `<text>` neither wraps nor ellipsizes, so a label longer than its gutter
 * simply keeps drawing — in `chart-ranking-bars` that meant article titles ran
 * straight under the bars. Truncation has to happen before render, and it has to
 * work without a DOM: these charts are also rasterized by the scheduled-report
 * workers, so `measureText` is not available (same constraint the `geometry/`
 * modules are written to).
 */

/**
 * Ranges whose glyphs are full-width (roughly one em) rather than the ~half-em
 * of Latin text: CJK ideographs and kana, Hangul, and the fullwidth/halfwidth
 * forms block. Everything else is estimated at {@link NARROW_RATIO}.
 */
function isWideGlyph(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals, punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // kana, CJK compatibility
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK ext. A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // fullwidth forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

/**
 * Mean advance of a narrow glyph as a fraction of font size. 0.52 is a little
 * generous for the semibold UI sans the axis labels use, which is the safe
 * direction to err: over-estimating truncates a character early, whereas
 * under-estimating puts the label back under the bars.
 */
const NARROW_RATIO = 0.52;

const ELLIPSIS = '…';

/** Estimated rendered width of `text` at `fontSize`, in px. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    width += fontSize * (isWideGlyph(cp) ? 1 : NARROW_RATIO);
  }
  return width;
}

/**
 * Shorten `text` so its estimated width fits `maxWidth`, appending an ellipsis
 * when anything was dropped. Returns the input untouched when it already fits;
 * returns an empty string when not even the ellipsis fits.
 *
 * Iterates by code point (via the string iterator), so astral characters and
 * emoji are never split into lone surrogates.
 */
export function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0) return '';
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;

  const budget = maxWidth - estimateTextWidth(ELLIPSIS, fontSize);
  if (budget <= 0) return '';

  let width = 0;
  let out = '';
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const advance = fontSize * (isWideGlyph(cp) ? 1 : NARROW_RATIO);
    if (width + advance > budget) break;
    width += advance;
    out += char;
  }
  return out === '' ? '' : `${out.trimEnd()}${ELLIPSIS}`;
}
