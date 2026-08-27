// SPDX-License-Identifier: AGPL-3.0-only
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
  dateOnlyValue,
  displayValueOf,
  fkDisplayAliasOf,
  formatAbsoluteTime,
  formatCalendarDate,
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

// M7 Wave-4 TAIL (annex §3) — the six list widgets that complete the family.
export {
  SparklineTable,
  SparklineTableWidget,
  sparkRowsOf,
  sparklineTableConfigSchema,
  sparklineTableDemoData,
  type SparkMetricRow,
  type SparklineTableConfig,
  type SparklineTableProps,
} from './SparklineTable.js';
export {
  TopMoversList,
  TopMoversListWidget,
  moverRowsOf,
  topMoversListConfigSchema,
  topMoversListDemoData,
  type MoverRow,
  type TopMoversListConfig,
  type TopMoversListProps,
} from './TopMoversList.js';
export {
  RankedEntityList,
  RankedEntityListWidget,
  rankedEntitiesOf,
  rankedEntityListConfigSchema,
  rankedEntityListDemoData,
  type RankedEntity,
  type RankedEntityListConfig,
  type RankedEntityListProps,
} from './RankedEntityList.js';
export {
  AccordionList,
  AccordionListWidget,
  accordionListConfigSchema,
  accordionListDemoData,
  accordionRowsOf,
  type AccordionListConfig,
  type AccordionListProps,
  type AccordionRow,
} from './AccordionList.js';
export {
  ComparisonMatrix,
  ComparisonMatrixWidget,
  comparisonDataOf,
  comparisonMatrixConfigSchema,
  comparisonMatrixDemoData,
  type ComparisonCell,
  type ComparisonColumn,
  type ComparisonMatrixConfig,
  type ComparisonMatrixData,
  type ComparisonMatrixProps,
  type ComparisonRow,
} from './ComparisonMatrix.js';
export {
  ChipCloud,
  ChipCloudWidget,
  chipCloudConfigSchema,
  chipCloudDemoData,
  cloudChipsOf,
  type ChipCloudConfig,
  type ChipCloudProps,
  type CloudChip,
} from './ChipCloud.js';
export {
  formatDelta,
  formatMetricValue,
  goodDirectionFor,
  isBadMove,
  moverTone,
  rankRows,
  toggleOpen,
  trendOf,
  type GoodDirection,
  type RankedRow,
} from './tables-tail-lib.js';
export { tablesTailDefinitions } from './tables-tail.definitions.js';
