// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-crud` binding: projects the page envelope onto the real `PageCrud`
 * template from `@adminium/widgets` — `config.columns[]` → validated
 * `GridColumnSpec[]` (invalid entries are dropped with a console warning,
 * never a crash), the bound `CrudApi` adapter, and the host WidgetEvent
 * sink. Row click emits `record-open` and the host navigates to the record
 * PAGE — this binding no longer routes a detail id in or out.
 *
 * It also owns saved views: the views query/mutations for this page,
 * auto-applying a default view on load, and applying a selected view by
 * remounting PageCrud with the view's grid state as initial props — so a view
 * round-trips exactly (search / sort / filters / page size).
 *
 * Write affordances ride the per-caller `canCreate`/`canUpdate`/`canDelete`
 * capabilities the page reply resolved from the caller's table grants
 * — a read-only grantee sees no New row, and the peek carries no Edit/Delete,
 * instead of buttons that 403.
 *
 * Chrome copy rides `config.labels`: the stored per-page overrides the Studio
 * editor writes, projected straight onto the template's `labels` prop. Absent
 * (the generated default) leaves the prop undefined and every string resolves
 * from the locale bundles as before.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageCrud, rowIdOf, type PageCrudFiles, type PageCrudGridState } from '@adminium/widgets';
import { filtersFor, parseCrudFilters, parseCrudForm, parseCrudLabels } from '@adminium/engine/config';

import { bootstrapQuery } from '../app/bootstrap.js';
import { resolveFiles, uploadFile } from '../files/api.js';
import { listKeysOf, useListOptions } from '../api/optionLists.js';
import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { parseColumns, projectionParamsOf, withFkDisplay, withLookups } from './columnSpecs.js';
import { ProjectActionMenu, useProjectActions } from './projectActions.js';
import { useAppToasts } from './toasts.js';
import type { FormChildFactReply } from '../api/pages.js';
import type { PageTemplateProps } from './template-types.js';
import { ViewSwitcher } from './views/ViewSwitcher.js';
import { useSavedViews } from './views/useSavedViews.js';
import { configToProps, gridStateToConfig } from './views/viewState.js';
import type { SavedView } from './views/viewsApi.js';

const BASE_GRID_STATE: PageCrudGridState = { search: '', sort: null, filters: [], pageSize: 50 };

/**
 * Last grid state per page for THIS session: row click now navigates to the
 * record page, which unmounts the list — without this, back/forward walked
 * the user's search, sort and filters away. Module scope (not URL, not
 * storage): a navigation memory, same lifetime as the SPA, exactly like the
 * drawer era where the list never unmounted at all. Pagination cursor is
 * deliberately not captured — a return restores a query, not a scroll
 * position (the saved-view rule).
 */
const lastGridState = new Map<string, PageCrudGridState>();

