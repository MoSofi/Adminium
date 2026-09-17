// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Attachments panel's *Workspace documents* (comp 695-701; Appendix A
 * §E3; D8): the library's non-image files as rows — name, size, a plus —
 * each a fixed attachment when clicked. Read-only over `GET /files`.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { Spinner } from '@adminium/ui';

import type { FileDto } from '../../../../files/api.js';
import { ALL_FILES_FILTERS, filesQuery, formatBytes } from '../../../../files/filesQueries.js';
import { t } from '../../../../i18n/t.js';

export interface WorkspaceDocumentsProps {
  /** Files already attached — hidden from the list. */
  attachedFileIds: ReadonlySet<string>;
  onAttach: (file: FileDto) => void;
}

export function WorkspaceDocuments({ attachedFileIds, onAttach }: WorkspaceDocumentsProps) {
  const list = useInfiniteQuery(filesQuery(ALL_FILES_FILTERS));
  const documents = (list.data?.pages ?? [])
    .flatMap((page) => page.data)
    .filter((file) => !file.mime.startsWith('image/') && !attachedFileIds.has(file.id));

  if (list.isPending) {
    return (
      <div className="flex justify-center py-3">
        <Spinner label={t('common.loading', 'Loading')} />
      </div>
    );
  }
  if (documents.length === 0) {
    return <span className="text-[10.5px] leading-[1.5] text-fg-subtle">{t('email:inspector.noDocuments', 'No documents in the library yet. Upload one from Files.')}</span>;
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="email-workspace-documents">
      {documents.map((file) => (
        <button
          key={file.id}
          type="button"
          data-testid="email-workspace-document"
          data-file-id={file.id}
          onClick={() => onAttach(file)}
          className="flex items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-2.5 py-2 text-start text-[12px] font-bold text-fg transition-colors hover:border-border-strong"
        >
          <FileText className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{file.filename}</span>
          <span className="shrink-0 text-[10.5px] text-fg-subtle">{formatBytes(file.sizeBytes)}</span>
          <Plus className="size-[13px] shrink-0 text-fg-subtle" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
