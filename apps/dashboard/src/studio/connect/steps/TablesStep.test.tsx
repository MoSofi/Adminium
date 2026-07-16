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
