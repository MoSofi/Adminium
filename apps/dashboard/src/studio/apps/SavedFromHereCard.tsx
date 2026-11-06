// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Saved from here" on Hosted apps (`Save As App.dc.html` boards 4).
 *
 * One row per save: the app's name, its key and version, when and by whom,
 * and from which database; "Copy fingerprint", "Download again" (while the
 * kept copy is there) and "Save a newer version", which opens the quick save
 * on that database at the next version with the last save's words.
 */
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, FileArchive } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, IconTile, MonoText } from '@adminium/ui';
import type { ReactNode } from 'react';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import type { ConnectionDto } from '../api.js';
import { appSavesQuery, downloadSavedFile, type AppSaveRow } from './saveAppApi.js';
import { appIconOf } from './saveAppIcons.js';
import { WorkspaceSavesList } from './workspaceFiles/WorkspaceSavesList.js';

export interface SavedFromHereCardProps {
  connections: readonly ConnectionDto[];
  /** Opens Save as app: the empty card's button. */
  saveButton: ReactNode;
  onSaveNewer: (save: AppSaveRow) => void;
}

export function SavedFromHereCard({ connections, saveButton, onSaveNewer }: SavedFromHereCardProps) {
  const { data: saves = [] } = useQuery(appSavesQuery());
  const toasts = useAppToasts();
  const formats = getFormatters(getI18nInstance()?.language ?? 'en-US');
  const databaseOf = (id: string | null) => connections.find((one) => one.id === id)?.name ?? null;

  return (
    <Card data-part="saved-from-here">
      <CardHeader className="flex items-center gap-3">
        <h2 className="text-sm font-bold tracking-tight">{t('studio:saveApp.saved.title', 'Saved from here')}</h2>
        <MonoText className="text-xs text-fg-subtle">{saves.length}</MonoText>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {saves.length === 0 ? (
          <EmptyState
            title={t('studio:saveApp.saved.emptyTitle', 'Nothing saved yet')}
            body={t('studio:saveApp.saved.empty', 'Save as app turns a database’s dashboard into a file you can install on another server.')}
            actions={saveButton}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {saves.map((save) => {
              const database = databaseOf(save.connectionId);
              // The app's own icon when it was saved with one.
              const Own = appIconOf(save.icon) ?? FileArchive;
              return (
                <li key={save.id} className="flex flex-wrap items-center gap-4">
                  <IconTile>
                    <Own aria-hidden className="size-5" />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold tracking-tight">{save.name ?? save.key}</span>
                      <MonoText className="text-xs text-fg-muted">{save.key}</MonoText>
                      <Badge>
                        <MonoText>{save.version}</MonoText>
                      </Badge>
                    </div>
                    <p className="text-[12.5px] text-fg-muted">
                      {t('studio:saveApp.saved.when', 'saved {date}', { date: formats.date(save.savedAt, 'medium') })}
                      {save.savedByName === null ? null : ` · ${t('studio:saveApp.saved.by', 'by {person}', { person: save.savedByName })}`}
                      {database === null ? null : (
                        <>
                          {' · '}
                          <MonoText>{database}</MonoText>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText(save.integrity).then(
                          () => toasts.push({ variant: 'success', title: t('studio:saveApp.download.copied', 'Fingerprint copied') }),
                          () => toasts.push({ variant: 'error', title: t('studio:saveApp.download.copyFailed', 'The fingerprint could not be copied') }),
                        );
                      }}
                    >
                      <Copy aria-hidden className="size-3.5" />
                      {t('studio:saveApp.saved.copy', 'Copy fingerprint')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!save.downloadable}
                      onClick={() => {
                        void downloadSavedFile(save.id).then(
                          (name) => toasts.push({ variant: 'success', title: t('studio:saveApp.download.done', '{file} downloaded', { file: name }) }),
                          (error: unknown) =>
                            toasts.push({
                              variant: 'error',
                              title: t('studio:saveApp.download.failed', 'The file could not be downloaded'),
                              description: error instanceof Error ? error.message : String(error),
                            }),
                        );
                      }}
                    >
                      <Download aria-hidden className="size-3.5" />
                      {t('studio:saveApp.saved.again', 'Download again')}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={database === null} onClick={() => onSaveNewer(save)}>
                      {t('studio:saveApp.saved.newer', 'Save a newer version')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {/* Whole workspaces saved here, as one file each. */}
        <WorkspaceSavesList />
      </CardBody>
    </Card>
  );
}
