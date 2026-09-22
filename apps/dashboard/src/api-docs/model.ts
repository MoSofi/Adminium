// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The explorer's pure half: which cards an endpoint has, what each one is
 * called, the playground's URL and prefilled body, and the status line. No
 * React, no fetch — every rule the page follows is testable here.
 *
 * ── CARDS COME FROM THE GRANTED METHODS ────────────────────────────────────
 * The catalogue lists only what live keys may call, with the methods they
 * were granted. GET is two cards — list and retrieve — as the comp draws it;
 * PUT and BATCH get the two cards the comp's data never needed.
 */
import type { CatalogueColumn, CatalogueEndpoint, Method } from './apiDocsApi.js';

export type CardId = 'list' | 'one' | 'create' | 'update' | 'replace' | 'delete' | 'batch';

export interface Card {
  id: CardId;
  /** The badge: a batch is its own method in this API's vocabulary. */
  method: Method;
  /** What goes on the wire. */
  http: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Relative to `/api/v1/public/records`: `/orders`, `/orders/:id`, `/orders/batch`. */
  path: string;
}

/** The prefix every public path is under. */
export const RECORDS_PREFIX = '/api/v1/public/records';

export function cardsFor(endpoint: CatalogueEndpoint): Card[] {
  const has = (m: Method) => endpoint.methods.includes(m);
  const base = `/${endpoint.ref}`;
  const one = `${base}/:id`;
  const out: Card[] = [];
  if (has('GET')) {
    out.push({ id: 'list', method: 'GET', http: 'GET', path: base });
    // Retrieving by id needs a primary key to address the row by.
    if (endpoint.columns.some((c) => c.tags.includes('pk'))) out.push({ id: 'one', method: 'GET', http: 'GET', path: one });
  }
  if (has('POST')) out.push({ id: 'create', method: 'POST', http: 'POST', path: base });
  if (has('PATCH')) out.push({ id: 'update', method: 'PATCH', http: 'PATCH', path: one });
  if (has('PUT')) out.push({ id: 'replace', method: 'PUT', http: 'PUT', path: one });
  if (has('DELETE')) out.push({ id: 'delete', method: 'DELETE', http: 'DELETE', path: one });
  if (has('BATCH')) out.push({ id: 'batch', method: 'BATCH', http: 'POST', path: `${base}/batch` });
  return out;
}

/** Cards that address one row by its key. */
export function takesId(card: Card): boolean {
  return card.path.endsWith('/:id');
}

/** Cards that send a body. */
export function takesBody(card: Card): boolean {
  return card.id === 'create' || card.id === 'update' || card.id === 'replace' || card.id === 'batch';
}

/**
 * The columns a card's schema lists: what a read returns, or what a write may
 * carry. A delete lists none.
 */
export function schemaColumns(endpoint: CatalogueEndpoint, card: Card): CatalogueColumn[] {
  if (card.id === 'list' || card.id === 'one') return endpoint.columns;
  if (card.id === 'delete') return [];
  const writable = new Set(endpoint.writable);
  return endpoint.columns.filter((c) => writable.has(c.name));
}

/**
 * The en-US title computes its article; other locales ignore it. The noun is
 * the source's own label, lower-cased, else the word "row".
 */
export function nounFor(endpoint: CatalogueEndpoint, rowWord: string): { singular: string; article: 'a' | 'an' } {
  const singular = endpoint.singular === null ? rowWord : endpoint.singular.toLocaleLowerCase();
  return { singular, article: /^[aeiou]/i.test(singular) ? 'an' : 'a' };
}

/**
 * The heading's chip.
 * - `anon` with only GET listed → "Public read";
 * - `anon` with any write → "Public";
 * - `authenticated` → "Sign-in required";
 * - `service_role` → "Service role".
 */
export type AuthBadge = 'anon' | 'public' | 'authenticated' | 'service';

export function authBadge(endpoint: CatalogueEndpoint): AuthBadge {
  if (endpoint.auth === 'authenticated') return 'authenticated';
  if (endpoint.auth === 'service_role') return 'service';
  return endpoint.methods.every((m) => m === 'GET') ? 'anon' : 'public';
}

/* -------------------------------------------------------------- playground */

/** A value of the column's type that invents nothing. */
export function placeholderFor(type: string): string | number | boolean | null {
  switch (type) {
    case 'text':
    case 'varchar':
    case 'uuid':
    case 'enum':
    case 'inet':
      return '';
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'float':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

/** The writable columns, each with its placeholder, in the order the catalogue lists them. */
export function sampleValues(endpoint: CatalogueEndpoint): Record<string, unknown> {
  const writable = new Set(endpoint.writable);
  const out: Record<string, unknown> = {};
  for (const column of endpoint.columns) if (writable.has(column.name)) out[column.name] = placeholderFor(column.type);
  return out;
}

/** The wire body a card sends, prefilled: `{values}` for one row, `{rows}` for a batch. */
export function sampleBody(endpoint: CatalogueEndpoint, card: Card): unknown {
  if (!takesBody(card)) return undefined;
  const values = sampleValues(endpoint);
  return card.id === 'batch' ? { rows: [values] } : { values };
}

export interface RequestParams {
  id: string;
  limit: string;
  order: string;
}

/** The full request URL. Empty list params are left off; an empty id stays `:id`. */
export function requestUrl(baseUrl: string, card: Card, params: RequestParams): string {
  const id = params.id.trim();
  const path = card.path.replace(':id', id.length > 0 ? encodeURIComponent(id) : ':id');
  let url = `${baseUrl}${RECORDS_PREFIX}${path}`;
  if (card.id === 'list') {
    const query = new URLSearchParams();
    if (params.limit.trim().length > 0) query.set('limit', params.limit.trim());
    if (params.order.trim().length > 0) query.set('order', params.order.trim());
    const text = query.toString();
    if (text.length > 0) url += `?${text}`;
  }
  return url;
}

/**
 * The status chip reads code + reason from this table: `fetch`'s `statusText`
 * is empty over HTTP/2. These are protocol words, not product copy, so they
 * are not translated.
 */
const REASONS: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function statusLine(status: number): string {
  const reason = REASONS[status];
  return reason === undefined ? String(status) : `${String(status)} ${reason}`;
}

/** Success, a 404 (muted — "nothing there" is not a failure), or a failure. */
export function statusTone(status: number): 'pos' | 'muted' | 'danger' {
  if (status < 300) return 'pos';
  if (status === 404) return 'muted';
  return 'danger';
}
