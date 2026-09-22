// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The keys page's rules, pure: what the sheet's selection means, what its
 * bulk actions touch, the sentences it prints, and how the builder edits a
 * definition without losing a key the form does not draw. No React, no
 * fetch — every rule here is unit-tested on its own.
 */
import type { EndpointDto, KeyAccess, Method, SourceDto } from './apiKeysApi.js';

/** The design's method order, which every list and every badge row keeps. */
export const METHODS: readonly Method[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'BATCH'];

const byOrder = (methods: Iterable<Method>): Method[] => {
  const set = new Set(methods);
  return METHODS.filter((m) => set.has(m));
};

/* --------------------------------------------------------------- selection */

/** The sheet's draft grant: `{ ref: methods }`. A ref with no method is absent. */
export type Selection = Readonly<Record<string, readonly Method[]>>;

export type TriState = 'none' | 'some' | 'all';

/** How many of an endpoint's methods are selected. */
export function triState(selected: readonly Method[] | undefined, offered: readonly Method[]): TriState {
  const n = (selected ?? []).filter((m) => offered.includes(m)).length;
  if (n === 0) return 'none';
  return n === offered.length ? 'all' : 'some';
}

function withRef(selection: Selection, ref: string, methods: readonly Method[]): Selection {
  const next: Record<string, readonly Method[]> = { ...selection };
  if (methods.length === 0) delete next[ref];
  else next[ref] = byOrder(methods);
  return next;
}

/** Every method on, unless every method is already on — then none. */
export function toggleAll(selection: Selection, endpoint: Pick<EndpointDto, 'ref' | 'methods'>): Selection {
  const all = triState(selection[endpoint.ref], endpoint.methods) === 'all';
  return withRef(selection, endpoint.ref, all ? [] : endpoint.methods);
}

export function toggleMethod(selection: Selection, ref: string, method: Method): Selection {
  const current = selection[ref] ?? [];
  return withRef(selection, ref, current.includes(method) ? current.filter((m) => m !== method) : [...current, method]);
}

export function setMethods(selection: Selection, ref: string, methods: readonly Method[]): Selection {
  return withRef(selection, ref, methods);
}

/**
 * Select all / Deselect all / Read-only preset act on the VISIBLE endpoints
 * only. A grant the operator cannot see is the one mistake this dialog must
 * not make; with no filter the readings agree.
 */
export function bulk(
  selection: Selection,
  visible: readonly Pick<EndpointDto, 'ref' | 'methods'>[],
  mode: 'all' | 'none' | 'read',
): Selection {
  let next = selection;
  for (const endpoint of visible) {
    const methods = mode === 'all' ? endpoint.methods : mode === 'read' ? endpoint.methods.filter((m) => m === 'GET') : [];
    next = withRef(next, endpoint.ref, methods);
  }
  return next;
}

/** Matches path + source, case-insensitive. */
export function filterEndpoints<E extends Pick<EndpointDto, 'path' | 'source'>>(endpoints: readonly E[], query: string): E[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...endpoints];
  return endpoints.filter((e) => `${e.path} ${e.source ?? ''}`.toLowerCase().includes(q));
}

/** The toolbar's pill: permissions, and the endpoints they are on. */
export function selectionCounts(selection: Selection): { permissions: number; endpoints: number } {
  const lists = Object.values(selection).filter((m) => m.length > 0);
  return { permissions: lists.reduce((n, m) => n + m.length, 0), endpoints: lists.length };
}

/** The first three paths the key will call, in list order, then "+n more". */
export function footerSummary(
  selection: Selection,
  endpoints: readonly Pick<EndpointDto, 'ref'>[],
): { paths: string[]; more: number } | null {
  const chosen = endpoints.filter((e) => (selection[e.ref] ?? []).length > 0).map((e) => `/${e.ref}`);
  if (chosen.length === 0) return null;
  return { paths: chosen.slice(0, 3), more: Math.max(0, chosen.length - 3) };
}

/**
 * After the builder saves, a method the endpoint no longer offers leaves the
 * draft too. The comp keeps it selected and would grant it.
 */
