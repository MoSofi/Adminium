// @vitest-environment happy-dom
/**
 * `page-queue-inbox` template tests (M7 queues track, 09 §7.4 + §4.1):
 * KPI slots mount through WidgetHost, segment tabs default to the pending
 * tab with live counts, the polymorphic amount cell renders $ / days / —,
 * bulk approve applies optimistically to the EXACT selected id set with an
 * Undo toast that restores it, a failed bulk decision rolls the optimistic
 * patch back, reject opens the with-reason modal and writes the note column,
 * a drained tab renders all-caught-up (distinct from first-use), the
 * notification-feed flavor mounts through WidgetHost, and bad configs never
 * crash.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageQueueInbox, decisionValuesOf } from './PageQueueInbox.js';
import type { QueueApi } from './queue-api.js';

const binding = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { name: 'approvals', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 50,
};

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

const REQUESTS = [
  { id: 'r1', name: 'Team offsite budget', requester: 'ana@acme.dev', status: 'pending', amount: 4120, requested_at: '2026-06-15T08:00:00Z' },
  { id: 'r2', name: 'Parental leave', requester: 'li@acme.dev', status: 'pending', days: 5, requested_at: '2026-06-14T10:00:00Z' },
  { id: 'r3', name: 'New laptop', requester: 'sam@acme.dev', status: 'approved', amount: 2400, requested_at: '2026-06-12T09:00:00Z' },
  { id: 'r4', name: 'Missing amounts', requester: 'jo@acme.dev', status: 'pending', requested_at: '2026-06-13T15:00:00Z' },
];

function config(queue?: { widget: string; config: Record<string, unknown> }) {
  return {
    templateVersion: 1,
    toolbar: ['segmented-control', 'filter-chip-bar'],
    overlays: ['modal-wizard', 'toast-stack'],
    layout: {
      version: 1,
      items: [
        { i: 'kpi-row-1', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { title: 'Pending Approvals' } },
        { i: 'kpi-row-2', widget: 'kpi-stat-card', x: 3, y: 0, w: 3, h: 3, config: { title: 'New Approvals (30d)' } },
        {
          i: 'queue',
          widget: queue?.widget ?? 'master-list',
          x: 0,
          y: 3,
          w: 8,
          h: 12,
          config:
            queue?.config ??
            ({
              title: 'Approvals',
              groupBy: 'status',
              pendingValue: 'pending',
              enumTones: { pending: 'warn', approved: 'pos', rejected: 'danger' },
              binding,
            } as Record<string, unknown>),
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
}

// Canonical widget-data wire shape (server shapers.ts ShapedRecordList).
function listOf(rows: readonly Record<string, unknown>[]) {
  return { shape: 'record-list', rows, columns: [], total: rows.length };
}

const loaded = { queue: { status: 'success' as const, data: listOf(REQUESTS) } };

function fakeApi(overrides: Partial<QueueApi> = {}): QueueApi & { bulkUpdate: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> } {
  return {
    bulkUpdate: vi.fn(async () => ({ undoToken: 'undo_1' })),
    undo: vi.fn(async () => ({ restoredIds: [] })),
    ...overrides,
  } as QueueApi & { bulkUpdate: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> };
}

/** The queue rows list (scoped queries — KPI cards share the page). */
function queueRows(): HTMLElement {
  return document.querySelector('[data-part="queue-rows"]') as HTMLElement;
}

