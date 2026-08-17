// SPDX-License-Identifier: AGPL-3.0-only
import type { DraggableSyntheticListeners, Modifier } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { createContext, useCallback, useContext, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import type { CellStep } from './layout-edit.js';

/**
 * Edit-mode React building blocks for `DashboardGrid` (04-widget-registry.md
 * §6.2). Confined to the grid so dnd-kit's edit affordances never leak into a
 * widget family chunk. Three concerns:
 *
 *  1. Localizable label + aria-live announcement builders (English defaults;
 *     the builder passes `t('ui.grid.*')`-backed overrides — HARD RULE i18n).
 *  2. A per-item edit context so the drag grip — which the host renders inside
 *     the WidgetFrame header slot (04 §4), out of the grid's JSX reach — can
 *     still bind the grid's dnd-kit activator + keyboard handler. `GridDragHandle`
 *     (grip) and `GridResizeHandle` (SE/▸ corner) read it.
 *  3. `snapToGridModifier` — the dnd-kit modifier that snaps the drag overlay to
 *     whole cell coordinates, plus a single polite live region.
 *
 * RTL: nothing here encodes a physical left/right. The corner handle positions
 * with the LOGICAL `end-0` (inline-end → SE in LTR, SW in RTL, 04 §6.2); arrow
 * semantics are mirrored by the controller before it calls these.
 */

/** aria-live announcement builders (English defaults; host overrides via i18n). */
export interface GridAnnouncements {
  grabbed: (title: string) => string;
  moved: (title: string, col: number, row: number) => string;
  resized: (title: string, w: number, h: number) => string;
  committed: (title: string, col: number, row: number) => string;
  reverted: (title: string) => string;
}

export const defaultGridAnnouncements: GridAnnouncements = {
  grabbed: (title) =>
    `Grabbed ${title}. Use the arrow keys to move, hold Shift to resize, Enter to save, Escape to cancel.`,
  moved: (title, col, row) => `${title} moved to column ${col}, row ${row}.`,
  resized: (title, w, h) => `${title} resized to ${w} columns by ${h} rows.`,
  committed: (title, col, row) => `${title} placed at column ${col}, row ${row}.`,
  reverted: (title) => `${title} returned to its original position.`,
};

/** Handle labels + announcements — one overridable bundle (mirrors boards). */
export interface GridEditLabels {
  dragHandle: (title: string) => string;
  resizeHandle: (title: string) => string;
  announce: GridAnnouncements;
}

export const defaultGridEditLabels: GridEditLabels = {
  dragHandle: (title) => `Drag to move ${title}`,
  resizeHandle: (title) => `Resize ${title}`,
  announce: defaultGridAnnouncements,
};

/** Partial override shape the builder passes (any subset; missing keys fall
 *  back to the English defaults). Announcements may be partially overridden. */
export interface GridEditLabelsInput {
  dragHandle?: ((title: string) => string) | undefined;
  resizeHandle?: ((title: string) => string) | undefined;
  announce?: Partial<GridAnnouncements> | undefined;
}

/**
 * The localized label + announcement set: `ui:grid.*` when rendered under an
 * `I18nProvider`, the English defaults otherwise (mirrors the boards family's
 * `useBoardAnnouncements`). Host `overrides` win key-by-key either way. Grid
 * coordinates are stringified before ICU so digits stay byte-identical.
 */
export function useGridEditLabels(overrides?: GridEditLabelsInput): GridEditLabels {
  const t = useMaybeT();
  return {
    dragHandle:
      overrides?.dragHandle ?? ((title) => t('ui:grid.dragHandle', 'Drag to move {title}', { title })),
    resizeHandle:
      overrides?.resizeHandle ?? ((title) => t('ui:grid.resizeHandle', 'Resize {title}', { title })),
    announce: {
      grabbed: (title) =>
        t(
          'ui:grid.a11y.grabbed',
          'Grabbed {title}. Use the arrow keys to move, hold Shift to resize, Enter to save, Escape to cancel.',
          { title },
        ),
      moved: (title, col, row) =>
        t('ui:grid.a11y.moved', '{title} moved to column {col}, row {row}.', {
          title,
          col: String(col),
          row: String(row),
        }),
      resized: (title, w, h) =>
        t('ui:grid.a11y.resized', '{title} resized to {w} columns by {h} rows.', {
          title,
          w: String(w),
          h: String(h),
        }),
      committed: (title, col, row) =>
        t('ui:grid.a11y.committed', '{title} placed at column {col}, row {row}.', {
          title,
          col: String(col),
          row: String(row),
        }),
      reverted: (title) => t('ui:grid.a11y.reverted', '{title} returned to its original position.', { title }),
      ...overrides?.announce,
    },
  };
}

/** Per-item controls the grid publishes so the out-of-tree grip can bind them. */
export interface GridItemEditControls {
  itemId: string;
  title: string;
  /** dnd-kit pointer activator ref for the drag grip. */
  setDragActivator: (element: HTMLElement | null) => void;
  /** dnd-kit pointer listeners for the drag grip (NOT its keyboard attributes —
   *  the grid owns the keyboard model, mirroring the boards family). */
  dragListeners: DraggableSyntheticListeners;
  /** Grip keyboard: arrows move, Shift+arrows resize, Enter save, Esc cancel. */
  onGripKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Resize-corner keyboard: arrows resize, Enter save, Esc cancel. */
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Resize-corner pointer drag start. */
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** True while a keyboard edit session owns this item. */
  grabbed: boolean;
  labels: GridEditLabels;
}

const GridItemEditContext = createContext<GridItemEditControls | null>(null);

export const GridItemEditProvider = GridItemEditContext.Provider;

/** Read the current grid item's edit controls (null outside an edit-mode item). */
export function useGridItemEdit(): GridItemEditControls | null {
  return useContext(GridItemEditContext);
}

const GRIP_CLASS =
  'inline-flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-fg-subtle ' +
  'hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-accent active:cursor-grabbing aria-pressed:bg-accent-soft aria-pressed:text-accent';

/**
 * The drag grip — rendered by the host inside the WidgetFrame header slot only
 * in edit mode (04 §4). It is the dnd-kit pointer activator AND the keyboard
 * a11y entry point for move/resize. Renders nothing outside an edit-mode item.
 */
export function GridDragHandle({ className }: { className?: string | undefined }) {
  const controls = useGridItemEdit();
  const t = useMaybeT();
  if (controls === null) return null;
  return (
    <button
      type="button"
      data-grid-drag-handle={controls.itemId}
      aria-label={controls.labels.dragHandle(controls.title)}
      aria-pressed={controls.grabbed}
      aria-roledescription={t('ui:grid.draggableRole', 'draggable widget')}
      className={GRIP_CLASS + (className === undefined ? '' : ` ${className}`)}
      ref={controls.setDragActivator}
      {...controls.dragListeners}
      onKeyDown={controls.onGripKeyDown}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  );
}

const RESIZE_CLASS =
  'absolute bottom-0 end-0 z-10 flex size-5 cursor-nwse-resize items-end justify-end rounded-ee-2xl p-1 ' +
  'text-fg-muted opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-accent group-hover/grid-item:opacity-100';

/**
 * The resize corner — the grid renders it on each item container (LOGICAL
 * `end-0`: SE corner in LTR, SW in RTL, 04 §6.2). Pointer-driven, with a
 * keyboard fallback (arrows resize) so the affordance is not mouse-only.
 *
 * Drawn as three stepped diagonal grip lines, the conventional resize-corner
 * idiom. The previous mark was an 8px right-angle bracket in `--fg-subtle`,
 * which at that size read as a stray corner artifact rather than something to
 * drag. The lines mirror with the handle in RTL — `scale-x-[-1]` under `rtl:`
 * — so the grip always points away from the widget.
 */
export function GridResizeHandle() {
  const controls = useGridItemEdit();
  if (controls === null) return null;
  return (
    <button
      type="button"
      data-grid-resize-handle={controls.itemId}
      aria-label={controls.labels.resizeHandle(controls.title)}
      className={RESIZE_CLASS}
      onPointerDown={controls.onResizePointerDown}
      onKeyDown={controls.onResizeKeyDown}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="size-3 rtl:scale-x-[-1]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      >
        <path d="M11 5 5 11" />
        <path d="M11 9 9 11" />
        <path d="M11 1 1 11" />
      </svg>
    </button>
  );
}

function snapToStep(px: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return px;
  return Math.round(px / step) * step;
}

/**
 * dnd-kit modifier snapping the drag overlay to whole cell coordinates so the
 * preview lands on the grid it will drop into (04 §6.2 "custom modifier snapping
 * the drag overlay to cell coordinates"). `cell` is measured from the live grid
 * surface; an unmeasured (0) step passes the transform through untouched.
 */
export function snapToGridModifier(cell: CellStep): Modifier {
  return ({ transform }) => ({
    ...transform,
    x: snapToStep(transform.x, cell.colStep),
    y: snapToStep(transform.y, cell.rowStep),
  });
}

/** A single polite live region for the grid; both pointer and keyboard paths
 *  push localized status here (dnd-kit's own region is silenced by the grid). */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

export function useGridLiveRegion(): { message: string; announce: (message: string) => void } {
  const [message, setMessage] = useState('');
  const announce = useCallback((next: string) => {
    // Zero-width-space toggle so an identical consecutive message re-announces.
    setMessage((prev) => (prev === next ? next + ZERO_WIDTH_SPACE : next));
  }, []);
  return { message, announce };
}

export function GridLiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-grid-liveregion>
      {message}
    </div>
  );
}
