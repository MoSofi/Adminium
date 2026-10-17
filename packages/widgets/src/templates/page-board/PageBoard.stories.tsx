// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-board` template stories: the stored-config kanban over a canned
 * record-list (Project Board), the swimlane variant (Kanban Swimlanes),
 * the quarter-bucketed roadmap (Kanban Roadmap), and the
 * loading/error/invalid degradation states. Typed loosely — the QA
 * harness wires widgets stories into the workspace Storybook.
 */
import { PageBoard } from './PageBoard.js';

const meta = {
  title: 'Templates/PageBoard',
};
export default meta;

const CONN = 'story-conn';
const binding = (table: string) => ({
  kind: 'table-query',
  connectionId: CONN,
  source: { schema: 'public', name: table, type: 'table' },
  shape: 'record-list',
  limit: 200,
});

const TASK_ROWS = [
  { id: 'PRJ-101', title: 'Billing webhook retries', status: 'todo', priority: 'High', owner: 'Ava Reyes', pct: 0, due: '7/18' },
  { id: 'PRJ-102', title: 'Onboarding checklist v2', status: 'todo', priority: 'Medium', owner: 'Grace Hopper', pct: 10, due: '7/21' },
  { id: 'PRJ-103', title: 'SSO for enterprise tier', status: 'in_progress', priority: 'High', owner: 'Alan Turing', pct: 45, due: '7/24' },
  { id: 'PRJ-104', title: 'Export to CSV', status: 'in_progress', priority: 'Low', owner: 'Ava Reyes', pct: 65, due: '7/22' },
  { id: 'PRJ-105', title: 'Audit log filters', status: 'review', priority: 'Medium', owner: 'Katherine Johnson', pct: 90, due: '7/17' },
  { id: 'PRJ-106', title: 'Dark mode polish', status: 'done', priority: 'Low', owner: 'Edsger Dijkstra', pct: 100, due: '7/12' },
];

const boardConfig = {
  templateVersion: 1,
  toolbar: ['filter-chip-bar'],
  overlays: ['modal-wizard', 'toast-stack'],
  layout: {
    version: 1,
    items: [
      {
        i: 'board-1',
        widget: 'kanban-board',
        x: 0,
        y: 0,
        w: 12,
        h: 16,
        config: {
          title: 'Tasks',
          statusColumn: 'status',
          titleColumn: 'title',
          progressColumn: 'pct',
          columns: ['todo', 'in_progress', 'review', 'done'],
          allowAdd: true,
          binding: binding('tasks'),
        },
      },
      {
        i: 'compose-1',
        widget: 'inline-compose-card',
        x: 0,
        y: 16,
        w: 4,
        h: 4,
        config: { defaults: { priority: 'Medium' } },
      },
    ],
  },
};

const rows = (data: Record<string, unknown>[]) => ({
  status: 'success' as const,
  data: { rows: data, columns: [], total: data.length },
});

/** Project Board: enum-ordered columns, optimistic drag, quick-add composer. */
export const ProjectBoard = {
  render: () => (
    <PageBoard
      config={boardConfig}
      states={{ 'board-1': rows(TASK_ROWS) }}
      onEvent={(instanceId, event) => {
        console.log('[page-board]', instanceId, event);
        return Promise.resolve({});
      }}
    />
  ),
};

/** Kanban Swimlanes: lane × status matrix, atomic two-field move writes. */
export const Swimlanes = {
  render: () => (
    <PageBoard
      config={{
        ...boardConfig,
        layout: {
          version: 1,
          items: [
            {
              i: 'board-1',
              widget: 'kanban-swimlane-grid',
              x: 0,
              y: 0,
              w: 12,
              h: 16,
              config: {
                title: 'Tasks by team',
                statusColumn: 'status',
                laneColumn: 'team',
                titleColumn: 'title',
                columns: ['todo', 'in_progress', 'review', 'done'],
                binding: binding('tasks'),
              },
            },
          ],
        },
      }}
      states={{
        'board-1': rows(
          TASK_ROWS.map((row, index) => ({ ...row, team: ['growth', 'platform', 'mobile'][index % 3] })),
        ),
      }}
      onEvent={() => Promise.resolve({})}
    />
  ),
};

/** Kanban Roadmap: quarter buckets from a date column; drops reschedule. */
export const Roadmap = {
  render: () => (
    <PageBoard
      config={{
        ...boardConfig,
        layout: {
          version: 1,
          items: [
            {
              i: 'board-1',
              widget: 'kanban-board',
              x: 0,
              y: 0,
              w: 12,
              h: 16,
              config: {
                title: 'Roadmap',
                statusColumn: 'status',
                titleColumn: 'title',
                bucketBy: 'quarter',
                dateColumn: 'target_date',
                binding: binding('initiatives'),
              },
            },
          ],
        },
      }}
      states={{
        'board-1': rows([
          { id: 'IN-1', title: 'Realtime presence', status: 'todo', target_date: '2026-07-20' },
          { id: 'IN-2', title: 'Rate-limit dashboard', status: 'todo', target_date: '2026-08-30' },
          { id: 'IN-3', title: 'Schema diff viewer', status: 'todo', target_date: '2026-10-15' },
          { id: 'IN-4', title: 'Invite teammates flow', status: 'todo', target_date: '2027-01-08' },
        ]),
      }}
      onEvent={() => Promise.resolve({})}
    />
  ),
};

