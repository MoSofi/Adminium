// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's toolbar row (M4–M7; comp 151-163): the Templates/Reports
 * tray with count badges, the search field and the gallery/list segment. The
 * counts are the reply's, unfiltered — the comp's badges never respond to
 * the search box (580).
 *
 * NO GROUP SEGMENT and no actions menu: this comp draws neither (M7).
 */
import { SearchInput, SegmentedControl, TabsList, TabsTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { ReportCounts, ReportDocumentKind } from '../api.js';
import { reportIcon } from '../icons.js';
import type { ManagerLayout } from './useManagerPrefs.js';

export interface ToolbarProps {
  tab: ReportDocumentKind;
  counts: ReportCounts;
  search: string;
  onSearchChange: (value: string) => void;
  layout: ManagerLayout;
  onLayoutChange: (layout: ManagerLayout) => void;
}

/** `Search {templates|reports}…` (comp 157, `tabPlural` 580). */
export function searchPlaceholder(tab: ReportDocumentKind): string {
  return tab === 'template' ? t('reportBuilder:manager.search.templates', 'Search templates…') : t('reportBuilder:manager.search.reports', 'Search reports…');
}

export function Toolbar({ tab, counts, search, onSearchChange, layout, onLayoutChange }: ToolbarProps) {
  const TemplatesGlyph = reportIcon('layout-template');
  const ReportsGlyph = reportIcon('files');
  const GalleryGlyph = reportIcon('layout-grid');
  const ListGlyph = reportIcon('list');
  return (
    <div data-testid="report-toolbar" className="mb-5 flex flex-wrap items-center gap-3">
      <TabsList aria-label={t('reportBuilder:manager.tabs.label', 'Kind')}>
        <TabsTrigger value="template" count={counts.template}>
          <TemplatesGlyph className="size-[15px]" aria-hidden="true" />
          {t('reportBuilder:manager.tabs.templates', 'Templates')}
        </TabsTrigger>
        <TabsTrigger value="report" count={counts.report}>
          <ReportsGlyph className="size-[15px]" aria-hidden="true" />
          {t('reportBuilder:manager.tabs.reports', 'Reports')}
        </TabsTrigger>
      </TabsList>
      <SearchInput
        className="ms-auto w-60 max-w-[44vw]"
        placeholder={searchPlaceholder(tab)}
        aria-label={searchPlaceholder(tab)}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onClear={() => onSearchChange('')}
        clearLabel={t('reportBuilder:manager.search.clear', 'Clear search')}
      />
      <SegmentedControl
        aria-label={t('reportBuilder:manager.layout.label', 'Layout')}
        data-testid="report-layout"
        value={layout}
        onValueChange={(value) => onLayoutChange(value === 'list' ? 'list' : 'gallery')}
        options={[
          { value: 'gallery', ariaLabel: t('reportBuilder:manager.layout.gallery', 'Gallery'), icon: <GalleryGlyph aria-hidden="true" /> },
          { value: 'list', ariaLabel: t('reportBuilder:manager.layout.list', 'List'), icon: <ListGlyph aria-hidden="true" /> },
        ]}
      />
    </div>
  );
}
