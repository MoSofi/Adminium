// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Files with a message: a picture, a CSV, a font, a Markdown document, or a
 * page or stylesheet of a site template, attached from the Attach menu, a paste or a drop, and a frame imported from
 * Figma. They wait in the page and go up when the message is sent, so Home
 * (where there is no session yet) and the build page work the same way. The
 * server decides what a file is, from its bytes; what is checked here is only
 * what can be said at once: too many, too large, plainly the wrong kind. A
 * Figma import's two files are the server's own: the page holds only their
 * names and the import's id, and the upload names the import.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FileCode, FileSpreadsheet, FileText, FileUp, Frame, Image, Paintbrush, Paperclip, Type, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { designerApi, type DesignerAttachment, type FigmaImport, type FigmaStatus } from '../api.js';

export const MAX_FILES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_FONT_BYTES = 400 * 1024;
const MAX_DOC_BYTES = 200 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_STYLESHEET_BYTES = 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ACCEPT = [...IMAGE_TYPES, '.csv', 'text/csv', '.woff2', 'font/woff2', '.md', '.markdown', 'text/markdown', '.html', '.htm', 'text/html', '.css', 'text/css'].join(',');

export type AttachKind = 'image' | 'csv' | 'font' | 'doc' | 'html' | 'css';

export interface PendingFile {
  key: string;
  file: File;
  kind: AttachKind;
  /** A picture's own address in this page, for its small view. */
  preview: string | null;
  /** Once it went up: where, and the id it was given. A send that failed after that does not send the file again. */
  sent?: { sessionId: string; id: string };
  /** Half of a frame imported from Figma: the server holds its bytes under the import's id. */
  figma?: { importId: string; part: 'picture' | 'outline' };
}

// A Markdown document and a stylesheet are known by their names alone, here and on the server: a browser gives one no type, or a type of its own.
// The server reads a page from how it starts; here its name is enough to say what can be said at once.
export const kindOf = (file: File): AttachKind | null =>
  IMAGE_TYPES.includes(file.type)
    ? 'image'
    : file.type === 'text/csv' || /\.csv$/i.test(file.name)
      ? 'csv'
      : file.type === 'font/woff2' || /\.woff2$/i.test(file.name)
        ? 'font'
        : /\.(md|markdown)$/i.test(file.name)
          ? 'doc'
          : file.type === 'text/html' || /\.html?$/i.test(file.name)
            ? 'html'
            : file.type === 'text/css' || /\.css$/i.test(file.name)
              ? 'css'
              : null;

/** The mark of a file shown without a picture of it. */
function FileMark({ kind }: { kind: AttachKind }): ReactNode {
  const Mark = kind === 'image' ? Image : kind === 'font' ? Type : kind === 'doc' ? FileText : kind === 'html' ? FileCode : kind === 'css' ? Paintbrush : FileSpreadsheet;
  return <Mark aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />;
}

/** What a page or a stylesheet is, said after its name on its chip; nothing for the other kinds. */
function KindWord({ kind }: { kind: AttachKind }): ReactNode {
  if (kind !== 'html' && kind !== 'css') return null;
  return (
    <span className="shrink-0 font-medium text-fg-muted">
      <span aria-hidden="true">· </span>
      {kind === 'html' ? t('designer:attach.page', 'page') : t('designer:attach.stylesheet', 'stylesheet')}
    </span>
  );
}

export interface AttachState {
  files: PendingFile[];
  /** Why the last file was not taken, in words; null when it was. */
  refused: string | null;
  add(list: Iterable<File>): void;
  /** A frame imported from Figma: its picture and its design document, as two files. One already waiting is not added again. */
  addFigma(done: Pick<FigmaImport, 'importId' | 'pictureName' | 'outlineName'>): void;
  remove(key: string): void;
  /** Take off the files that went up with a message that was sent; one added since stays. */
  clear(): void;
  /** Send every waiting file to the session; the ids to give the turn. Throws what the server said of a file it refused. */
  upload(sessionId: string): Promise<string[]>;
  hasImage: boolean;
}

