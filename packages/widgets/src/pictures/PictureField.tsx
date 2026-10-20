// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE column's field: the picture, and three buttons that say what they
 * do, "Upload" · "Choose existing…" · "Remove".
 *
 * "Choose existing…" opens the picker on the pictures this table's records
 * already show and, for someone who can open the Files page, on that page's
 * own uploads. Choosing never points the record at somebody else's file: the
 * host makes the record its own copy (`PictureChooser.copy`), and that copy is
 * what the field holds. Nothing is kept until Save, which the field says.
 *
 * Every state the server can name is said in words: a picture no longer
 * there, a link to another site the dashboard cannot draw, one too large, a
 * table the person may not change. The frame's reader name follows the state
 * rather than announcing "No picture yet" over all of them.
 *
 * The transport is the host's, as for every file field: without an upload
 * adapter this is never drawn (`FileField` falls back to a text box), and
 * without a chooser "Choose existing…" is not drawn.
 */
import { useMaybeI18n, useMaybeT } from '../lib/i18n.js';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@adminium/ui';
import { Ban, CircleAlert, Clock, Image as ImageIcon, ImageOff, ImageUp, Images, Link as LinkIcon, Plus, Replace, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';

import type { GridColumnSpec } from '../families/tables/column-spec.js';
import type { ResolvedFile } from '../families/tables/cells.js';
import { formatRefList, parseRefList } from '../page-config/file-refs.js';
import { PICTURE_KIND_MIMES, PICTURE_KIND_NAMES, PICTURE_KINDS, isPictureKind, pictureKindOf, type PictureKind } from '../page-config/picture-kinds.js';
import type { FileFieldUpload } from '../templates/page-crud/file-upload.js';
import { formatBytes, PicturePicker, typeOf, type PickerItem, type PickerOutcome, type PickerSource } from './PicturePicker.js';

/**
 * What a host offers for choosing a picture the workspace already has. No
 * fetch here: the host lists and copies.
 */
export interface PictureChooser {
  /** What the page is called (else its table's label): the tab "Used in {page}". */
  pageTitle: string;
  /** The table's label, for a refusal: "You can't change {table}, so you can't add a picture to it." */
  tableLabel: string;
  /** The pictures this table's records hold in a column, each one the person may read. */
  usedIn: (input: { column: string; q: string; signal: AbortSignal }) => Promise<readonly PickerItem[]>;
  /** The Files page's own uploads: present only for someone who can open the Files page. */
  library?: ((input: { q: string; signal: AbortSignal }) => Promise<readonly PickerItem[]>) | undefined;
  /** The record's own copy of a picture, made for a column: the value to store, and the new file. */
  copy: (input: { fileId: string; column: string }) => Promise<{ ref: string; file: ResolvedFile }>;
}

/** Why a copy was refused, by what the field says about it. */
export class PictureCopyRefused extends Error {
  override readonly name = 'PictureCopyRefused';
  constructor(
    readonly reason: 'gone' | 'forbidden' | 'type' | 'size',
    message?: string,
    /** The column's limit, for a picture too large for it. */
    readonly limit?: number,
  ) {
    super(message ?? reason);
  }
}

export interface PictureFieldProps {
  column: GridColumnSpec;
  value: unknown;
  onChange: (next: string | null) => void;
  upload: FileFieldUpload;
  choose?: PictureChooser | undefined;
  /** What the value names, when the host resolved it: null for a value it could not read, undefined while it has not said. */
  resolved?: ResolvedFile | null | undefined;
  resolvedByRef?: ReadonlyMap<string, ResolvedFile | null> | undefined;
  maxBytes?: number | undefined;
  inputId?: string | undefined;
}

type Notice =
  | { kind: 'saved' }
  | { kind: 'large'; limit: number }
  | { kind: 'refused' }
  | { kind: 'type'; type: string }
  | { kind: 'failed'; message: string };

/** An Adminium file's own reference (its id, or its content link on any origin), as against a link elsewhere. */
function isOurs(ref: string): boolean {
  return /^file_[0-9A-HJKMNP-TV-Z]{26}$/.test(ref) || /\/api\/v1\/files\/file_[0-9A-HJKMNP-TV-Z]{26}\/content\/?(?:[?#].*)?$/.test(ref) || (!/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('/') && ref.includes('/'));
}

function hostOf(ref: string): string {
  try {
    return new URL(ref).host;
  } catch {
    return ref;
  }
}

/** The kinds this column takes, in order: those of its block that are pictures, else all four. */
function kindsOf(column: GridColumnSpec): PictureKind[] {
  const accept = (column.file?.accept ?? []).filter(isPictureKind);
  return accept.length === 0 ? [...PICTURE_KINDS] : PICTURE_KINDS.filter((kind) => accept.includes(kind));
}

export function PictureField(props: PictureFieldProps): ReactNode {
  // The column's own limit when the host names none: the field refuses before a byte is sent, as the server would.
  const maxBytes = props.maxBytes ?? props.column.file?.maxBytes;
  const given = { ...props, ...(maxBytes === undefined ? {} : { maxBytes }) };
  return props.column.file?.multiple === true ? <PictureListField {...given} /> : <PictureOneField {...given} />;
}

/** The words, sizes and the picker every picture field shares. */
function usePictureWords(column: GridColumnSpec, maxBytes: number | undefined) {
  const t = useMaybeT();
  const i18n = useMaybeI18n();
  const kinds = kindsOf(column);
  const names = useMemo(() => {
    // All four, as the column's words say them; a narrower column lists its own, in the reader's language.
    if (kinds.length === PICTURE_KINDS.length) return t('ui:templates.crud.picture.allKinds', 'PNG, JPEG, WebP or GIF');
    const list = kinds.map((kind) => PICTURE_KIND_NAMES[kind]);
    try {
      return new Intl.ListFormat(i18n?.locale ?? 'en-US', { type: 'disjunction' }).format(list);
    } catch {
      return list.join(', ');
    }
  }, [kinds, i18n?.locale, t]);
  const size = maxBytes === undefined ? null : formatBytes(maxBytes);
  const mimes = new Set(kinds.map((kind) => PICTURE_KIND_MIMES[kind]));
  return {
    t,
    mimes,
    accept: [...mimes].join(','),
    hint:
      size === null
        ? t('ui:templates.crud.picture.kinds', '{kinds}.', { kinds: names })
        : t('ui:templates.crud.picture.hint', '{kinds}, up to {size}.', { kinds: names, size }),
    listHint: (count: number): string =>
      size === null
        ? t('ui:templates.crud.picture.listKinds', '{count, plural, one {Up to # picture.} other {Up to # pictures.}} {kinds}.', { count, kinds: names })
        : t('ui:templates.crud.picture.listHint', '{count, plural, one {Up to # picture.} other {Up to # pictures.}} {kinds}, up to {size} each.', { count, kinds: names, size }),
    takes: (item: PickerItem): boolean => mimes.has(item.mime) && pictureKindOf(item.mime) !== null,
    refusal: (item: PickerItem): string => t('ui:templates.crud.picture.noType', "This column doesn't take {type} files.", { type: typeOf(item.mime) }),
  };
}

/** The picker's tabs for a chooser: this table's pictures, then the Files page's for those who can open it. */
function sourcesOf(choose: PictureChooser, column: GridColumnSpec, t: ReturnType<typeof useMaybeT>, uploadHere: () => void): PickerSource[] {
  const out: PickerSource[] = [
    {
      key: 'used',
      label: t('ui:templates.crud.picker.usedIn', 'Used in {page}', { page: choose.pageTitle }),
      caption: 'record',
      empty: t('ui:templates.crud.picker.emptyUsed', 'No other {page} record has a picture yet.', { page: choose.pageTitle }),
      list: ({ q, signal }) => choose.usedIn({ column: column.name, q, signal }),
    },
  ];
  if (choose.library !== undefined) {
    const library = choose.library;
    out.push({
      key: 'files',
      label: t('ui:templates.crud.picker.filesPage', 'From the Files page'),
      caption: 'file',
      empty: t('ui:templates.crud.picker.emptyFiles', 'No pictures on the Files page yet. Upload one here, or on the Files page.'),
      emptyAction: { label: t('ui:templates.crud.file.choose', 'Upload'), onClick: uploadHere },
      list: library,
    });
  }
  return out;
}

/** Copies the chosen pictures for the record; says which were gone, and why the rest could not be. */
async function copyAll(
  choose: PictureChooser,
  column: string,
  items: readonly PickerItem[],
): Promise<{ made: { ref: string; file: ResolvedFile }[]; gone: string[]; refusal: Notice | null }> {
  const made: { ref: string; file: ResolvedFile }[] = [];
  const gone: string[] = [];
  for (const item of items) {
    try {
      made.push(await choose.copy({ fileId: item.id, column }));
    } catch (error) {
      if (error instanceof PictureCopyRefused) {
        if (error.reason === 'gone') {
          gone.push(item.id);
          continue;
        }
        const refusal: Notice =
          error.reason === 'forbidden'
            ? { kind: 'refused' }
            : error.reason === 'type'
              ? { kind: 'type', type: typeOf(item.mime) }
              : error.limit !== undefined
                ? { kind: 'large', limit: error.limit }
                : { kind: 'failed', message: error.message };
        return { made, gone, refusal };
      }
      return { made, gone, refusal: { kind: 'failed', message: error instanceof Error ? error.message : String(error) } };
    }
  }
  return { made, gone, refusal: null };
}

function NoticeLine({ notice, column, maxBytes, tableLabel }: { notice: Notice; column: GridColumnSpec; maxBytes: number | undefined; tableLabel: string | undefined }): ReactNode {
  const t = useMaybeT();
  if (notice.kind === 'saved') {
    return (
      <p role="status" data-part="picture-saved" className="m-0 flex gap-1.5 text-body-sm text-fg-muted">
        <Clock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {t('ui:templates.crud.picture.saved', 'Saved with the record.')}
      </p>
    );
  }
  const text =
    notice.kind === 'large'
      ? t('ui:templates.crud.picture.tooLarge', "That picture is larger than this column's {limit} limit.", { limit: formatBytes(notice.limit) })
      : notice.kind === 'refused'
        ? t('ui:templates.crud.picture.refused', "You can't change {table}, so you can't add a picture to it.", { table: tableLabel ?? column.label })
        : notice.kind === 'type'
          ? t('ui:templates.crud.picture.noType', "This column doesn't take {type} files.", { type: notice.type })
          : notice.message;
  void maxBytes;
  return (
    <p role="alert" data-part="picture-error" className="m-0 flex gap-1.5 text-body-sm font-semibold text-danger">
      {notice.kind === 'refused' ? <Ban aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
      <span>{text}</span>
    </p>
  );
}

const buttonClass = 'h-[34px] max-sm:h-11';

function PictureOneField({ column, value, onChange, upload, choose, resolved, maxBytes, inputId }: PictureFieldProps): ReactNode {
  const words = usePictureWords(column, maxBytes);
  const { t } = words;
  const current = value === null || value === undefined ? '' : String(value).trim();
  const [uploading, setUploading] = useState<{ name: string; size: number; fraction: number; abort: AbortController } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** What this field put in the value in this session: drawn at once, without waiting for the host's next read. */
  const [mine, setMine] = useState<{ ref: string; file: ResolvedFile } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);

  const shown = mine !== null && mine.ref === current ? mine.file : (resolved ?? null);
  const drawable = current !== '' && shown !== null && shown.mime.startsWith('image/') && broken !== current;
  const ours = current !== '' && isOurs(current);
  // A reference the host could not read (or a picture that did not load): gone. A link elsewhere: said as a link.
  const state: 'empty' | 'picture' | 'gone' | 'link' | 'pending' =
    current === '' ? 'empty' : drawable ? 'picture' : !ours ? 'link' : resolved === undefined && mine?.ref !== current ? 'pending' : 'gone';

  async function start(file: File): Promise<void> {
    setNotice(null);
    if (maxBytes !== undefined && file.size > maxBytes) {
      setNotice({ kind: 'large', limit: maxBytes });
      return;
    }
    const abort = new AbortController();
    setUploading({ name: file.name, size: file.size, fraction: 0, abort });
    try {
      const result = await upload({
        file,
        column: column.name,
        signal: abort.signal,
        onProgress: (fraction) => setUploading((was) => (was === null ? was : { ...was, fraction })),
      });
      setMine(result);
      setBroken(null);
      onChange(result.ref);
      setNotice({ kind: 'saved' });
    } catch (error) {
      if (!abort.signal.aborted) setNotice({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setUploading(null);
    }
  }

  const onChoose = async (items: readonly PickerItem[]): Promise<PickerOutcome> => {
    if (choose === undefined) return 'done';
    setNotice(null);
    const { made, gone, refusal } = await copyAll(choose, column.name, items.slice(0, 1));
    const first = made[0];
    if (first !== undefined) {
      setMine(first);
      setBroken(null);
      onChange(first.ref);
      setNotice({ kind: 'saved' });
      return 'done';
    }
    if (gone.length > 0) return { gone };
    if (refusal !== null) setNotice(refusal);
    return 'done';
  };

  const sources = choose === undefined ? [] : sourcesOf(choose, column, t, () => {
    setPicking(false);
    picker.current?.click();
  });
  const chooseButton =
    sources.length === 0 ? null : (
      <Button ref={opener} type="button" variant="secondary" className={buttonClass} iconLeft={<Images aria-hidden />} onClick={() => setPicking(true)} data-part="picture-choose">
        {t('ui:templates.crud.picture.choose', 'Choose existing…')}
      </Button>
    );
  const uploadBtn = (
    <Button ref={uploadButton} type="button" variant="secondary" className={buttonClass} iconLeft={<Upload aria-hidden />} onClick={() => picker.current?.click()} data-part="picture-upload">
      {t('ui:templates.crud.file.choose', 'Upload')}
    </Button>
  );
  const removeBtn = (
    <Button
      type="button"
      variant="secondary"
      className={`${buttonClass} text-danger`}
      iconLeft={<Trash2 aria-hidden />}
      aria-label={t('ui:templates.crud.picture.removeFrom', 'Remove the picture from {column}', { column: column.label })}
      onClick={() => {
        setMine(null);
        setNotice(null);
        onChange(null);
        window.setTimeout(() => uploadButton.current?.focus(), 0);
      }}
      data-part="picture-remove"
    >
      {t('ui:templates.crud.picture.remove', 'Remove')}
    </Button>
  );

  const frameLabel =
    uploading !== null
      ? t('ui:templates.crud.file.uploading', 'Uploading')
      : state === 'gone'
        ? t('ui:templates.crud.picture.gone', 'This picture is no longer available.')
        : state === 'link'
          ? t('ui:templates.crud.picture.link', 'A picture on another site. This dashboard does not show pictures from {host}.', { host: hostOf(current) })
          : t('ui:templates.crud.picture.empty', 'No picture yet');
  const FrameIcon = uploading !== null ? ImageUp : state === 'gone' ? ImageOff : state === 'link' ? LinkIcon : ImageIcon;

  return (
    <div data-part="picture-field" className="flex flex-wrap items-start gap-4">
      <input
        ref={picker}
        id={inputId}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('ui:templates.crud.file.choose', 'Upload')}
        accept={words.accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void start(file);
        }}
      />
      {state === 'picture' && uploading === null ? (
        <img
          src={shown!.contentPath}
          alt=""
          onError={() => setBroken(current)}
          className="block size-24 shrink-0 rounded-md border border-border object-cover"
          data-part="picture-thumb"
        />
      ) : (
        <div role="img" aria-label={frameLabel} data-part="picture-frame" className="flex size-24 shrink-0 items-center justify-center rounded-md border-[1.5px] border-dashed border-border-strong bg-surface-2 text-fg-subtle">
          <FrameIcon aria-hidden className="size-[22px]" />
        </div>
      )}
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
        {uploading !== null ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="break-all font-mono text-body-sm font-semibold">{uploading.name}</span>
              <span className="font-mono text-caption text-fg-subtle">{formatBytes(uploading.size)}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-body-sm font-semibold">
                <span>{t('ui:templates.crud.file.uploading', 'Uploading')}</span>
                <span className="font-mono text-caption text-fg-muted">{`${String(Math.round(uploading.fraction * 100))}%`}</span>
              </div>
              <div
                role="progressbar"
                aria-label={t('ui:templates.crud.file.uploading', 'Uploading')}
                aria-valuenow={Math.round(uploading.fraction * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-surface-3"
              >
                <div className="h-full w-[var(--adm-progress)] rounded-full bg-accent transition-[width]" style={{ '--adm-progress': `${String(Math.round(uploading.fraction * 100))}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className={buttonClass} iconLeft={<X aria-hidden />} onClick={() => uploading.abort.abort()}>
                {t('ui:templates.crud.file.cancel', 'Cancel upload')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {state === 'picture' ? (
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="break-all font-mono text-body-sm font-semibold">{shown!.filename}</span>
                <span className="font-mono text-caption text-fg-subtle">{formatBytes(shown!.sizeBytes)}</span>
              </div>
            ) : null}
            {state === 'link' ? <div className="break-all font-mono text-xs">{current}</div> : null}
            {state === 'gone' ? (
              <p role="status" className="m-0 flex gap-1.5 text-body-sm text-fg-muted">
                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {t('ui:templates.crud.picture.gone', 'This picture is no longer available.')}
              </p>
            ) : null}
            {state === 'link' ? (
              <p role="status" className="m-0 flex gap-1.5 text-body-sm text-fg-muted">
                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {t('ui:templates.crud.picture.link', 'A picture on another site. This dashboard does not show pictures from {host}.', { host: hostOf(current) })}
              </p>
            ) : null}
            {notice === null ? null : <NoticeLine notice={notice} column={column} maxBytes={maxBytes} tableLabel={choose?.tableLabel} />}
            <div className="flex flex-wrap gap-2">
              {state === 'link' ? (
                <>
                  {chooseButton === null ? uploadBtn : (
                    <Button ref={opener} type="button" variant="secondary" className={buttonClass} iconLeft={<Replace aria-hidden />} onClick={() => setPicking(true)}>
                      {t('ui:templates.crud.file.replace', 'Replace')}
                    </Button>
                  )}
                  {removeBtn}
                </>
              ) : (
                <>
                  {uploadBtn}
                  {chooseButton}
                  {state === 'picture' ? removeBtn : null}
                </>
              )}
            </div>
            {state === 'link' ? null : <p className="m-0 text-caption text-fg-muted">{words.hint}</p>}
          </>
        )}
      </div>
      {sources.length === 0 ? null : (
        <PicturePicker
          open={picking}
          onOpenChange={setPicking}
          title={t('ui:templates.crud.picker.title', 'Choose a picture')}
          subtitle={t('ui:templates.crud.picker.for', 'For {column}', { column: column.label })}
          sources={sources}
          takes={words.takes}
          refusal={words.refusal}
          room={1}
          multiple={false}
          footnote={t('ui:templates.crud.picker.copy', 'The record gets its own copy.')}
          onChoose={onChoose}
          returnFocus={() => opener.current?.focus()}
        />
      )}
    </div>
  );
}

function PictureListField({ column, value, onChange, upload, choose, resolvedByRef, maxBytes, inputId }: PictureFieldProps): ReactNode {
  const words = usePictureWords(column, maxBytes);
  const { t } = words;
  const refs = useMemo(() => parseRefList(value), [value]);
  const maxCount = column.file?.maxCount;
  const full = maxCount !== undefined && refs.length >= maxCount;
  const [minted, setMinted] = useState<ReadonlyMap<string, ResolvedFile>>(() => new Map());
  const [uploads, setUploads] = useState<readonly { name: string; fraction: number; abort: AbortController }[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const capId = `${inputId ?? column.name}-cap`;

  async function addFiles(chosen: readonly File[]): Promise<void> {
    setNotice(null);
    const room = maxCount === undefined ? chosen.length : Math.max(0, maxCount - refs.length);
    const added: string[] = [];
    for (const file of chosen.slice(0, room)) {
      if (maxBytes !== undefined && file.size > maxBytes) {
        setNotice({ kind: 'large', limit: maxBytes });
        continue;
      }
      const abort = new AbortController();
      const row = { name: file.name, fraction: 0, abort };
      setUploads((current) => [...current, row]);
      try {
        const result = await upload({ file, column: column.name, signal: abort.signal, onProgress: (fraction) => setUploads((current) => current.map((r) => (r.abort === abort ? { ...r, fraction } : r))) });
        added.push(result.ref);
        setMinted((current) => new Map(current).set(result.ref, result.file));
      } catch (error) {
        if (!abort.signal.aborted) setNotice({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      } finally {
        setUploads((current) => current.filter((r) => r.abort !== abort));
      }
    }
    if (added.length > 0) onChange(formatRefList([...refs, ...added]));
  }

  const onChoose = async (items: readonly PickerItem[]): Promise<PickerOutcome> => {
    if (choose === undefined) return 'done';
    setNotice(null);
    const { made, gone, refusal } = await copyAll(choose, column.name, items);
    if (made.length > 0) {
      setMinted((current) => {
        const next = new Map(current);
        for (const one of made) next.set(one.ref, one.file);
        return next;
      });
      onChange(formatRefList([...refs, ...made.map((one) => one.ref)]));
    }
    if (gone.length > 0 && made.length === 0 && refusal === null) return { gone };
    if (refusal !== null) setNotice(refusal);
    return 'done';
  };

  const sources = choose === undefined ? [] : sourcesOf(choose, column, t, () => {
    setPicking(false);
    picker.current?.click();
  });

  return (
    <div data-part="picture-list-field" className="flex flex-col gap-2">
      <input
        ref={picker}
        id={inputId}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label={t('ui:templates.crud.file.choose', 'Upload')}
        accept={words.accept}
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = '';
          if (chosen.length > 0) void addFiles(chosen);
        }}
      />
      <ul aria-label={column.label} className="m-0 flex list-none flex-wrap gap-2.5 p-0">
        {refs.map((ref, index) => {
          const file = minted.get(ref) ?? resolvedByRef?.get(ref) ?? null;
          const name = file?.filename ?? ref;
          return (
            <li key={`${ref}-${String(index)}`} className="relative size-20">
              {file !== null && file.mime.startsWith('image/') ? (
                <img src={file.contentPath} alt="" className="block size-full rounded-md border border-border object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center rounded-md border-[1.5px] border-dashed border-border-strong bg-surface-2 text-fg-subtle">
                  <ImageOff aria-hidden className="size-5" />
                </span>
              )}
              <button
                type="button"
                aria-label={t('ui:templates.crud.picture.removeNamed', 'Remove {file} from {column}', { file: name, column: column.label })}
                onClick={() => onChange(formatRefList(refs.filter((_, i) => i !== index)))}
                className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-sm bg-black/80 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <X aria-hidden className="size-[13px]" />
              </button>
            </li>
          );
        })}
        {uploads.map((row) => (
          <li key={row.name} className="flex size-20 flex-col items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-border-strong bg-surface-2 px-2">
            <ImageUp aria-hidden className="size-5 text-fg-subtle" />
            <div role="progressbar" aria-label={t('ui:templates.crud.file.uploading', 'Uploading')} aria-valuenow={Math.round(row.fraction * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="h-full w-[var(--adm-progress)] bg-accent" style={{ '--adm-progress': `${String(Math.round(row.fraction * 100))}%` }} />
            </div>
          </li>
        ))}
        <li>
          {sources.length === 0 ? (
            <AddTile ref={addButton} full={full} capId={capId} onClick={() => picker.current?.click()} label={t('ui:templates.crud.picture.add', 'Add')} />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                asChild
                // At the most the record takes the tile stays focusable and says why; it opens nothing.
                onPointerDown={(event) => {
                  if (full) event.preventDefault();
                }}
                onKeyDown={(event) => {
                  if (full && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown')) event.preventDefault();
                }}
              >
                <AddTile ref={addButton} full={full} capId={capId} label={t('ui:templates.crud.picture.add', 'Add')} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[210px]">
                <DropdownMenuItem icon={<Upload className="size-[15px]" />} onSelect={() => picker.current?.click()}>
                  {t('ui:templates.crud.file.choose', 'Upload')}
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Images className="size-[15px]" />} onSelect={() => setPicking(true)}>
                  {t('ui:templates.crud.picture.choose', 'Choose existing…')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </li>
      </ul>
      <p className="m-0 text-caption text-fg-muted">{maxCount === undefined ? words.hint : words.listHint(maxCount)}</p>
      <div aria-live="polite">
        {full ? (
          <p id={capId} data-part="picture-list-full" className="m-0 flex gap-1.5 text-body-sm text-fg-muted">
            {t('ui:templates.crud.file.capReached', 'This record accepts at most {count, plural, one {# file} other {# files}}.', { count: maxCount })}
          </p>
        ) : null}
      </div>
      {notice === null || notice.kind === 'saved' ? null : <NoticeLine notice={notice} column={column} maxBytes={maxBytes} tableLabel={choose?.tableLabel} />}
      {sources.length === 0 ? null : (
        <PicturePicker
          open={picking}
          onOpenChange={setPicking}
          title={t('ui:templates.crud.picker.title', 'Choose a picture')}
          subtitle={t('ui:templates.crud.picker.for', 'For {column}', { column: column.label })}
          sources={sources}
          takes={words.takes}
          refusal={words.refusal}
          room={maxCount === undefined ? 20 : Math.max(0, maxCount - refs.length)}
          multiple
          footnote={t('ui:templates.crud.picker.copy', 'The record gets its own copy.')}
          onChoose={onChoose}
          returnFocus={() => addButton.current?.focus()}
        />
      )}
    </div>
  );
}

/** The dashed tile that adds pictures: unavailable, and saying why, at the most the record takes (still reachable by keyboard). */
function AddTile({ full, capId, label, onClick, ref, ...rest }: { full: boolean; capId: string; label: string; ref?: Ref<HTMLButtonElement> | undefined } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>): ReactNode {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-disabled={full ? true : undefined}
      aria-describedby={full ? capId : undefined}
      onClick={(event) => {
        if (full) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      data-part="picture-add"
      className={`flex size-20 flex-col items-center justify-center gap-1 rounded-md border-[1.5px] border-dashed border-border-strong bg-surface-2 text-body-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${full ? 'cursor-not-allowed text-fg-subtle opacity-60' : 'cursor-pointer text-fg'}`}
    >
      <Plus aria-hidden className="size-4" />
      {label}
    </button>
  );
}
