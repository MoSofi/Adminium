// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * REQUIRED FIELDS, AND REFUSED ONES.
 *
 * Two unreachable paths, made reachable:
 *
 *   · `required` was DECORATION — an asterisk and `aria-required`, with
 *     nothing checking either. A blank NOT NULL field went to the server,
 *     which answered 500 with no column named.
 *   · nothing in the product ever produced `fieldErrors`, so every refused
 *     write was a toast and the field that caused it stayed unmarked.
 *
 * Both now end with a message under the field the person has to fix.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpec, type GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { RecordForm } from './RecordForm.js';
import { fieldMessagesOf } from './field-issues.js';
import type { ColumnFact, ColumnFacts } from './field-mapping.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
  spec({ name: 'full_name', label: 'Full name', logicalType: 'varchar', nullable: false, maxLength: 80 }),
  spec({ name: 'notes', label: 'Notes', logicalType: 'varchar', maxLength: 200 }),
  spec({ name: 'created_at', label: 'Created', logicalType: 'timestamptz', semantic: 'created-at', nullable: false }),
];

const fact = (over: Partial<ColumnFact> = {}): ColumnFact => ({
  filledBy: null,
  required: false,
  writable: true,
  ...over,
});

/** The owner's table: the key and `created_at` are filled, the name is not. */
const FACTS: ColumnFacts = {
  id: fact({ filledBy: 'database' }),
  full_name: fact({ required: true }),
  notes: fact(),
  created_at: fact({ filledBy: 'adminium' }),
};

function form(props: Partial<React.ComponentProps<typeof RecordForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <RecordForm
      columns={COLUMNS}
      mode="create"
      facts={FACTS}
      formId="test-form"
      onSubmit={onSubmit}
      footer={<button type="submit">Add</button>}
      {...props}
    />,
  );
  return { onSubmit };
}

describe('a required field the person left blank', () => {
  it('is refused by the form, with the message under it, and nothing is sent', async () => {
    const { onSubmit } = form();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('This field is required.')).toBeTruthy();
    // The control says so too, for anybody not reading the caption.
    expect(screen.getByLabelText(/Full name/).getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the message as soon as the field is edited', async () => {
    form();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.queryByText('This field is required.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Full name/), 'Ada');
    expect(screen.queryByText('This field is required.')).toBeNull();
  });

  it('sends the row once the required value is there, and omits the filled columns', async () => {
    const { onSubmit } = form();
    await userEvent.type(screen.getByLabelText(/Full name/), 'Ada Lovelace');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // `id` and `created_at` are filled by somebody else and are not even
    // rendered; `notes` is blank and nullable, so it goes as null.
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ full_name: 'Ada Lovelace', notes: null });
  });

  it('shows the created_at the facts say nothing fills', () => {
    form({ facts: { ...FACTS, created_at: fact({ required: true }) } });
    expect(screen.getByLabelText(/Created/)).toBeTruthy();
  });
});

describe('a value the server refused', () => {
  it('renders under the column the server named', () => {
    form({ errors: { full_name: 'Choose one of the listed values.' } });
    expect(screen.getByText('Choose one of the listed values.')).toBeTruthy();
  });
});

describe('reading a refusal off an API error', () => {
  const t = (_key: string, fallback: string, args?: Record<string, unknown>): string =>
    fallback.replace(/\{(\w+)\}/g, (_m, name: string) => String(args?.[name] ?? ''));

  it('turns the server’s codes into sentences, per column', () => {
    expect(
      fieldMessagesOf(t, { fieldIssues: { status: { code: 'not-allowed' }, name: { code: 'required' } } }),
    ).toEqual({
      status: 'Choose one of the listed values.',
      name: 'This field is required.',
    });
  });

  it('carries the bound a message needs', () => {
    expect(fieldMessagesOf(t, { fieldIssues: { name: { code: 'too-long', n: 80 } } })).toEqual({
      name: 'Use at most 80 characters.',
    });
  });

  it('never shows a raw code for one it does not know', () => {
    expect(fieldMessagesOf(t, { fieldIssues: { name: { code: 'too_wibbly' } } })).toEqual({
      name: 'This value is not valid here.',
    });
  });

  it('leaves everything else a toast', () => {
    expect(fieldMessagesOf(t, new Error('offline'))).toBeNull();
    expect(fieldMessagesOf(t, { fieldIssues: {} })).toBeNull();
    expect(fieldMessagesOf(t, null)).toBeNull();
  });
});
