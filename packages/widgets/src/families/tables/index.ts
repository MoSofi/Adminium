/**
 * `tables` family public surface — standalone components consumed by the
 * page templates (page-crud composes DataGrid/PaginationFooter/… directly)
 * plus the column-spec vocabulary shared with the interpreter.
 * Registry metadata stays in `definitions.ts` (lazy chunk boundary, 04 §2.3).
 */
export {
  GRID_LOGICAL_TYPES,
  GRID_SEMANTICS,
  columnAlign,
  compareCellValues,
  displayValueOf,
  formatAbsoluteTime,
  formatMoney,
  formatRelativeTime,
  gridColumnSpecSchema,
  gridLogicalTypeSchema,
  isNumericColumn,
  isTemporalColumn,
  maskedColumnsOf,
  rowIdOf,
  type GridColumnSpec,
  type GridColumnSpecInput,
  type GridLogicalType,
  type GridRow,
  type GridSemantic,
  type GridTone,
} from './column-spec.js';
export { CellValue, MASKED_PLACEHOLDER, cellAlignClass, type CellContext } from './cells.js';
export { DataGrid, type DataGridProps, type DataGridSort } from './DataGrid.js';
export {
  PAGE_SIZE_OPTIONS,
  PaginationFooter,
  type PaginationFooterProps,
} from './PaginationFooter.js';
export {
  BulkActionToolbar,
  type BulkAction,
  type BulkActionToolbarProps,
} from './BulkActionToolbar.js';
export { DetailKeyValue, type DetailKeyValueProps } from './DetailKeyValue.js';
export { MiniTable, type MiniTableProps } from './MiniTable.js';
export { demoCustomerColumns, demoCustomerRows, demoRecordList } from './demo-data.js';
export { tablesWidgetDefinitions } from './definitions.js';

// Track F additions (annex §3) — standalone components + registry metadata.
export { MasterList, type MasterListProps } from './MasterList.js';
export { LogTable, codeTone, isErrorRow, smartTimestamp, type LogTableProps, type LogRow } from './LogTable.js';
export { CardGallery, type CardGalleryProps, type GalleryCard } from './CardGallery.js';
export {
  GroupedSummaryTable,
  type AggColumn,
  type AggFormat,
  type GroupedSummaryData,
  type GroupedSummaryTableProps,
  type SummaryGroup,
} from './GroupedSummaryTable.js';
export { SchemaTree, type SchemaNode, type SchemaNodeKind, type SchemaTreeProps } from './SchemaTree.js';
export {
  ToggleMatrixGrid,
  type MatrixColumn,
  type MatrixData,
  type MatrixRow,
  type ToggleMatrixGridProps,
} from './ToggleMatrixWidget.js';
export { tablesTrackFDefinitions } from './tables-track-f.definitions.js';
