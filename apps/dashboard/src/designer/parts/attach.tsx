// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Files with a message: a picture or a CSV, attached by the clip, a paste or
 * a drop. They wait in the page and go up when the message is sent, so Home
 * (where there is no session yet) and the build page work the same way. The
 * server decides what a file is, from its bytes; what is checked here is only
 * what can be said at once: too many, too large, plainly the wrong kind.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Paperclip, X } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { designerApi, type DesignerAttachment } from '../api.js';

export const MAX_FILES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ACCEPT = [...IMAGE_TYPES, '.csv', 'text/csv'].join(',');

export interface PendingFile {
  key: string;
  file: File;
  kind: 'image' | 'csv';
  /** A picture's own address in this page, for its small view. */
  preview: string | null;
  /** Once it went up: where, and the id it was given. A send that failed after that does not send the file again. */
  sent?: { sessionId: string; id: string };
}

const kindOf = (file: File): 'image' | 'csv' | null =>
  IMAGE_TYPES.includes(file.type) ? 'image' : file.type === 'text/csv' || /\.csv$/i.test(file.name) ? 'csv' : null;

export interface AttachState {
  files: PendingFile[];
  /** Why the last file was not taken, in words; null when it was. */
  refused: string | null;
  add(list: Iterable<File>): void;
  remove(key: string): void;
  /** Take off the files that went up with a message that was sent; one added since stays. */
  clear(): void;
  /** Send every waiting file to the session; the ids to give the turn. Throws what the server said of a file it refused. */
  upload(sessionId: string): Promise<string[]>;
  hasImage: boolean;
}

export function useAttach(): AttachState {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const seq = useRef(0);
  const held = useRef<PendingFile[]>([]);
  held.current = files;
  // A picture's page address is given back when the page lets go of it.
  useEffect(
    () => () => {
      for (const entry of held.current) if (entry.preview !== null) URL.revokeObjectURL(entry.preview);
    },
    [],
  );

  const add = useCallback((list: Iterable<File>) => {
    // Worked out from what is held now, outside any state update: a picture's page address is made once.
    const next = [...held.current];
    let why: string | null = null;
    for (const file of list) {
      const kind = kindOf(file);
      if (kind === null) {
        why = t('designer:attach.wrongKind', 'Only a picture (PNG, JPEG, WebP or GIF) or a CSV file can be attached.');
      } else if (next.length >= MAX_FILES) {
        why = t('designer:attach.tooMany', 'Up to {count} files go with one message.', { count: MAX_FILES });
      } else if (kind === 'image' && file.size > MAX_IMAGE_BYTES) {
        why = t('designer:attach.imageTooLarge', 'That picture is over 5 MB. Attach a smaller one.');
      } else if (kind === 'csv' && file.size > MAX_CSV_BYTES) {
        why = t('designer:attach.csvTooLarge', 'That file is over 10 MB. For a file that size, use Import on the table’s own page.');
      } else {
        seq.current += 1;
        next.push({ key: `f${String(seq.current)}`, file, kind, preview: kind === 'image' ? URL.createObjectURL(file) : null });
      }
    }
    held.current = next;
    setFiles(next);
    setRefused(why);
  }, []);

  const remove = useCallback((key: string) => {
    const gone = held.current.find((entry) => entry.key === key);
    if (gone !== undefined && gone.preview !== null) URL.revokeObjectURL(gone.preview);
    held.current = held.current.filter((entry) => entry.key !== key);
    setFiles(held.current);
    setRefused(null);
  }, []);

  const clear = useCallback(() => {
    for (const entry of held.current) if (entry.sent !== undefined && entry.preview !== null) URL.revokeObjectURL(entry.preview);
    held.current = held.current.filter((entry) => entry.sent === undefined);
    setFiles(held.current);
    setRefused(null);
  }, []);

  const upload = useCallback(async (sessionId: string): Promise<string[]> => {
    const ids: string[] = [];
    // The files as they were when the message was sent: one added while they go up waits for the next message.
    for (const entry of [...held.current]) {
      if (entry.sent?.sessionId !== sessionId) entry.sent = { sessionId, id: (await designerApi.uploadAttachment(sessionId, entry.file)).id };
      ids.push(entry.sent.id);
    }
    return ids;
  }, []);

  return useMemo(() => ({ files, refused, add, remove, clear, upload, hasImage: files.some((entry) => entry.kind === 'image') }), [files, refused, add, remove, clear, upload]);
}

/** Whether the picked model reads pictures: asked the first time a picture is attached, and kept. */
export function useReadsImages(picked: { connectionId: string; model: string } | null, asking: boolean): boolean | null {
  const query = useQuery({
    queryKey: ['designer', 'reads-images', picked?.connectionId ?? '', picked?.model ?? ''],
    queryFn: () => designerApi.readsImages(picked?.connectionId ?? '', picked?.model ?? ''),
    enabled: asking && picked !== null,
    staleTime: Infinity,
    retry: false,
  });
  return query.data?.readsImages ?? null;
}

