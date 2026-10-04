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
declare const __ADMINIUM_APP_NAME__: string | undefined;
declare const __ADMINIUM_SIDE__: string | undefined;
declare const __ADMINIUM_DEV__: boolean | undefined;

export type Side = 'staff' | 'customer';
export type Row = Record<string, unknown>;

/** The app's key, as the build knew it. */
export const APP_KEY: string = typeof __ADMINIUM_APP_KEY__ === 'string' ? __ADMINIUM_APP_KEY__ : '';
/**
 * The app's name, as its manifest had it when this bundle was built; empty when the build did not say.
 * A screen shows `config.appName ?? APP_NAME`: the operator's own name for the app when they set one, else the app's.
 */
export const APP_NAME: string = typeof __ADMINIUM_APP_NAME__ === 'string' ? __ADMINIUM_APP_NAME__ : '';
/** Which side this bundle is. */
export const SIDE: Side = typeof __ADMINIUM_SIDE__ === 'string' && __ADMINIUM_SIDE__ === 'customer' ? 'customer' : 'staff';

/** True in a bundle `adminium dev` built; false in one `adminium build` or `adminium app pack` made. */
export const DEV: boolean = typeof __ADMINIUM_DEV__ === 'boolean' ? __ADMINIUM_DEV__ : false;

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

// ── running from the project folder ──────────────────────────────────────────

/**
 * A screen that stops with an error, said to the page that frames it.
 *
 * A screen can build and still fail the moment it opens (a hook called after
 * an early return, a row read as the wrong type): the frame goes blank and
 * nobody is told. Or it goes on, with a part of it empty because a load
 * threw, and nobody is told that either. In a bundle `adminium dev` built, and only inside a frame,
 * the error's first line is posted to the framing page, which is the
 * Designer's preview: it shows it, and can ask for it to be fixed. A packed
 * app never posts (`DEV` is false).
 */
export function reportErrorsToFrame(target: { addEventListener: Window['addEventListener']; parent: { postMessage(message: unknown, origin: string): void } } | undefined = framed(),
  dev: boolean = DEV,
  /** Whether the page shows nothing. A screen an error left blank has stopped; one that still shows something went on, and is said as that. */
  blank: () => boolean = () => (typeof document === 'undefined' ? true : (document.body?.innerText ?? '').trim() === ''),
  later: (run: () => void) => void = (run) => void setTimeout(run, 150),
): void {
  if (!dev || target === undefined) return;
  const say = (message: unknown): void =>
    later(() => {
      if (blank()) post(message, false);
      // The screen still shows something. A thing its own code threw (a TypeError in a load nobody awaited) left a part of
      // it empty with no word to the person: said, as an error the screen went on from. The browser's own notices
      // (a ResizeObserver loop, a string with no error behind it) are not the screen's fault and are not said.
      else if (message instanceof Error && !/ResizeObserver/i.test(message.message)) post(message, true);
    });
  const post = (message: unknown, went: boolean): void => {
    const text = (message instanceof Error ? message.message : typeof message === 'string' ? message : 'The screen stopped with an error.').split('\n')[0] ?? '';
    // The message alone, to whoever frames this page: no row, no key, nothing of the session.
    target.parent.postMessage({ type: 'adminium:side-error', app: APP_KEY, side: SIDE, message: text.slice(0, 400), ...(went ? { went: true } : {}) }, '*');
  };
  target.addEventListener('error', (event) => say((event as ErrorEvent).error ?? (event as ErrorEvent).message));
  target.addEventListener('unhandledrejection', (event) => say((event as PromiseRejectionEvent).reason));
}

/** This window, when it is a page inside another's frame. */
function framed(): Window | undefined {
  return typeof window !== 'undefined' && window.parent !== window ? window : undefined;
}

reportErrorsToFrame();

