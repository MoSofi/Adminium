// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard grid barrel (04-widget-registry.md §6). Static renderer +
 * geometry/compaction (M4) plus the 04-T12 edit mode: dnd-kit drag/resize,
 * keyboard a11y, `findFirstFit`, and the `GridDragHandle`/`GridResizeHandle`
 * the builder wires into the WidgetFrame slots.
 */
export { DashboardGrid, type DashboardGridProps, type RenderItemContext } from './DashboardGrid.js';
export {
  GRID_COLUMNS,
  GRID_GAP_PX,
  ROW_UNIT_PX,
  compactVertical,
  sortByPosition,
} from './layout-math.js';
export {
  DEFAULT_MIN_SIZE,
  MAX_H,
  layoutItemSchema,
  pageLayoutSchema,
  type LayoutItem,
  type MinSize,
  type PageLayout,
} from './layout-schema.js';
export {
  applyMove,
  applyResize,
  clampItem,
  commitDraft,
  findFirstFit,
  moveAndCompact,
  pointerDeltaToCells,
  resizeAndCompact,
  snapPxToCells,
  type CellStep,
  type LayoutDraft,
} from './layout-edit.js';
export {
  GridDragHandle,
  GridResizeHandle,
  defaultGridAnnouncements,
  defaultGridEditLabels,
  snapToGridModifier,
  useGridItemEdit,
  type GridAnnouncements,
  type GridEditLabels,
  type GridEditLabelsInput,
  type GridItemEditControls,
} from './grid-edit.js';
