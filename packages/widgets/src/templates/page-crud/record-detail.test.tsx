// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The record panel (Peek): what it reads, and what it calls things.
 *
 * A related tab read its rows again on every render: the read was keyed
 * on a function bound afresh each time, so its own answer started the next
 * one, at the speed of the network, until the server answered 429 and the
 * owner's next page was "Rate limit reached".
 *
 * And the panel showed the grid's columns only, and named its tabs by table
 * ("ordering_order_items").
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { PageCrud } from './PageCrud.js';
import { RecordDetail } from './RecordDetail.js';
import type { CrudApi, CrudReferenceCount } from './crud-api.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, nullable: false }),
  spec({ name: 'name', label: 'Name', logicalType: 'varchar', isDisplay: true }),
];

const ITEMS: CrudReferenceCount = { relationId: 'rel_items', table: 'main.ordering_order_items', column: 'order_id', count: 2 };

function makeApi(references: CrudReferenceCount[]) {
  const listRelated = vi.fn(async () => [
    { id: 1, order_id: 7, name: 'Soup' },
    { id: 2, order_id: 7, name: 'Bread' },
  ]);
  const api = {
    get: vi.fn(async () => ({ data: { id: 7, name: 'Ada' }, inboundCounts: references })),
    listRelated,
  } as unknown as CrudApi;
  return { api, listRelated };
}

describe('the record panel', () => {
  it('reads a related tab once, however often it draws', async () => {
    const { api, listRelated } = makeApi([ITEMS]);
    const view = render(<RecordDetail api={api} columns={columns} recordId="7" />);
    await userEvent.setup().click(await screen.findByRole('tab', { name: /order items/i }));
    await screen.findByText('Soup');
    // Draw it again, as any parent render does, and let every answer settle.
    view.rerender(<RecordDetail api={api} columns={columns} recordId="7" />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listRelated).toHaveBeenCalledTimes(1);
  });

  it('names a tab as the table is called, else in plain words', async () => {
    const { api } = makeApi([
      { ...ITEMS, label: 'Lines' },
      { relationId: 'rel_messages', table: 'main.ordering_messages', column: 'order_id', count: 0 },
    ]);
    render(<RecordDetail api={api} columns={columns} recordId="7" />);
    expect(await screen.findByRole('tab', { name: /^Lines/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Ordering messages/ })).toBeTruthy();
    expect(screen.queryByText('ordering_messages')).toBeNull();
  });

  it('does not ask for a tab it is not showing', async () => {
    const { api, listRelated } = makeApi([ITEMS]);
    render(<RecordDetail api={api} columns={columns} recordId="7" />);
    await screen.findByRole('tab', { name: /order items/i });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(listRelated).not.toHaveBeenCalled();
  });

  it('shows the whole record, not the grid’s handful of columns', async () => {
    const api = {
      list: vi.fn(async () => ({ data: [{ id: 7, name: 'Ada' }], cursor: { next: null } })),
      get: vi.fn(async () => ({ data: { id: 7, name: 'Ada', status: 'paid', note: 'Window seat' }, inboundCounts: [] })),
    } as unknown as CrudApi;
    const fact = (spec: GridColumnSpecInput) => ({ spec, ordinal: 0, writable: true, filledBy: null, required: false });
    render(
      <PageCrud
        api={api}
        columns={columns}
        source={{ connectionId: 'conn_1', table: 'main.orders' }}
        formColumns={[
          fact({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true }),
          // The page's own word for a column it lists wins over the table's.
          fact({ name: 'name', label: 'Customer name', logicalType: 'varchar' }),
          fact({ name: 'status', label: 'Status', logicalType: 'varchar' }),
          fact({ name: 'note', label: 'Note', logicalType: 'text' }),
        ] as never}
      />,
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Peek' }));
    const panel = within(await screen.findByRole('dialog'));
    expect(await panel.findByText('Window seat')).toBeTruthy();
    expect(panel.getByText('paid')).toBeTruthy();
    const order = [...(await screen.findByRole('dialog')).querySelectorAll('[data-column]')].map((row) => row.getAttribute('data-column'));
    expect(order).toEqual(['id', 'name', 'status', 'note']);
    expect(panel.queryByText('Customer name')).toBeNull();
  });
});
