// SPDX-License-Identifier: AGPL-3.0-only
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  KeyValueList,
  KeyValueRow,
  MonoText,
  Spinner,
  Tabs,
  Tag,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastStack,
  useToastQueue,
} from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { RecordFormDialog } from '../page-crud/RecordFormDialog.js';
import type { ControlOption } from '../page-crud/controls/index.js';
import type { FormRelationFact } from '../../page-config/index.js';
import { isDeletePreview } from '../page-crud/crud-api.js';
import type {
  CrudApi,
  CrudGetResult,
  CrudListParams,
  CrudListResult,
  CrudReferenceCount,
  CrudRow,
  CrudSort,
} from '../page-crud/crud-api.js';
import { AttachmentList } from '../../families/media/AttachmentList.js';
import { UploadDropzone } from '../../families/media/UploadDropzone.js';
import { UploadProgressList } from '../../families/media/UploadProgressList.js';
import { DataGrid } from '../../families/tables/DataGrid.js';
import { DetailKeyValue } from '../../families/tables/DetailKeyValue.js';
import { PaginationFooter } from '../../families/tables/PaginationFooter.js';
import { CellValue } from '../../families/tables/cells.js';
import type { CellContext } from '../../families/tables/cells.js';
import { displayValueOf, rowIdOf } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import { TimelineVertical } from '../../families/feeds/TimelineVertical.js';
import type { TimelineEntry } from '../../families/feeds/feeds-types.js';
import type { WidgetEvent } from '../../registry/types.js';

/**
 * `page-record` — the record detail page (Customer 360 comp): the template
 * every generated `page-crud` body has named in `config.detail.template`
 * since the body vocabulary was written, now rendered for real at
 * `/p/$slug/r/$recordId`.
 *
 * Composition: key-field hero (+ status/timestamp meta and Edit/Delete per
 * grants and `readOnly`), the `detail-key-value` field grid (two columns at
 * `lg`), then one tab per `detail.tabs[]` entry — each a REAL paginated
 * `data-grid` over the referencing table, count-pilled from
 * `referenceCounts` — plus the per-record Activity timeline when the host
 * wires one (absent otherwise).
 *
 * All data access flows through the injected seams: the page's own `CrudApi`,
 * a `PageRecordRelated` host adapter for the referencing tables (list +
 * column resolution + linkability), and a `RecordActivityFeed` for the
 * audit-backed timeline. Widgets never import the dashboard's api layer.
 */

export const PAGE_RECORD_TEMPLATE_ID = 'page-record';

/** Default related-tab page size — a record's related list, not a workbench. */
const RELATED_PAGE_SIZE = 10;

/** One `detail.tabs[]` entry, as stored (schema). */
export interface PageRecordTabConfig {
  /** Referencing table id ("public.invoice_items"). */
  table: string;
  /** FK column into this page's table; absent ⇒ counts only, no body. */
  fkColumn?: string | undefined;
  label?: string | undefined;
}

/** Grid metadata for a referencing table that has its own page. */
export interface PageRecordRelatedResolution {
  columns: readonly GridColumnSpec[];
  defaultSort: CrudSort | null;
  /**
   * May the caller CREATE rows of this table (the in-tab "New row" flow)?
   * Resolved by the host from the target page's own reply — its per-caller
   * `canCreate` and its `readOnly` — so the tab never offers a button the
   * server would 403 or the target page itself refuses. Absent means "not
   * computed" and the button stays hidden: unlike the page-level write
   * capabilities (where absent defaults open for older servers), this
   * affordance is NEW, so nothing regresses by requiring the signal.
   */
  canCreate?: boolean | undefined;
}

/** Host adapter for the related-record tabs. */
export interface PageRecordRelated {
  /** List rows of `table` — the host's CrudApi bound to that table. */
  list(table: string, params: CrudListParams): Promise<CrudListResult>;
  /**
   * The table's own page metadata (its column specs + default sort), or null
   * when no page shows it — the tab then derives text columns from the rows.
   */
  resolve(table: string): Promise<PageRecordRelatedResolution | null>;
  /** Whether rows of `table` navigate to that table's record page. */
  linkable(table: string): boolean;
  /**
   * The host's full CrudApi bound to `table` — what the in-tab create writes
   * through (and where its FK combobox lookups come from). Optional so hosts
   * and fixtures predating the flow keep working; without it the tab is
   * read-only exactly as before.
   */
  api?(table: string): CrudApi | null;
}

/** One per-record audit entry, already shaped for display. */
export interface RecordActivityEntry {
  id: string;
  /** Actor display label ("Ava Reyes"). */
  actorLabel: string;
  /** Dotted verb — `record.create` / `record.update` / `record.delete` / `record.undo`. */
  action: string;
  /** Epoch ms. */
  at: number;
  /** Changed-column count — never the images themselves. */
  changedFields?: number | undefined;
}

export interface RecordActivityPage {
  entries: RecordActivityEntry[];
  nextCursor: string | null;
}

/** Host adapter over the audit entity filter (30 WS-A). */
export interface RecordActivityFeed {
  list(params: { cursor?: string | undefined }): Promise<RecordActivityPage>;
}

/** One sidecar attachment, as the panel shows it. */
export interface RecordAttachment {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: number;
  /** Same-origin path — never a destination's public URL. */
  contentPath: string;
}

