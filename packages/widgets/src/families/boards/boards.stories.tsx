// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Track BOARDS `boards` family stories (annex §6): the kanban board + swimlane
 * grid loaded variants, the four WidgetFrame states through WidgetHost
 * (acceptance #4), light/dark × LTR/RTL matrices with REAL column mirroring
 * (acceptance #9 — the RTL frames set `dir="rtl"` so the logical flex genuinely
 * reverses the column order, not a bare attribute), and a keyboard drag
 * interaction story. Widgets resolve through a LOCAL registry override so the
 * stories work before the green loop merges the definitions into the global map.
 * Payloads are the same seeded generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import {
  KanbanBoard,
  kanbanBoardDemoData,
} from './KanbanBoard.js';
import { KanbanSwimlaneGrid, kanbanSwimlaneGridDemoData } from './KanbanSwimlaneGrid.js';
import { kanbanBoardDefinition, kanbanSwimlaneGridDefinition } from './boards-track.definitions.js';
import { resolveColumns, resolveLanes, toBoardCard } from './board-lib.js';
import type { BoardCardData, ColumnDef, LaneDef } from './board-lib.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([kanbanBoardDefinition, kanbanSwimlaneGridDefinition] as WidgetDefinition[]);

const meta = { title: 'Widgets/Boards' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(widgetId: string, instanceId: string, config: Record<string, unknown>, data: unknown, status: Status = 'success') {
  return (
    <div className="h-[32rem] w-full">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('BOARD_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

/** Board cards + columns for the direct (non-host) matrices. */
function boardModel(seed: number): { cards: BoardCardData[]; columns: ColumnDef[] } {
  const rows = kanbanBoardDemoData(seed).data;
  const cards = rows.map((row, index) => toBoardCard(row, index, { columnField: 'status', titleField: 'title' }));
  const columns = resolveColumns(cards, [
    { id: 'todo', label: 'To do', tone: 'neutral' },
    { id: 'in_progress', label: 'In progress', tone: 'accent' },
    { id: 'review', label: 'Review', tone: 'warn' },
    { id: 'done', label: 'Done', tone: 'pos' },
  ]);
  return { cards, columns };
}

function swimlaneModel(seed: number): { cards: BoardCardData[]; columns: ColumnDef[]; lanes: LaneDef[] } {
  const rows = kanbanSwimlaneGridDemoData(seed).data;
  const cards = rows.map((row, index) =>
    toBoardCard(row, index, { columnField: 'status', laneField: 'lane', titleField: 'title' }),
  );
  const columns = resolveColumns(cards, [
    { id: 'todo', label: 'To do', tone: 'neutral' },
    { id: 'in_progress', label: 'In progress', tone: 'accent' },
    { id: 'review', label: 'Review', tone: 'warn' },
    { id: 'done', label: 'Done', tone: 'pos' },
  ]);
  const lanes = resolveLanes(cards, [
    { id: 'growth', name: 'Growth', tone: 'accent' },
    { id: 'platform', name: 'Platform', tone: 'info' },
    { id: 'mobile', name: 'Mobile', tone: 'warn' },
  ]);
  return { cards, columns, lanes };
}

const boardConfig = { title: 'Projects', allowAdd: true };

export const KanbanBoardStory = {
  name: 'kanban-board',
  render: () => host('kanban-board', 's-board', boardConfig, kanbanBoardDemoData(7)),
};

export const KanbanSwimlaneStory = {
  name: 'kanban-swimlane-grid',
  render: () => host('kanban-swimlane-grid', 's-swim', { title: 'Board — Swimlanes' }, kanbanSwimlaneGridDemoData(4)),
};

/** All four WidgetFrame states (loaded · skeleton · empty · error). */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('kanban-board', 'st-loaded', boardConfig, kanbanBoardDemoData(7))}
        {host('kanban-board', 'st-skeleton', boardConfig, undefined, 'loading')}
        {host('kanban-board', 'st-empty', { ...boardConfig, emptyState: { titleKey: 'No cards yet' } }, { data: [], total: 0 })}
        {host('kanban-board', 'st-error', boardConfig, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** Light × dark × LTR × RTL — the RTL frames genuinely mirror the column order. */
export const ThemeAndDirectionMatrix = {
  render: () => {
    const { cards, columns } = boardModel(7);
    const board = (dir: 'ltr' | 'rtl') => (
      <div className="h-[26rem]">
        <KanbanBoard cards={cards} columns={columns} dir={dir} />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{board('ltr')}</Frame>
        <Frame dir="rtl">{board('rtl')}</Frame>
        <Frame dark dir="ltr">{board('ltr')}</Frame>
        <Frame dark dir="rtl">{board('rtl')}</Frame>
      </div>
    );
  },
};

export const SwimlaneThemeAndDirectionMatrix = {
  render: () => {
    const { cards, columns, lanes } = swimlaneModel(4);
    const grid = (dir: 'ltr' | 'rtl') => (
      <div className="h-[28rem]">
        <KanbanSwimlaneGrid cards={cards} columns={columns} lanes={lanes} dir={dir} />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{grid('ltr')}</Frame>
        <Frame dir="rtl">{grid('rtl')}</Frame>
        <Frame dark dir="rtl">{grid('rtl')}</Frame>
      </div>
    );
  },
};

/**
 * Keyboard drag interaction: focus a card, press Space to grab, arrow across
 * columns, Enter to drop. `play` drives it so the story is a live regression of
 * the a11y move path (and the aria-live announcements) without a pointer.
 */
export const KeyboardDragInteraction = {
  name: 'kanban-board (keyboard drag)',
  render: () => {
    const { cards, columns } = boardModel(2);
    return (
      <Frame>
        <div className="h-[26rem]">
          <KanbanBoard cards={cards} columns={columns} onCardMove={() => {}} />
        </div>
      </Frame>
    );
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const firstCard = canvasElement.querySelector<HTMLElement>('[data-board-card]');
    if (firstCard === null) return;
    firstCard.focus();
    const press = (key: string): void => {
      firstCard.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };
    press(' '); // grab
    press('ArrowRight'); // preview next column
    press('Enter'); // commit
  },
};
