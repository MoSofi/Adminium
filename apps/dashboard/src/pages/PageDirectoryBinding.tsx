/**
 * `page-directory` binding (09-generated-app.md §4.1, §7.7): projects the
 * page envelope onto the `PageDirectory` template from `@adminium/widgets`.
 *
 * Data: one widget-data batch per page mount via `usePageTemplateData`
 * (kind: 'page' envelopes carry layout bindings the dashboard adapter
 * ignores). Routing: the person drawer is route-controlled through
 * `/p/$slug/r/$recordId` (recordId ⇄ adapters.openRecord), so the template's
 * own `record-open` echo is swallowed here — forwarding it too would push
 * the same href twice.
 */
import { PageDirectory } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import type { PageTemplateProps } from './template-types.js';
import { usePageTemplateData } from './usePageTemplateData.js';

export function PageDirectoryBinding({ page, adapters, recordId }: PageTemplateProps) {
  const { states } = usePageTemplateData(page);

  return (
    <PageDirectory
      config={page.config}
      states={states}
      detailRecordId={recordId ?? null}
      onDetailRecordChange={adapters.openRecord}
      onEvent={(instanceId, event) => {
        void instanceId;
        if (event.type === 'record-open') return; // drawer routing owns it
        return adapters.onEvent(event);
      }}
      labels={{
        searchPlaceholder: t('templates.directory.searchPlaceholder', 'Search people…'),
        allFilter: t('templates.directory.allFilter', 'All'),
        clearFilters: t('templates.directory.clearFilters', 'Clear filters'),
        close: t('common.close', 'Close'),
        detailTitle: t('templates.directory.detailTitle', 'Person'),
        emptyTitle: t('templates.directory.emptyTitle', 'No people yet'),
        emptyBody: t('templates.directory.emptyBody', 'People appear here as rows land in the table.'),
        noMatchesTitle: t('templates.directory.noMatchesTitle', 'No matching people'),
        noMatchesBody: t('templates.directory.noMatchesBody', 'Try a different search or remove a filter.'),
        errorTitle: t('templates.directory.errorTitle', 'This directory failed to load'),
        retry: t('common.retry', 'Retry'),
        loading: t('templates.directory.loading', 'Loading people'),
        memberCount: t('templates.directory.memberCount', '{count} people'),
      }}
    />
  );
}
