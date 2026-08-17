/**
 * Dashboard builder shell (04-widget-registry.md §6.2/§6.3, task 04-T14).
 * Wraps the `page-dashboard` render path with an edit-mode surface:
 *
 *  - a header "Edit" button (any viewer may edit; page-edit roles edit the
 *    SHARED default, everyone else their PERSONAL override — `editTargetForRoles`);
 *  - a widget palette (add at first-fit) and an auto-generated config inspector;
 *  - duplicate / remove per widget;
 *  - save flow: page-edit users publish the shared default via `useSaveSharedLayout`;
 *    personal rearrangements auto-save via `useSavePersonalLayout`; a page-kebab
 *    "Reset layout" (`useResetLayout`) drops the personal override and restores
 *    the shared default without a reload.
 *
 * EDIT-MODE EXITS ARE EXPLICIT. Both were previously implicit or misnamed: a
 * View/Edit `SegmentedControl` read as two buttons where "View" looked inert in
 * view mode and silently SAVED in edit mode, while "Save layout" saved without
 * leaving. And "Reset layout" — a personal-override action — was offered to
 * shared editors, for whom its DELETE hit nothing and its `setMode('view')`
 * merely threw the draft away. Now: "Edit" opens; "Save layout"/"Done" keeps and
 * closes; "Discard changes" reverts and closes; the kebab appears only for the
 * personal editors "Reset layout" is actually for.
 *
 * View mode renders the unchanged live `PageDashboard`; edit mode renders the
 * working draft on `BuilderGrid` from deterministic demo data.
 */

