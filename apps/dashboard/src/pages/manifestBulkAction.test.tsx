// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A LIST'S OWN BULK ACTION. The rows ticked are read again before anything is
 * asked; the ones the action is not for are left out and counted; one call
 * makes a row for each of the rest; and the reply says what became of each.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BulkActionFact } from '../api/pages.js';
import { jsonResponse } from '../test/fixtures.js';
import { BULK_ROWS_MAX, useManifestBulkActions } from './ManifestBulkAction.js';

const REORDER: BulkActionFact = {
  id: 'reorder',
  label: 'Reorder',
  child: { table: 'public.stock_orders', via: 'item_id', form: ['note'] },
  set: { kind: 'reorder' },
  where: { column: 'low', eq: 1 },
  confirm: { title: 'Reorder {count} items?', body: 'One order line for each of the {count}.', columns: ['name', 'left'] },
  done: '{count} added to the order',
};
const ITEMS = [
  { id: 1, name: 'Flour', left: '2.000', low: 1 },
  { id: 2, name: 'Sugar', left: '40.000', low: 0 },
  { id: 3, name: 'Salt', left: '0.500', low: 1 },
];

interface Call {
  method: string;
  path: string;
  search: URLSearchParams;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a request body read freely
}
function serve(each: (call: Call) => Response = (call) => jsonResponse(200, { results: (call.body.creates as unknown[]).map((_row, index) => ({ index, ok: true })), done: 0, notRun: 0 }), rows: unknown[] = ITEMS): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://adminium.test');
      const call: Call = { method: init?.method ?? 'GET', path: decodeURIComponent(url.pathname), search: url.searchParams, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      calls.push(call);
      if (call.method === 'GET') return jsonResponse(200, { data: rows });
      return each(call);
    }),
  );
  return calls;
}

function List({ ids, onDone }: { ids: string[]; onDone: () => void }): ReactNode {
  const actions = useManifestBulkActions({ connectionId: 'cnx_1', table: 'public.stock_items', actions: [REORDER], onDone });
  return (
    <>
      {actions.bulk.map((action) => (
        <button key={action.key} type="button" disabled={action.disabled} onClick={() => action.run(ids)}>
          {action.label}
        </button>
      ))}
      {actions.dialog}
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a list\'s own bulk action', () => {
  it('reads the ticked rows again, leaves out the ones it is not for, and asks once with what its form asks for', async () => {
    const user = userEvent.setup();
    const calls = serve();
    const onDone = vi.fn();
    render(<List ids={['3', '1', '2']} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    const dialog = await screen.findByRole('dialog');
    // Read by key, only the columns the confirm shows and the one the action is told apart by.
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/data/cnx_1/public.stock_items' });
    expect(JSON.parse(calls[0]!.search.get('where')!)).toEqual({ column: 'id', op: 'in', value: ['3', '1', '2'] });
    expect(calls[0]!.search.get('select')!.split(',').sort()).toEqual(['id', 'left', 'low', 'name']);
    // Two of the three are low: the count is theirs, and the third is said to be left out.
    expect(within(dialog).getByText('Reorder 2 items?')).toBeTruthy();
    expect(within(dialog).getByText('One order line for each of the 2.')).toBeTruthy();
    expect(within(dialog).getByText('1 of 3 are left out: this is not for them.')).toBeTruthy();
    // The rows it is about, as the server holds them, in the order ticked.
    expect(within(dialog).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['Salt0.500', 'Flour2.000']);
    expect(calls).toHaveLength(1);

    await user.type(within(dialog).getByLabelText('Note'), 'Weekly');
    await user.click(within(dialog).getByRole('button', { name: 'Reorder' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // ONE call of the one-by-one route: a row for each kept, the form's value, the fixed value, the row's key.
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/v1/data/cnx_1/public.stock_orders/one-by-one', search: expect.anything(), body: { creates: [{ note: 'Weekly', kind: 'reorder', item_id: 3 }, { note: 'Weekly', kind: 'reorder', item_id: 1 }] } },
    ]);
    expect(await screen.findByText('2 added to the order')).toBeTruthy();
  });

  it('says what became of each row: made, refused with its reason, not reached', async () => {
    const user = userEvent.setup();
    serve(
      () => jsonResponse(200, { results: [{ index: 0, ok: true }, { index: 1, ok: false, error: { code: 'RECORD_LOCKED', message: 'Locked.' } }, { index: 2, ok: false, error: { code: 'NOT_RUN' } }], done: 1, notRun: 1 }),
      ITEMS.map((item) => ({ ...item, low: 1 })),
    );
    const onDone = vi.fn();
    render(<List ids={['1', '2', '3']} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reorder' }));
    expect(await screen.findByText('1 added to the order')).toBeTruthy();
    const refused = screen.getByRole('alert');
    expect(refused.textContent).toContain('1 could not be made:');
    // The refused row by its first column, with the reason in the reader's words.
    expect(refused.textContent).toContain('Sugar — This record is locked, so this cannot be changed.');
    expect(screen.getByText('1 not reached — press again for these.')).toBeTruthy();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('when none of the rows ticked is one it is for, it says so and asks nothing', async () => {
    const user = userEvent.setup();
    const calls = serve(undefined, ITEMS.map((item) => ({ ...item, low: 0 })));
    render(<List ids={['1', '2']} onDone={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    expect((await screen.findByRole('alert')).textContent).toBe('None of the rows ticked is one this is for.');
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('more rows than one press is for are refused before anything is read', async () => {
    const user = userEvent.setup();
    const calls = serve();
    render(<List ids={Array.from({ length: BULK_ROWS_MAX + 1 }, (_unused, index) => String(index))} onDone={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Select 200 rows or fewer.');
    expect(calls).toEqual([]);
  });

  it('a call whose answer never came says nothing is known, and the list is read again', async () => {
    const user = userEvent.setup();
    serve(() => jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'Slow down.', requestId: 'r' } }), ITEMS.map((item) => ({ ...item, low: 1 })));
    const onDone = vi.fn();
    render(<List ids={['1']} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reorder' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing is known to be made. Look at the list and press again.');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('called off, it makes nothing', async () => {
    const user = userEvent.setup();
    const calls = serve(undefined, ITEMS.map((item) => ({ ...item, low: 1 })));
    render(<List ids={['1']} onDone={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });
});
