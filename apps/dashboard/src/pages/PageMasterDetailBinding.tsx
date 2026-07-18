/**
 * `page-master-detail` binding (09-generated-app.md §4.1, §7.3): projects the
 * page envelope onto the `PageMasterDetail` template from `@adminium/widgets`.
 *
 * Selection is route-controlled through the canonical record route
 * `/p/$slug/r/$recordId` (recordId ⇄ adapters.openRecord) — deep links
 * restore the selected record exactly as §7.3 asks; the spec's `?sel=`
 * search param is deliberately traded for the record route every other
 * template already uses (one canonical deep-link shape per page). The
 * template's own `record-open` echo is swallowed here — selection routing
 * owns the push.
 */
import { PageMasterDetail } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import type { PageTemplateProps } from './template-types.js';
import { usePageTemplateData } from './usePageTemplateData.js';

export function PageMasterDetailBinding({ page, adapters, recordId }: PageTemplateProps) {
  const { states } = usePageTemplateData(page);

  return (
    <PageMasterDetail
      config={page.config}
      states={states}
      selectedId={recordId ?? null}
      onSelectedChange={adapters.openRecord}
      onEvent={(instanceId, event) => {
        void instanceId;
        if (event.type === 'record-open') return; // selection routing owns it
        return adapters.onEvent(event);
      }}
      labels={{
        allFilter: t('templates.masterDetail.allFilter', 'All'),
        clearFilters: t('templates.masterDetail.clearFilters', 'Clear filters'),
        emptyTitle: t('templates.masterDetail.emptyTitle', 'Nothing here yet'),
        emptyBody: t('templates.masterDetail.emptyBody', 'Records appear here as rows land in the table.'),
        noMatchesTitle: t('templates.masterDetail.noMatchesTitle', 'No matching records'),
        noMatchesBody: t('templates.masterDetail.noMatchesBody', 'Try removing a filter.'),
        errorTitle: t('templates.masterDetail.errorTitle', 'This list failed to load'),
        retry: t('common.retry', 'Retry'),
        loading: t('templates.masterDetail.loading', 'Loading records'),
        selectPrompt: t('templates.masterDetail.selectPrompt', 'Select a record'),
      }}
    />
  );
}