/**
 * A picture's colours, the most first, as `rrggbb:share` with the share in
 * thousandths: what the server reads a look from when the picture shows a
 * design. The picture is drawn small and its colours counted in coarse steps,
 * so a flat page colour comes out as one colour and a photograph as many.
 * Empty when the browser cannot draw the picture: the upload goes without.
 */
export function paletteFromPixels(data: ArrayLike<number>): string {
  // Sixteen steps a channel: near colours fall together; each bin keeps the sum of its pixels, to say its mean.
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let at = 0; at + 3 < data.length; at += 4) {
    const [r, g, b] = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  const total = data.length / 4;
  const all = [...bins.values()].map((bin) => ({ r: bin.r / bin.count, g: bin.g / bin.count, b: bin.b / bin.count, share: bin.count / total })).sort((a, b) => b.share - a.share);
  // What covers the picture, and the strong colours that cover little of it: a button's colour is a few pixels and says the most.
  const strong = all.filter((colour) => {
    const max = Math.max(colour.r, colour.g, colour.b);
    return max >= 60 && (max - Math.min(colour.r, colour.g, colour.b)) / max >= 0.4 && colour.share >= 0.001;
  });
  const picked = [...new Set([...all.slice(0, 10), ...strong.slice(0, 6)])].sort((a, b) => b.share - a.share);
  const hex = (value: number): string => Math.round(value).toString(16).padStart(2, '0');
  return picked.map((colour) => `${hex(colour.r)}${hex(colour.g)}${hex(colour.b)}:${String(Math.max(1, Math.round(colour.share * 1000)))}`).join(',');
}

