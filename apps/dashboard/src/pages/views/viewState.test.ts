// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved-view round trip (M5-T06). The property that matters is the one the
 * feature is named after: applying a saved view has to reproduce EXACTLY the
 * query the grid held when it was saved. So the two mappings are tested as a
 * pair — state → config → props — rather than one at a time, and
 * `gridMatchesConfig` is tested against the shapes that are equal in meaning
 * but not in spelling (an omitted search vs `''`, an absent sort vs `null`),
 * because that comparison is what decides whether the toolbar shows the view
 * as "applied" or as "modified".
 */
import { describe, expect, it } from 'vitest';
import type { PageCrudGridState } from '@adminium/widgets';

import { configToProps, gridMatchesConfig, gridStateToConfig } from './viewState.js';
import type { ViewConfig } from './viewsApi.js';

function gridState(overrides: Partial<PageCrudGridState> = {}): PageCrudGridState {
  return {
    search: '',
    sort: null,
    filters: [],
    pageSize: 25,
    ...overrides,
  } as PageCrudGridState;
}

describe('gridStateToConfig', () => {
  it('stamps the config version and carries sort, filters and page size', () => {
    const config = gridStateToConfig(
      gridState({
        search: 'ava',
        sort: { column: 'created_at', dir: 'desc' },
        filters: [{ column: 'status', op: 'eq', value: 'open' }],
        pageSize: 50,
      } as Partial<PageCrudGridState>),
    );
    expect(config).toEqual({
      v: 1,
      search: 'ava',
      sort: { column: 'created_at', dir: 'desc' },
      filters: [{ column: 'status', op: 'eq', value: 'open' }],
      pageSize: 50,
    });
  });

  it('omits an empty search rather than persisting a blank key', () => {
    expect(gridStateToConfig(gridState())).toEqual({ v: 1, sort: null, filters: [], pageSize: 25 });
  });
});

describe('configToProps', () => {
  it('restores every stored control onto the grid props', () => {
    expect(
      configToProps({
        v: 1,
        search: 'ava',
        sort: { column: 'created_at', dir: 'desc' },
        filters: [{ column: 'status', op: 'eq', value: 'open' }],
        pageSize: 50,
      } as ViewConfig),
    ).toEqual({
      initialSearch: 'ava',
      defaultSort: { column: 'created_at', dir: 'desc' },
      initialFilters: [{ column: 'status', op: 'eq', value: 'open' }],
      pageSize: 50,
    });
  });

  it('falls back to a clean grid when there is no view applied', () => {
    expect(configToProps(null)).toEqual({
      initialSearch: '',
      defaultSort: null,
      initialFilters: [],
      // `undefined`, not a number: the grid then keeps its own default rather
      // than being pinned to whatever this module guessed.
      pageSize: undefined,
    });
  });

  it('fills the gaps of a partially stored config', () => {
    expect(configToProps({ v: 1, pageSize: 100 })).toEqual({
      initialSearch: '',
      defaultSort: null,
      initialFilters: [],
      pageSize: 100,
    });
  });
});

describe('the round trip', () => {
  it('state → config → props reproduces the query the grid was saved with', () => {
    const state = gridState({
      search: 'ava',
      sort: { column: 'total', dir: 'asc' },
      filters: [{ column: 'status', op: 'in', value: ['open', 'paid'] }],
      pageSize: 50,
    } as Partial<PageCrudGridState>);
    const props = configToProps(gridStateToConfig(state));
    expect(props.initialSearch).toBe(state.search);
    expect(props.defaultSort).toEqual(state.sort);
    expect(props.initialFilters).toEqual(state.filters);
    expect(props.pageSize).toBe(state.pageSize);
  });
});

describe('gridMatchesConfig', () => {
  const applied: ViewConfig = {
    v: 1,
    search: 'ava',
    sort: { column: 'total', dir: 'asc' },
    filters: [{ column: 'status', op: 'eq', value: 'open' }],
    pageSize: 50,
  } as ViewConfig;
  const state = gridState({
    search: 'ava',
    sort: { column: 'total', dir: 'asc' },
    filters: [{ column: 'status', op: 'eq', value: 'open' }],
    pageSize: 50,
  } as Partial<PageCrudGridState>);

  it('recognises the view the grid is currently showing', () => {
    expect(gridMatchesConfig(state, applied)).toBe(true);
  });

  it('treats an omitted search and an empty one as the same query', () => {
    // `gridStateToConfig` drops `search: ''`; a config saved before that rule
    // may still carry it. Both mean "no search", and neither may light up the
    // "modified" affordance.
    expect(gridMatchesConfig(gridState(), { v: 1, sort: null, filters: [], pageSize: 25 })).toBe(true);
    expect(gridMatchesConfig(gridState(), { v: 1, search: '', sort: null, filters: [], pageSize: 25 })).toBe(
      true,
    );
  });

  it('notices a change in any one control', () => {
    expect(gridMatchesConfig({ ...state, search: 'ivo' } as PageCrudGridState, applied)).toBe(false);
    expect(gridMatchesConfig({ ...state, pageSize: 25 } as PageCrudGridState, applied)).toBe(false);
    expect(gridMatchesConfig({ ...state, filters: [] } as PageCrudGridState, applied)).toBe(false);
    expect(
      gridMatchesConfig(
        { ...state, sort: { column: 'total', dir: 'desc' } } as PageCrudGridState,
        applied,
      ),
    ).toBe(false);
  });

  it('ignores keys the grid does not own, like a stored column set', () => {
    expect(gridMatchesConfig(state, { ...applied, columns: ['id', 'total'] })).toBe(true);
  });
});
