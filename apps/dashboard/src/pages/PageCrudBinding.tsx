// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-crud` binding (09-generated-app.md §4.1, §7.1): projects the page
 * envelope onto the real `PageCrud` template from `@adminium/widgets` —
 * `config.columns[]` → validated `GridColumnSpec[]` (invalid entries are
 * dropped with a console warning, never a crash), the bound `CrudApi`
 * adapter, and the host WidgetEvent sink. Row click emits `record-open` and
 * the host navigates to the record PAGE (30-record-pages.md D1) — this
 * binding no longer routes a detail id in or out.
 *
 * It also owns saved views (M5-T06): the views query/mutations for this page,
 * auto-applying a default view on load, and applying a selected view by
 * remounting PageCrud with the view's grid state as initial props — so a view
 * round-trips exactly (search / sort / filters / page size).
 *
 * Write affordances ride the per-caller `canCreate`/`canUpdate`/`canDelete`
 * capabilities the page reply resolved from the caller's table grants
 * (30-record-pages.md D4) — a read-only grantee sees no New row, and the peek
 * carries no Edit/Delete, instead of buttons that 403.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageCrud, type PageCrudGridState } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { aggParamsOf, parseColumns, withFkDisplay, withLookups } from './columnSpecs.js';
import { useAppToasts } from './toasts.js';
import type { PageTemplateProps } from './template-types.js';
import { ViewSwitcher } from './views/ViewSwitcher.js';
import { useSavedViews } from './views/useSavedViews.js';
import { configToProps, gridStateToConfig } from './views/viewState.js';
import type { SavedView } from './views/viewsApi.js';

const BASE_GRID_STATE: PageCrudGridState = { search: '', sort: null, filters: [], pageSize: 50 };

/**
 * Last grid state per page for THIS session (30-record-pages.md T12): row
 * click now navigates to the record page, which unmounts the list — without
 * this, back/forward walked the user's search, sort and filters away. Module
 * scope (not URL, not storage): a navigation memory, same lifetime as the
 * SPA, exactly like the drawer era where the list never unmounted at all.
 * Pagination cursor is deliberately not captured — a return restores a query,
 * not a scroll position (the M5-T06 saved-view rule).
 */
const lastGridState = new Map<string, PageCrudGridState>();

export function PageCrudBinding({ page, adapters, canCreate, canUpdate, canDelete, canUnmask }: PageTemplateProps) {
  // Explicit lookup columns plus the derived FK-chip display lookups
  // (fk.display → `<name>__display` params + displayKey stamps), one plan so
  // the columns PageCrud renders and the params its reads carry never drift.
  const { columns, lookups } = useMemo(
    () => withFkDisplay(parseColumns(page.config, page.id)),
    [page.config, page.id],
  );
  // Lookup columns ride every read as `lookup=` params, reverse-link columns
  // as `agg=` params — the server aliases the referenced-table values and the
  // per-row counts into the rows under the specs' own names.
  const crud = useMemo(() => {
    const bound = adapters.crud;
    return bound === null ? null : withLookups(bound, lookups, aggParamsOf(columns));
  }, [adapters.crud, columns, lookups]);

  const toasts = useAppToasts();
  const { views, createView, updateView, deleteView } = useSavedViews(page.id);

  // Applied view + a remount token: bumping the token re-mounts PageCrud so its
  // initial props (the view's grid state) take effect (M5-T06).
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
        api={crud}
        columns={columns}
        source={{ connectionId: page.source.connectionId, table: sourceTable }}
        onEvent={adapters.onEvent}
        // Grants-driven affordances (30 D4): false hides New row / Edit /
        // Delete (toolbar, empty state, bulk bar, peek) so a read-only grant
        // never renders a button that 403s; undefined keeps the widget's
        // permissive default.
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        // PII cells reveal only for callers the server actually sent the
        // values to in clear (pageReply.canUnmask; default stays masked).
        canUnmask={canUnmask}
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
      />
    </>
  );
}
