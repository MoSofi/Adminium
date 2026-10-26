// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { X } from 'lucide-react';
import { useMaybeT } from '../../lib/i18n.js';

import type { BoardCardData } from './board-lib.js';

/**
 * dnd-kit interaction layer shared by `kanban-board` and `kanban-swimlane-grid`
 * (annex). Confined to boards/ so dnd-kit stays out of every other family's
 * chunk (chunk budget). Two concerns live here:
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
  /** `reason`: why the save was refused, in the words of whoever refused it, when it said. */
  failed: (title: string, reason?: string) => string;
}

/** A sentence, and the reason after it when there is one. */
const withReason = (sentence: string, reason: string | undefined): string => (reason === undefined ? sentence : `${sentence} ${reason}`);

/** Why a save was refused, as the rejection says it; undefined when it says nothing a person could read. */
export function refusalReasonOf(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return message === undefined || message.trim() === '' ? undefined : message;
}

export const defaultBoardAnnouncements: BoardAnnouncements = {
  grabbed: (title) => `Grabbed ${title}. Use the arrow keys to move, Enter to drop, Escape to cancel.`,
  over: (title, cell) => `${title} is over ${cell}.`,
  moved: (title, cell) => `Moved ${title} to ${cell}.`,
  returned: (title) => `${title} returned to its original position.`,
  failed: (title, reason) => withReason(`Could not move ${title}; it was returned to its original position.`, reason),
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
    failed: (title, reason) =>
      withReason(t('ui:widgets.boards.a11y.failed', 'Could not move {title}; it was returned to its original position.', { title }), reason),
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
  if (templates.failed !== undefined) out.failed = (title, reason) => withReason(fill(templates.failed!, title), reason);
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
  /**
   * The board's own element. With it, a keyboard move is followed: the cell a
   * grabbed card is over is scrolled into view inside the board's scroller
   * (`data-board-scroller`), and the card is focused again once it is drawn
   * where it was dropped, or put back.
   */
  root?: RefObject<HTMLElement | null> | undefined;
}

/** Room kept between a cell scrolled into view and the scroller's edge. */
const FOLLOW_MARGIN = 12;

/** How far to scroll along one axis so `[from, to]` is inside `[start, end]`; the start side wins when it cannot fit. */
function followDelta(from: number, to: number, start: number, end: number, startIsFar: boolean): number {
  const margin = to - from + FOLLOW_MARGIN * 2 <= end - start ? FOLLOW_MARGIN : 0;
  const before = from - margin - start;
  const after = to + margin - end;
  if (to - from > end - start) return startIsFar ? after : before;
  if (before < 0) return before;
  if (after > 0) return after;
  return 0;
}

/**
 * Scrolls `scroller` — and nothing else, never the page — so `target` is in
 * view. The position is set, not animated: there is no motion to reduce, and
 * the next arrow press reads a scroller that is already where it will be.
 */
export function scrollCellIntoView(scroller: HTMLElement, target: Element): void {
  const box = scroller.getBoundingClientRect();
  const cell = target.getBoundingClientRect();
  const rtl = typeof getComputedStyle === 'function' && getComputedStyle(scroller).direction === 'rtl';
  const dx = followDelta(cell.left, cell.right, box.left, box.right, rtl);
  const dy = followDelta(cell.top, cell.bottom, box.top, box.bottom, false);
  if (dx !== 0) scroller.scrollLeft += dx;
  if (dy !== 0) scroller.scrollTop += dy;
}

/** A board's element for a card or a cell, by its id: read by attribute, so no id needs escaping. */
function boardElement(root: HTMLElement | null | undefined, attribute: 'data-board-card' | 'data-board-cell', id: string): HTMLElement | null {
  if (root === null || root === undefined) return null;
  for (const el of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) if (el.getAttribute(attribute) === id) return el;
  return null;
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
  /**
   * The last move whose save was refused: the card went back, and this is why.
   * Kept until it is dismissed or another move is made, so a person who was
   * looking at the card they dropped can read what a live region only says.
   */
  refusal: BoardMoveRefusal | null;
  dismissRefusal: () => void;
  /**
   * Whether the card sits where a drop put it and its save has not answered
   * yet. A count somebody else made of a column is moved by these cards only:
   * once the save has answered, the next count already has the move in it.
   */
  isSaving: (cardId: string) => boolean;
}

