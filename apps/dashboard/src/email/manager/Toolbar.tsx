// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's toolbar row (comp 323-344): the Templates/Campaigns tray
 * with count badges, the *Group by* segment, the search field and the
 * gallery/list segment. In archived mode a leading `FilterChip` says so and
 * is the way back (D4).
 */
import { FolderTree, Languages, LayoutGrid, LayoutTemplate, List, Send } from 'lucide-react';
import { FilterChip, SearchInput, SegmentedControl, TabsList, TabsTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { EmailCounts, EmailDocumentKind } from '../api.js';
import type { ManagerGroupBy, ManagerLayout } from './useManagerPrefs.js';

export interface ToolbarProps {
  tab: EmailDocumentKind;
  counts: Pick<EmailCounts, 'template' | 'campaign'>;
  groupBy: ManagerGroupBy;
  onGroupByChange: (groupBy: ManagerGroupBy) => void;
  search: string;
  onSearchChange: (value: string) => void;
  layout: ManagerLayout;
  onLayoutChange: (layout: ManagerLayout) => void;
  archived: boolean;
  onLeaveArchived: () => void;
}

export function searchPlaceholder(tab: EmailDocumentKind): string {
  return tab === 'template'
    ? t('email:search.templates', 'Search templates…')
    : t('email:search.campaigns', 'Search campaigns…');
}

export function Toolbar({
  tab,
  counts,
  groupBy,
  onGroupByChange,
  search,
  onSearchChange,
  layout,
  onLayoutChange,
  archived,
  onLeaveArchived,
}: ToolbarProps) {
  return (
    <div data-testid="email-toolbar" className="mb-5 flex flex-wrap items-center gap-3">
      {archived ? (
        <FilterChip
          data-testid="email-archived-chip"
          field={t('email:archivedChip.field', 'Showing')}
          op="="
          value={t('email:archivedChip.value', 'Archived')}
          onRemove={onLeaveArchived}
          removeLabel={t('email:archivedChip.leave', 'Leave archived')}
        />
      ) : null}
        <TabsList aria-label={t('email:tabs.label', 'Kind')}>
          <TabsTrigger value="template" count={counts.template}>
            <LayoutTemplate className="size-[15px]" aria-hidden="true" />
            {t('email:tabs.templates', 'Templates')}
          </TabsTrigger>
          <TabsTrigger value="campaign" count={counts.campaign}>
            <Send className="size-[15px]" aria-hidden="true" />
            {t('email:tabs.campaigns', 'Campaigns')}
          </TabsTrigger>
        </TabsList>
      <div className="ms-auto flex items-center gap-[7px]">
        <span id="email-group-by-label" className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
          {t('email:groupBy.label', 'Group by')}
        </span>
        <SegmentedControl
          aria-labelledby="email-group-by-label"
          data-testid="email-group-by"
          value={groupBy}
          onValueChange={(value) => onGroupByChange(value === 'topic' || value === 'language' ? value : 'none')}
          options={[
            { value: 'none', label: t('email:groupBy.none', 'None') },
            { value: 'topic', label: t('email:groupBy.topic', 'Topic'), icon: <FolderTree aria-hidden="true" /> },
            { value: 'language', label: t('email:groupBy.language', 'Language'), icon: <Languages aria-hidden="true" /> },
          ]}
        />
      </div>
      <SearchInput
        className="w-52 max-w-[40vw]"
        placeholder={searchPlaceholder(tab)}
        aria-label={searchPlaceholder(tab)}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onClear={() => onSearchChange('')}
        clearLabel={t('email:search.clear', 'Clear search')}
      />
      <SegmentedControl
        aria-label={t('email:layout.label', 'Layout')}
        data-testid="email-layout"
        value={layout}
        onValueChange={(value) => onLayoutChange(value === 'list' ? 'list' : 'gallery')}
        options={[
          { value: 'gallery', ariaLabel: t('email:layout.gallery', 'Gallery'), icon: <LayoutGrid aria-hidden="true" /> },
          { value: 'list', ariaLabel: t('email:layout.list', 'List'), icon: <List aria-hidden="true" /> },
        ]}
      />
    </div>
  );
}
