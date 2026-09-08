// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/invoices/$id` — the editor's route (34-invoices-add-on.md §3.9, 34-T49).
 * Reads the document once and hands it to the editor, keyed by id so a
 * language switch mounts a fresh draft (O22 → 39 D1: the draft is the
 * editor's own from then on; a refetch never overwrites it).
 */
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Alert, Button, Spinner } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { Editor } from './editor/Editor.js';
import { invoiceQuery } from './queries.js';

export function InvoiceEditorPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const detail = useQuery(invoiceQuery(id));

  if (detail.isSuccess) return <Editor key={detail.data.id} detail={detail.data} />;

  return (
    <>
      <PageActions title={t('invoices:manager.title', 'Invoices')} backTo="/invoices" />
      <PageSurface width="content" testId="invoices-editor-loading">
        {detail.isError ? (
          <Alert
            role="alert"
            tone="danger"
            title={t('invoices:editor.loadFailed', 'Couldn’t load this document')}
            body={detail.error instanceof Error ? detail.error.message : undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void detail.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            }
          />
        ) : (
          <div className="flex justify-center py-20">
            <Spinner label={t('common.loading', 'Loading')} />
          </div>
        )}
      </PageSurface>
    </>
  );
}
