// SPDX-License-Identifier: AGPL-3.0-only
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
  useAnnounceAddRefusal,
  useBoardMoves,
  useLiveRegion,
} from './board-dnd.js';
import type { BoardAddRefusal, BoardAnnouncements, MoveResult } from './board-dnd.js';
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
 * `kanban-swimlane-grid` (annex) — a lane × column matrix where each cell is an
 * independent drop target; dropping a card reassigns BOTH its lane and its
 * status. Binds to a `record-list` with two categorical fields (lane + status).
 * A committed move emits `onCardMove(cardId, {fromLane,fromColumn}, {toLane,
 * toColumn})`, fired by the binding as an optimistic two-field UPDATE (rolled
 * back on rejection). Keyboard: arrow-left/right change column, arrow-up/down
 * change lane, all logical under RTL.
 *
 * Ports Kanban Swimlanes.dc.html — closing the modal→grid wiring
 * gap: a move mutates the grid in place.
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
  /** An add made for this board and refused (a composer beside it): shown where a refused move is, and said aloud. */
  addRefusal?: BoardAddRefusal | null | undefined;
  onDismissAddRefusal?: (() => void) | undefined;
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
  addRefusal,
  onDismissAddRefusal,
  testId,
}: KanbanSwimlaneGridProps) {
  const t = useMaybeT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { message, announce } = useLiveRegion();
  useAnnounceAddRefusal(addRefusal, announce);
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

  // The grid's own element, and its scroller: a keyboard move is followed inside it.
  const root = useRef<HTMLDivElement>(null);
  const moves = useBoardMoves({
    root,
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
      className="cursor-grab rounded-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onKeyDown={(event) => onCardKeyDown(event, card)}
      {...(onCardOpen === undefined ? {} : { onClick: () => onCardOpen(card.id) })}
    >
      <BoardCard
        card={card}
        compact
        columnTone={columnById.get(card.column)?.tone ?? 'accent'}
        {...(locale === undefined ? {} : { locale })}
        {...(labels?.gripLabel === undefined ? {} : { gripLabel: labels.gripLabel })}
        {...(labels?.pointsUnit === undefined ? {} : { pointsUnit: labels.pointsUnit })}
      />
    </DraggableCard>
  );

  return (
    <div ref={root} dir={dir} data-widget="kanban-swimlane-grid" data-board-scroller="" data-testid={testId} className="flex h-full flex-col overflow-auto">
      <BoardLiveRegion message={message} />
      <BoardRefusalNotice refusal={moves.refusal} onDismiss={moves.dismissRefusal} />
      <BoardAddRefusalNotice refusal={addRefusal} onDismiss={() => onDismissAddRefusal?.()} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements: silentDndAnnouncements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* The Kanban Swimlanes comp: a column of lane names, then a cell per status; the headers stay in view. */}
        <div className="flex min-w-[900px] flex-col leading-[normal]">
          <div className="sticky top-0 z-[5] flex gap-3.5 bg-bg pb-3" data-part="column-header-row">
            <div className="w-[150px] shrink-0" />
            {columns.map((column) => (
              <div key={column.id} className="flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5">
                <span aria-hidden="true" className={`size-[9px] shrink-0 rounded-full ${DOT_TONE[column.tone]}`} />
                <span className="truncate text-[12.5px] font-extrabold tracking-[-0.01em] text-fg">{column.label}</span>
                <span className="shrink-0 rounded-full bg-surface-3 px-2 py-px font-mono text-[10.5px] font-semibold tabular-nums text-fg-subtle">
                  {cards.filter((card) => decodeCell(moves.cellKeyOf(card)).columnId === column.id).length}
                </span>
              </div>
            ))}
          </div>

          {lanes.map((lane) => {
            const laneCards = cards.filter((card) => decodeCell(moves.cellKeyOf(card)).laneId === lane.id);
            const points = sumPoints(laneCards);
            return (
              <section key={lane.id} data-board-lane={lane.id} className="flex items-stretch gap-3.5 border-t border-border py-3.5">
                <header className="flex w-[150px] shrink-0 flex-col gap-2 px-1 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-[3px] ${DOT_TONE[lane.tone]}`} />
                    <h3 className="m-0 min-w-0 truncate text-[13px] font-extrabold tracking-[-0.01em] text-fg" title={lane.name}>
                      {lane.name === '' ? t('ui:widgets.boards.noLane', 'None') : lane.name}
                    </h3>
                  </div>
                  <MonoText className="text-[11px] text-fg-subtle">
                    {points > 0 ? summary(points, laneCards.length) : t('ui:widgets.boards.laneCount', '{count, plural, one {# card} other {# cards}}', { count: laneCards.length })}
                  </MonoText>
                </header>
                {columns.map((column) => {
                  const cellKey = encodeCell(lane.id, column.id);
                  const cellCards = cards.filter((card) => moves.cellKeyOf(card) === cellKey);
                  return (
                    <DroppableCell
                      key={column.id}
                      id={cellKey}
                      testId={`cell-drop-${lane.id}-${column.id}`}
                      highlight={moves.grabTargetKey === cellKey}
                      className="flex min-h-[90px] min-w-0 flex-1 flex-col gap-2.5 rounded-[12px] border border-border bg-surface-2 p-2 transition-colors duration-100"
                      activeClassName="border-dashed border-accent bg-accent-soft outline outline-[0.5px] outline-accent"
                    >
                      {cellCards.length === 0 ? (
                        <div aria-hidden="true" className="flex min-h-10 flex-1 items-center justify-center text-[11px] text-fg-subtle">
                          —
                        </div>
                      ) : (
                        cellCards.map((card) => renderCard(card))
                      )}
                    </DroppableCell>
                  );
                })}
              </section>
            );
          })}
        </div>
        <DragOverlay>
          {activeCard === null ? null : (
            <div className="w-64">
              <BoardCard
                card={activeCard}
                compact
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
  // One array for one answer: the board lets go of a saved move when NEW cards arrive, and tells by the array.
  const cards = useMemo(
    () =>
      boardRowsOf(data).map((row, index) =>
        toBoardCard(row, index, {
          columnField: config.columnField,
          laneField: config.laneField,
          titleField: config.titleField,
        }),
      ),
    [data, config.columnField, config.laneField, config.titleField],
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
      {...(config.format?.locale === undefined || config.format.locale.trim() === '' ? {} : { locale: config.format.locale })}
      labels={labels}
      // Return the host's result so a rejected `mutate` promise rolls the
      // optimistic move back and announces the failure (annex a11y).
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