/** Paste and drop for a message box: files go to the list, text is left to the box. */
export function attachHandlers(state: AttachState, disabled = false) {
  return {
    onPaste: (event: ClipboardEvent<HTMLElement>): void => {
      const pasted = [...event.clipboardData.files];
      // A copy from a spreadsheet carries its cells as text and a picture of them: the text is what was meant.
      if (disabled || pasted.length === 0 || event.clipboardData.types.includes('text/plain')) return;
      event.preventDefault();
      state.add(pasted);
    },
    onDragOver: (event: DragEvent<HTMLElement>): void => {
      if (!disabled && event.dataTransfer.types.includes('Files')) event.preventDefault();
    },
    onDrop: (event: DragEvent<HTMLElement>): void => {
      const dropped = [...event.dataTransfer.files];
      if (disabled || dropped.length === 0) return;
      event.preventDefault();
      state.add(dropped);
    },
  };
}

export function AttachButton({ state, disabled = false }: { state: AttachState; disabled?: boolean }): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        data-part="attach-input"
        onChange={(event) => {
          state.add([...(event.target.files ?? [])]);
          // The same file can be picked again after it was taken off.
          event.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label={t('designer:attach.button', 'Attach a picture or a CSV file')}
        title={t('designer:attach.button', 'Attach a picture or a CSV file')}
        className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip aria-hidden="true" className="size-4" />
      </button>
    </>
  );
}

/** The files waiting with the message, and what is to be said about them before it is sent. */
export function AttachTray({ state, modelName, readsImages }: { state: AttachState; modelName: string | null; readsImages: boolean | null }): ReactNode {
  if (state.files.length === 0 && state.refused === null) return null;
  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2.5">
      {state.files.length === 0 ? null : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t('designer:attach.list', 'Attached files')}>
          {state.files.map((entry) => (
            <li key={entry.key} className="flex max-w-[220px] items-center gap-1.5 rounded-[10px] border border-border bg-surface-2 py-1 pe-1 ps-1.5 text-[12px] font-semibold text-fg">
              {entry.preview !== null ? (
                <img src={entry.preview} alt="" className="size-7 shrink-0 rounded-md object-cover" />
              ) : (
                <FileSpreadsheet aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
              )}
              <span dir="auto" className="min-w-0 truncate">
                {entry.file.name === '' ? t('designer:attach.pasted', 'Pasted picture') : entry.file.name}
              </span>
              <button
                type="button"
                onClick={() => state.remove(entry.key)}
                aria-label={t('designer:attach.remove', 'Take {name} off', { name: entry.file.name === '' ? t('designer:attach.pasted', 'Pasted picture') : entry.file.name })}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.refused === null ? null : (
        <p role="alert" className="m-0 text-[12px] leading-normal text-danger">
          {state.refused}
        </p>
      )}
      {state.hasImage && readsImages === false ? (
        <p role="status" className="m-0 text-[12px] leading-normal text-fg-muted">
          {modelName === null
            ? t('designer:attach.noPicturesPlain', 'This model does not read pictures. Describe what matters in it, or pick a model that does.')
            : t('designer:attach.noPictures', '{model} does not read pictures. Describe what matters in it, or pick a model that does.', { model: modelName })}
        </p>
      ) : null}
    </div>
  );
}

/** A sent message's files: a picture small (opening whole in a new tab), a CSV as a chip with its rows. */
export function SentFiles({ sessionId, files }: { sessionId: string; files: readonly Pick<DesignerAttachment, 'id' | 'label' | 'kind' | 'rows'>[] }): ReactNode {
  if (files.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap justify-end gap-1.5 p-0" aria-label={t('designer:attach.list', 'Attached files')}>
      {files.map((file) => {
        const href = designerApi.attachmentUrl(sessionId, file.id);
        return (
          <li key={file.id}>
            {file.kind === 'image' ? (
              <a href={href} target="_blank" rel="noreferrer" aria-label={t('designer:attach.open', 'Open {name} in a new tab', { name: file.label })} className="block overflow-hidden rounded-xl border border-border">
                <img src={href} alt={file.label} loading="lazy" className="block max-h-[120px] max-w-[180px] object-cover" />
              </a>
            ) : (
              <span className="flex items-center gap-1.5 rounded-[10px] border border-border bg-surface-2 px-2 py-1.5 text-[12px] font-semibold text-fg">
                <FileSpreadsheet aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                <span dir="auto" className="max-w-[180px] truncate">
                  {file.label}
                </span>
                {file.rows === undefined ? null : <span className="font-medium text-fg-muted">{t('designer:attach.rows', '{count, plural, one {# row} other {# rows}}', { count: file.rows })}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
