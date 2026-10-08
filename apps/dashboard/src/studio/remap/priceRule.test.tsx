// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A column a price rule writes says so in the inspector, naming the table
 * whose rule it is — on the order and on the tables under it. The rule is the
 * table's: nothing on the column removes it.
 */
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { priceRuleWrites } from './ColumnInspector.js';
import { installFetch, renderEditor } from './test-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const rule = {
  adjuster: 'price-kit',
  order: { discount: 'total', staff: { by: 'customer_id' }, customer: { proved: 'status' } },
  lines: [{ table: 'public.order_notes', via: 'order_ref', discount: 'body' }],
};

const stored = () => [{ id: 'ovr_adjust', op: 'table.adjust', tableName: 'public.orders', columnName: null, value: rule, origin: 'app', status: 'active', createdAt: 1, updatedAt: 1 }];

async function open(table: RegExp, column: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: table }));
  await userEvent.click(await screen.findByRole('button', { name: column }));
  await screen.findByTestId('column-inspector');
}

describe('a column a price rule writes', () => {
  it('is named on the order and on a table under it, with nothing to remove', async () => {
    installFetch({ overridesRows: stored });
    renderEditor();
    await open(/Orders/, /Total/);
    const own = await screen.findByTestId('rules-priced');
    expect(own.textContent).toBe('Decided by AdminiumWritten by the price rule of Orders: worked out inside every save, and set by nobody else.');
    expect(own.querySelector('button')).toBeNull();

    await open(/Order notes/, /Body/);
    expect((await screen.findByTestId('rules-priced')).textContent).toContain('Written by the price rule of Orders');
    // The link the lines are read by is the rule's to read, not to write.
    await userEvent.click(await screen.findByRole('button', { name: /Order ref/ }));
    await screen.findByTestId('column-inspector');
    expect(screen.queryByTestId('rules-priced')).toBeNull();
  });

  it('says nothing where no price rule is stored', async () => {
    installFetch();
    renderEditor();
    await open(/Orders/, /Total/);
    expect(screen.queryByTestId('rules-priced')).toBeNull();
  });
});

describe('priceRuleWrites', () => {
  it('lists every column the rule makes Adminium\'s own, each with its table', () => {
    expect(
      priceRuleWrites('o', {
        order: { discount: 'd', staff: { by: 'who' }, customer: { proved: 'ok' } },
        lines: [{ self: true, discount: 'own' }, { table: 'l', via: 'o_id', discount: 'ld' }],
        codes: { table: 'c', via: 'o_id', typed: 't', code: 'code_id', voucher: 'v_id' },
        refunds: { table: 'r', via: 'o_id', amount: 'amt', tax: 'tax' },
      }),
    ).toEqual([
      { table: 'o', column: 'd' },
      { table: 'o', column: 'who' },
      { table: 'o', column: 'ok' },
      { table: 'o', column: 'own' },
      { table: 'l', column: 'ld' },
      { table: 'c', column: 'code_id' },
      { table: 'c', column: 'v_id' },
      { table: 'r', column: 'amt' },
      { table: 'r', column: 'tax' },
    ]);
  });

  it('lists only what is there', () => {
    expect(priceRuleWrites('o', { order: { discount: 'd' }, lines: [] })).toEqual([{ table: 'o', column: 'd' }]);
    expect(priceRuleWrites('o', {})).toEqual([]);
  });
});
