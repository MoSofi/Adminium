// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-log-viewer template tests (09 §7.8): renders the stored layout (KPI
 * hosts + log-table + trace slot), projects raw audit rows onto the LogRow
 * anatomy by column-vocabulary detection, drives the toolbar level/time
 * filters, swaps the trace pane to a selection's related events, folds live
 * stream events into the tail (pause holds them), and degrades on
 * loading/error/invalid layouts — never a crash.
 */
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageLogViewer } from './PageLogViewer.js';
import { demoLogViewerLayout } from './demo-layout.js';
import { detectLogFields, filterLogRows, toMappedLogRow, traceEntriesOf } from './log-mapping.js';
import type { StreamListener, StreamRealtimeEvent, StreamTransport } from '../../binding/stream-types.js';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

function auditRow(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `evt-${String(index)}`,
    created_at: new Date(NOW - index * 30 * 60_000).toISOString(),
    actor: 'ava@acme.dev',
    category: 'orders',
    action: 'updated',
    resource: `orders/${String(1000 + index)}`,
    status: 'ok',
    ...overrides,
  };
}

const ROWS = [
  auditRow(1),
  auditRow(2, { status: 'error', action: 'deleted' }),
  auditRow(9, { resource: 'orders/1001' }), // 4.5h old — shares evt-1's resource
];

function statesFor(rows: Record<string, unknown>[]) {
  return {
    log: { status: 'success' as const, data: { rows, total: rows.length } },
    trace: { status: 'success' as const, data: { rows: [] } },
  };
}

describe('log-mapping', () => {
  it('detects the LogRow projection from raw audit columns (ts hint wins)', () => {
    const map = detectLogFields(ROWS, 'created_at');
    expect(map.ts).toBe('created_at');
    expect(map.actor).toBe('actor');
    expect(map.action).toBe('action');
    expect(map.resource).toBe('resource');
    expect(map.status).toBe('status');
    expect(map.id).toBe('id');
  });

  it('consumes each column once — `level` maps to status, not category', () => {
    const map = detectLogFields([{ id: 1, ts: 'x', level: 'error', message: 'boom' }]);
    expect(map.status).toBe('level');
    expect(map.category).toBeUndefined();
    expect(map.action).toBe('message');
  });

  it('filters by level and rolling time window with an injected clock', () => {
    const map = detectLogFields(ROWS, 'created_at');
    const mapped = ROWS.map((row, index) => toMappedLogRow(row, map, index));
    expect(filterLogRows(mapped, { level: 'errors', window: 'all', now: NOW })).toHaveLength(1);
    expect(filterLogRows(mapped, { level: 'all', window: '1h', now: NOW })).toHaveLength(2);
    expect(filterLogRows(mapped, { level: 'all', window: 'all', now: NOW })).toHaveLength(3);
  });

  it('builds trace entries for the selection with mono snippets', () => {
    const map = detectLogFields(ROWS, 'created_at');
    const mapped = ROWS.map((row, index) => toMappedLogRow(row, map, index));
    const entries = traceEntriesOf(mapped[1] as (typeof mapped)[number], mapped, map);
    expect(entries).toHaveLength(1); // resource is unique to the selection
    expect(entries[0]?.title).toBe('deleted orders/1002');
    expect(entries[0]?.tone).toBe('danger');
    expect(entries[0]?.log).toContain('"evt-2"');
  });
});

