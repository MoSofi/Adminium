// SPDX-License-Identifier: AGPL-3.0-only
import {
  Button,
  ConfirmModal,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  IconButton,
  KeyValueList,
  KeyValueRow,
  MonoText,
  SearchInput,
  Spinner,
  ToastStack,
  useToastQueue,
} from '@adminium/ui';
import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { ArrowUpRight, Eye, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { RecordDetail } from './RecordDetail.js';
import { parseRefList } from '../../page-config/file-refs.js';
import type { FileFieldUpload } from './FileField.js';
import { MAX_CHILD_ROWS, type ChildFacts, type ChildRow } from './RecordForm.js';
import { RecordFormDialog } from './RecordFormDialog.js';
import {
  filterControlFor,
  formDocumentFor,
  type CrudFilterField,
  type CrudFormConfig,
  type FormColumnFact,
  type FormRelationFact,
} from '../../page-config/index.js';
import { FilterBar, ReferenceFilterPicker, type FilterSpec } from './filters/FilterBar.js';
import type { ControlOption } from './controls/index.js';
import { optionsForColumn } from './field-mapping.js';
import type { ColumnFacts, ListOptionsResolver } from './field-mapping.js';
import { fieldMessagesOf } from './field-issues.js';
import { isDeletePreview } from './crud-api.js';
import type {
  CrudApi,
  CrudExportFormat,
  CrudFilterCondition,
  CrudListParams,
  CrudReferenceCount,
  CrudRow,
  CrudSort,
} from './crud-api.js';
import { BulkActionToolbar } from '../../families/tables/BulkActionToolbar.js';
import { DataGrid } from '../../families/tables/DataGrid.js';
import { PaginationFooter } from '../../families/tables/PaginationFooter.js';
import type { CellContext, ResolvedFile } from '../../families/tables/cells.js';
import { displayValueOf, rowIdOf } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import type { WidgetEvent } from '../../registry/types.js';
import { describeDataError } from '../../lib/data-error.js';

/**
 * `page-crud` — the per-table resource template (annex): toolbar (search +
 * filter chips + "New row" — DB framing) that morphs into
 * `bulk-action-toolbar` on selection (CSV export + cascade delete),
 * type-aware `data-grid` over the CRUD API, keyset `pagination-footer`,
 * the designed create/edit dialog (`RecordFormDialog`),
 * references-preflight type-to-confirm cascade delete, and undo toasts on
 * every mutation.
 *
 * ROW SEMANTICS: a row is a LINK — click/Enter emit `record-open` and the
 * host navigates to the record PAGE (`/p/$slug/r/$recordId`, rendered by
 * `page-record`). The old route-controlled detail drawer survives as an
 * ephemeral PEEK behind the eye action in the row-actions column: plain
 * component state, no URL write, and an "Open page" affordance in its header
 * so the peek is a step toward the page, never a dead end.
 *
 * All data access flows through the injected `CrudApi` — the dashboard
 * interpreter implements it against `/api/v1/data/:connectionId/:table`; the
 * host owns all navigation through the `record-open` events.
 */

export const PAGE_CRUD_TEMPLATE_ID = 'page-crud';

/**
 * The format the selection bar's Export produces. One button, one format:
 * `bulk-action-toolbar` renders flat buttons with nowhere to put a chooser,
 * and CSV is the interchange default every consumer of an admin export
 * expects. JSON-lines stays reachable through `CrudApi.export` and the Data
 * exports page; `xlsx` is a server 422 (see `lib/export.ts`).
 */
const BULK_EXPORT_FORMAT: CrudExportFormat = 'csv';

export interface PageCrudLabels {
  /** Header CTA — DB framing ("New row"). */
  newRow?: string | undefined;
  /** Create-modal title — domain framing ("Add customer"). */
  createTitle?: string | undefined;
  createSubmit?: string | undefined;
  searchPlaceholder?: string | undefined;
  deleteAction?: string | undefined;
  /** Bulk export of the selection (CSV — see `BULK_EXPORT_FORMAT`). */
  exportAction?: string | undefined;
  dismiss?: string | undefined;
  undo?: string | undefined;
  editTitle?: string | undefined;
  close?: string | undefined;
  /** Accessible name of the row's eye action. */
  peek?: string | undefined;
}

/**
 * The saved-view-relevant slice of the toolbar query state. The host
 * serializes this into `adminium_views.config` and restores it via the initial
 * props (`initialSearch`/`defaultSort`/`initialFilters`/`pageSize`) on
 * remount.
 */
export interface PageCrudGridState {
  search: string;
  sort: CrudSort | null;
  filters: CrudFilterCondition[];
  pageSize: number;
}

export interface PageCrudProps {
  api: CrudApi;
  columns: readonly GridColumnSpec[];
  /** Page scope (envelope `source`) — events carry it. */
  source: { connectionId: string | null; table: string };
  /** Singular entity noun for domain framing ("customer"). */
  entityName?: string | undefined;
  pageSize?: number | undefined;
  defaultSort?: CrudSort | null | undefined;
  /** Seeded filter conditions (chips scaffold). */
  initialFilters?: readonly CrudFilterCondition[] | undefined;
  /** Seeded toolbar search text (saved-view restore). */
  initialSearch?: string | undefined;
  /** Rendered at the start of the toolbar — e.g. the saved-views switcher. */
  toolbarAccessory?: ReactNode | undefined;
  /** Notified whenever the saved-view-relevant query state changes. */
  onGridStateChange?: ((state: PageCrudGridState) => void) | undefined;
  canCreate?: boolean | undefined;
  canUpdate?: boolean | undefined;
  canDelete?: boolean | undefined;
  /** Caller may reveal PII cells (server sends them unmasked). */
  canUnmask?: boolean | undefined;
  /**
   * The source table as the server sees it RIGHT NOW (`columnFacts` on the
   * page reply): who fills each column and which ones the form has to ask
   * for. Absent ⇒ the stored spec decides, exactly as before.
   */
  columnFacts?: ColumnFacts | undefined;
  /**
   * Resolves a `column.options` rule that names a LIST into the answers it
   * holds, in the reader's own language. The host owns it because
   * the host is what knows the reader.
   */
  listOptions?: ListOptionsResolver | undefined;
  /**
   * The link relations this table can write through (`columnFacts.relations`).
   * Absent ⇒ a form of columns only, which is every form that predates them.
   */
  formRelations?: readonly FormRelationFact[] | undefined;
  /**
   * The tables this one can hold a LIST of rows from, by relation id — an
   * invoice's lines. Absent ⇒ a `child-rows` field renders nothing, the same
   * degradation every other fact-dependent control follows.
   */
  childFacts?: Readonly<Record<string, ChildFacts>> | undefined;
  /**
   * The filters this page offers: the ones an admin defined, else the two the
   * table derives (D8). Absent ⇒ no bar at all, which is what every page
   * rendered before filters existed.
   */
  filterFields?: readonly CrudFilterField[] | undefined;
  /**
   * The same block UNKEYED and whole, in table order.
   *
   * `columnFacts` answers "what does the server say about this column", which
   * is all the flat form needed because it rendered `config.columns[]`. The
   * form document needs the columns themselves — including the ones the grid's
   * eight-column cap never listed, which a form has to be able to set.
   */
  formColumns?: readonly FormColumnFact[] | undefined;
  /**
   * The page's own `config.form` block, already parsed by the host (the binding
   * parses `config.labels` the same way). `null` — the norm — means nobody has
   * designed a form and the document is derived from `formColumns`.
   */
  form?: CrudFormConfig | null | undefined;
  /** Host event sink: row click/Enter and FK chips emit `record-open` here
   * (the host navigates to the record page), drill-through, mutate. */
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  locale?: string | undefined;
  currency?: string | undefined;
  labels?: PageCrudLabels | undefined;
  /**
   * The file adapter. Absent ⇒ every `file` column renders exactly as it
   * did before its block existed: a link in the grid, a `url` input in the
   * form. This package has no transport of its own, so this is the whole of
   * what a host must supply.
   */
  files?: PageCrudFiles | undefined;
  testId?: string | undefined;
  /**
   * EXTRA ROW ACTIONS, beside Peek.
   *
   * A PASS-THROUGH and nothing more: the host decides what the action is,
   * this component decides where it sits. `PageCrud` does not know what a
   * document is and should not — a second consumer would otherwise mean a
   * second prop with the same shape and a different name.
   *
   * ABSENT ⇒ the row ends where it always did.
   */
  rowActions?: ((row: Record<string, unknown>) => ReactNode) | undefined;
  /**
   * EXTRA BULK ACTIONS, after Export and before Delete (a project's own
   * actions). A pass-through like {@link PageCrudProps.rowActions}: the host
   * decides what they do, this component only places them.
   *
   * ABSENT ⇒ the bulk bar is what it always was.
   */
  bulkActions?: readonly PageCrudBulkAction[] | undefined;
}

/** One host bulk action. */
export interface PageCrudBulkAction {
  key: string;
  /** Already translated by the host. */
  label: string;
  disabled?: boolean | undefined;
  /** Called with the selected row ids. */
  run: (ids: readonly string[]) => void;
}

/** Host bulk-action keys, kept apart from the bar's own `export` and `delete`. */
const HOST_BULK_PREFIX = 'host:';

/** The host's file transport for one crud page. */
export interface PageCrudFiles {
  /**
   * Resolve the file references on a page of rows — ONE call per page, not one
   * per row. Keys are the stored values; an unrecognised or unreadable value
   * maps to `null` and renders as today's link.
   */
  resolve(refs: readonly string[]): Promise<ReadonlyMap<string, ResolvedFile | null>>;
  upload: FileFieldUpload;
  /** The workspace cap, so the form can refuse before a request starts. */
  maxBytes?: number | undefined;
  /** Above this an image column shows a chip rather than a preview (D24). */
  thumbnailMaxBytes?: number | undefined;
}

/** Debounce for the toolbar search → `q` param. */
export const SEARCH_DEBOUNCE_MS = 250;

interface ListState {
  rows: CrudRow[];
  nextCursor: string | null;
  loading: boolean;
  /**
   * The REJECTION, not its message.
   *
   * This was a flattened string, which threw away the server's error code
   * before anything could read it — so a connection an operator had paused
   * (meta wave 0019) rendered as "Query failed" under a Retry button that
   * could never work. `describeDataError` needs the object.
   */
  error: unknown;
}

interface DeleteTarget {
  record: CrudRow;
  references: CrudReferenceCount[];
  /** null while the preflight is in flight. */
  loaded: boolean;
}

function entityFromTable(table: string): string {
  const name = table.split('.').pop() ?? table;
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

export function PageCrud({
  api,
  columns,
  source,
  entityName,
  pageSize: initialPageSize = 50,
  defaultSort = null,
  initialFilters = [],
  initialSearch = '',
  toolbarAccessory,
  onGridStateChange,
  canCreate = true,
  canUpdate = true,
  canDelete = true,
  canUnmask = false,
  columnFacts,
  listOptions,
  formRelations,
  childFacts,
  filterFields,
  formColumns,
  form,
  files,
  onEvent,
  locale,
  currency,
  rowActions,
  bulkActions,
  labels,
  testId,
}: PageCrudProps) {
  const entity = entityName ?? entityFromTable(source.table);
  const queue = useToastQueue();
  const t = useMaybeT();

  // --- query state -----------------------------------------------------------
  const [search, setSearch] = useState(initialSearch);
  const [q, setQ] = useState(initialSearch);
  const [sort, setSort] = useState<CrudSort | null>(defaultSort);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [filters, setFilters] = useState<readonly CrudFilterCondition[]>(initialFilters);
  /** Keyset history: cursors of the pages before the current one ('' = first). */
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cursor, setCursor] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  // --- data ------------------------------------------------------------------
  const [list, setList] = useState<ListState>({ rows: [], nextCursor: null, loading: true, error: null });
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /**
   * THE SELECTED ROWS THEMSELVES, kept because the selection outlives the page
   * it was made on. Paging forward replaces `list.rows`, and the browser-side
   * export used to filter that array by the selected ids — so selecting on page
   * one, paging forward, selecting again and exporting silently wrote a file
   * with only the second page's rows in it. Nothing said so; the file just had
   * fewer rows than the toolbar's count.
   *
   * A row must be ON SCREEN to be selected, which is what makes the snapshot
   * fillable at all — and what decides where each half of it is maintained:
   * membership on selection, removal on state, freshness on the list. Held in a
   * ref rather than state because nothing renders from it — writing it during
   * render would be a second source of truth for the same selection.
   */
  const selectedRows = useRef(new Map<string, CrudRow>());

  /**
   * Membership is captured HERE, in the handler, from the rows the grid was
   * rendering when the click happened — not in an effect keyed on `list.rows`.
   * An effect can only add rows that are loaded when it runs, so it made
   * membership depend on effect ordering against the list, which is the same
   * class of bug as the one this snapshot exists to fix. The handler cannot
   * miss: the row was on screen, or it could not have been clicked.
   */
  const changeSelection = useCallback(
    (next: ReadonlySet<string>) => {
      const snapshot = selectedRows.current;
      for (const row of list.rows) {
        const id = rowIdOf(columns, row);
        if (next.has(id)) snapshot.set(id, row);
      }
      setSelected(next);
    },
    [columns, list.rows],
  );

  // REMOVAL is derived from state instead, because several paths drop a
  // selection without going through the grid at all — Clear, bulk delete, and
  // the single-row delete. Deriving it means none of them can forget.
  useEffect(() => {
    const snapshot = selectedRows.current;
    for (const id of snapshot.keys()) if (!selected.has(id)) snapshot.delete(id);
  }, [selected]);

  // FRESHNESS, and nothing else: a row that is already in the snapshot takes
  // the newer copy when the list reloads, so an edited row exports what it
  // says on screen. This cannot add or drop membership.
  useEffect(() => {
    const snapshot = selectedRows.current;
    for (const row of list.rows) {
      const id = rowIdOf(columns, row);
      if (snapshot.has(id)) snapshot.set(id, row);
    }
  }, [columns, list.rows]);

  const listParams = useMemo<CrudListParams>(
    () => ({
      limit: pageSize,
      cursor,
      ...(q === '' ? {} : { q }),
      ...(filters.length === 0 ? {} : { where: filters.length === 1 ? (filters[0] as CrudFilterCondition) : { and: [...filters] } }),
      ...(sort === null ? {} : { order: [sort] }),
    }),
    [pageSize, cursor, q, filters, sort],
  );

  /**
   * Debounced search → q, AND ONLY WHEN THERE IS SOMETHING TO DEBOUNCE.
   *
   * Without the guard this effect also runs on mount, and 250ms later it fired
   * `setCursor('')` on a table nobody had searched — snapping the grid back to
   * page one under anyone who had paged forward inside that window, and
   * unmounting the rows they were looking at. Rare by hand, reliable on a busy
   * machine where the timer lands late: it is what made the cross-page export
   * test fail one run in three, by detaching the checkbox mid-click.
   *
   * `search === q` is exactly "the live query already says this" — true on
   * mount, and true again the moment the timer below has fired, which is what
   * keeps this from re-arming itself.
   */
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => {
      setQ(search);
      setCursor('');
      setCursorStack([]);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q]);

  // Report the saved-view-relevant query state so the host can persist a view
  // from the current grid. Pagination cursor is intentionally excluded
  // — a view restores a query, not a scroll position.
  useEffect(() => {
    onGridStateChange?.({ search, sort, filters: [...filters], pageSize });
  }, [onGridStateChange, search, sort, filters, pageSize]);

  // Main list load (keyset mode).
  useEffect(() => {
    let alive = true;
    setList((current) => ({ ...current, loading: true, error: null }));
    api
      .list(listParams)
      .then((result) => {
        if (!alive) return;
        setList({ rows: result.data, nextCursor: result.cursor?.next ?? null, loading: false, error: null });
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setList({ rows: [], nextCursor: null, loading: false, error: reason });
      });
    return () => {
      alive = false;
    };
  }, [api, listParams, reloadTick]);

  // Count probe — keyset replies carry no total, so the footer's
  // "of 8,402" and the unique-check microcopy come from one estimated count.
  useEffect(() => {
    let alive = true;
    api
      .list({ limit: 1, offset: 0, count: 'estimated', ...(q === '' ? {} : { q }) })
      .then((result) => {
        if (alive) setTotal(result.page?.total ?? null);
      })
      .catch(() => {
        if (alive) setTotal(null);
      });
    return () => {
      alive = false;
    };
  }, [api, q, filters, reloadTick]);

  const refetch = useCallback(() => {
    setReloadTick((tick) => tick + 1);
  }, []);

  /**
   * The error panel's contents, or null while the list is fine.
   *
   * Split out because a PAUSED connection is not a failed query: it gets its
   * own title, a calmer tone and no Retry (`lib/data-error.ts`).
   */
  const listError =
    list.error == null
      ? null
      : describeDataError(
          list.error,
          t('ui:templates.crud.queryFailed', 'Query failed'),
          t('ui:templates.common.connectionPaused', 'This connection is paused'),
        );

  // --- peek ----------------------------------------------------------
  // EPHEMERAL local state, deliberately: the record URL now means the record
  // PAGE, so the peek writes nothing to the URL — closing it leaves search,
  // sort, filters and pagination exactly as they were.
  const [peekId, setPeekId] = useState<string | null>(null);

  /** Row click/Enter → the host navigates to the record page. */
  const openRecordPage = useCallback(
    (recordId: string) => {
      onEvent?.({
        type: 'record-open',
        ...(source.connectionId === null ? {} : { connectionId: source.connectionId }),
        table: source.table,
        recordId,
      });
    },
    [onEvent, source.connectionId, source.table],
  );

  // --- create ----------------------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  // --- edit ------------------------------------------------------------------
  const [editRecord, setEditRecord] = useState<CrudRow | null>(null);
  /**
   * The links the record being edited already has, per relation, with their
   * names — read when the dialog opens, so the chips say what they point at
   * instead of showing raw keys, and so a save that touches nothing else
   * replaces each set with itself.
   */
  const [editLinks, setEditLinks] = useState<Record<string, ControlOption[]>>({});
  /**
   * The child rows each line-items relation already holds, read when the edit
   * dialog opens. A create has none — there is no parent to hold any.
   */
  const [editChildren, setEditChildren] = useState<Record<string, ChildRow[]> | undefined>(undefined);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // --- delete ----------------------------------------------------------------
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<readonly string[] | null>(null);

  // --- export ----------------------------------------------------------------
  const [exporting, setExporting] = useState(false);

  /**
   * Resolved file references for the rows currently on screen.
   *
   * ONE request per page of rows. The effect keys on the row identities rather
   * than on the rows themselves so a re-render that did not change the data
   * does not re-ask; a page with no `file` column never asks at all, which is
   * what keeps this free for every table that has none.
   */
  const [resolvedFiles, setResolvedFiles] = useState<ReadonlyMap<string, ResolvedFile | null>>(
    () => new Map(),
  );
  const fileColumns = useMemo(() => columns.filter((column) => column.file !== undefined), [columns]);
  const fileRefs = useMemo(() => {
    if (fileColumns.length === 0) return [];
    const seen = new Set<string>();
    for (const row of list.rows) {
      for (const column of fileColumns) {
        // `parseRefList` for BOTH shapes: a single-value column is a
        // list of one, so the batch is built the same way whether or not the
        // column is `multiple`. Resolving the raw value of a list column would
        // ask the server about the JSON array itself, which names nothing.
        for (const ref of parseRefList(row[column.name])) seen.add(ref);
      }
    }
    return [...seen];
  }, [list.rows, fileColumns]);
  const fileRefsKey = fileRefs.join('\u0000');

  useEffect(() => {
    if (files === undefined || fileRefs.length === 0) {
      setResolvedFiles(new Map());
      return;
    }
    let live = true;
    void files
      .resolve(fileRefs)
      .then((resolved) => {
        if (live) setResolvedFiles(resolved);
      })
      .catch(() => {
        // A failed resolve is not a failed page: every value falls back to the
        // link it rendered before, which is exactly what an unresolved value
        // means anyway.
        if (live) setResolvedFiles(new Map());
      });
    return () => {
      live = false;
    };
    // Keyed on `fileRefsKey` — the ref SET — rather than on `fileRefs`, whose
    // array identity changes on every render and would re-ask per keystroke.
  }, [files, fileRefsKey, fileRefs]);

  const cellContext: CellContext = useMemo(
    () => ({
      onEvent,
      canUnmask,
      connectionId: source.connectionId ?? undefined,
      locale,
      currency,
      files: resolvedFiles,
      ...(files?.thumbnailMaxBytes === undefined ? {} : { thumbnailMaxBytes: files.thumbnailMaxBytes }),
    }),
    [onEvent, canUnmask, source.connectionId, locale, currency, resolvedFiles, files?.thumbnailMaxBytes],
  );

  const pushUndoToast = useCallback(
    (title: string, undoToken: string | null) => {
      queue.push({
        variant: 'success',
        title,
        ...(undoToken === null
          ? {}
          : {
              action: {
                label: labels?.undo ?? t('ui:action.undo', 'Undo'),
                onAction: () => {
                  api
                    .undo(undoToken)
                    .then(() => {
                      queue.push({ variant: 'info', title: t('ui:templates.crud.toast.undone', 'Change undone.') });
                      refetch();
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
    },
    [queue, api, refetch, labels?.undo, t],
  );

  /**
   * A refused write, as messages under the fields it names.
   *
   * This path used to be UNREACHABLE: nothing produced `fieldErrors`, so every
   * failed save — a missing required value, a value outside an enum, a number
   * out of range — was a toast with the server's generic text, and the field
   * that caused it stayed unmarked. The API client now attaches `fieldIssues`
   * from the envelope's `details.fields` and the wording is chosen here, from
   * the code, in the reader's language.
   */
  const fieldErrorsOf = (reason: unknown): Record<string, string> | null => fieldMessagesOf(t, reason);

  /*
   * One read per relation when the edit dialog opens, and none at all for a
   * table with no link fields or a host that cannot read them.
   */
  useEffect(() => {
    const relations = formRelations ?? [];
    const readLinks = api.links?.bind(api);
    if (editRecord === null || relations.length === 0 || readLinks === undefined) {
      setEditLinks({});
      return;
    }
    let alive = true;
    const recordId = rowIdOf(columns, editRecord);
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
          // A relation this caller cannot read leaves the field empty rather
          // than the dialog broken; the write path refuses the save anyway.
          return [relation.relationId, []] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setEditLinks(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [editRecord, formRelations, api, columns]);

  /*
   * The lines each line-items field already holds. One read per relation when
   * the edit dialog opens, and none at all for a form with no such field or a
   * host that cannot read related rows.
   */
  useEffect(() => {
    const facts = childFacts;
    const readRelated = api.listRelated?.bind(api);
    if (editRecord === null || facts === undefined || readRelated === undefined) {
      setEditChildren(undefined);
      return;
    }
    const wanted = Object.entries(facts);
    if (wanted.length === 0) {
      setEditChildren(undefined);
      return;
    }
    let alive = true;
    void Promise.all(
      wanted.map(async ([relationId, fact]) => {
        try {
          const rows = await readRelated({
            table: fact.table,
            column: fact.foreignColumn,
            value: editRecord[fact.parentKeyColumn],
            limit: MAX_CHILD_ROWS,
          });
          return [
            relationId,
            rows.map((row) => ({
              key: Object.fromEntries(fact.primaryKey.map((name: string) => [name, row[name]])),
              values: row,
            })),
          ] as const;
        } catch {
          // A table this caller cannot read leaves the field empty rather than
          // the dialog broken; the write path refuses the save anyway.
          return [relationId, []] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setEditChildren(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [editRecord, childFacts, api]);

  /**
   * The bar's own view of each filter: what it is called, and what it offers.
   *
   * The options come from the SAME resolver the form's choice controls use, so
   * a menu row and a field row say the same word for the same value — including
   * a value whose label lives in an option list.
   */
  const filterSpecs = useMemo((): FilterSpec[] => {
    const byName = new Map(columns.map((column) => [column.name, column]));
    return (filterFields ?? []).flatMap((filter): FilterSpec[] => {
      const column = byName.get(filter.column);
      const fact = columnFacts?.[filter.column];
      const shape = column ?? formColumns?.find((entry) => entry.spec.name === filter.column)?.spec;
      if (shape === undefined) return [];
      const control = filter.control ?? filterControlFor(shape as never);
      if (control === null) return [];
      /*
       * The grid's eight-column cap is not a filter's business: a page may
       * perfectly well be filtered by a column it does not SHOW, and reading
       * the menu's values off the grid column alone left that filter opening
       * onto nothing. The reply's own spec answers for it.
       */
      const spec = (column ?? shape) as typeof columns[number];
      return [
        {
          column: filter.column,
          control,
          label: filter.label ?? (spec.label ?? filter.column),
          options: optionsForColumn(spec, fact, listOptions),
          ...(control === 'record'
            ? {
                picker: (
                  <ReferenceFilterPicker
                    column={spec}
                    lookup={api.lookup?.bind(api)}
                    value={filters.find((condition) => condition.column === filter.column)?.value}
                    onChange={(next) =>
                      setFilters((current) => [
                        ...current.filter((condition) => condition.column !== filter.column),
                        ...(next === null ? [] : [{ column: filter.column, op: 'eq' as const, value: next }]),
                      ])
                    }
                  />
                ),
              }
            : {}),
        },
      ];
    });
  }, [filterFields, columns, columnFacts, formColumns, listOptions, filters, api]);

  const handleCreate = (
    values: CrudRow,
    links?: Record<string, string[]>,
    children?: Record<string, { key?: CrudRow | undefined; values: CrudRow }[]>,
    repeat?: { column: string; values: string[] },
  ) => {
    setCreateErrors({});
    api
      // One argument when the form has no relation fields: an adapter written
      // before they existed takes exactly one, and handing it `undefined`
      // would be a second argument it never asked for.
      .create(
        ...((repeat !== undefined
          ? [values, undefined, undefined, repeat]
          : children !== undefined
            ? [values, links ?? {}, children]
            : links === undefined
              ? [values]
              : [values, links]) as [
          CrudRow,
          Record<string, string[]>?,
          Record<string, { key?: CrudRow | undefined; values: CrudRow }[]>?,
          { column: string; values: string[] }?,
        ]),
      )
      .then((result) => {
        /*
         * The dialog CLOSES on success (D4). It used to stay open on a second
         * "added — Done" panel, after the toast below had already said the row
         * was added and offered the Undo — a second confirmation of something
         * the person had just watched happen, in front of the grid that now
         * shows it.
         */
        setCreateOpen(false);
        pushUndoToast(
          // A `repeat` create wrote several rows under one token, and a toast
          // that said "Invite created" about five of them would be wrong in the
          // one place somebody checks before pressing Undo.
          result.created !== undefined && result.created > 1
            ? t('ui:templates.crud.toast.createdMany', '{count} records created.', {
                count: result.created,
              })
            : t('ui:templates.crud.toast.created', '{entity} created.', {
                entity: `${entity[0]?.toUpperCase() ?? ''}${entity.slice(1)}`,
              }),
          result.undoToken,
        );
        refetch();
      })
      .catch((reason: unknown) => {
        const fieldErrors = fieldErrorsOf(reason);
        if (fieldErrors !== null) {
          setCreateErrors(fieldErrors);
          return;
        }
        queue.push({
          variant: 'error',
          title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.createFailed', 'Create failed.'),
        });
      });
  };

  const handleUpdate = (
    values: CrudRow,
    links?: Record<string, string[]>,
    children?: Record<string, { key?: CrudRow | undefined; values: CrudRow }[]>,
  ) => {
    if (editRecord === null) return;
    const recordId = rowIdOf(columns, editRecord);
    setEditErrors({});
    api
      .update(
        ...((children !== undefined
          ? [recordId, values, links ?? {}, children]
          : links === undefined
            ? [recordId, values]
            : [recordId, values, links]) as [
          string,
          CrudRow,
          Record<string, string[]>?,
          Record<string, { key?: CrudRow | undefined; values: CrudRow }[]>?,
        ]),
      )
      .then((result) => {
        setEditRecord(null);
        pushUndoToast(t('ui:templates.crud.toast.saved', 'Changes saved.'), result.undoToken);
        refetch();
      })
      .catch((reason: unknown) => {
        const fieldErrors = fieldErrorsOf(reason);
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

  const openDeleteFor = (record: CrudRow) => {
    setDeleteTarget({ record, references: [], loaded: false });
    const recordId = rowIdOf(columns, record);
    // References preflight — consequences render in the confirm modal.
    api
      .remove(recordId, { dryRun: true })
      .then((result) => {
        setDeleteTarget((current) =>
          current !== null && rowIdOf(columns, current.record) === recordId
            ? { ...current, references: isDeletePreview(result) ? result.references : [], loaded: true }
            : current,
        );
      })
      .catch(() => {
        setDeleteTarget((current) =>
          current !== null && rowIdOf(columns, current.record) === recordId ? { ...current, loaded: true } : current,
        );
      });
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const recordId = rowIdOf(columns, deleteTarget.record);
    try {
      const result = await api.remove(recordId, { confirm: true });
      setDeleteTarget(null);
      if (peekId === recordId) setPeekId(null);
      // A deleted row cannot stay SELECTED. The bulk bar would go on counting
      // it, and — now that the export carries the whole selection rather than
      // whatever the loaded page happens to hold — the file would carry a row
      // the table no longer has. The bulk-delete path already clears the whole
      // selection; this is the same rule for the single-row path.
      setSelected((current) => {
        if (!current.has(recordId)) return current;
        const next = new Set(current);
        next.delete(recordId);
        return next;
      });
      pushUndoToast(
        t('ui:templates.crud.toast.deleted', '{name} deleted.', { name: displayValueOf(columns, deleteTarget.record) }),
        isDeletePreview(result) ? null : result.undoToken,
      );
      refetch();
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.deleteFailed', 'Delete failed.'),
      });
    }
  };

  const confirmBulkDelete = async () => {
    if (bulkDeleteIds === null) return;
    try {
      // `count` drives the ICU plural; `n` is the pre-stringified count so the
      // digits render exactly as before (no locale regrouping).
      const bulkDeletedTitle = (count: number) =>
        t('ui:templates.crud.toast.bulkDeleted', '{count, plural, one {{n} row deleted.} other {{n} rows deleted.}}', {
          count,
          n: String(count),
        });
      if (api.bulk !== undefined) {
        const result = await api.bulk('delete', [...bulkDeleteIds]);
        pushUndoToast(bulkDeletedTitle(result.results.filter((r) => r.ok).length), result.undoToken);
      } else {
        for (const id of bulkDeleteIds) await api.remove(id, { confirm: true });
        pushUndoToast(bulkDeletedTitle(bulkDeleteIds.length), null);
      }
      setBulkDeleteIds(null);
      setSelected(new Set());
      refetch();
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:templates.crud.toast.bulkDeleteFailed', 'Bulk delete failed.'),
      });
    }
  };

  /**
   * Bulk Export. `api.export` queues the server-side run (whole result set,
   * server-side masking, artifact in Data exports); without it the selected
   * rows — already on screen — are serialized and downloaded here, which is
   * the difference between an export button and a dead one. `xlsx` is offered
   * by neither path: `POST /exports` rejects it 422 by design.
   *
   * The format is fixed at CSV rather than chosen here. `BulkActionToolbar`
   * takes flat buttons and cannot host a chooser, so a second format would
   * mean a second permanent button in the selection bar; JSON-lines is a
   * pipeline format whose home is the Data exports page's format selector,
   * and `lib/export.ts` + `CrudApi.export` still carry both.
   */
  const runExport = async (format: CrudExportFormat, ids: readonly string[]) => {
    setExporting(true);
    try {
      if (api.export !== undefined) {
        await api.export({ format, ids: [...ids], params: listParams });
        queue.push({
          variant: 'success',
          // Nothing visible happens on the queued path — the artifact shows up
          // on another page — so this one has to say so. `exportBuilder.running`
          // is the bundle's existing "Preparing your export…"; the export-run it
          // describes is literally the one being queued here.
          title: t('ui:widgets.forms.exportBuilder.running', 'Preparing your export…'),
        });
      } else {
        // Dynamic: DOM-only serialization behind a click, and `/p/$slug` is in
        // the dashboard's entry chunk (scripts/check-entry-budget.mjs).
        const { downloadRows } = await import('../../lib/export.js');
        // From the SNAPSHOT, not from `list.rows` — the selection spans pages
        // and the loaded page is only the last of them. In `ids` order, which
        // is the order the rows were selected in.
        const snapshot = selectedRows.current;
        const rows = ids.flatMap((id) => {
          const row = snapshot.get(id);
          return row === undefined ? [] : [row];
        });
        downloadRows(format, columns.map((column) => column.name), rows, source.table);
        // No toast on the whole-selection path: the file lands in the browser's
        // own download UI, which is the confirmation. A toast would restate it.
        if (rows.length < ids.length) {
          // Unreachable by design — every id in `ids` was selected from a row
          // that had been rendered, which is what fills the snapshot. It is
          // here so that this export can never again be quietly short: an
          // incomplete file has to say the number it wrote.
          queue.push({
            variant: 'warning',
            title: t(
              'ui:templates.crud.toast.exportIncomplete',
              'Exported {written, number} of {selected, number} selected rows — reload and try again.',
              { written: rows.length, selected: ids.length },
            ),
          });
        }
      }
      // The selection SURVIVES an export: it is not destructive, and the rows
      // are usually still wanted afterwards.
    } catch (reason) {
      queue.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : t('ui:state.error', 'Something went wrong'),
      });
    } finally {
      setExporting(false);
    }
  };

  /*
   * THE FORM DOCUMENT (D10). A page carries one only when somebody designed a
   * form; with none it is derived from the live column facts, which is what
   * makes the dialog follow the table rather than the day the page was made.
   *
   * With no facts at all — an older server, a page with no source table — there
   * is nothing to derive from and the form renders the flat stack of stored
   * columns it always has.
   */
  const formDocument = useMemo(() => {
    if (formColumns === undefined || formColumns.length === 0) return null;
    return formDocumentFor(form ?? null, {
      columns: formColumns,
      ...(formRelations === undefined ? {} : { relations: formRelations }),
    });
  }, [form, formColumns, formRelations]);

  /**
   * The columns the FORM renders, which is not the same list as the grid's:
   * every writable column of the table, in table order, with the spec the
   * server built from the effective schema.
   */
  const editableColumns = useMemo(() => {
    if (formColumns === undefined || formColumns.length === 0) return columns;
    const stored = new Map(columns.map((column) => [column.name, column]));
    return formColumns.map((fact) => {
      const specced = fact.spec as unknown as GridColumnSpec;
      // The STORED spec wins where there is one: it carries what an admin
      // edited on this page (a label, a file block, an enum tone), which the
      // server's freshly-built spec knows nothing about.
      return stored.get(specced.name) ?? specced;
    });
  }, [columns, formColumns]);
  const selectedIds = useMemo(() => [...selected], [selected]);
  const rangeStart = list.rows.length === 0 ? 0 : cursorStack.length * pageSize + 1;
  const rangeEnd = cursorStack.length * pageSize + list.rows.length;
  const numberFormat = useMemo(() => getFormatters(locale ?? 'en-US'), [locale]);

  // 'Type {value} to confirm' is rich text (the value renders in MonoText):
  // format with a sentinel arg, then splice the styled node in at the seam.
  const confirmPromptFor = (value: string): ReactNode => {
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
  };

  return (
    <div data-part="page-crud" data-testid={testId} className="flex h-full min-h-0 flex-col">
      {/* ONE card holds toolbar + grid + footer, each pair separated by a
          hairline — the composition both comps use (Data Table.dc.html and
          CRUD Admin.dc.html are identical on this point). The toolbar used to
          float above a separate card, which read as two unrelated slabs and
          left the grid's card without the elevation every other surface has.
          `shadow-card` is `--shadow`, the token the comps set on this box.

          Height is content-driven and only CAPPED by the viewport
          (`max-h-full`, not `flex-1`): a page holding ten rows draws a card
          that ends just under its footer instead of one stretched to the
          bottom of the window with a band of empty surface between the last
          row and the pagination bar. Past the cap the card stops growing and
          the grid region below scrolls inside it, so the toolbar and footer
          stay pinned exactly as before. The outer `h-full` is what
          `max-h-full` resolves against, so both are load-bearing. */}
      <div className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {/* Toolbar. Search first, then the views/filter control, then the
            active filter chips; only the END slot swaps on selection (
            "morphs"). Selecting rows used to replace the WHOLE rail, which took
            the search box and the chips off screen exactly when a user is
            mid-way through narrowing a set — so they could no longer see, let
            alone adjust, the query their selection came from. */}
        <div className="flex min-h-[62px] items-center gap-2.5 border-b border-border px-4 py-3.5">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              labels?.searchPlaceholder ??
              t('ui:templates.crud.searchPlaceholder', 'Search {table}…', { table: source.table })
            }
            className="w-72"
            onClear={() => setSearch('')}
            clearLabel={t('ui:action.clearSearch', 'Clear search')}
          />
          {toolbarAccessory}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <FilterBar
              filters={filterSpecs}
              active={filters}
              onChange={(next) => {
                setFilters(next);
                // A new question is a new first page: keeping the cursor would
                // ask the server for page three of a result that has changed.
                setCursor('');
                setCursorStack([]);
              }}
            />
          </div>
          {selectedIds.length > 0 ? (
            <BulkActionToolbar
              selectedIds={selectedIds}
              actions={[
                {
                  key: 'export',
                  label: labels?.exportAction ?? t('ui:templates.crud.exportAction', 'Export'),
                  disabled: exporting,
                },
                ...(bulkActions ?? []).map((action) => ({
                  key: `${HOST_BULK_PREFIX}${action.key}`,
                  label: action.label,
                  ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
                })),
                ...(canDelete
                  ? [{ key: 'delete', label: labels?.deleteAction ?? t('ui:action.delete', 'Delete'), danger: true }]
                  : []),
              ]}
              onAction={(key, ids) => {
                if (key === 'delete') setBulkDeleteIds(ids);
                if (key === 'export') void runExport(BULK_EXPORT_FORMAT, ids);
                if (key.startsWith(HOST_BULK_PREFIX)) {
                  bulkActions?.find((action) => `${HOST_BULK_PREFIX}${action.key}` === key)?.run(ids);
                }
              }}
              onClear={() => setSelected(new Set())}
            />
          ) : (
            canCreate && (
              /* `topbar` is the size authored for exactly this CTA — the comp's
                 700 weight and asymmetric inset that keeps the leading `+` from
                 drifting off its label. The default `md` rendered it a weight
                 lighter and evenly padded. */
              <Button size="topbar" iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
                {labels?.newRow ?? t('ui:templates.crud.newRow', 'New row')}
              </Button>
            )
          )}
        </div>

        {listError !== null ? (
          <EmptyState
            tone={listError.tone}
            title={listError.title}
            body={listError.body}
            actions={
              // A paused connection offers no Retry: see `describeDataError`.
              listError.retryable ? (
                <Button size="sm" variant="secondary" onClick={refetch}>
                  {t('ui:action.retry', 'Retry')}
                </Button>
              ) : undefined
            }
          />
        ) : list.loading && list.rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label={t('ui:templates.crud.loadingRows', 'Loading rows')} />
          </div>
        ) : list.rows.length === 0 ? (
          q !== '' || filters.length > 0 ? (
            <EmptyState
              preset="no-matches"
              title={t('ui:templates.crud.noMatchesTitle', 'No matching rows')}
              body={t('ui:templates.common.noMatchesBody', 'Try a different search or remove a filter.')}
              // F18: the way out, where the person is looking. A filtered-away
              // table with the only Clear button up in the toolbar is a screen
              // that says "nothing here" and hides the reason.
              {...(filters.length === 0
                ? {}
                : {
                    actions: (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setFilters([]);
                          setCursor('');
                          setCursorStack([]);
                        }}
                        data-testid="filter-clear-empty"
                      >
                        {t('ui:templates.common.clearFilters', 'Clear filters')}
                      </Button>
                    ),
                  })}
            />
          ) : (
            <EmptyState
              preset="no-data"
              // `count` is the row total behind this state (always 0 here) so
              // locales get the ICU plural machinery on the entity noun.
              title={t('ui:templates.crud.emptyTitle', '{count, plural, one {No {entity} yet} other {No {entity}s yet}}', {
                count: 0,
                entity,
              })}
              {...(canCreate
                ? {
                    actions: (
                      <Button size="sm" iconLeft={<Plus />} onClick={() => setCreateOpen(true)}>
                        {labels?.newRow ?? t('ui:templates.crud.newRow', 'New row')}
                      </Button>
                    ),
                  }
                : {})}
            />
          )
        ) : (
          <div className="nb-scroll min-h-0 flex-1 overflow-y-auto">
            <DataGrid
              columns={columns}
              rows={list.rows}
              sort={sort}
              onSortChange={(next) => {
                setSort(next === null ? null : next);
                setCursor('');
                setCursorStack([]);
              }}
              selectable
              selected={selected}
              onSelectedChange={changeSelection}
              onRowOpen={(row) => openRecordPage(rowIdOf(columns, row))}
              rowEnd={(row) => (
                <>
                  {/*
                    * Host row actions BESIDE Peek, before it. Peek stays
                    * rightmost because it is the row's own affordance and has
                    * been in that position since the grid shipped; an
                    * add-on's action arriving to the LEFT of it moves nothing
                    * a person has already learned.
                    */}
                  {rowActions?.(row)}
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={labels?.peek ?? t('ui:templates.crud.peekAction', 'Peek')}
                    onClick={() => setPeekId(rowIdOf(columns, row))}
                  >
                    <Eye className="size-3.5" />
                  </IconButton>
                </>
              )}
              labels={{ rowActions: t('ui:widgets.tables.dataGrid.rowActionsLabel', 'Row actions') }}
              cellContext={cellContext}
            />
          </div>
        )}
        <PaginationFooter
          {...(locale === undefined ? {} : { locale })}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          total={total}
          hasPrev={cursorStack.length > 0}
          hasNext={list.nextCursor !== null}
          onPrev={() => {
            const previous = cursorStack.at(-1);
            if (previous === undefined) return;
            setCursorStack((stack) => stack.slice(0, -1));
            setCursor(previous);
          }}
          onNext={() => {
            if (list.nextCursor === null) return;
            setCursorStack((stack) => [...stack, cursor]);
            setCursor(list.nextCursor);
          }}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCursor('');
            setCursorStack([]);
          }}
          disabled={list.loading}
        />
      </div>

      {/*
        * CREATE — the designed dialog (D3, D4, D17).
        *
        * It was a `TwoPhaseModal` whose second phase said "added — Done" after
        * the toast had already said so and offered the Undo. One dialog, one
        * confirmation, and the row is in the grid behind it.
        */}
      <RecordFormDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateErrors({});
        }}
        mode="create"
        entity={entity}
        tableName={source.table}
        formId="page-crud-create-form"
        document={formDocument}
        columns={editableColumns}
        {...(formRelations === undefined ? {} : { relations: formRelations })}
        {...(childFacts === undefined ? {} : { childFacts })}
        errors={createErrors}
        {...(columnFacts === undefined ? {} : { facts: columnFacts })}
        {...(listOptions === undefined ? {} : { listOptions })}
        lookup={api.lookup?.bind(api)}
        availability={api.availability?.bind(api)}
        {...(files === undefined ? {} : { uploadFile: files.upload, files: resolvedFiles })}
        {...(files?.maxBytes === undefined ? {} : { maxFileBytes: files.maxBytes })}
        {...(currency === undefined ? {} : { currency })}
        {...(locale === undefined ? {} : { locale })}
        onSubmit={handleCreate}
        {...(labels?.createTitle === undefined && labels?.createSubmit === undefined && labels?.close === undefined
          ? {}
          : {
              labels: {
                ...(labels?.createTitle === undefined ? {} : { title: labels.createTitle }),
                ...(labels?.createSubmit === undefined ? {} : { submit: labels.createSubmit }),
                ...(labels?.close === undefined ? {} : { close: labels.close }),
              },
            })}
        uniqueHelper={() =>
          total === null
            ? t('ui:templates.crud.uniqueHelper', 'Must be unique in {table}.', { table: source.table })
            : // `count` drives the ICU plural; `n` keeps the pre-formatted digits.
              t(
                'ui:templates.crud.uniqueHelperCounted',
                '{count, plural, one {Checked against {n} row.} other {Checked against {n} rows.}}',
                { count: total, n: numberFormat.number(total) },
              )
        }
      />

      {/* Peek — ephemeral row preview behind the eye action. The
          header's "Open page" lands on the record page, so the peek is a step
          toward it, never a dead end. */}
      <Drawer open={peekId !== null} onOpenChange={(open) => !open && setPeekId(null)} size="md">
        <DrawerHeader title={entity} closeLabel={labels?.close ?? t('ui:action.close', 'Close')}>
          <button
            type="button"
            data-part="peek-open-page"
            className="mt-0.5 inline-flex items-center gap-1 text-body-sm font-semibold text-accent hover:underline"
            onClick={() => {
              const target = peekId;
              setPeekId(null);
              if (target !== null) openRecordPage(target);
            }}
          >
            {t('ui:templates.crud.openPage', 'Open page')}
            <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </DrawerHeader>
        <DrawerBody>
          {peekId !== null && (
            <RecordDetail
              api={api}
              columns={columns}
              recordId={peekId}
              cellContext={cellContext}
              {...(canUpdate ? { onEdit: (record: CrudRow) => setEditRecord(record) } : {})}
              {...(canDelete ? { onDelete: (record: CrudRow) => openDeleteFor(record) } : {})}
            />
          )}
        </DrawerBody>
      </Drawer>

      {/*
        * EDIT — the same dialog as create (D3). It was a 480px drawer, which
        * made editing a row look like a different operation from adding one.
        * The PEEK below stays a drawer: it is a preview, not a form.
        */}
      <RecordFormDialog
        open={editRecord !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditRecord(null);
            setEditErrors({});
          }
        }}
        mode="edit"
        entity={entity}
        tableName={source.table}
        formId="page-crud-edit-form"
        document={formDocument}
        columns={editableColumns}
        {...(formRelations === undefined ? {} : { relations: formRelations })}
        {...(childFacts === undefined ? {} : { childFacts })}
        {...(editChildren === undefined ? {} : { initialChildren: editChildren })}
        initialLinks={editLinks}
        {...(editRecord === null
          ? {}
          : { initialValues: editRecord, recordId: rowIdOf(columns, editRecord) })}
        errors={editErrors}
        {...(columnFacts === undefined ? {} : { facts: columnFacts })}
        {...(listOptions === undefined ? {} : { listOptions })}
        lookup={api.lookup?.bind(api)}
        availability={api.availability?.bind(api)}
        {...(files === undefined ? {} : { uploadFile: files.upload, files: resolvedFiles })}
        {...(files?.maxBytes === undefined ? {} : { maxFileBytes: files.maxBytes })}
        {...(currency === undefined ? {} : { currency })}
        {...(locale === undefined ? {} : { locale })}
        onSubmit={handleUpdate}
        {...(labels?.editTitle === undefined && labels?.close === undefined
          ? {}
          : {
              labels: {
                ...(labels?.editTitle === undefined ? {} : { title: labels.editTitle }),
                ...(labels?.close === undefined ? {} : { close: labels.close }),
              },
            })}
      />

      {/* Cascade-aware type-to-confirm delete. */}
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
        confirmWord={deleteTarget === null ? '' : displayValueOf(columns, deleteTarget.record)}
        promptLabel={deleteTarget === null ? '' : confirmPromptFor(displayValueOf(columns, deleteTarget.record))}
        confirmLabel={t('ui:action.delete', 'Delete')}
        cancelLabel={t('ui:action.cancel', 'Cancel')}
        closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        onConfirm={confirmDelete}
      />

      {/* Bulk delete — consequence totals + type-to-confirm count. */}
      <ConfirmModal
        open={bulkDeleteIds !== null}
        onOpenChange={(open) => !open && setBulkDeleteIds(null)}
        title={t('ui:templates.crud.bulkDeleteTitle', '{count, plural, one {Delete {n} row} other {Delete {n} rows}}', {
          count: bulkDeleteIds?.length ?? 0,
          n: String(bulkDeleteIds?.length ?? 0),
        })}
        body={t('ui:templates.crud.bulkDeleteBody', 'Referential consequences apply to every selected row.')}
        confirmWord={String(bulkDeleteIds?.length ?? 0)}
        promptLabel={confirmPromptFor(String(bulkDeleteIds?.length ?? 0))}
        confirmLabel={t('ui:templates.crud.bulkDeleteConfirm', 'Delete rows')}
        cancelLabel={t('ui:action.cancel', 'Cancel')}
        closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        onConfirm={confirmBulkDelete}
      />

      {/* aria-live keeps the stack out of Radix's modal hideOthers sweep
          (aria-hidden pkg preserves live regions) — undo toasts fired while
          the create/confirm modal is still open stay reachable. */}
      <ToastStack
        {...queue.stackProps}
        aria-live="polite"
        dismissLabel={labels?.dismiss ?? t('ui:widgets.feeds.toastStack.dismissLabel', 'Dismiss')}
      />
    </div>
  );
}
