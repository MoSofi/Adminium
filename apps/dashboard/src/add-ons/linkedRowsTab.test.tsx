// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A RECORD'S TAB OF AN ADD-ON'S ROWS.
 *
 * The rows are found by the pair each stores — this record's table, by its
 * stored name, and this record's key — and every row made here carries that
 * same pair, whatever was picked. A cell saves where it stands and keeps a
 * refused value with the server's reason; a removal can be undone. The line
 * above the rows says only what the add-on's answer carries.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordTabFact } from '../api/pages.js';

const crud = vi.hoisted(() => ({
  made: [] as { table: string; api: Record<'list' | 'create' | 'update' | 'remove' | 'lookup', ReturnType<typeof vi.fn>> }[],
  rows: [] as Record<string, unknown>[],
  words: null as Record<string, unknown> | null,
  wordsAsked: [] as string[],
  undo: vi.fn(),
}));

vi.mock('../api/crud.js', async (original) => {
  const real = await original<typeof import('../api/crud.js')>();
  return {
    ...real,
    createCrudApi: (connectionId: string, table: string) => {
      const api = {
        list: vi.fn(async () => ({ data: crud.rows, page: { limit: 10, offset: 0, total: crud.rows.length } })),
        create: vi.fn(async () => ({ data: {}, undoToken: null })),
        update: vi.fn(async () => ({ data: {}, undoToken: null })),
        remove: vi.fn(async () => ({ data: null, undoToken: 'undo-1' })),
        lookup: vi.fn(async () => [{ value: '7', label: 'Flour' }, { value: '8', label: 'Sugar' }]),
      };
      crud.made.push({ table, api });
      return { connectionId, table, ...api };
    },
  };
});
vi.mock('../app/api.js', async (original) => ({
  ...(await original<typeof import('../app/api.js')>()),
  api: {
    get: vi.fn(async (url: string) => {
      crud.wordsAsked.push(url);
      return { data: crud.words === null ? [] : [crud.words] };
    }),
  },
}));
vi.mock('../pages/toasts.js', () => ({ useUndoToast: () => crud.undo }));

const { default: LinkedRowsTab, summaryWords } = await import('./LinkedRowsTab.js');
const { ApiError } = await import('../app/api.js');
const { FieldRefusedError } = await import('../api/crud.js');

const fact = (name: string, label: string, logicalType = 'varchar', more: Record<string, unknown> = {}) => ({ spec: { name, label, logicalType }, filledBy: null, required: false, writable: true, ...more });
const TAB: RecordTabFact = {
  addOn: 'inventory',
  id: 'stock',
  label: 'Stock',
  labelKey: 'tab.stock',
  tableId: 'public.inventory_links',
  key: 'id',
  match: { table: 'source_table', row: 'source_row', tableRef: 'pos:menu_items' },
  mode: 'list',
  columns: [fact('item_id', 'Item', 'integer'), fact('qty', 'Quantity', 'decimal'), fact('unit', 'Unit', 'varchar', { options: { values: [{ value: 'g', label: 'Grams' }, { value: 'kg', label: 'Kilograms' }] } })],
  edit: ['qty', 'unit'],
  form: [],
  add: [{ fk: 'item_id', table: 'public.inventory_items', key: 'id', label: 'name' }],
  remove: true,
  actions: [{ id: 'use', label: 'Use stock', labelKey: 'tab.use', tableId: 'public.inventory_uses', form: [fact('qty', 'Quantity', 'decimal', { required: true })], can: true }],
  empty: 'No ingredients yet.',
  emptyKey: 'tab.empty',
  summary: { words: 'stock' },
  can: { read: true, create: true, update: true, delete: true },
};
const TWO = [
  { id: 31, item_id: 7, item_id__label: 'Flour', qty: '0.250', unit: 'kg' },
  { id: 32, item_id: 8, item_id__label: 'Sugar', qty: '40.000', unit: 'g' },
];

function mount(tab: RecordTabFact = TAB) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LinkedRowsTab tab={tab} connectionId="cnx_1" recordId="12" />
    </QueryClientProvider>,
  );
}
/** The data API of one table, as the tab made it. */
const apiOf = (table: string) => crud.made.filter((one) => one.table === table).at(-1)!.api;

beforeEach(() => {
  crud.made.length = 0;
  crud.rows = TWO;
  crud.words = null;
  crud.wordsAsked.length = 0;
  crud.undo.mockReset();
});
afterEach(cleanup);

