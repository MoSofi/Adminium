// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * SEVERAL references in the form (F8, D22).
 *
 * A relation is not a column: its value is a list of keys that becomes rows of
 * a join table, and it travels beside the row rather than inside it. The three
 * claims worth making are that it REACHES the form without anybody designing
 * one, that what it submits is separate from the values, and that an edit
 * starts from the links the record already has — a set seeded empty would
 * silently unlink everything the first time somebody fixed a typo.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deriveFormDocument } from '../../page-config/index.js';
import { gridColumnSpecSchema, type GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { RecordForm } from './RecordForm.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true, nullable: false }),
  spec({ name: 'who', label: 'Who', logicalType: 'varchar', nullable: false }),
];

const RELATIONS = [
  {
    relationId: 'm2m:booking_services',
    label: 'Services',
    targetTable: 'public.services',
    targetKey: 'id',
  },
];

const SERVICES = [
  { value: '1', label: 'Cleaning', detail: 'Bldg 1' },
  { value: '2', label: 'Check-up', detail: 'Bldg 2' },
];

function renderForm(options: { initialLinks?: Record<string, { value: string; label: string }[]> } = {}) {
  const onSubmit = vi.fn();
  const lookup = vi.fn().mockResolvedValue(SERVICES);
  const document = deriveFormDocument({
    columns: [
      { spec: COLUMNS[0]!, ordinal: 1, writable: true, filledBy: 'database', required: false },
      { spec: COLUMNS[1]!, ordinal: 2, writable: true, filledBy: null, required: true },
    ],
    relations: RELATIONS,
  });
  render(
    <RecordForm
      columns={COLUMNS}
      document={document}
      relations={RELATIONS}
      {...(options.initialLinks === undefined ? {} : { initialLinks: options.initialLinks })}
      initialValues={{ who: 'Ada' }}
      mode={options.initialLinks === undefined ? 'create' : 'edit'}
      lookup={lookup as never}
      onSubmit={onSubmit}
      formId="links-form"
      footer={<button type="submit">Save</button>}
    />,
  );
  return { onSubmit, lookup, user: userEvent.setup() };
}

describe('a relation field', () => {
  it('reaches a form nobody designed, and submits its keys beside the values', async () => {
    const { onSubmit, user } = renderForm();
    const picker = await screen.findByLabelText('Services');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /Cleaning/ }));
    expect(screen.getByTestId('reference-chips').textContent).toContain('Cleaning');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [values, links] = onSubmit.mock.calls[0] as [Record<string, unknown>, Record<string, string[]>];
    // The keys are NOT a column of this row: folding them into `values` would
    // put a name the table does not have into the write path.
    expect(values).not.toHaveProperty('rel:m2m:booking_services');
    expect(links).toEqual({ 'm2m:booking_services': ['1'] });
  });

  it('starts an edit from the links the record already has', async () => {
    const { onSubmit, user } = renderForm({
      initialLinks: { 'm2m:booking_services': [{ value: '2', label: 'Check-up' }] },
    });
    expect(screen.getByTestId('reference-chips').textContent).toContain('Check-up');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // A save that touched nothing else replaces the set with ITSELF. Seeding it
    // empty would unlink everything the first time somebody fixed a typo.
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ 'm2m:booking_services': ['2'] });
  });

  it('removes a chip, and sends the shorter set', async () => {
    const { onSubmit, user } = renderForm({
      initialLinks: {
        'm2m:booking_services': [
          { value: '1', label: 'Cleaning' },
          { value: '2', label: 'Check-up' },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: /Remove Cleaning/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ 'm2m:booking_services': ['2'] });
  });

  it('sends no links at all from a form that has no relation field', async () => {
    const onSubmit = vi.fn();
    render(
      <RecordForm
        columns={COLUMNS}
        mode="create"
        initialValues={{ who: 'Ada' }}
        onSubmit={onSubmit}
        formId="plain-form"
        footer={<button type="submit">Save</button>}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // An empty object would be a key an older server does not know.
    expect(onSubmit.mock.calls[0]?.length).toBe(1);
  });
});

describe("a relation field's picker", () => {
  it("calls the linked table by its name, never its id", async () => {
    const relations = [{ ...RELATIONS[0]!, targetLabel: 'Visit types' }];
    const form = deriveFormDocument({
      columns: [{ spec: COLUMNS[1]!, ordinal: 1, writable: true, filledBy: null, required: true }],
      relations,
    });
    render(
      <RecordForm
        columns={COLUMNS}
        document={form}
        relations={relations}
        initialValues={{ who: 'Ada' }}
        mode="create"
        lookup={vi.fn().mockResolvedValue(SERVICES) as never}
        onSubmit={vi.fn()}
        formId="named-form"
        footer={null}
      />,
    );
    const picker = await screen.findByLabelText('Services');
    expect(picker.getAttribute('placeholder') ?? picker.textContent ?? '').toContain('Visit types');
    expect(document.body.textContent).not.toContain('public.services');
  });
});
