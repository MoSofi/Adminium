// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE PICTURE PICKER, MANY SOURCES. A dialog of pictures in tabs, each tab a
 * source the host lists for it: no fetch of its own, so the dashboard's CRUD
 * field and the Designer's picture dialog draw the same grid, keys and states
 * over their own lists.
 *
 * THE KEYBOARD MODEL IS THE SAME FOR EVERY HOST; a host may hide a tab, never
 * change what a key does:
 *  - the grid is a `listbox` with one tab stop and a roving focus; the arrows
 *    move (the sideways ones flip right to left), Up and Down by a row, Home
 *    and End to the ends;
 *  - one picture (`room` 1): Enter or a click chooses it, and the dialog
 *    closes;
 *  - several: Space, Enter or a click ticks a picture; the footer says how
 *    many more can be added, counting what the record already holds, and at
 *    the most the unticked tiles are unavailable, with a polite line saying so.
 *
 * A tile of a kind the host's column does not take is shown, dimmed, with the
 * reason under it: the person sees why it cannot be chosen rather than
 * wondering where it went. Every tile's picture is `alt=""`: the tile's own
 * name says whose picture it is.
 *
 * Choosing hands the pictures to the host and waits. The host makes each one
 * the record's own copy; a picture that went in the meantime comes back as
 * gone, its tile is dropped, and the dialog stays open and says so.
 */
import { useMaybeT } from '../lib/i18n.js';
import { Button, Modal, ModalFooter, ModalHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';
import { Check, FileText, FolderOpen, Image as ImageIcon, Images, RotateCw, Search, SearchX, TriangleAlert, Upload } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

/** One picture a source offers. */
export interface PickerItem {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  /** Same-origin path to its bytes. */
  contentPath: string;
  /** What the record holding it is called, as the person's own grid names it. */
  recordLabel?: string | undefined;
}

/** A tab of the picker: a list the host fetches. */
export interface PickerSource {
  key: string;
  label: string;
  /** How a tile names its picture: by the record it is on, or by its file's own name and size. */
  caption: 'record' | 'file';
  /** What the tab says when it holds nothing. */
  empty: string;
  /** A button under that line, when the tab offers one ("Upload"). */
  emptyAction?: { label: string; onClick: () => void } | undefined;
  /** The pictures whose file name holds `q` (every one, for ''). */
  list(input: { q: string; signal: AbortSignal }): Promise<readonly PickerItem[]>;
}

/** What the host made of a choice: taken, or some of the pictures were gone by then. */
export type PickerOutcome = 'done' | { gone: readonly string[] };

export interface PicturePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string | undefined;
  sources: readonly PickerSource[];
  /** Whether the host's column takes this picture's kind; a tile it does not is dimmed with `refusal`. */
  takes: (item: PickerItem) => boolean;
  /** Why such a tile cannot be chosen ("This column doesn't take PDF files."). */
  refusal: (item: PickerItem) => string;
  /** How many may be chosen now. 1 with `multiple` off chooses at once. */
  room: number;
  multiple: boolean;
  /** Under the grid, muted: what choosing does ("The record gets its own copy."). */
  footnote?: string | undefined;
  onChoose: (items: readonly PickerItem[]) => Promise<PickerOutcome>;
  /** Where focus goes when the dialog closes: the button that opened it. */
  returnFocus?: (() => void) | undefined;
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; items: readonly PickerItem[] };

/** Under 640px the dialog is the whole screen and a row holds three pictures. */
const PHONE = '(max-width: 639px)';