describe('PageLogViewer', () => {
  it('renders the demo layout: KPI hosts, the log table and the trace slot', async () => {
    const { container } = render(<PageLogViewer layout={demoLogViewerLayout} now={NOW} testId="plv" />);
    expect(screen.getByTestId('plv')).toBeDefined();
    await waitFor(() => {
      expect(container.querySelectorAll('[data-widget="kpi-stat-card"]')).toHaveLength(2);
    });
    // Demo mode feeds logTableDemoData through the direct-composed LogTable.
    await waitFor(() => {
      expect(container.querySelector('[data-widget="log-table"]')).not.toBeNull();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-part="trace-panel"] [data-widget="timeline-vertical"]')).not.toBeNull();
    });
  });

  it('projects bound audit rows and drives the toolbar level/time filters', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PageLogViewer layout={demoLogViewerLayout} now={NOW} states={statesFor(ROWS)} />,
    );
    const table = await screen.findByTestId('page-log-viewer-table');
    expect(within(table).getAllByRole('listitem')).toHaveLength(3);
    expect(within(table).getAllByText(/orders\/10/)).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Errors' }));
    expect(within(table).getAllByRole('listitem')).toHaveLength(1);
    expect(within(table).getByText('orders/1002')).toBeDefined();

    await user.click(container.querySelector('[data-window="1h"]') as HTMLElement);
    // errors ∩ last hour = evt-2 (30 min old error) still visible
    expect(within(table).getAllByRole('listitem')).toHaveLength(1);

    await user.click(container.querySelector('[data-part="level-filter"][data-level="all"]') as HTMLElement);
    expect(within(table).getAllByRole('listitem')).toHaveLength(2); // 1h window keeps 2
  });

  it('selecting a row swaps the trace pane to its related events and back', async () => {
    const user = userEvent.setup();
    render(<PageLogViewer layout={demoLogViewerLayout} now={NOW} states={statesFor(ROWS)} />);
    const table = await screen.findByTestId('page-log-viewer-table');

    await user.click(within(table).getAllByRole('button', { name: 'inspect' })[1] as HTMLElement);
    const trace = await screen.findByTestId('page-log-viewer-trace');
    expect(trace.getAttribute('data-variant')).toBe('trace');
    expect(within(trace).getByText('deleted orders/1002')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Back to latest' }));
    expect(screen.queryByTestId('page-log-viewer-trace')).toBeNull();
  });

  it('folds live stream events into the tail and holds them while paused', async () => {
    const user = userEvent.setup();
    const listeners: StreamListener[] = [];
    const transport: StreamTransport = {
      subscribe: (channel, listener, onStatus) => {
        void channel;
        listeners.push(listener);
        onStatus?.(true);
        return () => {};
      },
    };
    const emit = (index: number, overrides: Record<string, unknown> = {}) => {
      const row = auditRow(index, overrides);
      const event: StreamRealtimeEvent = {
        channel: 'widget-data:conn_1:public.order_audit',
        type: 'record.create',
        data: { type: 'record.create', row },
        ts: String(row['created_at']),
      };
      for (const listener of listeners) listener(event);
    };

    render(
      <PageLogViewer
        layout={demoLogViewerLayout}
        now={NOW}
        states={statesFor(ROWS.slice(0, 2))}
        liveChannel="widget-data:conn_1:public.order_audit"
        streamTransport={transport}
      />,
    );
    const table = await screen.findByTestId('page-log-viewer-table');
    expect(within(table).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Live')).toBeDefined();

    act(() => emit(50, { created_at: new Date(NOW).toISOString(), resource: 'orders/9999' }));
    await waitFor(() => {
      expect(within(table).getByText('orders/9999')).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => emit(51, { created_at: new Date(NOW).toISOString(), resource: 'orders/8888' }));
    expect(within(table).queryByText('orders/8888')).toBeNull();
    expect(screen.getByText('+1')).toBeDefined(); // held-events counter

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => {
      expect(within(table).getByText('orders/8888')).toBeDefined();
    });
  });

  it('degrades on loading, error (with Retry → refetch) and invalid layouts', async () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <PageLogViewer layout={demoLogViewerLayout} now={NOW} states={{ log: { status: 'loading' } }} />,
    );
    expect(screen.getByRole('status', { name: 'Loading log entries' })).toBeDefined();

    rerender(
      <PageLogViewer
        layout={demoLogViewerLayout}
        now={NOW}
        states={{ log: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch } }}
      />,
    );
    expect(screen.getByText('The log query failed')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender(<PageLogViewer layout={{ version: 99, items: 'nope' }} now={NOW} />);
    expect(screen.getByTestId('page-log-viewer-invalid')).toBeDefined();
  });
});

describe('page-log-viewer chrome localization (ui:templates.logViewer.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { templates: { logViewer: { latestTitle: 'Neueste Aktivität' } } }
          : null,
    });
    const traceHeading = (root: HTMLElement): string | undefined =>
      root.querySelector('[data-part="trace-panel"] h3')?.textContent ?? undefined;

    const { container } = render(
      <I18nProvider i18n={i18n}>
        <PageLogViewer layout={demoLogViewerLayout} now={NOW} states={statesFor(ROWS)} />
      </I18nProvider>,
    );
    // (The trace slot's demo-layout widget title stays English — demo content is exempt.)
    expect(traceHeading(container)).toBe('Neueste Aktivität');

    cleanup();
    const bare = render(<PageLogViewer layout={demoLogViewerLayout} now={NOW} states={statesFor(ROWS)} />);
    expect(traceHeading(bare.container)).toBe('Latest activity');
  });
});
