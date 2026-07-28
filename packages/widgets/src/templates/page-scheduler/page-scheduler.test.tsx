// @vitest-environment happy-dom
/**
 * page-scheduler template tests (09-generated-app.md §7.6, M7-T03 modal→grid
 * fix): record-list shift rows map into the interactive matrix via the stored
 * `personColumn`/`dateColumn`/`typeColumn` vocabulary, a chip click cycles the
 * shift type (PATCH intent) with optimistic apply + rollback, cycling past the
 * last type deletes, an empty slot inserts, coverage flags zero days, week nav
 * publishes the `dateRange.*` window, and the capacity variant groups rows
 * with the week/month ×4 rescale.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageScheduler, capacityItemConfigOf, capacityModelOf, matrixItemConfigOf, matrixModelOf } from './PageScheduler.js';

afterEach(cleanup);

const CONN = 'conn_1';
/** Wednesday; the en-US week containing it runs Sun 07-12 … Sat 07-18. */
const TODAY = '2026-07-15';

const BINDING = {
  kind: 'table-query',
  connectionId: CONN,
  source: { schema: 'public', name: 'shifts', type: 'table' },
  shape: 'record-list',
  limit: 500,
};

const MATRIX_CONFIG = {
  title: 'Shifts',
  personColumn: 'employee_id',
  dateColumn: 'shift_date',
  typeColumn: 'shift_type',
  binding: BINDING,
};

const ROWS = [
  { id: 'S-1', employee_id: 'emp-1', employee_name: 'Ava Reyes', shift_date: '2026-07-13', shift_type: 'morning' },
  { id: 'S-2', employee_id: 'emp-1', employee_name: 'Ava Reyes', shift_date: '2026-07-14', shift_type: 'evening' },
  { id: 'S-3', employee_id: 'emp-2', employee_name: 'Alan Turing', shift_date: '2026-07-13', shift_type: 'evening' },
];

const recordList = (rows: Record<string, unknown>[]) => ({
  status: 'success' as const,
  data: { rows, columns: [], total: rows.length },
});

function schedulerPage(itemConfig: Record<string, unknown> = MATRIX_CONFIG, widget = 'schedule-matrix') {
  return {
    templateVersion: 1,
    toolbar: [],
    overlays: [],
    layout: {
      version: 1,
      items: [{ i: 'sched-1', widget, x: 0, y: 3, w: 12, h: 14, config: itemConfig }],
    },
  };
}

describe('matrixModelOf', () => {
  const cfg = matrixItemConfigOf(MATRIX_CONFIG);

  it('maps shift rows via the stored vocabulary, keeping record ids for writes', () => {
    const model = matrixModelOf({ rows: ROWS, total: 3 }, cfg);
    expect(model.resources.map((r) => r.id)).toEqual(['emp-1', 'emp-2']);
    expect(model.resources[0]?.label).toBe('Ava Reyes'); // name-ish sibling column
    expect(model.types.map((t) => t.id)).toEqual(['morning', 'evening']); // first-seen order
    expect(model.shifts[0]).toMatchObject({ recordId: 'S-1', resourceId: 'emp-1', date: '2026-07-13' });
    expect(model.writable).toBe(true);
    expect(model.providedDays).toBeNull();
  });

  it('accepts the family demo shape as-is (read-only)', () => {
    const model = matrixModelOf(
      {
        rows: [{ id: 'r-1', name: 'Ava Reyes', role: 'Barista' }],
        total: 1,
        days: ['2026-07-12', '2026-07-13'],
        shiftTypes: [{ id: 'morning', label: 'Morning', start: '06:00', end: '14:00', hours: 8, tone: 'accent' }],
        assignments: [{ resourceId: 'r-1', date: '2026-07-12', typeId: 'morning' }],
      },
      cfg,
    );
    expect(model.providedDays).toEqual(['2026-07-12', '2026-07-13']);
    expect(model.writable).toBe(false);
    expect(model.shifts).toHaveLength(1);
  });
});

