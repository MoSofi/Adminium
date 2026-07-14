/**
 * `page-crud` binding (09-generated-app.md §4.1, §7.1): projects the page
 * envelope onto the real `PageCrud` template from `@adminium/widgets` —
 * `config.columns[]` → validated `GridColumnSpec[]` (invalid entries are
 * dropped with a console warning, never a crash), the bound `CrudApi`
 * adapter, route-controlled detail record, and the host WidgetEvent sink.
 *
 * It also owns saved views (M5-T06): the views query/mutations for this page,
 * auto-applying a default view on load, and applying a selected view by
 * remounting PageCrud with the view's grid state as initial props — so a view
 * round-trips exactly (search / sort / filters / page size).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageCrud, gridColumnSpecSchema, type GridColumnSpec, type PageCrudGridState } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import { useAppToasts } from './toasts.js';
import type { PageTemplateProps } from './template-types.js';
import { ViewSwitcher } from './views/ViewSwitcher.js';
import { useSavedViews } from './views/useSavedViews.js';
import { configToProps, gridStateToConfig } from './views/viewState.js';
import type { SavedView } from './views/viewsApi.js';

function parseColumns(config: Record<string, unknown>, pageId: string): GridColumnSpec[] {
  const raw = config['columns'];
  if (!Array.isArray(raw)) return [];
  const columns: GridColumnSpec[] = [];
  for (const entry of raw) {
    const parsed = gridColumnSpecSchema.safeParse(entry);
    if (parsed.success) {
      columns.push(parsed.data);
    } else {
      console.warn(`[adminium] ${pageId}: dropping invalid column spec`, parsed.error.issues[0]?.message);
    }
  }
  return columns;
}

const BASE_GRID_STATE: PageCrudGridState = { search: '', sort: null, filters: [], pageSize: 50 };

export function PageCrudBinding({ page, adapters, recordId }: PageTemplateProps) {
  const crud = adapters.crud;
  const columns = useMemo(() => parseColumns(page.config, page.id), [page.config, page.id]);

  const toasts = useAppToasts();
  const { views, createView, updateView, deleteView } = useSavedViews(page.id);

  // Applied view + a remount token: bumping the token re-mounts PageCrud so its
  // initial props (the view's grid state) take effect (M5-T06).
  const [appliedView, setAppliedView] = useState<SavedView | null>(null);
  const [appliedToken, setAppliedToken] = useState(0);
  const gridStateRef = useRef<PageCrudGridState>(BASE_GRID_STATE);
  const initializedRef = useRef(false);

  const captureGridState = useCallback((state: PageCrudGridState) => {
    gridStateRef.current = state;
  }, []);

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

  const viewProps = configToProps(appliedView?.config ?? null);

  return (
    <PageCrud
      key={appliedToken}
      api={crud}
      columns={columns}
      source={{ connectionId: page.source.connectionId, table: page.source.table ?? crud.table }}
      detailRecordId={recordId ?? null}
      onDetailRecordChange={adapters.openRecord}
      onEvent={adapters.onEvent}
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
  );
}
