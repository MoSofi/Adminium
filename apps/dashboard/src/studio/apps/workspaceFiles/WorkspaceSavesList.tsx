// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The workspace files saved here, for the "Saved from here" card: one row per
 * file in that card's own row anatomy (`Save As App.dc.html`, Y-A1) — the
 * file's tile, its name and file name, "{n} apps", when and where it was
 * saved — with Copy fingerprint and Download again.
 *
 * Self-contained, with its own query and actions, so the card mounts it as
 * one block under its app saves. It renders nothing when there are none.
 *
 * Also here: the workspace files uploaded and not finished, on Hosted apps,
 * which is how "Install the rest" survives a reload.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, IconTile, MonoText } from '@adminium/ui';
import { Archive, CircleCheck, Copy, Download, PackagePlus, Trash2 } from 'lucide-react';

import { t } from '../../../i18n/t.js';
import { formatBytes } from '../../storage/storageApi.js';
import { savedDate } from '../installReview.js';
import { sentence } from '../addOnWords.js';
import { appSavesQuery, discardWorkspaceFile, workspaceFilesQuery, workspaceSaveFileHref, WORKSPACE_FILES_QUERY_KEY, type WorkspaceSaveRow } from './workspaceFilesApi.js';
import { doneCount } from './workspaceFileStatus.js';

const ROW_BUTTON = 'h-8 rounded-[10px] px-[11px] text-[12.5px] font-bold';

export function WorkspaceSavesList({ onSaveAgain }: { onSaveAgain?: ((workspaceId: string) => void) | undefined }) {
  const { data } = useQuery(appSavesQuery());
  const rows = data?.workspaces ?? [];
  if (rows.length === 0) return null;
  return (
    <ul data-part="workspace-saves" aria-label={t('studio:workspaceFiles.saves.label', 'Workspace files saved here')}>
      {rows.map((row) => (
        <WorkspaceSaveItem key={row.id} row={row} onSaveAgain={onSaveAgain} />
      ))}
    </ul>
  );
}

function WorkspaceSaveItem({ row, onSaveAgain }: { row: WorkspaceSaveRow; onSaveAgain?: ((workspaceId: string) => void) | undefined }) {
  const [copied, setCopied] = useState(false);
  const filename = row.filename;
  return (
    <li className="flex flex-wrap items-center gap-3.5 border-t border-border px-5 py-[13px] leading-[normal]" data-testid={`workspace-save-${row.id}`}>
      <IconTile tone="accent" className="size-9 rounded-[10px] [&_svg]:size-[18px]">
        <Archive aria-hidden />
      </IconTile>
      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold">{row.name}</span>
          <MonoText className="text-[11.5px] text-fg-subtle">{filename}</MonoText>
          <span className="inline-flex h-[22px] items-center rounded-[6px] bg-surface-3 px-2 text-[11.5px] font-bold text-fg-muted">
            {t('studio:workspaceFiles.install.apps', '{count, plural, one {# app} other {# apps}}', { count: row.appSaveIds.length })}
          </span>
        </div>
        <div className="mt-[3px] text-[12.5px] text-fg-muted">
          {sentence('studio:workspaceFiles.saves.saved', 'saved {date} · {size}', { date: <MonoText>{savedDate(new Date(row.savedAt).toISOString())}</MonoText>, size: <MonoText>{formatBytes(row.bytes)}</MonoText> })}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="ghost" className={ROW_BUTTON} onClick={() => void navigator.clipboard?.writeText(row.integrity).then(() => setCopied(true))}>
          {copied ? <CircleCheck aria-hidden className="size-[15px] text-pos" /> : <Copy aria-hidden className="size-[15px]" />}
          {copied ? t('studio:workspaceFiles.copied', 'Copied') : t('studio:workspaceFiles.saves.copy', 'Copy fingerprint')}
        </Button>
        <a href={workspaceSaveFileHref(row.id)} download={filename} className={`inline-flex items-center gap-[7px] border border-border-strong bg-surface shadow-sm ${ROW_BUTTON}`}>
          <Download aria-hidden className="size-[15px]" />
          {t('studio:workspaceFiles.saves.download', 'Download again')}
        </a>
        {onSaveAgain === undefined || row.workspaceId === null ? null : (
          <Button variant="secondary" className={ROW_BUTTON} onClick={() => onSaveAgain(row.workspaceId!)}>
            <PackagePlus aria-hidden className="size-[15px]" />
            {t('studio:workspaceFiles.saves.again', 'Save a newer version')}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Workspace files uploaded and not finished, on Hosted apps: each with how far
 * it got, "Install the rest" (or its review), and Discard. A reload loses
 * nothing: the file stays staged on the server until it is done or discarded.
 */
export function WorkspaceFilesWaiting({ onOpen }: { onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery(workspaceFilesQuery());
  const discard = useMutation({
    mutationFn: (id: string) => discardWorkspaceFile(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: WORKSPACE_FILES_QUERY_KEY }),
  });
  if (data.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" data-part="workspace-files-waiting" aria-label={t('studio:workspaceFiles.waiting.label', 'Workspace files waiting')}>
      {data.map((file) => {
        const done = doneCount(file);
        return (
          <li key={file.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-warn/25 bg-warn-soft px-[15px] py-3 text-[13px] leading-[1.5]" role="status">
            <Archive aria-hidden className="size-4 shrink-0 text-warn" />
            <span className="min-w-0 flex-1">
              {file.state === 'stopped'
                ? t('studio:workspaceFiles.waiting.stopped', '{workspace}: {done} of {total} installed. The install stopped part way.', { workspace: file.name, done, total: file.apps.length })
                : t('studio:workspaceFiles.waiting.staged', '{workspace} is uploaded and waits to be installed.', { workspace: file.name })}
            </span>
            <Button size="sm" onClick={() => onOpen(file.id)}>
              {file.state === 'stopped' || done > 0 ? t('studio:workspaceFiles.done.rest', 'Install the rest') : t('studio:workspaceFiles.waiting.review', 'Review and install')}
            </Button>
            <Button size="sm" variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate(file.id)}>
              <Trash2 aria-hidden />
              {t('studio:workspaceFiles.waiting.discard', 'Discard')}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
