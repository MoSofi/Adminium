import { EmptyState, MonoText } from '@adminium/ui';
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
import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

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
import { boardRowsOf, resolveColumns, resolveLanes, sumPoints, toBoardCard } from './board-lib.js';
import type { BoardCardData, ColumnDef, LaneDef } from './board-lib.js';
import type { KanbanSwimlaneGridConfig } from './boards-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `boards-config`
// module (acc #3 — keeps dnd-kit out of the registry metadata graph);
// re-exported here so the family barrel, stories, and tests keep one import
// point per widget.
export { kanbanSwimlaneGridConfigSchema, kanbanSwimlaneGridDemoData } from './boards-config.js';
export type { KanbanSwimlaneGridConfig };

/**
 * `kanban-swimlane-grid` (annex §6) — a lane × column matrix where each cell is
 * an independent drop target; dropping a card reassigns BOTH its lane and its
 * status. Binds to a `record-list` with two categorical fields (lane + status).
 * A committed move emits `onCardMove(cardId, {fromLane,fromColumn}, {toLane,
 * toColumn})`, fired by the binding as an optimistic two-field UPDATE (rolled
 * back on rejection). Keyboard: arrow-left/right change column, arrow-up/down
 * change lane, all logical under RTL.
 *
 * Ports Kanban Swimlanes.dc.html — closing the modal→grid wiring gap
 * (research/ia-mapping.md §5): a move mutates the grid in place.
 */

const DOT_TONE: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** Cell key = `lane   column`; the NUL separator never occurs in an id. */
const SEP = '\u0000';
export function encodeCell(laneId: string, columnId: string): string {
  return `${laneId}${SEP}${columnId}`;
}
export function decodeCell(cellKey: string): { laneId: string; columnId: string } {
  const at = cellKey.indexOf(SEP);
  return at === -1
    ? { laneId: '', columnId: cellKey }
    : { laneId: cellKey.slice(0, at), columnId: cellKey.slice(at + 1) };
}

export interface SwimlaneLabels {
  announcements?: Partial<BoardAnnouncements> | undefined;
  gripLabel?: string | undefined;
  pointsUnit?: string | undefined;
  /** Builds the "Σ{pts} pts · {count}" lane summary; localized at host. */
  laneSummary?: ((points: number, count: number) => string) | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
}

export interface KanbanSwimlaneGridProps {
  cards: readonly BoardCardData[];
  columns: readonly ColumnDef[];
  lanes: readonly LaneDef[];
  dir?: 'ltr' | 'rtl' | undefined;
  locale?: string | undefined;
  labels?: SwimlaneLabels | undefined;
  onCardMove?:
    | ((
        cardId: string,
        from: { lane: string; column: string },
        to: { lane: string; column: string },
      ) => MoveResult)
    | undefined;
  onCardOpen?: ((cardId: string) => void) | undefined;
  testId?: string | undefined;
}

