// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's toolbar row (34-invoices-add-on.md Appendix E §M4–M7; comp
 * 195-216): the Templates/Invoices tray with count badges, the *Group*
 * eyebrow and its None · Topic · Language segment, the search field and the
 * gallery/list segment. The counts are the reply's, unfiltered — the comp's
 * badges never respond to the search box (1423).
 */
import { Files, FolderTree, Languages, LayoutGrid, LayoutTemplate, List } from 'lucide-react';
import { SearchInput, SegmentedControl, TabsList, TabsTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InvoiceCounts, InvoiceDocumentKind } from '../api.js';
import type { ManagerGroupBy, ManagerLayout } from './useManagerPrefs.js';

export interface ToolbarProps {
  tab: InvoiceDocumentKind;
  counts: InvoiceCounts;
  groupBy: ManagerGroupBy;
  onGroupByChange: (groupBy: ManagerGroupBy) => void;
  search: string;
  onSearchChange: (value: string) => void;
  layout: ManagerLayout;
  onLayoutChange: (layout: ManagerLayout) => void;
}

/** `Search {templates|invoices}…` (comp 210, `tabPlural` 1466). */
export function searchPlaceholder(tab: InvoiceDocumentKind): string {
  return tab === 'template' ? t('invoices:manager.search.templates', 'Search templates…') : t('invoices:manager.search.invoices', 'Search invoices…');
}

export function Toolbar({ tab, counts, groupBy, onGroupByChange, search, onSearchChange, layout, onLayoutChange }: ToolbarProps) {
  return (
    <div data-testid="invoices-toolbar" className="mb-5 flex flex-wrap items-center gap-3">
      <TabsList aria-label={t('invoices:manager.tabs.label', 'Kind')}>
        <TabsTrigger value="template" count={counts.template}>
          <LayoutTemplate className="size-[15px]" aria-hidden="true" />
          {t('invoices:manager.tabs.templates', 'Templates')}
        </TabsTrigger>
        <TabsTrigger value="invoice" count={counts.invoice}>
          <Files className="size-[15px]" aria-hidden="true" />
          {t('invoices:manager.tabs.invoices', 'Invoices')}
        </TabsTrigger>
      </TabsList>
      <div className="ms-auto flex items-center gap-2">
        <span id="invoices-group-by-label" className="text-[11px] font-bold uppercase tracking-[.05em] text-fg-subtle">
          {t('invoices:manager.group.label', 'Group')}
        </span>
        <SegmentedControl
          aria-labelledby="invoices-group-by-label"
          data-testid="invoices-group-by"
          value={groupBy}
          onValueChange={(value) => onGroupByChange(value === 'topic' || value === 'language' ? value : 'none')}
          options={[
            { value: 'none', label: t('invoices:manager.group.none', 'None') },
            { value: 'topic', label: t('invoices:manager.group.topic', 'Topic'), icon: <FolderTree aria-hidden="true" /> },
            { value: 'language', label: t('invoices:manager.group.language', 'Language'), icon: <Languages aria-hidden="true" /> },
          ]}
        />
      </div>
      <SearchInput
        className="w-60 max-w-[44vw]"
        placeholder={searchPlaceholder(tab)}
        aria-label={searchPlaceholder(tab)}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onClear={() => onSearchChange('')}
        clearLabel={t('invoices:manager.search.clear', 'Clear search')}
      />
      <SegmentedControl
        aria-label={t('invoices:manager.layout.label', 'Layout')}
        data-testid="invoices-layout"
        value={layout}
        onValueChange={(value) => onLayoutChange(value === 'list' ? 'list' : 'gallery')}
        options={[
          { value: 'gallery', ariaLabel: t('invoices:manager.layout.gallery', 'Gallery'), icon: <LayoutGrid aria-hidden="true" /> },
          { value: 'list', ariaLabel: t('invoices:manager.layout.list', 'List'), icon: <List aria-hidden="true" /> },
        ]}
      />
    </div>
  );
}
