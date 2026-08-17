// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `page-master-detail` template tests (M7 track, 09 §7.3 + M7-T04): the master
 * rail renders from the stored config with facet chips + live counts, the
 * priority/status pill tints come from the stored `enumTones` map (never
 * hardcoded — Ticket Queue defect), selection drives the detail pane and
 * emits `record-open`, `J`/`K` move the selection, the filtered zero-match
 * state is distinct from first-use, the gantt domain card mounts through
 * WidgetHost with bridged `*Column` keys, and bad configs never crash.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageMasterDetail, deriveStatusSubtitle } from './PageMasterDetail.js';
import type { WidgetEvent } from '../../registry/types.js';

const binding = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { name: 'tickets', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 100,
};

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

const TICKETS = [
  { id: 't1', subject: 'Login loop on Safari', status: 'open', priority: 'high', updated_at: '2026-06-15T09:00:00Z' },
  { id: 't2', subject: 'CSV export truncates rows', status: 'open', priority: 'medium', updated_at: '2026-06-14T16:20:00Z' },
  { id: 't3', subject: 'Billing address typo', status: 'pending', priority: 'low', updated_at: '2026-06-13T10:00:00Z' },
];

const ENUM_TONES = { high: 'danger', medium: 'warn', low: 'muted', open: 'info', pending: 'warn' };

function config(detail?: { widget: string; config: Record<string, unknown> }) {
  return {
    templateVersion: 1,
    toolbar: ['filter-chip-bar'],
    overlays: ['toast-stack'],
    layout: {
      version: 1,
      items: [
        {
          i: 'master',
          widget: 'master-list',
          x: 0,
          y: 0,
          w: 4,
          h: 14,
          config: { title: 'Tickets', groupBy: 'status', enumTones: ENUM_TONES, binding },
        },
        {
          i: 'detail',
          widget: detail?.widget ?? 'detail-key-value',
          x: 4,
          y: 0,
          w: 8,
          h: 14,
          config: detail?.config ?? { title: 'Ticket Detail', binding: { ...binding, shape: 'record', limit: 1 } },
        },
      ],
    },
  };
}

// Canonical widget-data wire shape (server shapers.ts ShapedRecordList).
function listOf(rows: readonly Record<string, unknown>[]) {
  return { shape: 'record-list', rows, columns: [], total: rows.length };
}

const loaded = { master: { status: 'success' as const, data: listOf(TICKETS) } };

/** The master rail list (titles also render in the detail pane header). */
function rail(): HTMLElement {
  return document.querySelector('[data-part="master-rail"]') as HTMLElement;
}

