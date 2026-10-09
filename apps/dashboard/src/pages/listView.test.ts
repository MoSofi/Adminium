// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a list tells the assistant it is showing, in the list route's own
 * spellings: the server reads "the rows on screen" with exactly these.
 */
import { describe, expect, it } from 'vitest';

import { LIST_VIEW_MAX_SELECTED, listViewOf, rememberListView, rememberedListView } from './listView.js';

const none = { search: '', sort: null, filters: [], linkWhere: null, selectedIds: [] };

describe('listViewOf', () => {
  it('is empty for a grid that shows the whole table', () => {
    expect(listViewOf(none)).toEqual({});
  });

  it('spells the search, the sort and one filter as the list route takes them', () => {
    const filter = { column: 'country', op: 'eq', value: 'Germany' } as never;
    expect(listViewOf({ ...none, search: '  ada ', sort: { column: 'total', dir: 'desc' }, filters: [filter] })).toEqual({
      q: 'ada',
      order: 'total.desc',
      where: JSON.stringify(filter),
    });
  });

  it('joins several filters, and puts a link`s filter under them', () => {
    const a = { column: 'country', op: 'eq', value: 'Germany' } as never;
    const b = { column: 'orders', op: 'gt', value: 3 } as never;
    const link = { column: 'customer_id', op: 'eq', value: 7 } as never;
    expect(JSON.parse(listViewOf({ ...none, filters: [a, b] }).where!)).toEqual({ and: [a, b] });
    expect(JSON.parse(listViewOf({ ...none, filters: [a], linkWhere: link }).where!)).toEqual({ and: [link, a] });
    expect(JSON.parse(listViewOf({ ...none, linkWhere: link }).where!)).toEqual(link);
  });

  it('names the ticked rows, and none at all past what the server takes', () => {
    expect(listViewOf({ ...none, selectedIds: ['3', '9'] }).selectedIds).toEqual(['3', '9']);
    const many = Array.from({ length: LIST_VIEW_MAX_SELECTED + 1 }, (_, n) => String(n));
    expect(listViewOf({ ...none, selectedIds: many }).selectedIds).toBeUndefined();
  });
});

describe('what a page`s list last showed', () => {
  it('is kept for the record page, without the ticks', () => {
    rememberListView('page_a', { q: 'ada', order: 'name.asc', selectedIds: ['1'] });
    expect(rememberedListView('page_a')).toEqual({ q: 'ada', order: 'name.asc' });
    expect(rememberedListView('page_never')).toEqual({});
  });
});
