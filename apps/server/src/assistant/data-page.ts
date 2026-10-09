// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data page a question is asked on, as the SERVER knows it.
 *
 * The request names a page and says what the page is showing; it does not
 * say which table that is. The table is the page's own, read here from the
 * stored page, after the same check the page's own route makes: the person
 * may view this page. A page they may not view, a page that is switched off,
 * a page that is gone: each is "no page", and the assistant then knows only
 * what the person may read anyway.
 *
 * WHAT "THESE" MEANS. A person on a grid says "these", "this list", "the ones
 * I picked". Which rows that is, is a fact of the page: the rows ticked, else
 * the record open, else the rows the grid's search and filters leave. The
 * model is never asked to spell that. A tool is called with a `scope`, and
 * this module turns the scope into a filter the tool cannot widen
 * ({@link scopeFilter}), built from what the page itself sent the list route.
 */
import { pagesRepo } from '@adminium/meta';

import { MAX_IN_VALUES, parseWhereParam, type RecordFilter } from '../crud/filters.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { AssistantToolDeps } from './types.js';

/** What a data page is showing, as its host sent it. */
export interface DataPageView {
  q?: string | undefined;
  order?: string | undefined;
  where?: string | undefined;
  selectedIds?: string[] | undefined;
  recordId?: string | undefined;
}

export interface DataPage {
  id: string;
  title: string;
  /** The page template, e.g. `page-crud`. */
  kind: string;
  connectionId: string | null;
  /** The page's own table id (`schema.name`), or `null` for a page whose widgets read several. */
  table: string | null;
  view: DataPageView;
}

/** Which rows a tool call is about. */
export type DataScope = 'selection' | 'record' | 'page';
export const DATA_SCOPES: readonly DataScope[] = ['selection', 'record', 'page'];

/** The page this turn is asked on, or `null` when there is none the person may view. */
export async function dataPageOf(deps: AssistantToolDeps): Promise<DataPage | null> {
  const host = deps.host;
  if (host.pageId === undefined || host.pageId === '') return null;
  const page = await pagesRepo(deps.meta).findById(host.pageId);
  if (page === null || !page.isEnabled) return null;
  // The page's own view gate, as its route asks it.
  if (!(await deps.can(`page:${page.id}:view`)) && !(await deps.can('system:pages:manage'))) return null;
  const source = (page.config as { source?: { connectionId?: unknown; table?: unknown } } | null)?.source;
  const table = typeof source?.table === 'string' && source.table !== '' ? source.table : null;
  const connectionId = typeof source?.connectionId === 'string' && source.connectionId !== '' ? source.connectionId : page.connectionId;
  return { id: page.id, title: page.title, kind: page.type, connectionId, table, view: host.view ?? {} };
}

/** The scope a question most likely means: what is ticked, else what is open, else what the grid shows. */
export function defaultScope(view: DataPageView): DataScope {
  if ((view.selectedIds?.length ?? 0) > 0) return 'selection';
  if (view.recordId !== undefined && view.recordId !== '') return 'record';
  return 'page';
}

export type ScopeResolution =
  | { ok: true; mandatory: RecordFilter | undefined; q: string | undefined; order: string | undefined; rows: number | null }
  | { ok: false; code: string; message: string };

/** A key as its column holds it: a whole number for a numeric key, else the text. */
function keyValue(table: ResolvedTable, column: string, raw: string): string | number {
  const type = table.columns.get(column)?.logicalType ?? '';
  return /int|serial|number|numeric|decimal/i.test(type) && /^-?\d{1,15}$/.test(raw) ? Number(raw) : raw;
}

/**
 * The filter one scope stands for, on the page's own table.
 *
 * It becomes the list pipeline's MANDATORY predicate, ANDed before anything
 * the model wrote, so a tool call can narrow "these rows" and never widen
 * them. A scope on another table than the page's is refused: the page says
 * nothing about that table's rows.
 */
export function scopeFilter(page: DataPage | null, scope: DataScope, connectionId: string, table: ResolvedTable): ScopeResolution {
  if (page === null || page.table === null) {
    return { ok: false, code: 'NO_PAGE_SCOPE', message: 'There is no page view to apply here. Leave `scope` out and say which rows you mean with `where`.' };
  }
  if (page.connectionId !== connectionId || page.table !== table.id) {
    return { ok: false, code: 'SCOPE_OTHER_TABLE', message: `\`scope\` is about the page's own table, ${page.table}. For ${table.id}, leave it out.` };
  }
  const view = page.view;
  if (scope === 'page') {
    try {
      return { ok: true, mandatory: view.where === undefined || view.where === '' ? undefined : parseWhereParam(view.where), q: view.q === '' ? undefined : view.q, order: view.order === '' ? undefined : view.order, rows: null };
    } catch {
      // The page sent a filter this server cannot read: answering about every row would be answering another question.
      return { ok: false, code: 'PAGE_VIEW_UNREADABLE', message: 'The page\'s filter could not be read, so "the rows shown" is not known. Ask the person which rows they mean.' };
    }
  }
  const key = table.primaryKey;
  if (key.length !== 1) {
    return { ok: false, code: 'SCOPE_COMPOSITE_KEY', message: `${table.id} has no single key column, so a selection cannot be named here. Use scope "page" or a \`where\`.` };
  }
  const column = key[0] as string;
  if (scope === 'record') {
    if (view.recordId === undefined || view.recordId === '') return { ok: false, code: 'NO_OPEN_RECORD', message: 'No record is open on the page.' };
    return { ok: true, mandatory: { column, op: 'eq', value: keyValue(table, column, view.recordId) }, q: undefined, order: undefined, rows: 1 };
  }
  const ids = (view.selectedIds ?? []).slice(0, MAX_IN_VALUES);
  if (ids.length === 0) return { ok: false, code: 'NOTHING_SELECTED', message: 'No rows are selected on the page.' };
  return { ok: true, mandatory: { column, op: 'in', value: ids.map((id) => keyValue(table, column, id)) }, q: undefined, order: undefined, rows: ids.length };
}

/** `scope`, read from a tool's arguments: one of the three words, or none. */
export function scopeArg(value: unknown): DataScope | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && (DATA_SCOPES as readonly string[]).includes(value) ? (value as DataScope) : 'invalid';
}

/** What the tools' `scope` argument is told to be. */
export const SCOPE_ARG = {
  type: 'string',
  enum: [...DATA_SCOPES],
  description:
    'Only on the page\'s own table. "selection" = the rows the person ticked; "record" = the record they have open; "page" = the rows the grid shows now (its search and filters). The server applies it; do not repeat it in `where`. Use it whenever the person says these, this list, here, the ones shown or the ones selected.',
} as const;
