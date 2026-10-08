// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE DATA KIT'S HOOKS, AS A PAGE USES THEM.
 *
 * A page names a table by its add-on's own short name and never by a real
 * one; a write answers the row as it was stored; many rows go one save each,
 * 500 to a call, the calls one after another; a move names an action and
 * nothing the action writes; a document and an export are opened, never
 * fetched into the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import { AddOnKeyContext } from './data-kit/context.js';
import { EACH_CALL_MAX, listParams, useAccess, useDocument, useExport, useLookUp, useRead, useRecord, useRecords, useStateMove, useTreeWrite, useWords, useWrite } from './data-kit/hooks.js';
import type { KitReply } from './data-kit/resolve.js';

const CONN = 'cnx_1';
const KIT: KitReply = {
  connectionId: CONN,
  tables: {
    orders: {
      id: 'public.stock_orders',
      can: { read: true, create: true, update: true, delete: false },
      unreadable: ['cost'],
      states: {
        column: 'status',
        moves: { draft: ['sent', 'cancelled'], sent: [] },
        actions: [
          { id: 'send', kind: 'move', from: ['draft'] },
          { id: 'send-again', kind: 'set', from: ['sent'] },
          { id: 'receive', kind: 'link', from: ['sent'] },
        ],
      },
    },
    order_lines: { id: 'public.stock_order_lines', can: { read: true, create: true, update: true, delete: true }, unreadable: [] },
    items: { id: 'public.stock_items', can: { read: true, create: false, update: false, delete: false }, unreadable: [] },
  },
  hosts: [{ tableRef: 'shop:dishes', id: 'public.shop_dishes', label: 'Dishes', via: 'posting' }],
  has: { 'system:schema:remap': false, 'page:stock-receive:view': true },
  currency: 'EUR',
};

interface Call {
  method: string;
  path: string;
  search: URLSearchParams;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a request body read freely
}

/** A server that answers the kit's read and whatever a test hands it; every call is kept. */
function serve(answer: (call: Call) => Response | undefined | Promise<Response | undefined> = () => undefined, kit: KitReply = KIT) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://adminium.test');
      const call: Call = { method: init?.method ?? 'GET', path: decodeURIComponent(url.pathname), search: url.searchParams, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      if (call.path === '/api/v1/add-ons/stock/kit') return jsonResponse(200, kit);
      calls.push(call);
      const given = await answer(call);
      if (given !== undefined) return given;
      if (call.path.endsWith('/schema')) {
        return jsonResponse(200, { model: { tables: [], relations: [{ id: 'rel_lines', through: null, from: { tableId: 'public.stock_order_lines' }, to: { tableId: 'public.stock_orders' } }] } });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } });
    }),
  );
  return calls;
}

function wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AddOnKeyContext.Provider value="stock">
        <Suspense fallback={null}>{children}</Suspense>
      </AddOnKeyContext.Provider>
    </QueryClientProvider>
  );
}

