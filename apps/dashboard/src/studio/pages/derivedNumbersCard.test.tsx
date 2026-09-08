// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The "Derived numbers" card (36-derived-columns.md 36-T18 / D30).
 *
 * Three properties, each of which a different half of the plan depends on:
 * every preset must produce a block the SHIPPED parser accepts (an invalid one
 * is a 422 that blanks the whole page on read), the card must never write on
 * its own (one save assembles the whole config body), and adding a number must
 * author BOTH halves — the field and the column that shows it.
 */
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCrudDerived, type CrudDerivedConfig } from '@adminium/engine/config';

import { createQueryClient } from '../../app/query.js';
import { jsonResponse } from '../../test/fixtures.js';
import { DerivedNumbersCard } from './DerivedNumbersCard.js';
import type { StoredColumn } from './ColumnManager.js';

const schemaReply = {
  connectionId: 'conn_1',
  snapshotId: 'snap_1',
  checksum: 'x',
  createdAt: 0,
  source: 'introspection',
  appliedOverrides: 0,
  model: {
    enums: [],
    tables: [
      {
        id: 'main.invoices',
        schema: 'main',
        name: 'invoices',
        rowCountEstimate: null,
        primaryKey: ['invoice_id'],
        columns: [
          { name: 'invoice_id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
          // The 0-100 percent on the PARENT — the operand ask 2 needs.
          { name: 'tax_rate', ordinal: 2, logicalType: 'decimal', nullable: false },
        ],
      },
    ],
    relations: [],
  },
};

/** Two folds, as the Columns card would have written them. */
const DERIVED: CrudDerivedConfig = {
  measures: [
    {
      id: 'subtotal',
      table: 'main.line_items',
      fkColumn: 'invoice_id',
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
    },
    {
      id: 'gross',
      table: 'main.line_items',
      fkColumn: 'invoice_id',
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] },
    },
  ],
  fields: [],
};

const BASE_COLUMNS: StoredColumn[] = [
  { name: 'invoice_id', label: 'Invoice', logicalType: 'integer' },
  { name: 'subtotal', label: 'Sum of line total', derived: { ref: 'subtotal' } },
  { name: 'gross', label: 'Sum of qty', derived: { ref: 'gross' } },
];

interface Recorded {
  method: string;
  path: string;
}

function stubFetch(): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', path: String(input) });
      if (String(input).includes('/schema')) return jsonResponse(200, schemaReply);
      return jsonResponse(200, { data: [] });
    }),
  );
  return calls;
}

/** Plays the edit screen: owns both halves of the body, writes nothing. */
function Harness() {
  const [columns, setColumns] = useState<StoredColumn[]>(BASE_COLUMNS);
  const [derived, setDerived] = useState<CrudDerivedConfig>(DERIVED);
  return (
    <>
      <DerivedNumbersCard
        columns={columns}
        onColumnsChange={setColumns}
        derived={derived}
        onDerivedChange={setDerived}
        source={{ connectionId: 'conn_1', table: 'main.invoices' }}
      />
      <pre data-testid="state">{JSON.stringify({ columns, derived })}</pre>
    </>
  );
}

function renderCard() {
  const calls = stubFetch();
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { calls };
}

