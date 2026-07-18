/**
 * `page-calendar` template stories (09 §7.6): the Calendar Scheduler comp
 * (month + agenda + composer), the Release Calendar comp (legend + upcoming
 * + range toolbar), a demo-mode render, and the degradation states. Typed
 * loosely — the 04-T17 QA harness wires widgets stories into Storybook.
 */
import { PageCalendar } from './PageCalendar.js';

const meta = {
  title: 'Templates/PageCalendar',
};
export default meta;

const CONN = 'story-conn';
const TODAY = '2026-07-15';

const binding = {
  kind: 'table-query',
  connectionId: CONN,
  source: { schema: 'public', name: 'releases', type: 'table' },
  shape: 'calendar-events',
  limit: 500,
};

const calConfig = {
  title: 'Releases',
  startColumn: 'released_at',
  titleColumn: 'title',
  binding,
};

const RELEASE_ROWS = [
  { id: 'R-1', title: 'Billing service', released_at: '2026-07-15T10:00:00Z', category: 'release', owner: 'Ava Reyes', status: 'Scheduled' },
  { id: 'R-2', title: 'Sprint planning', released_at: '2026-07-15T09:00:00Z', category: 'meeting' },
  { id: 'R-3', title: 'Search reindex', released_at: '2026-07-16T22:00:00Z', category: 'maintenance', owner: 'Alan Turing', status: 'Scheduled' },
  { id: 'R-4', title: 'SSO rollout', released_at: '2026-07-21T15:00:00Z', category: 'release', owner: 'Grace Hopper', status: 'At risk' },
  { id: 'R-5', title: 'Contract deadline', released_at: '2026-07-24', category: 'deadline' },
  { id: 'R-6', title: 'Data retention sweep', released_at: '2026-07-28T02:00:00Z', category: 'maintenance' },
];

const rows = (data: Record<string, unknown>[]) => ({
  status: 'success' as const,
  data: { rows: data, columns: [], total: data.length },
});

const item = (i: string, widget: string, area: [number, number, number, number], config: Record<string, unknown>) => ({
  i,
  widget,
  x: area[0],
  y: area[1],
  w: area[2],
  h: area[3],
  config,
});

const schedulerConfig = {
  templateVersion: 1,
  toolbar: ['date-range-picker', 'filter-chip-bar'],
  overlays: ['modal-wizard', 'toast-stack'],
  layout: {
    version: 1,
    items: [
      item('cal-1', 'calendar-month', [0, 3, 8, 12], calConfig),
      item('agenda-1', 'day-agenda', [8, 3, 4, 12], { ...calConfig, title: 'Agenda' }),
    ],
  },
};

const releaseConfig = {
  ...schedulerConfig,
  layout: {
    version: 1,
    items: [
      ...schedulerConfig.layout.items,
      item('legend-1', 'calendar-legend-filter', [8, 15, 4, 4], {}),
      item('up-1', 'upcoming-events-list', [0, 15, 8, 6], {}),
    ],
  },
};

/** Calendar Scheduler: month grid + selected-day agenda with inline composer. */
export const CalendarScheduler = {
  render: () => (
    <PageCalendar
      config={schedulerConfig}
      states={{ 'cal-1': rows(RELEASE_ROWS), 'agenda-1': rows(RELEASE_ROWS) }}
      referenceDate={TODAY}
      onEvent={(instanceId, event) => {
        console.log('[page-calendar]', instanceId, event);
        return Promise.resolve({});
      }}
    />
  ),
};

/** Release Calendar: legend filters + upcoming feed + range toolbar. */
export const ReleaseCalendar = {
  render: () => (
    <PageCalendar
      config={releaseConfig}
      states={{ 'cal-1': rows(RELEASE_ROWS) }}
      referenceDate={TODAY}
      onParamsChange={(params) => console.log('[page-calendar] params', params)}
      onEvent={() => Promise.resolve({})}
    />
  ),
};

/** No host states: every pane seeds from deterministic demo data (04 §5.3). */
export const DemoMode = {
  render: () => <PageCalendar config={schedulerConfig} referenceDate={TODAY} />,
};

/** Loading calendar + failed query + invalid stored layout. */
export const DegradedStates = {
  render: () => (
    <div className="flex flex-col gap-8">
      <PageCalendar config={schedulerConfig} referenceDate={TODAY} states={{ 'cal-1': { status: 'loading' } }} />
      <PageCalendar
        config={schedulerConfig}
        referenceDate={TODAY}
        states={{ 'cal-1': { status: 'error', error: new Error('COLUMN_FORBIDDEN'), refetch: () => {} } }}
      />
      <PageCalendar config={{ templateVersion: 1, layout: 'nope' }} />
    </div>
  ),
};
