// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE CHIPS A LINK OPENS A LIST WITH.
 *
 * A card leads to a list filtered; the list must say so, piece by piece, and
 * say which pieces it could not use. The host narrows the reads — these tests
 * pin what the person SEES, and that each chip can be taken away.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpecInput } from '../../../families/tables/column-spec.js';
import { PageCrud } from '../PageCrud.js';
import type { CrudApi, CrudRow } from '../crud-api.js';
import type { PageCrudLinkFilter } from './LinkFilterChips.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false }),
  spec({ name: 'number', label: 'Invoice', logicalType: 'varchar', isDisplay: true }),
  spec({ name: 'status', label: 'Status', logicalType: 'enum', enumValues: ['sent', 'paid'], enumLabels: { sent: 'Sent', paid: 'Paid' } }),
  spec({ name: 'balance', label: 'Owed', logicalType: 'decimal' }),
  spec({ name: 'due_on', label: 'Due', logicalType: 'date' }),
];

function makeApi(data: CrudRow[]): CrudApi {
  return {
    list: vi.fn(async (params) => (params.offset !== undefined ? { data: [], page: { limit: 1, offset: 0, total: data.length } } : { data, cursor: { next: null } })),
    get: vi.fn(async () => ({ data: data[0] ?? {} })),
    create: vi.fn(async () => ({ data: {}, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: null })),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [] })),
  };
}

const applied = (column: string, op: string, value: string | null): PageCrudLinkFilter => ({
  column,
  raw: value === null ? op : `${op}:${value}`,
  status: 'applied',
  op,
  value,
});

function renderList(linkFilters: PageCrudLinkFilter[], data: CrudRow[] = [{ id: 1, number: 'INV-1', status: 'sent', balance: '10', due_on: '2026-09-01' }]) {
  const onRemove = vi.fn();
  const onClear = vi.fn();
  render(
    <PageCrud
      api={makeApi(data)}
      columns={columns}
      source={{ connectionId: 'conn_1', table: 'public.invoices' }}
      linkFilters={linkFilters}
      onRemoveLinkFilter={onRemove}
      onClearLinkFilters={onClear}
    />,
  );
  return { onRemove, onClear, user: userEvent.setup() };
}

describe('a list opened from a link', () => {
  it('says every filter in force, in the column’s words', async () => {
    renderList([
      applied('status', 'eq', 'sent'),
      applied('balance', 'gt', '0'),
      applied('due_on', 'before', 'today'),
      applied('status', 'in', 'sent,paid'),
      applied('due_on', 'gte', '2026-09-01'),
      applied('due_on', 'month', 'this'),
      applied('balance', 'set', null),
    ]);
    await screen.findByText('INV-1');
    expect(screen.getAllByTestId('link-filter').map((chip) => chip.textContent)).toEqual([
      'Status is Sent',
      'Owed more than 0',
      'Due before today',
      'Status is one of Sent, Paid',
      'Due on or after 2026-09-01',
      'Due this month',
      'Owed is filled in',
    ]);
  });

  it('says days counted from today, and this moment, in words', async () => {
    renderList([
      applied('due_on', 'gte', 'today-30'),
      applied('due_on', 'lt', 'today-1'),
      applied('due_on', 'lte', 'today+7'),
      applied('due_on', 'before', 'now'),
      applied('due_on', 'after', 'today+1'),
    ]);
    await screen.findByText('INV-1');
    expect(screen.getAllByTestId('link-filter').map((chip) => chip.textContent)).toEqual([
      'Due on or after 30 days ago',
      'Due before 1 day ago',
      'Due on or before 7 days from today',
      'Due before now',
      'Due after 1 day from today',
    ]);
  });

  it('says which pieces it could not use, and why', async () => {
    renderList([
      { column: 'ghost', raw: 'eq:1', status: 'ignored', reason: 'unknown-column' },
      { column: 'balance', raw: 'gt:abc', status: 'ignored', reason: 'bad-value' },
    ]);
    await screen.findByText('INV-1');
    expect(screen.getAllByTestId('link-filter-ignored').map((chip) => chip.textContent)).toEqual([
      'Not filtered by ghost: this list has no such column',
      'Not filtered by Owed: “gt:abc” is not a filter this column takes',
    ]);
  });

  it('takes a chip away when asked', async () => {
    const { onRemove, user } = renderList([applied('status', 'eq', 'sent'), applied('balance', 'gt', '0')]);
    await screen.findByText('INV-1');
    await user.click(screen.getByRole('button', { name: 'Remove Owed filter' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('reads an empty result as “nothing matches”, and clears the link’s filters too', async () => {
    const { onClear, user } = renderList([applied('status', 'eq', 'sent')], []);
    await screen.findByText('No matching rows');
    await user.click(screen.getByTestId('filter-clear-empty'));
    expect(onClear).toHaveBeenCalled();
  });
});
