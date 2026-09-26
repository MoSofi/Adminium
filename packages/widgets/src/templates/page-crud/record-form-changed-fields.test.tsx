// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * AN EDIT SENDS WHAT CHANGED.
 *
 * An edit form used to send every field it showed, so saving one field wrote
 * the whole row back as it stood when the form opened: whatever a trigger, a
 * job or a second person had changed in the meantime was silently put back.
 * Now a field left as it was is neither sent nor checked — unless the change
 * made it required. A new record still sends everything.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpec, type GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { RecordForm } from './RecordForm.js';
import { unchangedField, type ColumnFact, type ColumnFacts } from './field-mapping.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const fact = (over: Partial<ColumnFact> = {}): ColumnFact => ({ filledBy: null, required: false, writable: true, ...over });

const COLUMNS = [
  spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
  spec({ name: 'title', label: 'Title', logicalType: 'varchar', nullable: false, maxLength: 80 }),
  spec({ name: 'status', label: 'Status', logicalType: 'enum', enumValues: ['open', 'closed'], nullable: false }),
  spec({ name: 'price', label: 'Price', logicalType: 'decimal', nullable: true }),
  spec({ name: 'notes', label: 'Notes', logicalType: 'varchar', maxLength: 200 }),
];

const FACTS: ColumnFacts = {
  id: fact({ filledBy: 'database' }),
  title: fact({ required: true }),
  status: fact({ required: true }),
  price: fact(),
  notes: fact(),
};

function form(props: Partial<React.ComponentProps<typeof RecordForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <RecordForm
      columns={COLUMNS}
      mode="edit"
      facts={FACTS}
      initialValues={{ id: 7, title: 'Fix the gate', status: 'open', price: '12.50', notes: null }}
      onSubmit={onSubmit}
      footer={<button type="submit">Save</button>}
      {...props}
    />,
  );
  return { onSubmit };
}

describe('an edit form', () => {
  it('sends only the field that changed — a second writer’s change is left alone', async () => {
    // Someone closed the record after this form opened. Editing the notes must
    // not send `status: 'open'` back over their change.
    const { onSubmit } = form();
    await userEvent.type(screen.getByLabelText(/Notes/), 'Checked on site');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ notes: 'Checked on site' });
  });

  it('sends nothing when nothing changed', async () => {
    const { onSubmit } = form();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({});
  });

  it('does not refuse a required field kept blank from before, when it was not touched', async () => {
    const { onSubmit } = form({ initialValues: { id: 7, title: null, status: 'open', price: null, notes: null } });
    await userEvent.type(screen.getByLabelText(/Notes/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByText('This field is required.')).toBeNull();
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ notes: 'x' });
  });

  it('still refuses a required field emptied on this form', async () => {
    const { onSubmit } = form();
    await userEvent.clear(screen.getByLabelText(/Title/));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('This field is required.')).toBeTruthy();
  });

  it('checks an untouched field the change made required', async () => {
    const columns = [
      spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
      spec({ name: 'kind', label: 'Kind', logicalType: 'enum', enumValues: ['office', 'away'], nullable: false }),
      spec({ name: 'person', label: 'Person', logicalType: 'varchar', maxLength: 80 }),
    ];
    const facts: ColumnFacts = {
      id: fact({ filledBy: 'database' }),
      kind: fact({ required: true }),
      person: fact({ requiredWhen: { column: 'kind', in: ['away'] } }),
    };
    const { onSubmit } = form({ columns, facts, initialValues: { id: 1, kind: 'office', person: null } });
    await userEvent.click(screen.getByRole('radio', { name: /away/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('This field is required.')).toBeTruthy();
  });
});

describe('a new record', () => {
  it('still sends every field', async () => {
    const { onSubmit } = form({ mode: 'create', initialValues: { title: 'New', status: 'open' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ title: 'New', status: 'open', price: null, notes: null });
  });
});

describe('unchangedField', () => {
  it('compares values as they would be sent', () => {
    const price = COLUMNS[3]!;
    const notes = COLUMNS[4]!;
    // A decimal the database handed back as text, and the same number typed.
    expect(unchangedField(price, '12.5', '12.50')).toBe(true);
    expect(unchangedField(price, '12.6', '12.50')).toBe(false);
    // Blank and null are the same nothing on a nullable column.
    expect(unchangedField(notes, '', null)).toBe(true);
    const tags = spec({ name: 'tags', label: 'Tags', logicalType: 'json', nullable: true });
    expect(unchangedField(tags, '{"b":1,"a":[1,2]}', { a: [1, 2], b: 1 })).toBe(true);
    expect(unchangedField(tags, { a: [2, 1], b: 1 }, { a: [1, 2], b: 1 })).toBe(false);
  });
});
