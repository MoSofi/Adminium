// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `tables` family M7 Wave-4 TAIL component barrel — the single lazy-import
 * target for this track's definitions, so the registry's metadata graph reaches
 * the @adminium/ui- and @adminium/charts-heavy widget components only through a
 * dynamic `import()` boundary (one lazy chunk for the family, 04 §2.3). Mirrors
 * the `tables-track-f-components` / `media-track-components` convention.
 */
export { AccordionListWidget } from './AccordionList.js';
export { ChipCloudWidget } from './ChipCloud.js';
export { ComparisonMatrixWidget } from './ComparisonMatrix.js';
export { RankedEntityListWidget } from './RankedEntityList.js';
export { SparklineTableWidget } from './SparklineTable.js';
export { TopMoversListWidget } from './TopMoversList.js';