/**
 * A call the screen made that Adminium refused as wrongly asked, said to the
 * page that frames it.
 *
 * A page that sorts a public list from the browser, or filters it, builds and
 * opens; every visitor is then told "That did not work" and nobody who could
 * fix it hears of it. In a bundle `adminium dev` built, and only inside a
 * frame, a reply that refuses the REQUEST ITSELF (`PUBLIC_QUERY_REFUSED`, or a
 * staff read's 400) is posted to the framing page, which is the Designer's
 * preview: the refusal's own sentence and the address asked, nothing of the
 * rows, the key or the session. A packed app never looks (`DEV` is false).
 */
export function reportRefusalsToFrame(
  target: { fetch: typeof fetch; parent: { postMessage(message: unknown, origin: string): void } } | undefined = framed() as never,
  dev: boolean = DEV,
): void {
  if (!dev || target === undefined || typeof target.fetch !== 'function') return;
  const original = target.fetch.bind(target);
  const said = new Set<string>();
  target.fetch = (async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await original(...args);
    try {
      if (response.status === 400) {
        const first = args[0];
        const url = typeof first === 'string' ? first : first instanceof URL ? first.href : first.url;
        const path = (/\/api\/v1\/(public\/records|data)\/[^?#]*/.exec(url)?.[0] ?? '').slice(0, 200);
        if (path !== '') {
          const body = (await response.clone().json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
          const code = typeof body?.error?.code === 'string' ? body.error.code : '';
          const message = typeof body?.error?.message === 'string' ? body.error.message : '';
          // The request was wrong, not the person's input: a refused query on the public API, a refused read by staff.
          const wrongly = code === 'PUBLIC_QUERY_REFUSED' || (path.startsWith('/api/v1/data/') && (args[1]?.method ?? 'GET').toUpperCase() === 'GET');
          if (wrongly && !said.has(`${code} ${path}`)) {
            said.add(`${code} ${path}`);
            target.parent.postMessage({ type: 'adminium:side-error', refused: true, app: APP_KEY, side: SIDE, message: `${code === '' ? 'Refused' : code} on ${path}: ${message}`.slice(0, 600) }, '*');
          }
        }
      }
    } catch {
      // Reporting never breaks the page's own call.
    }
    return response;
  }) as typeof fetch;
}

reportRefusalsToFrame();

/**
 * Under `adminium dev`: call `listener` when the app was applied again or its
 * screens were rebuilt. With no listener the page reloads, which is what a
 * screen wants while its code is being written.
 *
 * It asks the server for a small stamp once a second and compares it with the
 * first one it saw. That works for a customer screen too, where nobody is
 * signed in and the dashboard's live channel is closed. A bundle that was not
 * built by `adminium dev` never asks (`DEV` is false), so a packed app makes
 * no such request. Returns a function that stops it.
 *
 * The module starts one for you in a dev bundle, so a screen reloads without
 * a line of its own; call this only to do something other than reload.
 */
export function onAppChanged(
  listener: () => void = () => {
    globalThis.location?.reload();
  },
  options: { fetch?: Fetch; intervalMs?: number; base?: string; dev?: boolean } = {},
): () => void {
  if (!(options.dev ?? DEV)) return () => undefined;
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.base ?? mountBase();
  let seen: string | null = null;
  let stopped = false;
  /**
   * Answers that carried no stamp, before any did. A bundle `adminium dev`
   * built may be left on disk and served by a plain server, which has no
   * stamp to give: after a few such answers this stops asking. Once a stamp
   * was seen the server is a dev one, and it is asked for good.
   */
  let unanswered = 0;
  const timer: { id?: ReturnType<typeof setInterval> } = {};
  const stop = (): void => {
    stopped = true;
    if (timer.id !== undefined) clearInterval(timer.id);
  };
  const noStamp = (): void => {
    if (seen === null && ++unanswered >= NO_STAMP_LOOKS) stop();
  };
  const look = async (): Promise<void> => {
    if (stopped) return;
    let response: Awaited<ReturnType<Fetch>>;
    try {
      response = await doFetch(`${base}dev-build.json`, { cache: 'no-store', credentials: 'same-origin' });
    } catch {
      // The server is restarting: ask again later.
      return;
    }
    let build: unknown;
    try {
      build = response.ok ? ((await response.json()) as { build?: unknown } | null)?.build : undefined;
    } catch {
      build = undefined; // a page, not a stamp
    }
    if (stopped) return;
    if (typeof build !== 'string') {
      noStamp();
      return;
    }
    if (seen === null) seen = build;
    else if (build !== seen) {
      seen = build;
      listener();
    }
  };
  timer.id = setInterval(() => void look(), options.intervalMs ?? 1000);
  void look();
  return stop;
}

/** How many answers without a stamp, before any stamp, say this server gives none. */
const NO_STAMP_LOOKS = 5;

/** The one a dev bundle starts for itself; stopped by {@link stopReloading}. */
let reloading: (() => void) | null = DEV && typeof (globalThis as { document?: unknown }).document !== 'undefined' ? onAppChanged() : null;

/** Stop the reload a dev bundle does on its own, for a screen that handles `onAppChanged` itself. */
export function stopReloading(): void {
  reloading?.();
  reloading = null;
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

/** An ISO-8601 duration (`PT19M`, `P2D`, `P1W`) in milliseconds, or null. */
function durationMs(value: unknown): number | null {
  const match = typeof value === 'string' ? /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value) : null;
  if (match === null) return null;
  const [, weeks, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return (((((weeks ?? 0) * 7 + (days ?? 0)) * 24 + (hours ?? 0)) * 60 + (minutes ?? 0)) * 60 + (seconds ?? 0)) * 1000;
}

/**
 * The rows of a sample data file (`seeds/sample.json`), by table, for
 * {@link demoStaff}.
 *
 * A sample file writes some values as directives, which an install works out.
 * The common ones are worked out here too, near enough for looking at a
 * screen: `@ref` becomes the id of the row with that `@label`, `@ago` and
 * `@in` a time that far from now, `@day` (with `@time`) a date that many days
 * from today, and `@t` its English text. Any other directive is left out.
 */
export function sampleRows(bundle: unknown, now: Date = new Date()): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  const ids = new Map<string, number>();
  const tables = (Array.isArray(record(bundle)['tables']) ? (record(bundle)['tables'] as unknown[]) : []).map(record);
  // Ids first: a row may point at one in a table written later in the file.
  for (const table of tables) {
    (Array.isArray(table['rows']) ? table['rows'] : []).forEach((row, index) => {
      const label = text(record(row)['@label']);
      if (label !== null) ids.set(label, index + 1);
    });
  }
  const day = (offset: number): string => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    return date.toISOString().slice(0, 10);
  };
  const resolve = (value: unknown): { keep: boolean; value?: unknown } => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { keep: true, value };
    const directive = record(value);
    if (typeof directive['@ref'] === 'string') return ids.has(directive['@ref']) ? { keep: true, value: ids.get(directive['@ref']) } : { keep: false };
    const ago = durationMs(directive['@ago']);
    if (ago !== null) return { keep: true, value: new Date(now.getTime() - ago).toISOString() };
    const ahead = durationMs(directive['@in']);
    if (ahead !== null) return { keep: true, value: new Date(now.getTime() + ahead).toISOString() };
    if (typeof directive['@day'] === 'number') {
      const date = day(directive['@day']);
      return { keep: true, value: typeof directive['@time'] === 'string' ? `${date}T${directive['@time']}:00.000Z` : date };
    }
    const translated = record(directive['@t']);
    if (typeof translated['en-US'] === 'string') return { keep: true, value: translated['en-US'] };
    return { keep: false };
  };
  for (const table of tables) {
    const ref = text(table['ref']);
    if (ref === null || !Array.isArray(table['rows'])) continue;
    out[ref] = table['rows'].map((row) => {
      const made: Row = {};
      for (const [column, value] of Object.entries(record(row))) {
        if (column.startsWith('@')) continue;
        const resolved = resolve(value);
        if (resolved.keep) made[column] = resolved.value;
      }
      return made;
    });
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
