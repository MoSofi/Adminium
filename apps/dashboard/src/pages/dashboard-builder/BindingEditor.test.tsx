// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Binding editor + the inspector row that opens it (04-widget-registry.md §5.1).
 *
 * The pure translation layer is covered by `bindingDraft.test.ts`, including the
 * acceptance path (inserted widget → authored binding → `extractBindings`).
 * What this file pins is the half that only exists on screen:
 *
 *  - the UNBOUND AFFORDANCE. The builder canvas renders `demoData(seed)` for
 *    bound and unbound widgets alike, so nothing on it distinguishes a widget
 *    that was never wired to the database. If this row ever stops saying so, a
 *    user ships a dashboard of invented numbers and never sees a hint of it.
 *  - SPARSE WRITES. The inspector displays the EFFECTIVE config but must write
 *    the STORED one; clearing a binding must delete the key, not park an
 *    `undefined` under it, or `extractBindings` behaviour depends on how the
 *    layout happened to be serialized.
 *  - IDENTIFIERS COME FROM THE SNAPSHOT. Without one there is no form at all,
 *    because the compiler 422s on any identifier it cannot resolve.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidget, type WidgetDefinition } from '@adminium/widgets';

import { installTestI18n } from '../../i18n/testing.js';
import { ConfigInspector } from './ConfigInspector.js';

const studio = vi.hoisted(() => ({ getSchema: vi.fn() }));

vi.mock('../../studio/api.js', () => ({ studioApi: { getSchema: studio.getSchema } }));

const ORDERS = {
  id: 'public.orders',
  schema: 'public',
  name: 'orders',
  rowCountEstimate: 120,
  columns: [
    { name: 'id', logicalType: 'integer' },
    { name: 'status', logicalType: 'text' },
    { name: 'total', logicalType: 'decimal' },
    { name: 'created_at', logicalType: 'timestamp' },
  ],
};

function schemaReply(tables: unknown[] = [ORDERS]) {
  return {
    connectionId: 'conn_1',
    snapshotId: 'snap_1',
    checksum: 'c1',
    createdAt: 1,
    source: 'introspection',
    appliedOverrides: 0,
    model: { tables },
  };
}

const kpi = getWidget('kpi-stat-card') as WidgetDefinition;

function renderInspector(
  config: Record<string, unknown> = {},
  options: { connectionId?: string | null } = {},
) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfigInspector
        open
        definition={kpi}
        config={config}
        lockedPaths={[]}
        widgetName="KPI stat card"
        connectionId={options.connectionId === undefined ? 'conn_1' : options.connectionId}
        onChange={onChange}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onChange };
}

/** Open the lazily-loaded editor from the inspector's data-source row. */
async function openEditor(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('button', { name: label }));
  await screen.findByRole('dialog', { name: /Data source/ });
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
beforeEach(() => {
  vi.clearAllMocks();
  studio.getSchema.mockResolvedValue(schemaReply());
});

describe('the unbound affordance', () => {
  it('says an unbound widget shows sample data on the live page too', () => {
    renderInspector();
    expect(screen.getByText('Not connected to your data')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Connect to data' })).toBeDefined();
    // Nothing to remove — the key is absent, not empty.
    expect(screen.queryByRole('button', { name: 'Remove data source' })).toBeNull();
  });

  it('summarizes a bound widget instead of warning about it', () => {
    renderInspector({
      binding: {
        kind: 'table-query',
        connectionId: 'conn_1',
        source: { schema: 'public', name: 'orders', type: 'table' },
        shape: 'single-metric',
        aggregations: [{ fn: 'sum', column: 'total', alias: 'value' }],
        filters: [{ column: 'status', op: 'eq', value: 'paid' }],
      },
    });
    expect(screen.queryByText('Not connected to your data')).toBeNull();
    expect(screen.getByText('public.orders')).toBeDefined();
    expect(screen.getByText('sum(total)')).toBeDefined();
    // Singular. `builder.binding.summaryFilters` is an ICU plural, so one
    // filter reads "1 filter" — the plain-interpolation form this once asserted
    // rendered "1 filters" for every count, which is the bug the plural fixed.
    expect(screen.getByText('1 filter')).toBeDefined();
  });

  it('pluralizes the filter summary past one', () => {
    renderInspector({
      binding: {
        kind: 'table-query',
        connectionId: 'conn_1',
        source: { schema: 'public', name: 'orders', type: 'table' },
        shape: 'single-metric',
        aggregations: [{ fn: 'sum', column: 'total', alias: 'value' }],
        filters: [
          { column: 'status', op: 'eq', value: 'paid' },
          { column: 'total', op: 'gt', value: 10 },
        ],
      },
    });
    // The other arm of the ICU plural. Without this, a regression back to plain
    // interpolation would still pass the singular case above by accident.
    expect(screen.getByText('2 filters')).toBeDefined();
  });

  it('reports a stored binding that no longer parses as broken, not as unbound', () => {
    renderInspector({ binding: { kind: 'table-query', shape: 'nonsense' } });
    expect(screen.getByText('This widget’s query is broken')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove data source' })).toBeDefined();
  });
});

describe('writing the binding', () => {
  it('authors the descriptor the generator writes and stores it under `binding`', async () => {
    const { user, onChange } = renderInspector();
    await openEditor(user, 'Connect to data');

    const table = screen.getByRole('combobox', { name: 'Table or view' });
    await user.click(table);
    await user.keyboard('orders');
    await user.click(await screen.findByRole('option', { name: /public\.orders/ }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Calculate' }), 'sum');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Of column' }), 'total');
    await user.click(screen.getByRole('button', { name: 'Use this query' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]?.[0]).toEqual({
      binding: {
        kind: 'table-query',
        connectionId: 'conn_1',
        source: { schema: 'public', name: 'orders', type: 'table' },
        shape: 'single-metric',
        aggregations: [{ fn: 'sum', column: 'total', alias: 'value' }],
      },
    });
  });

  it('refuses to save a half-written query rather than storing one that 422s', async () => {
    const { user, onChange } = renderInspector();
    await openEditor(user, 'Connect to data');
    await user.click(screen.getByRole('button', { name: 'Use this query' }));
    expect(await screen.findByText('This query isn’t finished')).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the rest of the stored config and only deletes the key on clear', async () => {
    const { user, onChange } = renderInspector({
      title: 'Revenue',
      binding: {
        kind: 'table-query',
        connectionId: 'conn_1',
        source: { name: 'orders', type: 'table' },
        shape: 'single-metric',
        aggregations: [{ fn: 'count', alias: 'value' }],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Remove data source' }));
    expect(onChange).toHaveBeenCalledWith({ title: 'Revenue' });
    // Not `{ title, binding: undefined }` — `extractBindings` keys on absence.
    expect('binding' in (onChange.mock.calls[0]?.[0] as object)).toBe(false);
  });
});

describe('the snapshot gate', () => {
  it('offers no form when the connection has never been introspected', async () => {
    studio.getSchema.mockRejectedValue(new Error('no snapshot yet'));
    const { user } = renderInspector();
    await openEditor(user, 'Connect to data');
    expect(await screen.findByText('No schema snapshot for this connection')).toBeDefined();
    // A free-text identifier box would only author bindings the compiler 422s.
    expect(screen.queryByRole('button', { name: 'Use this query' })).toBeNull();
  });

  it('offers no form on a page with no connection', async () => {
    const { user } = renderInspector({}, { connectionId: null });
    await openEditor(user, 'Connect to data');
    expect(await screen.findByText('This page has no database connection')).toBeDefined();
    expect(studio.getSchema).not.toHaveBeenCalled();
  });
});