describe('PageMasterDetail', () => {
  it('renders the rail with facet chips + live counts and the derived micro-KPI subtitle', () => {
    render(<PageMasterDetail config={config()} now={NOW} states={loaded} />);
    expect(within(rail()).getByText('Login loop on Safari')).toBeDefined();
    // Facet chips carry live counts: All 3, Open 2, Pending 1.
    const group = screen.getByRole('group', { name: 'Filter' });
    expect(group.textContent).toContain('All');
    expect(group.textContent).toContain('Open');
    // Derived subtitle: "2 open · 1 pending" (09 §7.3 ticket flavor).
    expect(screen.getByText('2 open · 1 pending')).toBeDefined();
  });

  it('tints priority + status pills from the stored enumTones map (M7-T04)', () => {
    const { container } = render(<PageMasterDetail config={config()} now={NOW} states={loaded} />);
    const priorityPills = container.querySelectorAll('[data-part="priority-pill"]');
    expect(priorityPills.length).toBe(3);
    expect(priorityPills[0]?.getAttribute('data-tone')).toBe('danger'); // high
    expect(priorityPills[1]?.getAttribute('data-tone')).toBe('warn'); // medium
    expect(priorityPills[2]?.getAttribute('data-tone')).toBe('neutral'); // low → muted maps to neutral
    const statusPills = container.querySelectorAll('[data-part="status-pill"]');
    expect(statusPills[0]?.getAttribute('data-tone')).toBe('info'); // open
  });

  it('selection drives the detail pane and emits record-open', async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    const onSelected = vi.fn();
    render(
      <PageMasterDetail config={config()} now={NOW} states={loaded} onEvent={onEvent} onSelectedChange={onSelected} />,
    );

    // Display default: first row's record fills the pane without navigation.
    expect(screen.getByTestId('master-detail-record')).toBeDefined();
    expect(onSelected).not.toHaveBeenCalled();

    await user.click(within(rail()).getByText('CSV export truncates rows'));
    expect(onSelected).toHaveBeenCalledWith('t2');
    const [instanceId, event] = onEvent.mock.calls[0] as [string, WidgetEvent];
    expect(instanceId).toBe('master');
    expect(event).toMatchObject({ type: 'record-open', table: 'public.tickets', recordId: 't2' });
    // Pane header now shows the selected record.
    const pane = document.querySelector('[data-part="detail-pane"]') as HTMLElement;
    expect(pane.textContent).toContain('CSV export truncates rows');
  });

  it('J/K move the selection through the visible rows', async () => {
    const user = userEvent.setup();
    const onSelected = vi.fn();
    render(<PageMasterDetail config={config()} now={NOW} states={loaded} onSelectedChange={onSelected} />);

    await user.click(within(rail()).getByText('Login loop on Safari')); // t1
    await user.keyboard('j');
    expect(onSelected).toHaveBeenLastCalledWith('t2');
    await user.keyboard('j');
    expect(onSelected).toHaveBeenLastCalledWith('t3');
    await user.keyboard('k');
    expect(onSelected).toHaveBeenLastCalledWith('t2');
  });

  it('facet filter narrows the rail; zero matches renders no-matches, not first-use', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PageMasterDetail config={config()} now={NOW} states={loaded} />);

    await user.click(screen.getByRole('button', { name: /Pending/ }));
    expect(within(rail()).queryByText('Login loop on Safari')).toBeNull();
    expect(within(rail()).getByText('Billing address typo')).toBeDefined();

    // The pending row leaves on a refetch while the filter is still active →
    // the FILTERED empty state (no-matches + Clear filters), never first-use.
    rerender(
      <PageMasterDetail
        config={config()}
        now={NOW}
        states={{ master: { status: 'success', data: listOf(TICKETS.filter((t) => t.status === 'open')) } }}
      />,
    );
    // Scope to the master section — the detail pane's "Select a record"
    // prompt is also a no-data preset.
    const master = document.querySelector('section[aria-label="Tickets"]') as HTMLElement;
    expect(master.querySelector('[data-preset="no-matches"]')).not.toBeNull();
    expect(master.querySelector('[data-preset="no-data"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(rail()).getByText('Login loop on Safari')).toBeDefined();
  });

  it('first-use empty rail renders no-data (distinct preset)', () => {
    render(<PageMasterDetail config={config()} states={{ master: { status: 'success', data: [] } }} />);
    expect(document.querySelector('[data-preset="no-data"]')).not.toBeNull();
    expect(screen.getByText('Nothing here yet')).toBeDefined();
  });

  it('mounts a gantt-chart detail through WidgetHost with bridged field keys', async () => {
    const gantt = config({
      widget: 'gantt-chart',
      config: {
        title: 'Project Plan',
        startColumn: 'start_date',
        endColumn: 'end_date',
        progressColumn: 'progress',
        groupColumn: 'phase_id',
        binding,
      },
    });
    const tasks = [
      { id: 'a1', name: 'Kickoff', start_date: '2026-06-01', end_date: '2026-06-05', progress: 100, phase_id: 'Discovery' },
      { id: 'a2', name: 'Build API', start_date: '2026-06-04', end_date: '2026-06-20', progress: 40, phase_id: 'Build' },
    ];
    render(
      <PageMasterDetail
        config={gantt}
        now={NOW}
        states={{
          master: { status: 'success', data: listOf(TICKETS) },
          detail: { status: 'success', data: listOf(tasks) },
        }}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-widget="gantt-chart"]')).not.toBeNull();
    });
    // The bridged startField/phaseField reach the widget: bars render per row.
    expect(screen.getByText('Kickoff')).toBeDefined();
    expect(screen.getByText('Build API')).toBeDefined();
  });

  it('error + loading master states render without crashing; invalid config notices', async () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <PageMasterDetail
        config={config()}
        states={{ master: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch } }}
      />,
    );
    expect(screen.getByText('This list failed to load')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender(<PageMasterDetail config={config()} states={{ master: { status: 'loading' } }} />);
    expect(screen.getByLabelText('Loading records')).toBeDefined();

    rerender(<PageMasterDetail config={{ layout: 42 }} />);
    expect(screen.getByTestId('page-master-detail-invalid')).toBeDefined();
  });
});

describe('page-master-detail chrome localization (ui:templates.masterDetail.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              templates: {
                masterDetail: {
                  emptyBody: 'Datensätze erscheinen hier, sobald Zeilen eintreffen.',
                  selectPrompt: 'Datensatz auswählen',
                },
              },
            }
          : null,
    });
    const empty = { master: { status: 'success' as const, data: [] } };
    render(
      <I18nProvider i18n={i18n}>
        <PageMasterDetail config={config()} states={empty} />
      </I18nProvider>,
    );
    expect(screen.getByText('Datensätze erscheinen hier, sobald Zeilen eintreffen.')).toBeTruthy();
    expect(screen.getByText('Datensatz auswählen')).toBeTruthy();

    cleanup();
    render(<PageMasterDetail config={config()} states={empty} />);
    expect(screen.getByText('Records appear here as rows land in the table.')).toBeTruthy();
    expect(screen.getByText('Select a record')).toBeTruthy();
  });
});

describe('deriveStatusSubtitle', () => {
  it('joins the top status counts with a middle dot', () => {
    expect(deriveStatusSubtitle(TICKETS, 'status')).toBe('2 open · 1 pending');
  });

  it('returns null without a status field or rows', () => {
    expect(deriveStatusSubtitle(TICKETS, undefined)).toBeNull();
    expect(deriveStatusSubtitle([], 'status')).toBeNull();
  });
});
