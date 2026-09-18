// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE FILTER BAR, AND THE `where` IT SENDS.
 *
 * Every assertion here is on two things at once: what the person sees (a
 * labelled chip, a menu that stays open, a way out of an emptied table) and the
 * CONDITION that produced it — because a bar whose chips read beautifully and
 * whose `where` is wrong is worse than no bar at all.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema, type GridColumnSpecInput } from '../../../families/tables/column-spec.js';
import { PageCrud } from '../PageCrud.js';
import type { CrudApi, CrudFilter, CrudListParams, CrudRow } from '../crud-api.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const columns = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hasDefault: true, nullable: false }),
  spec({ name: 'name', label: 'Customer', logicalType: 'varchar', isDisplay: true }),
  spec({
    name: 'status',
    label: 'Status',
    logicalType: 'enum',
    enumValues: ['active', 'trialing'],
    enumTones: { active: 'pos', trialing: 'warn' },
  }),
  spec({ name: 'paid', label: 'Paid', logicalType: 'boolean' }),
  spec({ name: 'mrr', label: 'MRR', logicalType: 'decimal' }),
];

const rows: CrudRow[] = [{ id: 1, name: 'Initech', status: 'trialing', paid: false, mrr: '980' }];

function makeApi(data: CrudRow[] = rows): { api: CrudApi; wheres: (CrudFilter | undefined)[] } {
  const wheres: (CrudFilter | undefined)[] = [];
  const api: CrudApi = {
    list: vi.fn(async (params: CrudListParams) => {
      if (params.offset !== undefined) return { data: [], page: { limit: 1, offset: 0, total: data.length } };
      wheres.push(params.where);
      return { data, cursor: { next: null } };
    }),
    get: vi.fn(async () => ({ data: data[0] ?? {} })),
    create: vi.fn(async () => ({ data: {}, undoToken: null })),
    update: vi.fn(async () => ({ data: null, undoToken: null })),
    remove: vi.fn(async () => ({ data: null, undoToken: null })),
    references: vi.fn(async () => []),
    undo: vi.fn(async () => ({ restoredIds: [] })),
  };
  return { api, wheres };
}

function renderBar(
  filterFields: { column: string; control?: string; label?: string }[],
  data: CrudRow[] = rows,
) {
  const { api, wheres } = makeApi(data);
  render(
    <PageCrud
      api={api}
      columns={columns}
      source={{ connectionId: 'conn_1', table: 'public.customers' }}
      filterFields={filterFields as never}
    />,
  );
  return { user: userEvent.setup(), wheres, api };
}

const lastWhere = (wheres: (CrudFilter | undefined)[]): CrudFilter | undefined => wheres.at(-1);

describe('the filter bar', () => {
  it('picks one value, sends `eq`, and says so in words', async () => {
    const { user, wheres } = renderBar([{ column: 'status', control: 'one-of' }]);
    await screen.findByText('Initech');

    await user.click(screen.getByTestId('filter-open-status'));
    await user.click(await screen.findByTestId('filter-row-status-active'));

    await waitFor(() => expect(lastWhere(wheres)).toEqual({ column: 'status', op: 'eq', value: 'active' }));
    // "status = active" is a debugger's chip; the person chose from a menu of
    // labels and has no idea what the column is called.
    expect(screen.getByText('Status: active')).toBeTruthy();
  });

  it('ticks several values, sends `in`, and stays open while they choose', async () => {
    const { user, wheres } = renderBar([{ column: 'status', control: 'any-of' }]);
    await screen.findByText('Initech');

    await user.click(screen.getByTestId('filter-open-status'));
    await user.click(await screen.findByTestId('filter-row-status-active'));
    // Still open: choosing three values must not be three journeys.
    await user.click(await screen.findByTestId('filter-row-status-trialing'));

    await waitFor(() =>
      expect(lastWhere(wheres)).toEqual({ column: 'status', op: 'in', value: ['active', 'trialing'] }),
    );
  });

  it('clears the filter when its chosen row is clicked again (comp 611)', async () => {
    const { user, wheres } = renderBar([{ column: 'paid', control: 'yes-no' }]);
    await screen.findByText('Initech');

    await user.click(screen.getByTestId('filter-open-paid'));
    await user.click(await screen.findByTestId('filter-row-paid-true'));
    await waitFor(() => expect(lastWhere(wheres)).toEqual({ column: 'paid', op: 'eq', value: true }));

    await user.click(screen.getByTestId('filter-open-paid'));
    await user.click(await screen.findByTestId('filter-row-paid-true'));
    await waitFor(() => expect(lastWhere(wheres)).toBeUndefined());
  });

  it('sends `gte`, `lte` or `between` as the range is filled in (F12)', async () => {
    const { user, wheres } = renderBar([{ column: 'mrr', control: 'number-range' }]);
    await screen.findByText('Initech');

    await user.click(screen.getByTestId('filter-open-mrr'));
    await user.type(await screen.findByTestId('filter-from-mrr'), '100');
    // One end is a real filter: "everything over 100" is what somebody means
    // by filling one box.
    await waitFor(() => expect(lastWhere(wheres)).toEqual({ column: 'mrr', op: 'gte', value: 100 }));

    await user.type(screen.getByTestId('filter-to-mrr'), '500');
    await waitFor(() => expect(lastWhere(wheres)).toEqual({ column: 'mrr', op: 'between', value: [100, 500] }));
  });

  it('offers the way out where the table is empty (F18)', async () => {
    const { user } = renderBar([{ column: 'status', control: 'one-of' }], []);
    await waitFor(() => expect(screen.getByTestId('filter-open-status')).toBeTruthy());
    await user.click(screen.getByTestId('filter-open-status'));
    await user.click(await screen.findByTestId('filter-row-status-active'));

    // A filtered-away table whose only Clear is up in the toolbar is a screen
    // that says "nothing here" and hides the reason.
    const clear = await screen.findByTestId('filter-clear-empty');
    await user.click(clear);
    await waitFor(() => expect(screen.queryByText('Status: active')).toBeNull());
  });

  it('draws no bar at all for a page that defines none', async () => {
    const { api } = makeApi();
    render(
      <PageCrud api={api} columns={columns} source={{ connectionId: 'conn_1', table: 'public.customers' }} />,
    );
    await screen.findByText('Initech');
    expect(screen.queryByTestId('filter-bar')).toBeNull();
  });
});
