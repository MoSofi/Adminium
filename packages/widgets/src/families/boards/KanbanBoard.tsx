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
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { BoardCard } from './BoardCard.js';
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
  onAdd,
  addRefusal,
  onDismissAddRefusal,
  canMoveCard,
  columnFooter,
  testId,
}: KanbanBoardProps) {
  const t = useMaybeT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { message, announce } = useLiveRegion();
  // An add from a column's own button that was refused; the host's (a composer's) comes in `addRefusal`.
  const [ownAddRefusal, setOwnAddRefusal] = useState<BoardAddRefusal | null>(null);
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
        <div data-board-scroller="" className="flex h-full min-h-0 flex-1 items-stretch gap-3 overflow-x-auto p-3">
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
            return (
              <section
                key={column.id}
                data-board-column={column.id}
                className="flex w-72 shrink-0 flex-col rounded-xl bg-surface-2/60"
              >
                <header className="flex items-center gap-2 px-3 py-2.5">
                  <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${DOT_TONE[column.tone]}`} />
                  <span className="min-w-0 truncate text-body-sm font-semibold text-fg">{column.label}</span>
                  <span
                    data-part="column-count"
                    className={
                      'ms-1 inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-[10.5px] font-bold tabular-nums ' +
                      (overWip ? 'bg-danger text-accent-fg' : 'bg-surface-3 text-fg-muted')
                    }
                  >
                    {column.wip === undefined ? held : `${held}/${column.wip}`}
                  </span>
                  {column.total === undefined ? null : (
                    <span data-part="column-total" className="ms-auto min-w-0 truncate font-mono text-[11px] font-semibold tabular-nums text-fg-muted">
                      {column.total}
                    </span>
                  )}
                  {allowAdd && (
                    <button
                      type="button"
                      data-part="column-add"
                      onClick={() => addTo(column.id)}
                      aria-label={labels?.addLabel ?? t('ui:widgets.boards.addCard', 'Add card')}
                      className={`${column.total === undefined ? 'ms-auto' : ''} flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </header>
                <DroppableCell
                  id={column.id}
                  testId={`column-drop-${column.id}`}
                  highlight={moves.grabTargetKey === column.id}
                  className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
                >
                  {columnCards.map((card) => (
                    <DraggableCard
                      key={card.id}
                      card={card}
                      grabbed={moves.isGrabbed(card.id)}
                      {...(locked(card.id) ? { disabled: true, tabbable: onCardOpen !== undefined } : {})}
                      ariaLabel={card.title}
                      className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onKeyDown={(event) => onCardKeyDown(event, card)}
                      {...(onCardOpen === undefined ? {} : { onClick: () => onCardOpen(card.id) })}
                    >
                      <BoardCard
                        card={card}
                        columnTone={column.tone}
                        {...(locale === undefined ? {} : { locale })}
                        {...(labels?.gripLabel === undefined ? {} : { gripLabel: labels.gripLabel })}
                        {...(labels?.pointsUnit === undefined ? {} : { pointsUnit: labels.pointsUnit })}
                      />
                    </DraggableCard>
                  ))}
                </DroppableCell>
                {columnFooter === undefined ? null : (
                  <div data-part="column-footer" className="px-2 pb-2">
                    {columnFooter(column)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <DragOverlay>
          {activeCard === null ? null : (
            <div className="w-72">
              <BoardCard
                card={activeCard}
                columnTone={columnById.get(moves.cellKeyOf(activeCard))?.tone ?? 'accent'}
                {...(locale === undefined ? {} : { locale })}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
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

