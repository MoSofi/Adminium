// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `PageRecordProps.hostTabs` — tabs of the host's own, inside the record's
 * tab strip.
 *
 * Rows that belong to a record and are found by something other than a
 * foreign key (an add-on's rows for it) have no tab of the page's own: the
 * host passes the tab's name and its content, and the page gives it a place.
 * What is pinned here is the place — after the tabs of linked tables, before
 * Files and Activity — and that a record whose only tab is the host's has a
 * tab strip at all, open on it.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageRecord, type PageRecordProps, type PageRecordRelated } from './PageRecord.js';
import type { CrudApi } from '../page-crud/crud-api.js';
import { gridColumnSpecSchema, type GridColumnSpecInput } from '../../families/tables/column-spec.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);
const COLUMNS = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, nullable: false }),
  spec({ name: 'name', label: 'Name', logicalType: 'varchar', isDisplay: true }),
];
const RECORD = { id: 1, name: 'Lentil soup' };

function api(): CrudApi {
  return {
    list: () => Promise.resolve({ data: [RECORD], cursor: { next: null } }),
    get: () => Promise.resolve({ data: RECORD, inboundCounts: [{ relationId: 'rel', table: 'public.order_lines', column: 'dish_id', count: 2 }] }),
    create: () => Promise.resolve({ data: null, undoToken: null }),
    update: () => Promise.resolve({ data: null, undoToken: null }),
    remove: () => Promise.resolve({ data: null, undoToken: null }),
    references: () => Promise.resolve([]),
    undo: () => Promise.resolve({ restoredIds: [1] }),
  } as unknown as CrudApi;
}

const related = (): PageRecordRelated => ({
  list: vi.fn(async () => ({ data: [{ id: 5, dish_id: 1, qty: 2 }], cursor: { next: null } })),
  resolve: vi.fn(async () => ({ columns: [spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true }), spec({ name: 'qty', label: 'Qty', logicalType: 'integer' })], defaultSort: null })),
  linkable: vi.fn(() => true),
});

const STOCK = { id: 'inventory-stock', label: 'Stock', count: 2, content: <p>two usage lines</p> };
const CARDS = { id: 'offers-cards', label: 'Cards', content: <p>no card used</p> };

function renderRecord(props: Partial<PageRecordProps> = {}) {
  return render(<PageRecord api={api()} columns={COLUMNS} source={{ connectionId: 'conn_1', table: 'public.dishes' }} recordId="1" keyField="name" {...props} />);
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const selected = () => screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.textContent);

describe('tabs of the host\'s own on a record', () => {
  it('a record with no host tab is what it always was: no tab strip without a tab', async () => {
    renderRecord();
    await screen.findByRole('heading', { name: 'Lentil soup' });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText('two usage lines')).toBeNull();
  });

  it('a record with only a host tab has a tab strip, and opens on it', async () => {
    renderRecord({ hostTabs: [STOCK] });
    expect(await screen.findByRole('tab', { name: /Stock/ })).not.toBeNull();
    expect(selected()).toEqual([expect.stringContaining('Stock')]);
    // Its content is the host's, inside the tab's own panel.
    expect(screen.getByText('two usage lines').closest('[role="tabpanel"]')).not.toBeNull();
    // The count the host knows sits beside the name; a tab without one has none.
    expect(screen.getByRole('tab', { name: /Stock/ }).textContent).toContain('2');
  });

  it('host tabs sit after link tabs and before Files and Activity, in the order given', async () => {
    renderRecord({
      tabs: [{ table: 'public.order_lines', fkColumn: 'dish_id', label: 'Order lines' }],
      related: related(),
      hostTabs: [STOCK, CARDS],
      attachments: { list: async () => [], upload: async () => ({}) as never, remove: async () => undefined } as never,
      canAttach: true,
      activity: { list: async () => ({ entries: [], nextCursor: null }) },
    });
    await screen.findByRole('tab', { name: /Stock/ });
    expect(tabNames().map((name) => name?.replace(/\d+$/, ''))).toEqual(['Order lines', 'Stock', 'Cards', 'Files', 'Activity']);
    // The record opens on its first link tab, as it always did; a host tab is a click away.
    expect(selected()[0]).toContain('Order lines');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Cards' }));
    expect(selected()).toEqual(['Cards']);
    expect(screen.getByText('no card used')).not.toBeNull();
  });

  it('with Files and Activity alone beside it, the host tab comes first and is the one open', async () => {
    renderRecord({ hostTabs: [CARDS], activity: { list: async () => ({ entries: [], nextCursor: null }) } });
    await screen.findByRole('tab', { name: 'Cards' });
    expect(tabNames()).toEqual(['Cards', 'Activity']);
    expect(selected()).toEqual(['Cards']);
  });
});
