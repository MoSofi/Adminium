/**
 * Pure treemap geometry (`chart-treemap`, research/widget-registry.md §2):
 * squarified slice-and-dice layout (Bruls/Huizing/van Wijk) over a flat,
 * value-weighted category list. DOM-free and deterministic so scheduled-report
 * workers rasterize the identical layout the browser renders (04 §7.1).
 *
 * RTL: the caller mirrors the x axis (`mirrorTiles`) — the layout math itself
 * stays orientation-neutral (categorical part-to-whole mirrors per §7.4).
 */

export interface TreemapInput {
  label: string;
  value: number;
}

export interface TreemapTile {
  label: string;
  value: number;
  /** Fraction of the total, 0..1. */
  share: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** `var(--viz-N)` cycling by input order. */
  colorVar: string;
  /** Sequential alpha ramp step for area intensity (var(--viz-ramp-N)). */
  rampVar: string;
  /** The N in `rampVar`, 1..6 — the renderer needs it to pick a legible label
      color: from step 4 (65% accent) up, --fg no longer clears AA on the tile. */
  rampStep: number;
}

export interface TreemapOptions {
  width: number;
  height: number;
  /** Slices beyond this fold into a trailing "other" tile (default Infinity). */
  maxTiles?: number;
  otherLabel?: string;
}

function vizColor(index: number): string {
  return `var(--viz-${(index % 8) + 1})`;
}

/** Ramp step 1..6 by descending rank (largest tile = strongest). */
function rampStepFor(rank: number, count: number): number {
  if (count <= 1) return 6;
  const step = 6 - Math.round((rank / (count - 1)) * 5); // rank 0 → 6, last → 1
  return Math.min(6, Math.max(1, step));
}

function worstRatio(row: readonly number[], length: number): number {
  if (length <= 0 || row.length === 0) return Infinity;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const area of row) {
    if (area < min) min = area;
    if (area > max) max = area;
    sum += area;
  }
  const side2 = length * length;
  const sum2 = sum * sum;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}

interface Cursor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Squarified treemap tiles in input order (color cycles by order; area alpha
 * ramps by value rank). Non-positive and non-finite values are dropped.
 */
export function treemapTiles(
  input: readonly TreemapInput[],
  options: TreemapOptions,
): TreemapTile[] {
  const { width, height, maxTiles = Infinity, otherLabel = 'Other' } = options;
  if (width <= 0 || height <= 0) return [];

  // Fold overflow into an "other" tile, preserving input order/color indices.
  let items: TreemapInput[] = input.filter((d) => Number.isFinite(d.value) && d.value > 0);
  const colorIndex = new Map<TreemapInput, number>();
  items.forEach((item, i) => colorIndex.set(item, i));
  if (Number.isFinite(maxTiles) && items.length > maxTiles) {
    const kept = items.slice(0, maxTiles);
    const rest = items.slice(maxTiles).reduce((sum, d) => sum + d.value, 0);
    const other: TreemapInput = { label: otherLabel, value: rest };
    colorIndex.set(other, maxTiles);
    items = [...kept, other];
  }

  const total = items.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) return [];

  const area = width * height;
  // Descending scaled areas drive squarify; original index rides along for order.
  const scaled = items
    .map((item, index) => ({ item, index, area: (item.value / total) * area }))
    .sort((a, b) => b.area - a.area || a.index - b.index);

  const placed: { index: number; x: number; y: number; width: number; height: number }[] = [];
  const cursor: Cursor = { x: 0, y: 0, width, height };
  let row: { index: number; area: number }[] = [];

  const shortSide = (): number => Math.min(cursor.width, cursor.height);

  const layoutRow = (): void => {
    if (row.length === 0) return;
    const rowArea = row.reduce((sum, r) => sum + r.area, 0);
    const horizontal = cursor.width >= cursor.height;
    if (horizontal) {
      const rowWidth = rowArea / cursor.height;
      let offset = cursor.y;
      for (const cell of row) {
        const cellHeight = (cell.area / rowArea) * cursor.height;
        placed.push({ index: cell.index, x: cursor.x, y: offset, width: rowWidth, height: cellHeight });
        offset += cellHeight;
      }
      cursor.x += rowWidth;
      cursor.width -= rowWidth;
    } else {
      const rowHeight = rowArea / cursor.width;
      let offset = cursor.x;
      for (const cell of row) {
        const cellWidth = (cell.area / rowArea) * cursor.width;
        placed.push({ index: cell.index, x: offset, y: cursor.y, width: cellWidth, height: rowHeight });
        offset += cellWidth;
      }
      cursor.y += rowHeight;
      cursor.height -= rowHeight;
    }
    row = [];
  };

  for (const cell of scaled) {
    const length = shortSide();
    const current = row.map((r) => r.area);
    const withCell = [...current, cell.area];
    if (row.length === 0 || worstRatio(withCell, length) <= worstRatio(current, length)) {
      row.push({ index: cell.index, area: cell.area });
    } else {
      layoutRow();
      row.push({ index: cell.index, area: cell.area });
    }
  }
  layoutRow();

  // Rank by value (descending) for the alpha ramp.
  const rankByIndex = new Map<number, number>();
  [...scaled].forEach((cell, rank) => rankByIndex.set(cell.index, rank));

  return placed
    .sort((a, b) => a.index - b.index)
    .map((p) => {
      const source = items[p.index] as TreemapInput;
      const rampStep = rampStepFor(rankByIndex.get(p.index) ?? 0, placed.length);
      return {
        label: source.label,
        value: source.value,
        share: source.value / total,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        colorVar: vizColor(colorIndex.get(source) ?? p.index),
        rampVar: `var(--viz-ramp-${rampStep})`,
        rampStep,
      };
    });
}

/** Mirror tiles across the vertical axis for RTL rendering. */
export function mirrorTiles(tiles: readonly TreemapTile[], width: number): TreemapTile[] {
  return tiles.map((tile) => ({ ...tile, x: width - tile.x - tile.width }));
}
