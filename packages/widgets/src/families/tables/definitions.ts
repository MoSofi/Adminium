import { lazy } from 'react';

import { demoCustomerColumns, demoCustomerRows, demoRecordList } from './demo-data.js';
import {
  bulkActionToolbarConfigSchema,
  dataGridConfigSchema,
  detailKeyValueConfigSchema,
  miniTableConfigSchema,
  paginationFooterConfigSchema,
} from './tables-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * `tables` family definitions (annex §3 — M4-T03 slice: data-grid,
 * pagination-footer, bulk-action-toolbar, detail-key-value, mini-table;
 * grouped-summary-table and the rest land by M7).
 *
 * Metadata only — component code lives in `./widgets.tsx` (one lazy chunk for
 * the family, 04 §2.3). Annex grid heights are rows; `sizing` uses 40px
 * half-row units, so rows × 2 (04 §6.1).
 */
export const tablesWidgetDefinitions: readonly WidgetDefinition[] = [
  defineWidget({
    id: 'data-grid',
    family: 'tables',
    component: lazy(() => import('./widgets.js').then((m) => ({ default: m.DataGridWidget }))),
    configSchema: dataGridConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 6, minH: 6, defaultW: 12, defaultH: 10 }, // annex: min 6×3, default 12×5
    placement: 'grid',
    skeleton: 'table',
    capabilities: { exportCsv: true, editsData: true },
    demoData: (seed) => ({ ...demoRecordList(seed), columns: demoCustomerColumns }),
    descriptionKey: 'widgets.tables.dataGrid.description',
  }),
  defineWidget({
    id: 'pagination-footer',
    family: 'tables',
    component: lazy(() => import('./widgets.js').then((m) => ({ default: m.PaginationFooterWidget }))),
    configSchema: paginationFooterConfigSchema,
    dataContract: 'record-list', // page cursor + total ride the list envelope
    sizing: { minW: 6, minH: 1, defaultW: 12, defaultH: 1 },
    placement: 'inline', // attached to data-grid (annex)
    skeleton: 'block',
    demoData: (seed) => demoRecordList(seed),
    descriptionKey: 'widgets.tables.paginationFooter.description',
  }),
  defineWidget({
    id: 'bulk-action-toolbar',
    family: 'tables',
    component: lazy(() => import('./widgets.js').then((m) => ({ default: m.BulkActionToolbarWidget }))),
    configSchema: bulkActionToolbarConfigSchema,
    dataContract: 'static', // selected-id array from the host grid (annex)
    sizing: { minW: 6, minH: 1, defaultW: 12, defaultH: 1 },
    placement: 'inline',
    skeleton: 'block',
    capabilities: { editsData: true },
    demoData: () => ['1', '2', '3'],
    descriptionKey: 'widgets.tables.bulkActionToolbar.description',
  }),
  defineWidget({
    id: 'detail-key-value',
    family: 'tables',
    component: lazy(() => import('./widgets.js').then((m) => ({ default: m.DetailKeyValueWidget }))),
    configSchema: detailKeyValueConfigSchema,
    dataContract: 'record',
    sizing: { minW: 4, minH: 6, defaultW: 4, defaultH: 8 }, // annex: min 4×3, default 4×4
    placement: 'grid',
    skeleton: 'list',
    demoData: (seed) => ({
      data: demoCustomerRows(seed, 1)[0] ?? {},
      columns: demoCustomerColumns,
    }),
    descriptionKey: 'widgets.tables.detailKeyValue.description',
  }),
  defineWidget({
    id: 'mini-table',
    family: 'tables',
    component: lazy(() => import('./widgets.js').then((m) => ({ default: m.MiniTableWidget }))),
    configSchema: miniTableConfigSchema,
    dataContract: 'record-list',
    sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 }, // annex: min 3×2, default 4×3
    placement: 'grid',
    skeleton: 'list',
    demoData: (seed) => ({ data: demoCustomerRows(seed, 5) }),
    descriptionKey: 'widgets.tables.miniTable.description',
  }),
];
