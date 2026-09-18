// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE LINE-ITEMS REPEATER, in a form.
 *
 * The arithmetic is pinned in `test/child-totals.test.ts`; what is here is the
 * FORM's half: that lines are edited as rows of another table, that the totals
 * follow what is typed rather than what was saved, that removing a line removes
 * it, and — the one that decides whether any of this is safe — that the rows
 * leave the form as `children` and not as columns of the parent.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  gridColumnSpecSchema,
  type GridColumnSpec,
  type GridColumnSpecInput,
} from '../../../families/tables/column-spec.js';
import { RecordForm, type ChildFacts } from '../RecordForm.js';
import type { CrudFormConfig } from '../../../page-config/index.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

const PARENT = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true }),
  spec({ name: 'who', label: 'Customer', logicalType: 'varchar', nullable: false }),
];

const LINE_COLUMNS = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true }),
  spec({ name: 'item', label: 'Item', logicalType: 'varchar', nullable: false }),
  spec({ name: 'qty', label: 'Qty', logicalType: 'integer' }),
  spec({ name: 'unit', label: 'Unit', logicalType: 'decimal' }),
  spec({ name: 'line_total', label: 'Total', logicalType: 'decimal' }),
];

const RELATION = 'rel_invoice_lines';

const CHILD_FACTS: Record<string, ChildFacts> = {
  [RELATION]: {
    label: 'Line items',
    table: 'main.invoice_lines',
    foreignColumn: 'invoice_id',
    parentKeyColumn: 'id',
    primaryKey: ['id'],
    columns: LINE_COLUMNS,
  },
};

const DOCUMENT: CrudFormConfig = {
  v: 2,
  preset: 'repeater-totals',
  sections: [
    {
      id: 'main',
      columns: 1,
      fields: [
        { column: 'who' },
        {
          relation: RELATION,
          control: 'child-rows',
          label: 'Line items',
          columns: [
            { column: 'item', width: '1fr' },
            { column: 'qty', width: '70px' },
            { column: 'unit', width: '96px' },
            { column: 'line_total', width: '92px', readOnly: true },
          ],
          totals: {
            row: { expr: { op: 'mul', args: [{ col: 'qty' }, { col: 'unit' }] } },
            rows: [
              { label: 'Subtotal', of: 'sum' },
              { label: 'Tax', of: 'rate', rate: '0.085' },
              { label: 'Total', of: 'total' },
            ],
          },
        },
      ],
    },
  ],
} as CrudFormConfig;

