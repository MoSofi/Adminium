// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useMaybeT } from '@adminium/i18n/react';

import type { BoardCardData } from './board-lib.js';

/**
 * dnd-kit interaction layer shared by `kanban-board` and `kanban-swimlane-grid`
 * (annex §6). Confined to boards/ so dnd-kit stays out of every other family's
 * chunk (04 §2.3 chunk budget). Two concerns live here:
 *
 *  1. The optimistic-move state machine (`useBoardMoves`): an override map keyed
 *     by card id, an optimistic apply + rollback-on-rejection for the pointer
 *     drop path, and a grab → preview-move → commit/cancel model for the
 *     keyboard path. Both paths funnel through one `onCommit` and one aria-live
 *     announcer, so mouse and keyboard moves stay in lockstep.
 *  2. Thin dnd-kit primitives (`DroppableCell`, `DraggableCard`) that add the
 *     drag ref/listeners and the annex visual affordances (dragging card dims to
 *     0.4; drop target gets a dashed accent border + tint) without leaking
 *     dnd-kit into the presentational card.
 *
 * RTL: nothing here encodes a physical left/right. The keyboard path receives an
 * already-computed target cell key from the widget (which maps arrow keys to
 * LOGICAL neighbours using `dir`), and dnd-kit's pointer path is geometry-based,
 * so a mirrored column row Just Works. dnd-kit's own English screen-reader
 * announcements are silenced (below) in favour of this layer's localizable ones.
 */

/** Result of a committed move: a rejected promise triggers optimistic rollback. */
export type MoveResult = void | Promise<unknown>;

/**
 * A single polite aria-live region for the board. Both the pointer and keyboard
 * paths push localized status text here; dnd-kit's own region is silenced
 * (`silentDndAnnouncements`) so there is exactly one source of truth.
 */
export function useLiveRegion(): { message: string; announce: (message: string) => void } {
  const [message, setMessage] = useState('');
  const announce = useCallback((next: string) => {
    // Toggle a trailing zero-width space so an identical consecutive message
    // still mutates the node and is re-announced.
    setMessage((prev) => (prev === next ? `${next}\u200B` : next));
  }, []);
  return { message, announce };
}

export function BoardLiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-board-liveregion>
      {message}
    </div>
  );
}

/** Localizable announcement builders (English defaults; host may override). */
export interface BoardAnnouncements {
  grabbed: (title: string) => string;
  over: (title: string, cell: string) => string;
  moved: (title: string, cell: string) => string;
  returned: (title: string) => string;
  failed: (title: string) => string;
}

export const defaultBoardAnnouncements: BoardAnnouncements = {
  grabbed: (title) => `Grabbed ${title}. Use the arrow keys to move, Enter to drop, Escape to cancel.`,
  over: (title, cell) => `${title} is over ${cell}.`,
  moved: (title, cell) => `Moved ${title} to ${cell}.`,
  returned: (title) => `${title} returned to its original position.`,
  failed: (title) => `Could not move ${title}; it was returned to its original position.`,
};

/**
 * The localized announcement set: `ui:widgets.boards.a11y.*` when rendered
 * under an `I18nProvider`, the English `defaultBoardAnnouncements` text
 * otherwise. Host/config `overrides` win key-by-key either way.
 */
export function useBoardAnnouncements(overrides?: Partial<BoardAnnouncements>): BoardAnnouncements {
  const t = useMaybeT();
  return {
    grabbed: (title) =>
      t('ui:widgets.boards.a11y.grabbed', 'Grabbed {title}. Use the arrow keys to move, Enter to drop, Escape to cancel.', { title }),
    over: (title, cell) => t('ui:widgets.boards.a11y.over', '{title} is over {cell}.', { title, cell }),
    moved: (title, cell) => t('ui:widgets.boards.a11y.moved', 'Moved {title} to {cell}.', { title, cell }),
    returned: (title) => t('ui:widgets.boards.a11y.returned', '{title} returned to its original position.', { title }),
    failed: (title) =>
      t('ui:widgets.boards.a11y.failed', 'Could not move {title}; it was returned to its original position.', { title }),
    ...overrides,
  };
}

/**
 * Build localized announcement functions from host-provided TEMPLATE strings
 * (config `announcements`, filled by `t('…')` — see boards-config). `{title}`
 * and `{cell}` are substituted; omitted keys are left to the English defaults.
 */
