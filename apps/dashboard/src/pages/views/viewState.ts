/**
 * Round-trip between the page-crud toolbar grid state and a persisted view
 * config (M5-T06). Applying a saved view must reproduce exactly the query the
 * grid held when it was saved — search text, sort, filters and page size —
 * hence the symmetric mapping + a structural equality used to detect "this
 * view is the one currently applied".
 */

import type { CrudFilterCondition, CrudSort, PageCrudGridState } from '@adminium/widgets';

import type { ViewConfig } from './viewsApi.js';

/** Grid state → the config we persist (omit empty search for a tidy payload). */
export function gridStateToConfig(state: PageCrudGridState): ViewConfig {
  return {
    v: 1,
    ...(state.search === '' ? {} : { search: state.search }),
    sort: state.sort,
    filters: state.filters,
    pageSize: state.pageSize,
  };
}

export interface PageCrudViewProps {
  initialSearch: string;
  defaultSort: CrudSort | null;
  initialFilters: CrudFilterCondition[];
  pageSize: number | undefined;
}

/** Config → the PageCrud initial props that restore it on (re)mount. */
export function configToProps(config: ViewConfig | null): PageCrudViewProps {
  return {
    initialSearch: config?.search ?? '',
    defaultSort: config?.sort ?? null,
    initialFilters: config?.filters ?? [],
    pageSize: config?.pageSize,
  };
}

/** Stable serialization for structural comparison (order-independent enough). */
function normalize(config: ViewConfig): string {
  return JSON.stringify({
    search: config.search ?? '',
    sort: config.sort ?? null,
    filters: config.filters ?? [],
    pageSize: config.pageSize ?? null,
  });
}

/** Does the current grid state match a saved view's config? */
export function gridMatchesConfig(state: PageCrudGridState, config: ViewConfig): boolean {
  return normalize(gridStateToConfig(state)) === normalize(config);
}
