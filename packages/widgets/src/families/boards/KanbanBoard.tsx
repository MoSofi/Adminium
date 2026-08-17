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
import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { BoardCard } from './BoardCard.js';
import { useMaybeT } from '@adminium/i18n/react';

import {
  BoardLiveRegion,
  DraggableCard,
  DroppableCell,
  announcementsFromTemplates,
  silentDndAnnouncements,
  useBoardAnnouncements,
  useBoardMoves,
  useLiveRegion,
} from './board-dnd.js';
import type { BoardAnnouncements, MoveResult } from './board-dnd.js';
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
 * `kanban-board` (annex §6) — fixed status columns of draggable cards. Columns
 * derive from a workflow-enum field; a card dropped in another column emits an
 * `onCardMove(cardId, fromColumn, toColumn)` the binding fires as an optimistic
 * UPDATE mutation (rolled back if the mutation promise rejects). Pointer drag
 * uses dnd-kit; keyboard uses a logical grab → arrow-move → Enter-commit /
 * Escape-cancel model that mirrors correctly under `dir="rtl"`. Binds to a flat
 * `record-list` grouped by the status field.
 *
 * Ports Project Board.dc.html, Kanban Roadmap.dc.html — closing the
 * "modal not wired to grid" gap (research/ia-mapping.md §5): a committed move
 * updates the board state in place rather than only firing a detached modal.
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
  onAdd?: ((columnId: string) => void) | undefined;
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
  testId,
}: KanbanBoardProps) {
  const t = useMaybeT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { message, announce } = useLiveRegion();
  const announcements: BoardAnnouncements = useBoardAnnouncements(labels?.announcements);

  const columnById = new Map(columns.map((column) => [column.id, column]));
  const labelOf = (columnId: string): string => columnById.get(columnId)?.label ?? columnId;

  const moves = useBoardMoves({
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

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, card: BoardCardData): void => {
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
    <div dir={dir} data-widget="kanban-board" data-testid={testId} className="flex h-full flex-col">
      <BoardLiveRegion message={message} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements: silentDndAnnouncements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex h-full min-h-0 flex-1 items-stretch gap-3 overflow-x-auto p-3">
          {columns.map((column) => {
            const columnCards = cards.filter((card) => moves.cellKeyOf(card) === column.id);
            const overWip = column.wip !== undefined && columnCards.length > column.wip;
            return (
              <section
                key={column.id}
                data-board-column={column.id}
                className="flex w-72 shrink-0 flex-col rounded-xl bg-surface-2/60"
              >
                <header className="flex items-center gap-2 px-3 py-2.5">
                  <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT_TONE[column.tone]}`} />
                  <span className="text-body-sm font-semibold text-fg">{column.label}</span>
                  <span
                    data-part="column-count"
                    className={
                      'ms-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-mono text-[10.5px] font-bold tabular-nums ' +
                      (overWip ? 'bg-danger text-danger-fg' : 'bg-surface-3 text-fg-muted')
                    }
                  >
                    {column.wip === undefined ? columnCards.length : `${columnCards.length}/${column.wip}`}
                  </span>
                  {allowAdd && (
                    <button
                      type="button"
                      data-part="column-add"
                      onClick={() => onAdd?.(column.id)}
                      aria-label={labels?.addLabel ?? t('ui:widgets.boards.addCard', 'Add card')}
                      className="ms-auto flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
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
  const rows = boardRowsOf(data);
  const cards = rows.map((row, index) =>
    toBoardCard(row, index, { columnField: config.columnField, titleField: config.titleField }),
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
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      labels={labels}
      // Return the host's result so a rejected `mutate` promise rolls the
      // optimistic move back and announces the failure (annex §6 a11y).
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
      onAdd={(columnId) => {
        onEvent({
          type: 'mutate',
          intent: 'insert',
          connectionId: source.connectionId,
          table: source.table,
          values: { [config.columnField]: columnId },
        });
      }}
    />
  );
}

