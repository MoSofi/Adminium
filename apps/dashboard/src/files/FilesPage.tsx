// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/files` — the workspace file browser (37-files-and-storage.md §3.8, last
 * bullet; task 37-T25).
 *
 * WHAT THIS IS. A SYSTEM page, in the mould of `audit/AuditLogPage.tsx`: a
 * screen over one of Adminium's OWN meta tables (`adminium_files`), reached
 * from the shell, gated by `files.manage`, with no page envelope and no
 * template behind it.
 *
 * WHAT THIS IS NOT — and the confusion is worth heading off, because the two
 * things are one word apart. The `page-files` TEMPLATE browses a file-shaped
 * table in the CUSTOMER's database: their rows, their columns, their folder
 * hierarchy if they modelled one. This page browses the files Adminium itself
 * stored on their behalf. Neither can stand in for the other; a customer's
 * `documents` table has no `destination_id`, and Adminium's file store has no
 * customer columns to render.
 *
 * ── WHY THIS IS NOT THE `file-browser` WIDGET ─────────────────────────────
 *
 * §3.8 says "`FileBrowser` over `GET /files`". It cannot be, and the evidence
 * is in the widget's own contract:
 *
 *  1. **Its rail vocabulary is a closed four-value set.**
 *     `packages/widgets/src/families/media/media-lib.ts:93` fixes
 *     `SMART_FOLDER_FILTERS = ['all', 'starred', 'recent', 'folder']`, and
 *     `media-config.ts:42` mirrors it as a Zod enum so a stored config cannot
 *     add a fifth. The presets this page owes are `state=unattached`,
 *     `state=trash`, `table=…` and `destinationId=…`. Not one of those four
 *     filters can express any of them.
 *
 *  2. **Its navigation model is a folder hierarchy.** `media-config.ts:66`
 *     defaults `parentField: 'parentId'`, `media-lib.ts:276` defines a
 *     synthetic `ROOT_ID`, and `FileBrowser.tsx:41-44` states that opening a
 *     folder re-filters rows ALREADY IN THE PAYLOAD, with the breadcrumb
 *     walked from self-FK parent pointers. Plan §4's first refusal row bans
 *     folders over Adminium's own store outright — files belong to records and
 *     tables, and a second hierarchy is a second product.
 *
 *  3. **Its filtering is client-side over one payload; ours is server-side.**
 *     Every preset here is a different `GET /files` request (`filesQueries.ts`
 *     `buildFilesPath`). Handing the widget a flat list at a fake root would
 *     mean its breadcrumb, its starring and its folder machinery all sitting
 *     inert on screen while the real navigation happened somewhere else.
 *
 * So this is built directly. That is a decision with reasons, not an oversight
 * — and the widget keeps its job: `page-files` over a customer's own table,
 * where folders and stars are the customer's data and mean something.
 *
 * ── THERE IS NO "EMPTY TRASH" BUTTON ──────────────────────────────────────
 *
 * §3.8 lists one, and the wire cannot honour it. Appendix C's routes are the
 * whole file surface, and none of them purges: `DELETE /files/:id`
 * (`apps/server/src/routes/files/index.ts:693`) TRASHES, and its repo call is
 * `markDeleted`, whose UPDATE carries `.where('deletedAt', 'is', null)`
 * (`packages/meta/src/repos/files.ts:175-183`) — so re-deleting a trashed file
 * updates zero rows. A button looping `DELETE` over the trash would be a
 * control that does nothing at all. Bytes leave only via the daily
 * retention sweep (D12), so the trash preset says that plainly instead of
 * offering a lever that is not connected to anything.
 *
 * ── DELETE IS SOFT, SO IT ASKS NOTHING ────────────────────────────────────
 *
 * D12: delete trashes, and the toast offers Undo. A confirm dialog in front of
 * a reversible action trains people to dismiss dialogs, which is exactly the
 * habit you want them out of by the time one is irreversible.
 *
 * ── COPY IS A GATE HERE (Appendix D, 17 §2) ───────────────────────────────
 *
 * The usage strip says "128 GB used" and, for a local destination only,
 * "41 GB available on this disk". Never a denominator, never "free", never a
 * quota, plan, tier or upgrade. The comp's "128.4 GB of 200 GB" meter is a
 * defect, not a spec: Adminium sells nobody storage, so a capacity fraction
 * would be a number with nothing behind it. `filesPage.test.tsx` asserts no
 * byte figure is ever followed by " of ".
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  KeyValueList,
  MonoText,
  SearchInput,
  Spinner,
  cn,
  IconTile,
} from '@adminium/ui';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import { FILE_KIND_TONE, fileIconFor, kindOf } from '@adminium/widgets';
import {
  Clock,
  Database,
  Download,
  FileStack,
  HardDrive,
  LayoutGrid,
  List,
  RotateCcw,
  Table2,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';

import { bootstrapQuery } from '../app/bootstrap.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';
import { formatStamp } from '../team/teamApi.js';
import { useAppToasts } from '../pages/toasts.js';
import { deleteFile, restoreFile, type FileDto } from './api.js';
import {
  ALL_FILES_FILTERS,
  FILES_QUERY_KEY,
  LOCAL_DESTINATION_VALUE,
  RECENT_WINDOW_MS,
  diskCapacityOf,
  filesConnectionsQuery,
  filesQuery,
  filesUsageQuery,
  formatBytes,
  sameFilters,
  tablePresets,
  type FilesConnection,
  type FilesFilters,
  type StorageUsageEntry,
  type TablePreset,
} from './filesQueries.js';
import { UploadFilesDialog } from './UploadFilesDialog.js';

/**
 * A file's destination, named — and the `null` case is the whole point.
 *
 * `destination_id IS NULL` genuinely means this server's disk (37 D3), and
 * that is the only thing that may render as "This server's disk". A map MISS
 * is a different fact: the usage query has not resolved yet, or it 403'd
 * because the caller holds neither `files.manage` nor `storage.manage`, or the
 * destination row was deleted after the file was written. Collapsing all three
 * into the local label tells the operator their invoices are on this box when
 * they are in a bucket — which is exactly the question the Files page exists
 * to answer. An unresolved id renders as the id.
 */
function destinationLabel(
  destinationId: string | null,
  // Keyed by `string | null` because the usage reply carries the implicit
  // destination as a `null` row — but that entry is deliberately NOT consulted
  // here: the local label is decided by the file, not by whether a usage query
  // happened to resolve.
  names: ReadonlyMap<string | null, string>,
): string {
  if (destinationId === null) return t('common:files.row.localDestination', "This server's disk");
  return names.get(destinationId) ?? destinationId;
}


export function FilesPage(): ReactNode {
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const [filters, setFilters] = useState<FilesFilters>(ALL_FILES_FILTERS);
  const [open, setOpen] = useState<FileDto | null>(null);

  // Not a suspense query, for the AuditLogPage reason: the search box rewrites
  // the query key on every keystroke, and a suspense hook would throw the whole
  // screen — search box included — to the route fallback each time, so the
  // control you are typing into vanishes from under the cursor.
  const files = useInfiniteQuery(filesQuery(filters));
  // The strip is independent of the list and of the preset: it answers "where
  // do this workspace's bytes live", which does not change when you click
  // Trash. An error here is not the page's error — a reader who holds
  // `files.manage` but not `storage.manage` still gets the list.
  const usage = useQuery(filesUsageQuery());
  // Names for the By-connection rail group. Refused for a file-tidying
  // operator who lacks `connections.manage`, in which case the group simply
  // does not draw — see `filesConnectionsQuery`.
  const connections = useQuery(filesConnectionsQuery());
  /**
   * Grid or list, per the comp's toggle. Per-viewer taste, so it is local.
   *
   * TILES BY DEFAULT, which is what the comp opens on: a file is recognised by
   * its name and type far more often than by the record it hangs off, and the
   * list's extra columns are there for when that is the question.
   */
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [uploading, setUploading] = useState(false);

  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  const rows = useMemo(() => files.data?.pages.flatMap((page) => page.data) ?? [], [files.data]);
  const tables = useMemo(() => tablePresets(rows), [rows]);
  const destinations = useMemo(() => usage.data ?? [], [usage.data]);
  const destinationNames = useMemo(
    () => new Map(destinations.map((entry) => [entry.destinationId, entry.name])),
    [destinations],
  );
  const connectionNames = useMemo(
    () => new Map((connections.data ?? []).map((entry) => [entry.id, entry.name])),
    [connections.data],
  );

  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  // One prefix covers the list AND the usage strip (see FILES_QUERY_KEY):
  // trashing a file changes both, and a strip left showing the old figure is a
  // wrong number the reader has no way to catch.
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY });
  }, [queryClient]);

  const failed = useCallback(
    (title: string, error: unknown) => {
      toasts.push({
        variant: 'error',
        title,
        description: error instanceof Error ? error.message : undefined,
      });
    },
    [toasts],
  );

  const restore = useCallback(
    (file: FileDto) => {
      restoreFile(file.id)
        .then(() => {
          refresh();
          toasts.push({
            variant: 'success',
            title: t('common:files.toast.restored', '{name} was restored', { name: file.filename }),
          });
        })
        .catch((error: unknown) => {
          failed(t('common:files.toast.restoreFailed', 'Could not restore this file'), error);
        });
    },
    [failed, refresh, toasts],
  );

  const trash = useCallback(
    (file: FileDto) => {
      // No confirm: this is reversible for the retention window (D12), and the
      // Undo below is both the safety net and the explanation of what happened.
      deleteFile(file.id)
        .then(() => {
          refresh();
          setOpen((current) => (current?.id === file.id ? null : current));
          toasts.push({
            variant: 'success',
            title: t('common:files.toast.trashed', '{name} was moved to the trash', {
              name: file.filename,
            }),
            action: {
              label: t('common.undo', 'Undo'),
              onAction: () => restore(file),
            },
          });
        })
        .catch((error: unknown) => {
          failed(t('common:files.toast.trashFailed', 'Could not move this file to the trash'), error);
        });
    },
    [failed, refresh, restore, toasts],
  );

  const select = useCallback((next: Omit<FilesFilters, 'q'>) => {
    // The search term survives a preset change on purpose: "invoice.pdf, but in
    // the trash" is one thought, and making the reader retype it would make it
    // two.
    setFilters((current) => ({ ...next, q: current.q }));
  }, []);

  const searching = filters.q !== '';
  const narrowed =
    filters.state !== 'live' ||
    filters.table !== null ||
    filters.destinationId !== null ||
    filters.connectionId !== null ||
    filters.since !== null;

  // When the rail's per-table counts are exact, and therefore when they may be
  // shown at all. They are derived from the rows on screen, so they are right
  // only when the rows on screen ARE the result set the entry would query:
  // every page loaded, and no destination narrowing in force (a table entry
  // drops that, so its count would be over a smaller set than its own query
  // returns). Anywhere else the entry stays — it just carries no number,
  // because a count that is quietly "some of them" is worse than none.
  const exactCounts = files.hasNextPage !== true && filters.destinationId === null;

  return (
    <PageSurface width="wide" className="flex flex-col gap-5" data-testid="files-page">
      <PageActions
        title={t('common:files.title', 'Files')}
        subtitle={t(
          'common:files.subtitle',
          'Everything uploaded through this workspace, and where its bytes are stored.',
        )}
      />

      {/*
        The comp's header row: the page's own title on the left, and every
        control that acts on the WHOLE page on the right — search, the view
        toggle, Upload. They were inside the results card before, which put
        "search everything" inside the thing it searches and left the page with
        no header of its own.
      */}
      {/*
        No in-page <h1>: the shell's topbar already carries this page's title
        and subtitle through `PageActions`, and the comp's own header is that
        title plus these controls. Repeating it here would put "Files" on the
        screen twice, one line apart.
      */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <SearchInput
            className="min-w-52 max-w-xs flex-1"
            value={filters.q}
            placeholder={t('common:files.search', 'Search by file name')}
            aria-label={t('common:files.search', 'Search by file name')}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            onClear={() => setFilters({ ...filters, q: '' })}
            clearLabel={t('common.clear', 'Clear')}
          />
          <div
            className="flex shrink-0 items-center rounded-md border border-border p-0.5"
            role="group"
            aria-label={t('common:files.view.label', 'How files are shown')}
          >
            <IconToggle
              active={view === 'grid'}
              label={t('common:files.view.grid', 'Grid')}
              onClick={() => setView('grid')}
              testId="files-view-grid"
            >
              <LayoutGrid aria-hidden className="size-4" />
            </IconToggle>
            <IconToggle
              active={view === 'list'}
              label={t('common:files.view.list', 'List')}
              onClick={() => setView('list')}
              testId="files-view-list"
            >
              <List aria-hidden className="size-4" />
            </IconToggle>
          </div>
          {/*
            A file always belongs to a CONNECTION (38 D4), so with none
            configured there is nowhere to put one and the button would open a
            dialog that could only refuse.
          */}
          {(connections.data ?? []).length === 0 ? null : (
            <Button
              size="sm"
              iconLeft={<Upload aria-hidden className="size-4" />}
              onClick={() => setUploading(true)}
              data-testid="files-upload-open"
            >
              {t('common:files.upload.open', 'Upload')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/*
          The rail carries the Storage card at its foot, where the comp puts
          it. It was a full-width strip across the top, which gave the loudest
          position on the page to a figure nobody came here to read.
        */}
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-60">
          <PresetRail
            filters={filters}
            connections={connections.data ?? []}
            tables={tables}
            destinations={destinations}
            showCounts={exactCounts}
            onSelect={select}
          />
          <UsageStrip entries={destinations} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
            {filters.state === 'trash' ? (
              <div className="px-4 pt-4">
                <Alert
                  tone="info"
                  data-testid="files-trash-notice"
                  title={t('common:files.trash.notice.title', 'The trash empties itself')}
                  body={t(
                    'common:files.trash.notice.body',
                    "A trashed file is removed, bytes and all, once this server's retention window has passed. Restore anything you still need before then.",
                  )}
                />
              </div>
            ) : null}

            {files.isPending ? (
              <div className="flex items-center justify-center gap-2 p-8 text-body-sm text-fg-muted">
                <Spinner size="sm" />
                {t('common.loading', 'Loading')}
              </div>
            ) : files.isError ? (
              <div className="p-4">
                <Alert
                  role="alert"
                  tone="danger"
                  data-testid="files-list-error"
                  title={t('common:files.listFailed.title', 'Could not load these files')}
                  body={files.error.message}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void files.refetch()}>
                      {t('common.retry', 'Retry')}
                    </Button>
                  }
                />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                compact
                preset={searching || narrowed ? 'no-matches' : 'no-data'}
                icon={<FileStack />}
                title={
                  searching || narrowed
                    ? t('common:files.empty.filtered.title', 'Nothing here')
                    : t('common:files.empty.title', 'No files yet')
                }
                body={
                  searching || narrowed
                    ? t(
                        'common:files.empty.filtered.body',
                        'Clear the search, or pick another shortcut from the rail.',
                      )
                    : t(
                        'common:files.empty.body',
                        'Files land here when someone attaches one to a record or fills a file field.',
                      )
                }
                data-testid="files-empty"
              />
            ) : (
              view === 'grid' ? (
                <FilesGrid rows={rows} localeTag={localeTag} onInspect={setOpen} />
              ) : (
                <FilesTable
                  rows={rows}
                  state={filters.state}
                  localeTag={localeTag}
                  destinationNames={destinationNames}
                  connectionNames={connectionNames}
                  onInspect={setOpen}
                  onTrash={trash}
                  onRestore={restore}
                />
              )
            )}

            {/* Paging lives with the results, not at the foot of the page. */}
            {files.hasNextPage === true ? (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  loading={files.isFetchingNextPage}
                  onClick={() => void files.fetchNextPage()}
                  data-testid="files-load-more"
                >
                  {t('common:files.loadMore', 'Load more files')}
                </Button>
              </div>
            ) : null}
        </div>
      </div>

      <FileDrawer
        file={open}
        localeTag={localeTag}
        destinationNames={destinationNames}
        onClose={() => setOpen(null)}
      />

      {uploading ? (
        <UploadFilesDialog
          connections={connections.data ?? []}
          // Pre-set to whatever the rail is looking at: uploading while
          // standing in a connection means uploading INTO it.
          {...(filters.connectionId === null ? {} : { connectionId: filters.connectionId })}
          onClose={() => setUploading(false)}
          onUploaded={refresh}
        />
      ) : null}
    </PageSurface>
  );
}

