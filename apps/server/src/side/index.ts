// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminiumjs/adminium/side` — what an app's own screens share.
 *
 * A side is a browser app Adminium serves at `/apps/<key>/<side>/`. This
 * module is the part every side would otherwise write again: finding where it
 * is mounted, reading the config Adminium serves beside it, and — for a staff
 * side — reading and writing the app's tables through the signed-in person's
 * own session.
 *
 * ONE FILE, on purpose: the side build loads it as a single module whose only
 * import is React, found in the project's dependencies. It imports nothing
 * else, from this package or any other.
 *
 * STAFF AND CUSTOMER ARE NOT SYMMETRIC.
 *  - A staff side runs at Adminium's own address, behind its sign-in. It has
 *    no key: it reads `/api/v1/data/…` exactly as the dashboard does, as the
 *    person who is signed in, and may do what their role may do.
 *  - A customer side is public. Adminium serves it a browser key, and with it
 *    the side reaches the public API — and there only what the app's manifest
 *    grants in `publicAccess`. This module hands over the key and the address;
 *    the side makes its client with `@adminiumjs/public-client`.
 *
 * THE VENUE'S CLOCK, NEVER THE READER'S. The time zone comes from the
 * database the app is installed on. When it has none the answer is UTC with
 * `timezoneIsFallback` set, so a screen can say so; the browser's own zone is
 * never used, because it is the reader's and is silently an hour out.
 */

import { useEffect, useState } from 'react';

declare const __ADMINIUM_APP_KEY__: string | undefined;
declare const __ADMINIUM_SIDE__: string | undefined;

export type Side = 'staff' | 'customer';
export type Row = Record<string, unknown>;

/** The app's key, as the build knew it. */
export const APP_KEY: string = typeof __ADMINIUM_APP_KEY__ === 'string' ? __ADMINIUM_APP_KEY__ : '';
/** Which side this bundle is. */
export const SIDE: Side = typeof __ADMINIUM_SIDE__ === 'string' && __ADMINIUM_SIDE__ === 'customer' ? 'customer' : 'staff';

/**
 * Text that is not translated yet. It returns the text as it is; the call is
 * the mark, so the day the app gains a second language every string to
 * translate is found by searching for `en(`.
 */
export function en(text: string): string {
  return text;
}

/**
 * Where this side is mounted, with a trailing slash.
 *
 * `/apps/<key>/<side>/` at the app's own address; `/apps/<key>/<slug>/<side>/`
 * for a second instance of the app; and `/` on a domain mapped to it. Built
 * from the address rather than written into the bundle, because one build is
 * served in all three places.
 */
export function mountBase(pathname: string = globalThis.location?.pathname ?? '/', key: string = APP_KEY, side: Side = SIDE): string {
  const parts = pathname.split('/').filter((part) => part !== '');
  const [root, app, third, fourth] = parts;
  if (root !== 'apps' || app !== key) return '/';
  if (third === side) return `/apps/${key}/${side}/`;
  if (third !== undefined && third !== 'staff' && third !== 'customer' && fourth === side) return `/apps/${key}/${third}/${side}/`;
  return `/apps/${key}/${side}/`;
}

/**
 * Should this page show sample rows held in memory instead of asking
 * Adminium? When it was opened from a file, or its address says `?demo`.
 */
export function wantsDemo(location: { protocol: string; search: string } | undefined = globalThis.location): boolean {
  if (location === undefined) return false;
  return location.protocol === 'file:' || new URLSearchParams(location.search).has('demo');
}

type Fetch = typeof fetch;

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const strings = (value: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''));