/** A move that did not hold. */
export interface BoardMoveRefusal {
  cardId: string;
  title: string;
  /** Why, in the words of whoever refused it; undefined when it gave none. */
  reason: string | undefined;
}

/**
 * How long an override whose save has answered is kept when no new `cards`
 * arrive: a read that comes back the same as the last one is the same array,
 * so nothing else would ever let go of it.
 */
export const SETTLED_OVERRIDE_WAIT_MS = 5_000;

/** The optimistic-move + keyboard-grab state machine (see file header). */
export function useBoardMoves({
  cards,
  naturalCellKey,
  cellLabel,
  onCommit,
  announce,
  announcements,
  root,
}: UseBoardMovesArgs): BoardMoves {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [grab, setGrab] = useState<{ cardId: string; targetKey: string } | null>(null);
  const [refusal, setRefusal] = useState<BoardMoveRefusal | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, BoardCardData>();
    for (const card of cards) map.set(card.id, card);
    return map;
  }, [cards]);

  // Latest-values ref so the stable callbacks below never read stale state.
  const ref = useRef({ overrides, grab, byId, naturalCellKey, cellLabel, onCommit, announce, announcements, root });
  ref.current = { overrides, grab, byId, naturalCellKey, cellLabel, onCommit, announce, announcements, root };

  /*
   * The card to focus once it is drawn in `cellKey`. A card that changes cell
   * is a NEW element — the one that had the focus is gone, and the focus with
   * it, to the page's body — so a keyboard drop would leave its person nowhere.
   */
  const refocus = useRef<{ cardId: string; cellKey: string } | null>(null);
  useEffect(() => {
    const wanted = refocus.current;
    if (wanted === null) return;
    const board = ref.current.root?.current;
    const el = boardElement(board, 'data-board-card', wanted.cardId);
    const active = typeof document === 'undefined' ? null : document.activeElement;
    // The card is gone, or the person has gone on to something else: nothing is taken from them.
    if (el === null || (active !== null && active !== document.body && active !== el && board?.contains(active) !== true)) {
      refocus.current = null;
      return;
    }
    const cell = el.closest('[data-board-cell]');
    if (cell?.getAttribute('data-board-cell') !== wanted.cellKey) return;
    refocus.current = null;
    // Where the card is, in view: after a cancel the board is still scrolled to the cell the card was held over,
    // and the focus would be on a card nobody can see.
    const scroller = el.closest<HTMLElement>('[data-board-scroller]');
    if (scroller !== null) scrollCellIntoView(scroller, cell.closest('[data-board-column]') ?? cell);
    if (active !== el) el.focus();
  });

  // While a card is grabbed, the cell it is over is in view: on a narrow screen it is otherwise moved blind.
  const overKey = grab?.targetKey ?? null;
  useEffect(() => {
    if (overKey === null) return;
    const cell = boardElement(ref.current.root?.current, 'data-board-cell', overKey);
    const scroller = cell?.closest<HTMLElement>('[data-board-scroller]') ?? null;
    if (cell === null || scroller === null) return;
    scrollCellIntoView(scroller, cell.closest('[data-board-column]') ?? cell);
  }, [overKey]);

  const settledKeyOf = useCallback((card: BoardCardData): string => {
    return ref.current.overrides[card.id] ?? ref.current.naturalCellKey(card);
  }, []);

  /*
   * Per card: the number of its latest move, and whether that move's save has
   * answered ("settled"). Kept in refs — the answers arrive in promise
   * callbacks, which must read what is true now — with `rerender` for the one
   * thing drawn from them (`isSaving`).
   */
  const sequence = useRef(new Map<string, number>());
  const settled = useRef(new Set<string>());
  const settleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const letGo = useCallback((cardId: string) => {
    const timer = settleTimers.current.get(cardId);
    if (timer !== undefined) clearTimeout(timer);
    settleTimers.current.delete(cardId);
    settled.current.delete(cardId);
  }, []);

  // Reconcile optimistic overrides against fresh server data. An override is
  // dropped — and the card falls back to server truth — when the incoming
  // card's NATURAL cell key has reached it (the move is confirmed), when the
  // card has disappeared, and when its save has ANSWERED: whatever the cards
  // that arrive after that say, they are what the server holds. Waiting for
  // the cell to equal the override instead left a card where it was dropped
  // for good whenever the server answered yes and kept another value (a rule
  // of its own, a colleague's move in between). A rejected move is unwound by
  // the rollback path in `requestMove`.
  useEffect(() => {
    // Read once, outside the updater: an updater may be run twice, and must answer the same both times.
    const saved = new Set(settled.current);
    setOverrides((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        const card = ref.current.byId.get(id);
        if (card === undefined || saved.has(id) || ref.current.naturalCellKey(card) === prev[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    for (const id of saved) letGo(id);
  }, [cards, letGo]);

  // Nothing is written after the board is gone.
  useEffect(() => {
    const timers = settleTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

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
      // This move is the card's latest: an answer to an earlier one is about a place the card has since left.
      const move = (sequence.current.get(cardId) ?? 0) + 1;
      sequence.current.set(cardId, move);
      const latest = (): boolean => sequence.current.get(cardId) === move;
      letGo(cardId);
      setOverrides((prev) => ({ ...prev, [cardId]: toCellKey }));
      setRefusal(null);
      ref.current.announce(ref.current.announcements.moved(card.title, ref.current.cellLabel(toCellKey)));
      const result = ref.current.onCommit(cardId, fromCellKey, toCellKey);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(
          () => {
            if (!latest()) return;
            // Saved. The override is let go of with the next cards to arrive, whatever they say — or, when a read
            // comes back the same as the last one and so no new cards ever arrive, after a short wait.
            settled.current.add(cardId);
            settleTimers.current.set(
              cardId,
              setTimeout(() => {
                if (!latest() || !settled.current.has(cardId)) return;
                letGo(cardId);
                setOverrides((prev) => {
                  if (!(cardId in prev)) return prev;
                  const next = { ...prev };
                  delete next[cardId];
                  return next;
                });
              }, SETTLED_OVERRIDE_WAIT_MS),
            );
            rerender();
          },
          (error: unknown) => {
            // An earlier move of a card that has been moved again since: the card is not where this answer is about,
            // so it is put nowhere and nothing is said — "it went back" would be read beside a card that did not.
            if (!latest()) return;
            // The card goes back as a new element: if the focus is on it now (or was lost with it), it follows it back.
            const board = ref.current.root?.current;
            const active = typeof document === 'undefined' ? null : document.activeElement;
            if (board !== null && board !== undefined && (active === null || active === document.body || active === boardElement(board, 'data-board-card', cardId))) {
              refocus.current = { cardId, cellKey: fromCellKey };
            }
            // Rollback: restore the settled key (drop the optimistic override).
            setOverrides((prev) => {
              const next = { ...prev };
              if (next[cardId] === toCellKey) delete next[cardId];
              return next;
            });
            // Said twice, on purpose: aloud for a screen reader, and on the board for whoever is looking at it.
            const reason = refusalReasonOf(error);
            setRefusal({ cardId, title: card.title, reason });
            ref.current.announce(ref.current.announcements.failed(card.title, reason));
          },
        );
      }
    },
    [settledKeyOf, letGo],
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
    refocus.current = { cardId: current.cardId, cellKey: current.targetKey };
    requestMove(current.cardId, current.targetKey);
  }, [requestMove]);

  const cancel = useCallback(() => {
    const current = ref.current.grab;
    if (current === null) return;
    setGrab(null);
    const card = ref.current.byId.get(current.cardId);
    if (card !== undefined) refocus.current = { cardId: current.cardId, cellKey: settledKeyOf(card) };
    ref.current.announce(ref.current.announcements.returned(titleOf(current.cardId)));
  }, [titleOf, settledKeyOf]);

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
    refusal,
    dismissRefusal: () => setRefusal(null),
    isSaving: (cardId) => cardId in overrides && !settled.current.has(cardId),
  };
}