export function PageCrudBinding({
  page,
  adapters,
  canCreate,
  canUpdate,
  canDelete,
  canUnmask,
  columnFacts,
  formColumns,
  formRelations,
  formChildren,
  tableLabelSingular,
  tableLabelPlural,
  currency,
}: PageTemplateProps) {
  // Read from the cache, never fetched here: the shell loads the bootstrap
  // before any page renders, and a page must not suspend on it.
  const signedIn = useQueryClient().getQueryData(bootstrapQuery().queryKey)?.user;
  /*
   * A `column.options` rule that names a LIST is resolved here, where the
   * reader's language is known: the built-ins from the browser's own data, a
   * custom list from the workspace's store — and only when a column names one,
   * so a page with no lists makes no request.
   */
  const listOptions = useListOptions(useMemo(() => listKeysOf(columnFacts), [columnFacts]));

  // Explicit lookup columns plus the derived FK-chip display lookups
  // (fk.display → `<name>__display` params + displayKey stamps), one plan so
  // the columns PageCrud renders and the params its reads carry never drift.
  const { columns, lookups } = useMemo(
    () => withFkDisplay(parseColumns(page.config, page.id)),
    [page.config, page.id],
  );
  // Lookup columns ride every read as `lookup=` params, reverse-link columns
  // as `agg=` params, and the page's stored `config.derived` block as the one
  // `compute=` param — the server aliases the referenced-table values, the
  // per-row folds and the computed fields into the rows under the specs' own
  // names.
  const crud = useMemo(() => {
    const bound = adapters.crud;
    if (bound === null) return null;
    const { agg, compute } = projectionParamsOf(columns, page.config);
    return withLookups(bound, lookups, agg, compute);
  }, [adapters.crud, columns, lookups, page.config]);

  // Per-page chrome overrides ("Add invoice" for "New row"). `null` when the
  // page stores none, which is what keeps the prop undefined and the template
  // on its own translated defaults.
  const labels = useMemo(() => parseCrudLabels(page.config), [page.config]);

  /*
   * The page's own form document, if somebody designed one.
   * Parsed HERE for the same reason `labels` is: a stored block is a page
   * document's business, and the template takes the parsed value rather than
   * re-parsing a config it would have to know the shape of. `null` — the norm —
   * means the dialog derives the form from the live column facts.
   */
  const form = useMemo(() => parseCrudForm(page.config), [page.config]);

  /*
   * The tables a line-items field draws from, keyed by relation. Built here
   * rather than in the template because it is the page REPLY's shape being
   * projected onto the template's — the same job `columns` and `form` do.
   */
  const childFacts = useMemo(() => {
    if (formChildren === undefined || formChildren.length === 0) return undefined;
    return Object.fromEntries(
      formChildren.map((child: FormChildFactReply) => [
        child.relationId,
        {
          label: child.label,
          table: child.childTable,
          foreignColumn: child.foreignColumn,
          // The parent column the child points at is its own key: the server
          // refuses a relation that points anywhere else.
          parentKeyColumn: primaryKeyOf(columns)[0] ?? 'id',
          primaryKey: primaryKeyOf(child.columns.map((column) => column.spec)),
          columns: parseColumns({ columns: child.columns.map((column) => column.spec) }, page.id),
          facts: Object.fromEntries(
            child.columns.map((column) => [
              String(column.spec['name'] ?? ''),
              {
                filledBy: column.filledBy,
                required: column.required,
                writable: column.writable,
                ...(column.options === undefined ? {} : { options: column.options }),
              },
            ]),
          ),
        },
      ]),
    );
  }, [formChildren, columns, page.id]);

  /*
   * The toolbar's filters. Stored when somebody defined them in Studio,
   * DERIVED otherwise — a table nobody has configured still gets the one or two
   * filters its own columns justify, which is what makes the affordance exist
   * on the pages generation wrote.
   *
   * Masked columns are excluded unless this caller may unmask: a menu over a
   * redacted column either lists what the mask exists to hide or lists dots
   * nobody can choose between.
   */
  const filterFields = useMemo(
    () =>
      filtersFor(parseCrudFilters(page.config), {
        columns: (formColumns ?? []).map((column, index) => ({
          // `options` rides beside the spec in the reply; the leaf reads it
          // inside. A column an admin gave allowed values is a CHOICE column.
          spec: {
            ...column.spec,
            ...(column.options === undefined ? {} : { options: column.options }),
          } as never,
          ordinal: column.ordinal ?? index,
          masked: canUnmask === true ? false : column.spec['pii'] === true,
        })),
      }),
    [page.config, formColumns, canUnmask],
  );

  const toasts = useAppToasts();
  const { views, createView, updateView, deleteView } = useSavedViews(page.id);

  // Applied view + a remount token: bumping the token re-mounts PageCrud so its
  // initial props (the view's grid state) take effect.
  const [appliedView, setAppliedView] = useState<SavedView | null>(null);
  const [appliedToken, setAppliedToken] = useState(0);
  const gridStateRef = useRef<PageCrudGridState>(BASE_GRID_STATE);
  // A remembered state means the user was JUST here (list → record → back):
  // restoring what they left beats re-applying the default view over it.
  const restoredState = useRef(lastGridState.get(page.id) ?? null).current;
  const initializedRef = useRef(restoredState !== null);

  const captureGridState = useCallback(
    (state: PageCrudGridState) => {
      gridStateRef.current = state;
      lastGridState.set(page.id, state);
    },
    [page.id],
  );

  const applyView = useCallback((view: SavedView | null) => {
    initializedRef.current = true;
    setAppliedView(view);
    setAppliedToken((token) => token + 1);
  }, []);

  // Auto-apply the default view once, after the list first loads.
  useEffect(() => {
    if (initializedRef.current || views.length === 0) return;
    initializedRef.current = true;
    const preset = views.find((view) => view.isDefault);
    if (preset !== undefined) applyView(preset);
  }, [views, applyView]);

  const notifyError = useCallback(
    (reason: unknown, fallback: string) => {
      toasts.push({
        variant: 'error',
        title: reason instanceof Error ? reason.message : fallback,
      });
    },
    [toasts],
  );

  const handleSaveNew = useCallback(
    async (name: string) => {
      const created = await createView({ name, config: gridStateToConfig(gridStateRef.current) });
      applyView(created);
      toasts.push({ variant: 'success', title: t('views.savedToast', 'View “{name}” saved.', { name: created.name }) });
    },
    [createView, applyView, toasts],
  );

  const handleUpdate = useCallback(
    (view: SavedView) => {
      updateView(view.id, { config: gridStateToConfig(gridStateRef.current) })
        .then(() => {
          toasts.push({ variant: 'success', title: t('views.updatedToast', 'View “{name}” updated.', { name: view.name }) });
        })
        .catch((reason: unknown) => notifyError(reason, t('views.saveFailed', 'Could not save the view.')));
    },
    [updateView, toasts, notifyError],
  );

  const handleRename = useCallback(
    async (view: SavedView, name: string) => {
      const updated = await updateView(view.id, { name });
      if (appliedView?.id === view.id) setAppliedView(updated);
    },
    [updateView, appliedView],
  );

  const handleSetDefault = useCallback(
    (view: SavedView) => {
      updateView(view.id, { isDefault: true })
        .then((updated) => {
          if (appliedView?.id === view.id) setAppliedView(updated);
          toasts.push({ variant: 'success', title: t('views.defaultToast', '“{name}” is now the default view.', { name: view.name }) });
        })
        .catch((reason: unknown) => notifyError(reason, t('views.saveFailed', 'Could not save the view.')));
    },
    [updateView, appliedView, toasts, notifyError],
  );

  const handleDelete = useCallback(
    async (view: SavedView) => {
      await deleteView(view.id);
      if (appliedView?.id === view.id) applyView(null);
      toasts.push({ variant: 'success', title: t('views.deletedToast', 'View “{name}” deleted.', { name: view.name }) });
    },
    [deleteView, appliedView, applyView, toasts],
  );

  // The project's own actions for this table: a row menu and, for `bulk`
  // ones, the bulk bar. None unless the server runs a project that has them.
  // PageCrud keeps its rows itself and reads them again when its `api` object
  // changes, so an action that changed data hands it a new one (as the record
  // page does).
  const [actionRuns, setActionRuns] = useState(0);
  const projectActions = useProjectActions(
    page.source.connectionId,
    page.source.table ?? crud?.table,
    useCallback(() => setActionRuns((n) => n + 1), []),
  );
  const gridApi = useMemo(
    () => (actionRuns === 0 || crud === null ? crud : (Object.create(crud) as typeof crud)),
    [crud, actionRuns],
  );
  const bulkActions = useMemo(
    () =>
      projectActions.bulk.map((action) => ({
        key: action.id,
        label: action.label,
        disabled: projectActions.busy,
        run: (ids: readonly string[]) => projectActions.start(action, ids),
      })),
    [projectActions],
  );

  if (crud === null) {
    // Bad generation output (page-crud without a source) — caught by the
    // PageRenderer error boundary and rendered as the page error card.
    throw new Error(`page-crud document ${page.id} has no source table`);
  }

  // Initial grid state: an explicitly applied view wins; otherwise the state
  // the user left this page in (list → record → back, T12); otherwise base.
  const viewProps = configToProps(
    appliedView?.config ?? (restoredState === null ? null : gridStateToConfig(restoredState)),
  );
  const sourceTable = page.source.table ?? crud.table;

  /**
   * The file transport for this page.
   *
   * Handed down ONLY when a column actually carries a `file` block: a table
   * with none must not gain an adapter it would never call, and the widget's
   * own rule is that an absent adapter renders exactly what it rendered before
   * the feature existed.
   *
   * NO CLIENT-SIDE CAPS ARE PASSED. `files.maxBytes` and
   * `files.thumbnailMaxBytes` are workspace settings and the SERVER is the
   * boundary for both — it refuses an over-size upload with a 413 naming the
   * limit, and a thumbnail is only ever fetched through the same-origin content
   * route. The widget's own defaults are the same numbers as the settings'
   * defaults, so an instance that has not changed them behaves identically;
   * plumbing a settings read through the page reply to make the browser repeat
   * a check it cannot enforce is not worth the round trip.
   */
  const hasFileColumns = useMemo(() => columns.some((column) => column.file !== undefined), [columns]);
  const fileAdapter = useMemo<PageCrudFiles>(
    () => ({
      resolve: (refs) => resolveFiles([...refs]),
      upload: async ({ file, column, signal, onProgress }) => {
        const result = await uploadFile({
          file,
          connectionId: page.source.connectionId ?? '',
          table: sourceTable,
          column,
          signal,
          onProgress,
        });
        return {
          // The reference the SERVER minted, in the shape this column is
          // configured for — never one the browser composed.
          ref: result.ref ?? result.data.id,
          file: result.data,
        };
      },
    }),
    [page.source.connectionId, sourceTable, columns],
  );

  return (
    <>
      {/* The topbar title is the nav label an admin chose ("Support tickets");
          this says which table the page is actually a projection of. A database
          identifier, so it carries no translatable string. */}
      <PageActions subtitle={sourceTable} />
      {/* The page gutter and the `--container-wide` column come from the
          `PageSurface` PageRenderer wraps every template in (see
          pages/surfaceDefaults.ts) — without them the card's border, radius and
          shadow all die against the viewport edge and `--bg` never shows, which
          is what made the grid read as raw full-bleed rows. That surface also
          carries the `h-full` that lets PageCrud's own chain resolve. */}
      <PageCrud
        key={appliedToken}
        api={gridApi ?? crud}
        // A form field may start as who is signed in (`initial: current-user`).
        {...(signedIn === undefined ? {} : { currentUser: { id: signedIn.id, name: signedIn.name } })}
        columns={columns}
        source={{ connectionId: page.source.connectionId, table: sourceTable }}
        onEvent={adapters.onEvent}
        // Spread, not `labels={labels ?? undefined}`: `exactOptionalPropertyTypes`
        // distinguishes an absent prop from one explicitly set to undefined.
        {...(labels === null ? {} : { labels })}
        // Grants-driven affordances: false hides New row / Edit /
        // Delete (toolbar, empty state, bulk bar, peek) so a read-only grant
        // never renders a button that 403s; undefined keeps the widget's
        // permissive default.
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        // The file transport. Passed only when the page has at
        // least one `file` column: a table with none must not gain an adapter
        // it would never call, and the widget's own rule is that an absent
        // adapter renders exactly what it rendered before the feature existed.
        {...(hasFileColumns ? { files: fileAdapter } : {})}
        // PII cells reveal only for callers the server actually sent the
        // values to in clear (pageReply.canUnmask; default stays masked).
        canUnmask={canUnmask}
        {...(columnFacts === undefined ? {} : { columnFacts })}
        listOptions={listOptions}
        {...(formColumns === undefined ? {} : { formColumns: formColumns as never })}
        filterFields={filterFields}
        {...(formRelations === undefined ? {} : { formRelations })}
        {...(childFacts === undefined ? {} : { childFacts })}
        form={form}
        {...(tableLabelSingular === undefined || tableLabelSingular === null
          ? {}
          : { entityName: tableLabelSingular })}
        {...(tableLabelPlural === undefined || tableLabelPlural === null ? {} : { tableLabel: tableLabelPlural })}
        // The connection's own currency for money cells. Spread so
        // an unset one leaves the prop absent and the historical USD fallback
        // in place.
        {...(currency === undefined ? {} : { currency })}
        initialSearch={viewProps.initialSearch}
        defaultSort={viewProps.defaultSort}
        initialFilters={viewProps.initialFilters}
        {...(viewProps.pageSize === undefined ? {} : { pageSize: viewProps.pageSize })}
        onGridStateChange={captureGridState}
        toolbarAccessory={
          <ViewSwitcher
            views={views}
            activeViewId={appliedView?.id ?? null}
            onApply={applyView}
            onSaveNew={handleSaveNew}
            onUpdate={(view) => {
              handleUpdate(view);
              return Promise.resolve();
            }}
            onRename={handleRename}
            onDelete={handleDelete}
            onSetDefault={(view) => {
              handleSetDefault(view);
              return Promise.resolve();
            }}
          />
        }
        {...(projectActions.record.length === 0
          ? {}
          : {
              rowActions: (row: Record<string, unknown>) => (
                <ProjectActionMenu actions={projectActions} id={rowIdOf(columns, row)} />
              ),
            })}
        {...(bulkActions.length === 0 ? {} : { bulkActions })}
      />
      {projectActions.dialog}
    </>
  );
}

/** The key columns of a spec list, in order. */
function primaryKeyOf(specs: readonly Record<string, unknown>[]): string[] {
  return specs.filter((spec) => spec['primaryKey'] === true).map((spec) => String(spec['name']));
}
