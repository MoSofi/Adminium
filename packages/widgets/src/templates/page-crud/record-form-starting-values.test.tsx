// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A NEW RECORD'S STARTING VALUES, AND THE SWITCH NOBODY TOUCHED.
 *
 *   · The form designer has always saved a field's "starting value"
 *     (`initial`); nothing read it, so "starts as today" did nothing.
 *   · An untouched on/off switch stayed `undefined`, which the required check
 *     read as blank: a new record with a NOT NULL switch could not be saved
 *     without toggling it twice.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpec, type GridColumnSpecInput } from '../../families/tables/column-spec.js';
import type { CrudFormConfig } from '../../page-config/index.js';
import { RecordForm, startingValues } from './RecordForm.js';
import type { ColumnFact, ColumnFacts } from './field-mapping.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);
const fact = (over: Partial<ColumnFact> = {}): ColumnFact => ({ filledBy: null, required: false, writable: true, ...over });

const COLUMNS = [
  spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
  spec({ name: 'name', label: 'Name', logicalType: 'varchar', nullable: false, maxLength: 80 }),
  spec({ name: 'featured', label: 'Featured', logicalType: 'boolean', nullable: false }),
  spec({ name: 'available', label: 'Available', logicalType: 'boolean', nullable: false, hasDefault: true }),
];

const FACTS: ColumnFacts = {
  id: fact({ filledBy: 'database' }),
  name: fact({ required: true }),
  featured: fact({ required: true }),
  available: fact({ filledBy: 'database' }),
};

function form(document?: CrudFormConfig, mode: 'create' | 'edit' = 'create') {
  const onSubmit = vi.fn();
  render(
    <RecordForm
      columns={COLUMNS}
      mode={mode}
      facts={FACTS}
      formId="test-form"
      onSubmit={onSubmit}
      footer={<button type="submit">Add</button>}
      {...(document === undefined ? {} : { document })}
      currentUser={{ id: 'usr_1', name: 'Ava Reyes' }}
    />,
  );
  return { onSubmit };
}

describe('an untouched on/off switch', () => {
  it('saves as off instead of reporting "required"', async () => {
    const { onSubmit } = form();
    await userEvent.type(screen.getByLabelText(/Name/), 'Latte');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.queryByText('This field is required.')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent['featured']).toBe(false);
    // Something else fills `available`, so an untouched switch leaves it to that.
    expect('available' in sent).toBe(false);
  });
});

describe("the form designer's starting values", () => {
  const at = new Date(2026, 8, 22, 9, 30);
  const doc = (initial: unknown, column = 'name'): CrudFormConfig =>
    ({ version: 2, preset: 'stack', sections: [{ fields: [{ column, initial }] }] }) as unknown as CrudFormConfig;

  it('reads each kind', () => {
    expect(startingValues(doc({ kind: 'literal', value: 'House blend' }), undefined, at)).toEqual({ name: 'House blend' });
    expect(startingValues(doc({ kind: 'today' }), undefined, at)).toEqual({ name: '2026-09-22' });
    expect(startingValues(doc({ kind: 'now' }), undefined, at)).toEqual({ name: at.toISOString() });
    expect(startingValues(doc({ kind: 'current-user', field: 'name' }), { id: 'u', name: 'Ava' }, at)).toEqual({ name: 'Ava' });
    expect(startingValues(doc({ kind: 'current-user', field: 'id' }), undefined, at)).toEqual({});
  });

  it('fills a new record, and sends it untouched', async () => {
    const { onSubmit } = form(doc({ kind: 'literal', value: 'House blend' }));
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('House blend');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((onSubmit.mock.calls[0]![0] as Record<string, unknown>)['name']).toBe('House blend');
  });

  it('turns a switch on when that is its starting value', async () => {
    const both = {
      version: 2,
      preset: 'stack',
      sections: [{ fields: [{ column: 'name' }, { column: 'featured', initial: { kind: 'literal', value: true } }] }],
    } as unknown as CrudFormConfig;
    const { onSubmit } = form(both);
    await userEvent.type(screen.getByLabelText(/Name/), 'Mocha');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((onSubmit.mock.calls[0]![0] as Record<string, unknown>)['featured']).toBe(true);
  });
});