export async function paletteOf(file: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const width = Math.min(240, bitmap.width);
    const height = Math.max(1, Math.min(960, Math.round((bitmap.height / bitmap.width) * width)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return '';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return paletteFromPixels(context.getImageData(0, 0, width, height).data);
  } catch {
    return '';
  }
}

/**
 * A tall picture, cut for a model to read. A provider shrinks a picture to fit
 * its own longest side (about 1,500 px, and little more than a megapixel), so a
 * whole page in one picture reaches the model a few hundred pixels wide: the
 * words of its headings still read, its layout no longer does. Parts this size
 * arrive as they are.
 */
export const PART_WIDTH = 1120;
export const PART_HEIGHT = 1024;
/** What two neighbours share, so nothing is cut through unseen. */
export const PART_OVERLAP = 48;
export const PARTS_MAX = 8;
/** A picture no taller than this, once it is as wide as a part, goes whole. */
const WHOLE_HEIGHT = 1400;

/**
 * Where to cut: the scale the picture is drawn at, and each part's top and
 * height in the drawn picture. Null when the picture goes whole. A picture too
 * tall for eight parts is drawn smaller until eight hold it.
 */
export function partPlan(width: number, height: number): { scale: number; width: number; parts: { top: number; height: number }[] } | null {
  if (!(width > 0) || !(height > 0)) return null;
  let scale = Math.min(1, PART_WIDTH / width);
  if (height * scale <= WHOLE_HEIGHT) return null;
  const step = PART_HEIGHT - PART_OVERLAP;
  const most = PARTS_MAX * step + PART_OVERLAP;
  if (height * scale > most) scale = most / height;
  const drawn = Math.round(height * scale);
  const count = Math.min(PARTS_MAX, Math.max(2, Math.ceil((drawn - PART_OVERLAP) / step)));
  // The last part ends at the picture's foot, and is as tall as the others.
  const parts = Array.from({ length: count }, (_, index) => ({ top: Math.max(0, Math.min(index * step, drawn - PART_HEIGHT)), height: Math.min(PART_HEIGHT, drawn) }));
  return { scale, width: Math.max(1, Math.round(width * scale)), parts };
}

/** The parts of a tall picture, the top first, as JPEG files; empty when it goes whole, or when the browser cannot draw it. */
export async function partsOf(file: Blob): Promise<Blob[]> {
  try {
    const bitmap = await createImageBitmap(file);
    const plan = partPlan(bitmap.width, bitmap.height);
    if (plan === null) {
      bitmap.close();
      return [];
    }
    const out: Blob[] = [];
    for (const part of plan.parts) {
      const canvas = document.createElement('canvas');
      canvas.width = plan.width;
      canvas.height = part.height;
      const context = canvas.getContext('2d');
      if (context === null) return [];
      // White under it: a picture with a clear background would come out black as a JPEG.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, part.top / plan.scale, bitmap.width, part.height / plan.scale, 0, 0, plan.width, part.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (blob === null) return [];
      out.push(blob);
    }
    bitmap.close();
    return out;
  } catch {
    return [];
  }
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
        why = t('designer:attach.wrongKind', 'Only a picture (PNG, JPEG, WebP or GIF), a CSV file, a font (.woff2), a Markdown file (.md), an HTML or a CSS file, or a site template (.zip) can be attached.');
      } else if (next.length >= MAX_FILES) {
        why = t('designer:attach.tooMany', 'Up to {count} files go with one message.', { count: MAX_FILES });
      } else if (kind === 'image' && file.size > MAX_IMAGE_BYTES) {
        why = t('designer:attach.imageTooLarge', 'That picture is over 5 MB. Attach a smaller one.');
      } else if (kind === 'csv' && file.size > MAX_CSV_BYTES) {
        why = t('designer:attach.csvTooLarge', 'That file is over 10 MB. For a file that size, use Import on the table’s own page.');
      } else if (kind === 'font' && file.size > MAX_FONT_BYTES) {
        why = t('designer:attach.fontTooLarge', 'That font file is over 400 KB. Attach one weight of the font as a .woff2 file.');
      } else if (kind === 'doc' && file.size > MAX_DOC_BYTES) {
        why = t('designer:attach.docTooLarge', 'That document is over 200 KB. Attach a shorter one, or paste the part that matters into the message.');
      } else if (kind === 'html' && file.size > MAX_PAGE_BYTES) {
        why = t('designer:attach.pageTooLarge', '{name} is over 512 KB, larger than a page of a site template is.', { name: file.name });
      } else if (kind === 'css' && file.size > MAX_STYLESHEET_BYTES) {
        why = t('designer:attach.stylesheetTooLarge', '{name} is over 1 MB, larger than a stylesheet of a site template is.', { name: file.name });
      } else {
        seq.current += 1;
        next.push({ key: `f${String(seq.current)}`, file, kind, preview: kind === 'image' ? URL.createObjectURL(file) : null });
      }
    }
    held.current = next;
    setFiles(next);
    setRefused(why);
  }, []);

  const addFigma = useCallback((done: Pick<FigmaImport, 'importId' | 'pictureName' | 'outlineName'>) => {
    const next = [...held.current];
    let why: string | null = null;
    for (const [part, name] of [['picture', done.pictureName], ['outline', done.outlineName]] as const) {
      // The same frame imported twice is one pair of files: the newer import stands in for the older.
      const same = next.findIndex((entry) => entry.figma?.part === part && entry.file.name === name && entry.sent === undefined);
      if (same >= 0) {
        next[same] = { ...(next[same] as PendingFile), figma: { importId: done.importId, part } };
        continue;
      }
      if (next.length >= MAX_FILES) {
        why = t('designer:attach.tooMany', 'Up to {count} files go with one message.', { count: MAX_FILES });
        continue;
      }
      seq.current += 1;
      next.push({ key: `f${String(seq.current)}`, file: new File([], name), kind: part === 'picture' ? 'image' : 'doc', preview: null, figma: { importId: done.importId, part } });
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
      if (entry.sent?.sessionId !== sessionId && entry.figma !== undefined) {
        entry.sent = { sessionId, id: (await designerApi.uploadFigma(sessionId, entry.figma.importId, entry.figma.part)).id };
      } else if (entry.sent?.sessionId !== sessionId) {
        entry.sent = { sessionId, id: (await designerApi.uploadAttachment(sessionId, entry.file, entry.kind === 'image' ? await paletteOf(entry.file) : '')).id };
        if (entry.kind === 'image') {
          // A tall picture goes up again as parts a model reads. One that fails is no reason to stop: without all of them the server sends the picture whole, as before.
          const parts = await partsOf(entry.file);
          try {
            for (const [index, part] of parts.entries()) await designerApi.uploadAttachment(sessionId, part, '', { of: entry.sent.id, part: index + 1, parts: parts.length });
          } catch {
            // The picture itself is attached.
          }
        }
      }
      if (entry.sent !== undefined) ids.push(entry.sent.id);
    }
    return ids;
  }, []);

  return useMemo(() => ({ files, refused, add, addFigma, remove, clear, upload, hasImage: files.some((entry) => entry.kind === 'image') }), [files, refused, add, addFigma, remove, clear, upload]);
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

