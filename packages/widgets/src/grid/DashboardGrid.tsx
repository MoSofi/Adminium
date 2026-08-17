/**
 * DashboardGrid — the `pageLayoutSchema` renderer (04-widget-registry.md §6).
 * 12 fluid columns, 40 px half-row units, 14 px gap. Below `lg` the grid reflows
 * to one stacked column ordered by `(y, x)`; items keep their height spans.
 *
 * Two modes on one surface:
 *  - STATIC (default, M4): read-only placement. Unchanged from the original
 *    renderer — the `page-dashboard` template and demos depend on it.
 *  - EDIT (04-T12): pass `editMode` (the builder's pencil toggle). Each item
 *    becomes a dnd-kit draggable whose activator is the WidgetFrame grip (the
 *    host renders `<GridDragHandle/>` there), the grid surface is the droppable,
 *    a custom modifier snaps the drag overlay to cells, and a pointer/keyboard
 *    SE-corner (inline-end) handle resizes. On drop/commit the layout runs
 *    `applyMove`/`applyResize` then `compactVertical` (all from ./layout-edit +
 *    ./layout-math — never rebuilt here) and `onLayoutChange` fires the settled
 *    `PageLayout`. Keyboard: focus the grip, arrows move a draft by one LOGICAL
 *    cell, Shift+arrows resize, Enter saves, Escape reverts — announced through
 *    one polite live region.
 *
 * Per-item placement uses the `--*` CSS-custom-property escape hatch (the only
 * sanctioned style prop): coordinates land in `--gi-*` variables consumed by
 * arbitrary-property utility classes, so no literal style values ever render.
 */

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent, Modifier } from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react';

import {
  GridItemEditProvider,
  GridLiveRegion,
  GridResizeHandle,
  useGridEditLabels,
  useGridLiveRegion,
} from './grid-edit.js';
import type { GridEditLabels, GridEditLabelsInput, GridItemEditControls } from './grid-edit.js';
import {
  applyMove,
  commitDraft,
  normalizeLayout,
  pointerMoveTarget,
} from './layout-edit.js';
import type { CellStep, LayoutDraft } from './layout-edit.js';
import { GRID_COLUMNS, GRID_GAP_PX, ROW_UNIT_PX, compactVertical, sortByPosition } from './layout-math.js';
import { DEFAULT_MIN_SIZE, MAX_H } from './layout-schema.js';
import type { MinSize } from './layout-schema.js';
import type { LayoutItem, PageLayout } from './layout-schema.js';

/** Extra context passed to `renderItem` so a host can place the drag grip. */
export interface RenderItemContext {
  editMode: boolean;
  /** True while THIS item owns the keyboard edit session. */
  grabbed: boolean;
}

export interface DashboardGridProps {
  layout: PageLayout;
  /** Render one placed widget (already position-sorted). In edit mode `ctx`
   *  tells the host to render `<GridDragHandle/>` in the WidgetFrame grip slot. */
  renderItem: (item: LayoutItem, ctx: RenderItemContext) => ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
  /** Builder edit toggle (04 §6.2). Off → the original static renderer. */
  editMode?: boolean | undefined;
  /** Settled `PageLayout` after every move/resize (debounced-persist upstream). */
  onLayoutChange?: ((layout: PageLayout) => void) | undefined;
  /** Per-widget resize floor (registry `sizing`); default `minW×minH = 1×1`. */
  getSizing?: ((widgetId: string) => MinSize) | undefined;
  /** Writing direction — mirrors the LOGICAL keyboard arrow semantics (04 §6.2). */
  dir?: 'ltr' | 'rtl' | undefined;
  /** i18n label + announcement overrides (builder passes `t('ui.grid.*')`). */
  labels?: GridEditLabelsInput | undefined;
}

const GRID_SURFACE_ID = 'dashboard-grid-surface';
// Keep the gap literal in sync with GRID_GAP_PX — the drag math measures cells
// from that constant, so a mismatch drifts the drop target a pixel per column.
const SURFACE_CLASS = 'grid grid-cols-1 auto-rows-[40px] gap-[14px] lg:grid-cols-12';

/** Arrow key → signed cell delta. Horizontal mirrors LOGICALLY under RTL
 *  (reading order for move; growth toward the inline-end for resize); vertical
 *  is block-flow, never mirrored (04 §6.2). */
function arrowDelta(key: string, dir: 'ltr' | 'rtl'): { dx: number; dy: number } | null {
  const forward = dir === 'rtl' ? -1 : 1;
  switch (key) {
    case 'ArrowRight':
      return { dx: forward, dy: 0 };
    case 'ArrowLeft':
      return { dx: -forward, dy: 0 };
    case 'ArrowDown':
      return { dx: 0, dy: 1 };
    case 'ArrowUp':
      return { dx: 0, dy: -1 };
    default:
      return null;
  }
}