export function pruneSelection(selection: Selection, endpoints: readonly Pick<EndpointDto, 'ref' | 'methods'>[]): Selection {
  const next: Record<string, readonly Method[]> = {};
  for (const endpoint of endpoints) {
    const kept = (selection[endpoint.ref] ?? []).filter((m) => endpoint.methods.includes(m));
    if (kept.length > 0) next[endpoint.ref] = byOrder(kept);
  }
  return next;
}

/** The scope string, `/customers:get`. */
export function scopeString(ref: string, method: Method): string {
  return `/${ref}:${method.toLowerCase()}`;
}

/* ------------------------------------------------------------- key rows */

/** The badges on a key row: the union of what it can call, in method order. */
export function unionMethods(access: readonly KeyAccess[]): Method[] {
  return byOrder(access.flatMap((a) => a.methods));
}

/** "{n} endpoints · {m} methods" — endpoints with anything granted now, and the permissions. */
export function accessCounts(access: readonly KeyAccess[]): { endpoints: number; methods: number } {
  const live = access.filter((a) => a.methods.length > 0);
  return { endpoints: live.length, methods: live.reduce((n, a) => n + a.methods.length, 0) };
}

/**
 * The masked key: the stored display prefix and twelve bullets. The comp
 * also shows the last four characters; the server stores only a hash and a
 * prefix, so there are no last four to show.
 */
export function maskKey(prefix: string): string {
  return `${prefix}${'•'.repeat(12)}`;
}

/** "2 min ago", "yesterday", or null for never (the caller prints "Never"). */
export function relativeTime(at: number | null, now: number, locale: string): string | null {
  if (at === null) return null;
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86_400) return format.format(Math.round(seconds / 86_400), 'day');
  if (abs < 365 * 86_400) return format.format(Math.round(seconds / (30 * 86_400)), 'month');
  return format.format(Math.round(seconds / (365 * 86_400)), 'year');
}

export type ExpiryChoice = 'd30' | 'd90' | 'never';

/** The comp's three expiries. */
export function expiresAtFor(choice: ExpiryChoice, now: number): number | undefined {
  if (choice === 'never') return undefined;
  return now + (choice === 'd30' ? 30 : 90) * 86_400_000;
}

/** `5k/min`, `600/min`, `20/s`, `1.5k/hr`. */
export function rateLabel(requests: number, window: string): string {
  const unit = window === '1s' ? 's' : window === '1h' ? 'hr' : 'min';
  const n = requests >= 1000 ? `${String(Math.round(requests / 100) / 10)}k` : String(requests);
  return `${n}/${unit}`;
}

/* -------------------------------------------------------------- definitions */

/** A definition as the builder holds it: parsed JSON, keys the form does not draw included. */
export type Definition = Record<string, unknown>;

/** The server's key order, which the pane compares by. */
const KEY_ORDER = [
  'path',
  'source',
  'methods',
  'select',
  'filters',
  'pagination',
  'auth',
  'rate_limit',
  'response',
  'writable',
  'defaults',
  'filterable',
  'searchable',
  'orderable',
  'claim',
  'identity',
  'sensitive',
  'allow_cascade',
] as const;
const PAGINATION_ORDER = ['default_limit', 'max_limit', 'order'];
const RATE_ORDER = ['requests', 'window'];
const FILTER_ORDER = ['column', 'op', 'value'];

function ordered(value: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) if (key in value) out[key] = value[key];
  // A key outside the known set is KEPT, at the end: the server refuses it by
  // name, and a form that dropped it silently would hide the refusal.
  for (const key of Object.keys(value)) if (!(key in out)) out[key] = value[key];
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The canonical text of a definition — the server's `printDefinition`,
 * mirrored, so "synced with form" compares text to text. Methods are
 * printed in method order.
 */
