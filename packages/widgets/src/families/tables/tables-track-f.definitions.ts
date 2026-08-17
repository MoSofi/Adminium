// SPDX-License-Identifier: AGPL-3.0-only
import { lazy } from 'react';

import {
  cardGalleryConfigSchema,
  cardGalleryDemoData,
  groupedSummaryTableConfigSchema,
  groupedSummaryTableDemoData,
  logTableConfigSchema,
  logTableDemoData,
  masterListConfigSchema,
  masterListDemoData,
  schemaTreeConfigSchema,
  schemaTreeDemoData,
  toggleMatrixConfigSchema,
  toggleMatrixDemoData,
} from './tables-track-f-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * Track F additions to the `tables` family (annex §3): master-list, log-table,
 * card-gallery, grouped-summary-table, schema-tree, toggle-matrix. Metadata
 * only — the @adminium/ui-heavy widget components load through the
 * `tables-track-f-components` barrel via `lazy(() => import(...))`, so the
 * family stays in one lazy chunk and the registry metadata never eagerly pulls
 * the component code (04 §2.3; the kpi/charts convention). The GREEN LOOP
 * spreads `tablesTrackFDefinitions` into the existing `tablesWidgetDefinitions`.
 * Widget ids match the annex catalog exactly (acceptance #1).
 */

export const masterListDefinition: WidgetDefinition = defineWidget({
  id: 'master-list',
  family: 'tables',
  component: lazy(() => import('./tables-track-f-components.js').then((m) => ({ default: m.MasterListWidget }))),
  configSchema: masterListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 8, defaultW: 5, defaultH: 12 }, // annex 4×4 → 5×6
  placement: 'grid',
  skeleton: 'list',
  capabilities: { editsData: true },
  demoData: masterListDemoData,
  descriptionKey: 'widgets.tables.masterList.description',
});

export const logTableDefinition: WidgetDefinition = defineWidget({
  id: 'log-table',
  family: 'tables',
  component: lazy(() => import('./tables-track-f-components.js').then((m) => ({ default: m.LogTableWidget }))),
  configSchema: logTableConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 8, minH: 6, defaultW: 12, defaultH: 10 }, // annex 8×3 → 12×5
  placement: 'grid',
  skeleton: 'table',
  capabilities: { exportCsv: true },
  demoData: logTableDemoData,
  descriptionKey: 'widgets.tables.logTable.description',
});

export const cardGalleryDefinition: WidgetDefinition = defineWidget({
  id: 'card-gallery',
  family: 'tables',
  component: lazy(() => import('./tables-track-f-components.js').then((m) => ({ default: m.CardGalleryWidget }))),
  configSchema: cardGalleryConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 6, defaultW: 12, defaultH: 8 }, // annex 6×3 → 12×4
  placement: 'grid',
  skeleton: 'card',
  demoData: cardGalleryDemoData,
  descriptionKey: 'widgets.tables.cardGallery.description',
});

export const groupedSummaryTableDefinition: WidgetDefinition = defineWidget({
  id: 'grouped-summary-table',
  family: 'tables',
  component: lazy(() => import('./tables-track-f-components.js').then((m) => ({ default: m.GroupedSummaryTableWidget }))),
  configSchema: groupedSummaryTableConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 6, defaultW: 12, defaultH: 8 }, // annex 6×3 → 12×4
  placement: 'grid',
  skeleton: 'table',
  capabilities: { exportCsv: true },
  demoData: groupedSummaryTableDemoData,
  descriptionKey: 'widgets.tables.groupedSummaryTable.description',
});

export const schemaTreeDefinition: WidgetDefinition = defineWidget({
  id: 'schema-tree',
  family: 'tables',
  component: lazy(() => import('./tables-track-f-components.js').then((m) => ({ default: m.SchemaTreeWidget }))),
  configSchema: schemaTreeConfigSchema,
  dataContract: 'hierarchy/tree',
  sizing: { minW: 3, minH: 8, defaultW: 3, defaultH: 12 }, // annex 3×4 → 3×6
  placement: 'grid',
  skeleton: 'list',
  demoData: schemaTreeDemoData,
  descriptionKey: 'widgets.tables.schemaTree.description',
});

export const toggleMatrixDefinition: WidgetDefinition = defineWidget({
  id: 'toggle-matrix',
  family: 'tables',
  component: lazy(() => import('./tables-track-f-components.js').then((m) => ({ default: m.ToggleMatrixWidget }))),
  configSchema: toggleMatrixConfigSchema,
  dataContract: 'matrix',
  sizing: { minW: 6, minH: 8, defaultW: 12, defaultH: 10 }, // annex 6×4 → 12×5
  placement: 'grid',
  skeleton: 'table',
  capabilities: { editsData: true },
  demoData: toggleMatrixDemoData,
  descriptionKey: 'widgets.tables.toggleMatrix.description',
});

export const tablesTrackFDefinitions: readonly WidgetDefinition[] = [
  masterListDefinition,
  logTableDefinition,
  cardGalleryDefinition,
  groupedSummaryTableDefinition,
  schemaTreeDefinition,
  toggleMatrixDefinition,
];
