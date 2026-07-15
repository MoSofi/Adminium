/**
 * Track F `tables` additions stories (annex §3): master-list, log-table,
 * card-gallery, grouped-summary-table, schema-tree, toggle-matrix. Each shows
 * its loaded variant, the four WidgetFrame states through WidgetHost
 * (acceptance #4), and light/dark × LTR/RTL matrices (acceptance #9). Widgets
 * resolve through a LOCAL registry override so stories work before the green
 * loop merges the definitions into the global map.
 */
import type { ReactNode } from 'react';

import { cardGalleryDemoData } from './CardGallery.js';
import { groupedSummaryTableDemoData } from './GroupedSummaryTable.js';
import { logTableDemoData } from './LogTable.js';
import { masterListDemoData } from './MasterList.js';
import { schemaTreeDemoData } from './SchemaTree.js';
import {
  cardGalleryDefinition,
  groupedSummaryTableDefinition,
  logTableDefinition,
  masterListDefinition,
  schemaTreeDefinition,
  toggleMatrixDefinition,
} from './tables-track-f.definitions.js';
import { toggleMatrixDemoData } from './ToggleMatrixWidget.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const definitions: WidgetDefinition[] = [
  masterListDefinition,
  logTableDefinition,
  cardGalleryDefinition,
  groupedSummaryTableDefinition,
  schemaTreeDefinition,
  toggleMatrixDefinition,
];
const registry = buildRegistry(definitions);

const meta = { title: 'Widgets/Tables/TrackF' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(widgetId: string, instanceId: string, config: Record<string, unknown>, data: unknown, status: Status = 'success', width = 'w-[38rem]') {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="flex flex-wrap items-start gap-4 bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const masterConfig = { title: 'Automation rules', titleField: 'name', statusField: 'status', toggleField: 'enabled', filterField: 'category', ownerField: 'owner_name', updatedField: 'updated_at', progressField: 'progress' };
const logConfig = { title: 'Audit log', liveTail: true };
const galleryConfig = { title: 'Integrations', columns: 3 };
const summaryConfig = { title: 'Usage by region' };
const schemaConfig = { title: 'Schema', expandDepth: 1 };
const matrixConfig = { title: 'Roles & permissions', rowHeader: 'Permission', matrixLabel: 'Role permissions' };

export const MasterListStory = {
  name: 'master-list',
  render: () => host('master-list', 's-master', masterConfig, masterListDemoData(7), 'success', 'w-[30rem]'),
};
export const LogTableStory = {
  name: 'log-table',
  render: () => host('log-table', 's-log', logConfig, logTableDemoData(3), 'success', 'w-[52rem]'),
};
export const CardGalleryStory = {
  name: 'card-gallery',
  render: () => host('card-gallery', 's-gallery', galleryConfig, cardGalleryDemoData(1), 'success', 'w-[48rem]'),
};
export const GroupedSummaryStory = {
  name: 'grouped-summary-table',
  render: () => host('grouped-summary-table', 's-summary', summaryConfig, groupedSummaryTableDemoData(5), 'success', 'w-[48rem]'),
};
export const SchemaTreeStory = {
  name: 'schema-tree',
  render: () => host('schema-tree', 's-schema', schemaConfig, schemaTreeDemoData(1), 'success', 'w-[22rem]'),
};
export const ToggleMatrixStory = {
  name: 'toggle-matrix',
  render: () => host('toggle-matrix', 's-matrix', matrixConfig, toggleMatrixDemoData(1), 'success', 'w-[48rem]'),
};

/** Four WidgetFrame states for the log-table (loaded · skeleton · empty · error). */
export const LogTableStates = {
  render: () => (
    <div className="flex flex-col gap-4">
      {host('log-table', 'ls-loaded', logConfig, logTableDemoData(3), 'success', 'w-[52rem]')}
      <Frame>
        {host('log-table', 'ls-skeleton', logConfig, undefined, 'loading', 'w-[24rem]')}
        {host('log-table', 'ls-empty', { ...logConfig, emptyState: { titleKey: 'No log entries yet' } }, { data: [], total: 0 }, 'success', 'w-[24rem]')}
        {host('log-table', 'ls-error', logConfig, undefined, 'error', 'w-[24rem]')}
      </Frame>
    </div>
  ),
};

/** master-list + toggle-matrix across light/dark × LTR/RTL. */
export const ThemeMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('master-list', 'mm-l-ltr', masterConfig, masterListDemoData(7), 'success', 'w-[26rem]')}</Frame>
      <Frame dir="rtl">{host('master-list', 'mm-l-rtl', masterConfig, masterListDemoData(7), 'success', 'w-[26rem]')}</Frame>
      <Frame dark dir="ltr">{host('master-list', 'mm-d-ltr', masterConfig, masterListDemoData(7), 'success', 'w-[26rem]')}</Frame>
      <Frame dark dir="rtl">{host('master-list', 'mm-d-rtl', masterConfig, masterListDemoData(7), 'success', 'w-[26rem]')}</Frame>
    </div>
  ),
};

export const ToggleMatrixThemeMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('toggle-matrix', 'tmm-l-ltr', matrixConfig, toggleMatrixDemoData(1), 'success', 'w-[44rem]')}</Frame>
      <Frame dir="rtl">{host('toggle-matrix', 'tmm-l-rtl', matrixConfig, toggleMatrixDemoData(1), 'success', 'w-[44rem]')}</Frame>
      <Frame dark dir="ltr">{host('toggle-matrix', 'tmm-d-ltr', matrixConfig, toggleMatrixDemoData(1), 'success', 'w-[44rem]')}</Frame>
      <Frame dark dir="rtl">{host('toggle-matrix', 'tmm-d-rtl', matrixConfig, toggleMatrixDemoData(1), 'success', 'w-[44rem]')}</Frame>
    </div>
  ),
};
