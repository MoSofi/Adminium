// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TablesStep (M7 Wave 4) focused a11y regression: the step's `<section>` and the
 * `table-inclusion-checklist` widget's `<ul>` are two nested landmarks, so they
 * must not share an accessible name. Handing the widget the step TITLE as its
 * `a11yLabel` made a screen reader announce "Choose your tables, region"
 * immediately followed by "Choose your tables, list" — a label that distinguishes
 * neither — and made `getByLabelText` on the step's own title ambiguous.
 */
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { TablesStep } from './TablesStep.js';
import type { SchemaTable } from '../../api.js';

const TABLES = [
  { id: 'public.customers', schema: 'public', name: 'customers', rowEstimate: 900, columns: [] },
] as unknown as SchemaTable[];

function renderStep() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TablesStep
        connectionId={null}
        fileTables={TABLES}
        source={{ kind: 'import' }}
        included={['public.customers']}
        onIncludedChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

it('gives the checklist its own name, distinct from the step section’s', () => {
  const { container } = renderStep();
  const section = container.querySelector('section');
  const list = container.querySelector('ul[aria-label]');
  expect(section?.getAttribute('aria-label')).toBe('Choose your tables');
  expect(list?.getAttribute('aria-label')).toBe('Includable tables');
  expect(list?.getAttribute('aria-label')).not.toBe(section?.getAttribute('aria-label'));
  // The step title is unambiguous again: exactly one element carries it.
  expect(screen.getAllByLabelText('Choose your tables')).toHaveLength(1);
});

/**
 * An empty source used to render an empty checklist under a search box, which
 * then said "No tables match your filter." with no filter typed.
 */
function renderEmpty(options: { connectionId: string | null; fileTables: SchemaTable[] | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (options.connectionId !== null) {
    client.setQueryData(['studio', 'schema', options.connectionId], { model: { tables: [] } });
  }
  return render(
    <QueryClientProvider client={client}>
      <TablesStep
        connectionId={options.connectionId}
        fileTables={options.fileTables}
        source={options.connectionId === null ? { kind: 'import' } : { kind: 'live', engine: 'postgres' }}
        included={null}
        onIncludedChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

it('says a live database has no tables instead of blaming the filter', () => {
  renderEmpty({ connectionId: 'conn_1', fileTables: null });
  expect(screen.getByText('No tables found')).toBeDefined();
  expect(screen.getByText(/use Re-introspect on this connection/)).toBeDefined();
  expect(screen.queryByText('No tables match your filter.')).toBeNull();
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('says a schema file defines no tables', () => {
  renderEmpty({ connectionId: null, fileTables: [] });
  expect(screen.getByText('No tables found')).toBeDefined();
  expect(screen.getByText(/This schema file defines no tables/)).toBeDefined();
});

it('keeps the pre-hidden note when only join/system tables exist', () => {
  const joinOnly = [
    { id: 'public.a_b', schema: 'public', name: 'a_b', semantics: { role: 'join-table' }, columns: [] },
  ] as unknown as SchemaTable[];
  renderEmpty({ connectionId: null, fileTables: joinOnly });
  expect(screen.getByText('No tables found')).toBeDefined();
  expect(screen.getByText(/1 join\/system tables are pre-hidden/)).toBeDefined();
});