/* --- the usage strip (D23) --------------------------------------------------- */

/**
 * Bytes per destination, as facts.
 *
 * Read the copy rules before touching this: "{size} used" stands alone, and the
 * only second figure is a LOCAL disk's own available space, which is a separate
 * sentence and not the bottom of a fraction. Appendix D bans the denominator,
 * "free", and every word that would turn a fact into an offer.
 */
function UsageStrip({ entries }: { entries: readonly StorageUsageEntry[] }): ReactNode {
  if (entries.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="files-usage-strip"
      aria-label={t('common:files.usage.label', 'Storage in use')}
      role="group"
    >
      {entries.map((entry) => {
        // Only a local disk reports one; a bucket returns no `available` and
        // therefore gets no meter (D10).
        const capacity = diskCapacityOf(entry);
        return (
        <Card key={entry.destinationId ?? LOCAL_DESTINATION_VALUE} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <HardDrive aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg">{entry.name}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-body-sm font-semibold text-fg" data-testid="files-usage-used">
              {t('common:files.usage.used', '{size} used', { size: formatBytes(entry.bytes) })}
            </span>
            <span className="text-caption text-fg-muted">
              {t('common:files.usage.count', '{count, plural, one {# file} other {# files}}', {
                count: entry.files,
              })}
            </span>
          </div>
          {/*
            THE ONE PLACE A FRACTION IS HONEST (38 D10).

            37 Appendix D banned "N of M" outright, and it was right about
            buckets: a bucket has no capacity, so a denominator would be a
            number with nothing behind it. A local disk genuinely has a size —
            `available` is what `statfs` reported — and hiding it does not make
            the disk bigger. So the meter is drawn for a LOCAL destination and
            never for anything else, and the ban stands everywhere it applies.

            Still never "free", never a quota, never an upgrade: this is the
            operator's own hardware, not a plan they are being sold.
          */}
          {capacity === null ? null : (
            <div className="flex flex-col gap-1" data-testid="files-usage-meter">
              <div
                role="meter"
                aria-label={t('common:files.usage.diskLabel', 'Disk in use')}
                aria-valuenow={Math.round((entry.bytes / capacity) * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-surface-3"
              >
                <div
                  className="h-full w-[var(--adm-fill)] rounded-full bg-accent"
                  style={{ '--adm-fill': `${String(Math.min(100, Math.round((entry.bytes / capacity) * 100)))}%` }}
                />
              </div>
              <span className="text-caption text-fg-muted" data-testid="files-usage-capacity">
                {t('common:files.usage.ofDisk', '{used} of {size} on this disk', {
                  used: formatBytes(entry.bytes),
                  size: formatBytes(capacity),
                })}
              </span>
            </div>
          )}
        </Card>
        );
      })}
    </div>
  );
}

/* --- the preset rail --------------------------------------------------------- */

interface PresetRailProps {
  filters: FilesFilters;
  /** Every connection, from the server — see `filesConnectionsQuery`. */
  connections: readonly FilesConnection[];
  tables: readonly TablePreset[];
  destinations: readonly StorageUsageEntry[];
  /** Are the derived per-table counts exact right now? See `exactCounts`. */
  showCounts: boolean;
  onSelect: (next: Omit<FilesFilters, 'q'>) => void;
}

/**
 * The rail. Every entry is a SERVER query, not a view over what is loaded —
 * clicking one changes `GET /files`'s parameters and refetches.
 *
 * The plan calls these "smart folders". They are not folders and this page
 * never says the word: §4 refuses a hierarchy over Adminium's own store, and
 * calling a saved query a folder is how a hierarchy gets asked for next.
 */
function PresetRail({ filters, connections, tables, destinations, showCounts, onSelect }: PresetRailProps): ReactNode {
  const base = { connectionId: null, table: null, destinationId: null, since: null } as const;
  return (
    <nav
      className="flex w-full shrink-0 flex-col gap-4 lg:w-60"
      aria-label={t('common:files.rail.label', 'File shortcuts')}
      data-testid="files-rail"
    >
      <ul className="flex flex-col gap-0.5">
        <PresetItem
          id="all"
          icon={<FileStack aria-hidden className="size-4" />}
          label={t('common:files.preset.all', 'All files')}
          target={{ ...base, state: 'live' }}
          filters={filters}
          onSelect={onSelect}
        />
        <PresetItem
          id="recent"
          icon={<Clock aria-hidden className="size-4" />}
          label={t('common:files.preset.recent', 'Recent')}
          // A server query like every other preset — `since` becomes a request
          // parameter, so it finds files this client has never loaded.
          target={{ ...base, state: 'live', since: Date.now() - RECENT_WINDOW_MS }}
          filters={filters}
          onSelect={onSelect}
        />
        <PresetItem
          id="unattached"
          icon={<Unlink aria-hidden className="size-4" />}
          label={t('common:files.preset.unattached', 'Not attached')}
          target={{ ...base, state: 'unattached' }}
          filters={filters}
          onSelect={onSelect}
        />
        <PresetItem
          id="trash"
          icon={<Trash2 aria-hidden className="size-4" />}
          label={t('common:files.preset.trash', 'Trash')}
          target={{ ...base, state: 'trash' }}
          filters={filters}
          onSelect={onSelect}
        />
      </ul>

      {connections.length === 0 ? null : (
        <section className="flex flex-col gap-1" data-testid="files-rail-connections">
          <RailHeading>{t('common:files.rail.byConnection', 'By connection')}</RailHeading>
          <ul className="flex flex-col gap-0.5">
            {connections.map((entry) => (
              <PresetItem
                key={entry.id}
                id={`connection-${entry.id}`}
                icon={<Database aria-hidden className="size-4" />}
                label={entry.name}
                // No table: since 38 D4 a connection alone is a real query,
                // and it is the only preset that finds a LIBRARY file — one
                // that belongs to the workspace and to no record.
                target={{ ...base, state: filters.state, connectionId: entry.id }}
                filters={filters}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      )}

      {tables.length === 0 ? null : (
        <section className="flex flex-col gap-1" data-testid="files-rail-tables">
          <RailHeading>{t('common:files.rail.byTable', 'By table')}</RailHeading>
          <ul className="flex flex-col gap-0.5">
            {tables.map((entry) => (
              <PresetItem
                key={`${entry.connectionId} ${entry.table}`}
                // Keyed on the CONNECTION too: two connections can both expose
                // `public.invoices`, and the React key and the query already
                // distinguish them — only the test id did not, so the page's own
                // test had to reach for `getAllByTestId`.
                id={`table-${entry.connectionId}-${entry.table}`}
                icon={<Table2 aria-hidden className="size-4" />}
                /* i18n-exempt: a table name is the customer's data, not copy. */
                label={entry.table}
                count={showCounts ? entry.files : undefined}
                target={{
                  state: filters.state,
                  connectionId: entry.connectionId,
                  table: entry.table,
                  destinationId: null,
                  since: null,
                }}
                filters={filters}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      )}

      {destinations.length === 0 ? null : (
        <section className="flex flex-col gap-1" data-testid="files-rail-destinations">
          <RailHeading>{t('common:files.rail.byDestination', 'By destination')}</RailHeading>
          <ul className="flex flex-col gap-0.5">
            {destinations.map((entry) => (
              <PresetItem
                key={entry.destinationId ?? LOCAL_DESTINATION_VALUE}
                id={`destination-${entry.destinationId ?? LOCAL_DESTINATION_VALUE}`}
                icon={<HardDrive aria-hidden className="size-4" />}
                /* i18n-exempt: a destination is named by the operator who added it. */
                label={entry.name}
                target={{
                  state: filters.state,
                  connectionId: null,
                  table: null,
                  destinationId: entry.destinationId ?? LOCAL_DESTINATION_VALUE,
                  since: null,
                }}
                filters={filters}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}

function RailHeading({ children }: { children: ReactNode }): ReactNode {
  return <h2 className="px-2 text-micro uppercase text-fg-subtle">{children}</h2>;
}

interface PresetItemProps {
  id: string;
  icon: ReactNode;
  label: string;
  /** Rows SEEN so far, not a total — see `tablePresets`. Omitted where unknown. */
  count?: number | undefined;
  target: Omit<FilesFilters, 'q'>;
  filters: FilesFilters;
  onSelect: (next: Omit<FilesFilters, 'q'>) => void;
}

function PresetItem({ id, icon, label, count, target, filters, onSelect }: PresetItemProps): ReactNode {
  const active = sameFilters(filters, { ...target, q: filters.q });
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        data-testid={`files-preset-${id}`}
        onClick={() => onSelect(target)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-body-sm',
          active ? 'bg-accent-soft font-semibold text-accent' : 'text-fg-muted hover:bg-surface-2',
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-start">{label}</span>
        {count === undefined ? null : <Badge tone="neutral">{String(count)}</Badge>}
      </button>
    </li>
  );
}

/* --- the table --------------------------------------------------------------- */

interface FilesTableProps {
  rows: readonly FileDto[];
  state: FilesFilters['state'];
  localeTag: string;
  destinationNames: ReadonlyMap<string | null, string>;
  /** Connection id → its name, for a file that belongs to no record (D18). */
  connectionNames: ReadonlyMap<string, string>;
  onInspect: (file: FileDto) => void;
  onTrash: (file: FileDto) => void;
  onRestore: (file: FileDto) => void;
}

function FilesTable(props: FilesTableProps): ReactNode {
  const trashed = props.state === 'trash';
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[52rem] text-body-sm" data-testid="files-table">
        <thead>
          <tr className="border-b border-border text-micro uppercase text-fg-subtle">
            <th scope="col" className="px-4 py-2 text-start font-bold">
              {t('common:files.column.name', 'File')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-bold">
              {t('common:files.column.size', 'Size')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-bold">
              {t('common:files.column.attachedTo', 'Attached to')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-bold">
              {t('common:files.column.destination', 'Destination')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-bold">
              {t('common:files.column.added', 'Added')}
            </th>
            <th scope="col" className="px-4 py-2 text-end font-bold">
              {t('common:files.column.actions', 'Actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((file) => (
            <tr key={file.id} className="border-b border-border/60 last:border-0" data-testid="files-row">
              <td className="px-4 py-2.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-col text-start"
                  onClick={() => props.onInspect(file)}
                  data-testid="files-row-inspect"
                >
                  <span className="truncate font-semibold text-fg">{file.filename}</span>
                  <MonoText className="truncate text-caption text-fg-subtle">{file.mime}</MonoText>
                </button>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-fg-muted">{formatBytes(file.sizeBytes)}</td>
              <td className="px-4 py-2.5">
                {file.entity === null ? (
                  // A library file belongs to a CONNECTION and to no row
                  // (38 D4/D18). Saying only "Not attached" would leave the
                  // reader with no idea which source it was uploaded for.
                  <div className="flex min-w-0 flex-col">
                    <span className="text-fg-subtle">
                      {t('common:files.row.noRecord', 'Not attached to a record')}
                    </span>
                    {file.connectionId === null ? null : (
                      <MonoText className="truncate text-caption text-fg-subtle">
                        {props.connectionNames.get(file.connectionId) ?? file.connectionId}
                      </MonoText>
                    )}
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-fg">{file.entity.table}</span>
                    <MonoText className="truncate text-caption text-fg-subtle">
                      {file.entity.recordId}
                    </MonoText>
                  </div>
                )}
              </td>
              <td className="px-4 py-2.5 text-fg-muted">{destinationLabel(file.destinationId, props.destinationNames)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-fg-muted">
                {formatStamp(file.createdAt, props.localeTag)}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  {trashed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<RotateCcw aria-hidden className="size-4" />}
                      onClick={() => props.onRestore(file)}
                      data-testid="files-row-restore"
                    >
                      {t('common:files.action.restore', 'Restore')}
                    </Button>
                  ) : (
                    <>
                      {/*
                        A plain anchor, not a fetch: the content route answers
                        with `content-disposition: attachment` and a private
                        cache header, so the browser's own download machinery is
                        already correct. Trashed bytes 404 there by design
                        (D12), which is why this is absent — not disabled — in
                        the trash.
                      */}
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        data-testid="files-row-download"
                      >
                        <a href={file.contentPath} download={file.filename} rel="noopener">
                          <Download aria-hidden className="size-4" />
                          {t('common:files.action.download', 'Download')}
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger hover:text-danger"
                        iconLeft={<Trash2 aria-hidden className="size-4" />}
                        aria-label={t('common:files.action.deleteNamed', 'Delete {name}', {
                          name: file.filename,
                        })}
                        onClick={() => props.onTrash(file)}
                        data-testid="files-row-delete"
                      >
                        {t('common:files.action.delete', 'Delete')}
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --- the details drawer ------------------------------------------------------ */

/**
 * What the row cannot fit: the checksum, the uploader, the attach stamp.
 *
 * `file === null` keeps it closed AND unmounted, so a stale file never flashes
 * behind the close animation of the one before it.
 */
function FileDrawer(props: {
  file: FileDto | null;
  localeTag: string;
  destinationNames: ReadonlyMap<string | null, string>;
  onClose: () => void;
}): ReactNode {
  const { file } = props;
  if (file === null) return null;

  const none = t('common:files.drawer.none', 'None');
  return (
    <Drawer
      open
      size="md"
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <DrawerHeader
        title={file.filename}
        subtitle={t('common:files.drawer.subtitle', '{size} · {type}', {
          size: formatBytes(file.sizeBytes),
          type: file.mime,
        })}
        closeLabel={t('common.close', 'Close')}
      />
      <DrawerBody className="flex flex-col gap-5">
        <KeyValueList
          items={[
            {
              label: t('common:files.drawer.destination', 'Destination'),
              value: destinationLabel(file.destinationId, props.destinationNames),
            },
            {
              label: t('common:files.drawer.attachedTo', 'Attached to'),
              value:
                file.entity === null
                  ? t('common:files.row.unattached', 'Not attached')
                  : `${file.entity.table} · ${file.entity.recordId}`,
              mono: file.entity !== null,
            },
            {
              label: t('common:files.drawer.uploadedBy', 'Uploaded by'),
              value: file.uploadedBy ?? none,
              mono: true,
            },
            {
              label: t('common:files.drawer.added', 'Added'),
              value: formatStamp(file.createdAt, props.localeTag) ?? none,
            },
            {
              label: t('common:files.drawer.attachedAt', 'Attached'),
              value: formatStamp(file.attachedAt, props.localeTag) ?? none,
            },
            ...(file.deletedAt === null
              ? []
              : [
                  {
                    label: t('common:files.drawer.trashedAt', 'Moved to trash'),
                    value: formatStamp(file.deletedAt, props.localeTag) ?? none,
                  },
                ]),
            { label: t('common:files.drawer.id', 'File id'), value: file.id, mono: true },
          ]}
        />

        <section className="flex flex-col gap-2">
          <h3 className="text-section text-fg">{t('common:files.drawer.checksum', 'Checksum')}</h3>
          <MonoText className="break-all text-caption text-fg-muted">{file.sha256}</MonoText>
        </section>
      </DrawerBody>
    </Drawer>
  );
}

/** One half of the comp's grid/list segmented control. */
function IconToggle({
  active,
  label,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded',
        active ? 'bg-surface-3 text-fg' : 'text-fg-subtle hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The comp's tile view (38 D9).
 *
 * The SAME rows the list draws, laid out differently — no second query and no
 * second filter. Deliberately smaller than the list: a tile has room for a
 * name, a size and a date, and the things the list adds (which record owns
 * this, which destination holds it) are what the drawer is for. Clicking a
 * tile opens that drawer, exactly as clicking a name in the list does.
 */
function FilesGrid({
  rows,
  localeTag,
  onInspect,
}: {
  rows: readonly FileDto[];
  localeTag: string;
  onInspect: (file: FileDto) => void;
}): ReactNode {
  return (
    <ul
      className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      data-testid="files-grid"
    >
      {rows.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            onClick={() => onInspect(file)}
            data-testid="files-grid-tile"
            className="flex w-full flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-start hover:border-accent/40"
          >
            {/*
              The type icon the comp draws, from the vocabulary the media
              family already owns — so a PDF here looks like a PDF in an
              attachment list and on a `page-files` page, rather than being a
              third opinion about what a PDF looks like.
            */}
            <IconTile size="md" tone={FILE_KIND_TONE[kindOf(undefined, file.mime, file.filename)]}
              icon={fileIconFor(undefined, file.mime, file.filename)} />
            <span className="truncate text-body-sm font-semibold text-fg">{file.filename}</span>
            <span className="text-caption text-fg-muted">
              {`${formatBytes(file.sizeBytes)} · ${formatStamp(file.createdAt, localeTag)}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