/**
 * Host adapter for record attachments.
 *
 * ONE PANEL, TWO ADAPTERS. The four calls below say nothing about where the
 * files live, and that is deliberate — the host decides:
 *
 *   - SIDECAR (37): linked on Adminium's side only, through
 *     `entity_connection_id` / `entity_table` / `entity_id`. Needs no column in
 * the customer's table, so it works on a READ-ONLY source — which after is the
 *     only reason it still exists.
 *   - COLUMN (38): the page's `config.attachments.column` names a column on the
 *     customer's own table holding a JSON list of references. `list` reads that
 *     value, `upload`/`remove` write it back through the CRUD route, and the
 *     server's reconcile hook attaches and trashes accordingly.
 *
 * Keeping the seam here rather than branching inside the panel is what lets the
 * component stay unaware: it renders a list, a dropzone and an undo, and the
 * two modes differ only in what the promises do.
 *
 * ABSENT ⇒ NO PANEL, exactly like `related` and `activity`. A page whose
 * `config.attachments` is off passes nothing and renders as it always did.
 */
export interface PageRecordAttachments {
  list(): Promise<RecordAttachment[]>;
  upload(input: {
    file: File;
    signal: AbortSignal;
    onProgress: (fraction: number) => void;
  }): Promise<RecordAttachment>;
  remove(fileId: string): Promise<void>;
  /** Restore a file the panel just removed — the undo affordance. */
  restore?(fileId: string): Promise<void>;
}

export interface PageRecordLabels {
  edit?: string | undefined;
  delete?: string | undefined;
  close?: string | undefined;
  dismiss?: string | undefined;
  undo?: string | undefined;
  activityTab?: string | undefined;
  attachmentsTab?: string | undefined;
}

export interface PageRecordProps {
  api: CrudApi;
  columns: readonly GridColumnSpec[];
  /** Page scope (envelope `source`) — events carry it. */
  source: { connectionId: string | null; table: string };
  recordId: string;
  /** Singular entity noun for domain framing ("invoice"). */
  entityName?: string | undefined;
  /** `config.keyField` — hero headline column; falls back to the display value. */
  keyField?: string | null | undefined;
  /** `config.readOnly` — no write affordance anywhere on the page. */
  readOnly?: boolean | undefined;
  /** `config.detail.tabs`. */
  tabs?: readonly PageRecordTabConfig[] | undefined;
  related?: PageRecordRelated | undefined;
  /** Absent/null ⇒ the Activity tab does not render. */
  activity?: RecordActivityFeed | null | undefined;
  /** Absent/null ⇒ the Attachments panel does not render. */
  attachments?: PageRecordAttachments | null | undefined;
  /**
   * May this caller attach a file? Beside `canUpdate`/`canDelete` and NOT the
   * same as either: a sidecar attach is authorised by `update` on the entity's
   * table but the page reply carries it explicitly so the panel never offers a
   * dropzone the server would refuse.
   */
  canAttach?: boolean | undefined;
  /** Workspace upload cap, so the dropzone refuses before a request starts. */
  maxFileBytes?: number | undefined;
  canUpdate?: boolean | undefined;
  canDelete?: boolean | undefined;
  canUnmask?: boolean | undefined;
  /**
   * The link relations this table can write through. The record shows what
   * each one points at as chips, and the edit dialog offers the same field.
   */
  relations?: readonly FormRelationFact[] | undefined;
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  /** The record was deleted — navigate off the page. */
  onDeleted?: ((undoToken: string | null) => void) | undefined;
  /** The record does not exist (404) — host renders its not-found state. */
  onMissing?: (() => void) | undefined;
  /** Fired when the record loads/reloads — hero feeds breadcrumb/doc title. */
  onLoaded?: ((info: { hero: string }) => void) | undefined;
  locale?: string | undefined;
  currency?: string | undefined;
  /**
   * EXTRA PANELS the host wants on this record.
   *
   * ─── Why a seam and not another typed adapter ──────────────────────────
   *
   * `related`, `activity` and `attachments` are each a TYPED adapter, because
   * this component draws them: it knows what a related row is and what a
   * dropzone does. It does not know what a document is, and it should not —
   * the panel that lists documents belongs to whatever produced them, and a
   * second consumer (a certificate provider, a delivery note) would otherwise
   * mean a fourth adapter and a fifth.
   *
   * So this is a rendering seam. The host passes nodes; the page gives them a
   * place and a heading and has no opinion about their contents. That is also
   * what 30's follow-up chips need for grants-driven affordances, which is why
   * calls it owed regardless.
   *
   * ABSENT ⇒ NOTHING EXTRA RENDERS, exactly like the three adapters above. A
   * deployment with no `document-render` provider installed passes nothing and
   * the page is what it always was.
   */
  panels?: readonly PageRecordPanel[] | undefined;
  /**
   * EXTRA TOPBAR ACTIONS — the "Make ▾" menu's home.
   *
   * Same seam, different place: the host owns what the action does, this
   * component owns where it sits. Rendered beside Edit and Delete and after
   * them, so a destructive action never moves under somebody's cursor because
   * an add-on was installed.
   */
  actions?: readonly PageRecordAction[] | undefined;
  labels?: PageRecordLabels | undefined;
  testId?: string | undefined;
}

/** One host-supplied panel. `id` is a React key and a test handle, nothing more. */
export interface PageRecordPanel {
  id: string;
  /** Already translated by the host — this component has no bundle for it. */
  title: string;
  /** Rendered inside the page's own panel chrome, so it matches the rest. */
  content: ReactNode;
}

/** One host-supplied topbar action. */
export interface PageRecordAction {
  id: string;
  /** Already translated by the host. */
  label: string;
  content: ReactNode;
}

function isNotFound(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'status' in reason &&
    (reason as { status: unknown }).status === 404
  );
}

/**
 * Minimal text specs derived from row keys — the degradation for a
 * referencing table with no page of its own. Masking still renders
 * faithfully: `CellValue` reads the row's `_masked` marker, not the spec.
 */
function derivedColumns(rows: readonly CrudRow[]): GridColumnSpec[] {
  return Object.keys(rows[0] ?? {})
    .filter((key) => key !== '_masked')
    .slice(0, 6)
    .map((key, index) => ({
      name: key,
      label: key,
      logicalType: 'text',
      semantic: null,
      format: null,
      pii: false,
      mono: false,
      sortable: false,
      hidden: false,
      primaryKey: false,
      nullable: true,
      hasDefault: false,
      unique: false,
      readOnly: true,
      maxLength: null,
      isDisplay: index === 0,
    }));
}

