/**
 * `tables` family Track-F component barrel — the single lazy-import target for
 * this track's definitions, so the registry's metadata graph reaches the
 * @adminium/ui-heavy widget components only through a dynamic `import()`
 * boundary (one lazy chunk for the family, 04 §2.3). Mirrors the kpi/charts
 * `components.ts` convention.
 */
export { MasterListWidget } from './MasterList.js';
export { LogTableWidget } from './LogTable.js';
export { CardGalleryWidget } from './CardGallery.js';
export { GroupedSummaryTableWidget } from './GroupedSummaryTable.js';
export { SchemaTreeWidget } from './SchemaTree.js';
export { ToggleMatrixWidget } from './ToggleMatrixWidget.js';