function usePhone(): boolean {
  const query = typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(PHONE);
  const [phone, setPhone] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return undefined;
    const changed = (): void => setPhone(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, [query]);
  return phone;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1).replace(/\.0$/, '') : String(Math.round(size))} ${units[unit] ?? 'TB'}`;
}

/** How long a search waits for the typing to stop. */
const SEARCH_DEBOUNCE_MS = 250;

export function PicturePicker(props: PicturePickerProps): ReactNode {
  const { open, onOpenChange, returnFocus } = props;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="h-[620px] max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none"
    >
      {open ? <PickerBody {...props} /> : null}
      {/* Radix returns focus to a trigger it rendered; this dialog opens from the field's own button. */}
      <FocusBack returnFocus={returnFocus} open={open} />
    </Modal>
  );
}

/** Puts focus back on the opener once the dialog has gone. */
function FocusBack({ returnFocus, open }: { returnFocus: (() => void) | undefined; open: boolean }): null {
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open) window.setTimeout(() => returnFocus?.(), 0);
    was.current = open;
  }, [open, returnFocus]);
  return null;
}

function PickerBody({ title, subtitle, sources, takes, refusal, room, multiple, footnote, onChoose, onOpenChange }: PicturePickerProps): ReactNode {
  const t = useMaybeT();
  const phone = usePhone();
  const ids = useId();
  const [tab, setTab] = useState(sources[0]?.key ?? '');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [goneLine, setGoneLine] = useState(false);
  /** Ticked pictures, across tabs: a tick survives a change of tab. */
  const [ticked, setTicked] = useState<readonly PickerItem[]>([]);
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const grid = useRef<HTMLUListElement>(null);
  const source = sources.find((one) => one.key === tab) ?? sources[0];

  // On open, focus goes to the tab that is chosen (after the dialog's own first focus has landed).
  // …unless the person has already moved it themselves.
  const tabs = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!moved.current) tabs.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, []);
  const tookFocus = (): void => {
    moved.current = true;
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (source === undefined) return undefined;
    const abort = new AbortController();
    setLoad({ state: 'loading' });
    source
      .list({ q, signal: abort.signal })
      .then((items) => {
        if (!abort.signal.aborted) setLoad({ state: 'ready', items });
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoad({ state: 'failed' });
      });
    return () => abort.abort();
  }, [source, q, attempt]);

  const items = useMemo(() => (load.state === 'ready' ? load.items.filter((item) => !gone.has(item.id)) : []), [load, gone]);
  const cols = phone ? 3 : 4;
  const full = multiple && ticked.length >= room;
  const isTicked = (item: PickerItem): boolean => ticked.some((one) => one.id === item.id);
  const unavailable = (item: PickerItem): boolean => !takes(item) || (full && !isTicked(item));
  const at = Math.min(focus, Math.max(0, items.length - 1));

  const choose = useCallback(
    async (chosen: readonly PickerItem[]): Promise<void> => {
      if (chosen.length === 0 || busy) return;
      setBusy(true);
      try {
        const outcome = await onChoose(chosen);
        if (outcome === 'done') {
          onOpenChange(false);
          return;
        }
        // Gone since the list was read: dropped, and said so.
        setGone((current) => new Set([...current, ...outcome.gone]));
        setTicked((current) => current.filter((item) => !outcome.gone.includes(item.id)));
        setGoneLine(true);
      } finally {
        setBusy(false);
      }
    },
    [busy, onChoose, onOpenChange],
  );

  const activate = (item: PickerItem, index: number): void => {
    setFocus(index);
    if (unavailable(item)) return;
    if (!multiple) {
      void choose([item]);
      return;
    }
    setTicked((current) => (current.some((one) => one.id === item.id) ? current.filter((one) => one.id !== item.id) : [...current, item]));
  };

  const onGridKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (items.length === 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let next = at;
    switch (event.key) {
      case 'ArrowRight':
        next += rtl ? -1 : 1;
        break;
      case 'ArrowLeft':
        next += rtl ? 1 : -1;
        break;
      case 'ArrowDown':
        next += cols;
        break;
      case 'ArrowUp':
        next -= cols;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        // Space ticks; Enter chooses one picture, or ticks one of several.
        if (event.key === ' ' && !multiple) return;
        activate(items[at]!, at);
        return;
      default:
        return;
    }
    event.preventDefault();
    next = Math.max(0, Math.min(items.length - 1, next));
    setFocus(next);
    grid.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };

  const live = full ? t('ui:templates.crud.picker.capLine', 'That is the most this record takes. Take one off to choose another.') : goneLine ? t('ui:templates.crud.picker.gone', 'That picture is no longer available.') : '';
  const tileName = (item: PickerItem): string =>
    source?.caption === 'record' && item.recordLabel !== undefined
      ? t('ui:templates.crud.picker.tileRecord', "{record}'s picture, {file}", { record: item.recordLabel, file: item.filename })
      : t('ui:templates.crud.picker.tileFile', '{file}, {size}', { file: item.filename, size: formatBytes(item.sizeBytes) });

  let message: { icon: ReactNode; text: string; alert?: true; action?: { label: string; icon: ReactNode; onClick: () => void } } | null = null;
  if (load.state === 'failed') {
    message = {
      icon: <TriangleAlert aria-hidden className="size-[19px]" />,
      text: t('ui:templates.crud.picker.failed', 'Could not load these pictures.'),
      alert: true,
      action: { label: t('ui:templates.crud.picker.retry', 'Try again'), icon: <RotateCw aria-hidden />, onClick: () => setAttempt((n) => n + 1) },
    };
  } else if (load.state === 'ready' && items.length === 0) {
    message =
      q !== ''
        ? { icon: <SearchX aria-hidden className="size-[19px]" />, text: t('ui:templates.crud.picker.noMatch', 'No file name matches “{q}”.', { q }) }
        : {
            icon: source?.caption === 'file' ? <FolderOpen aria-hidden className="size-[19px]" /> : <ImageIcon aria-hidden className="size-[19px]" />,
            text: source?.empty ?? '',
            ...(source?.emptyAction === undefined ? {} : { action: { ...source.emptyAction, icon: <Upload aria-hidden /> } }),
          };
  }

  const left = room - ticked.length;
  return (
    <>
      <ModalHeader
        icon={<Images aria-hidden />}
        title={title}
        {...(subtitle === undefined ? {} : { subtitle })}
        closeLabel={t('ui:templates.crud.picker.close', 'Close')}
        className="border-b border-border"
      />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next);
          setFocus(0);
          setGoneLine(false);
        }}
        className="min-h-0 flex-1"
      >
        <TabsList ref={tabs} aria-label={t('ui:templates.crud.picker.tabs', 'Where the pictures come from')} className="shrink-0 overflow-x-auto px-5 pt-2">
          {sources.map((one) => (
            <TabsTrigger key={one.key} value={one.key}>
              {one.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={source?.key ?? ''} onFocusCapture={tookFocus} className="nb-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-5 pt-4">
          <label className="relative flex items-center">
            <span className="sr-only">{t('ui:templates.crud.picker.search', 'Search by file name')}</span>
            <Search aria-hidden className="pointer-events-none absolute start-3 size-[15px] text-fg-subtle" />
            <input
              type="search"
              value={query}
              placeholder={t('ui:templates.crud.picker.search', 'Search by file name')}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-md border border-border-strong bg-surface ps-[34px] pe-3 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <div aria-live="polite">
            {live === '' ? null : (
              <p data-part="picker-live" className="m-0 flex items-start gap-2 rounded-md bg-surface-3 px-3 py-2 text-body-sm text-fg-muted">
                {live}
              </p>
            )}
          </div>
          {load.state === 'loading' ? (
            <div role="status" className={phone ? 'grid grid-cols-3 gap-x-2.5 gap-y-3' : 'grid grid-cols-4 gap-x-3.5 gap-y-4'}>
              <span className="sr-only">{t('ui:templates.crud.picker.loading', 'Loading pictures')}</span>
              {Array.from({ length: phone ? 6 : 8 }, (_, index) => (
                <span key={index} aria-hidden className="flex flex-col gap-1.5">
                  <Skeleton className="aspect-square w-full" rounded="md" />
                  <Skeleton className="h-[9px] w-[70%]" rounded="sm" />
                </span>
              ))}
            </div>
          ) : message !== null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-4 py-7 text-center">
              <span className="flex size-11 items-center justify-center rounded-lg bg-surface-3 text-fg-muted">{message.icon}</span>
              <p role={message.alert === true ? 'alert' : 'status'} className="m-0 max-w-[380px] text-body font-bold">
                {message.text}
              </p>
              {message.action === undefined ? null : (
                <Button type="button" variant="secondary" iconLeft={message.action.icon} onClick={message.action.onClick}>
                  {message.action.label}
                </Button>
              )}
            </div>
          ) : (
            <ul
              ref={grid}
              role="listbox"
              aria-label={t('ui:templates.crud.picker.grid', 'Pictures')}
              aria-multiselectable={multiple ? true : undefined}
              onKeyDown={onGridKey}
              data-part="picker-grid"
              className={phone ? 'm-0 grid list-none grid-cols-3 gap-x-2.5 gap-y-3 p-0' : 'm-0 grid list-none grid-cols-4 gap-x-3.5 gap-y-4 p-0'}
            >
              {items.map((item, index) => {
                const off = unavailable(item);
                const refused = !takes(item);
                const on = isTicked(item);
                const reasonId = `${ids}-why-${String(index)}`;
                return (
                  <li
                    key={item.id}
                    role="option"
                    aria-label={tileName(item)}
                    aria-selected={on}
                    aria-disabled={off ? true : undefined}
                    aria-describedby={refused ? reasonId : undefined}
                    tabIndex={index === at ? 0 : -1}
                    onFocus={() => setFocus(index)}
                    onClick={() => activate(item, index)}
                    data-part="picker-tile"
                    className={`group flex min-w-0 flex-col gap-[7px] outline-none ${off ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`relative block aspect-square w-full overflow-hidden rounded-md bg-surface-3 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${on ? 'ring-2 ring-accent' : ''}`}
                    >
                      {refused ? (
                        <span aria-hidden className="flex size-full flex-col items-center justify-center gap-1.5 text-fg-subtle opacity-55">
                          <FileText className="size-[26px]" />
                          <span className="font-mono text-[11px] font-bold">{typeOf(item.mime)}</span>
                        </span>
                      ) : (
                        <img src={item.contentPath} alt="" className={`block size-full object-cover ${off ? 'opacity-40' : ''}`} />
                      )}
                      {multiple && !refused ? (
                        <span
                          aria-hidden
                          className={`absolute end-2 top-2 flex size-6 items-center justify-center rounded-full border-2 border-white text-accent-fg ${on ? 'bg-accent' : 'bg-black/35'} ${off ? 'opacity-50' : ''}`}
                        >
                          {on ? <Check className="size-[13px]" /> : null}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className={`truncate ${source?.caption === 'record' ? 'text-body-sm font-bold' : 'font-mono text-xs font-semibold'} ${off ? 'text-fg-muted' : 'text-fg'}`}>
                        {source?.caption === 'record' ? (item.recordLabel ?? item.filename) : item.filename}
                      </span>
                      <span className="truncate font-mono text-caption text-fg-muted">{source?.caption === 'record' ? item.filename : formatBytes(item.sizeBytes)}</span>
                      {refused ? (
                        <span id={reasonId} className="mt-[3px] text-caption leading-[1.4] text-fg-muted">
                          {refusal(item)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <ModalFooter onFocusCapture={tookFocus} className="flex-wrap justify-start gap-x-3.5 gap-y-2.5">
        <div className="flex min-w-[200px] flex-1 flex-col gap-px">
          {footnote === undefined ? null : <span className="text-body-sm text-fg-muted">{footnote}</span>}
          {multiple ? (
            <span aria-live="polite" data-part="picker-left" className="text-body-sm font-bold">
              {ticked.length === 0
                ? t('ui:templates.crud.picker.upTo', 'Up to {count} can be added', { count: room })
                : full
                  ? ''
                  : t('ui:templates.crud.picker.more', '{count, plural, one {# more can be added} other {# more can be added}}', { count: left })}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          {t('ui:templates.crud.picker.cancel', 'Cancel')}
        </Button>
        {multiple ? (
          <Button
            type="button"
            aria-disabled={ticked.length === 0 || busy ? true : undefined}
            className={ticked.length === 0 ? 'cursor-not-allowed opacity-50' : ''}
            onClick={() => void choose(ticked)}
            data-part="picker-add"
          >
            {t('ui:templates.crud.picker.addCount', '{count, plural, one {Add # picture} other {Add # pictures}}', { count: ticked.length })}
          </Button>
        ) : null}
      </ModalFooter>
    </>
  );
}

/** A file's kind as a person reads it: `PDF` for `application/pdf`. */
export function typeOf(mime: string): string {
  const sub = mime.split('/')[1] ?? mime;
  return (sub.split(/[.+-]/).at(-1) ?? sub).toUpperCase();
}