export function announcementsFromTemplates(templates: {
  grabbed?: string | undefined;
  over?: string | undefined;
  moved?: string | undefined;
  returned?: string | undefined;
  failed?: string | undefined;
}): Partial<BoardAnnouncements> {
  const fill = (template: string, title: string, cell?: string): string =>
    template.replace(/\{title\}/g, title).replace(/\{cell\}/g, cell ?? '');
  const out: Partial<BoardAnnouncements> = {};
  if (templates.grabbed !== undefined) out.grabbed = (title) => fill(templates.grabbed!, title);
  if (templates.over !== undefined) out.over = (title, cell) => fill(templates.over!, title, cell);
  if (templates.moved !== undefined) out.moved = (title, cell) => fill(templates.moved!, title, cell);
  if (templates.returned !== undefined) out.returned = (title) => fill(templates.returned!, title);
  if (templates.failed !== undefined) out.failed = (title) => fill(templates.failed!, title);
  return out;
}

/** dnd-kit announcement builders returning undefined — silences its live region. */
export const silentDndAnnouncements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
} as const;

interface UseBoardMovesArgs {
  cards: readonly BoardCardData[];
  /** Natural (pre-override) cell key of a card: column id, or `${lane} ${col}`. */
  naturalCellKey: (card: BoardCardData) => string;
  /** Human label for a cell key, used in announcements. */
  cellLabel: (cellKey: string) => string;
  /** Commit a move; return a promise to opt into rollback-on-rejection. */
  onCommit: (cardId: string, fromCellKey: string, toCellKey: string) => MoveResult;
  announce: (message: string) => void;
  announcements: BoardAnnouncements;
}

export interface BoardMoves {
  /** Settled cell key: optimistic override, else natural. The grabbed card
   *  stays rendered here while it is being keyboard-moved, so its DOM node (and
   *  thus keyboard focus) is stable across arrow presses — only `grabTargetKey`
   *  moves, highlighting the pending drop cell until commit. */
  cellKeyOf: (card: BoardCardData) => string;
  grabbedCardId: string | null;
  isGrabbed: (cardId: string) => boolean;
  /** The pending keyboard drop-target cell key while a card is grabbed. */
  grabTargetKey: string | null;
  /** Pointer drop path: optimistically move `cardId` to `toCellKey`. */
  requestMove: (cardId: string, toCellKey: string) => void;
  /** Keyboard: pick up a card (target starts at its current cell). */
  grab: (cardId: string) => void;
  /** Keyboard: move the pending drop target to `toCellKey`. */
  previewTo: (toCellKey: string) => void;
  /** Keyboard: commit the pending target (fires `onCommit` if the cell changed). */
  commit: () => void;
  /** Keyboard: cancel the grab, leaving the card where it was. */
  cancel: () => void;
}