/**
 * The Attach menu: the clip opens a menu of the ways in, and a drop or a paste on
 * the box still attaches at once. "From Figma…" opens its dialog; with network features off it
 * stays in the menu, unavailable, and says why.
 */
export function AttachMenu({
  state,
  disabled = false,
  figma,
  onFigma,
  place = 'home',
}: {
  state: AttachState;
  disabled?: boolean;
  /** The person's Figma connection; undefined while it is asked, or where this person cannot use it. */
  figma: FigmaStatus | undefined;
  onFigma: () => void;
  /** Home opens the menu downward; the chat's composer, at the foot of its column, opens it upward. */
  place?: 'home' | 'chat';
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const figmaOff = figma?.network === false;
  const item = 'items-start gap-2.5 rounded-[6px] [&_svg]:size-4 data-[disabled]:opacity-100 ' + (place === 'chat' ? 'px-2 py-[7px]' : 'px-2.5 py-[13px]');
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
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={t('designer:attach.menu', 'Attach')}
          title={t('designer:attach.menu', 'Attach')}
          data-part="attach-menu"
          className={`flex shrink-0 items-center gap-0.5 rounded-[10px] border border-transparent px-[5px] text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-border-strong data-[state=open]:bg-surface-3 data-[state=open]:text-fg ${place === 'chat' ? 'h-[30px]' : 'h-[34px]'}`}
        >
          <Paperclip aria-hidden="true" className={place === 'chat' ? 'size-[15px]' : 'size-4'} />
          <ChevronDown aria-hidden="true" className="size-3 text-fg-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={place === 'chat' ? 'top' : 'bottom'}
          align="start"
          aria-label={t('designer:attach.menu', 'Attach')}
          className="w-[310px] max-w-[calc(100vw-32px)] rounded-[14px] p-[5px]"
        >
          <DropdownMenuItem className={item} icon={<FileUp />} onSelect={() => input.current?.click()}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-bold leading-[1.45] text-fg">{t('designer:attach.files', 'Files from your computer…')}</span>
              <span className="whitespace-normal text-[11.5px] font-medium leading-[1.45] text-fg-muted">
                {t('designer:attach.filesHelp', 'A picture, a CSV, font or Markdown file, an HTML or CSS file, or a site template (.zip)')}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem className={`${item} data-[disabled]:[&_svg]:text-fg-subtle`} icon={<Frame />} disabled={figmaOff} onSelect={onFigma} data-part="attach-figma">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={`text-[13px] font-bold leading-[1.45] ${figmaOff ? 'text-fg-subtle' : 'text-fg'}`}>{t('designer:attach.fromFigma', 'From Figma…')}</span>
              {figmaOff ? (
                <span className="whitespace-normal text-[11.5px] font-medium leading-[1.45] text-fg-muted">{t('designer:figma.off', 'Figma is off on this server: network features are turned off.')}</span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
                <FileMark kind={entry.kind} />
              )}
              <span dir="auto" className="min-w-0 truncate">
                {entry.file.name === '' ? t('designer:attach.pasted', 'Pasted picture') : entry.file.name}
              </span>
              <KindWord kind={entry.kind} />
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

/** A sent message's files: a picture small (opening whole in a new tab), a CSV as a chip with its rows, a font, a document, a page or a stylesheet as a chip with its name. */
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
                <FileMark kind={file.kind} />
                <span dir="auto" className="max-w-[180px] truncate">
                  {file.label}
                </span>
                {file.rows === undefined ? null : <span className="font-medium text-fg-muted">{t('designer:attach.rows', '{count, plural, one {# row} other {# rows}}', { count: file.rows })}</span>}
                <KindWord kind={file.kind} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
