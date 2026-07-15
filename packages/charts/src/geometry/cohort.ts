/**
 * Pure cohort-retention matrix geometry (research/widget-registry.md §2
 * `chart-cohort-matrix`): cohort rows × period columns, accent alpha by value,
 * triangular nulls transparent, label text flips to the on-accent color past a
 * threshold (~55%). DOM-free and deterministic (workplan/04 §7.1) so the same
 * SVG path/positions render in Node and the browser (acceptance #10).
 *
 * RTL policy (04 §7.4): the period columns are a horizontal categorical scale,
 * so they mirror under `rtl` (rightmost = M0) with the cohort label gutter on
 * the inline-start (physical right) side; the vertical cohort rows never move.
 */
import { heatLevel, rampColorVar } from './heat.js';

export interface CohortCell {
  row: number;
  col: number;
  x: number;
  y: number;
  size: number;
  /** Cell value (e.g. retention %); null renders the triangular gap. */
  value: number | null;
  /** Sequential ramp level; -1 for null gaps. */
  level: number;
  /** Ramp color var(), or 'none' for null gaps. */
  colorVar: string;
  /** Whether the value label should use the on-accent color. */
  textLight: boolean;
}

export interface CohortAxisLabel {
  index: number;
  /** Center coordinate along the axis (x for columns, y for rows). */
  pos: number;
  label: string;
}

export interface CohortLayout {
  cells: CohortCell[];
  rowLabels: CohortAxisLabel[];
  colLabels: CohortAxisLabel[];
  /** Total plotted width/height (grid + gutters/header). */
  width: number;
  height: number;
  /** Inline-start x of the cohort label gutter text anchor edge. */
  rowLabelX: number;
  /** Text anchor for the cohort (row) labels given the direction. */
  rowLabelAnchor: 'start' | 'end';
}

export interface CohortOptions {
  cellSize?: number;
  gap?: number;
  /** Width reserved for cohort (row) labels. */
  rowLabelWidth?: number;
  /** Height reserved for the period (column) header. */
  colLabelHeight?: number;
  rtl?: boolean;
  /** Value at/above which label text flips to the on-accent color. Default 55. */
  flipThreshold?: number;
  /** Number of ramp levels (incl. 0). Default 7 → viz-ramp-1..6. */
  levels?: number;
  /** Value that maps to the darkest ramp step. Default 100 (percent scale). */
  maxValue?: number;
}

/**
 * Lay out a (possibly triangular) cohort matrix. `cells[r][c]` is the value at
 * cohort `r`, period `c`; `null`/`undefined` cells are transparent gaps.
 */
export function cohortLayout(
  rowKeys: readonly string[],
  colKeys: readonly string[],
  cells: readonly (readonly (number | null)[])[],
  options: CohortOptions = {},
): CohortLayout {
  const {
    cellSize = 40,
    gap = 3,
    rowLabelWidth = 72,
    colLabelHeight = 20,
    rtl = false,
    flipThreshold = 55,
    levels = 7,
    maxValue = 100,
  } = options;

  const step = cellSize + gap;
  const cols = colKeys.length;
  const rows = rowKeys.length;
  const gridWidth = cols > 0 ? cols * step - gap : 0;
  const gridHeight = rows > 0 ? rows * step - gap : 0;
  const width = rowLabelWidth + gridWidth;
  const height = colLabelHeight + gridHeight;

  // Column x within the grid area; mirrors the categorical order in RTL. The
  // cohort label gutter sits on the inline-start (left in LTR, right in RTL).
  const gridOriginX = rtl ? 0 : rowLabelWidth;
  const colX = (col: number): number => gridOriginX + (rtl ? cols - 1 - col : col) * step;

  const out: CohortCell[] = [];
  for (let r = 0; r < rows; r += 1) {
    const rowCells = cells[r] ?? [];
    for (let c = 0; c < cols; c += 1) {
      const raw = rowCells[c];
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
      const level = value === null ? -1 : heatLevel(value, maxValue, levels);
      out.push({
        row: r,
        col: c,
        x: colX(c),
        y: colLabelHeight + r * step,
        size: cellSize,
        value,
        level,
        colorVar: value === null ? 'none' : rampColorVar(level, levels),
        textLight: value !== null && value >= flipThreshold,
      });
    }
  }

  const colLabels: CohortAxisLabel[] = colKeys.map((label, c) => ({
    index: c,
    pos: colX(c) + cellSize / 2,
    label,
  }));
  const rowLabels: CohortAxisLabel[] = rowKeys.map((label, r) => ({
    index: r,
    pos: colLabelHeight + r * step + cellSize / 2,
    label,
  }));

  return {
    cells: out,
    rowLabels,
    colLabels,
    width,
    height,
    rowLabelX: rtl ? gridWidth + 8 : rowLabelWidth - 8,
    rowLabelAnchor: rtl ? 'start' : 'end',
  };
}
