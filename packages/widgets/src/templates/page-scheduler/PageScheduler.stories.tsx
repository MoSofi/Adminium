// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-scheduler` template stories (09 §7.6, M7-T03): the Shift Scheduler
 * comp (click-to-cycle matrix with coverage bars + week nav), the Team
 * Workload comp (capacity board with the week/month rescale), demo mode, and
 * the degradation states. Typed loosely — the 04-T17 QA harness wires
 * widgets stories into Storybook.
 */
import { PageScheduler } from './PageScheduler.js';

const meta = {
  title: 'Templates/PageScheduler',
};
export default meta;

const CONN = 'story-conn';
const TODAY = '2026-07-15';

const binding = (table: string) => ({
  kind: 'table-query',
  connectionId: CONN,
  source: { schema: 'public', name: table, type: 'table' },
  shape: 'record-list',
  limit: 500,
});

const matrixConfig = {
  templateVersion: 1,
  toolbar: ['date-range-picker', 'filter-chip-bar'],
  overlays: ['modal-wizard', 'toast-stack'],
  layout: {
    version: 1,
    items: [
      {
        i: 'sched-1',
        widget: 'schedule-matrix',
        x: 0,
        y: 3,
        w: 12,
        h: 14,
        config: {
          title: 'Shifts',
          personColumn: 'employee_id',
          dateColumn: 'shift_date',
          typeColumn: 'shift_type',
          binding: binding('shifts'),
        },
      },
    ],
  },
};

const PEOPLE = [
  ['emp-1', 'Ava Reyes'],
  ['emp-2', 'Grace Hopper'],
  ['emp-3', 'Alan Turing'],
  ['emp-4', 'Katherine Johnson'],
] as const;
const TYPES = ['morning', 'day', 'evening', 'night'] as const;

const SHIFT_ROWS = PEOPLE.flatMap(([id, name], personIndex) =>
  [13, 14, 15, 16, 17].flatMap((day, dayIndex) =>
    (personIndex + dayIndex) % 3 === 2
      ? []
      : [
          {
            id: `S-${id}-${day}`,
            employee_id: id,
            employee_name: name,
            shift_date: `2026-07-${day}`,
            shift_type: TYPES[(personIndex + dayIndex) % TYPES.length],
          },
        ],
  ),
);

const rows = (data: Record<string, unknown>[]) => ({
  status: 'success' as const,
  data: { rows: data, columns: [], total: data.length },
});

/** Shift Scheduler: click a chip to cycle its type (last type removes). */
export const ShiftScheduler = {
  render: () => (
    <PageScheduler
      config={matrixConfig}
      states={{ 'sched-1': rows(SHIFT_ROWS) }}
      referenceDate={TODAY}
      onParamsChange={(params) => console.log('[page-scheduler] window', params)}
      onEvent={(instanceId, event) => {
        console.log('[page-scheduler]', instanceId, event);
        return Promise.resolve({});
      }}
    />
  ),
};

/** Team Workload: per-member stacked utilization with week/month rescale. */
export const TeamWorkload = {
  render: () => (
    <PageScheduler
      config={{
        ...matrixConfig,
        layout: {
          version: 1,
          items: [
            {
              i: 'sched-1',
              widget: 'capacity-board',
              x: 0,
              y: 3,
              w: 12,
              h: 14,
              config: {
                title: 'Team workload',
                personColumn: 'member',
                projectColumn: 'project',
                hoursColumn: 'hours',
                binding: binding('time_entries'),
              },
            },
          ],
        },
      }}
      states={{
        'sched-1': rows([
          { id: 'T-1', member: 'ava', name: 'Ava Reyes', project: 'Platform', hours: 30 },
          { id: 'T-2', member: 'ava', name: 'Ava Reyes', project: 'Mobile app', hours: 16 },
          { id: 'T-3', member: 'grace', name: 'Grace Hopper', project: 'Platform', hours: 24 },
          { id: 'T-4', member: 'grace', name: 'Grace Hopper', project: 'Redesign', hours: 10 },
          { id: 'T-5', member: 'alan', name: 'Alan Turing', project: 'Data migration', hours: 18 },
        ]),
      }}
      referenceDate={TODAY}
    />
  ),
};

/** No host states: the matrix seeds from the family's deterministic demo data. */
export const DemoMode = {
  render: () => <PageScheduler config={matrixConfig} referenceDate={TODAY} />,
};

/** Loading matrix + failed query + invalid stored layout. */
export const DegradedStates = {
  render: () => (
    <div className="flex flex-col gap-8">
      <PageScheduler config={matrixConfig} referenceDate={TODAY} states={{ 'sched-1': { status: 'loading' } }} />
      <PageScheduler
        config={matrixConfig}
        referenceDate={TODAY}
        states={{ 'sched-1': { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} } }}
      />
      <PageScheduler config={{ templateVersion: 1, layout: [] }} />
    </div>
  ),
};
