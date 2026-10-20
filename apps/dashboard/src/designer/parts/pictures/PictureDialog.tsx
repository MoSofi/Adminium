// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PICTURE DIALOG: where the person fills the app's picture spots, and
 * the sample rows of its tables, with no turn.
 *
 * Three parts, as the picker every host shares draws them (one grid, one
 * keyboard model; here the tiles take the spot's shape, the title over the
 * picture):
 *  - the spots, on the page and then each table's sample rows (collapsed
 *    after five); one is chosen;
 *  - where a picture comes from, in tabs: a search of one source at a time,
 *    an upload, a picture already in the app. Enter or a click on a tile
 *    opens its details (its licence first); "Use for {spot}" puts it in
 *    "what changes" and gives focus back to the tile;
 *  - "what changes", each row with the words for people who cannot see the
 *    picture, and Apply, which writes them all with no turn and saves a
 *    version.
 * Escape closes the details first, then the dialog; leaving with changes
 * not applied asks. Under 640px it is the whole screen: the spots become a
 * select, three tiles a row, and the details replace the grid.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CloudOff, Globe, Hourglass, ImageUp, Images, Info, LayoutTemplate, ListFilter, LoaderCircle, Replace, Search, SearchX, TriangleAlert, Upload, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Modal, ModalHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';
import { PictureGrid, type GridAspect, type GridTile } from '@adminium/widgets';

import { ApiError } from '../../../app/api.js';
import { t } from '../../../i18n/t.js';
import { useAppToasts } from '../../../pages/toasts.js';
import { designerApi, designerKeys, type FoundPicture, type LicenceCode, type PictureFill, type PictureShape, type PictureSourceName, type PicturesApplied, type PicturesMode, type PicturesView } from '../../api.js';
import { badgeOf, DEFAULT_BADGES, LicenceBadgePill, licenceName, licenceSentence, type SearchBadge } from './licence.js';

/** Under 640px the dialog is the whole screen. */
const PHONE = '(max-width: 639px)';
/** The largest picture a spot takes, as the upload says it. */
const PICTURE_MAX_BYTES = 5_000_000;
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** How many sample rows of a table show before "Show all". */
const ROWS_SHOWN = 5;

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

/** A spot of the page or a sample row of a table, as the dialog names it: `spot:hero`, `row:dishes:3`. */
interface Target {
  key: string;
  name: string;
  shape: PictureShape;
  version: string;
  thumb: string | null;
  /** What to search with first. */
  search: string;
  spot?: string;
  row?: { table: string; row: number };
}

/** A picture the person opened: from a search, a picture already in the app, or one they uploaded now. */
type Opened =
  | { kind: 'found'; picture: FoundPicture; shelf: string }
  | { kind: 'app'; key: string; name: string; thumb: string; licence: LicenceCode };

/** One row of "what changes". */
interface Pick {
  target: string;
  /** Where the picture comes from; a placeholder empties the spot. */
  from: PictureFill['from'];
  placeholder: boolean;
  title: string;
  creator: string | null;
  licence: LicenceCode;
  thumb: string;
  alt: string;
  decorative: boolean;
  /** Gone (search again), only a small copy, or someone changed the spot since. */
  flag: 'gone' | 'small' | 'conflict' | null;
}

type SearchState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; shelf: string; pictures: FoundPicture[]; more: boolean; page: number; q: string }
  | { state: 'busy'; source: PictureSourceName; minutes: number }
  | { state: 'off' }
  | { state: 'failed' };

const SHAPES: readonly PictureShape[] = ['wide', 'square', 'tall'];
const shapeWord = (shape: PictureShape): string =>
  shape === 'wide' ? t('designer:pictureDialog.shape.wide', 'wide') : shape === 'square' ? t('designer:pictureDialog.shape.square', 'square') : t('designer:pictureDialog.shape.tall', 'tall');
const shapeOption = (shape: PictureShape): string =>
  shape === 'wide' ? t('designer:pictureDialog.shapeOption.wide', 'Wide') : shape === 'square' ? t('designer:pictureDialog.shapeOption.square', 'Square') : t('designer:pictureDialog.shapeOption.tall', 'Tall');
const aspectOf = (shape: PictureShape): GridAspect => (shape === 'wide' ? 'wide' : shape === 'square' ? 'square' : 'tall');

/** A grey frame, hatched: a spot with no picture. */
const HATCH = 'border border-border-strong bg-[repeating-linear-gradient(135deg,var(--color-surface-3)_0_4px,var(--color-surface-2)_4px_8px)]';

export interface PictureDialogProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The app's name, under the title. */
  appName: string;
  /** The spot to open on (a click on its wireframe, or on "Change the picture…"). */
  spot?: string | null | undefined;
  /** A turn runs: nothing may be applied until it ends. */
  working: boolean;
  /** Applied: the chat says it, with Undo. */
  onApplied: (reply: PicturesApplied) => void;
  /** "Make them swappable": one turn of the Designer's, on the person's click. */
  onSwappable: () => void;
  /** The turn "Make them swappable" started is running. */
  swapping: boolean;
  /** Where focus goes when the dialog closes: what opened it. */
  returnFocus?: (() => void) | undefined;
}

export function PictureDialog(props: PictureDialogProps): ReactNode {
  const { open, returnFocus, onOpenChange } = props;
  const phone = usePhone();
  // Escape, the close button and a click outside all ask the body first: it closes the details, or asks before changes are lost.
  const guard = useRef<(() => void) | null>(null);
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open) window.setTimeout(() => returnFocus?.(), 0);
    was.current = open;
  }, [open, returnFocus]);
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (next || guard.current === null) onOpenChange(next);
        else guard.current();
      }}
      size="xl"
      className={phone ? 'h-dvh max-h-none w-full max-w-none rounded-none' : 'h-[640px] max-w-[960px]'}
    >
      {open ? <DialogBody {...props} phone={phone} closing={guard} /> : null}
    </Modal>
  );
}

