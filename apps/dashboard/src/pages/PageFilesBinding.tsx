/**
 * `page-files` binding (09-generated-app.md §4.1, §7.9): projects the page
 * envelope onto the real `PageFiles` template from `@adminium/widgets`.
 *
 * Data: `usePageWidgetStates` — one widget-data batch per mount under the
 * shared `['widget-data', pageId, …]` key (realtime invalidations refetch).
 * The preview drawer is route-synced through the `/p/$slug/r/$recordId`
 * child route (adapters.openRecord), the page-crud detail idiom. Star
 * toggles re-enter the host event sink → CRUD update + undo toast (the files
 * page's `source.table` IS the attachment table).
 *
 * UPLOADS: there is no server upload surface yet (08 §2.11 — no files
 * routes), so `onUpload` stays unset and the template renders the dropzone
 * disabled with honest copy — declared track deviation, not a dead button.
 */
import { PageFiles } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import { usePageWidgetStates } from './lmc/widgetStates.js';
import type { PageTemplateProps } from './template-types.js';

export function PageFilesBinding({ page, adapters, recordId }: PageTemplateProps) {
  const { states } = usePageWidgetStates(page);

  return (
    <PageFiles
      layout={page.config['layout']}
      states={states}
      previewNodeId={recordId ?? null}
      onPreviewNodeChange={adapters.openRecord}
      onEvent={(instanceId, event) => {
        void instanceId;
        void adapters.onEvent(event);
      }}
      // i18n: template labels resolve here so the widgets package stays
      // locale-agnostic (04 §2).
      labels={{
        uploadsUnavailable: t('files.uploadsUnavailable', 'Uploads are not available on this page yet.'),
      }}
    />
  );
}