// --- related tab -------------------------------------------------------------

function RelatedRecordsTab({
  tab,
  related,
  pkValue,
  count,
  connectionId,
  writable,
  onCreated,
  onEvent,
  cellContext,
  locale,
}: {
  tab: PageRecordTabConfig;
  related: PageRecordRelated;
  pkValue: unknown;
  /** The pill count — doubles as the footer total. */
  count: number | null;
  connectionId: string | null;
  /** The PARENT page's write gate: readOnly hides every affordance. */
  writable: boolean;
  /** A row was created here — the parent refreshes its count pills. */
  onCreated?: (() => void) | undefined;
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  cellContext: CellContext;
  locale?: string | undefined;
}) {
  const t = useMaybeT();
  const queue = useToastQueue();
  const [resolution, setResolution] = useState<PageRecordRelatedResolution | null | 'pending'>('pending');
  const [rows, setRows] = useState<CrudRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cursor, setCursor] = useState('');
  const [pageSize, setPageSize] = useState(RELATED_PAGE_SIZE);
  const [sort, setSort] = useState<CrudSort | null>(null);
  const [sortTouched, setSortTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  /** Bumped after a create so the current page refetches even at cursor ''. */
  const [refreshTick, setRefreshTick] = useState(0);

  // Resolve the target table's own page metadata once per tab activation
  // (Radix mounts a tab's content on first activation — the lazy-fetch
  // contract the fan-out risk note pins).
  useEffect(() => {
    let alive = true;
    related
      .resolve(tab.table)
      .then((resolved) => {
        if (alive) setResolution(resolved);
      })
      .catch(() => {
        if (alive) setResolution(null);
      });
    return () => {
      alive = false;
    };
  }, [related, tab.table]);

  const fkColumn = tab.fkColumn;
  // The related table's own default sort until the user sorts by hand (D4).
  const effectiveSort = sortTouched
    ? sort
    : resolution === 'pending'
      ? null
      : (resolution?.defaultSort ?? null);

  useEffect(() => {
    if (fkColumn === undefined || resolution === 'pending') return;
    let alive = true;
    setError(null);
    related
      .list(tab.table, {
        limit: pageSize,
        cursor,
        where: { column: fkColumn, op: 'eq', value: pkValue },
        ...(effectiveSort === null ? {} : { order: [effectiveSort] }),
      })
      .then((result) => {
        if (!alive) return;
        setRows(result.data);
        setNextCursor(result.cursor?.next ?? null);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setRows([]);
        setError(reason instanceof Error ? reason.message : t('ui:state.error', 'Something went wrong'));
      });
    return () => {
      alive = false;
    };
  }, [related, tab.table, fkColumn, pkValue, pageSize, cursor, effectiveSort, resolution, refreshTick]);

  /*
   * The in-tab create (30 follow-up): the child row is born already attached —
   * the FK column never renders as a field; its value is THIS record, injected
   * at submit. Offered only when every gate agrees: the parent page is
   * writable (D7), the target table's own page resolved AND said the caller
   * may create (its per-caller `canCreate` + its own readOnly — see
   * `PageRecordRelatedResolution.canCreate`), and the host wired a write api.
   */
  const crud = related.api?.(tab.table) ?? null;
  const creatable =
    writable &&
    fkColumn !== undefined &&
    resolution !== 'pending' &&
    resolution !== null &&
    resolution.canCreate === true &&
    crud !== null;
  // Domain framing from the tab's label ("Invoice items" → "invoice item"),
  // falling back to the table-derived noun; singularized ONCE either way.
  const childEntity =
    tab.label !== undefined
      ? tab.label.toLowerCase().endsWith('s')
        ? tab.label.toLowerCase().slice(0, -1)
        : tab.label.toLowerCase()
      : entityFromTable(tab.table);
  const createColumns = useMemo(
    () =>
      resolution === 'pending' || resolution === null
        ? []
        : resolution.columns.filter((column) => column.name !== fkColumn),
    [resolution, fkColumn],
  );

  const handleCreate = (values: CrudRow) => {
    if (crud === null || fkColumn === undefined) return;
    setCreateErrors({});
    crud
      .create({ ...values, [fkColumn]: pkValue })
      .then(() => {
        setCreateOpen(false);
        queue.push({
          variant: 'success',
          title: t('ui:templates.crud.toast.created', '{entity} created.', {
            entity: childEntity.charAt(0).toUpperCase() + childEntity.slice(1),
          }),
        });
        // Refetch this tab's current page and let the parent refresh pills.
        setRefreshTick((tick) => tick + 1);
        onCreated?.();
      })
      .catch((reason: unknown) => {
        const fieldErrors =
          typeof reason === 'object' && reason !== null && 'fieldErrors' in reason
            ? (reason as { fieldErrors: Record<string, string> }).fieldErrors
            : null;
        if (fieldErrors !== null) {
          setCreateErrors(fieldErrors);
          return;
        }
        queue.push({
          variant: 'error',
          title:
            reason instanceof Error
              ? reason.message
              : t('ui:templates.crud.toast.createFailed', 'Create failed.'),
        });
      });
  };

  const addButton = creatable ? (
    <Button size="sm" variant="secondary" iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
      {t('ui:templates.crud.newRow', 'New row')}
    </Button>
  ) : null;
  /*
   * The related tab's "New row" — the SAME dialog as the table page's create
   * (D3). The parent key is still injected at submit and its column is still
   * stripped from the form; what changed is the container it lives in.
   */
  const createDrawer = creatable ? (
    <RecordFormDialog
      open={createOpen}
      onOpenChange={(open) => !open && setCreateOpen(false)}
      mode="create"
      entity={childEntity}
      tableName={tab.table}
      formId={`page-record-add-${tab.table}`}
      columns={createColumns}
      errors={createErrors}
      lookup={crud.lookup?.bind(crud)}
      onSubmit={handleCreate}
    />
  ) : null;

  if (fkColumn === undefined) {
    // A tab whose FK column the config no longer names: counts only.
    return (
      <p className="px-1 py-3 text-body-sm text-fg-muted">
        {t(
          'ui:templates.crud.detail.relatedCount',
          '{count, plural, one {{n} related record in {table}} other {{n} related records in {table}}}',
          { count: count ?? 0, n: String(count ?? 0), table: tab.table },
        )}
      </p>
    );
  }
  if (error !== null) {
    return (
      <p role="alert" className="px-1 py-3 text-body-sm text-danger">
        {error}
      </p>
    );
  }
  if (rows === null || resolution === 'pending') {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner label={t('ui:templates.crud.loadingRows', 'Loading rows')} />
      </div>
    );
  }
  if (rows.length === 0 && cursorStack.length === 0) {
    // The empty tab is exactly where "New row" earns its place — the first
    // child of a fresh parent starts here.
    return (
      <>
        <EmptyState
          compact
          preset="no-data"
          title={t('ui:templates.record.relatedEmptyTitle', 'No related records')}
          {...(addButton === null ? {} : { actions: addButton })}
        />
        {createDrawer}
      </>
    );
  }

  const columns = resolution?.columns ?? derivedColumns(rows);
  // Rows navigate only when the table has a page of its own — a link that
  // goes nowhere is worse than no link.
  const linkable = resolution !== null && related.linkable(tab.table);
  const rangeStart = rows.length === 0 ? 0 : cursorStack.length * pageSize + 1;
  const rangeEnd = cursorStack.length * pageSize + rows.length;

  return (
    <div data-part="record-related-tab" data-table={tab.table}>
      {addButton !== null && <div className="mb-2 flex justify-end">{addButton}</div>}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <DataGrid
        columns={columns}
        rows={rows}
        sort={effectiveSort}
        onSortChange={(next) => {
          setSortTouched(true);
          setSort(next);
          setCursor('');
          setCursorStack([]);
        }}
        {...(linkable
          ? {
              onRowOpen: (row: CrudRow) => {
                onEvent?.({
                  type: 'record-open',
                  ...(connectionId === null ? {} : { connectionId }),
                  table: tab.table,
                  recordId: rowIdOf(columns, row),
                });
              },
            }
          : {})}
        cellContext={cellContext}
        density="compact"
      />
      <PaginationFooter
        {...(locale === undefined ? {} : { locale })}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        total={count}
        hasPrev={cursorStack.length > 0}
        hasNext={nextCursor !== null}
        onPrev={() => {
          const previous = cursorStack.at(-1);
          if (previous === undefined) return;
          setCursorStack((stack) => stack.slice(0, -1));
          setCursor(previous);
        }}
        onNext={() => {
          if (nextCursor === null) return;
          setCursorStack((stack) => [...stack, cursor]);
          setCursor(nextCursor);
        }}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCursor('');
          setCursorStack([]);
        }}
      />
      </div>
      {createDrawer}
    </div>
  );
}

