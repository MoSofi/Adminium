// SPDX-License-Identifier: AGPL-3.0-only
import { EmptyState } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { BoardCard } from './BoardCard.js';
import { CardActions } from './CardActions.js';
import { useMaybeT } from '../../lib/i18n.js';

import {
  BoardAddRefusalNotice,
  BoardLiveRegion,
  BoardRefusalNotice,
  DraggableCard,
  DroppableCell,
  announcementsFromTemplates,
  silentDndAnnouncements,
  useBoardAnnouncements,
  refusalReasonOf,
  useAnnounceAddRefusal,
  useBoardMoves,
  useLiveRegion,
} from './board-dnd.js';
import type { BoardAddRefusal, BoardAnnouncements, MoveResult } from './board-dnd.js';
import { boardRowsOf, resolveColumns, toBoardCard } from './board-lib.js';
import type { BoardCardData, ColumnDef } from './board-lib.js';
import type { KanbanBoardConfig } from './boards-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `boards-config`
// module so the registry metadata graph never eagerly pulls dnd-kit (acc #3);
// re-exported here so the family barrel, stories, and tests keep one import
// point per widget.
export { kanbanBoardConfigSchema, kanbanBoardDemoData, kanbanColumnDefSchema } from './boards-config.js';
export type { KanbanBoardConfig };

/**
 * `kanban-board` (annex) — fixed status columns of draggable cards. Columns
 * derive from a workflow-enum field; a card dropped in another column emits an
 * `onCardMove(cardId, fromColumn, toColumn)` the binding fires as an optimistic
 * UPDATE mutation (rolled back if the mutation promise rejects). Pointer drag
 * uses dnd-kit; keyboard uses a logical grab → arrow-move → Enter-commit /
 * Escape-cancel model that mirrors correctly under `dir="rtl"`. Binds to a flat
 * `record-list` grouped by the status field.
 *
 * Ports Project Board.dc.html, Kanban Roadmap.dc.html — closing the
 * "modal not wired to grid" gap: a committed move updates the board state in
 * place rather than only firing a detached modal.
 */

/** Column-header status dot tone → token background (no raw hex). */
const DOT_TONE: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface KanbanBoardLabels {
  announcements?: Partial<BoardAnnouncements> | undefined;
  addLabel?: string | undefined;
  /** The column composer's words: its placeholder, its add button ("Add project") and cancel. */
  composePlaceholder?: string | undefined;
  composeAdd?: string | undefined;
  composeCancel?: string | undefined;
  gripLabel?: string | undefined;
  pointsUnit?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
}

export interface KanbanBoardProps {
  cards: readonly BoardCardData[];
  columns: readonly ColumnDef[];
  dir?: 'ltr' | 'rtl' | undefined;
  locale?: string | undefined;
  allowAdd?: boolean | undefined;
  labels?: KanbanBoardLabels | undefined;
  /** Fired on a committed move; return a promise to enable rollback-on-reject. */
  onCardMove?: ((cardId: string, fromColumn: string, toColumn: string) => MoveResult) | undefined;
  onCardOpen?: ((cardId: string) => void) | undefined;
  /**
   * With `onCardOpen`: Shift+Enter opens a card that can be moved (Enter
   * alone picks it up, so without this a keyboard has no way to open one),
   * and each such card says so to a screen reader. Off unless asked for.
   */
  keyboardOpen?: boolean | undefined;
  /**
   * One of a card's own `actions` was chosen from its menu. Giving this is
   * what draws the "more" button on every card that has actions.
   */
  onCardAction?: ((cardId: string, actionId: string) => void) | undefined;
  /** Add a card to a column; return the save's promise so a refused add is said on the board instead of lost. */
  onAdd?: ((columnId: string) => MoveResult) | undefined;
  /**
   * An add somebody else made for this board and that was refused (a composer
   * beside it): shown where a refused move is, and said aloud. The board's own
   * "add" button reports through the same line.
   */
  addRefusal?: BoardAddRefusal | null | undefined;
  onDismissAddRefusal?: (() => void) | undefined;
  /**
   * Which cards may be moved. Left out, every card. A card that may not is
   * not dragged and not picked up; with `onCardOpen`, Tab still stops at it
   * and Enter opens it.
   */
  canMoveCard?: ((cardId: string) => boolean) | undefined;
  /** Drawn at the foot of each column, under its cards (a composer of the host's). */
  columnFooter?: ((column: ColumnDef) => ReactNode) | undefined;
  /**
   * A card typed into a column's own composer (the comp's "+": a name, then
   * Add or Enter). Given, the "+" opens the composer instead of adding at
   * once; return the save's promise so the name is kept until it holds.
   */
  onCompose?: ((columnId: string, title: string) => MoveResult) | undefined;
  /** Open the composer in a column from outside the board (a "New …" button): a new `at` opens it again. */
  composeRequest?: { column: string; at: number } | null | undefined;
  /** The Kanban Roadmap comp's card: its theme, the title, progress with the owner. */
  roadmapCards?: boolean | undefined;
  testId?: string | undefined;
}

