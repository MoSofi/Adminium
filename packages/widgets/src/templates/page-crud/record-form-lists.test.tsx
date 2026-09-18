// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A `column.options` rule, in the FORM.
 *
 * The rule is what the server enforces on the write. This file is the other
 * end: the dialog has to OFFER exactly what the write path will accept, and for
 * a named list that means asking the host — which is the only side that knows
 * what `DE` is called for the person looking at it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpec, type GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { RecordForm } from './RecordForm.js';
import type { ColumnFact, ColumnFacts } from './field-mapping.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
  spec({ name: 'country', label: 'Country', logicalType: 'varchar', maxLength: 2 }),
];

const fact = (over: Partial<ColumnFact> = {}): ColumnFact => ({
  filledBy: null,
  required: false,
  writable: true,
  ...over,
});

/** The workspace's lists, as the host resolves them for this reader. */
const LISTS = {
  'builtin:countries': [
    { value: 'DE', label: 'Germany' },
    { value: 'FR', label: 'France' },
    { value: 'GB', label: 'United Kingdom' },
    { value: 'IT', label: 'Italy' },
    { value: 'ES', label: 'Spain' },
    { value: 'PT', label: 'Portugal' },
    { value: 'NL', label: 'Netherlands' },
  ],
} as const;

function renderForm(facts: ColumnFacts, onSubmit = vi.fn()) {
  render(
    <RecordForm
      columns={COLUMNS}
      mode="create"
      facts={facts}
      listOptions={(key) => LISTS[key as keyof typeof LISTS]}
      onSubmit={onSubmit}
      formId="lists-form"
      footer={<button type="submit">Save</button>}
    />,
  );
  return onSubmit;
}

describe('a column whose answers come from a list', () => {
  it('offers the list’s answers by their NAMES, and sends the code', async () => {
    const onSubmit = renderForm({ country: fact({ options: { list: 'builtin:countries' } }) });
    const select = screen.getByLabelText('Country');
    // Seven answers ⇒ a select (past the segmented control's arity), with the
    // reader's own names on the options and the stored CODE behind each.
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toContain('Germany');
    await userEvent.selectOptions(select, 'DE');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ country: 'DE' }));
  });

  it('renders a plain input when the host cannot resolve the list', async () => {
    /*
     * The list was deleted, or this reader cannot see the store. The field
     * stays usable and the column accepts what the database accepts — the same
     * thing the write path does with a list it cannot resolve.
     */
    renderForm({ country: fact({ options: { list: 'gone' } }) });
    expect(screen.getByLabelText('Country').tagName).toBe('INPUT');
  });
});