import { useQuery } from '@tanstack/react-query';
import { MoreVertical, Pencil, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@adminium/ui';
import {
  PageDashboard,
  getWidget,
  type DashboardDataStates,
  type WidgetDefinition,
  type WidgetEvent,
} from '@adminium/widgets';
import { pageLayoutSchema, type PageLayout } from '@adminium/widgets/page-config';
import type { PageEnvelope } from '@adminium/engine/config';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import {
  useResetLayout,
  useSavePersonalLayout,
  useSaveSharedLayout,
} from '../layout/useLayoutPersistence.js';
import { editTargetForCapability } from './permissions.js';
import { lockedPathsOf } from './placement.js';
import { humanize } from './text.js';
import { useBuilderLayout } from './useBuilderLayout.js';
import { widgetDisplayName } from './WidgetPalette.js';

/* Edit-mode surfaces, lazily loaded. None of them can be on screen until the
   user clicks "Edit", so shipping them in the entry chunk buys nothing and the
   ratchet (apps/dashboard/scripts/check-entry-budget.mjs) charges for it. Each
   is rendered only while open, so a null fallback replaces nothing. */
const BuilderGrid = lazy(async () => ({
  default: (await import('./BuilderGrid.js')).BuilderGrid,
}));
const ConfigInspector = lazy(async () => ({
  default: (await import('./ConfigInspector.js')).ConfigInspector,
}));
const WidgetPalette = lazy(async () => ({
  default: (await import('./WidgetPalette.js')).WidgetPalette,
}));

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

export interface DashboardBuilderProps {
  page: PageEnvelope;
  /** Per-caller `page:<id>:edit` capability from the server (04 §6.3). When
   *  true the builder edits the SHARED default; otherwise a PERSONAL override.
   *  This matches the server's per-page grant model — never role slugs. */
  canEditLayout?: boolean | undefined;
  states?: DashboardDataStates | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  /** Palette registry override (tests / manifest host); defaults to the global registry. */
  registry?: ReadonlyMap<string, WidgetDefinition> | undefined;
}

export function DashboardBuilder({ page, canEditLayout = false, states, onEvent, registry }: DashboardBuilderProps) {
  const pageId = page.id;
  const title = t(page.title.key, page.title.fallback);

  const bootstrap = useQuery(bootstrapQuery());
  const dir = bootstrap.data?.prefs.dir ?? 'ltr';
  const editTarget = editTargetForCapability(canEditLayout);
  const canEditShared = editTarget === 'shared';

  const seed = useMemo<PageLayout>(() => {
    const parsed = pageLayoutSchema.safeParse(page.config['layout']);
    return parsed.success ? parsed.data : EMPTY_LAYOUT;
  }, [page.config]);
  const seedRef = useRef(seed);
  seedRef.current = seed;

  const {
    draft,
    selectedId,
    dirty,
    add,
    duplicate,
    remove,
    setConfig,
    replace,
    select,
    reseed,
    markClean,
  } = useBuilderLayout(seed);

  const shared = useSaveSharedLayout(pageId);
  const personal = useSavePersonalLayout(pageId);
  const resetLayout = useResetLayout(pageId);
  const { save: sharedSave, flush: sharedFlush, isSaving: sharedSaving } = shared;
  const { save: personalSave, flush: personalFlush, cancel: personalCancel, isSaving: personalSaving } = personal;

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => setAnnouncement(message), []);

  // Re-seed the draft from the live resolved layout every time edit mode opens.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === 'view' && mode === 'edit') reseed(seedRef.current);
    prevMode.current = mode;
  }, [mode, reseed]);

  // Personal overrides auto-save (debounced) as the draft changes.
  useEffect(() => {
    if (mode === 'edit' && editTarget === 'personal' && dirty) personalSave(draft);
  }, [draft, dirty, mode, editTarget, personalSave]);

  const commitOnExit = useCallback(() => {
    if (editTarget === 'personal') {
      void personalFlush();
    } else if (dirty) {
      sharedSave(draft);
      void sharedFlush();
      markClean();
    }
  }, [editTarget, dirty, draft, personalFlush, sharedSave, sharedFlush, markClean]);

  /**
   * Leave edit mode, keeping the work — the primary action ("Save layout" for a
   * shared editor, "Done" for a personal one, whose changes already auto-saved).
   *
   * Saving used to be a SIDE EFFECT of the View/Edit toggle: picking "View"
   * silently committed, while the explicit "Save layout" button saved and left
   * you in edit mode. Two paths, opposite exit behaviour, neither labelled.
   */
  const handleFinish = useCallback((): void => {
    commitOnExit();
    setMode('view');
  }, [commitOnExit]);

  /**
   * Leave edit mode, throwing the work away.
   *
   * This is the action a shared editor was actually getting from the kebab's
   * "Reset layout" — that item exits without committing, so the draft was
   * dropped under a name that describes something else entirely (dropping a
   * PERSONAL override). Here it is the named, confirmed control.
   *
   * A personal layout auto-saves as you go, so reverting it has to be WRITTEN
   * back, not merely forgotten: cancel the pending debounce first, or its
   * trailing PUT lands after the revert and restores what was just discarded.
   */
  const handleDiscard = useCallback((): void => {
    setDiscardOpen(false);
    const original = seedRef.current;
    reseed(original);
    if (editTarget === 'personal') {
      personalCancel();
      if (dirty) {
        personalSave(original);
        void personalFlush();
      }
    }
    setMode('view');
    announce(t('builder.discarded', 'Changes discarded.'));
  }, [reseed, editTarget, dirty, personalCancel, personalSave, personalFlush, announce]);

  const requestDiscard = useCallback((): void => {
    if (dirty) setDiscardOpen(true);
    else handleDiscard();
  }, [dirty, handleDiscard]);

  const nameOf = useCallback((itemId: string): string => {
    const item = draft.items.find((entry) => entry.i === itemId);
    if (item === undefined) return '';
    const definition = getWidget(item.widget);
    return definition !== undefined ? widgetDisplayName(definition) : humanize(item.widget);
  }, [draft]);

  const handleInsert = useCallback(
    (definition: Parameters<typeof add>[0]): void => {
      add(definition);
      setPaletteOpen(false);
      announce(t('builder.palette.added', '{name} added.', { name: widgetDisplayName(definition) }));
    },
    [add, announce],
  );

  const handleDuplicate = useCallback(
    (itemId: string): void => {
      const name = nameOf(itemId);
      duplicate(itemId);
      announce(t('builder.item.duplicated', '{name} duplicated.', { name }));
    },
    [duplicate, nameOf, announce],
  );

  const handleRemove = useCallback(
    (itemId: string): void => {
      const name = nameOf(itemId);
      remove(itemId);
      announce(t('builder.item.removed', '{name} removed.', { name }));
    },
    [remove, nameOf, announce],
  );

  const handleSaveShared = useCallback(async (): Promise<void> => {
    sharedSave(draft);
    await sharedFlush();
    markClean();
    announce(t('builder.savedShared', 'Dashboard saved for everyone with access.'));
    setMode('view');
  }, [sharedSave, sharedFlush, draft, markClean, announce]);

  const handleReset = useCallback(async (): Promise<void> => {
    setResetOpen(false);
    setMode('view');
    // Drop any pending debounced personal PUT first, otherwise a trailing save
    // could re-create the override immediately after the DELETE resolves.
    personalCancel();
    await resetLayout.reset();
    announce(t('builder.resetDone', 'Layout reset to the shared default.'));
  }, [resetLayout, personalCancel, announce]);

  const selectedItem = useMemo(
    () => (selectedId === null ? undefined : draft.items.find((item) => item.i === selectedId)),
    [draft, selectedId],
  );
  const selectedDefinition = selectedItem === undefined ? undefined : getWidget(selectedItem.widget);

  const editing = mode === 'edit';

  return (
    // The gutter and the `max-w-dash` (1320px) column come from the
    // `PageSurface` PageRenderer wraps this in (pages/surfaceDefaults.ts) —
    // 1320 and not `max-w-page` (1080px) because a dashboard is a 12-col grid
    // and 1080px squeezed each column to ~76px.
    <div className="flex flex-col gap-[14px]" data-testid="dashboard-builder">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-section text-fg">{title}</h1>
          {editing ? (
            <p className="mt-0.5 text-caption text-fg-muted">
              {canEditShared
                ? t('builder.sharedNote', 'You’re editing the shared dashboard everyone sees.')
                : t('builder.personalNote', 'You’re editing your personal layout — only you see these changes.')}
            </p>
          ) : null}
        </div>

        {editing ? (
          <>
            {canEditShared ? null : (
              <span className="text-caption text-fg-subtle" aria-hidden="true">
                {personalSaving
                  ? t('builder.saving', 'Saving…')
                  : dirty
                    ? ''
                    : t('builder.savedShort', 'Saved')}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Plus className="size-4" aria-hidden="true" />}
              onClick={() => setPaletteOpen(true)}
            >
              {t('builder.addWidget', 'Add widget')}
            </Button>
            <Button variant="destructive" size="sm" onClick={requestDiscard}>
              {t('builder.discard', 'Discard changes')}
            </Button>
            {canEditShared ? (
              <Button
                variant="primary"
                size="sm"
                loading={sharedSaving}
                onClick={() => void handleSaveShared()}
              >
                {t('builder.saveLayout', 'Save layout')}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleFinish}>
                {t('builder.done', 'Done')}
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Pencil className="size-4" aria-hidden="true" />}
            onClick={() => setMode('edit')}
          >
            {t('builder.edit', 'Edit')}
          </Button>
        )}

        {/*
          "Reset layout" drops the caller's PERSONAL override and restores the
          shared default, so it is meaningless to someone who edits the shared
          default itself — for them the DELETE hit nothing and the menu item
          read as dead, while in edit mode its `setMode('view')` silently threw
          the draft away. Personal editors keep it; shared editors get no kebab.
        */}
        {canEditShared ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="bordered" size="md" label={t('builder.options', 'Dashboard options')}>
                <MoreVertical className="size-4" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                icon={<RotateCcw className="size-4" />}
                onSelect={() => setResetOpen(true)}
              >
                {t('builder.resetLayout', 'Reset layout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {editing ? (
        draft.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong p-12 text-center">
            <p className="text-body-sm text-fg-muted">
              {t('builder.empty', 'This dashboard has no widgets yet.')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Plus className="size-4" aria-hidden="true" />}
              onClick={() => setPaletteOpen(true)}
            >
              {t('builder.emptyAction', 'Add a widget')}
            </Button>
          </div>
        ) : (
          <Suspense fallback={null}>
            <BuilderGrid
              draft={draft}
              selectedId={selectedId}
              dir={dir}
              onConfigure={select}
              onDuplicate={handleDuplicate}
              onRemove={handleRemove}
              onLayoutChange={replace}
            />
          </Suspense>
        )
      ) : (
        <PageDashboard
          layout={page.config['layout']}
          states={states}
          onEvent={onEvent}
        />
      )}

      {paletteOpen ? (
        <Suspense fallback={null}>
          <WidgetPalette
            open
            onClose={() => setPaletteOpen(false)}
            onInsert={handleInsert}
            registry={registry}
          />
        </Suspense>
      ) : null}

      {selectedItem === undefined ? null : (
      <Suspense fallback={null}>
      <ConfigInspector
        open={selectedItem !== undefined}
        definition={selectedDefinition}
        config={selectedItem?.config ?? {}}
        lockedPaths={lockedPathsOf(selectedItem?.config)}
        widgetName={selectedDefinition === undefined ? '' : widgetDisplayName(selectedDefinition)}
        onChange={(config) => {
          if (selectedId !== null) setConfig(selectedId, config);
        }}
        onClose={() => select(null)}
      />
      </Suspense>
      )}

      <Modal open={resetOpen} onOpenChange={setResetOpen} size="sm">
        <ModalHeader
          icon={<RotateCcw className="size-5" aria-hidden="true" />}
          tone="warn"
          title={t('builder.resetTitle', 'Reset to the shared layout?')}
          subtitle={t(
            'builder.resetBody',
            'This removes your personal changes and restores the dashboard everyone sees. Your data isn’t affected.',
          )}
          closeLabel={t('common.close', 'Close')}
        />
        <ModalBody />
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={resetLayout.isResetting}
            onClick={() => void handleReset()}
          >
            {t('builder.resetConfirm', 'Reset layout')}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={discardOpen} onOpenChange={setDiscardOpen} size="sm">
        <ModalHeader
          icon={<Undo2 className="size-5" aria-hidden="true" />}
          tone="warn"
          title={t('builder.discardTitle', 'Discard your changes?')}
          subtitle={t(
            'builder.discardBody',
            'The dashboard goes back to how it looked when you opened the editor. Your data isn’t affected.',
          )}
          closeLabel={t('common.close', 'Close')}
        />
        <ModalBody />
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(false)}>
            {t('builder.keepEditing', 'Keep editing')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDiscard}>
            {t('builder.discardConfirm', 'Discard changes')}
          </Button>
        </ModalFooter>
      </Modal>

      <div aria-live="polite" className="sr-only" data-testid="builder-announcer">
        {announcement}
      </div>
    </div>
  );
}