export function KanbanBoard({
  cards,
  columns,
  dir = 'ltr',
  locale,
  allowAdd = false,
  labels,
  onCardMove,
  onCardOpen,
  keyboardOpen = false,
  onCardAction,
  onAdd,
  addRefusal,
  onDismissAddRefusal,
  canMoveCard,
  columnFooter,
  onCompose,
  composeRequest,
  roadmapCards = false,
  testId,
}: KanbanBoardProps) {
  const t = useMaybeT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { message, announce } = useLiveRegion();
  // An add from a column's own button that was refused; the host's (a composer's) comes in `addRefusal`.
  const [ownAddRefusal, setOwnAddRefusal] = useState<BoardAddRefusal | null>(null);
  // The column whose composer is open (the comp's "+"), or none.
  const [composing, setComposing] = useState<string | null>(null);
  const requestAt = composeRequest?.at;
  useEffect(() => {
    if (composeRequest === null || composeRequest === undefined) return;
    setComposing(composeRequest.column);
    // The column it opened in is brought into view.
    const column = root.current?.querySelector<HTMLElement>(`[data-board-column="${CSS.escape(composeRequest.column)}"]`);
    column?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // Only a new request opens it (a new `at`): the column alone changing is not one.
  }, [requestAt]);
  const notAdded = ownAddRefusal ?? addRefusal ?? null;
  useAnnounceAddRefusal(notAdded, announce);
  const announcements: BoardAnnouncements = useBoardAnnouncements(labels?.announcements);

  const columnById = new Map(columns.map((column) => [column.id, column]));
  const labelOf = (columnId: string): string => columnById.get(columnId)?.label ?? columnId;

  // The board's own element: a keyboard move is followed inside it (the column in view, the focus on the card).
  const root = useRef<HTMLDivElement>(null);
  const moves = useBoardMoves({
    root,
    cards,
    naturalCellKey: (card) => card.column,
    cellLabel: labelOf,
    onCommit: (cardId, from, to) => onCardMove?.(cardId, from, to),
    announce,
    announcements,
  });

  // Shift+Enter opens, where the host asked for it: said once, in a line every movable card points at.
  const opensByKey = keyboardOpen && onCardOpen !== undefined;
  const openHintId = useId();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const activeCard = activeId === null ? null : cards.find((card) => card.id === activeId) ?? null;

  if (columns.length === 0) {
    return (
      <EmptyState
        preset="no-data"
        title={labels?.emptyTitle ?? t('ui:widgets.boards.kanbanBoard.emptyTitle', 'No board columns')}
        body={labels?.emptyBody ?? t('ui:widgets.boards.kanbanBoard.emptyBody', 'Add a status field to group cards into columns.')}
      />
    );
  }

  const onDragStart = (event: DragStartEvent): void => {
    setActiveId(String(event.active.id));
  };
  const onDragEnd = (event: DragEndEvent): void => {
    setActiveId(null);
    const over = event.over;
    if (over === null) return;
    moves.requestMove(String(event.active.id), String(over.id));
  };

  const addTo = (columnId: string): void => {
    setOwnAddRefusal(null);
    const result = onAdd?.(columnId);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, (error: unknown) => setOwnAddRefusal({ title: undefined, reason: refusalReasonOf(error) }));
    }
  };

  const locked = (cardId: string): boolean => canMoveCard !== undefined && !canMoveCard(cardId);

  const composeIn = (columnId: string): void => {
    setOwnAddRefusal(null);
    setComposing(columnId);
  };
  const saveComposed = (columnId: string, title: string): MoveResult => {
    setOwnAddRefusal(null);
    const result = onCompose?.(columnId, title);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).then(
        (value) => {
          setComposing(null);
          return value;
        },
        (error: unknown) => {
          setOwnAddRefusal({ title, reason: refusalReasonOf(error) });
          throw error;
        },
      );
    }
    setComposing(null);
    return result;
  };

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, card: BoardCardData): void => {
    if (locked(card.id)) {
      // A card that stays where it is has one thing a key can do: be opened.
      if (onCardOpen !== undefined && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) {
        event.preventDefault();
        onCardOpen(card.id);
      }
      return;
    }
    const grabbed = moves.isGrabbed(card.id);
    if (opensByKey && !grabbed && event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      onCardOpen(card.id);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (grabbed) moves.commit();
      else moves.grab(card.id);
      return;
    }
    if (event.key === 'Escape') {
      if (grabbed) {
        event.preventDefault();
        moves.cancel();
      }
      return;
    }
    if (!grabbed) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      // Logical step: ArrowRight advances reading order; under RTL that is the
      // visually-left column, so flip the physical delta by `dir`.
      const physical = event.key === 'ArrowRight' ? 1 : -1;
      const logical = physical * (dir === 'rtl' ? -1 : 1);
      const currentKey = moves.grabTargetKey ?? moves.cellKeyOf(card);
      const current = columns.findIndex((column) => column.id === currentKey);
      const nextIndex = Math.min(Math.max(current + logical, 0), columns.length - 1);
      moves.previewTo(columns[nextIndex]!.id);
    }
  };

  return (
    <div ref={root} dir={dir} data-widget="kanban-board" data-testid={testId} className="flex h-full flex-col">
      <BoardLiveRegion message={message} />
      {opensByKey ? (
        <p id={openHintId} data-part="board-open-hint" className="sr-only">
          {t('ui:widgets.boards.a11y.openHint', 'Enter picks this card up to move it. Shift+Enter opens it.')}
        </p>
      ) : null}
      <BoardRefusalNotice refusal={moves.refusal} onDismiss={moves.dismissRefusal} />
      <BoardAddRefusalNotice
        refusal={notAdded}
        onDismiss={() => {
          setOwnAddRefusal(null);
          onDismissAddRefusal?.();
        }}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements: silentDndAnnouncements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* The comp's board: columns side by side and as wide as the room allows, never narrower than a card. */}
        <div data-board-scroller="" className="grid h-full min-h-0 flex-1 auto-cols-[minmax(260px,1fr)] grid-flow-col items-start gap-4 overflow-x-auto pb-2">
          {columns.map((column) => {
            const columnCards = cards.filter((card) => moves.cellKeyOf(card) === column.id);
            // The count somebody made of ALL the column's cards, moved by the cards a drop has just put in or taken
            // out and whose save has not answered yet: once it has, the next count has the move in it already, and
            // moving it again would count the card twice. Without a count, the cards given.
            const saving = cards.filter((card) => moves.isSaving(card.id));
            const held =
              column.count === undefined
                ? columnCards.length
                : Math.max(
                    0,
                    column.count +
                      saving.filter((card) => moves.cellKeyOf(card) === column.id).length -
                      saving.filter((card) => card.column === column.id).length,
                  );
            const overWip = column.wip !== undefined && held > column.wip;
            const canAdd = allowAdd && (onCompose !== undefined || onAdd !== undefined);
            return (
              <DroppableCell
                key={column.id}
                id={column.id}
                column={column.id}
                testId={`column-drop-${column.id}`}
                highlight={moves.grabTargetKey === column.id}
                className="flex max-h-full min-h-[120px] min-w-0 flex-col rounded-[16px] border border-border bg-surface-2 px-3 pb-3.5 pt-3 leading-[normal] transition-colors duration-150"
                activeClassName="border-dashed border-accent bg-accent-soft outline outline-[0.5px] outline-accent"
              >
                {/* It wraps: a total of two figures takes a line of its own under the heading, never cut short. */}
                <header className="flex flex-wrap items-center gap-x-[9px] gap-y-1 px-1 pb-3 pt-0.5">
                  <span aria-hidden="true" className={`size-[9px] shrink-0 rounded-full ${DOT_TONE[column.tone]}`} />
                  <h3 className="m-0 min-w-0 truncate text-[13.5px] font-extrabold tracking-[-0.01em] text-fg">{column.label}</h3>
                  {column.badge === undefined ? null : (
                    <span data-part="column-badge" className="shrink-0 rounded-full border border-border px-1.5 text-[10.5px] font-medium tabular-nums text-fg-muted">
                      {column.badge}
                    </span>
                  )}
                  <span
                    data-part="column-count"
                    className={
                      'inline-flex shrink-0 items-center justify-center rounded-full px-2 py-px font-mono text-[11px] font-semibold tabular-nums ' +
                      (overWip ? 'bg-danger text-accent-fg' : 'bg-surface-3 text-fg-subtle')
                    }
                  >
                    {column.wip === undefined ? held : `${held}/${column.wip}`}
                  </span>
                  {column.total === undefined ? null : (
                    <span data-part="column-total" title={column.total} className="ms-auto min-w-0 max-w-full truncate font-mono text-[11px] font-semibold tabular-nums text-fg-muted">
                      {column.total}
                    </span>
                  )}
                  {canAdd && (
                    <button
                      type="button"
                      data-part="column-add"
                      onClick={() => (onCompose === undefined ? addTo(column.id) : composeIn(column.id))}
                      aria-label={labels?.addLabel ?? t('ui:widgets.boards.addCard', 'Add card')}
                      title={labels?.addLabel ?? t('ui:widgets.boards.addCard', 'Add card')}
                      className={`${column.total === undefined ? 'ms-auto' : ''} flex size-[26px] shrink-0 items-center justify-center rounded-[7px] text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:scale-[.92]`}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </header>
                {composing === column.id && onCompose !== undefined ? (
                  <ColumnComposer
                    placeholder={labels?.composePlaceholder ?? t('ui:widgets.boards.inlineComposeCard.placeholder', 'Card title…')}
                    addLabel={labels?.composeAdd ?? t('ui:widgets.boards.inlineComposeCard.addLabel', 'Add')}
                    cancelLabel={labels?.composeCancel ?? t('ui:widgets.boards.inlineComposeCard.cancelLabel', 'Cancel')}
                    onSave={(title) => saveComposed(column.id, title)}
                    onCancel={() => setComposing(null)}
                  />
                ) : null}
                <div data-part="column-cards" className="flex min-h-[60px] flex-col gap-2.5 overflow-y-auto">
                  {columnCards.map((card) => {
                    const actions = onCardAction === undefined ? undefined : card.actions;
                    const withMenu = actions !== undefined && actions.length > 0;
                    const shell = (
                      <DraggableCard
                        key={card.id}
                        card={card}
                        grabbed={moves.isGrabbed(card.id)}
                        {...(locked(card.id) ? { disabled: true, tabbable: onCardOpen !== undefined } : opensByKey ? { ariaDescribedBy: openHintId } : {})}
                        ariaLabel={card.title}
                        className={`${withMenu ? 'peer ' : ''}cursor-grab rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
                        onKeyDown={(event) => onCardKeyDown(event, card)}
                        {...(onCardOpen === undefined ? {} : { onClick: () => onCardOpen(card.id) })}
                      >
                        <BoardCard
                          card={card}
                          columnTone={column.tone}
                          {...(roadmapCards ? { roadmap: true } : {})}
                          {...(withMenu ? { actionsSpace: true } : {})}
                          {...(locale === undefined ? {} : { locale })}
                          {...(labels?.gripLabel === undefined ? {} : { gripLabel: labels.gripLabel })}
                          {...(labels?.pointsUnit === undefined ? {} : { pointsUnit: labels.pointsUnit })}
                        />
                      </DraggableCard>
                    );
                    if (!withMenu) return shell;
                    // The menu's button stands AFTER the card, over its corner, and is no part of it: see CardActions.
                    return (
                      <div key={card.id} data-part="board-card-shell" className="relative">
                        {shell}
                        <CardActions
                          title={card.title}
                          actions={actions}
                          onAction={(actionId) => onCardAction?.(card.id, actionId)}
                          className="absolute end-2 top-2 peer-data-[dragging]:opacity-40"
                        />
                      </div>
                    );
                  })}
                </div>
                {columnFooter === undefined ? null : (
                  <div data-part="column-footer" className="pt-2">
                    {columnFooter(column)}
                  </div>
                )}
              </DroppableCell>
            );
          })}
        </div>
        <DragOverlay>
          {activeCard === null ? null : (
            <div className="w-[280px]">
              <BoardCard
                card={activeCard}
                columnTone={columnById.get(moves.cellKeyOf(activeCard))?.tone ?? 'accent'}
                {...(roadmapCards ? { roadmap: true } : {})}
                {...(locale === undefined ? {} : { locale })}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/**
 * A column's own composer (the comp's "+"): an accent-edged card with the
 * name field, Add and Cancel; Enter adds, Escape closes. The name stays, and
 * cannot be edited, until the save answers; a refused one is kept to fix.
 */
function ColumnComposer({
  placeholder,
  addLabel,
  cancelLabel,
  onSave,
  onCancel,
}: {
  placeholder: string;
  addLabel: string;
  cancelLabel: string;
  onSave: (title: string) => MoveResult;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const save = (): void => {
    const title = draft.trim();
    if (title === '' || saving) return;
    const result = onSave(title);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setSaving(true);
      (result as Promise<unknown>).then(
        () => setSaving(false),
        () => setSaving(false),
      );
    }
  };
  return (
    <div data-part="column-composer" className="mb-2.5 animate-[nb-pop_.16s_ease] rounded-[12px] border border-accent bg-surface p-3 shadow-card">
      <input
        type="text"
        autoFocus
        value={draft}
        readOnly={saving}
        aria-busy={saving || undefined}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="w-full rounded-[8px] border border-border bg-surface-2 px-2.5 py-2 text-[13px] font-semibold text-fg outline-none placeholder:font-medium placeholder:text-fg-subtle focus-visible:border-accent"
      />
      <div className="mt-[9px] flex gap-1.5">
        <button
          type="button"
          data-part="compose-add"
          disabled={saving || draft.trim() === ''}
          onClick={save}
          className="flex-1 rounded-[8px] bg-accent p-[7px] text-[12px] font-bold text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {addLabel}
        </button>
        <button
          type="button"
          data-part="compose-cancel"
          onClick={onCancel}
          className="rounded-[8px] border border-border bg-surface px-[11px] py-[7px] text-[12px] font-bold text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

function sourceOf(config: KanbanBoardConfig): { connectionId?: string | undefined; table: string } {
  const binding = config.binding as { connectionId?: string; source?: { table?: string } } | undefined;
  return { connectionId: binding?.connectionId, table: binding?.source?.table ?? 'records' };
}

export function KanbanBoardWidget({ config, data, onEvent }: WidgetProps<KanbanBoardConfig>) {
  // One array for one answer: the board lets go of a saved move when NEW cards arrive, and tells by the array.
  const cards = useMemo(
    () => boardRowsOf(data).map((row, index) => toBoardCard(row, index, { columnField: config.columnField, titleField: config.titleField })),
    [data, config.columnField, config.titleField],
  );
  const columns = resolveColumns(cards, config.columnDefs);
  const source = sourceOf(config);
  const labels: KanbanBoardLabels = {
    ...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle, emptyBody: config.emptyBody }),
    ...(config.addLabel === undefined ? {} : { addLabel: config.addLabel }),
    ...(config.announcements === undefined
      ? {}
      : { announcements: announcementsFromTemplates(config.announcements) }),
  };
  return (
    <KanbanBoard
      cards={cards}
      columns={columns}
      allowAdd={config.allowAdd}
      {...(config.format?.locale === undefined || config.format.locale.trim() === '' ? {} : { locale: config.format.locale })}
      labels={labels}
      // Return the host's result so a rejected `mutate` promise rolls the
      // optimistic move back and announces the failure (annex a11y).
      onCardMove={(cardId, _from, toColumn) =>
        onEvent({
          type: 'mutate',
          intent: 'update',
          connectionId: source.connectionId,
          table: source.table,
          recordId: cardId,
          values: { [config.columnField]: toColumn },
        })
      }
      onCardOpen={(cardId) => {
        onEvent({ type: 'record-open', connectionId: source.connectionId, table: source.table, recordId: cardId });
      }}
      onAdd={(columnId) =>
        onEvent({
          type: 'mutate',
          intent: 'insert',
          connectionId: source.connectionId,
          table: source.table,
          values: { [config.columnField]: columnId },
        })
      }
    />
  );
}

