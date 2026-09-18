// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE RECAP BOX.
 *
 * It writes nothing and stores nothing, so the only things worth pinning are
 * the two ways it can lie: printing a stored CODE where the rest of the screen
 * prints a label, and printing a template placeholder at somebody when the
 * field it names is still empty.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  gridColumnSpecSchema,
  type GridColumnSpec,
  type GridColumnSpecInput,
} from '../../families/tables/column-spec.js';
import { RecordForm } from './RecordForm.js';
import type { CrudFormConfig } from '../../page-config/index.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({
    name: 'shipping',
    label: 'Shipping',
    logicalType: 'enum',
    enumValues: ['std', 'express'],
  }),
  spec({ name: 'seats', label: 'Seats', logicalType: 'integer' }),
  spec({ name: 'rate', label: 'Rate', logicalType: 'decimal' }),
];

const OPTIONS = {
  shipping: { values: [{ value: 'std', label: 'Standard shipping' }, { value: 'express', label: 'Express' }] },
};

const DOCUMENT: CrudFormConfig = {
  v: 2,
  preset: 'sectioned',
  sections: [
    {
      id: 'main',
      columns: 2,
      fields: [
        { column: 'shipping' },
        { column: 'seats' },
        { column: 'rate' },
        {
          recap: {
            sentence: '{shipping} · {seats} seats',
            value: { expr: { op: 'mul', args: [{ col: 'seats' }, { col: 'rate' }] } },
            icon: 'sparkles',
          },
        },
      ],
    },
  ],
} as CrudFormConfig;

function renderForm(over: Record<string, unknown> = {}) {
  render(
    <RecordForm
      columns={COLUMNS}
      document={DOCUMENT}
      facts={{ shipping: { filledBy: null, required: false, writable: true, options: OPTIONS.shipping } }}
      mode="create"
      onSubmit={vi.fn()}
      formId="recap-form"
      footer={<button type="submit">Save</button>}
      {...over}
    />,
  );
  return { user: userEvent.setup() };
}

describe('one record per chip', () => {
  const CHIPS = [
    spec({ name: 'email', label: 'Email addresses', logicalType: 'json' }),
    spec({ name: 'role', label: 'Role', logicalType: 'varchar' }),
  ];
  const INVITES: CrudFormConfig = {
    v: 2,
    preset: 'multi-entry',
    sections: [
      {
        id: 'main',
        columns: 1,
        fields: [{ column: 'email', control: 'chips', itemFormat: 'email', each: 'record' }, { column: 'role' }],
      },
    ],
  } as CrudFormConfig;

  it('sends the chips as N records, not as a list in one column', async () => {
    const onSubmit = vi.fn();
    render(
      <RecordForm
        columns={CHIPS}
        document={INVITES}
        mode="create"
        initialValues={{ email: ['ada@x.test', 'grace@x.test'], role: 'member' }}
        onSubmit={onSubmit}
        formId="invite-form"
        footer={<button type="submit">Save</button>}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [values, , , repeat] = onSubmit.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      unknown,
      { column: string; values: string[] },
    ];
    // The column carries ONE address per row; the payload must not also claim
    // the list is a value of this row.
    expect(values).not.toHaveProperty('email');
    expect(values['role']).toBe('member');
    expect(repeat).toEqual({ column: 'email', values: ['ada@x.test', 'grace@x.test'] });
  });

  it('refuses an empty list rather than creating nothing quietly', async () => {
    const onSubmit = vi.fn();
    render(
      <RecordForm
        columns={CHIPS}
        document={INVITES}
        mode="create"
        initialValues={{ role: 'member' }}
        onSubmit={onSubmit}
        formId="invite-form-2"
        footer={<button type="submit">Save</button>}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    // Zero records created, reported as nothing happening, is the worst answer
    // available: it looks like a save.
    await waitFor(() => expect(screen.getByText('This field is required.')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('the recap box', () => {
  it('prints the option LABEL, never the stored code', async () => {
    const { user } = renderForm();
    await user.selectOptions(screen.getByLabelText(/^Shipping/), 'std');
    await waitFor(() =>
      expect(screen.getByTestId('form-recap-sentence').textContent).toContain('Standard shipping'),
    );
    // `std` is what the column holds and what every other screen hides.
    expect(screen.getByTestId('form-recap-sentence').textContent).not.toContain('std ·');
  });

  it('computes its value from what is on screen, not from what is saved', async () => {
    const { user } = renderForm();
    await user.type(screen.getByLabelText(/^Seats/), '3');
    await user.type(screen.getByLabelText(/^Rate/), '12.50');
    await waitFor(() => expect(screen.getByTestId('form-recap-value').textContent).toBe('37.50'));
  });

  it('leaves a placeholder EMPTY rather than printing the template', () => {
    renderForm();
    const sentence = screen.getByTestId('form-recap-sentence').textContent ?? '';
    // Half a sentence beats `{shipping}` leaking into the UI.
    expect(sentence).not.toContain('{');
    expect(sentence).toContain('seats');
  });

  it('sends nothing of its own', async () => {
    const onSubmit = vi.fn();
    const { user } = renderForm({ onSubmit });
    await user.type(screen.getByLabelText(/^Seats/), '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Not one key of its own: no `recap`, no `{sentence}`, no computed value.
    const sent = Object.keys(onSubmit.mock.calls[0]?.[0] as object);
    expect(sent.some((key) => key.startsWith('recap'))).toBe(false);
    expect(sent).toContain('seats');
  });
});