/** An add that did not hold: the card's title when one was typed, and why. */
export interface BoardAddRefusal {
  title: string | undefined;
  /** Why, in the words of whoever refused it; undefined when it gave none. */
  reason: string | undefined;
}

/** The sentence for a card that was not added. */
function useAddRefusalSentence(): (refusal: BoardAddRefusal) => string {
  const t = useMaybeT();
  return (refusal) =>
    refusal.title === undefined
      ? t('ui:widgets.boards.cardNotAdded', 'The card was not added.')
      : t('ui:widgets.boards.notAdded', '{title} was not added.', { title: refusal.title });
}

/**
 * Says a refused add aloud, once, through the board's one live region: the
 * line on the board (`BoardAddRefusalNotice`) is for whoever is looking.
 */
export function useAnnounceAddRefusal(refusal: BoardAddRefusal | null | undefined, announce: (message: string) => void): void {
  const sentence = useAddRefusalSentence();
  const latest = useRef({ sentence, announce });
  latest.current = { sentence, announce };
  useEffect(() => {
    if (refusal === null || refusal === undefined) return;
    latest.current.announce(withReason(latest.current.sentence(refusal), refusal.reason));
  }, [refusal]);
}

/** The card that was not added, and why: the same line, in the same place, as a card that went back. */
export function BoardAddRefusalNotice({ refusal, onDismiss }: { refusal: BoardAddRefusal | null | undefined; onDismiss: () => void }) {
  const sentence = useAddRefusalSentence();
  if (refusal === null || refusal === undefined) return null;
  return <RefusalLine part="board-add-refused" sentence={sentence(refusal)} reason={refusal.reason} onDismiss={onDismiss} />;
}

