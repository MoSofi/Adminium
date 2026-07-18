/**
 * `page-master-detail` template stories (M7 people/queues track): the Ticket
 * Queue flavor (enum-tone priority tints, live facet chips, derived micro-KPI
 * subtitle, filtered empty state), the Gantt domain-card detail pane, and the
 * loading/error/invalid states. Deterministic data — canned states only.
 */
import { PageMasterDetail } from './PageMasterDetail.js';

const meta = {
  title: 'Templates/PageMasterDetail',
};
export default meta;

const binding = {
  kind: 'table-query',
  connectionId: 'story-conn',
  source: { name: 'tickets', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 100,
};

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

const TICKETS = [
  { id: 't1', subject: 'Login loop on Safari', status: 'open', priority: 'high', requester: 'ana@acme.dev', updated_at: '2026-06-15T09:00:00Z' },
  { id: 't2', subject: 'CSV export truncates rows', status: 'open', priority: 'medium', requester: 'li@acme.dev', updated_at: '2026-06-14T16:20:00Z' },
  { id: 't3', subject: 'Billing address typo', status: 'pending', priority: 'low', requester: 'sam@acme.dev', updated_at: '2026-06-13T10:00:00Z' },
  { id: 't4', subject: 'Webhook retries exhausted', status: 'open', priority: 'high', requester: 'jo@acme.dev', updated_at: '2026-06-15T08:15:00Z' },
  { id: 't5', subject: 'Dark theme contrast', status: 'closed', priority: 'low', requester: 'kim@acme.dev', updated_at: '2026-06-10T11:45:00Z' },
];

const masterItem = {
  i: 'master',
  widget: 'master-list',
  x: 0,
  y: 0,
  w: 4,
  h: 14,
  config: {
    title: 'Tickets',
    groupBy: 'status',
    // Ticket Queue fix (M7-T04): tints flow from the stored tone map.
    enumTones: { high: 'danger', medium: 'warn', low: 'muted', open: 'info', pending: 'warn', closed: 'pos' },
    binding,
  },
};

const ticketConfig = {
  templateVersion: 1,
  toolbar: ['filter-chip-bar'],
  overlays: ['toast-stack'],
  archetype: { score: 0.8, reasons: ['enum-heavy table with rich detail (annex §14)'] },
  layout: {
    version: 1,
    items: [
      masterItem,
      {
        i: 'detail',
        widget: 'detail-key-value',
        x: 4,
        y: 0,
        w: 8,
        h: 14,
        config: { title: 'Ticket Detail', binding: { ...binding, shape: 'record', limit: 1 } },
      },
    ],
  },
};

/** Ticket Queue: facet chips, tone-mapped pills, selection-driven detail. */
export const TicketQueue = {
  render: () => (
    <div className="h-[560px]">
      <PageMasterDetail
        config={ticketConfig}
        now={NOW}
        states={{ master: { status: 'success', data: { data: TICKETS } } }}
      />
    </div>
  ),
};

/** Gantt flavor: the detail slot hosts a domain card over its own binding. */
const ganttConfig = {
  ...ticketConfig,
  layout: {
    version: 1,
    items: [
      masterItem,
      {
        i: 'detail',
        widget: 'gantt-chart',
        x: 4,
        y: 0,
        w: 8,
        h: 14,
        config: {
          title: 'Project Plan',
          startColumn: 'start_date',
          endColumn: 'end_date',
          progressColumn: 'progress',
          groupColumn: 'phase_id',
          binding,
        },
      },
    ],
  },
};

export const GanttDetail = {
  render: () => (
    <div className="h-[560px]">
      <PageMasterDetail
        config={ganttConfig}
        now={NOW}
        states={{ master: { status: 'success', data: { data: TICKETS } } }}
      />
    </div>
  ),
};

/** First-use empty rail vs a failed master query. */
export const EmptyAndError = {
  render: () => (
    <div className="flex h-[420px] flex-col gap-4">
      <PageMasterDetail config={ticketConfig} states={{ master: { status: 'success', data: [] } }} />
      <PageMasterDetail
        config={ticketConfig}
        states={{ master: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} } }}
      />
    </div>
  ),
};

/** Loading rail + the non-crashing invalid stored-config notice. */
export const LoadingAndInvalid = {
  render: () => (
    <div className="flex h-[420px] flex-col gap-4">
      <PageMasterDetail config={ticketConfig} states={{ master: { status: 'loading' } }} />
      <PageMasterDetail config={{ layout: { version: 99, items: 'nope' } }} />
    </div>
  ),
};
