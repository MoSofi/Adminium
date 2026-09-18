// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The reference picker: what it asks the server for, and what it draws.
 *
 * The settings a field carries decide the REQUEST — the name column and up to
 * two detail columns — so the assertions here are on the call as much as on
 * the rows. A picker that renders the right label from the wrong payload is
 * still pulling whole rows of a table it only needed two columns of.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpecInput } from '../../../families/tables/column-spec.js';
import type { CrudFormColumnField } from '../../../page-config/index.js';
import { ReferenceControl, initialsOf } from './reference.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const DOCTOR = spec({
  name: 'doctor_id',
  label: 'Primary physician',
  logicalType: 'integer',
  fk: { table: 'public.providers', column: 'id', display: 'full_name' },
});

const ROWS = [
  { value: '1', label: 'Amara Osei', detail: 'Internal medicine · Bldg 2' },
  { value: '2', label: 'Ben Halloran', detail: 'Family practice · Bldg 1' },
];

function renderPicker(options: {
  field?: CrudFormColumnField | undefined;
  value?: unknown;
  lookup?: ReturnType<typeof vi.fn>;
} = {}) {
  const lookup = options.lookup ?? vi.fn().mockResolvedValue(ROWS);
  const onChange = vi.fn();
  render(
    <ReferenceControl
      column={DOCTOR}
      {...(options.field === undefined ? {} : { field: options.field })}
      value={options.value ?? null}
      onChange={onChange}
      options={[]}
      mode="create"
      lookup={lookup as never}
      aria-label="Primary physician"
    />,
  );
  return { lookup, onChange, user: userEvent.setup() };
}

describe('the reference picker', () => {
  it('asks for the columns the field names, and nothing else', async () => {
    const field: CrudFormColumnField = {
      column: 'doctor_id',
      reference: { name: 'full_name', detail: ['speciality', 'building'], avatar: true },
    };
    const { lookup } = renderPicker({ field });
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(lookup.mock.calls[0]).toEqual([
      { table: 'public.providers', column: 'id', display: 'full_name' },
      '',
      { name: 'full_name', detail: ['speciality', 'building'] },
    ]);
  });

  it('sends no settings when the field carries none — the display column alone', async () => {
    const { lookup } = renderPicker();
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(lookup.mock.calls[0]?.[2]).toBeUndefined();
  });

  it('draws the name, the detail line and the avatar the field asked for', async () => {
    const field: CrudFormColumnField = { column: 'doctor_id', reference: { avatar: true } };
    const { user } = renderPicker({ field });
    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Amara Osei')).toBeTruthy();
    expect(screen.getByText('Internal medicine · Bldg 2')).toBeTruthy();
    // Initials, not a photo: the target's rows carry no image and a coloured
    // circle with two letters is what the comp draws.
    expect(screen.getByText('AO')).toBeTruthy();
  });

  it('keeps a value the search no longer returns, as its raw key', async () => {
    const { user } = renderPicker({ value: 99 });
    await user.click(screen.getByRole('combobox'));
    // The row was deleted, or it is past the first twenty. Dropping it would
    // blank a value nobody touched the moment anything else was saved.
    expect(await screen.findByRole('option', { name: /99/ })).toBeTruthy();
  });

  it('disables itself, with the reason, when the target cannot be read', async () => {
    const lookup = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    renderPicker({ lookup, value: 7 });
    // F16: an empty picker would say "there is nothing to choose", which is a
    // different and untrue statement.
    expect(await screen.findByText(/cannot read public\.providers/)).toBeTruthy();
    expect((screen.getByDisplayValue('7') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps working when a search simply fails', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('network'));
    renderPicker({ lookup });
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    // A dropped request is not a refusal: the field stays usable.
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words, and copes with one', () => {
    expect(initialsOf('Amara Osei')).toBe('AO');
    expect(initialsOf('Northwind Mutual Insurance')).toBe('NM');
    expect(initialsOf('acme')).toBe('A');
    expect(initialsOf('   ')).toBe('?');
  });
});
