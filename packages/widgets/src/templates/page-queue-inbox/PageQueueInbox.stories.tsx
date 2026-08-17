// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-queue-inbox` template stories (M7 queues track): the Approvals Queue
 * flavor (KPI row, segment tabs with live counts, undo-first bulk
 * approve/reject over an in-memory QueueApi, reject-with-reason modal,
 * polymorphic amount cell), the Notifications Center feed flavor, and the
 * empty/error/loading/invalid states. Deterministic data — canned states.
 */
import { PageQueueInbox } from './PageQueueInbox.js';
import type { QueueApi } from './queue-api.js';

const meta = {
  title: 'Templates/PageQueueInbox',
};
export default meta;

const binding = {
  kind: 'table-query',
  connectionId: 'story-conn',
  source: { name: 'approvals', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 50,
};

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

const REQUESTS = [
  { id: 'r1', name: 'Team offsite budget', requester: 'ana@acme.dev', status: 'pending', amount: 4120, requested_at: '2026-06-15T08:00:00Z' },
  { id: 'r2', name: 'Parental leave', requester: 'li@acme.dev', status: 'pending', days: 5, requested_at: '2026-06-14T10:00:00Z' },
  { id: 'r3', name: 'New laptop', requester: 'sam@acme.dev', status: 'approved', amount: 2400, requested_at: '2026-06-12T09:00:00Z' },
  { id: 'r4', name: 'Conference travel', requester: 'jo@acme.dev', status: 'pending', amount: 1800, requested_at: '2026-06-13T15:00:00Z' },
  { id: 'r5', name: 'Software license', requester: 'kim@acme.dev', status: 'rejected', amount: 300, requested_at: '2026-06-11T09:30:00Z' },
];

const approvalsConfig = {
  templateVersion: 1,
  toolbar: ['segmented-control', 'filter-chip-bar'],
  overlays: ['modal-wizard', 'toast-stack'],
  archetype: { score: 0.85, reasons: ['pending/approved workflow enum (annex §14)'] },
  layout: {
    version: 1,
    items: [
      {
        i: 'kpi-row-1',
        widget: 'kpi-stat-card',
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        config: { title: 'Pending Approvals' },
      },
      {
        i: 'kpi-row-2',
        widget: 'kpi-stat-card',
        x: 3,
        y: 0,
        w: 3,
        h: 3,
        config: { title: 'New Approvals (30d)' },
      },
      {
        i: 'queue',
        widget: 'master-list',
        x: 0,
        y: 3,
        w: 8,
        h: 12,
        config: {
          title: 'Approvals',
          groupBy: 'status',
          enumTones: { pending: 'warn', approved: 'pos', rejected: 'danger' },
          binding,
        },
      },
      {
        i: 'detail',
        widget: 'detail-key-value',
        x: 8,
        y: 3,
        w: 4,
        h: 12,
        config: { title: 'Approval Detail', binding: { ...binding, shape: 'record', limit: 1 } },
      },
    ],
  },
};

function fakeApi(): QueueApi {
  let sequence = 0;
  return {
    bulkUpdate: async () => {
      sequence += 1;
      return { undoToken: `undo_${String(sequence)}` };
    },
    undo: async () => ({ restoredIds: [] }),
  };
}

/** Approvals Queue: bulk approve/reject with the undo-first toast flow. */
export const ApprovalsQueue = {
  render: () => (
    <div className="h-[640px]">
      <PageQueueInbox
        config={approvalsConfig}
        now={NOW}
        api={fakeApi()}
        states={{ queue: { status: 'success', data: { data: REQUESTS } } }}
      />
    </div>
  ),
};

/** Notifications Center: the feed flavor mounts through WidgetHost. */
const feedConfig = {
  ...approvalsConfig,
  layout: {
    version: 1,
    items: [
      {
        i: 'queue',
        widget: 'notification-feed',
        x: 0,
        y: 3,
        w: 12,
        h: 12,
        config: { title: 'Notifications', readColumn: 'read', binding },
      },
    ],
  },
};

export const NotificationsCenter = {
  render: () => (
    <div className="h-[560px]">
      <PageQueueInbox config={feedConfig} now={NOW} />
    </div>
  ),
};

/** First-use empty queue vs a failed queue query. */
export const EmptyAndError = {
  render: () => (
    <div className="flex h-[480px] flex-col gap-4">
      <PageQueueInbox config={approvalsConfig} states={{ queue: { status: 'success', data: [] } }} />
      <PageQueueInbox
        config={approvalsConfig}
        states={{ queue: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} } }}
      />
    </div>
  ),
};

/** Loading queue + the non-crashing invalid stored-config notice. */
export const LoadingAndInvalid = {
  render: () => (
    <div className="flex h-[480px] flex-col gap-4">
      <PageQueueInbox config={approvalsConfig} states={{ queue: { status: 'loading' } }} />
      <PageQueueInbox config={{ layout: { version: 99, items: 'nope' } }} />
    </div>
  ),
};