/** Loading board + invalid stored layout, the never-crash degradations. */
export const DegradedStates = {
  render: () => (
    <div className="flex flex-col gap-8">
      <PageBoard config={boardConfig} states={{ 'board-1': { status: 'loading' } }} />
      <PageBoard
        config={boardConfig}
        states={{ 'board-1': { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} } }}
      />
      <PageBoard config={{ templateVersion: 1, layout: { version: 99, items: 'nope' } }} />
    </div>
  ),
};

/** Rows arrived and none has a status yet: the board says so. */
export const StatuslessRows = {
  tags: ['vrt'],
  render: () => (
    <PageBoard
      config={boardConfig}
      states={{ 'board-1': rows(TASK_ROWS.map((row) => ({ ...row, status: null }))) }}
      onEvent={() => Promise.resolve({})}
    />
  ),
};

/**
 * A board whose table has no rows yet — a freshly installed app's. It says
 * there are no cards, not that the table lacks a status field it has.
 */
export const NoRowsYet = {
  tags: ['vrt'],
  render: () => (
    <PageBoard
      config={{
        ...boardConfig,
        layout: {
          ...boardConfig.layout,
          items: boardConfig.layout.items.map((entry) =>
            entry.widget === 'kanban-board'
              ? { ...entry, widget: 'kanban-swimlane-grid', config: { ...entry.config, laneColumn: 'owner' } }
              : entry,
          ),
        },
      }}
      states={{ 'board-1': rows([]) }}
      onEvent={() => Promise.resolve({})}
    />
  ),
};

/**
 * A pipeline whose columns are the rows of a stages table (an app's
 * `config.board.columnsFrom`): seven stages, so the board scrolls sideways
 * inside itself; an empty stage is a column too; each header carries the
 * count and the total the server worked out, which is more than the cards
 * listed. Dropping "Loft desks" is refused, and the board says why.
 */
export const ColumnsFromTable = {
  render: () => (
    <PageBoard
      config={{
        templateVersion: 1,
        toolbar: [],
        overlays: [],
        layout: {
          version: 1,
          items: [
            {
              i: 'board-1',
              widget: 'kanban-board',
              x: 0,
              y: 0,
              w: 12,
              h: 16,
              config: {
                title: 'Deals',
                statusColumn: 'stage_id',
                titleColumn: 'name',
                columnsFrom: { table: 'public.stages', key: 'id', label: 'name', order: 'position' },
                totals: [{ column: 'amount', fn: 'sum' }],
                binding: binding('deals'),
              },
            },
          ],
        },
      }}
      states={{
        'board-1': rows([
          { id: 1, name: 'Atrium fit-out', stage_id: 1, client: 'Nordwind', budget: '€52,800', owner: 'Dana Whitlock' },
          { id: 2, name: 'Loft desks', stage_id: 1, client: 'Harbour Hotels', budget: '€8,400', owner: 'Omar Haddad' },
          { id: 3, name: 'Clinic reception', stage_id: 2, client: 'Northfield Dental', budget: '€19,250', owner: 'Dana Whitlock' },
          { id: 4, name: 'Showroom lighting', stage_id: 4, client: 'Lumen', budget: '€31,000', owner: 'Lena Brandt' },
          { id: 5, name: 'Head office refit', stage_id: 6, client: 'Kestrel', budget: '€140,000', owner: 'Sam Okoye' },
        ]),
      }}
      boardColumns={{
        status: 'success',
        columns: [
          { id: '1', value: 1, label: 'New lead', count: 212, total: '€1,204,300' },
          { id: '2', value: 2, label: 'Qualified', count: 48, total: '€612,950' },
          { id: '3', value: 3, label: 'Site visit', count: 0, total: '€0' },
          { id: '4', value: 4, label: 'Proposal sent', count: 17, total: '€388,000' },
          { id: '5', value: 5, label: 'Negotiation', count: 0, total: '€0' },
          { id: '6', value: 6, label: 'Contract out', count: 3, total: '€221,500' },
          { id: '7', value: 7, label: 'Won', count: 0, total: '€0' },
        ],
      }}
      onEvent={(_instanceId, event) =>
        event.type === 'mutate' && event.recordId === '2'
          ? Promise.reject(new Error('You can change this deal only while its state is Open.'))
          : Promise.resolve({})
      }
    />
  ),
};