/** A hook's value once the kit's read is in. */
async function use<T>(hook: () => T) {
  const rendered = renderHook(hook, { wrapper });
  await waitFor(() => expect(rendered.result.current).not.toBeNull());
  return rendered;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a table is a short name', () => {
  it('a hook takes a short ref, reads the real table, and refuses a real table name', async () => {
    const calls = serve((call) => (call.path === `/api/v1/data/${CONN}/public.stock_items` ? jsonResponse(200, { data: [{ id: 1, name: 'Flour' }] }) : undefined));
    const list = await use(() => useRecords('items'));
    await waitFor(() => expect(list.result.current.rows).toEqual([{ id: 1, name: 'Flour' }]));
    expect(calls.map((call) => call.path)).toEqual([`/api/v1/data/${CONN}/public.stock_items`]);

    // The real name of its own table, and another add-on's table, are no names a page may use.
    const refused = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const name of ['public.stock_items', 'public.offers_gift_cards', 'gift_cards']) {
      expect(() => renderHook(() => useRecords(name), { wrapper: ({ children }) => <Preloaded>{children}</Preloaded> }), name).toThrow(`"${name}" is not a table of stock`);
    }
    refused.mockRestore();
  });

  it('a list filters, sorts and pages on the server, and knows whether another page follows without counting', async () => {
    const rows = Array.from({ length: 21 }, (_unused, index) => ({ id: index + 1 }));
    const calls = serve((call) => (call.path.endsWith('public.stock_items') ? jsonResponse(200, { data: rows }) : undefined));
    const list = await use(() =>
      useRecords('items', {
        filter: [{ column: 'name', op: 'contains', value: '50%_off' }, { column: 'zone', op: 'in', value: ['shelf', 'cellar'] }, { column: 'note', op: 'empty' }],
        sort: [{ column: 'name', direction: 'desc' }],
        page: 3,
        pageSize: 20,
        columns: ['id', 'name'],
      }),
    );
    await waitFor(() => expect(list.result.current.loading).toBe(false));
    expect(list.result.current.rows).toHaveLength(20);
    expect(list.result.current.hasMore).toBe(true);
    const sent = calls[0]!.search;
    expect(JSON.parse(sent.get('where')!)).toEqual({ and: [{ column: 'name', op: 'ilike', value: '%50\\%\\_off%' }, { column: 'zone', op: 'in', value: ['shelf', 'cellar'] }, { column: 'note', op: 'is_null' }] });
    expect([sent.get('limit'), sent.get('offset')]).toEqual(['21', '40']);
    // Never more than the data routes give in one read.
    expect(listParams({ pageSize: 5000 }).params.limit).toBe(200);
  });

  it('reads when asked, not when drawn: a page of rows with "more", one row or null, and a refusal as itself', async () => {
    const rows = Array.from({ length: 3 }, (_unused, index) => ({ id: index + 1 }));
    const calls = serve((call) => {
      if (call.path === `/api/v1/data/${CONN}/public.stock_items`) return jsonResponse(200, { data: rows });
      if (call.path.endsWith('public.stock_items/7')) return jsonResponse(200, { data: { id: 7, name: 'Flour' } });
      if (call.path.endsWith('public.stock_items/8')) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No.', requestId: 'r' } });
      if (call.path.endsWith('public.stock_items/9')) return jsonResponse(403, { error: { code: 'TABLE_FORBIDDEN', message: 'No.', requestId: 'r' } });
      return undefined;
    });
    const read = await use(() => useRead());
    // Nothing is asked until the page asks.
    expect(calls).toEqual([]);
    const listed = await read.result.current.list('items', { filter: [{ column: 'barcode', op: 'eq', value: '506' }], pageSize: 2, columns: ['id'] });
    expect(listed).toEqual({ rows: [{ id: 1 }, { id: 2 }], hasMore: true });
    expect(JSON.parse(calls[0]!.search.get('where')!)).toEqual({ column: 'barcode', op: 'eq', value: '506' });
    expect(calls[0]!.search.get('limit')).toBe('3');
    expect(await read.result.current.get('items', 7)).toEqual({ id: 7, name: 'Flour' });
    expect(await read.result.current.get('items', 8)).toBeNull();
    await expect(read.result.current.get('items', 9)).rejects.toMatchObject({ code: 'TABLE_FORBIDDEN' });
    // A table that is not the add-on's is no name a read may use either.
    await expect(read.result.current.list('public.stock_items')).rejects.toThrow('is not a table of stock');
  });

  it('hands a page the same reads and the same access on every draw', async () => {
    serve();
    // One cache for the page's life, as the dashboard has: only then is "the same on every draw" a fair question.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['add-on-kit', 'stock'], KIT);
    const stable = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AddOnKeyContext.Provider value="stock">{children}</AddOnKeyContext.Provider>
      </QueryClientProvider>
    );
    const drawn = renderHook(() => ({ read: useRead(), access: useAccess() }), { wrapper: stable });
    const first = drawn.result.current;
    drawn.rerender();
    drawn.rerender();
    // A page keys its loading on these: a new object each draw would read, draw and read again without end.
    expect(drawn.result.current.read).toBe(first.read);
    expect(drawn.result.current.access).toBe(first.access);
  });

  it('a row-by-row change carries the state the rows were seen in, and what the ledger said of each', async () => {
    const calls = serve((call) => (call.path.endsWith('/one-by-one') ? jsonResponse(200, { results: [{ id: 1, ok: true, data: { id: 1, status: 'posted' }, postings: [{ ledger: 'stock', state: 'ok', notes: [{ line: 0, note: 'short' }] }] }, { id: 2, ok: true, data: { id: 2, status: 'posted' } }], done: 2, notRun: 0 }) : undefined));
    const write = await use(() => useWrite('orders'));
    let results!: Awaited<ReturnType<typeof write.result.current.updateEach>>;
    await act(async () => {
      results = await write.result.current.updateEach([1, 2], { status: 'posted' }, { from: 'draft' });
    });
    expect(calls.find((call) => call.path.endsWith('/one-by-one'))?.body).toEqual({ ids: [1, 2], values: { status: 'posted' }, from: 'draft' });
    expect(results[0]).toEqual({ key: '1', ok: true, row: { id: 1, status: 'posted' }, postings: [{ ledger: 'stock', state: 'ok', notes: [{ line: 0, note: 'short' }] }] });
    // A row the ledger said nothing of carries no key for it.
    expect(results[1]).toEqual({ key: '2', ok: true, row: { id: 2, status: 'posted' } });
  });

  it('a list that waits reads nothing; one record that is not there is null, not an error', async () => {
    const calls = serve();
    const waiting = await use(() => useRecords('items', { enabled: false }));
    expect(waiting.result.current).toMatchObject({ rows: [], loading: false, hasMore: false });
    const none = await use(() => useRecord('items', 99));
    await waitFor(() => expect(none.result.current.loading).toBe(false));
    expect(none.result.current).toMatchObject({ row: null, error: null });
    expect(calls.map((call) => call.path)).toEqual([`/api/v1/data/${CONN}/public.stock_items/99`]);
  });

  it('a host table is read-only: read by the name it is stored under, and never written', async () => {
    const calls = serve((call) => (call.path.endsWith('public.shop_dishes') ? jsonResponse(200, { data: [{ id: 7 }] }) : undefined));
    const dishes = await use(() => useRecords('shop:dishes'));
    await waitFor(() => expect(dishes.result.current.rows).toEqual([{ id: 7 }]));
    expect(calls[0]!.path).toBe(`/api/v1/data/${CONN}/public.shop_dishes`);
    const refused = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writers: (() => unknown)[] = [() => useWrite('shop:dishes'), () => useTreeWrite('shop:dishes'), () => useStateMove('shop:dishes')];
    for (const hook of writers) {
      expect(() => renderHook(hook, { wrapper: ({ children }) => <Preloaded>{children}</Preloaded> })).toThrow('its page reads it and writes nothing there');
    }
    refused.mockRestore();
  });
});