export function printDefinition(doc: Definition): string {
  const out = ordered(doc, KEY_ORDER);
  if (Array.isArray(out['methods'])) {
    const methods = out['methods'] as unknown[];
    const known = METHODS.filter((m) => methods.includes(m));
    const unknown = methods.filter((m) => !METHODS.includes(m as Method));
    out['methods'] = [...known, ...unknown];
  }
  if (Array.isArray(out['filters'])) {
    out['filters'] = (out['filters'] as unknown[]).map((f) => (isRecord(f) ? ordered(f, FILTER_ORDER) : f));
  }
  if (isRecord(out['pagination'])) out['pagination'] = ordered(out['pagination'], PAGINATION_ORDER);
  if (isRecord(out['rate_limit'])) out['rate_limit'] = ordered(out['rate_limit'], RATE_ORDER);
  if (isRecord(out['response'])) out['response'] = ordered(out['response'], ['shape', 'envelope']);
  return JSON.stringify(out, null, 2);
}

/** The pane's text → a definition, or the parser's message for the error strip. */
export function parseDefinitionText(text: string): { ok: true; doc: Definition } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return { ok: false, error: 'A route definition is a JSON object.' };
    return { ok: true, doc: value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A form control PATCHES its own key and leaves every other key alone —
 * `writable`, `defaults`, `claim` and the rest round-trip untouched. The comp
 * rebuilds its JSON from form state on every render, which would erase them.
 */
export function patchDefinition(doc: Definition, patch: Definition): Definition {
  return { ...doc, ...patch };
}

/** A nested key's patch (`pagination`, `rate_limit`, `auth`), keeping its siblings. */
export function patchNested(doc: Definition, key: string, patch: Record<string, unknown>): Definition {
  const current = isRecord(doc[key]) ? (doc[key] as Record<string, unknown>) : {};
  return { ...doc, [key]: { ...current, ...patch } };
}

/** `column.dir` → its halves. */
export function orderParts(order: unknown): { column: string; dir: 'asc' | 'desc' } {
  if (typeof order !== 'string' || !order.includes('.')) return { column: '', dir: 'desc' };
  const at = order.lastIndexOf('.');
  return { column: order.slice(0, at), dir: order.slice(at + 1) === 'asc' ? 'asc' : 'desc' };
}

/**
 * The route input: a ref starts with a lower-case letter and holds only
 * letters, digits and `_`. Typing is coerced rather than refused.
 */
export function coerceRef(input: string): string {
  const cleaned = input.replace(/[^A-Za-z0-9_]/g, '');
  const start = cleaned.search(/[A-Za-z]/);
  if (start === -1) return '';
  const body = cleaned.slice(start);
  return `${body.charAt(0).toLowerCase()}${body.slice(1)}`.slice(0, 64);
}

/** A source's default columns: every column that is not personal data. */
export function defaultColumns(source: SourceDto): string[] {
  return source.columns.filter((c) => !c.pii).map((c) => c.name);
}

/**
 * The builder's blank: the comp's blank — GET, the key column, 20 / 200, key
 * descending, 5,000 a minute, wrapped — with `auth: anon`, because
 * `authenticated` cannot compile without an identity.
 */
export function blankDefinition(source: SourceDto | undefined): Definition {
  const key = source?.columns.find((c) => c.primaryKey)?.name ?? source?.columns[0]?.name ?? 'id';
  return {
    path: '/',
    source: source?.id ?? '',
    methods: ['GET'],
    select: [key],
    filters: [],
    pagination: { default_limit: 20, max_limit: 200, order: `${key}.desc` },
    auth: { role: 'anon' },
    rate_limit: { requests: 5000, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
  };
}

/** The methods a source can support: a view reads; no key, nothing is addressed. */
export function supportedMethods(source: SourceDto | undefined): Method[] {
  if (source === undefined) return [...METHODS];
  if (source.kind !== 'table') return ['GET'];
  if (!source.columns.some((c) => c.primaryKey)) return ['GET', 'POST', 'BATCH'];
  return [...METHODS];
}

/** The response shape a definition names: `wrapped`, `array` or `single`. */
export function shapeOf(doc: Definition): 'wrapped' | 'array' | 'single' {
  const response = isRecord(doc['response']) ? doc['response'] : {};
  if (response['shape'] === 'array') return 'array';
  if (response['shape'] === 'single') return 'single';
  return 'wrapped';
}

export function responseFor(shape: 'wrapped' | 'array' | 'single'): Record<string, unknown> {
  return shape === 'wrapped' ? { shape: 'object', envelope: 'data' } : { shape };
}