const draftOf = (item: LayoutItem): LayoutDraft => ({ x: item.x, y: item.y, w: item.w, h: item.h });

interface KeyboardSession {
  id: string;
  origin: LayoutDraft;
  draft: LayoutDraft;
}

export function DashboardGrid({
  layout,
  renderItem,
  className,
  testId,
  editMode = false,
  onLayoutChange,
  getSizing,
  dir = 'ltr',
  labels,
}: DashboardGridProps) {
  // Normalize BEFORE render, in both modes. A stored layout is untrusted input —
  // it can predate a widget's current `sizing`, or have been written by the
  // generator, the LLM apply path or a direct PATCH, none of which clamp. Without
  // this the resize handle refuses to go below the floor while the page happily
  // renders something already below it.
  const normalized = normalizeLayout(layout, getSizing);
  const items = sortByPosition(normalized.items);

  if (!editMode) {
    return (
      <div data-dashboard-grid data-testid={testId} className={`${SURFACE_CLASS} ${className ?? ''}`}>
        {items.map((item) => (
          <div
            key={item.i}
            data-grid-item={item.i}
            data-grid-widget={item.widget}
            className="min-w-0 [grid-row:span_var(--gi-h)] lg:[grid-column:var(--gi-col)] lg:[grid-row:var(--gi-row)]"
            style={{
              '--gi-h': String(item.h),
              '--gi-col': `${item.x + 1} / span ${item.w}`,
              '--gi-row': `${item.y + 1} / span ${item.h}`,
            }}
          >
            {renderItem(item, { editMode: false, grabbed: false })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <EditableGrid
      // The NORMALIZED layout, not the raw prop: every mutation below derives
      // from it, so an edit session that starts on a sub-floor item repairs it
      // instead of carrying the illegal size through the next save.
      layout={normalized}
      items={items}
      renderItem={renderItem}
      className={className}
      testId={testId}
      onLayoutChange={onLayoutChange}
      getSizing={getSizing}
      dir={dir}
      labels={labels}
    />
  );
}

interface EditableGridProps {
  layout: PageLayout;
  items: LayoutItem[];
  renderItem: (item: LayoutItem, ctx: RenderItemContext) => ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
  onLayoutChange?: ((layout: PageLayout) => void) | undefined;
  getSizing?: ((widgetId: string) => MinSize) | undefined;
  dir: 'ltr' | 'rtl';
  labels?: GridEditLabelsInput | undefined;
}

function EditableGrid({
  layout,
  items,
  renderItem,
  className,
  testId,
  onLayoutChange,
  getSizing,
  dir,
  labels,
}: EditableGridProps) {
  const mergedLabels: GridEditLabels = useGridEditLabels(labels);

  const { message, announce } = useGridLiveRegion();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const cellRef = useRef<CellStep>({ colStep: 0, rowStep: 0 });
  const [session, setSession] = useState<KeyboardSession | null>(null);
  const [resizeDraft, setResizeDraft] = useState<{ id: string; draft: LayoutDraft } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const minSizeFor = useCallback(
    (widgetId: string): MinSize => getSizing?.(widgetId) ?? DEFAULT_MIN_SIZE,
    [getSizing],
  );

  const titleOf = useCallback(
    (id: string): string => {
      const item = layout.items.find((entry) => entry.i === id);
      const configTitle = item?.config?.['title'];
      return typeof configTitle === 'string' && configTitle !== '' ? configTitle : (item?.widget ?? id);
    },
    [layout.items],
  );

  // Measure one cell's pixel step from the live surface (fluid columns), so the
  // pointer delta→cell math and the snap modifier land on real grid lines.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const measure = (): void => {
      const width = surface.clientWidth;
      const colWidth = (width - GRID_GAP_PX * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
      cellRef.current = {
        colStep: colWidth + GRID_GAP_PX,
        rowStep: ROW_UNIT_PX + GRID_GAP_PX,
      };
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const commit = useCallback(
    (next: PageLayout, id: string, draft: LayoutDraft): void => {
      onLayoutChange?.(next);
      const settled = next.items.find((entry) => entry.i === id) ?? { x: draft.x, y: draft.y };
      announce(mergedLabels.announce.committed(titleOf(id), settled.x + 1, settled.y + 1));
    },
    [onLayoutChange, announce, mergedLabels.announce, titleOf],
  );

  // --- pointer drag (dnd-kit) ------------------------------------------------
  const onDragStart = useCallback((event: DragStartEvent): void => {
    setActiveDragId(String(event.active.id));
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const id = String(event.active.id);
      setActiveDragId(null);
      const item = layout.items.find((entry) => entry.i === id);
      if (item === undefined) return;
      // Mirror the horizontal delta under RTL and cap `x` so the widget keeps
      // its width at the inline-end edge — the same semantics as the keyboard
      // move and pointer-resize paths (04 §6.2).
      const { x, y } = pointerMoveTarget(item, event.delta, cellRef.current, dir);
      if (x === item.x && y === item.y) return;
      const moved = applyMove(layout, id, x, y, minSizeFor(item.widget));
      const next: PageLayout = { ...layout, items: compactVertical(moved.items) };
      commit(next, id, draftOf(item));
    },
    [layout, commit, dir, minSizeFor],
  );

  const snapModifier = useMemo<Modifier>(
    () =>
      ({ transform }) => {
        const cell = cellRef.current;
        const snap = (px: number, step: number): number =>
          step > 0 ? Math.round(px / step) * step : px;
        return { ...transform, x: snap(transform.x, cell.colStep), y: snap(transform.y, cell.rowStep) };
      },
    [],
  );

  // --- keyboard session ------------------------------------------------------
  const startSession = useCallback(
    (item: LayoutItem): KeyboardSession => {
      const next: KeyboardSession = { id: item.i, origin: draftOf(item), draft: draftOf(item) };
      setSession(next);
      announce(mergedLabels.announce.grabbed(titleOf(item.i)));
      return next;
    },
    [announce, mergedLabels.announce, titleOf],
  );

  const commitSession = useCallback(
    (current: KeyboardSession): void => {
      setSession(null);
      const next = commitDraft(layout, current.id, current.draft, minSizeFor(itemWidget(layout, current.id)));
      commit(next, current.id, current.draft);
    },
    [layout, minSizeFor, commit],
  );

  const revertSession = useCallback(
    (current: KeyboardSession): void => {
      setSession(null);
      announce(mergedLabels.announce.reverted(titleOf(current.id)));
    },
    [announce, mergedLabels.announce, titleOf],
  );

  const handleKey = useCallback(
    (item: LayoutItem, event: ReactKeyboardEvent<HTMLElement>, handleMode: 'move' | 'resize'): void => {
      const active = session?.id === item.i ? session : null;

      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        if (active !== null) commitSession(active);
        else startSession(item);
        return;
      }
      if (event.key === 'Escape') {
        if (active !== null) {
          event.preventDefault();
          revertSession(active);
        }
        return;
      }

      const resizing = handleMode === 'resize' || event.shiftKey;
      const delta = arrowDelta(event.key, dir);
      if (delta === null) return;
      event.preventDefault();

      const current = active ?? startSession(item);
      const min = minSizeFor(item.widget);
      let draft: LayoutDraft;
      if (resizing) {
        const w = clamp(current.draft.w + delta.dx, Math.max(1, min.minW), GRID_COLUMNS - current.draft.x);
        const h = clamp(current.draft.h + delta.dy, Math.max(1, min.minH), MAX_H);
        draft = { ...current.draft, w, h };
        announce(mergedLabels.announce.resized(titleOf(item.i), draft.w, draft.h));
      } else {
        const x = clamp(current.draft.x + delta.dx, 0, GRID_COLUMNS - current.draft.w);
        const y = Math.max(0, current.draft.y + delta.dy);
        draft = { ...current.draft, x, y };
        announce(mergedLabels.announce.moved(titleOf(item.i), draft.x + 1, draft.y + 1));
      }
      setSession({ ...current, draft });
    },
    [session, dir, minSizeFor, commitSession, revertSession, startSession, announce, mergedLabels.announce, titleOf],
  );

  // --- pointer resize (SE / inline-end corner) -------------------------------
  const onResizePointerDown = useCallback(
    (item: LayoutItem, event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = draftOf(item);
      const min = minSizeFor(item.widget);

      const move = (ev: PointerEvent): void => {
        const cell = cellRef.current;
        // Inline-end handle: in RTL it sits at the visual start, so a leftward
        // (negative) pointer move grows width — mirror the horizontal delta.
        const dxPx = (dir === 'rtl' ? -1 : 1) * (ev.clientX - startX);
        const dCols = cell.colStep > 0 ? Math.round(dxPx / cell.colStep) : 0;
        const dRows = cell.rowStep > 0 ? Math.round((ev.clientY - startY) / cell.rowStep) : 0;
        const w = clamp(origin.w + dCols, Math.max(1, min.minW), GRID_COLUMNS - origin.x);
        const h = clamp(origin.h + dRows, Math.max(1, min.minH), MAX_H);
        setResizeDraft({ id: item.i, draft: { ...origin, w, h } });
      };
      const up = (): void => {
        target.releasePointerCapture?.(event.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setResizeDraft((current) => {
          if (current !== null && (current.draft.w !== origin.w || current.draft.h !== origin.h)) {
            const next = commitDraft(layout, item.i, current.draft, min);
            commit(next, item.i, current.draft);
          }
          return null;
        });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [dir, minSizeFor, layout, commit],
  );

  const activeDraft: { id: string; draft: LayoutDraft } | null =
    session !== null ? { id: session.id, draft: session.draft } : resizeDraft;
  const activeItem = activeDragId === null ? null : layout.items.find((entry) => entry.i === activeDragId) ?? null;

  return (
    <div data-dashboard-grid-edit dir={dir} className="relative">
      <GridLiveRegion message={message} />
      <DndContext
        sensors={sensors}
        modifiers={[snapModifier]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDragId(null)}
        accessibility={{
          announcements: {
            onDragStart: () => undefined,
            onDragOver: () => undefined,
            onDragEnd: () => undefined,
            onDragCancel: () => undefined,
          },
        }}
      >
        <GridDroppableSurface
          surfaceRef={surfaceRef}
          testId={testId}
          className={className}
        >
          {items.map((item) => (
            <GridEditItem
              key={item.i}
              item={item}
              renderItem={renderItem}
              controls={{
                itemId: item.i,
                title: titleOf(item.i),
                grabbed: session?.id === item.i,
                labels: mergedLabels,
                onGripKeyDown: (event) => handleKey(item, event, 'move'),
                onResizeKeyDown: (event) => handleKey(item, event, 'resize'),
                onResizePointerDown: (event) => onResizePointerDown(item, event),
                // filled in by GridEditItem from its own useDraggable:
                setDragActivator: () => {},
                dragListeners: undefined,
              }}
              dimmed={activeDragId === item.i || activeDraft?.id === item.i}
            />
          ))}
          {activeDraft !== null && (
            <div
              data-grid-ghost={activeDraft.id}
              aria-hidden="true"
              className="pointer-events-none rounded-xl border-2 border-dashed border-accent bg-accent-soft/30 [grid-row:span_var(--gi-h)] lg:[grid-column:var(--gi-col)] lg:[grid-row:var(--gi-row)]"
              style={{
                '--gi-h': String(activeDraft.draft.h),
                '--gi-col': `${activeDraft.draft.x + 1} / span ${activeDraft.draft.w}`,
                '--gi-row': `${activeDraft.draft.y + 1} / span ${activeDraft.draft.h}`,
              }}
            />
          )}
        </GridDroppableSurface>
        <DragOverlay modifiers={[snapModifier]}>
          {activeItem === null ? null : (
            <div className="h-full opacity-90">{renderItem(activeItem, { editMode: true, grabbed: false })}</div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function GridDroppableSurface({
  surfaceRef,
  testId,
  className,
  children,
}: {
  surfaceRef: RefObject<HTMLDivElement | null>;
  testId?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: GRID_SURFACE_ID });
  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      surfaceRef.current = element;
      setNodeRef(element);
    },
    [surfaceRef, setNodeRef],
  );
  return (
    <div
      ref={setRefs}
      data-dashboard-grid
      data-testid={testId}
      className={`${SURFACE_CLASS} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

function GridEditItem({
  item,
  renderItem,
  controls,
  dimmed,
}: {
  item: LayoutItem;
  renderItem: (item: LayoutItem, ctx: RenderItemContext) => ReactNode;
  controls: GridItemEditControls;
  dimmed: boolean;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({ id: item.i });
  const merged: GridItemEditControls = {
    ...controls,
    setDragActivator: setActivatorNodeRef,
    dragListeners: listeners,
  };
  return (
    <div
      ref={setNodeRef}
      data-grid-item={item.i}
      data-grid-widget={item.widget}
      data-dragging={isDragging ? '' : undefined}
      data-grabbed={controls.grabbed ? '' : undefined}
      className={
        'group/grid-item relative min-w-0 [grid-row:span_var(--gi-h)] lg:[grid-column:var(--gi-col)] lg:[grid-row:var(--gi-row)]' +
        (dimmed ? ' opacity-60' : '')
      }
      style={{
        '--gi-h': String(item.h),
        '--gi-col': `${item.x + 1} / span ${item.w}`,
        '--gi-row': `${item.y + 1} / span ${item.h}`,
      }}
    >
      <GridItemEditProvider value={merged}>
        {renderItem(item, { editMode: true, grabbed: controls.grabbed })}
        <GridResizeHandle />
      </GridItemEditProvider>
    </div>
  );
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function itemWidget(layout: PageLayout, id: string): string {
  return layout.items.find((entry) => entry.i === id)?.widget ?? id;
}