describe('PageScheduler — shift matrix', () => {
  it('renders resources × week days with typed shift chips', () => {
    const { container } = render(
      <PageScheduler config={schedulerPage()} states={{ 'sched-1': recordList(ROWS) }} referenceDate={TODAY} />,
    );
    expect(screen.getByText('Ava Reyes')).toBeDefined();
    expect(screen.getByText('Alan Turing')).toBeDefined();
    const chips = [...container.querySelectorAll('[data-part="shift-chip"]')].map((el) => el.textContent);
    expect(chips.filter((label) => label === 'Morning')).toHaveLength(1);
    expect(chips.filter((label) => label === 'Evening')).toHaveLength(2);
  });

  it('clicking a chip cycles the shift type through a PATCH intent, optimistically', async () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    const { container } = render(
      <PageScheduler
        config={schedulerPage()}
        states={{ 'sched-1': recordList(ROWS) }}
        referenceDate={TODAY}
        onEvent={onEvent}
      />,
    );
    fireEvent.click(container.querySelector('[data-shift="S-1"]') as HTMLElement);
    expect(onEvent).toHaveBeenCalledWith('sched-1', {
      type: 'mutate',
      intent: 'update',
      connectionId: CONN,
      table: 'public.shifts',
      recordId: 'S-1',
      values: { shift_type: 'evening' },
    });
    // Optimistic: the chip already reads as the next type.
    expect((container.querySelector('[data-shift="S-1"]') as HTMLElement).textContent).toBe('Evening');
  });

  it('cycling past the last type deletes the shift; a rejected write rolls back', async () => {
    const onEvent = vi.fn(() => Promise.reject(new Error('CONFLICT')));
    const { container } = render(
      <PageScheduler
        config={schedulerPage()}
        states={{ 'sched-1': recordList(ROWS) }}
        referenceDate={TODAY}
        onEvent={onEvent}
      />,
    );
    fireEvent.click(container.querySelector('[data-shift="S-2"]') as HTMLElement); // evening = last type
    expect(onEvent).toHaveBeenCalledWith('sched-1', {
      type: 'mutate',
      intent: 'delete',
      connectionId: CONN,
      table: 'public.shifts',
      recordId: 'S-2',
    });
    // Optimistically removed…
    expect(container.querySelector('[data-shift="S-2"]')).toBeNull();
    // …and restored after the rejection.
    await waitFor(() => {
      expect(container.querySelector('[data-shift="S-2"]')).not.toBeNull();
    });
  });

  it('an open cell slot inserts a first-type shift (the modal→grid fix)', () => {
    const onEvent = vi.fn(() => Promise.resolve({}));
    render(
      <PageScheduler
        config={schedulerPage()}
        states={{ 'sched-1': recordList(ROWS) }}
        referenceDate={TODAY}
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /Add shift: Ava Reyes, 2026-07-15/ })[0] as HTMLElement);
    expect(onEvent).toHaveBeenCalledWith('sched-1', {
      type: 'mutate',
      intent: 'insert',
      connectionId: CONN,
      table: 'public.shifts',
      values: { employee_id: 'emp-1', shift_date: '2026-07-15', shift_type: 'morning' },
    });
  });

  it('coverage micro-bars flag zero-coverage days in danger tone', () => {
    const { container } = render(
      <PageScheduler config={schedulerPage()} states={{ 'sched-1': recordList(ROWS) }} referenceDate={TODAY} />,
    );
    const tones = [...container.querySelectorAll('[data-part="coverage-day"]')].map((el) =>
      el.getAttribute('data-tone'),
    );
    expect(tones).toHaveLength(7);
    expect(tones.filter((tone) => tone === 'danger').length).toBeGreaterThan(0);
  });

  it('week nav publishes the next dateRange.* window', () => {
    const onParamsChange = vi.fn();
    render(
      <PageScheduler
        config={schedulerPage()}
        states={{ 'sched-1': recordList(ROWS) }}
        referenceDate={TODAY}
        onParamsChange={onParamsChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onParamsChange).toHaveBeenCalledWith({
      'dateRange.start': '2026-07-19',
      'dateRange.end': '2026-07-25',
    });
  });

  it('renders the invalid-layout notice for a corrupt stored config', () => {
    render(<PageScheduler config={{ templateVersion: 1, layout: [] }} />);
    expect(screen.getByTestId('page-scheduler-invalid')).toBeDefined();
  });
});

describe('PageScheduler — capacity board (Team Workload)', () => {
  const CAPACITY_CONFIG = {
    title: 'Workload',
    personColumn: 'member',
    projectColumn: 'project',
    hoursColumn: 'hours',
    binding: BINDING,
  };
  const CAPACITY_ROWS = [
    { id: 'A-1', member: 'ava', name: 'Ava Reyes', project: 'Platform', hours: 30 },
    { id: 'A-2', member: 'ava', name: 'Ava Reyes', project: 'Mobile', hours: 16 },
    { id: 'A-3', member: 'alan', name: 'Alan Turing', project: 'Platform', hours: 20 },
  ];

  it('groups record-list rows into per-member project assignments', () => {
    const model = capacityModelOf({ rows: CAPACITY_ROWS, total: 3 }, capacityItemConfigOf(CAPACITY_CONFIG));
    expect(model.total).toBe(2);
    expect(model.rows[0]?.assignments.map((a) => a.hours)).toEqual([30, 16]);
    expect(model.rows[0]?.name).toBe('Ava Reyes');
  });

  it('renders utilization with thresholds and the week/month ×4 rescale', async () => {
    render(
      <PageScheduler
        config={schedulerPage(CAPACITY_CONFIG, 'capacity-board')}
        states={{ 'sched-1': recordList(CAPACITY_ROWS) }}
        referenceDate={TODAY}
      />,
    );
    // 46h / 40h → overloaded at week scale.
    expect(screen.getByText('Overloaded')).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    // 46h / 160h → available at month scale.
    await waitFor(() => {
      expect(screen.queryByText('Overloaded')).toBeNull();
    });
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
  });
});

describe('page-scheduler chrome localization (ui:templates.scheduler.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui' ? { templates: { scheduler: { previousWeek: 'Vorherige Woche' } } } : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <PageScheduler config={schedulerPage()} states={{ 'sched-1': recordList(ROWS) }} referenceDate={TODAY} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Vorherige Woche' })).toBeDefined();

    cleanup();
    render(
      <PageScheduler config={schedulerPage()} states={{ 'sched-1': recordList(ROWS) }} referenceDate={TODAY} />,
    );
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDefined();
  });
});
