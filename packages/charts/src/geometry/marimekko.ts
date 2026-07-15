/**
 * Pure Marimekko / Mekko layout (`chart-marimekko`, research/widget-registry.md
 * §2): column width = outer share, vertical segments = inner mix. DOM-free.
 * Input is a `matrix` (rowKeys = inner categories, colKeys = outer columns,
 * cells[row][col] = value). Columns mirror in RTL (first column at inline-start,
 * the right edge under `rtl`); vertical stacking is direction-invariant.
 */

export interface MarimekkoSegment {
  rowIndex: number;
  rowKey: string;
  value: number;
  /** Share of the column total, 0..1. */
  share: number;
  y: number;
  height: number;
}

export interface MarimekkoColumn {
  colIndex: number;
  colKey: string;
  total: number;
  /** Share of the grand total, 0..1. */
  share: number;
  x: number;
  width: number;
  segments: MarimekkoSegment[];
}

export interface MarimekkoLayout {
  columns: MarimekkoColumn[];
  grandTotal: number;
}

export interface MarimekkoLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  /** Gap between columns in px (default 2). */
  gap?: number;
}

/**
 * `cells[rowIndex][colIndex]` — the widget adapts the §3 `matrix` envelope
 * (rowKeys × colKeys × cells) into this shape.
 */
export function layoutMarimekko(
  rowKeys: readonly string[],
  colKeys: readonly string[],
  cells: readonly (readonly number[])[],
  options: MarimekkoLayoutOptions,
): MarimekkoLayout {
  const { width, height, rtl, gap = 2 } = options;
  const cols = colKeys.length;
  if (cols === 0 || rowKeys.length === 0 || width <= 0 || height <= 0) {
    return { columns: [], grandTotal: 0 };
  }

  const columnTotals = colKeys.map((_col, colIndex) =>
    rowKeys.reduce((sum, _row, rowIndex) => sum + Math.max(0, cells[rowIndex]?.[colIndex] ?? 0), 0),
  );
  const grandTotal = columnTotals.reduce((sum, t) => sum + t, 0);
  const totalGap = gap * Math.max(0, cols - 1);
  const usableWidth = Math.max(0, width - totalGap);

  // Column x positions accumulate inline-start → inline-end; the whole strip
  // mirrors by reflecting the accumulated inline-start offset in RTL.
  let cursor = 0;
  const columns: MarimekkoColumn[] = colKeys.map((colKey, colIndex) => {
    const total = columnTotals[colIndex] ?? 0;
    const share = grandTotal > 0 ? total / grandTotal : 1 / cols;
    const colWidth = usableWidth * share;
    const inlineStart = cursor;
    cursor += colWidth + gap;
    const x = rtl ? width - inlineStart - colWidth : inlineStart;

    let segCursor = 0;
    const segments: MarimekkoSegment[] = rowKeys.map((rowKey, rowIndex) => {
      const value = Math.max(0, cells[rowIndex]?.[colIndex] ?? 0);
      const segShare = total > 0 ? value / total : 0;
      const segHeight = segShare * height;
      const y = segCursor;
      segCursor += segHeight;
      return { rowIndex, rowKey, value, share: segShare, y, height: segHeight };
    });

    return { colIndex, colKey, total, share, x, width: colWidth, segments };
  });

  return { columns, grandTotal };
}