function renderForm(over: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  render(
    <RecordForm
      columns={PARENT}
      document={DOCUMENT}
      childFacts={CHILD_FACTS}
      mode="create"
      onSubmit={onSubmit}
      formId="lines-form"
      footer={<button type="submit">Save</button>}
      {...over}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('the line-items repeater', () => {
  it('draws the comp’s header and nothing else until a line is added', () => {
    renderForm();
    expect(screen.getByTestId('child-head').textContent).toContain('Item');
    expect(screen.queryAllByTestId('child-row')).toHaveLength(0);
  });

  it('adds a line, totals it as it is typed, and totals the lines', async () => {
    const { user } = renderForm();
    await user.click(screen.getByTestId('child-add'));
    await user.click(screen.getByTestId('child-add'));
    expect(screen.getAllByTestId('child-row')).toHaveLength(2);

    await user.type(screen.getByLabelText('Qty 1'), '2');
    await user.type(screen.getByLabelText('Unit 1'), '10');
    await user.type(screen.getByLabelText('Qty 2'), '1');
    await user.type(screen.getByLabelText('Unit 2'), '5.50');

    // The line's own total is COMPUTED, not typed — and it follows the values
    // in the form, which no database has seen.
    await waitFor(() => expect(screen.getByTestId('child-total-0').textContent).toBe('20.00'));
    expect(screen.getByTestId('child-total-sum').textContent).toBe('25.50');
    expect(screen.getByTestId('child-total-rate').textContent).toBe('2.17');
    expect(screen.getByTestId('child-total-total').textContent).toBe('27.67');
  });

  it('removes a line, and the totals follow', async () => {
    const { user } = renderForm();
    await user.click(screen.getByTestId('child-add'));
    await user.type(screen.getByLabelText('Qty 1'), '3');
    await user.type(screen.getByLabelText('Unit 1'), '4');
    await waitFor(() => expect(screen.getByTestId('child-total-sum').textContent).toBe('12.00'));

    await user.click(screen.getAllByTestId('child-remove')[0] as HTMLElement);
    expect(screen.queryAllByTestId('child-row')).toHaveLength(0);
    expect(screen.getByTestId('child-total-sum').textContent).toBe('0.00');
  });

  it('sends the lines as CHILDREN, never as columns of the parent', async () => {
    const { onSubmit, user } = renderForm();
    await user.type(screen.getByLabelText(/^Customer/), 'Initech');
    await user.click(screen.getByTestId('child-add'));
    await user.type(screen.getByLabelText('Item 1'), 'Cable');
    await user.type(screen.getByLabelText('Qty 1'), '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [values, , children] = onSubmit.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      Record<string, { key?: unknown; values: Record<string, unknown> }[]>,
    ];
    expect(values).toEqual({ who: 'Initech' });
    // `line_total` is the read-only column the field names: the computed value
    // is stamped into it at submit, and nothing else about the block is sent.
    expect(children[RELATION]).toEqual([{ values: { item: 'Cable', qty: '2', line_total: '0.00' } }]);
    // The foreign key is the parent's business and never leaves the form.
    expect(children[RELATION]?.[0]?.values).not.toHaveProperty('invoice_id');
  });

  it('keeps an existing line’s KEY, so a save can tell a change from an insert', async () => {
    const { onSubmit, user } = renderForm({
      initialValues: { id: 7, who: 'Acme' },
      mode: 'edit',
      initialChildren: { [RELATION]: [{ key: { id: 31 }, values: { id: 31, item: 'Anvil', qty: 1 } }] },
    });
    await user.clear(screen.getByLabelText('Qty 1'));
    await user.type(screen.getByLabelText('Qty 1'), '9');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const children = (onSubmit.mock.calls[0] as unknown[])[2] as Record<
      string,
      { key?: Record<string, unknown>; values: Record<string, unknown> }[]
    >;
    expect(children[RELATION]?.[0]?.key).toEqual({ id: 31 });
    expect(children[RELATION]?.[0]?.values['qty']).toBe('9');
  });

  it('stores a line\u2019s computed total only where a column holds it', async () => {
    const { onSubmit, user } = renderForm();
    await user.type(screen.getByLabelText(/^Customer/), 'Acme');
    await user.click(screen.getByTestId('child-add'));
    await user.type(screen.getByLabelText('Qty 1'), '2');
    await user.type(screen.getByLabelText('Unit 1'), '7.25');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const children = (onSubmit.mock.calls[0] as unknown[])[2] as Record<
      string,
      { values: Record<string, unknown> }[]
    >;
    // The read-only column the field names gets it; the totals BLOCK is never
    // stored, because computing a number into a column that does not exist is
    // the one thing a totals block must not do.
    expect(children[RELATION]?.[0]?.values['line_total']).toBe('14.50');
    expect(children[RELATION]?.[0]?.values).not.toHaveProperty('Subtotal');
  });

  it('renders nothing for a relation the page reply does not describe', () => {
    render(
      <RecordForm
        columns={PARENT}
        document={DOCUMENT}
        mode="create"
        onSubmit={vi.fn()}
        formId="lines-form-2"
        footer={<button type="submit">Save</button>}
      />,
    );
    // Absent facts degrade to an absent field, the same as every other
    // fact-dependent control — never to a broken dialog.
    expect(screen.queryByTestId('child-rows')).toBeNull();
  });
});
