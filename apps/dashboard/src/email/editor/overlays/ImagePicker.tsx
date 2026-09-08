// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Choose an image (comp 198-242, 1273-1292; Appendix A §E4; D9): the
 * workspace's image files as tiles, an Upload tab with the Files page's
 * connection rule (one connection → implicit; several → pick), and a URL
 * row — https only, the renderer's rule. A pick hands back what the image
 * block stores: a library `fileId` (sent by CID) or a `url`.
 */
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { FolderOpen, Image as ImageIcon, Link2, Upload, UploadCloud } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import { Button, Input, Modal, ModalBody, ModalFooter, ModalHeader, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@adminium/ui';

import { bootstrapQuery } from '../../../app/bootstrap.js';
import { uploadFile, type FileDto } from '../../../files/api.js';
import { ALL_FILES_FILTERS, filesConnectionsQuery, filesQuery, formatBytes } from '../../../files/filesQueries.js';
import { t } from '../../../i18n/t.js';
import { formatSince } from '../../../team/teamApi.js';

export type ImagePick = { fileId: string; alt: string } | { url: string; alt: string };

export interface ImagePickerProps {
  onPick: (pick: ImagePick) => void;
  onClose: () => void;
}

/** The comp's alt from a filename (1283): extension off, dashes to spaces. */
export function altFromName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]/g, ' ');
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp';

export function ImagePicker({ onPick, onClose }: ImagePickerProps) {
  const [tab, setTab] = useState<'files' | 'upload'>('files');
  const [url, setUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const bootstrap = useQuery(bootstrapQuery()).data;
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  const list = useInfiniteQuery(filesQuery(ALL_FILES_FILTERS));
  const connections = useQuery(filesConnectionsQuery()).data ?? [];
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const target = connectionId ?? connections[0]?.id ?? null;
  const now = Date.now();

  const images: FileDto[] = (list.data?.pages ?? []).flatMap((page) => page.data).filter((file) => file.mime.startsWith('image/'));

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (target === null) throw new Error(t('email:imagePicker.noConnection', 'Connect a data source before uploading.'));
      return uploadFile({ file, connectionId: target });
    },
    onSuccess: (result, file) => onPick({ fileId: result.data.id, alt: altFromName(file.name) }),
    onError: (error) => setUploadError(error instanceof Error ? error.message : String(error)),
  });

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file === undefined) return;
    setUploadError(null);
    upload.mutate(file);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    take(event.dataTransfer.files);
  };
  const httpsUrl = /^https:\/\/\S+$/i.test(url.trim());

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open && !upload.isPending) onClose();
      }}
    >
      <ModalHeader
        icon={<ImageIcon />}
        title={t('email:imagePicker.title', 'Choose an image')}
        subtitle={t('email:imagePicker.subtitle', 'Pick from your workspace files, upload one, or paste a URL.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        <Tabs variant="pill" value={tab} onValueChange={(value) => setTab(value === 'upload' ? 'upload' : 'files')} className="flex flex-col gap-4">
          <TabsList aria-label={t('email:imagePicker.source', 'Source')} className="w-full">
            <TabsTrigger value="files" className="flex-1">
              <FolderOpen className="size-3.5" aria-hidden="true" />
              {t('email:imagePicker.workspaceFiles', 'Workspace files')}
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1">
              <Upload className="size-3.5" aria-hidden="true" />
              {t('email:imagePicker.upload', 'Upload')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="files">
          {list.isPending ? (
            <div className="flex justify-center py-10">
              <Spinner label={t('common.loading', 'Loading')} />
            </div>
          ) : images.length === 0 ? (
            <p className="py-10 text-center text-body-sm text-fg-muted">{t('email:imagePicker.noImages', 'No images in the library yet — upload one.')}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-3" data-testid="email-image-files">
              {images.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  data-testid="email-image-file"
                  data-file-id={file.id}
                  onClick={() => onPick({ fileId: file.id, alt: altFromName(file.filename) })}
                  className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-start transition-[border-color,box-shadow] hover:border-accent hover:shadow-card"
                >
                  <span className="block h-[118px] bg-surface-2">
                    <img src={file.contentPath} alt={file.filename} className="block size-full object-cover" />
                  </span>
                  <span className="block px-[11px] pb-[11px] pt-[9px]">
                    <span className="block truncate text-[12px] font-extrabold text-fg">{file.filename}</span>
                    <span className="mt-0.5 block text-[10.5px] text-fg-subtle">
                      {formatBytes(file.sizeBytes)} · {formatSince(file.createdAt, localeTag, now)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          </TabsContent>
          <TabsContent value="upload">
          <div className="flex flex-col gap-3">
            {connections.length > 1 ? (
              <label className="flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[.04em] text-fg-subtle">
                {t('email:imagePicker.connection', 'Upload into')}
                <Select
                  aria-label={t('email:imagePicker.connection', 'Upload into')}
                  data-testid="email-image-connection"
                  value={target ?? ''}
                  onChange={(event) => setConnectionId(event.target.value)}
                >
                  {connections.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <div
              data-testid="email-image-dropzone"
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed px-6 py-9 text-center transition-colors',
                dragOver ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-2',
              )}
            >
              <div className="flex size-[52px] items-center justify-center rounded-[15px] bg-accent-soft text-accent">
                <UploadCloud className="size-[25px]" aria-hidden="true" />
              </div>
              <div className="text-[14px] font-extrabold text-fg">{t('email:imagePicker.drop', 'Drop an image here')}</div>
              <div className="text-[12px] text-fg-subtle">{t('email:imagePicker.formats', 'PNG, JPG, GIF or SVG')}</div>
              <input
                ref={input}
                type="file"
                accept={IMAGE_ACCEPT}
                data-testid="email-image-upload"
                aria-label={t('email:imagePicker.browse', 'Browse files')}
                className="sr-only"
                onChange={(event: ChangeEvent<HTMLInputElement>) => take(event.target.files)}
              />
              <Button iconLeft={<FolderOpen />} loading={upload.isPending} onClick={() => input.current?.click()} className="mt-1">
                {t('email:imagePicker.browse', 'Browse files')}
              </Button>
              {uploadError === null ? null : (
                <p role="alert" className="text-body-sm text-danger">
                  {uploadError}
                </p>
              )}
            </div>
          </div>
          </TabsContent>
        </Tabs>
      </ModalBody>
      <ModalFooter className="items-center gap-[9px]">
        <Link2 className="size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
        <Input
          mono
          aria-label={t('email:imagePicker.url', 'Image URL')}
          placeholder={t('email:imagePicker.urlPlaceholder', '…or paste an image URL')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="min-w-0 flex-1"
          data-testid="email-image-url"
        />
        <Button variant="secondary" disabled={!httpsUrl} onClick={() => onPick({ url: url.trim(), alt: '' })} data-testid="email-image-use-url">
          {t('email:imagePicker.useUrl', 'Use URL')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