// --- attachments panel --------------------------------------------------------

/**
 * The record's sidecar files.
 *
 * THIS IS THE FIRST CALLER THE MEDIA FAMILY HAS EVER HAD. `UploadDropzone`,
 * `AttachmentList` and `UploadProgressList` shipped in M7 and have sat
 * transport-less since — the dropzone's own docblock says so: "there are no
 * files routes yet, so the host owns the transport; when they land, the
 * dashboard wires `onFiles` to them". They have landed, and this is the wiring.
 *
 * Deleting is soft everywhere in this feature (D12), so the panel offers Undo
 * rather than a confirmation: the file is in the trash for
 * `retention.filesTrashDays` and putting it back is one call. A confirm dialog
 * in front of a reversible action is a dialog nobody reads.
 */
function AttachmentsPanel({
  attachments,
  canAttach,
  maxBytes,
  locale,
}: {
  attachments: PageRecordAttachments;
  canAttach: boolean;
  maxBytes?: number | undefined;
  locale?: string | undefined;
}) {
  const t = useMaybeT();
  const [items, setItems] = useState<RecordAttachment[] | null>(null);
  const [uploads, setUploads] = useState<{ id: string; name: string; fraction: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<RecordAttachment | null>(null);

  const reload = useCallback(() => {
    void attachments
      .list()
      .then(setItems)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setItems([]);
      });
  }, [attachments]);

  useEffect(reload, [reload]);

  async function send(file: File): Promise<void> {
    const id = `${file.name}:${String(Date.now())}`;
    setError(null);
    setUploads((current) => [...current, { id, name: file.name, fraction: 0 }]);
    const abort = new AbortController();
    try {
      const uploaded = await attachments.upload({
        file,
        signal: abort.signal,
        onProgress: (fraction) =>
          setUploads((current) => current.map((entry) => (entry.id === id ? { ...entry, fraction } : entry))),
      });
      setItems((current) => [...(current ?? []), uploaded]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploads((current) => current.filter((entry) => entry.id !== id));
    }
  }

  return (
    <div className="flex flex-col gap-3" data-part="record-attachments">
      {canAttach && (
        <UploadDropzone
          multiple
          {...(maxBytes === undefined ? {} : { maxSize: maxBytes })}
          {...(locale === undefined ? {} : { locale })}
          onFiles={(files) => {
            for (const file of files) void send(file);
          }}
          onReject={() =>
            setError(
              t('ui:templates.record.attachments.tooLarge', 'That file is larger than this workspace allows.'),
            )
          }
        />
      )}

      {uploads.length > 0 && (
        // `UploadProgressList` is the widget this family shipped for exactly
        // this and has never had a caller. Its own bar is tone-mapped and
        // token-backed; a hand-rolled one here would be a second progress
        // treatment in the same product.
        <UploadProgressList
          jobs={uploads.map((entry) => ({
            id: entry.id,
            name: entry.name,
            status: 'uploading' as const,
            pct: Math.round(entry.fraction * 100),
          }))}
          {...(locale === undefined ? {} : { locale })}
        />
      )}

      {error !== null && (
        <p role="alert" className="text-body-sm text-danger" data-part="record-attachments-error">
          {error}
        </p>
      )}

      {undoable !== null && attachments.restore !== undefined && (
        <div className="flex items-center gap-2 text-body-sm" data-part="record-attachments-undo">
          <span className="text-fg-muted">
            {t('ui:templates.record.attachments.removed', '{name} was moved to the trash.', {
              name: undoable.filename,
            })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const file = undoable;
              setUndoable(null);
              void attachments.restore?.(file.id).then(reload);
            }}
          >
            {t('ui:action.undo', 'Undo')}
          </Button>
        </div>
      )}

      {items === null ? (
        <Spinner label={t('ui:templates.record.attachments.loading', 'Loading attachments')} />
      ) : (
        <AttachmentList
          items={items.map((file) => ({
            id: file.id,
            name: file.filename,
            size: file.sizeBytes,
            mime: file.mime,
            url: file.contentPath,
          }))}
          actions={canAttach ? ['download', 'delete'] : ['download']}
          {...(locale === undefined ? {} : { locale })}
          emptyTitle={t('ui:templates.record.attachments.emptyTitle', 'No files yet')}
          emptyBody={t(
            'ui:templates.record.attachments.emptyBody',
            'Files attached to this record appear here.',
          )}
          onDelete={(item) => {
            const file = items.find((entry) => entry.id === item.id);
            setItems((current) => (current ?? []).filter((entry) => entry.id !== item.id));
            if (file !== undefined) setUndoable(file);
            void attachments.remove(item.id).catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : String(reason));
              reload();
            });
          }}
        />
      )}
    </div>
  );
}