describe('a dish with two usage lines', () => {
  it('shows them and Add, found by this record\'s table and key', async () => {
    mount();
    expect(await screen.findByText('Flour')).toBeTruthy();
    expect(screen.getByText('Sugar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(apiOf('public.inventory_links').list).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { and: [{ column: 'source_table', op: 'eq', value: 'pos:menu_items' }, { column: 'source_row', op: 'eq', value: '12' }] },
        lookup: ['item_id__label:item_id.name'],
        limit: 10,
        offset: 0,
      }),
    );
    // A column that is not edited is read; one that is, is its control: a number, one of a list.
    const row = document.querySelector('[data-row="31"]') as HTMLElement;
    expect((within(row).getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement).value).toBe('0.250');
    expect((within(row).getByRole('combobox', { name: 'Unit' }) as HTMLSelectElement).value).toBe('kg');
    expect(within(row).queryByRole('textbox', { name: 'Item' })).toBeNull();
  });

  it('a cell saves on blur, and on Enter; a value not changed saves nothing', async () => {
    const user = userEvent.setup();
    mount();
    const row = (await screen.findByText('Flour')).closest('tr') as HTMLElement;
    const qty = within(row).getByRole('textbox', { name: 'Quantity' });
    await user.click(qty);
    await user.tab();
    expect(apiOf('public.inventory_links').update).not.toHaveBeenCalled();
    await user.clear(qty);
    await user.type(qty, '0.5');
    await user.tab();
    await waitFor(() => expect(apiOf('public.inventory_links').update).toHaveBeenCalledWith('31', { qty: '0.5' }));
    await user.selectOptions(within(row).getByRole('combobox', { name: 'Unit' }), 'g');
    await waitFor(() => expect(apiOf('public.inventory_links').update).toHaveBeenCalledWith('31', { unit: 'g' }));
  });

  it('a cell keeps a refused value with the server\'s reason', async () => {
    const user = userEvent.setup();
    mount();
    const row = (await screen.findByText('Sugar')).closest('tr') as HTMLElement;
    apiOf('public.inventory_links').update.mockRejectedValueOnce(new FieldRefusedError(new ApiError(422, 'VALIDATION_FAILED', 'refused', 'req', {}), { qty: { code: 'required' } }));
    const qty = within(row).getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, '-3{Enter}');
    expect(await within(row).findByRole('alert')).toBeTruthy();
    expect(within(row).getByRole('alert').textContent).toBe('This field is required.');
    // What was typed stays, marked, with the reason beside it.
    expect(qty.value).toBe('-3');
    expect(qty.getAttribute('aria-invalid')).toBe('true');
    // Any other failure is said in the server's own words.
    apiOf('public.inventory_links').update.mockRejectedValueOnce(new Error('Out of stock.'));
    await user.type(qty, '0{Enter}');
    await waitFor(() => expect(within(row).getByRole('alert').textContent).toBe('Out of stock.'));
    expect(qty.value).toBe('-30');
  });

  it('Add posts the pair with the picked item — the pair is this record\'s, never the picked row\'s', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Flour');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const picker = await screen.findByRole('combobox', { name: 'Pick one' });
    expect(apiOf('public.inventory_items').lookup).toHaveBeenCalledWith({ table: 'public.inventory_items', column: 'id', display: 'name' }, '');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: 'Sugar' }));
    await waitFor(() => expect(apiOf('public.inventory_links').create).toHaveBeenCalledWith({ item_id: '8', source_table: 'pos:menu_items', source_row: '12' }));
  });

  it('remove offers undo', async () => {
    const user = userEvent.setup();
    mount();
    const row = (await screen.findByText('Flour')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiOf('public.inventory_links').remove).toHaveBeenCalledWith('31', { confirm: true }));
    await waitFor(() => expect(crud.undo).toHaveBeenCalledWith(expect.objectContaining({ title: 'Removed', undoToken: 'undo-1' })));
  });

  it('Use stock creates a row of the action\'s table with the same pair, and asks for what it needs first', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Flour');
    await user.click(screen.getByRole('button', { name: 'Use stock' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Use stock' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Fill this in first.');
    expect(crud.made.some((one) => one.table === 'public.inventory_uses' && one.api.create.mock.calls.length > 0)).toBe(false);
    await user.type(within(dialog).getByRole('textbox', { name: 'Quantity' }), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Use stock' }));
    await waitFor(() => expect(apiOf('public.inventory_uses').create).toHaveBeenCalledWith({ qty: '2', source_table: 'pos:menu_items', source_row: '12' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a reader is offered only what they may do', async () => {
    mount({ ...TAB, can: { read: true, create: false, update: false, delete: false }, actions: [{ ...TAB.actions[0]!, can: false }] });
    const row = (await screen.findByText('Flour')).closest('tr') as HTMLElement;
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use stock' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(within(row).getByText('0.250')).toBeTruthy();
    // A choice is read by its word, not its stored value.
    expect(within(row).getByText('Kilograms')).toBeTruthy();
  });
});

describe('the summary', () => {
  it('is hidden on an empty list — nothing is asked — and the add-on\'s own empty words are shown', async () => {
    crud.rows = [];
    crud.words = { id: '12', state: 'in', exact: '8' };
    mount();
    expect(await screen.findByText('No ingredients yet.')).toBeTruthy();
    expect(document.querySelector('[data-part="linked-summary"]')).toBeNull();
    expect(crud.wordsAsked).toEqual([]);
  });

  it('with first, names the item that runs out first; without it, only the count', async () => {
    crud.words = { id: '12', state: 'in', exact: '8', first: { item: 'Flour', unit: 'kg' } };
    mount();
    expect(await screen.findByText('Enough for 8 more')).toBeTruthy();
    expect(screen.getByText('Flour runs out first')).toBeTruthy();
    expect(crud.wordsAsked).toEqual(['/api/v1/words/inventory/stock?table=pos%3Amenu_items&ids=12']);
    expect(screen.queryByText('Expires soon')).toBeNull();
    expect(summaryWords({ id: '12', state: 'in', exact: '8' }, 'list')).toEqual({ line: 'Enough for 8 more', first: null, soon: false });
  });

  it('soon shows the chip', async () => {
    crud.words = { id: '12', state: 'low', exact: '2', soon: true };
    mount();
    expect(await screen.findByText('Expires soon')).toBeTruthy();
  });

  it('a public-shaped answer shows the state word and no figure', async () => {
    crud.words = { id: '12', state: 'low', left: 4 };
    mount();
    expect(await screen.findByText('Low')).toBeTruthy();
    expect(document.querySelector('[data-part="linked-summary"]')!.textContent).toBe('Low');
    expect(summaryWords({ id: '1', state: 'out' }, 'list').line).toBe('Out');
    expect(summaryWords({ id: '1', state: 'in', first: { item: 'Flour', unit: 'kg' }, soon: true }, 'list')).toEqual({ line: 'In stock', first: null, soon: false });
  });

  it('form mode says what is on hand, in the unit of the answer', () => {
    expect(summaryWords({ id: '1', state: 'in', exact: '12.5', first: { item: 'Flour', unit: 'kg' } }, 'form')).toEqual({ line: '12.5 kg on hand', first: null, soon: false });
    expect(summaryWords({ id: '1', state: 'in', exact: '12.5' }, 'form').line).toBe('12.5 on hand');
  });
});

describe('form mode', () => {
  const FORM: RecordTabFact = { ...TAB, mode: 'form', form: ['item_id', 'qty'], add: [], actions: [] };
  it('shows one row as a small form, its editable values saved where they stand', async () => {
    const user = userEvent.setup();
    crud.rows = [TWO[0]!];
    mount(FORM);
    const form = (await screen.findByText('Flour')).closest('[data-part="linked-form"]') as HTMLElement;
    expect(document.querySelector('[data-part="linked-table"]')).toBeNull();
    // The one row is there: nothing more is added.
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(within(form).queryByRole('combobox', { name: 'Unit' })).toBeNull();
    const qty = within(form).getByRole('textbox', { name: 'Quantity' });
    await user.clear(qty);
    await user.type(qty, '1{Enter}');
    await waitFor(() => expect(apiOf('public.inventory_links').update).toHaveBeenCalledWith('31', { qty: '1' }));
  });

  it('with no row yet, says so and makes the row for this record on Add', async () => {
    const user = userEvent.setup();
    crud.rows = [];
    mount(FORM);
    expect(await screen.findByText('No ingredients yet.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiOf('public.inventory_links').create).toHaveBeenCalledWith({ source_table: 'pos:menu_items', source_row: '12' }));
  });
});

describe('two pickers', () => {
  it('ask which first, then pick from that one\'s table', async () => {
    const user = userEvent.setup();
    mount({ ...TAB, columns: [...TAB.columns, fact('kit_id', 'Kit', 'integer')], add: [...TAB.add, { fk: 'kit_id', table: 'public.inventory_kits', key: 'id', label: 'title' }] });
    await screen.findByText('Flour');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const which = screen.getByRole('group', { name: 'What do you want to add?' });
    expect(within(which).getAllByRole('button').map((button) => button.textContent)).toEqual(['Item', 'Kit']);
    await user.click(within(which).getByRole('button', { name: 'Kit' }));
    const picker = await screen.findByRole('combobox', { name: 'Pick one' });
    expect(apiOf('public.inventory_kits').lookup).toHaveBeenCalledWith({ table: 'public.inventory_kits', column: 'id', display: 'title' }, '');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: 'Flour' }));
    await waitFor(() => expect(apiOf('public.inventory_links').create).toHaveBeenCalledWith({ kit_id: '7', source_table: 'pos:menu_items', source_row: '12' }));
  });
});
