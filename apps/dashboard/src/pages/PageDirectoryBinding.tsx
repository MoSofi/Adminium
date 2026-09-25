// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-directory` binding: projects the page envelope onto the
 * `PageDirectory` template from `@adminium/widgets`.
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
import { LinkFilterBar, LinkNarrowingGate, useLinkNarrowing, useNarrowedPage } from './linkNarrowing.js';
import type { PageTemplateProps } from './template-types.js';
import { usePageTemplateData } from './usePageTemplateData.js';

export function PageDirectoryBinding({ page, adapters, recordId, currency, formColumns, columnFacts }: PageTemplateProps) {
  // A link may open this list narrowed (`?f.<column>=<op>:<value>`): see linkNarrowing.tsx.
  const narrowing = useLinkNarrowing(page, adapters.crud?.table);
  const view = useNarrowedPage(page, narrowing);
  const { states } = usePageTemplateData(view.page, {}, view.key);

  if (view.blocked) return <LinkNarrowingGate narrowing={narrowing} cannotCarry={view.cannotCarry} />;


  return (
    <>
    <LinkFilterBar narrowing={narrowing} columns={formColumns} facts={columnFacts} />
    <PageDirectory
      // The connection's currency: a money card that names none reads in it.
      {...(currency === undefined ? {} : { currency })}
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
    </>
  );
}
