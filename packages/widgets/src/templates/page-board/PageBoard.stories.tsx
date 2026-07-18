/**
 * `page-board` template stories (09 §7.5): the stored-config kanban over a
 * canned record-list (Project Board), the swimlane variant (Kanban
 * Swimlanes), the quarter-bucketed roadmap (Kanban Roadmap), and the
 * loading/error/invalid degradation states. Typed loosely — the 04-T17 QA
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
