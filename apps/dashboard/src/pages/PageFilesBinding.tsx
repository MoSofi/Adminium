// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-files` binding: projects the page envelope onto the real
 * `PageFiles` template from `@adminium/widgets`.
 *
 * Data: `usePageWidgetStates` — one widget-data batch per mount under the
 * shared `['widget-data', pageId, …]` key (realtime invalidations refetch).
 * The preview drawer is route-synced through the `/p/$slug/r/$recordId`
 * child route (adapters.openRecord), the page-crud detail idiom. Star
 * toggles re-enter the host event sink → CRUD update + undo toast (the files
 * page's `source.table` IS the attachment table).
 *
 * UPLOADS: there is no server upload surface yet (no files routes), so
 * `onUpload` stays unset and the template renders the dropzone disabled
 * with honest copy — declared track deviation, not a dead button.
 */
import { PageFiles } from '@adminium/widgets';

import { usePageWidgetStates } from './lmc/widgetStates.js';
import { LinkFilterBar, LinkNarrowingGate, useLinkNarrowing, useNarrowedPage } from './linkNarrowing.js';
import type { PageTemplateProps } from './template-types.js';

export function PageFilesBinding({ page, adapters, recordId, formColumns, columnFacts }: PageTemplateProps) {
  // A link may open this list narrowed (`?f.<column>=<op>:<value>`): see linkNarrowing.tsx.
  const narrowing = useLinkNarrowing(page, adapters.crud?.table);
  const view = useNarrowedPage(page, narrowing);
  const { states } = usePageWidgetStates(view.page, {}, view.key);

  if (view.blocked) return <LinkNarrowingGate narrowing={narrowing} cannotCarry={view.cannotCarry} />;


  return (
    <>
    <LinkFilterBar narrowing={narrowing} columns={formColumns} facts={columnFacts} />
    <PageFiles
      layout={page.config['layout']}
      states={states}
      previewNodeId={recordId ?? null}
      onPreviewNodeChange={adapters.openRecord}
      onEvent={(instanceId, event) => {
        void instanceId;
        void adapters.onEvent(event);
      }}
    />
    </>
  );
}