/**
 * The card that went back, and why: a line above the board, where the page's
 * other notices are, until it is dismissed or the next move is made. Not a
 * live region of its own — the board's one region has already said it.
 */
export function BoardRefusalNotice({ refusal, onDismiss }: { refusal: BoardMoveRefusal | null; onDismiss: () => void }) {
  const t = useMaybeT();
  if (refusal === null) return null;
  return (
    <RefusalLine
      part="board-move-refused"
      sentence={t('ui:widgets.boards.notMoved', '{title} was not moved.', { title: refusal.title })}
      reason={refusal.reason}
      onDismiss={onDismiss}
    />
  );
}

/** One refusal, above the board: what did not hold, why, and a way to put the line away. */
function RefusalLine({ part, sentence, reason, onDismiss }: { part: string; sentence: string; reason: string | undefined; onDismiss: () => void }) {
  const t = useMaybeT();
  return (
    <div
      data-part={part}
      className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-body-sm text-fg"
    >
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{sentence}</span>
        {reason === undefined ? null : <span data-part={`${part}-reason`}> {reason}</span>}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('ui:widgets.boards.dismissNotice', 'Dismiss')}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * A droppable board cell (a column, or a lane×column cell). `isTarget` paints
 * the annex drop affordance (dashed accent border + accent-soft tint). The dnd
 * ref is attached to the scroll container so cards drop anywhere in the cell.
 */
export function DroppableCell({
  id,
  className,
  activeClassName,
  children,
  testId,
  highlight,
  column,
}: {
  id: string;
  className?: string | undefined;
  /** The classes the cell takes while a card is over it, in place of the default dashed accent outline. */
  activeClassName?: string | undefined;
  children: ReactNode;
  testId?: string | undefined;
  /** Keyboard drop-target highlight (pointer hover is detected internally). */
  highlight?: boolean | undefined;
  /** The cell IS a whole column (`data-board-column`): a keyboard move scrolls it into view. */
  column?: string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const active = isOver || highlight === true;
  return (
    <div
      ref={setNodeRef}
      data-board-cell={id}
      data-board-column={column}
      data-over={isOver ? '' : undefined}
      data-drop-target={active ? '' : undefined}
      data-testid={testId}
      className={
        (className ?? '') + (active ? ` ${activeClassName ?? 'rounded-lg border-2 border-dashed border-accent bg-accent-soft/40'}` : '')
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
  tabbable,
}: {
  card: BoardCardData;
  disabled?: boolean | undefined;
  /** Whether Tab stops at the card. Left out, a card that can be dragged does and one that cannot does not. */
  tabbable?: boolean | undefined;
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
  const t = useMaybeT();
  return (
    <div
      ref={setNodeRef}
      role="button"
      data-board-card={card.id}
      data-dragging={isDragging ? '' : undefined}
      data-grabbed={grabbed ? '' : undefined}
      // What a screen reader calls the card in place of "button", in the reader's own language.
      aria-roledescription={disabled === true ? undefined : t('ui:widgets.boards.a11y.draggable', 'draggable card')}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-grabbed={grabbed ? true : undefined}
      tabIndex={(tabbable ?? !disabled) ? 0 : -1}
      className={(className ?? '') + (isDragging ? ' opacity-40' : '') + (grabbed ? ' ring-2 ring-accent' : '')}
      onKeyDown={onKeyDown}
      onClick={onClick}
      {...listeners}
    >
      {children}
    </div>
  );
}