describe('PageQueueInbox', () => {
  it('mounts the KPI slots through WidgetHost and defaults to the pending tab', async () => {
    render(<PageQueueInbox config={config()} now={NOW} states={loaded} />);
    // KPI titles render in the widget frames (demo data — unbound).
    await waitFor(() => {
      expect(screen.getByText('Pending Approvals')).toBeDefined();
      expect(screen.getByText('New Approvals (30d)')).toBeDefined();
    });
    // Pending is the default segment: approved rows are filtered out.
    expect(within(queueRows()).getByText('Team offsite budget')).toBeDefined();
    expect(within(queueRows()).queryByText('New laptop')).toBeNull();
    // Segment tabs carry live counts (radiogroup semantics).
    const tabs = screen.getByRole('radiogroup', { name: 'Status filter' });
    expect(tabs.textContent).toContain('All');
    expect(tabs.textContent).toContain('Pending');
  });

  it('renders the polymorphic amount cell: $4,120.00 / 5 days / —', () => {
    render(<PageQueueInbox config={config()} now={NOW} states={loaded} />);
    const amounts = [...queueRows().querySelectorAll('[data-part="queue-amount"]')].map((el) => el.textContent);
    expect(amounts).toContain('$4,120.00');
    expect(amounts).toContain('5 days');
    expect(amounts).toContain('—');
  });

  it('tints status pills from the stored enumTones map', () => {
    render(<PageQueueInbox config={config()} now={NOW} states={loaded} />);
    const pill = queueRows().querySelector('[data-part="queue-status-pill"]');
    expect(pill?.getAttribute('data-tone')).toBe('warn'); // pending → warn, from config
  });

  it('bulk approve: optimistic exact-set patch + bulkUpdate + Undo restores', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const refetch = vi.fn();
    render(
      <PageQueueInbox
        config={config()}
        now={NOW}
        api={api}
        states={{ queue: { status: 'success', data: listOf(REQUESTS), refetch } }}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Team offsite budget' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Parental leave' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    // The EXACT selected id set goes to the bulk endpoint (09 §4.1 keeper).
    await waitFor(() => {
      expect(api.bulkUpdate).toHaveBeenCalledWith(['r1', 'r2'], { status: 'approved' });
    });
    // Optimistic: both rows leave the pending tab immediately.
    expect(within(queueRows()).queryByText('Team offsite budget')).toBeNull();
    expect(within(queueRows()).queryByText('Parental leave')).toBeNull();
    // Undo-first toast with the token-backed action.
    const undoButton = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undoButton);
    await waitFor(() => {
      expect(api.undo).toHaveBeenCalledWith('undo_1');
    });
    // Undo rolls the optimistic patch back and refetches server truth.
    expect(within(queueRows()).getByText('Team offsite budget')).toBeDefined();
    expect(refetch).toHaveBeenCalled();
  });

  it('derives row identity from the record-list PK column meta, not a literal `id`', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    // A real-world table whose PK is NOT named `id`: the server record-list
    // shaper synthesizes nothing, so identity must come from `columns` meta —
    // a row-index fallback here would send '0'/'1' as PK values and the bulk
    // route would NOT_FOUND every one of them.
    const rows = [
      { request_id: 'REQ-7', name: 'Team offsite budget', status: 'pending' },
      { request_id: 'REQ-9', name: 'Parental leave', status: 'pending' },
    ];
    const data = {
      shape: 'record-list',
      rows,
      columns: [
        { name: 'request_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
        { name: 'name', logicalType: 'varchar', nullable: false, isPrimaryKey: false },
        { name: 'status', logicalType: 'varchar', nullable: false, isPrimaryKey: false },
      ],
      total: rows.length,
    };
    render(
      <PageQueueInbox config={config()} now={NOW} api={api} states={{ queue: { status: 'success', data } }} />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select Team offsite budget' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(api.bulkUpdate).toHaveBeenCalledWith(['REQ-7'], { status: 'approved' });
    });
  });

  it('a refetch retires the optimistic overlay — fresh rows are authoritative', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const { rerender } = render(
      <PageQueueInbox
        config={config()}
        now={NOW}
        api={api}
        states={{ queue: { status: 'success', data: listOf(REQUESTS) } }}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select Team offsite budget' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.bulkUpdate).toHaveBeenCalled());
    // Optimistic: r1 left the pending tab.
    expect(within(queueRows()).queryByText('Team offsite budget')).toBeNull();
    // Fresh rows land (new row identities, as a real refetch delivers) still
    // saying pending — e.g. the write raced another edit: the stale patch
    // must not shadow server truth.
    rerender(
      <PageQueueInbox
        config={config()}
        now={NOW}
        api={api}
        states={{ queue: { status: 'success', data: listOf(REQUESTS.map((row) => ({ ...row }))) } }}
      />,
    );
    expect(within(queueRows()).getByText('Team offsite budget')).toBeDefined();
  });

  it('a failed bulk decision rolls the optimistic patch back with an error toast', async () => {
    const user = userEvent.setup();
    const api = fakeApi({ bulkUpdate: vi.fn(async () => Promise.reject(new Error('CONFLICT'))) });
    render(<PageQueueInbox config={config()} now={NOW} api={api} states={loaded} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select Team offsite budget' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText('CONFLICT')).toBeDefined();
    });
    // Rolled back: the row is pending again.
    expect(within(queueRows()).getByText('Team offsite budget')).toBeDefined();
  });

  it('reject opens the with-reason modal and writes the reason column', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const rows = REQUESTS.map((row) => ({ ...row, rejection_reason: null }));
    render(
      <PageQueueInbox
        config={config()}
        now={NOW}
        api={api}
        states={{ queue: { status: 'success', data: listOf(rows) } }}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Parental leave' }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByText('The requester will be notified with your note.')).toBeDefined();

    await user.type(screen.getByRole('textbox', { name: 'Rejection reason' }), 'Missing manager sign-off');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reject requests')).toBeDefined();
    expect(within(dialog).getByText('Selected · 1')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => {
      expect(api.bulkUpdate).toHaveBeenCalledWith(['r2'], {
        status: 'rejected',
        rejection_reason: 'Missing manager sign-off',
      });
    });
  });

  it('a drained tab renders all-caught-up, distinct from first-use no-data', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PageQueueInbox
        config={config()}
        now={NOW}
        states={{ queue: { status: 'success', data: listOf(REQUESTS.filter((r) => r.status === 'approved')) } }}
      />,
    );
    // Only an approved row: the (default) pending tab is drained. Scope to the
    // queue section — the detail pane's "Select a request" is also no-data.
    const queueSection = () => document.querySelector('section[aria-label="Queue"]') as HTMLElement;
    expect(queueSection().querySelector('[data-preset="all-caught-up"]')).not.toBeNull();
    expect(queueSection().querySelector('[data-preset="no-data"]')).toBeNull();
    await user.click(screen.getByRole('radio', { name: /All/ }));
    expect(within(queueRows()).getByText('New laptop')).toBeDefined();

    rerender(<PageQueueInbox config={config()} now={NOW} states={{ queue: { status: 'success', data: [] } }} />);
    expect(queueSection().querySelector('[data-preset="no-data"]')).not.toBeNull();
  });

  it('row click focuses the detail pane', async () => {
    const user = userEvent.setup();
    render(<PageQueueInbox config={config()} now={NOW} states={loaded} />);
    await user.click(within(queueRows()).getByText('Parental leave'));
    const pane = document.querySelector('[data-part="queue-detail-pane"]') as HTMLElement;
    expect(pane.textContent).toContain('li@acme.dev');
    expect(screen.getByTestId('queue-detail-record')).toBeDefined();
  });

  it('notification-feed flavor mounts through WidgetHost with its own tabs', async () => {
    const feed = config({
      widget: 'notification-feed',
      config: { title: 'Notifications', readColumn: 'read', binding },
    });
    const items = [
      { id: 'n1', category: 'approval', actor: 'Ana', action: 'requested', target: 'budget', ts: '2026-06-15T08:00:00Z', read: false },
      { id: 'n2', category: 'system', actor: 'Bot', action: 'completed', target: 'backup', ts: '2026-06-14T02:00:00Z', read: true },
    ];
    render(
      <PageQueueInbox
        config={feed}
        now={NOW}
        states={{ queue: { status: 'success', data: { data: items } } }}
      />,
    );
    // (The feed family tolerates the `{ data }` demo envelope.)
    await waitFor(() => {
      expect(document.querySelector('[data-widget="notification-feed"]')).not.toBeNull();
    });
    expect(screen.getByRole('tab', { name: /Unread/ })).toBeDefined();
    // No bespoke bulk toolbar in the feed flavor.
    expect(document.querySelector('[data-part="queue-rows"]')).toBeNull();
  });

  it('error/loading/invalid states never crash', async () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <PageQueueInbox
        config={config()}
        states={{ queue: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch } }}
      />,
    );
    expect(screen.getByText('This queue failed to load')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender(<PageQueueInbox config={config()} states={{ queue: { status: 'loading' } }} />);
    expect(screen.getByLabelText('Loading queue')).toBeDefined();

    rerender(<PageQueueInbox config={{ layout: 'nope' }} />);
    expect(screen.getByTestId('page-queue-inbox-invalid')).toBeDefined();
  });
});

describe('decisionValuesOf', () => {
  it('prefers explicit config values', () => {
    expect(decisionValuesOf({ approveValue: 'ok', rejectValue: 'no', pendingValue: 'todo' }, ['x'])).toEqual({
      approve: 'ok',
      reject: 'no',
      pending: 'todo',
    });
  });

  it('scans the live value vocabulary, then falls back to canonical values', () => {
    expect(decisionValuesOf({}, ['awaiting_review', 'accepted', 'declined'])).toEqual({
      approve: 'accepted',
      reject: 'declined',
      pending: 'awaiting_review',
    });
    expect(decisionValuesOf({}, [])).toEqual({ approve: 'approved', reject: 'rejected', pending: undefined });
  });
});