/** The optimistic-move + keyboard-grab state machine (see file header). */
export function useBoardMoves({
  cards,
  naturalCellKey,
  cellLabel,
  onCommit,
  announce,
  announcements,
}: UseBoardMovesArgs): BoardMoves {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [grab, setGrab] = useState<{ cardId: string; targetKey: string } | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, BoardCardData>();
    for (const card of cards) map.set(card.id, card);
    return map;
  }, [cards]);

  // Latest-values ref so the stable callbacks below never read stale state.
  const ref = useRef({ overrides, grab, byId, naturalCellKey, cellLabel, onCommit, announce, announcements });
  ref.current = { overrides, grab, byId, naturalCellKey, cellLabel, onCommit, announce, announcements };

  const settledKeyOf = useCallback((card: BoardCardData): string => {
    return ref.current.overrides[card.id] ?? ref.current.naturalCellKey(card);
  }, []);

  // Reconcile optimistic overrides against fresh server data: once an incoming
  // card's NATURAL cell key reaches its override target the move is confirmed,
  // so the override is dropped and the card falls back to server truth (it must
  // not permanently mask later refetches). A rejected move is unwound by the
  // rollback path in `requestMove`; this handles the committed/superseded case
  // and prunes overrides for cards that have disappeared.
  useEffect(() => {
    setOverrides((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        const card = ref.current.byId.get(id);
        if (card === undefined || ref.current.naturalCellKey(card) === prev[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cards]);

  // The grabbed card never relocates during a grab — it stays at its settled
  // cell (focus stability); the target cell is the highlight only.
  const cellKeyOf = useCallback((card: BoardCardData): string => settledKeyOf(card), [settledKeyOf]);

  const titleOf = useCallback((cardId: string): string => ref.current.byId.get(cardId)?.title ?? cardId, []);

  const requestMove = useCallback(
    (cardId: string, toCellKey: string) => {
      const card = ref.current.byId.get(cardId);
      if (card === undefined) return;
      const fromCellKey = settledKeyOf(card);
      if (fromCellKey === toCellKey) return;
      setOverrides((prev) => ({ ...prev, [cardId]: toCellKey }));
      ref.current.announce(ref.current.announcements.moved(card.title, ref.current.cellLabel(toCellKey)));
      const result = ref.current.onCommit(cardId, fromCellKey, toCellKey);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(undefined, () => {
          // Rollback: restore the settled key (drop the optimistic override).
          setOverrides((prev) => {
            const next = { ...prev };
            if (next[cardId] === toCellKey) delete next[cardId];
            return next;
          });
          ref.current.announce(ref.current.announcements.failed(card.title));
        });
      }
    },
    [settledKeyOf],
  );

  const grabCard = useCallback(
    (cardId: string) => {
      const card = ref.current.byId.get(cardId);
      if (card === undefined) return;
      setGrab({ cardId, targetKey: settledKeyOf(card) });
      ref.current.announce(ref.current.announcements.grabbed(card.title));
    },
    [settledKeyOf],
  );

  const previewTo = useCallback((toCellKey: string) => {
    setGrab((prev) => {
      if (prev === null || prev.targetKey === toCellKey) return prev;
      ref.current.announce(ref.current.announcements.over(titleOf(prev.cardId), ref.current.cellLabel(toCellKey)));
      return { ...prev, targetKey: toCellKey };
    });
  }, [titleOf]);

  const commit = useCallback(() => {
    const current = ref.current.grab;
    if (current === null) return;
    setGrab(null);
    requestMove(current.cardId, current.targetKey);
  }, [requestMove]);

  const cancel = useCallback(() => {
    const current = ref.current.grab;
    if (current === null) return;
    setGrab(null);
    ref.current.announce(ref.current.announcements.returned(titleOf(current.cardId)));
  }, [titleOf]);

  return {
    cellKeyOf,
    grabbedCardId: grab?.cardId ?? null,
    isGrabbed: (cardId) => grab?.cardId === cardId,
    grabTargetKey: grab?.targetKey ?? null,
    requestMove,
    grab: grabCard,
    previewTo,
    commit,
    cancel,
  };
}

/**
 * A droppable board cell (a column, or a lane×column cell). `isTarget` paints
 * the annex drop affordance (dashed accent border + accent-soft tint). The dnd
 * ref is attached to the scroll container so cards drop anywhere in the cell.
 */
export function DroppableCell({
  id,
  className,
  children,
  testId,
  highlight,
}: {
  id: string;
  className?: string | undefined;
  children: ReactNode;
  testId?: string | undefined;
  /** Keyboard drop-target highlight (pointer hover is detected internally). */
  highlight?: boolean | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const active = isOver || highlight === true;
  return (
    <div
      ref={setNodeRef}
      data-board-cell={id}
      data-over={isOver ? '' : undefined}
      data-drop-target={active ? '' : undefined}
      data-testid={testId}
      className={
        (className ?? '') + (active ? ' rounded-lg border-2 border-dashed border-accent bg-accent-soft/40' : '')
      }
    >
      {children}
    </div>
  );
}

/**
 * A draggable card shell. Pointer drag activates after a 4px threshold so a
 * plain click still opens the record (annex `linkTarget`); the whole card is
 * the drag activator, and the keyboard grab is handled by the widget on the
 * same element. The dragging card dims to 0.4 (annex).
 */
export function DraggableCard({
  card,
  disabled,
  children,
  onKeyDown,
  onClick,
  grabbed,
  className,
  ariaLabel,
  ariaDescribedBy,
}: {
  card: BoardCardData;
  disabled?: boolean | undefined;
  children: ReactNode;
  onKeyDown?: ((event: ReactKeyboardEvent<HTMLElement>) => void) | undefined;
  onClick?: (() => void) | undefined;
  grabbed?: boolean | undefined;
  className?: string | undefined;
  ariaLabel: string;
  ariaDescribedBy?: string | undefined;
}) {
  // Only pointer `listeners` are spread — NOT dnd-kit's `attributes`. dnd-kit's
  // attributes advertise its KeyboardSensor ("press space bar to lift"), which
  // this family does not register; the widget supplies its own keyboard grab +
  // aria instructions instead, so mixing dnd-kit's would mislead a keyboard user.
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.id, disabled: disabled === true });
  return (
    <div
      ref={setNodeRef}
      role="button"
      data-board-card={card.id}
      data-dragging={isDragging ? '' : undefined}
      data-grabbed={grabbed ? '' : undefined}
      aria-roledescription="draggable card"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-grabbed={grabbed ? true : undefined}
      tabIndex={disabled ? -1 : 0}
      className={(className ?? '') + (isDragging ? ' opacity-40' : '') + (grabbed ? ' ring-2 ring-accent' : '')}
      onKeyDown={onKeyDown}
      onClick={onClick}
      {...listeners}
    >
      {children}
    </div>
  );
}