/** The kit's read already in the cache: a hook that throws does so on its first render. */
function Preloaded({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['add-on-kit', 'stock'], KIT);
  return (
    <QueryClientProvider client={client}>
      <AddOnKeyContext.Provider value="stock">{children}</AddOnKeyContext.Provider>
    </QueryClientProvider>
  );
}

describe('a write', () => {
  it('resolves to the stored row with its decided columns, and a code shown once with its print ticket', async () => {
    const calls = serve((call) => {
      if (call.method === 'POST' && call.path.endsWith('public.stock_orders')) {
        return jsonResponse(200, { data: { id: 12, number: 'PO-0012', status: 'draft', total: '48.11' }, undoToken: 't', once: [{ column: 'code', value: 'GC-7K2M', print: 'tkt_1' }] });
      }
      if (call.method === 'PATCH') return jsonResponse(200, { data: { id: 12, note: 'Rush', updated_by: 'usr_1' }, undoToken: null });
      if (call.method === 'DELETE') return jsonResponse(200, { data: null, undoToken: null });
      return undefined;
    });
    const write = await use(() => useWrite('orders'));
    let made!: Awaited<ReturnType<typeof write.result.current.create>>;
    await act(async () => {
      made = await write.result.current.create({ supplier_id: 3 });
    });
    // What Adminium decided — the number, the state, the total — comes back with the row.
    expect(made.row).toEqual({ id: 12, number: 'PO-0012', status: 'draft', total: '48.11' });
    expect(made.once).toEqual([{ table: 'orders', key: '12', column: 'code', value: 'GC-7K2M', print: 'tkt_1' }]);
    expect(calls[0]).toMatchObject({ method: 'POST', path: `/api/v1/data/${CONN}/public.stock_orders`, body: { values: { supplier_id: 3 } } });

    let changed!: Awaited<ReturnType<typeof write.result.current.update>>;
    await act(async () => {
      changed = await write.result.current.update(12, { note: 'Rush' });
    });
    expect(changed.row).toEqual({ id: 12, note: 'Rush', updated_by: 'usr_1' });
    expect(changed).not.toHaveProperty('once');
    await act(async () => {
      await write.result.current.remove(12);
    });
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/v1/data/${CONN}/public.stock_orders/12` });
  });

  it('a refusal is thrown and kept as the server said it', async () => {
    serve((call) => (call.method === 'POST' ? jsonResponse(409, { error: { code: 'POSTING_REFUSED', message: 'Not enough left.', requestId: 'r', details: { reason: 'short', left: '2' } } }) : undefined));
    const write = await use(() => useWrite('orders'));
    await act(async () => {
      await expect(write.result.current.create({ supplier_id: 3 })).rejects.toMatchObject({ code: 'POSTING_REFUSED' });
    });
    // A ledger's refusal is worded by the dashboard, as on a generated page; its code and what it says of the row are the server's.
    expect(write.result.current.error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'short', left: '2' } });
    expect(write.result.current.error!.message.length).toBeGreaterThan(0);
    expect(write.result.current.saving).toBe(false);
  });

  it('updateEach sends 1,200 ids as three calls, one after another, and answers per row in the order sent', async () => {
    let inFlight = 0;
    let most = 0;
    const calls = serve(async (call) => {
      if (!call.path.endsWith('/one-by-one')) return undefined;
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const ids = call.body.ids as number[];
      return jsonResponse(200, { results: ids.map((id) => (id === 7 ? { id, ok: false, error: { code: 'RECORD_LOCKED', message: 'Locked.' } } : id === 1200 ? { id, ok: false, error: { code: 'NOT_RUN' } } : { id, ok: true, data: { id, zone: 'cellar' } })), done: ids.length, notRun: 0 });
    });
    const write = await use(() => useWrite('orders'));
    const ids = Array.from({ length: 1200 }, (_unused, index) => index + 1);
    let results!: Awaited<ReturnType<typeof write.result.current.updateEach>>;
    await act(async () => {
      results = await write.result.current.updateEach(ids, { zone: 'cellar' });
    });
    const sent = calls.filter((call) => call.path.endsWith('/one-by-one'));
    expect(sent.map((call) => call.body.ids.length)).toEqual([EACH_CALL_MAX, EACH_CALL_MAX, 200]);
    expect(sent.every((call) => call.body.values.zone === 'cellar' && call.body.creates === undefined)).toBe(true);
    // Never two at once.
    expect(most).toBe(1);
    expect(results.map((result) => result.key)).toEqual(ids.map(String));
    expect(results[0]).toEqual({ key: '1', ok: true, row: { id: 1, zone: 'cellar' } });
    expect(results[6]).toEqual({ key: '7', ok: false, error: { code: 'RECORD_LOCKED', message: 'Locked.' } });
    expect(results[1199]).toEqual({ key: '1200', ok: false, notRun: true });
  });

  it('a call refused as a whole marks its ids and leaves the rest not run', async () => {
    let n = 0;
    const calls = serve((call) => {
      if (!call.path.endsWith('/one-by-one')) return undefined;
      n += 1;
      if (n === 2) return jsonResponse(403, { error: { code: 'TABLE_FORBIDDEN', message: 'No.', requestId: 'r' } });
      return jsonResponse(200, { results: (call.body.ids as number[]).map((id) => ({ id, ok: true, data: { id } })), done: 500, notRun: 0 });
    });
    const write = await use(() => useWrite('orders'));
    let results!: Awaited<ReturnType<typeof write.result.current.updateEach>>;
    await act(async () => {
      results = await write.result.current.updateEach(Array.from({ length: 1200 }, (_unused, index) => index + 1), { zone: 'x' });
    });
    // The third call is never sent.
    expect(calls.filter((call) => call.path.endsWith('/one-by-one'))).toHaveLength(2);
    expect(results[499]).toMatchObject({ ok: true });
    expect(results[500]).toEqual({ key: '501', ok: false, error: { code: 'TABLE_FORBIDDEN', message: 'No.' } });
    expect(results[999]).toMatchObject({ ok: false, error: { code: 'TABLE_FORBIDDEN' } });
    expect(results[1000]).toEqual({ key: '1001', ok: false, notRun: true });
    expect(results[1199]).toEqual({ key: '1200', ok: false, notRun: true });
  });

  it('createEach sends its rows as creates, 500 a call, and answers a key per row made', async () => {
    let next = 100;
    const calls = serve((call) => {
      if (!call.path.endsWith('/one-by-one')) return undefined;
      return jsonResponse(200, { results: (call.body.creates as { name: string }[]).map((row, index) => (row.name === 'bad' ? { index, ok: false, error: { code: 'VALIDATION_FAILED', message: 'Bad.' } } : { index, ok: true, id: (next += 1), data: { id: next, name: row.name } })), done: 0, notRun: 0 });
    });
    const write = await use(() => useWrite('items'));
    const rows = Array.from({ length: 1201 }, (_unused, index) => ({ name: index === 3 ? 'bad' : `item ${String(index)}` }));
    let results!: Awaited<ReturnType<typeof write.result.current.createEach>>;
    await act(async () => {
      results = await write.result.current.createEach(rows);
    });
    const sent = calls.filter((call) => call.path.endsWith('/one-by-one'));
    // Three calls of the one route, not 1,201 single saves.
    expect(sent.map((call) => (call.body.creates as unknown[]).length)).toEqual([500, 500, 201]);
    expect(sent.every((call) => call.body.ids === undefined && call.body.values === undefined)).toBe(true);
    expect(calls.filter((call) => call.method === 'POST' && !call.path.endsWith('/one-by-one'))).toEqual([]);
    expect(results).toHaveLength(1201);
    expect(results[0]).toEqual({ key: '101', ok: true, row: { id: 101, name: 'item 0' } });
    // A row that was not made has no key of its own: its place in what was sent.
    expect(results[3]).toEqual({ key: '3', ok: false, error: { code: 'VALIDATION_FAILED', message: 'Bad.' } });
  });

  it('a tree is one save: the child rows go under the relation that ties them to their parent', async () => {
    const calls = serve((call) => {
      if (call.method === 'POST' && call.path.endsWith('/dry-run')) return jsonResponse(200, { data: { total: '12.00' }, children: {} });
      if (call.method === 'POST' && call.path.endsWith('public.stock_orders')) return jsonResponse(200, { data: { id: 5, total: '12.00' }, undoToken: null });
      return undefined;
    });
    const tree = await use(() => useTreeWrite('orders'));
    const order = { values: { supplier_id: 3 }, children: { order_lines: [{ values: { item_id: 1, qty: '2.000' } }, { values: { item_id: 2, qty: '1.500' } }] } };
    let quoted!: Readonly<Record<string, unknown>>;
    let saved!: Awaited<ReturnType<typeof tree.result.current.create>>;
    await act(async () => {
      quoted = await tree.result.current.dryRun(order);
      saved = await tree.result.current.create(order);
    });
    const body = { values: { supplier_id: 3 }, children: { rel_lines: [{ values: { item_id: 1, qty: '2.000' } }, { values: { item_id: 2, qty: '1.500' } }] } };
    expect(calls.find((call) => call.path.endsWith('/dry-run'))!.body).toEqual(body);
    expect(calls.find((call) => call.method === 'POST' && call.path.endsWith('public.stock_orders'))!.body).toEqual(body);
    expect(quoted).toMatchObject({ data: { total: '12.00' } });
    expect(saved.row).toEqual({ id: 5, total: '12.00' });
    // The quantities are the text that was typed, never a number.
    expect(typeof body.children.rel_lines[0]!.values.qty).toBe('string');
  });
});

describe('a move', () => {
  it('an action id goes to the action route with the state the row is in, and sends no target and no set', async () => {
    const calls = serve((call) => {
      if (call.method === 'GET' && call.path.endsWith('/public.stock_orders/12')) return jsonResponse(200, { data: { id: 12, status: 'draft' } });
      if (call.path.endsWith('/actions/send')) return jsonResponse(200, { data: { id: 12, status: 'sent', sent_how: 'email' }, undoToken: null });
      return undefined;
    });
    const move = await use(() => useStateMove('orders'));
    let moved!: Awaited<ReturnType<typeof move.result.current>>;
    await act(async () => {
      moved = await move.result.current(12, 'send', { note: 'By courier' });
    });
    const sent = calls.find((call) => call.path.endsWith('/actions/send'))!;
    expect(sent).toMatchObject({ method: 'POST', path: `/api/v1/data/${CONN}/public.stock_orders/12/actions/send` });
    // The id, the state it saw, what the action asked for — and nothing the action writes.
    expect(sent.body).toEqual({ from: 'draft', values: { note: 'By courier' } });
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
    expect(moved.row).toMatchObject({ status: 'sent', sent_how: 'email' });
  });

  it('a state\'s own name is a plain move: a PATCH with the state it saw', async () => {
    const calls = serve((call) => {
      if (call.method === 'GET' && call.path.endsWith('/public.stock_orders/12')) return jsonResponse(200, { data: { id: 12, status: 'draft' } });
      if (call.method === 'PATCH') return jsonResponse(200, { data: { id: 12, status: 'cancelled' }, undoToken: null });
      return undefined;
    });
    const move = await use(() => useStateMove('orders'));
    await act(async () => {
      await move.result.current(12, 'cancelled');
    });
    const sent = calls.find((call) => call.method === 'PATCH')!;
    expect(sent.path).toBe(`/api/v1/data/${CONN}/public.stock_orders/12`);
    expect(sent.body).toEqual({ values: { status: 'cancelled' }, from: 'draft' });
    expect(calls.some((call) => call.path.includes('/actions/'))).toBe(false);
  });

  it('a link action is no move: its id is read as a state\'s name and the server refuses it', async () => {
    serve((call) => {
      if (call.method === 'GET') return jsonResponse(200, { data: { id: 12, status: 'sent' } });
      if (call.method === 'PATCH') return jsonResponse(409, { error: { code: 'STATE_MOVE_REFUSED', message: 'A row cannot go from sent to receive.', requestId: 'r' } });
      return undefined;
    });
    const move = await use(() => useStateMove('orders'));
    await act(async () => {
      await expect(move.result.current(12, 'receive')).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    });
  });
});

describe('what the reader may do', () => {
  it('is answered from the kit\'s one read: tables, columns, moves, and what a page asks about by name', async () => {
    serve();
    const access = (await use(() => useAccess())).result.current;
    expect(access.ready).toBe(true);
    expect(access.canRead('orders')).toBe(true);
    expect(access.canRead('orders', ['number', 'cost'])).toBe(false);
    expect(access.canRead('orders', ['number'])).toBe(true);
    expect(access.canRead('shop:dishes')).toBe(true);
    expect(access.canRead('nothing')).toBe(false);
    expect([access.canCreate('orders'), access.canCreate('items'), access.canCreate('shop:dishes')]).toEqual([true, false, false]);
    expect([access.canUpdate('orders'), access.canUpdate('items')]).toEqual([true, false]);
    // An action by its id, from a state or from any; a plain move by its state's name.
    expect([access.canMove('orders', 'send', 'draft'), access.canMove('orders', 'send', 'sent'), access.canMove('orders', 'send')]).toEqual([true, false, true]);
    expect([access.canMove('orders', 'cancelled', 'draft'), access.canMove('orders', 'cancelled', 'sent'), access.canMove('orders', 'done')]).toEqual([true, false, false]);
    expect(access.canMove('items', 'send')).toBe(false);
    expect([access.has('page:stock-receive:view'), access.has('system:schema:remap'), access.has('anything')]).toEqual([true, false, false]);
    // What its pages write money in: the database's own currency.
    expect(access.currency).toBe('EUR');
  });
});

describe('a look-up, the words, a document, an export', () => {
  it('a look-up posts what was typed and passes the answer through; nothing found is null', async () => {
    const calls = serve((call) => {
      if (!call.path.endsWith('/look-up')) return undefined;
      return call.body.value === 'GC-7K2M' ? jsonResponse(200, { found: true, kind: 'gift-card', by: 'code', table: 'gift_cards', key: '4', last4: 'Q4XP', record: { balance: '19.00' }, rows: [{ amount: '-6.00' }] }) : jsonResponse(200, { found: false });
    });
    const look = await use(() => useLookUp('offers'));
    let hit: unknown;
    let miss: unknown;
    await act(async () => {
      hit = await look.result.current.find('GC-7K2M');
      miss = await look.result.current.find('nothing');
    });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v1/add-ons/offers/look-up', body: { value: 'GC-7K2M' } });
    expect(hit).toEqual({ kind: 'gift-card', table: 'gift_cards', key: '4', row: { balance: '19.00' }, rows: [{ amount: '-6.00' }], by: 'code', last4: 'Q4XP' });
    expect(miss).toBeNull();
    // With no key it is the page's own add-on.
    const own = await use(() => useLookUp());
    await act(async () => {
      await own.result.current.find('x');
    });
    expect(calls.at(-1)!.path).toBe('/api/v1/add-ons/stock/look-up');
  });

  it('the words are asked by the stored name of the table, sixty rows at most', async () => {
    const calls = serve((call) => (call.path.startsWith('/api/v1/words/') ? jsonResponse(200, { data: [{ id: '1', state: 'low' }] }) : undefined));
    const words = await use(() => useWords('stock'));
    let answers: unknown;
    await act(async () => {
      answers = await words.result.current.ask('shop:dishes', Array.from({ length: 70 }, (_unused, index) => index + 1));
      await words.result.current.ask('items', [3]);
    });
    expect(answers).toEqual([{ id: '1', state: 'low' }]);
    expect(calls[0]!.path).toBe('/api/v1/words/stock/stock');
    expect(calls[0]!.search.get('table')).toBe('shop:dishes');
    expect(calls[0]!.search.get('ids')!.split(',')).toHaveLength(60);
    // One of its own tables goes by the name another manifest would use for it.
    expect(calls[1]!.search.get('table')).toBe('stock:items');
    await expect(words.result.current.ask('elsewhere', [1])).rejects.toThrow('"elsewhere" is not a table of stock');
    expect(await words.result.current.ask('items', [])).toEqual([]);
  });

  it('open asks for the paper and the one-use mark, passes its values and locale, opens the answered address and never fetches it', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const calls = serve((call) => (call.path.endsWith('/documents/render') ? jsonResponse(200, { printUrl: '/api/v1/documents/print-once/tkt_9', contentUrl: '/api/v1/documents/doc_1/content' }) : undefined));
    const document = await use(() => useDocument());
    await act(async () => {
      await document.result.current.open('card', 'orders', 12, { print: true, paper: 'a6', once: 'tkt_1', values: { note: 'Gift' }, locale: 'de_DE' });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v1/add-ons/stock/documents/render', body: { kind: 'card', table: 'orders', key: '12', paper: 'a6', once: 'tkt_1', values: { note: 'Gift' }, locale: 'de_DE' } });
    // The print address is opened in a tab of its own; the page itself never asks for it, so a one-use ticket is not spent here.
    expect(opened).toHaveBeenCalledExactlyOnceWith('/api/v1/documents/print-once/tkt_9', '_blank', 'noopener');
    await act(async () => {
      await document.result.current.open('card', 'orders', 12);
    });
    expect(opened).toHaveBeenLastCalledWith('/api/v1/documents/doc_1/content', '_blank', 'noopener');
    expect(calls).toHaveLength(2);
  });

  it('an export starts with the kit\'s connection and table and downloads by id', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const calls = serve((call) => (call.path === '/api/v1/exports' ? jsonResponse(202, { data: { id: 'exp_3' } }) : undefined));
    const exporting = await use(() => useExport());
    let id = '';
    await act(async () => {
      id = await exporting.result.current.start('orders', { filter: [{ column: 'status', op: 'eq', value: 'sent' }], columns: ['number', 'total'], format: 'csv' });
      await exporting.result.current.download(id);
    });
    expect(id).toBe('exp_3');
    expect(calls[0]!.body).toEqual({
      connectionId: CONN,
      source: { kind: 'table', table: 'public.stock_orders', filters: [{ column: 'status', op: 'eq', value: 'sent' }], columns: [{ name: 'number', label: 'number' }, { name: 'total', label: 'total' }] },
      format: 'csv',
    });
    expect(opened).toHaveBeenCalledExactlyOnceWith('/api/v1/exports/exp_3/download', '_blank', 'noopener');
  });
});