/** What went wrong, in words a screen can show. */
export class SideError extends Error {
  override readonly name = 'SideError';
  constructor(
    message: string,
    /** The server's error code, when it sent one (`FORBIDDEN`, `VALIDATION_FAILED`, …). */
    readonly code: string | null = null,
    readonly status: number | null = null,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

/** The config document Adminium serves beside the bundle, or null when none answers. */
async function readConfig(base: string, doFetch: Fetch): Promise<{ status: number; doc: Record<string, unknown> | null }> {
  // Never cached: a key that was replaced, or a new sign-in, must arrive on reload.
  const response = await doFetch(`${base}surface-config.json`, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return { status: response.status, doc: null };
  try {
    const doc: unknown = await response.json();
    return { status: response.status, doc: doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null };
  } catch {
    // An older server answers this address with a page, not a document.
    return { status: response.status, doc: null };
  }
}

// ── staff ────────────────────────────────────────────────────────────────────

export type TableAction = 'read' | 'create' | 'update' | 'delete';

export interface ListOptions {
  /** At most 200, the most one request reads. Default 50. */
  limit?: number;
  offset?: number;
  /** `created_at.desc`, `name.asc,id.desc` — up to three columns. */
  order?: string;
  /** A search over the table's text columns. */
  q?: string;
  /** A filter tree, as the data API takes it: `{ column: 'status', op: 'eq', value: 'open' }`. */
  where?: unknown;
}

export interface Listed {
  rows: Row[];
  /** How many rows match in all, when the server counted. */
  total: number | null;
}

export interface StaffSession {
  /** `demo` holds its rows in memory: nothing is saved. */
  mode: 'hosted' | 'demo';
  connectionId: string | null;
  /** The app's tables: the short name the manifest gives each → its real name in the database. */
  tables: Record<string, string>;
  user: { id: string; name: string; email: string } | null;
  /** What the operator named this app, when they renamed it. */
  appName: string | null;
  /** The app's settings values. */
  settings: Record<string, unknown>;
  /** The venue's time zone (IANA). `UTC` with `timezoneIsFallback` when the database has none set. */
  timezone: string;
  timezoneIsFallback: boolean;
  currency: string | null;
  /** May the signed-in person do this to the table? True when the server did not say. */
  can(table: string, action: TableAction): boolean;
  list(table: string, options?: ListOptions): Promise<Listed>;
  get(table: string, id: string | number): Promise<Row>;
  create(table: string, values: Row): Promise<Row>;
  update(table: string, id: string | number, values: Row): Promise<Row>;
  remove(table: string, id: string | number): Promise<void>;
}

export interface ConnectOptions {
  /** Test seam; `globalThis.fetch` otherwise. */
  fetch?: Fetch;
  /** Test seam; the page's own address otherwise. */
  pathname?: string;
}

const CSRF_HEADER = 'x-adminium-csrf';
const PAGE_MAX = 200;

async function errorOf(response: Response): Promise<SideError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = record(record(body)['error']);
  return new SideError(text(error['message']) ?? `The server answered ${String(response.status)}.`, text(error['code']), response.status, error['details'] ?? null);
}

/**
 * Connect a staff side: read the config Adminium serves to the signed-in
 * person, and return the session the screens read and write through.
 */
export async function connectStaff(options: ConnectOptions = {}): Promise<StaffSession> {
  const doFetch: Fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = mountBase(options.pathname, APP_KEY, 'staff');
  const first = await readConfig(base, doFetch);
  if (first.doc === null) {
    throw new SideError(
      first.status === 401 || first.status === 403
        ? en('Sign in to Adminium to open this screen.')
        : en('This app is not installed on this Adminium, or its screens are switched off.'),
      null,
      first.status,
    );
  }
  const doc = first.doc;
  const connectionId = text(doc['connectionId']);
  const tables = strings(doc['tables']);
  const user = record(doc['user']);
  const access = doc['access'] === undefined || doc['access'] === null ? null : record(record(doc['access'])['tables']);
  const zone = text(doc['timezone']);
  let csrf = text(doc['csrfToken']);

  const real = (table: string): string => tables[table] ?? table;
  const url = (table: string, id?: string | number): string => {
    if (connectionId === null) throw new SideError(en('This app has no database yet. Choose one in its settings.'));
    const record = id === undefined ? '' : `/${encodeURIComponent(String(id))}`;
    return `/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(real(table))}${record}`;
  };

  /** A write, with the signed-in person's token; the token is read again once when the server says it is stale. */
  async function mutate(method: string, address: string, body?: unknown): Promise<unknown> {
    const send = (): Promise<Response> =>
      doFetch(address, {
        method,
        credentials: 'same-origin',
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(csrf === null ? {} : { [CSRF_HEADER]: csrf }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let response = await send();
    if (response.status === 403) {
      const refused = await errorOf(response.clone());
      if (refused.code === 'CSRF_FAILED') {
        csrf = text((await readConfig(base, doFetch)).doc?.['csrfToken']) ?? csrf;
        response = await send();
      }
    }
    if (!response.ok) throw await errorOf(response);
    return response.status === 204 ? null : ((await response.json()) as unknown);
  }

  async function read(address: string): Promise<unknown> {
    const response = await doFetch(address, { credentials: 'same-origin' });
    if (!response.ok) throw await errorOf(response);
    return (await response.json()) as unknown;
  }

  return {
    mode: 'hosted',
    connectionId,
    tables,
    user: text(user['id']) === null ? null : { id: String(user['id']), name: text(user['name']) ?? '', email: text(user['email']) ?? '' },
    appName: text(doc['appName']),
    settings: record(doc['settings']),
    timezone: zone ?? 'UTC',
    timezoneIsFallback: zone === null,
    currency: text(doc['currency']),
    can(table, action) {
      if (access === null) return true;
      const held = access[table];
      return Array.isArray(held) && held.includes(action);
    },
    async list(table, opts = {}) {
      const query = new URLSearchParams({ limit: String(Math.min(opts.limit ?? 50, PAGE_MAX)), count: 'exact' });
      if (opts.offset !== undefined) query.set('offset', String(opts.offset));
      if (opts.order !== undefined) query.set('order', opts.order);
      if (opts.q !== undefined && opts.q !== '') query.set('q', opts.q);
      if (opts.where !== undefined) query.set('where', JSON.stringify(opts.where));
      const reply = record(await read(`${url(table)}?${query.toString()}`));
      const total = record(reply['page'])['total'];
      return { rows: Array.isArray(reply['data']) ? (reply['data'] as Row[]) : [], total: typeof total === 'number' ? total : null };
    },
    async get(table, id) {
      return record(record(await read(url(table, id)))['data']);
    },
    async create(table, values) {
      return record(record(await mutate('POST', url(table), { values }))['data']);
    },
    async update(table, id, values) {
      return record(record(await mutate('PATCH', url(table, id), { values }))['data']);
    },
    async remove(table, id) {
      await mutate('DELETE', url(table, id));
    },
  };
}

/**
 * A staff session over rows held in memory, for looking at a side with no
 * Adminium behind it. Nothing is saved, and every table accepts everything.
 */
export function demoStaff(tables: Record<string, readonly Row[]>): StaffSession {
  const held = new Map(Object.entries(tables).map(([name, rows]) => [name, rows.map((row, index) => ({ id: index + 1, ...row }))]));
  const rowsOf = (table: string): Row[] => {
    if (!held.has(table)) held.set(table, []);
    return held.get(table) as Row[];
  };
  const find = (table: string, id: string | number): Row => {
    const row = rowsOf(table).find((candidate) => String(candidate['id']) === String(id));
    if (row === undefined) throw new SideError(en('That record is not there.'), 'NOT_FOUND', 404);
    return row;
  };
  return {
    mode: 'demo',
    connectionId: null,
    tables: Object.fromEntries([...held.keys()].map((name) => [name, name])),
    user: null,
    appName: null,
    settings: {},
    timezone: 'UTC',
    timezoneIsFallback: true,
    currency: null,
    can: () => true,
    list: async (table, opts = {}) => {
      const all = rowsOf(table);
      const from = opts.offset ?? 0;
      return { rows: all.slice(from, from + Math.min(opts.limit ?? 50, PAGE_MAX)), total: all.length };
    },
    get: async (table, id) => find(table, id),
    create: async (table, values) => {
      const rows = rowsOf(table);
      const row = { id: rows.reduce((max, candidate) => Math.max(max, Number(candidate['id']) || 0), 0) + 1, ...values };
      rows.push(row);
      return row;
    },
    update: async (table, id, values) => Object.assign(find(table, id), values),
    remove: async (table, id) => {
      const rows = rowsOf(table);
      rows.splice(rows.indexOf(find(table, id)), 1);
    },
  };
}

/**
 * The plain rows of a sample data file (`seeds/sample.json`), by table, for
 * {@link demoStaff}. A value written as a directive (`{"@ago": "PT1H"}`) has
 * no meaning without an install and is left out.
 */
export function sampleRows(bundle: unknown): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  const tables = record(bundle)['tables'];
  for (const table of Array.isArray(tables) ? tables : []) {
    const ref = text(record(table)['ref']);
    const rows = record(table)['rows'];
    if (ref === null || !Array.isArray(rows)) continue;
    out[ref] = rows.map((row) =>
      Object.fromEntries(
        Object.entries(record(row)).filter(
          ([column, value]) => !column.startsWith('@') && (value === null || typeof value !== 'object' || Array.isArray(value)),
        ),
      ),
    );
  }
  return out;
}

// ── customer ─────────────────────────────────────────────────────────────────

export interface CustomerConfig {
  /** The address of the public API: this page's own origin when Adminium serves the side. */
  baseUrl: string;
  /** The browser key. It is public by design: it opens only what the manifest's `publicAccess` grants. */
  publishableKey: string;
  /** The app's tables: short name → the name its public endpoints go by. */
  tables: Record<string, string>;
  appName: string | null;
  settings: Record<string, unknown>;
}

/**
 * The customer side's config: the key and the address to make a public
 * client with. Pass `{ baseUrl, publishableKey }` to use a key of your own
 * instead (a side deployed somewhere other than Adminium).
 */
export async function connectCustomer(options: ConnectOptions & { baseUrl?: string; publishableKey?: string } = {}): Promise<CustomerConfig> {
  if (text(options.baseUrl) !== null && text(options.publishableKey) !== null) {
    return { baseUrl: options.baseUrl as string, publishableKey: options.publishableKey as string, tables: {}, appName: null, settings: {} };
  }
  const doFetch: Fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const { status, doc } = await readConfig(mountBase(options.pathname, APP_KEY, 'customer'), doFetch);
  const key = text(doc?.['publishableKey']);
  if (doc === null || key === null) {
    throw new SideError(
      status === 404
        ? en('This app is not open to customers yet. Allow its public access in the app’s settings.')
        : en('This app is not installed on this Adminium, or its screens are switched off.'),
      null,
      status,
    );
  }
  return {
    // An empty address means "the origin this page came from".
    baseUrl: text(doc['baseUrl']) ?? globalThis.location?.origin ?? '',
    publishableKey: key,
    tables: strings(doc['tables']),
    appName: text(doc['appName']),
    settings: record(doc['settings']),
  };
}

// ── React ────────────────────────────────────────────────────────────────────

export type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    load().then(
      (value) => {
        if (live) setLoaded({ state: 'ready', value });
      },
      (error: unknown) => {
        if (live) setLoaded({ state: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      live = false;
    };
    // Connected once per mount: the config is the page's, not a render's.
  }, []);
  return loaded;
}

/**
 * The staff session for this page. With `demo` rows, a page opened from a
 * file, or with `?demo` in its address, shows those instead and saves nothing.
 */
export function useStaff(options: { demo?: Record<string, readonly Row[]> } = {}): Loaded<StaffSession> {
  return useLoaded(() => (options.demo !== undefined && wantsDemo() ? Promise.resolve(demoStaff(options.demo)) : connectStaff()));
}

/** The customer side's config for this page. */
export function useCustomer(options: { baseUrl?: string; publishableKey?: string } = {}): Loaded<CustomerConfig> {
  return useLoaded(() => connectCustomer(options));
}