export function KanbanSwimlaneGrid({
  cards,
  columns,
  lanes,
  dir = 'ltr',
  locale,
  labels,
  onCardMove,
  onCardOpen,
  testId,
}: KanbanSwimlaneGridProps) {
  const t = useMaybeT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { message, announce } = useLiveRegion();
  const announcements: BoardAnnouncements = useBoardAnnouncements(labels?.announcements);
  const summary =
    labels?.laneSummary ??
    ((points: number, count: number) => t('ui:widgets.boards.laneSummary', 'Σ{points} pts · {count}', { points, count }));

  const columnById = new Map(columns.map((column) => [column.id, column]));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const cellLabel = (cellKey: string): string => {
    const { laneId, columnId } = decodeCell(cellKey);
    const lane = laneById.get(laneId)?.name ?? laneId;
    const column = columnById.get(columnId)?.label ?? columnId;
    return `${lane} · ${column}`;
  };

  const moves = useBoardMoves({
    cards,
    naturalCellKey: (card) => encodeCell(card.lane ?? '', card.column),
    cellLabel,
    onCommit: (cardId, from, to) => {
      const a = decodeCell(from);
      const b = decodeCell(to);
      return onCardMove?.(cardId, { lane: a.laneId, column: a.columnId }, { lane: b.laneId, column: b.columnId });
    },
    announce,
    announcements,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const activeCard = activeId === null ? null : cards.find((card) => card.id === activeId) ?? null;

  if (columns.length === 0 || lanes.length === 0) {
    return (
      <EmptyState
        preset="no-data"
        title={labels?.emptyTitle ?? t('ui:widgets.boards.kanbanSwimlaneGrid.emptyTitle', 'No swimlanes to show')}
        body={
          labels?.emptyBody ??
          t('ui:widgets.boards.kanbanSwimlaneGrid.emptyBody', 'Group records by a lane field and a status field to build the grid.')
        }
      />
    );
  }

  const onDragStart = (event: DragStartEvent): void => setActiveId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent): void => {
    setActiveId(null);
    if (event.over === null) return;
    moves.requestMove(String(event.active.id), String(event.over.id));
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
    const { laneId, columnId } = decodeCell(moves.grabTargetKey ?? moves.cellKeyOf(card));
    const colIndex = columns.findIndex((column) => column.id === columnId);
    const laneIndex = lanes.findIndex((lane) => lane.id === laneId);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const logical = (event.key === 'ArrowRight' ? 1 : -1) * (dir === 'rtl' ? -1 : 1);
      const next = Math.min(Math.max(colIndex + logical, 0), columns.length - 1);
      moves.previewTo(encodeCell(laneId, columns[next]!.id));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // Vertical (lane) axis is never mirrored under RTL.
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(Math.max(laneIndex + delta, 0), lanes.length - 1);
      moves.previewTo(encodeCell(lanes[next]!.id, columnId));
    }
  };

  const renderCard = (card: BoardCardData): ReactNode => (
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
        columnTone={columnById.get(card.column)?.tone ?? 'accent'}
        {...(locale === undefined ? {} : { locale })}
        {...(labels?.gripLabel === undefined ? {} : { gripLabel: labels.gripLabel })}
        {...(labels?.pointsUnit === undefined ? {} : { pointsUnit: labels.pointsUnit })}
      />
    </DraggableCard>
  );

  return (
    <div dir={dir} data-widget="kanban-swimlane-grid" data-testid={testId} className="flex h-full flex-col overflow-auto">
      <BoardLiveRegion message={message} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements: silentDndAnnouncements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex min-w-max flex-col gap-3 p-3">
          {/* Column header row (mirrors under RTL via logical flex order). The
              `px-2` matches each lane <section>'s p-2 inline padding so every
              header column lines up with the DroppableCell beneath it. */}
          <div className="flex items-center gap-3 px-2" data-part="column-header-row">
            {columns.map((column) => (
              <div key={column.id} className="flex w-64 shrink-0 items-center gap-2">
                <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT_TONE[column.tone]}`} />
                <span className="text-body-sm font-semibold text-fg">{column.label}</span>
              </div>
            ))}
          </div>

          {lanes.map((lane) => {
            const laneCards = cards.filter((card) => decodeCell(moves.cellKeyOf(card)).laneId === lane.id);
            return (
              <section key={lane.id} data-board-lane={lane.id} className="flex flex-col gap-2 rounded-xl bg-surface-2/50 p-2">
                <header className="flex items-center gap-2 px-1">
                  <span aria-hidden="true" className={`size-2 rounded-full ${DOT_TONE[lane.tone]}`} />
                  <span className="text-body-sm font-semibold text-fg">{lane.name}</span>
                  <MonoText className="ms-auto text-caption text-fg-muted">
                    {summary(sumPoints(laneCards), laneCards.length)}
                  </MonoText>
                </header>
                <div className="flex items-stretch gap-3">
                  {columns.map((column) => {
                    const cellKey = encodeCell(lane.id, column.id);
                    const cellCards = cards.filter((card) => moves.cellKeyOf(card) === cellKey);
                    return (
                      <DroppableCell
                        key={column.id}
                        id={cellKey}
                        testId={`cell-drop-${lane.id}-${column.id}`}
                        highlight={moves.grabTargetKey === cellKey}
                        className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-surface-1/40 p-1.5"
                      >
                        {cellCards.map((card) => renderCard(card))}
                      </DroppableCell>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <DragOverlay>
          {activeCard === null ? null : (
            <div className="w-64">
              <BoardCard
                card={activeCard}
                columnTone={columnById.get(activeCard.column)?.tone ?? 'accent'}
                {...(locale === undefined ? {} : { locale })}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function sourceOf(config: KanbanSwimlaneGridConfig): { connectionId?: string | undefined; table: string } {
  const binding = config.binding as { connectionId?: string; source?: { table?: string } } | undefined;
  return { connectionId: binding?.connectionId, table: binding?.source?.table ?? 'records' };
}

export function KanbanSwimlaneGridWidget({ config, data, onEvent }: WidgetProps<KanbanSwimlaneGridConfig>) {
  const rows = boardRowsOf(data);
  const cards = rows.map((row, index) =>
    toBoardCard(row, index, {
      columnField: config.columnField,
      laneField: config.laneField,
      titleField: config.titleField,
    }),
  );
  const columns = resolveColumns(cards, config.columnDefs);
  const lanes = resolveLanes(cards, config.laneDefs);
  const source = sourceOf(config);
  const labels: SwimlaneLabels = {
    ...(config.pointsUnit === undefined ? {} : { pointsUnit: config.pointsUnit }),
    ...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle, emptyBody: config.emptyBody }),
    ...(config.announcements === undefined
      ? {}
      : { announcements: announcementsFromTemplates(config.announcements) }),
  };
  return (
    <KanbanSwimlaneGrid
      cards={cards}
      columns={columns}
      lanes={lanes}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      labels={labels}
      // Return the host's result so a rejected `mutate` promise rolls the
      // optimistic move back and announces the failure (annex §6 a11y).
      onCardMove={(cardId, _from, to) =>
        onEvent({
          type: 'mutate',
          intent: 'update',
          connectionId: source.connectionId,
          table: source.table,
          recordId: cardId,
          values: { [config.laneField]: to.lane, [config.columnField]: to.column },
        })
      }
      onCardOpen={(cardId) => {
        onEvent({ type: 'record-open', connectionId: source.connectionId, table: source.table, recordId: cardId });
      }}
    />
  );
}