function DialogBody({ sessionId, onOpenChange, appName, spot: openOn, working, onApplied, onSwappable, swapping, phone, closing }: PictureDialogProps & { phone: boolean; closing: { current: (() => void) | null } }): ReactNode {
  const ids = useId();
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: designerKeys.pictures(sessionId), queryFn: () => designerApi.pictures(sessionId) });
  const data: PicturesView | undefined = view.data;

  // ── the spots ──────────────────────────────────────────────────────────────
  const targets = useMemo((): { page: Target[]; tables: { table: string; label: string; rows: Target[] }[] } => {
    if (data === undefined) return { page: [], tables: [] };
    return {
      page: data.spots.map((spot) => ({ key: `spot:${spot.id}`, name: spot.label, shape: spot.shape, version: spot.version, thumb: spot.thumb, search: spot.search || spot.shows, spot: spot.id })),
      tables: data.tables.map((table) => ({
        table: table.table,
        label: table.label,
        rows: table.rows.map((row) => ({ key: `row:${table.table}:${String(row.row)}`, name: row.label, shape: 'square' as const, version: row.version, thumb: row.thumb, search: row.label, row: { table: table.table, row: row.row } })),
      })),
    };
  }, [data]);
  const all = useMemo(() => [...targets.page, ...targets.tables.flatMap((table) => table.rows)], [targets]);
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const target = all.find((one) => one.key === chosenKey) ?? (openOn === undefined || openOn === null ? undefined : all.find((one) => one.spot === openOn)) ?? all[0];
  const [shownAll, setShownAll] = useState<ReadonlySet<string>>(() => new Set());

  // ── what changes ───────────────────────────────────────────────────────────
  const [picks, setPicks] = useState<readonly Pick[]>([]);
  const [mode, setMode] = useState<PicturesMode | null>(null);
  const modeNow = mode ?? data?.mode ?? 'placeholders';
  const keepsMode = data?.mode !== null;
  const modeChanged = data !== undefined && mode !== null && mode !== data.mode;
  const changes = picks.length + (modeChanged ? 1 : 0);
  const setPick = (key: string, patch: Partial<Pick>): void => setPicks((before) => before.map((pick) => (pick.target === key ? { ...pick, ...patch } : pick)));

  // ── where a picture comes from ─────────────────────────────────────────────
  const [tab, setTab] = useState<'search' | 'upload' | 'app'>('search');
  const sources = (data?.sources ?? []).filter((source) => !(source.name === 'Unsplash' && data?.unsplash === 'closed'));
  const unsplashClosed = data !== undefined && data.unsplash === 'closed' && data.sources.some((source) => source.name === 'Unsplash');
  const [source, setSource] = useState<PictureSourceName | null>(null);
  const sourceNow: PictureSourceName | null = source ?? sources[0]?.name ?? null;
  const [query, setQuery] = useState('');
  const [shape, setShape] = useState<PictureShape>('wide');
  const [licences, setLicences] = useState<ReadonlySet<SearchBadge>>(() => new Set(DEFAULT_BADGES));
  const [found, setFound] = useState<SearchState>({ state: 'idle' });
  const asked = useRef(0);
  const [focus, setFocus] = useState(0);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [moreAbout, setMoreAbout] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [upload, setUpload] = useState<{ error: 'size' | 'type' | 'failed'; file: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const search = async (input: { q: string; shape: PictureShape; source: PictureSourceName | null; page?: number; shelf?: string }): Promise<void> => {
    if (input.source === null) {
      setFound({ state: 'off' });
      return;
    }
    const words = input.q.trim();
    if (words === '') return;
    const mine = ++asked.current;
    if (input.page === undefined) {
      setFound({ state: 'loading' });
      setFocus(0);
      setOpened(null);
    }
    try {
      const reply = await designerApi.searchPictures(sessionId, { q: words, source: input.source, shape: input.shape, ...(input.page === undefined ? {} : { page: input.page }), ...(input.shelf === undefined ? {} : { shelf: input.shelf }) });
      if (mine !== asked.current) return;
      if (reply.state !== 'ok') {
        setFound(reply);
        return;
      }
      setFound((before) => ({ state: 'ok', shelf: reply.shelf, more: reply.more, page: reply.page, q: words, pictures: input.page !== undefined && before.state === 'ok' ? [...before.pictures, ...reply.pictures] : reply.pictures }));
    } catch {
      if (mine === asked.current) setFound({ state: 'failed' });
    }
  };

  // A spot chosen: its own words and shape, searched once.
  const targetKey = target?.key;
  useEffect(() => {
    if (target === undefined) return;
    setQuery(target.search);
    setShape(target.shape);
    setOpened(null);
    if (sources.length === 0) setFound({ state: 'off' });
    else void search({ q: target.search, shape: target.shape, source: sourceNow });
    // Only when the spot changes: a new search is the person's to ask for after that.
  }, [targetKey, data === undefined]);

  // ── the tiles of the tab that shows ────────────────────────────────────────
  const visible = found.state === 'ok' ? found.pictures.filter((picture) => licences.has(badgeOf(picture.licence.code) as SearchBadge)) : [];
  const hiddenSame = found.state === 'ok' && visible.length === 0 && found.pictures.some((picture) => badgeOf(picture.licence.code) === 'credit-same') && !licences.has('credit-same');
  const appItems = data?.inApp ?? [];
  const tileOf = (picture: FoundPicture, shelf: string): GridTile => ({
    id: picture.id,
    src: designerApi.pictureThumbUrl(sessionId, shelf, picture.id),
    name: t('designer:pictureDialog.tileName', '{title} by {creator}, {badge}', { title: picture.title, creator: picture.creator, badge: licenceName(picture.licence.code) }),
    title: picture.title,
    open: opened?.kind === 'found' && opened.picture.id === picture.id,
  });
  const tiles: GridTile[] =
    tab === 'search'
      ? found.state === 'ok'
        ? visible.map((picture) => tileOf(picture, found.shelf))
        : []
      : tab === 'app'
        ? appItems.map((item) => ({ id: item.key, src: item.thumb, name: t('designer:pictureDialog.tileApp', '{name}, {badge}', { name: item.name, badge: licenceName(item.licence) }), title: item.name, open: opened?.kind === 'app' && opened.key === item.key }))
        : [];
  const tileId = (index: number): string => `${ids}-tile-${String(index)}`;
  const focusSoon = (id: string): void => {
    // After the frame that draws it: focus moves 40 ms on, as every dialog of the product does.
    window.setTimeout(() => document.getElementById(id)?.focus(), 40);
  };
  const openTile = (index: number): void => {
    setFocus(index);
    setMoreAbout(false);
    if (tab === 'search' && found.state === 'ok') {
      const picture = visible[index];
      if (picture !== undefined) setOpened({ kind: 'found', picture, shelf: found.shelf });
    } else if (tab === 'app') {
      const item = appItems[index];
      if (item !== undefined) setOpened({ kind: 'app', key: item.key, name: item.name, thumb: item.thumb, licence: item.licence });
    }
    focusSoon(`${ids}-pane-heading`);
  };
  const closePane = (): void => {
    setOpened(null);
    focusSoon(tileId(focus));
  };

  const useFor = async (): Promise<void> => {
    if (opened === null || target === undefined) return;
    const key = target.key;
    const base = { target: key, placeholder: false, decorative: false, flag: null };
    if (opened.kind === 'found') {
      const { picture, shelf } = opened;
      setPicks((before) => [
        ...before.filter((pick) => pick.target !== key),
        { ...base, from: { shelf, picture: picture.id }, title: picture.title, creator: picture.creator, licence: picture.licence.code, thumb: designerApi.pictureThumbUrl(sessionId, shelf, picture.id), alt: picture.title },
      ]);
      // Kept for the session, and its bytes fetched now: a small copy is said on its row before Apply.
      void designerApi
        .pinPicture(sessionId, shelf, picture.id)
        .then((pinned) => setPick(key, { flag: pinned.state === 'kept' ? (pinned.small ? 'small' : null) : 'gone' }))
        .catch(() => undefined);
    } else {
      const name = opened.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
      const from: PictureFill['from'] = opened.key.startsWith('attachment:') ? { attachment: opened.key.slice('attachment:'.length) } : { file: opened.key.slice('file:'.length) };
      setPicks((before) => [...before.filter((pick) => pick.target !== key), { ...base, from, title: opened.name, creator: null, licence: opened.licence, thumb: opened.thumb, alt: name }]);
    }
    toasts.push({ variant: 'info', title: t('designer:pictureDialog.added', '{spot} is in what changes.', { spot: target.name }) });
    closePane();
  };

  const onUpload = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    if (!PICTURE_TYPES.includes(file.type)) {
      setUpload({ error: 'type', file: file.name });
      return;
    }
    if (file.size > PICTURE_MAX_BYTES) {
      setUpload({ error: 'size', file: `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` });
      return;
    }
    setUpload(null);
    setUploading(true);
    try {
      const made = await designerApi.uploadAttachment(sessionId, file);
      await queryClient.invalidateQueries({ queryKey: designerKeys.pictures(sessionId) });
      setOpened({ kind: 'app', key: `attachment:${made.id}`, name: made.label, thumb: designerApi.attachmentUrl(sessionId, made.id), licence: 'own' });
      focusSoon(`${ids}-pane-heading`);
    } catch (error) {
      setUpload({ error: 'failed', file: error instanceof Error ? error.message : file.name });
    } finally {
      setUploading(false);
    }
  };

  // ── Apply ──────────────────────────────────────────────────────────────────
  const applyId = useRef(`apply-${Math.random().toString(36).slice(2, 14)}`);
  const ready = picks.filter((pick) => pick.flag !== 'gone' && pick.flag !== 'conflict');
  const apply = useMutation({
    mutationFn: () => {
      const fills: PictureFill[] = ready.flatMap((pick): PictureFill[] => {
        const one = all.find((candidate) => candidate.key === pick.target);
        if (one === undefined) return [];
        return [
          {
            ...(one.spot === undefined ? {} : { spot: one.spot }),
            ...(one.row === undefined ? {} : { row: one.row }),
            version: one.version,
            from: pick.placeholder ? { placeholder: true } : pick.from,
            ...(pick.placeholder ? {} : { alt: pick.decorative ? '' : pick.alt, decorative: pick.decorative }),
          },
        ];
      });
      return designerApi.applyPictures(sessionId, applyId.current, fills, modeChanged ? (mode as PicturesMode) : undefined);
    },
    onSuccess: (reply) => {
      applyId.current = `apply-${Math.random().toString(36).slice(2, 14)}`;
      const byTarget = new Map(reply.results.map((result) => [result.target, result.state]));
      // What was applied leaves "what changes"; what was not stays, with why.
      const left = picks.flatMap((pick): Pick[] => {
        const state = byTarget.get(pick.target);
        if (state === 'applied') return [];
        if (state === 'conflict') return [{ ...pick, flag: 'conflict' }];
        if (state === 'gone') return [{ ...pick, flag: 'gone' }];
        return [pick];
      });
      setPicks(left);
      setMode(null);
      void queryClient.invalidateQueries({ queryKey: designerKeys.pictures(sessionId) });
      onApplied(reply);
      if (left.length === 0) onOpenChange(false);
    },
    onError: (error) => {
      const reason = error instanceof ApiError && typeof error.details === 'object' && error.details !== null ? (error.details as { reason?: unknown }).reason : undefined;
      toasts.push(
        reason === 'TURN_RUNNING' || reason === 'DESIGNER_BUSY'
          ? { variant: 'info', title: t('designer:pictureDialog.wait', 'Wait for the Designer to finish, then apply.') }
          : { variant: 'error', title: t('designer:pictureDialog.applyFailed', 'The pictures were not applied'), description: error instanceof Error ? error.message : String(error) },
      );
    },
  });
  const blocked = working || apply.isPending || (ready.length === 0 && !modeChanged);

  // ── closing ────────────────────────────────────────────────────────────────
  const tryClose = (): void => {
    if (confirm) {
      setConfirm(false);
      return;
    }
    if (opened !== null) {
      closePane();
      return;
    }
    if (changes > 0) {
      setConfirm(true);
      focusSoon(`${ids}-keep`);
      return;
    }
    onOpenChange(false);
  };
  closing.current = tryClose;
  useEffect(
    () => () => {
      closing.current = null;
    },
    [closing],
  );

  if (data === undefined) {
    return (
      <>
        <ModalHeader icon={<Images aria-hidden />} title={t('designer:pictureDialog.title', 'Pictures')} subtitle={appName} closeLabel={t('designer:pictureDialog.close', 'Close')} className="border-b border-border pb-3.5 pt-3.5" />
        <div role="status" className="flex flex-1 items-center justify-center p-8 text-body-sm text-fg-muted">
          {view.isError ? t('designer:pictureDialog.failed', 'Could not load these pictures.') : <LoaderCircle aria-label={t('designer:pictureDialog.loading', 'Loading pictures')} className="size-5 animate-spin" />}
        </div>
      </>
    );
  }

  const header = <ModalHeader icon={<Images aria-hidden />} title={t('designer:pictureDialog.title', 'Pictures')} subtitle={appName} closeLabel={t('designer:pictureDialog.close', 'Close')} className="border-b border-border pb-3.5 pt-3.5" />;

  // An app made before spots: its pictures become spots on the person's word, in one turn.
  const legacyPanel = data.legacy > 0 ? (
    <div data-part="legacy" className="flex flex-col items-start gap-2.5 rounded-xl border border-dashed border-border-strong bg-surface-2 p-5">
      <p className="m-0 text-body font-bold">
        {data.spots.length === 0
          ? t('designer:pictureDialog.legacy', 'This app’s pictures are not in spots yet, so they cannot be changed here.')
          : t('designer:pictureDialog.legacyLeft', '{count, plural, one {# picture is not in a spot yet.} other {# pictures are not in spots yet.}}', { count: data.legacy })}
      </p>
      <button
        type="button"
        aria-disabled={working || swapping ? true : undefined}
        aria-busy={swapping ? true : undefined}
        aria-describedby={working && !swapping ? `${ids}-swap-wait` : `${ids}-swap-help`}
        onClick={() => {
          if (!working && !swapping) onSwappable();
        }}
        className={`nb-btn inline-flex h-9 items-center gap-2 rounded-[10px] bg-accent px-3.5 text-body-sm font-bold text-accent-fg ${working || swapping ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        {swapping ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Replace aria-hidden="true" className="size-4" />}
        {swapping ? t('designer:pictureDialog.swapping', 'Making them swappable…') : t('designer:pictureDialog.swap', 'Make them swappable')}
      </button>
      {working && !swapping ? (
        <p id={`${ids}-swap-wait`} className="m-0 text-body-sm text-fg-muted">
          {t('designer:pictureDialog.wait', 'Wait for the Designer to finish, then apply.')}
        </p>
      ) : (
        <p id={`${ids}-swap-help`} className="m-0 text-body-sm text-fg-muted">
          {t('designer:pictureDialog.swapHelp', 'The Designer turns each picture into a spot in one turn. Your pictures and their credits stay.')}
        </p>
      )}
    </div>
  ) : null;

  if (all.length === 0) {
    return (
      <>
        {header}
        <div className="flex flex-1 flex-col gap-4 p-7">{legacyPanel ?? <p className="m-0 text-body text-fg-muted">{t('designer:pictureDialog.noSpots', 'This app has no picture spots yet.')}</p>}</div>
      </>
    );
  }

  const spotRow = (one: Target): ReactNode => {
    const current = one.key === target?.key;
    const chosen = picks.some((pick) => pick.target === one.key);
    const wide = one.shape === 'wide';
    return (
      <button
        key={one.key}
        type="button"
        aria-current={current ? 'true' : undefined}
        onClick={() => {
          setChosenKey(one.key);
          setTab('search');
        }}
        className={`relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-start ${current ? 'bg-accent-soft text-accent' : 'nb-ib text-fg'}`}
      >
        <span aria-hidden="true" className="flex w-[38px] shrink-0 justify-center">
          {one.thumb === null ? <span className={`block h-6 rounded-[6px] ${wide ? 'w-[38px]' : 'w-6'} ${HATCH}`} /> : <img src={one.thumb} alt="" className={`block h-6 rounded-[6px] object-cover ${wide ? 'w-[38px]' : 'w-6'}`} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-bold">{one.name}</span>
          <span className="text-caption text-fg-muted">{shapeWord(one.shape)}</span>
        </span>
        {chosen ? (
          <span className="flex items-center">
            <span aria-hidden="true" className="size-[7px] rounded-full bg-accent" />
            <span className="sr-only">{t('designer:pictureDialog.chosen', 'picture chosen')}</span>
          </span>
        ) : null}
      </button>
    );
  };

  const spotsNav = phone ? (
    <label className="relative mx-4 mt-3 flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border border-border-strong bg-surface pe-[34px] ps-3">
      <span className="text-body font-bold text-fg-muted">{t('designer:pictureDialog.spotLabel', 'Spot:')}</span>
      <select value={target?.key} onChange={(event) => setChosenKey(event.target.value)} className="h-full min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent text-body font-bold text-fg">
        {all.map((one) => (
          <option key={one.key} value={one.key}>
            {one.name}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-[11px] size-[15px] text-fg-subtle" />
    </label>
  ) : (
    <nav aria-label={t('designer:pictureDialog.spots', 'Spots')} className="nb-scroll flex w-[240px] shrink-0 flex-col gap-0.5 overflow-auto border-e border-border bg-surface px-2.5 py-3">
      {targets.page.length === 0 ? null : <div className="px-2.5 pb-1.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('designer:pictureDialog.onPage', 'On the page')}</div>}
      {targets.page.map(spotRow)}
      {targets.tables.map((table) => {
        const all = shownAll.has(table.table);
        return (
          <div key={table.table} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1.5 pt-4 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{table.label}</div>
            {(all ? table.rows : table.rows.slice(0, ROWS_SHOWN)).map(spotRow)}
            {table.rows.length <= ROWS_SHOWN ? null : (
              <button
                type="button"
                aria-expanded={all}
                onClick={() => setShownAll((before) => (before.has(table.table) ? new Set([...before].filter((one) => one !== table.table)) : new Set([...before, table.table])))}
                className="nb-ib mt-1 flex items-center gap-1.5 rounded-[10px] px-2.5 py-[7px] text-start text-body-sm font-bold text-fg-muted"
              >
                {all ? <ChevronUp aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
                {all
                  ? t('designer:pictureDialog.showFewer', 'Show fewer {table}', { table: table.label })
                  : t('designer:pictureDialog.showAll', 'Show all {count} {table}', { count: table.rows.length, table: table.label })}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );

  const message = (props: { icon: ReactNode; text: ReactNode; sub?: string; role?: 'alert' | 'status'; actions?: { label: string; onClick: () => void }[] }): ReactNode => (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-4 py-7 text-center">
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-[14px] bg-surface-3 text-fg-muted">
        {props.icon}
      </span>
      <p role={props.role ?? 'status'} className="m-0 max-w-[380px] text-pretty text-body font-bold">
        {props.text}
      </p>
      {props.sub === undefined ? null : <p className="m-0 max-w-[380px] text-pretty text-body-sm text-fg-muted">{props.sub}</p>}
      {props.actions === undefined ? null : (
        <div className="flex flex-wrap justify-center gap-2">
          {props.actions.map((action) => (
            <button key={action.label} type="button" onClick={action.onClick} className="nb-ib h-[34px] rounded-[10px] border border-border-strong bg-surface px-3.5 text-body font-bold text-fg">
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const grid = (aspect: GridAspect, label: string): ReactNode => (
    <PictureGrid tiles={tiles} label={label} aspect={aspect} caption="over" cols={phone ? 3 : 4} multiple={false} focus={focus} onFocus={setFocus} onActivate={openTile} idOf={tileId} />
  );
  const loading = (
    <div role="status" className={`grid gap-2.5 ${phone ? 'grid-cols-3' : 'grid-cols-4'}`}>
      <span className="sr-only">{t('designer:pictureDialog.loading', 'Loading pictures')}</span>
      {Array.from({ length: phone ? 9 : 12 }, (_, index) => (
        <Skeleton key={index} className={shape === 'wide' ? 'aspect-[16/10]' : shape === 'square' ? 'aspect-square' : 'aspect-[3/4]'} rounded="md" />
      ))}
    </div>
  );

  const searchPanel = (
    <>
      {sources.length === 0
        ? message({
            icon: <SearchX className="size-[18px]" />,
            text: t('designer:pictureDialog.off', 'Picture search is off on this server.'),
            sub: t('designer:pictureDialog.offSub', 'You can still upload a picture or reuse one already in this app.'),
            actions: [
              { label: t('designer:pictureDialog.tabUpload', 'Upload'), onClick: () => setTab('upload') },
              { label: t('designer:pictureDialog.tabApp', 'Already in this app'), onClick: () => setTab('app') },
            ],
          })
        : null}
      {sources.length === 0 ? null : (
        <>
          <form
            role="search"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void search({ q: query, shape, source: sourceNow });
            }}
            className="flex flex-wrap gap-2"
          >
            <div className="relative flex min-w-[220px] flex-[1_1_220px] items-center">
              <Search aria-hidden="true" className="pointer-events-none absolute start-[11px] size-[15px] text-fg-subtle" />
              <input
                type="search"
                aria-label={t('designer:pictureDialog.words', 'Search words')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-[38px] w-full rounded-[10px] border border-border-strong bg-surface pe-3 ps-[34px] text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </div>
            <div className="relative flex items-center">
              <select
                aria-label={t('designer:pictureDialog.source', 'Source')}
                value={sourceNow ?? ''}
                onChange={(event) => {
                  const next = event.target.value as PictureSourceName;
                  setSource(next);
                  void search({ q: query, shape, source: next });
                }}
                className="h-[38px] cursor-pointer appearance-none rounded-[10px] border border-border-strong bg-surface pe-8 ps-3 text-body font-semibold text-fg"
              >
                {sources.map((one) => (
                  <option key={one.name} value={one.name}>
                    {one.name}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-2.5 size-3.5 text-fg-subtle" />
            </div>
            <div className="relative flex items-center">
              <select
                aria-label={t('designer:pictureDialog.shapeLabel', 'Shape')}
                value={shape}
                onChange={(event) => {
                  const next = event.target.value as PictureShape;
                  setShape(next);
                  void search({ q: query, shape: next, source: sourceNow });
                }}
                className="h-[38px] cursor-pointer appearance-none rounded-[10px] border border-border-strong bg-surface pe-8 ps-3 text-body font-semibold text-fg"
              >
                {SHAPES.map((one) => (
                  <option key={one} value={one}>
                    {shapeOption(one)}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-2.5 size-3.5 text-fg-subtle" />
            </div>
            <button type="submit" className="nb-ib h-[38px] rounded-[10px] border border-border-strong bg-surface px-3.5 text-body font-bold text-fg">
              {t('designer:pictureDialog.search', 'Search')}
            </button>
          </form>
          <div role="group" aria-labelledby={`${ids}-licence`} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span id={`${ids}-licence`} className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
              {t('designer:pictureDialog.licence', 'Licence')}
            </span>
            {(['no-credit', 'host', 'credit', 'credit-same'] as const)
              .filter((badge) => !(badge === 'host' && sourceNow === 'Openverse'))
              .map((badge) => (
                <label key={badge} className="flex cursor-pointer items-center gap-[7px] whitespace-nowrap text-body-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={licences.has(badge)}
                    onChange={() => {
                      setLicences((before) => (before.has(badge) ? new Set([...before].filter((one) => one !== badge)) : new Set([...before, badge])));
                      setFocus(0);
                    }}
                    className="size-[18px] shrink-0 accent-[var(--color-accent)]"
                  />
                  {badge === 'host'
                    ? t('designer:pictureDialog.badge.host', '{source} licence', { source: sourceNow ?? '' })
                    : badge === 'no-credit'
                      ? t('designer:pictureDialog.badge.noCredit', 'No credit needed')
                      : badge === 'credit'
                        ? t('designer:pictureDialog.badge.credit', 'Credit needed')
                        : t('designer:pictureDialog.badge.creditSame', 'Credit + same licence')}
                </label>
              ))}
          </div>
          {unsplashClosed ? (
            <div role="note" className="flex items-start gap-2 rounded-[10px] bg-surface-3 px-3 py-2 text-body-sm text-fg-muted">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{t('designer:pictureDialog.unsplashClosed', 'Unsplash pictures can’t be used on this server.')}</span>
            </div>
          ) : null}
          {found.state === 'loading'
            ? loading
            : found.state === 'failed'
              ? message({ icon: <CloudOff className="size-[18px]" />, text: t('designer:pictureDialog.failed', 'Could not load these pictures.'), role: 'alert', actions: [{ label: t('designer:pictureDialog.retry', 'Try again'), onClick: () => void search({ q: query, shape, source: sourceNow }) }] })
              : found.state === 'busy'
                ? message({ icon: <Hourglass className="size-[18px]" />, text: t('designer:pictureDialog.busy', '{source} is busy. Try again in {minutes, plural, one {# minute} other {# minutes}}.', { source: found.source, minutes: found.minutes }) })
                : found.state === 'off'
                  ? message({ icon: <SearchX className="size-[18px]" />, text: t('designer:pictureDialog.off', 'Picture search is off on this server.') })
                  : found.state === 'ok' && found.pictures.length === 0
                    ? message({ icon: <SearchX className="size-[18px]" />, text: t('designer:pictureDialog.nothing', 'Nothing found for “{q}”. Try fewer or other words.', { q: found.q }) })
                    : found.state === 'ok' && visible.length === 0
                      ? hiddenSame
                        ? message({
                            icon: <ListFilter className="size-[18px]" />,
                            text: t('designer:pictureDialog.onlySame', 'No pictures without conditions match. Show pictures with Credit + same licence too?'),
                            actions: [{ label: t('designer:pictureDialog.showThem', 'Show them'), onClick: () => setLicences((before) => new Set([...before, 'credit-same'])) }],
                          })
                        : message({ icon: <ListFilter className="size-[18px]" />, text: t('designer:pictureDialog.noneTicked', 'No pictures match the licences you ticked.') })
                      : found.state === 'ok'
                        ? (
                          <>
                            {grid(aspectOf(shape), t('designer:pictureDialog.results', 'Pictures for {spot}', { spot: target?.name ?? '' }))}
                            {found.more ? (
                              <div className="flex justify-center">
                                <button type="button" onClick={() => void search({ q: found.q, shape, source: sourceNow, page: found.page + 1, shelf: found.shelf })} className="nb-ib h-[34px] rounded-[10px] border border-border-strong bg-surface px-4 text-body font-bold text-fg">
                                  {t('designer:pictureDialog.more', 'More')}
                                </button>
                              </div>
                            ) : null}
                          </>
                        )
                        : null}
        </>
      )}
    </>
  );

  const uploadPanel = (
    <div className="flex flex-col gap-2.5">
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void onUpload(event.dataTransfer.files[0]);
        }}
        className="flex flex-col items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-border-strong bg-surface-2 px-5 py-10 text-center"
      >
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-[14px] bg-accent-soft text-accent">
          {uploading ? <LoaderCircle className="size-[18px] animate-spin" /> : <ImageUp className="size-[18px]" />}
        </span>
        <div className="text-body font-bold">
          {t('designer:pictureDialog.drop', 'Drop a picture here, or')}{' '}
          <button type="button" onClick={() => fileInput.current?.click()} className="border-0 bg-transparent p-0 text-body font-bold text-accent underline underline-offset-2">
            {t('designer:pictureDialog.browse', 'browse')}
          </button>
        </div>
        <div className="text-caption text-fg-muted">{t('designer:pictureDialog.uploadKinds', 'PNG, JPEG, WebP or GIF, up to 5 MB')}</div>
        <input ref={fileInput} type="file" accept={PICTURE_TYPES.join(',')} onChange={(event) => void onUpload(event.target.files?.[0])} className="hidden" />
      </div>
      {upload === null ? null : (
        <div role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-soft px-3 py-2.5 text-body-sm font-bold leading-normal text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">
            {upload.error === 'size'
              ? t('designer:pictureDialog.tooLarge', 'That picture is over 5 MB. Choose a smaller one.')
              : upload.error === 'type'
                ? t('designer:pictureDialog.wrongType', 'That file is not a PNG, JPEG, WebP or GIF. Choose another one.')
                : t('designer:pictureDialog.uploadFailed', 'That picture could not be uploaded.')}
            <span dir="ltr" className="block font-mono text-caption font-semibold">
              {upload.file}
            </span>
          </span>
        </div>
      )}
      <p className="m-0 text-body-sm text-fg-muted">{t('designer:pictureDialog.permission', 'Use only pictures you made or have permission to use.')}</p>
    </div>
  );

  const appPanel = appItems.length === 0 ? message({ icon: <Images className="size-[18px]" />, text: t('designer:pictureDialog.appEmpty', 'No pictures in this app yet.') }) : grid('wide', t('designer:pictureDialog.results', 'Pictures for {spot}', { spot: target?.name ?? '' }));

  const pane =
    opened === null ? null : (
      <DetailsPane
        opened={opened}
        phone={phone}
        headingId={`${ids}-pane-heading`}
        spotName={target?.name ?? ''}
        sessionId={sessionId}
        moreAbout={moreAbout}
        onMoreAbout={() => setMoreAbout((before) => !before)}
        onClose={closePane}
        onUse={() => void useFor()}
      />
    );

  const changesRegion = (
    <div role="region" aria-labelledby={`${ids}-changes`} className={`nb-scroll shrink-0 overflow-auto border-t border-border bg-surface-2 ${phone ? 'max-h-[210px]' : 'max-h-[236px]'}`}>
      <div className="flex items-center gap-2 px-5 pb-2 pt-2.5">
        <span id={`${ids}-changes`} className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
          {t('designer:pictureDialog.whatChanges', 'What changes')}
        </span>
        {picks.length === 0 ? null : <span className="rounded-full bg-surface-3 px-[7px] py-px font-mono text-[10.5px] font-bold text-fg-muted">{picks.length}</span>}
      </div>
      {picks.length === 0 ? (
        <p className="m-0 px-5 pb-3 text-body-sm text-fg-muted">{t('designer:pictureDialog.nothingChosen', 'Nothing chosen yet. Open a picture, then choose Use for {spot}.', { spot: target?.name ?? '' })}</p>
      ) : (
        picks.map((pick) => <ChangeRow key={pick.target} pick={pick} name={all.find((one) => one.key === pick.target)?.name ?? pick.target} ids={ids} onChange={(patch) => setPick(pick.target, patch)} onRemove={() => setPicks((before) => before.filter((one) => one.target !== pick.target))} onSearchAgain={() => {
          const one = all.find((candidate) => candidate.key === pick.target);
          if (one !== undefined) setChosenKey(one.key);
          setTab('search');
          void search({ q: pick.title, shape, source: sourceNow });
        }} onChooseAgain={() => {
          setChosenKey(pick.target);
          setTab('search');
        }} />)
      )}
    </div>
  );

  return (
    <>
      {header}
      <div className={`flex min-h-0 flex-1 ${phone ? 'flex-col' : ''}`}>
        {spotsNav}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <Tabs
            value={tab}
            onValueChange={(next) => {
              setTab(next as typeof tab);
              setOpened(null);
              setFocus(0);
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList aria-label={t('designer:pictureDialog.tabs', 'Where the picture comes from')} className="shrink-0 overflow-x-auto px-5">
              <TabsTrigger value="search">{t('designer:pictureDialog.tabSearch', 'Search pictures')}</TabsTrigger>
              <TabsTrigger value="upload">{t('designer:pictureDialog.tabUpload', 'Upload')}</TabsTrigger>
              <TabsTrigger value="app">{t('designer:pictureDialog.tabApp', 'Already in this app')}</TabsTrigger>
            </TabsList>
            {phone && pane !== null ? (
              pane
            ) : (
              <>
                {legacyPanel === null ? null : <div className="px-5 pt-4">{legacyPanel}</div>}
                <TabsContent value="search" className="nb-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-5 pb-5 pt-4">
                  {searchPanel}
                </TabsContent>
                <TabsContent value="upload" className="nb-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-5 pb-5 pt-4">
                  {uploadPanel}
                </TabsContent>
                <TabsContent value="app" className="nb-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-5 pb-5 pt-4">
                  {appPanel}
                </TabsContent>
              </>
            )}
          </Tabs>
          {!phone && pane !== null ? <div className="absolute bottom-0 end-0 top-[46px] z-[2] flex w-[340px] flex-col border-s border-border bg-surface shadow-modal">{pane}</div> : null}
        </div>
      </div>
      {changesRegion}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-2.5 border-t border-border px-5 py-3">
        {keepsMode ? <ModeControl value={modeNow} onChange={setMode} ids={ids} /> : null}
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2.5">
          {working ? (
            <span id={`${ids}-wait`} className="flex items-center gap-1.5 text-caption font-semibold text-fg-muted">
              <LoaderCircle aria-hidden="true" className="size-[13px] animate-spin" />
              {t('designer:pictureDialog.wait', 'Wait for the Designer to finish, then apply.')}
            </span>
          ) : null}
          <button type="button" onClick={tryClose} className="nb-ib h-9 rounded-[10px] border border-border bg-surface px-4 text-body font-bold text-fg-muted">
            {t('designer:pictureDialog.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            aria-disabled={blocked ? true : undefined}
            aria-describedby={working ? `${ids}-wait` : undefined}
            onClick={() => {
              if (!blocked) apply.mutate();
            }}
            className={`nb-btn inline-flex h-9 items-center gap-2 rounded-[10px] bg-accent px-4 text-body font-bold text-accent-fg ${blocked ? 'cursor-not-allowed opacity-45' : ''}`}
          >
            {apply.isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t('designer:pictureDialog.apply', 'Apply')}
          </button>
        </div>
      </div>
      {confirm ? (
        <div className="absolute inset-0 z-[6] flex items-center justify-center bg-[var(--scrim)] p-5">
          <div role="alertdialog" aria-modal="true" aria-labelledby={`${ids}-leave`} className="flex w-[360px] max-w-full flex-col gap-4 rounded-[14px] border border-border bg-surface p-5 shadow-modal">
            <div id={`${ids}-leave`} className="text-[14px] font-bold leading-[1.4]">
              {t('designer:pictureDialog.leaveAsk', 'Leave without applying {count, plural, one {# change} other {# changes}}?', { count: changes })}
            </div>
            <div className="flex justify-end gap-2.5">
              <button type="button" onClick={() => onOpenChange(false)} className="nb-ib h-9 rounded-[10px] border border-border bg-surface px-4 text-body font-bold text-danger">
                {t('designer:pictureDialog.leave', 'Leave')}
              </button>
              <button type="button" id={`${ids}-keep`} onClick={() => setConfirm(false)} className="nb-btn h-9 rounded-[10px] bg-accent px-4 text-body font-bold text-accent-fg"
              >
                {t('designer:pictureDialog.keep', 'Keep choosing')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ModeControl({ value, onChange, ids }: { value: PicturesMode; onChange: (mode: PicturesMode) => void; ids: string }): ReactNode {
  const options: { value: PicturesMode; label: string }[] = [
    { value: 'choose', label: t('designer:pictureDialog.ask', 'ask me to choose') },
    { value: 'placeholders', label: t('designer:pictureDialog.leavePlaceholders', 'leave placeholders') },
  ];
  return (
    <div role="radiogroup" aria-labelledby={`${ids}-after`} className="flex flex-wrap items-center gap-2">
      <span id={`${ids}-after`} className="text-caption font-bold text-fg-muted">
        {t('designer:pictureDialog.after', 'After each design:')}
      </span>
      <div className="flex gap-0.5 rounded-[10px] bg-surface-3 p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                const other = options.find((one) => one.value !== value) as { value: PicturesMode };
                onChange(other.value);
                (event.currentTarget.parentElement?.querySelector<HTMLElement>(`[aria-checked="false"]`) ?? event.currentTarget).focus();
              }
            }}
            className={`h-[26px] whitespace-nowrap rounded-[6px] px-2.5 text-xs font-bold ${value === option.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DetailsPane({
  opened,
  phone,
  headingId,
  spotName,
  sessionId,
  moreAbout,
  onMoreAbout,
  onClose,
  onUse,
}: {
  opened: Opened;
  phone: boolean;
  headingId: string;
  spotName: string;
  sessionId: string;
  moreAbout: boolean;
  onMoreAbout: () => void;
  onClose: () => void;
  onUse: () => void;
}): ReactNode {
  const moreId = `${headingId}-more`;
  const web = opened.kind === 'found';
  const code: LicenceCode = opened.kind === 'found' ? opened.picture.licence.code : opened.licence;
  const sentence = licenceSentence(code);
  const title = opened.kind === 'found' ? opened.picture.title : opened.name;
  const src = opened.kind === 'found' ? designerApi.pictureThumbUrl(sessionId, opened.shelf, opened.picture.id) : opened.thumb;
  const sourceName = opened.kind === 'found' ? opened.picture.source : code === 'template' ? t('designer:pictureDialog.fromTemplate', 'Your template') : t('designer:pictureDialog.uploaded', 'Uploaded');
  return (
    <div role="region" aria-labelledby={headingId} className="nb-scroll flex min-h-0 flex-1 flex-col overflow-auto bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-border py-2 pe-2.5 ps-4">
        {phone ? (
          <button type="button" onClick={onClose} className="nb-ib -ms-2 inline-flex h-[34px] items-center gap-[5px] rounded-[10px] px-2 text-body font-bold text-fg">
            <ArrowLeft aria-hidden="true" className="size-[15px] rtl:-scale-x-100" />
            {t('designer:pictureDialog.back', 'Back')}
          </button>
        ) : null}
        <span className="flex-1 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('designer:pictureDialog.details', 'Details')}</span>
        {phone ? null : (
          <button type="button" aria-label={t('designer:pictureDialog.closeDetails', 'Close details')} onClick={onClose} className="nb-ib flex size-[30px] items-center justify-center rounded-[10px] text-fg-muted">
            <X aria-hidden="true" className="size-[15px]" />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3.5 p-5">
        <img src={src} alt="" className="block aspect-[16/10] w-full rounded-[10px] object-cover" />
        <div className="flex flex-col gap-[3px]">
          <h3 id={headingId} tabIndex={-1} className="m-0 rounded-[6px] text-[14px] font-bold leading-[1.4] outline-none focus-visible:outline-2 focus-visible:outline-accent">
            <bdi>{title}</bdi>
          </h3>
          {web ? <div className="text-body-sm text-fg-muted">{t('designer:pictureDialog.by', 'by {creator}', { creator: opened.picture.creator })}</div> : null}
          <div className="flex flex-wrap items-center gap-1.5 text-caption text-fg-subtle">
            {web ? <Globe aria-hidden="true" className="size-[13px]" /> : code === 'template' ? <LayoutTemplate aria-hidden="true" className="size-[13px]" /> : <Upload aria-hidden="true" className="size-[13px]" />}
            <span className="font-bold">{sourceName}</span>
            {web && opened.picture.licence.code !== 'pexels' && opened.picture.licence.code !== 'unsplash' ? (
              <>
                <span aria-hidden="true">·</span>
                <span dir="ltr" className="font-mono font-semibold">
                  {opened.picture.licence.name}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-[7px]">
          <LicenceBadgePill code={code} />
          {sentence === null ? null : <p className="m-0 text-pretty text-body-sm">{sentence}</p>}
        </div>
        {web && opened.picture.page !== '' ? (
          <a href={opened.picture.page} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-[5px] self-start text-body-sm font-bold text-accent">
            {t('designer:pictureDialog.openPage', 'Open the picture’s own page')}
            <ArrowUpRight aria-hidden="true" className="size-[13px] rtl:-scale-x-100" />
          </a>
        ) : null}
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex items-start gap-2 text-body-sm text-fg-muted">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
            <span>{t('designer:pictureDialog.note', 'A licence covers the photo, not the people, logos or art in it.')}</span>
          </div>
          <button type="button" aria-expanded={moreAbout} aria-controls={moreId} onClick={onMoreAbout} className="nb-ib ms-4 inline-flex items-center gap-[5px] self-start rounded-[6px] px-1.5 py-[3px] text-xs font-bold text-fg">
            {moreAbout ? <ChevronDown aria-hidden="true" className="size-[13px]" /> : <ChevronRight aria-hidden="true" className="size-[13px] rtl:-scale-x-100" />}
            {t('designer:pictureDialog.moreAbout', 'More about this')}
          </button>
          {moreAbout ? (
            <p id={moreId} className="m-0 text-pretty ps-[22px] text-xs text-fg-muted">
              {t('designer:pictureDialog.moreText', 'For a page that sells something, prefer pictures without recognisable people or brands. Licence details from Openverse come from the original site: check its page before you rely on it.')}
            </p>
          ) : null}
        </div>
      </div>
      <div className="sticky bottom-0 mt-auto border-t border-border bg-surface px-4 py-3">
        <button type="button" onClick={onUse} className="nb-btn h-9 w-full rounded-[10px] bg-accent text-body font-bold text-accent-fg">
          {t('designer:pictureDialog.useFor', 'Use for {spot}', { spot: spotName })}
        </button>
      </div>
    </div>
  );
}

function ChangeRow({
  pick,
  name,
  ids,
  onChange,
  onRemove,
  onSearchAgain,
  onChooseAgain,
}: {
  pick: Pick;
  name: string;
  ids: string;
  onChange: (patch: Partial<Pick>) => void;
  onRemove: () => void;
  onSearchAgain: () => void;
  onChooseAgain: () => void;
}): ReactNode {
  const altId = `${ids}-alt-${pick.target}`;
  const flag =
    pick.flag === 'gone'
      ? { tone: 'bg-warn-soft text-warn', icon: <Search aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />, text: t('designer:pictureDialog.searchAgainLine', 'Search again to use this picture'), action: { label: t('designer:pictureDialog.searchAgain', 'Search again'), onClick: onSearchAgain }, role: 'note' as const }
      : pick.flag === 'small'
        ? { tone: 'bg-info-soft text-info', icon: <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />, text: t('designer:pictureDialog.small', 'Only a small copy of this picture could be used.'), role: 'note' as const }
        : pick.flag === 'conflict'
          ? { tone: 'bg-danger-soft text-danger', icon: <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />, text: t('designer:pictureDialog.conflict', 'Someone changed {spot} since you opened this.', { spot: name }), action: { label: t('designer:pictureDialog.chooseAgain', 'Choose again'), onClick: onChooseAgain }, role: 'alert' as const }
          : null;
  const blank = pick.placeholder || pick.flag === 'gone';
  return (
    <div data-part="change-row" className="flex flex-col gap-2 border-t border-border px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {blank ? <span aria-hidden="true" className={`block h-[26px] w-10 shrink-0 rounded-[6px] ${HATCH}`} /> : <img src={pick.thumb} alt="" className="block h-[26px] w-10 shrink-0 rounded-[6px] object-cover" />}
        <div className="flex min-w-0 flex-[1_1_240px] flex-wrap items-center gap-x-1.5 gap-y-1 text-body">
          <strong className="font-bold">{name}</strong>
          <span aria-hidden="true" className="text-fg-subtle">
            <span className="rtl:hidden">←</span>
            <span className="hidden rtl:inline">→</span>
          </span>
          <span className="sr-only">{t('designer:pictureDialog.gets', 'gets')}</span>
          <span>
            <bdi>{pick.placeholder ? t('designer:pictureDialog.placeholder', 'Placeholder') : pick.title}</bdi>{' '}
            {pick.placeholder || pick.creator === null ? null : <span className="text-fg-muted">{t('designer:pictureDialog.by', 'by {creator}', { creator: pick.creator })}</span>}
          </span>
          {pick.placeholder ? null : (
            <>
              <span aria-hidden="true" className="text-fg-subtle">
                ·
              </span>
              <LicenceBadgePill code={pick.licence} withIcon={false} />
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {pick.flag === 'conflict' ? null : (
            <button type="button" onClick={() => onChange({ placeholder: !pick.placeholder })} className="nb-ib h-[30px] whitespace-nowrap rounded-[10px] px-[9px] text-body-sm font-bold text-fg-muted">
              {pick.placeholder ? t('designer:pictureDialog.usePicture', 'Use the picture') : t('designer:pictureDialog.leavePh', 'Leave as placeholder')}
            </button>
          )}
          <button type="button" aria-label={t('designer:pictureDialog.remove', 'Remove {spot} from what changes', { spot: name })} onClick={onRemove} className="nb-ib flex size-[30px] items-center justify-center rounded-[10px] text-fg-muted">
            <X aria-hidden="true" className="size-[15px]" />
          </button>
        </div>
      </div>
      {pick.placeholder || pick.flag === 'conflict' ? null : (
        <div className="flex flex-wrap items-end gap-x-3.5 gap-y-1.5 ps-[50px]">
          <div className="flex flex-[1_1_260px] flex-col gap-[5px]">
            <label htmlFor={altId} className="text-caption font-bold text-fg-muted">
              {t('designer:pictureDialog.altLabel', 'Describe the picture for people who cannot see it')}
            </label>
            <input
              id={altId}
              type="text"
              value={pick.alt}
              disabled={pick.decorative}
              onChange={(event) => onChange({ alt: event.target.value })}
              className={`h-9 w-full rounded-[10px] border border-border-strong px-[11px] text-body ${pick.decorative ? 'bg-surface-3 text-fg-subtle' : 'bg-surface text-fg'}`}
            />
          </div>
          <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap text-body-sm font-semibold">
            <input type="checkbox" checked={pick.decorative} onChange={() => onChange({ decorative: !pick.decorative })} className="size-[18px] accent-[var(--color-accent)]" />
            {t('designer:pictureDialog.decorative', 'Decorative: say nothing')}
          </label>
        </div>
      )}
      {flag === null ? null : (
        <div role={flag.role} className={`ms-[50px] flex items-start gap-2 rounded-[10px] px-[11px] py-[7px] text-body-sm font-bold leading-normal ${flag.tone}`}>
          {flag.icon}
          <span className="flex-1">{flag.text}</span>
          {'action' in flag && flag.action !== undefined ? (
            <button type="button" onClick={flag.action.onClick} className="whitespace-nowrap border-0 bg-transparent p-0 text-body-sm font-extrabold text-inherit underline underline-offset-2">
              {flag.action.label}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