function state(): { columns: StoredColumn[]; derived: CrudDerivedConfig } {
  return JSON.parse(screen.getByTestId('state').textContent ?? '{}') as {
    columns: StoredColumn[];
    derived: CrudDerivedConfig;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DerivedNumbersCard', () => {
  it('lists the folds the Columns card authored', () => {
    renderCard();
    expect(screen.getByTestId('studio-pages-derived-measure-subtotal')).toBeTruthy();
    expect(screen.getByTestId('studio-pages-derived-measure-gross')).toBeTruthy();
  });

  it('preset 1 — a difference of two folds (the discount ask)', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId('studio-pages-derived-preset-combine'));
    await user.type(screen.getByTestId('studio-pages-derived-label'), 'Discount');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-left'), 'gross');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-right'), 'subtotal');
    await user.click(screen.getByTestId('studio-pages-derived-add'));

    const { derived, columns } = state();
    expect(derived.fields).toEqual([
      {
        id: 'discount',
        scale: 2,
        expr: { op: 'sub', args: [{ measure: 'gross' }, { measure: 'subtotal' }] },
      },
    ]);
    // Both halves, one act: a field with no column renders nowhere.
    const column = columns.find((entry) => entry.derived?.ref === 'discount');
    expect(column?.label).toBe('Discount');
    expect(column?.display).toEqual({ kind: 'currency', decimals: 2 });
    expect(column?.sortable).toBe(false);
    expect(parseCrudDerived(derived).ok).toBe(true);
  });

  it('preset 2 — a percentage of a fold using this row’s own column (the tax ask)', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId('studio-pages-derived-preset-percent'));
    await user.type(screen.getByTestId('studio-pages-derived-label'), 'Tax');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-left'), 'subtotal');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-column'), 'tax_rate');
    await user.click(screen.getByTestId('studio-pages-derived-add'));

    const { derived } = state();
    // `× (col ÷ 100)`, the only division the grammar allows anywhere: by a
    // literal, at field level, never inside the fold (D6).
    expect(derived.fields[0]?.expr).toEqual({
      op: 'mul',
      args: [{ measure: 'subtotal' }, { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] }],
    });
    expect(parseCrudDerived(derived).ok).toBe(true);
  });

  it('preset 3 — a threshold rule (the shipping ask), and it reads an earlier field', async () => {
    const user = userEvent.setup();
    renderCard();
    // First a total, so the rule has a field — not just a fold — to branch on.
    await user.click(screen.getByTestId('studio-pages-derived-preset-combine'));
    await user.type(screen.getByTestId('studio-pages-derived-label'), 'Amount due');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-op'), 'add');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-left'), 'subtotal');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-right'), 'gross');
    await user.click(screen.getByTestId('studio-pages-derived-add'));

    await user.click(screen.getByTestId('studio-pages-derived-preset-rule'));
    await user.type(screen.getByTestId('studio-pages-derived-label'), 'Shipping');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-left'), 'amount_due');
    await user.click(screen.getByTestId('studio-pages-derived-add'));

    const { derived } = state();
    expect(derived.fields[1]).toEqual({
      id: 'shipping',
      scale: 2,
      expr: {
        cases: [
          { when: { left: { field: 'amount_due' }, cmp: 'gte', right: { lit: '500' } }, then: { lit: '0' } },
        ],
        else: { lit: '12.50' },
      },
    });
    // Backward reference, which is the only direction the grammar allows.
    expect(parseCrudDerived(derived).ok).toBe(true);
  });

  it('previews with the SHIPPED evaluator, over editable sample inputs', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId('studio-pages-derived-preset-combine'));
    await user.type(screen.getByTestId('studio-pages-derived-label'), 'Discount');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-left'), 'gross');
    await user.selectOptions(screen.getByTestId('studio-pages-derived-right'), 'subtotal');
    await user.click(screen.getByTestId('studio-pages-derived-add'));

    // Both sample inputs default to 100, so the difference is zero.
    expect(screen.getByTestId('studio-pages-derived-value-discount').textContent).toBe('0.00');
    await user.clear(screen.getByTestId('studio-pages-derived-sample-gross'));
    await user.type(screen.getByTestId('studio-pages-derived-sample-gross'), '1300');
    await user.clear(screen.getByTestId('studio-pages-derived-sample-subtotal'));
    await user.type(screen.getByTestId('studio-pages-derived-sample-subtotal'), '1266');
    expect(screen.getByTestId('studio-pages-derived-value-discount').textContent).toBe('34.00');
  });

  it('never writes on its own — the screen owns the one save', async () => {
    const user = userEvent.setup();
    const { calls } = renderCard();
    await user.click(screen.getByTestId('studio-pages-derived-preset-combine'));
    await user.type(screen.getByTestId('studio-pages-derived-label'), 'Discount');
    await user.click(screen.getByTestId('studio-pages-derived-add'));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('removes a number and the column that showed it, together', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId('studio-pages-derived-preset-combine'));
    await user.type(screen.getByTestId('studio-pages-derived-label'), 'Discount');
    await user.click(screen.getByTestId('studio-pages-derived-add'));
    expect(state().columns.some((column) => column.derived?.ref === 'discount')).toBe(true);

    const row = screen.getByTestId('studio-pages-derived-field-discount');
    await user.click(screen.getByRole('button', { name: 'Remove discount' }));
    expect(row).toBeTruthy();
    expect(state().derived.fields).toEqual([]);
    expect(state().columns.some((column) => column.derived?.ref === 'discount')).toBe(false);
  });
});