// --- activity tab ------------------------------------------------------------

const ACTIVITY_TONE: Record<string, string> = {
  'record.create': 'pos',
  'record.update': 'accent',
  'record.delete': 'danger',
  'record.undo': 'warn',
};

function ActivityTab({ feed, locale }: { feed: RecordActivityFeed; locale?: string | undefined }) {
  const t = useMaybeT();
  const [entries, setEntries] = useState<RecordActivityEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (cursor: string | undefined) => {
      setLoading(true);
      feed
        .list(cursor === undefined ? {} : { cursor })
        .then((page) => {
          setEntries((current) => [...(cursor === undefined ? [] : (current ?? [])), ...page.entries]);
          setNextCursor(page.nextCursor);
          setLoading(false);
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : t('ui:state.error', 'Something went wrong'));
          setLoading(false);
        });
    },
    [feed, t],
  );

  useEffect(() => {
    load(undefined);
  }, [load]);

  if (error !== null) {
    return (
      <p role="alert" className="px-1 py-3 text-body-sm text-danger">
        {error}
      </p>
    );
  }
  if (entries === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner label={t('ui:templates.record.loadingActivity', 'Loading activity')} />
      </div>
    );
  }

  const sentenceFor = (entry: RecordActivityEntry): string => {
    const actor = entry.actorLabel;
    switch (entry.action) {
      case 'record.create':
        return t('ui:templates.record.activity.created', '{actor} created this record', { actor });
      case 'record.update':
        return t('ui:templates.record.activity.updated', '{actor} updated this record', { actor });
      case 'record.delete':
        return t('ui:templates.record.activity.deleted', '{actor} deleted this record', { actor });
      case 'record.undo':
        return t('ui:templates.record.activity.undone', '{actor} undid a change', { actor });
      default:
        return `${actor} · ${entry.action}`;
    }
  };

  const timeline: TimelineEntry[] = entries.map((entry) => ({
    id: entry.id,
    title: sentenceFor(entry),
    ts: new Date(entry.at).toISOString(),
    tone: ACTIVITY_TONE[entry.action] ?? 'neutral',
    ...(entry.changedFields === undefined || entry.changedFields === 0
      ? {}
      : {
          body: t(
            'ui:templates.record.activity.changedFields',
            '{count, plural, one {{n} field changed} other {{n} fields changed}}',
            { count: entry.changedFields, n: String(entry.changedFields) },
          ),
        }),
  }));

  return (
    <div className="flex flex-col gap-2" data-part="record-activity">
      <TimelineVertical
        entries={timeline}
        {...(locale === undefined ? {} : { locale })}
        // D6: honest emptiness — the feed shows what Adminium recorded, which
        // is not a claim that nothing ever happened (bulk writes carry no
        // per-row entity; other tools never audited here at all).
        emptyTitle={t('ui:templates.record.activityEmptyTitle', 'No activity recorded')}
        emptyBody={t(
          'ui:templates.record.activityEmptyBody',
          'Changes made through Adminium will appear here.',
        )}
      />
      {nextCursor !== null && (
        <div className="px-3 pb-2">
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => load(nextCursor)}>
            {t('ui:templates.record.activityLoadOlder', 'Load older activity')}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- the page ----------------------------------------------------------------

export function PageRecord({
  api,
  columns,
  source,
  recordId,
  entityName,
  keyField,
  readOnly = false,
  tabs = [],
  related,
  activity,
  canUpdate = true,
  canDelete = true,
  canUnmask = false,
  relations,
  attachments,
  canAttach = false,
  maxFileBytes,
  panels,
  actions,
  onEvent,
  onDeleted,
  onMissing,
  onLoaded,
  locale,
  currency,
  labels,
  testId,
}: PageRecordProps) {
  const t = useMaybeT();
  const queue = useToastQueue();
  const entity = entityName ?? entityFromTable(source.table);

  const [result, setResult] = useState<CrudGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [editOpen, setEditOpen] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  /**
   * What each link relation points at, with names: the chips this record shows,
   * and the set the edit dialog starts from. Re-read whenever the record is.
   */
  const [links, setLinks] = useState<Record<string, ControlOption[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ references: CrudReferenceCount[]; loaded: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .get(recordId, { include: 'inboundCounts' })
      .then((loaded) => {
        if (alive) setResult(loaded);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        if (isNotFound(reason)) {
          onMissing?.();
          return;
        }
        setError(reason instanceof Error ? reason.message : t('ui:templates.record.loadError', 'Failed to load the record.'));
      });
    return () => {
      alive = false;
    };
  }, [api, recordId, reloadTick]);

  /*
   * The links, one read per relation, alongside the record's own. A table with
   * no link relation — or a host whose api cannot read them — makes no request
   * at all and renders exactly as it did before link fields existed.
   */
  useEffect(() => {
    const readLinks = api.links?.bind(api);
    if (relations === undefined || relations.length === 0 || readLinks === undefined) {
      setLinks({});
      return;
    }
    let alive = true;
    void Promise.all(
      relations.map(async (relation) => {
        try {
          const rows = await readLinks(recordId, relation.relationId);
          return [
            relation.relationId,
            rows.map((row) => ({
              value: row.key,
              label: row.name,
              ...(row.detail === undefined ? {} : { description: row.detail }),
            })),
          ] as const;
        } catch {
          // A relation this caller cannot read shows nothing rather than
          // breaking the record; the write path refuses a save anyway.
          return [relation.relationId, []] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setLinks(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [api, recordId, reloadTick, relations]);

  const cellContext: CellContext = useMemo(
    () => ({
      onEvent,
      canUnmask,
      connectionId: source.connectionId ?? undefined,
      locale,
      currency,
    }),
    [onEvent, canUnmask, source.connectionId, locale, currency],
  );

  const record = result?.data ?? null;
  const counts = result?.inboundCounts ?? [];

  const heroValue = useMemo(() => {
    if (record === null) return null;
    // Key-field highlight — read off the RECORD, not the column specs:
    // `keyField` is generation's chosen display column, and the ~8-column
    // list cap routinely drops it from `config.columns` (a free-text company
    // name never makes the grid) while `api.get` still returns it. Masked or
    // absent values fall through to the drawer's PK fallback — row identity
    // always resolves.
    const keyed = keyField == null ? undefined : record[keyField];
    return keyed !== null && keyed !== undefined && String(keyed) !== ''
      ? String(keyed)
      : displayValueOf(columns, record);
  }, [record, columns, keyField]);

  useEffect(() => {
    if (heroValue !== null) onLoaded?.({ hero: heroValue });
  }, [heroValue, onLoaded]);

  const countFor = (tab: PageRecordTabConfig): number | null => {
    const match = counts.find(
      (count) =>
        count.table === tab.table && (tab.fkColumn === undefined || count.column === tab.fkColumn),
    );
    return match?.count ?? null;
  };

  const writable = !readOnly;
  const showEdit = writable && canUpdate;
  const showDelete = writable && canDelete;

  const handleUpdate = (values: CrudRow, changedLinks?: Record<string, string[]>) => {
    setEditErrors({});
    api
      .update(
        ...((changedLinks === undefined ? [recordId, values] : [recordId, values, changedLinks]) as [
          string,
          CrudRow,
          Record<string, string[]>?,
        ]),
      )
      .then((updated) => {
        setEditOpen(false);
        queue.push({
          variant: 'success',
          title: t('ui:templates.crud.toast.saved', 'Changes saved.'),
          ...(updated.undoToken === null
            ? {}
            : {
                action: {
                  label: labels?.undo ?? t('ui:action.undo', 'Undo'),
                  onAction: () => {
                    api
                      .undo(updated.undoToken as string)
                      .then(() => {
                        queue.push({ variant: 'info', title: t('ui:templates.crud.toast.undone', 'Change undone.') });
                        setReloadTick((tick) => tick + 1);
                      })
                      .catch((reason: unknown) => {
                        queue.push({
                          variant: 'error',
                          title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.undoFailed', 'Undo failed.'),
                        });
                      });
                  },
                },
              }),
        });
        setReloadTick((tick) => tick + 1);
      })
      .catch((reason: unknown) => {
        const fieldErrors =
          typeof reason === 'object' && reason !== null && 'fieldErrors' in reason
            ? (reason as { fieldErrors: Record<string, string> }).fieldErrors
            : null;
        if (fieldErrors !== null) {
          setEditErrors(fieldErrors);
          return;
        }
        queue.push({
          variant: 'error',
          title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.updateFailed', 'Update failed.'),
        });
      });
  };

  const openDelete = () => {
    setDeleteTarget({ references: [], loaded: false });
    api
      .remove(recordId, { dryRun: true })
      .then((preview) => {
        setDeleteTarget((current) =>
          current === null
            ? current
            : { references: isDeletePreview(preview) ? preview.references : [], loaded: true },
        );
      })
      .catch(() => {
        setDeleteTarget((current) => (current === null ? current : { ...current, loaded: true }));
      });
  };

  const confirmDelete = async () => {
    try {
      const removed = await api.remove(recordId, { confirm: true });
      setDeleteTarget(null);
      // The record no longer exists — staying is a 404 with extra
      // steps. The host owns the navigation and the undo toast.
      onDeleted?.(isDeletePreview(removed) ? null : removed.undoToken);
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.deleteFailed', 'Delete failed.'),
      });
    }
  };

  if (error !== null) {
    return (
      <EmptyState
        tone="danger"
        title={t('ui:templates.record.loadError', 'Failed to load the record.')}
        body={error}
        actions={
          <Button size="sm" variant="secondary" onClick={() => setReloadTick((tick) => tick + 1)}>
            {t('ui:action.retry', 'Retry')}
          </Button>
        }
      />
    );
  }
  if (record === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label={t('ui:templates.common.loadingRecord', 'Loading record')} />
      </div>
    );
  }

  const hero = heroValue ?? displayValueOf(columns, record);
  const statusColumn = columns.find((column) => column.semantic === 'status-workflow' && !column.hidden);
  const stampColumn =
    columns.find((column) => column.semantic === 'updated-at' && !column.hidden) ??
    columns.find((column) => column.semantic === 'created-at' && !column.hidden);

  const visibleColumns = columns.filter((column) => !column.hidden);
  const splitAt = Math.ceil(visibleColumns.length / 2);
  const fieldHalves =
    visibleColumns.length > 6
      ? [visibleColumns.slice(0, splitAt), visibleColumns.slice(splitAt)]
      : [visibleColumns];

  const hasTabs = tabs.length > 0 && related !== undefined;
  const hasActivity = activity !== null && activity !== undefined;
  // Absent ⇒ no panel, the same rule `related` and `activity` follow.
  const hasAttachments = attachments !== null && attachments !== undefined;
  const pkValue = pkValueOf(columns, record);

  return (
    <div data-part="page-record" data-testid={testId} className="flex flex-col gap-5">
      {/* Hero — key field + meta chips + actions (D4). */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 className="min-w-0 truncate text-title text-fg">{hero}</h2>
            {statusColumn !== undefined && (
              <CellValue column={statusColumn} row={record} context={cellContext} />
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body-sm text-fg-muted">
            <span className="capitalize">{entity}</span>
            <span aria-hidden="true">·</span>
            <MonoText className="text-body-sm">{recordId}</MonoText>
            {stampColumn !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  {stampColumn.label}
                  <CellValue column={stampColumn} row={record} context={cellContext} />
                </span>
              </>
            )}
          </div>
        </div>
        {(showEdit || showDelete || (actions !== undefined && actions.length > 0)) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {/*
              * Host actions FIRST, then Edit, then Delete — and the order is
              * the point rather than a preference. Delete stays last, where it
              * has always been: a destructive control that moves because an
              * add-on was installed is a control somebody clicks by muscle
              * memory and means to have clicked something else.
              */}
            {actions?.map((action) => (
              <span key={action.id} data-testid={`record-action-${action.id}`}>
                {action.content}
              </span>
            ))}
            {showEdit && (
              <Button size="sm" variant="secondary" iconLeft={<Pencil />} onClick={() => setEditOpen(true)}>
                {labels?.edit ?? t('ui:action.edit', 'Edit')}
              </Button>
            )}
            {showDelete && (
              <Button size="sm" variant="destructive" iconLeft={<Trash2 />} onClick={openDelete}>
                {labels?.delete ?? t('ui:action.delete', 'Delete')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Field grid — two columns at lg, one below (D4). */}
      <div
        data-part="record-fields"
        className={`grid gap-x-8 ${fieldHalves.length === 2 ? 'lg:grid-cols-2' : ''}`}
      >
        {fieldHalves.map((half, index) => (
          <DetailKeyValue
            key={index}
            columns={half}
            record={record}
            cellContext={cellContext}
            showTypeTags
          />
        ))}
      </div>

      {/*
        * What this record is LINKED to (F8). Chips rather than a tab: a
        * relation is a property of the record — "this booking's services" —
        * and a tab would file it with the child rows that belong to it.
        */}
      {(relations ?? []).some((relation) => (links[relation.relationId] ?? []).length > 0) && (
        <div className="flex flex-col gap-3" data-part="record-links">
          {(relations ?? []).map((relation) => {
            const rows = links[relation.relationId] ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={relation.relationId} className="flex flex-col gap-1.5">
                <span className="text-caption text-fg-subtle">{relation.label}</span>
                <ul className="flex flex-wrap gap-1.5">
                  {rows.map((row) => (
                    <li key={row.value}>
                      <Tag tone="accent">{row.label ?? row.value}</Tag>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Related-record tabs + Activity (D4/D6). */}
      {(hasTabs || hasActivity || hasAttachments) && (
        <Tabs defaultValue={hasTabs ? `tab-0` : hasAttachments ? '__attachments' : '__activity'}>
          <TabsList>
            {hasTabs &&
              tabs.map((tab, index) => (
                <TabsTrigger
                  key={`${tab.table}:${tab.fkColumn ?? ''}`}
                  value={`tab-${String(index)}`}
                  {...(countFor(tab) === null ? {} : { count: countFor(tab) as number })}
                >
                  {tab.label ?? tab.table.split('.').pop()}
                </TabsTrigger>
              ))}
            {hasAttachments && (
              <TabsTrigger value="__attachments">
                {labels?.attachmentsTab ?? t('ui:templates.record.attachmentsTab', 'Files')}
              </TabsTrigger>
            )}
            {hasActivity && (
              <TabsTrigger value="__activity">
                {labels?.activityTab ?? t('ui:templates.record.activityTab', 'Activity')}
              </TabsTrigger>
            )}
          </TabsList>
          {hasTabs &&
            tabs.map((tab, index) => (
              <TabsContent key={`${tab.table}:${tab.fkColumn ?? ''}`} value={`tab-${String(index)}`}>
                <RelatedRecordsTab
                  tab={tab}
                  related={related}
                  pkValue={pkValue}
                  count={countFor(tab)}
                  connectionId={source.connectionId}
                  writable={writable}
                  onCreated={() => {
                    // A child was born — the pill counts (and the record's
                    // inbound-reference chip) refresh through the same reload
                    // the edit flow uses.
                    setReloadTick((tick) => tick + 1);
                  }}
                  onEvent={onEvent}
                  cellContext={cellContext}
                  {...(locale === undefined ? {} : { locale })}
                />
              </TabsContent>
            ))}
          {hasAttachments && (
            <TabsContent value="__attachments">
              <AttachmentsPanel
                attachments={attachments}
                // NOT `writable && canAttach`. A read-only SOURCE is exactly the
                // case the sidecar exists for: the row cannot be edited and a
                // file still can be attached beside it. The
                // server already says so — `routes/pages/index.ts` computes
                // `canAttach` from the table's `:update` grant and deliberately
                // does NOT derive it from `canUpdate`, "or it would hide the
                // panel on exactly the connections it exists for". ANDing
                // `writable` back in here undid that on every page the engine
                // stamps `readOnly` (every `read-only-analytics` intent).
                canAttach={canAttach}
                {...(maxFileBytes === undefined ? {} : { maxBytes: maxFileBytes })}
                {...(locale === undefined ? {} : { locale })}
              />
            </TabsContent>
          )}
          {hasActivity && (
            <TabsContent value="__activity">
              <ActivityTab feed={activity} {...(locale === undefined ? {} : { locale })} />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/*
        * HOST-SUPPLIED PANELS.
        *
        * BELOW the tabs rather than inside them, and that is the decision worth
        * recording. A tab hides its contents until somebody clicks it, and the
        * first thing a host wants here is "which documents exist for this row"
        * — a fact somebody should see without hunting for it. It is also the
        * honest place for content this component knows nothing about: a tab
        * strip is a navigation model, and adding an unknown number of unknown
        * tabs to one turns a stable row of three into a scrolling list.
        */}
      {panels !== undefined && panels.length > 0 && (
        <div className="flex flex-col gap-4" data-testid="record-host-panels">
          {panels.map((panel) => (
            <section key={panel.id} data-testid={`record-panel-${panel.id}`}>
              <h2 className="mb-2 text-sm font-medium text-fg-muted">{panel.title}</h2>
              {panel.content}
            </section>
          ))}
        </div>
      )}

      {/* Edit — the same dialog as every other form in the product (D3). */}
      {showEdit && (
        <RecordFormDialog
          open={editOpen}
          onOpenChange={(open) => !open && setEditOpen(false)}
          mode="edit"
          entity={entity}
          tableName={source.table}
          formId="page-record-edit-form"
          columns={columns}
          {...(relations === undefined ? {} : { relations, initialLinks: links })}
          initialValues={record}
          errors={editErrors}
          lookup={api.lookup?.bind(api)}
          availability={api.availability?.bind(api)}
          onSubmit={handleUpdate}
          {...(labels?.close === undefined ? {} : { labels: { close: labels.close } })}
        />
      )}

      {/* Cascade-aware type-to-confirm delete — same flow as the list (D4). */}
      {showDelete && (
        <ConfirmModal
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t('ui:templates.crud.deleteTitle', 'Delete {entity}', { entity })}
          body={
            deleteTarget === null ? null : !deleteTarget.loaded ? (
              t('ui:templates.crud.deletePreflight', 'Checking references…')
            ) : deleteTarget.references.length === 0 ? (
              t('ui:templates.crud.deleteNoReferences', 'This row has no inbound references.')
            ) : (
              <div className="flex flex-col gap-2">
                <span>{t('ui:templates.crud.deleteConsequencesIntro', 'Deleting this row also affects:')}</span>
                <KeyValueList data-part="delete-consequences">
                  {deleteTarget.references.map((reference) => (
                    <KeyValueRow key={reference.relationId} label={`${reference.table}.${reference.column}`} mono>
                      {t('ui:templates.crud.referenceRows', '{count, plural, one {{n} row} other {{n} rows}}', {
                        count: reference.count,
                        n: String(reference.count),
                      })}
                    </KeyValueRow>
                  ))}
                </KeyValueList>
              </div>
            )
          }
          confirmWord={displayValueOf(columns, record)}
          promptLabel={confirmPromptFor(t, displayValueOf(columns, record))}
          confirmLabel={t('ui:action.delete', 'Delete')}
          cancelLabel={t('ui:action.cancel', 'Cancel')}
          closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
          onConfirm={confirmDelete}
        />
      )}

      <ToastStack
        {...queue.stackProps}
        aria-live="polite"
        dismissLabel={labels?.dismiss ?? t('ui:widgets.feeds.toastStack.dismissLabel', 'Dismiss')}
      />
      {counts.length > 0 && (
        <p className="text-caption text-fg-subtle">
          <Badge tone="info">{counts.reduce((sum, reference) => sum + reference.count, 0)}</Badge>{' '}
          {t('ui:templates.crud.detail.inboundReferences', 'inbound references')}
        </p>
      )}
    </div>
  );
}

function entityFromTable(table: string): string {
  const name = table.split('.').pop() ?? table;
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

function pkValueOf(columns: readonly GridColumnSpec[], record: CrudRow): unknown {
  const pk = columns.find((column) => column.primaryKey);
  return pk === undefined ? null : record[pk.name];
}

/**
 * 'Type {value} to confirm' with the value spliced in as MonoText — the same
 * sentinel splice PageCrud uses (rich text through an ICU arg seam).
 */
function confirmPromptFor(t: ReturnType<typeof useMaybeT>, value: string) {
  const [before = '', after = ''] = t('ui:templates.crud.confirmPrompt', 'Type {value} to confirm', {
    value: '\u0000',
  }).split('\u0000');
  return (
    <>
      {before}
      <MonoText>{value}</MonoText>
      {after}
    </>
  );
}
