// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a list page is showing, in the list route's own spellings (`q`,
 * `order`, `where` as JSON text): the form the assistant is told "the rows on
 * screen" in, so that it reads exactly those rows through the same route
 * machinery the grid read them with.
 *
 * Remembered per page for the life of the app, like the grid's own state: the
 * record page replaces the list, and "this order, and the list it came from"
 * is one context there.
 */
import type { CrudFilter, CrudFilterCondition, CrudSort } from '@adminium/widgets';

import type { PageAssistantView } from '../shell/PageActionsProvider.js';
import { andWhere } from './linkFilters.js';

/** The most ticked rows a view names. The server refuses more; past it, "these" is the filtered list. */
export const LIST_VIEW_MAX_SELECTED = 200;

export function listViewOf(input: {
  search: string;
  sort: CrudSort | null;
  filters: readonly CrudFilterCondition[];
  /** The filter a link into the page carries, under every read of the list. */
  linkWhere: CrudFilter | null;
  selectedIds: readonly string[];
}): PageAssistantView {
  const own: CrudFilter | undefined =
    input.filters.length === 0 ? undefined : input.filters.length === 1 ? (input.filters[0] as CrudFilterCondition) : { and: [...input.filters] };
  const where = input.linkWhere === null ? own : andWhere(input.linkWhere, own);
  const search = input.search.trim();
  return {
    ...(search === '' ? {} : { q: search }),
    ...(input.sort === null ? {} : { order: `${input.sort.column}.${input.sort.dir}` }),
    ...(where === undefined ? {} : { where: JSON.stringify(where) }),
    ...(input.selectedIds.length === 0 || input.selectedIds.length > LIST_VIEW_MAX_SELECTED ? {} : { selectedIds: [...input.selectedIds] }),
  };
}

const lastListView = new Map<string, PageAssistantView>();

/** Keep what a page's list last showed, without the ticks: a selection does not outlive the list. */
export function rememberListView(pageId: string, view: PageAssistantView): void {
  const { selectedIds: _ticks, ...rest } = view;
  lastListView.set(pageId, rest);
}

export function rememberedListView(pageId: string): PageAssistantView {
  return lastListView.get(pageId) ?? {};
}
