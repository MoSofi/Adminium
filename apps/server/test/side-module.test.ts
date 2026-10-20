// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The module an app's screens share: where a side is mounted, the config
 * Adminium serves beside it, and a staff side's reads and writes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DEV,
  connectCustomer,
  connectStaff,
  demoStaff,
  mountBase,
  onAppChanged,
  pageFaults,
  pageHref,
  pagePath,
  pathParams,
  pickForFrame,
  pickedOf,
  reportErrorsToFrame,
  reportRefusalsToFrame,
  reportSightToFrame,
  sampleRows,
  wantsDemo,
  shootForFrame,
  ruleText,
  areaWithin,
  SideError,
} from '../src/side/index.js';

/**
 * React's two hooks the module uses, stood in for where a test asks: there is
 * no DOM here to render into. `useState` keeps one value and `useEffect` runs
 * at once; outside such a test React's own are used.
 */
const hooks = vi.hoisted(() => ({ on: false, state: undefined as unknown, set: false, cleanups: [] as (() => void)[] }));
vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return {
    ...real,
    useState: (first: unknown) => {
      if (!hooks.on) return real.useState(first);
      if (!hooks.set) {
        hooks.state = typeof first === 'function' ? (first as () => unknown)() : first;
        hooks.set = true;
      }
      return [hooks.state, (next: unknown) => void (hooks.state = next)];
    },
    useEffect: (run: () => void | (() => void), deps?: unknown[]) => {
      if (!hooks.on) return real.useEffect(run, deps);
      const cleanup = run();
      if (typeof cleanup === 'function') hooks.cleanups.push(cleanup);
    },
  };
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A `fetch` that answers from a table of `METHOD url-prefix` → reply, and records what was asked. */
function scripted(routes: Record<string, (call: Call) => { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const match = Object.keys(routes).find((key) => `${call.method} ${call.url}`.startsWith(key));
    const reply = match === undefined ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'nothing here' } } } : routes[match]!(call);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const STAFF_CONFIG = {
  connectionId: 'con_1',
  tables: { items: 'repairs_items' },
  user: { id: 'usr_1', name: 'Ava', email: 'ava@adminium.io' },
  csrfToken: 'tok-1',
  timezone: 'Europe/Copenhagen',
  currency: 'DKK',
  access: { tables: { items: ['read', 'create'] } },
  settings: { shop: 'North' },
};
const AT = '/apps/repairs/staff/';

describe('where a side is mounted', () => {
  it.each([
    ['/apps/repairs/staff/', 'staff', '/apps/repairs/staff/'],
    ['/apps/repairs/staff/done/42', 'staff', '/apps/repairs/staff/'],
    ['/apps/repairs/north/staff/done', 'staff', '/apps/repairs/north/staff/'],
    ['/apps/repairs/customer/', 'customer', '/apps/repairs/customer/'],
    // A domain mapped to the app serves it at the root.
    ['/', 'customer', '/'],
    ['/track/42', 'customer', '/'],
    // Another app's address is not this app's mount.
    ['/apps/other/staff/', 'staff', '/'],
  ] as const)('%s (%s) → %s', (pathname, side, base) => {
    expect(mountBase(pathname, 'repairs', side)).toBe(base);
  });

  it('shows sample rows only from a file, or when the address asks', () => {
    expect(wantsDemo({ protocol: 'file:', search: '' })).toBe(true);
    expect(wantsDemo({ protocol: 'https:', search: '?demo' })).toBe(true);
    expect(wantsDemo({ protocol: 'https:', search: '' })).toBe(false);
  });
});

describe('a staff side', () => {
  const connect = (routes: Parameters<typeof scripted>[0]) => {
    const net = scripted({ 'GET /surface-config.json': () => ({ body: STAFF_CONFIG }), ...routes });
    return { net, session: connectStaff({ fetch: net.fetch, pathname: '/' }) };
  };

  it('reads its config, uncached and with the cookie, and says who is signed in', async () => {
    const { net, session } = connect({});
    const staff = await session;
    expect(staff).toMatchObject({
      mode: 'hosted',
      connectionId: 'con_1',
      tables: { items: 'repairs_items' },
      user: { id: 'usr_1', name: 'Ava' },
      timezone: 'Europe/Copenhagen',
      timezoneIsFallback: false,
      currency: 'DKK',
      settings: { shop: 'North' },
    });
    expect(net.calls[0]?.url).toBe('/surface-config.json');
    expect(staff.can('items', 'create')).toBe(true);
    expect(staff.can('items', 'delete')).toBe(false);
    expect(staff.can('nothing', 'read')).toBe(false);
  });

  it('lists a table by its real name, capped at 200 a page', async () => {
    const { net, session } = connect({
      'GET /api/v1/data/con_1/repairs_items': () => ({ body: { data: [{ id: 1, title: 'A' }], page: { limit: 200, offset: 0, total: 7 } } }),
    });
    const listed = await (await session).list('items', { limit: 5000, order: 'id.desc', q: 'door', where: { column: 'status', op: 'eq', value: 'open' } });
    expect(listed).toEqual({ rows: [{ id: 1, title: 'A' }], total: 7 });
    const query = new URL(net.calls[1]!.url, 'http://x').searchParams;
    expect(Object.fromEntries(query)).toEqual({ limit: '200', count: 'exact', order: 'id.desc', q: 'door', where: '{"column":"status","op":"eq","value":"open"}' });
    expect(net.calls[1]?.headers).not.toHaveProperty('x-adminium-csrf');
  });

  it('writes with the signed-in person’s token, and never sends it on a read', async () => {
    const { net, session } = connect({
      'POST /api/v1/data/con_1/repairs_items': (call) => ({ status: 201, body: { data: { id: 9, ...(call.body as { values: object }).values }, undoToken: null } }),
      'PATCH /api/v1/data/con_1/repairs_items/9': () => ({ body: { data: { id: 9, status: 'done' }, undoToken: null } }),
      'DELETE /api/v1/data/con_1/repairs_items/9': () => ({ body: { data: null, undoToken: null } }),
    });
    const staff = await session;
    expect(await staff.create('items', { title: 'Fix the door' })).toEqual({ id: 9, title: 'Fix the door' });
    expect(await staff.update('items', 9, { status: 'done' })).toEqual({ id: 9, status: 'done' });
    await staff.remove('items', 9);
    const writes = net.calls.slice(1);
    expect(writes.map((call) => call.method)).toEqual(['POST', 'PATCH', 'DELETE']);
    for (const call of writes) expect(call.headers['x-adminium-csrf']).toBe('tok-1');
    expect(writes[0]?.body).toEqual({ values: { title: 'Fix the door' } });
  });

  it('reads the token again, once, when the server says it is stale', async () => {
    let served = 0;
    const net = scripted({
      'GET /surface-config.json': () => ({ body: { ...STAFF_CONFIG, csrfToken: `tok-${String((served += 1))}` } }),
      'POST /api/v1/data': (call) =>
        call.headers['x-adminium-csrf'] === 'tok-2'
          ? { status: 201, body: { data: { id: 1 }, undoToken: null } }
          : { status: 403, body: { error: { code: 'CSRF_FAILED', message: 'stale' } } },
    });
    const staff = await connectStaff({ fetch: net.fetch, pathname: '/' });
    expect(await staff.create('items', { title: 'x' })).toEqual({ id: 1 });
    expect(net.calls.map((call) => `${call.method} ${call.url.split('?')[0]}`)).toEqual([
      'GET /surface-config.json',
      'POST /api/v1/data/con_1/repairs_items',
      'GET /surface-config.json',
      'POST /api/v1/data/con_1/repairs_items',
    ]);
  });

  it('gives the server’s own words and code when a write is refused', async () => {
    const { session } = connect({
      'POST /api/v1/data': () => ({ status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'title is too long', details: { column: 'title' } } } }),
    });
    const refused = await (await session).create('items', {}).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SideError);
    expect(refused).toMatchObject({ message: 'title is too long', code: 'VALIDATION_FAILED', status: 422, details: { column: 'title' } });
  });

  it('asks which of the app’s rules are switched on, each time, and reads only a key, a name and a switch', async () => {
    let on = false;
    const { net, session } = connect({
      'GET /api/v1/apps/': () => ({ body: { rules: [{ key: 'nudge-stale', name: 'A deal sits too long', on, steps: ['never read'] }, 'not a rule'] } }),
    });
    const staff = await session;
    expect(await staff.rules()).toEqual([{ key: 'nudge-stale', name: 'A deal sits too long', on: false }, { key: '', name: '', on: false }]);
    on = true;
    expect((await staff.rules())[0]).toEqual({ key: 'nudge-stale', name: 'A deal sits too long', on: true });
    const asked = net.calls.slice(1);
    expect(asked.map((call) => call.method)).toEqual(['GET', 'GET']);
    for (const call of asked) {
      expect(call.url).toMatch(/^\/api\/v1\/apps\/[a-z0-9-]*\/rules$/);
      expect(call.headers).not.toHaveProperty('x-adminium-csrf');
    }
    // Refused (no staff grant on the app): the server's own words and code.
    const refused = connect({ 'GET /api/v1/apps/': () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'This account cannot open this app’s staff screens.' } } }) });
    await expect((await refused.session).rules()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('falls back to UTC, flagged, when the database has no zone — never the browser’s', async () => {
    const net = scripted({ 'GET /surface-config.json': () => ({ body: { ...STAFF_CONFIG, timezone: null } }) });
    expect(await connectStaff({ fetch: net.fetch, pathname: '/' })).toMatchObject({ timezone: 'UTC', timezoneIsFallback: true });
  });

  it('shows every button when the server does not say what the person may do', async () => {
    const net = scripted({ 'GET /surface-config.json': () => ({ body: { ...STAFF_CONFIG, access: undefined } }) });
    expect((await connectStaff({ fetch: net.fetch, pathname: '/' })).can('items', 'delete')).toBe(true);
  });

  it('says to sign in, or that the app is not there', async () => {
    const signedOut = scripted({ 'GET /surface-config.json': () => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }) });
    await expect(connectStaff({ fetch: signedOut.fetch, pathname: '/' })).rejects.toThrow(/Sign in to Adminium/);
    await expect(connectStaff({ fetch: scripted({}).fetch, pathname: '/' })).rejects.toThrow(/not installed on this Adminium/);
  });

  it('asks the mount it is on', async () => {
    const net = scripted({ [`GET ${AT}surface-config.json`]: () => ({ body: STAFF_CONFIG }) });
    // The key is baked in by the build; here there is none, so the root is asked.
    await connectStaff({ fetch: net.fetch, pathname: AT }).catch(() => undefined);
    expect(net.calls[0]?.url).toBe('/surface-config.json');
  });
});

describe('a customer side', () => {
  it('gets the key and the address, an empty address meaning this origin', async () => {
    const net = scripted({ 'GET /surface-config.json': () => ({ body: { baseUrl: '', publishableKey: 'adm_pub_test', tables: { items: 'repairs_items' }, appName: 'Fix-It' } }) });
    const config = await connectCustomer({ fetch: net.fetch, pathname: '/' });
    expect(config).toMatchObject({ publishableKey: 'adm_pub_test', tables: { items: 'repairs_items' }, appName: 'Fix-It' });
    expect(config.baseUrl).toBe(globalThis.location?.origin ?? '');
  });

  it('says the app is not open to customers when no key is served', async () => {
    await expect(connectCustomer({ fetch: scripted({}).fetch, pathname: '/' })).rejects.toThrow(/not open to customers yet/);
  });

  it('takes a key of its own without asking Adminium', async () => {
    const net = scripted({});
    expect(await connectCustomer({ fetch: net.fetch, baseUrl: 'https://admin.example.com', publishableKey: 'adm_pub_x' })).toMatchObject({
      baseUrl: 'https://admin.example.com',
      publishableKey: 'adm_pub_x',
    });
    expect(net.calls).toEqual([]);
  });
});

describe('sample rows held in memory', () => {
  it('lists, adds, changes and removes, saving nothing', async () => {
    const staff = demoStaff(sampleRows({ tables: [{ ref: 'items', rows: [{ title: 'A', status: 'open' }, { title: 'B', '@label': 'b', odd: { '@slot': 'x' } }] }] }));
    expect(staff.mode).toBe('demo');
    expect(await staff.list('items')).toEqual({ rows: [{ id: 1, title: 'A', status: 'open' }, { id: 2, title: 'B' }], total: 2 });
    const made = await staff.create('items', { title: 'C' });
    expect(made).toEqual({ id: 3, title: 'C' });
    expect(await staff.update('items', 3, { status: 'done' })).toEqual({ id: 3, title: 'C', status: 'done' });
    await staff.remove('items', 1);
    expect((await staff.list('items')).rows.map((row) => row['id'])).toEqual([2, 3]);
    await expect(staff.get('items', 99)).rejects.toThrow(/not there/);
  });

  it('works out the common directives of a sample file, near enough to look at a screen', () => {
    const now = new Date('2026-03-10T12:00:00.000Z');
    const rows = sampleRows(
      {
        tables: [
          { ref: 'cakes', rows: [{ '@label': 'lemon', name: 'Lemon' }, { '@label': 'plum', name: { '@t': { 'en-US': 'Plum', 'de-DE': 'Pflaume' } } }] },
          {
            ref: 'orders',
            rows: [{ cake_id: { '@ref': 'plum' }, pickup_date: { '@day': 2 }, made: { '@ago': 'PT90M' }, due: { '@in': 'P1D' }, at: { '@day': -1, '@time': '09:30' }, gone: { '@ref': 'nobody' } }],
          },
        ],
      },
      now,
    );
    expect(rows['cakes']).toEqual([{ name: 'Lemon' }, { name: 'Plum' }]);
    expect(rows['orders']).toEqual([
      { cake_id: 2, pickup_date: '2026-03-12', made: '2026-03-10T10:30:00.000Z', due: '2026-03-11T12:00:00.000Z', at: '2026-03-09T09:30:00.000Z' },
    ]);
  });
});

describe('reloading when the app was applied or rebuilt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A server whose stamp is whatever `stamp.value` says; null answers like a server that is not `adminium dev`. */
  const server = (stamp: { value: string | null; down?: boolean }) => {
    const asked: string[] = [];
    const fetch = (async (input: unknown) => {
      asked.push(String(input));
      if (stamp.down === true) throw new Error('connection refused');
      if (stamp.value === null) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(JSON.stringify({ build: stamp.value }), { status: 200 });
    }) as typeof globalThis.fetch;
    return { asked, fetch };
  };

  it('is off in a bundle that `adminium dev` did not build: it asks nothing', async () => {
    expect(DEV).toBe(false);
    const stamp = { value: 'a' };
    const { asked, fetch } = server(stamp);
    const listener = vi.fn();
    const stop = onAppChanged(listener, { fetch, intervalMs: 5, base: '/apps/repairs/staff/' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    expect(asked).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('calls the listener when the stamp moves, once per move, and never for the first stamp', async () => {
    vi.useFakeTimers();
    const stamp = { value: 'a:1' as string | null };
    const { asked, fetch } = server(stamp);
    const listener = vi.fn();
    const stop = onAppChanged(listener, { fetch, intervalMs: 1000, base: '/apps/repairs/customer/', dev: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['/apps/repairs/customer/dev-build.json']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(listener).not.toHaveBeenCalled();

    stamp.value = 'a:2';
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(listener).toHaveBeenCalledTimes(1);

    stamp.value = 'b:2';
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    stamp.value = 'c:3';
    const before = asked.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked).toHaveLength(before);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops asking a server that never gives a stamp: a dev bundle served by a plain server', async () => {
    vi.useFakeTimers();
    const stamp = { value: null as string | null };
    const { asked, fetch } = server(stamp);
    const stop = onAppChanged(vi.fn(), { fetch, intervalMs: 1000, base: '/apps/repairs/staff/', dev: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toHaveLength(5);
    stop();
  });

  it('waits through a server that is down or answers a page, and still sees the next build', async () => {
    vi.useFakeTimers();
    const stamp: { value: string | null; down?: boolean } = { value: 'a:1' };
    const { fetch } = server(stamp);
    const listener = vi.fn();
    const stop = onAppChanged(listener, { fetch, intervalMs: 1000, base: '/', dev: true });
    await vi.advanceTimersByTimeAsync(0);

    // The server restarts (a config change), then answers its page for a moment.
    stamp.down = true;
    await vi.advanceTimersByTimeAsync(2000);
    stamp.down = false;
    stamp.value = null;
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).not.toHaveBeenCalled();

    stamp.value = 'a:2';
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('a screen that stops with an error', () => {
  const frame = () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const posted: { message: unknown; origin: string }[] = [];
    const target = {
      addEventListener: ((type: string, listener: (event: unknown) => void) => listeners.set(type, listener)) as never,
      parent: { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) },
    };
    return { target, listeners, posted };
  };

  it('tells the page that frames it the error’s first line, in a dev bundle only', () => {
    const dev = frame();
    reportErrorsToFrame(dev.target, true, () => true, (run) => run());
    dev.listeners.get('error')?.({ error: new Error('Rendered more hooks than during the previous render.\n    at App') });
    dev.listeners.get('unhandledrejection')?.({ reason: 'x'.repeat(900) });
    expect(dev.posted[0]).toEqual({ message: { type: 'adminium:side-error', app: '', side: 'staff', message: 'Rendered more hooks than during the previous render.' }, origin: '*' });
    expect((dev.posted[1]?.message as { message: string }).message).toHaveLength(400);

    // A screen that still shows something goes on working. The browser's own notices are not said…
    const working = frame();
    reportErrorsToFrame(working.target, true, () => false, (run) => run());
    working.listeners.get('error')?.({ error: new Error('ResizeObserver loop completed with undelivered notifications.') });
    working.listeners.get('error')?.({ message: 'Script error.' });
    working.listeners.get('unhandledrejection')?.({ reason: 'a string nobody threw as an error' });
    expect(working.posted).toEqual([]);
    // …and a thing the screen's own code threw is, as an error it went on from: a load that failed leaves a list empty with no word.
    working.listeners.get('unhandledrejection')?.({ reason: new TypeError("Cannot read properties of undefined (reading 'cakes')") });
    expect(working.posted).toEqual([{ message: { type: 'adminium:side-error', app: '', side: 'staff', message: "Cannot read properties of undefined (reading 'cakes')", went: true }, origin: '*' }]);

    // A packed app, or a page nobody frames, says nothing.
    const packed = frame();
    reportErrorsToFrame(packed.target, false);
    expect(packed.listeners.size).toBe(0);
    expect(() => reportErrorsToFrame(undefined, true)).not.toThrow();
  });

  it('tells the framing page of a call Adminium refused as wrongly asked, once, and of nothing else', async () => {
    const posted: unknown[] = [];
    const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const answers: Record<string, Response> = {
      '/api/v1/public/records/cakes?order=name.asc': reply(400, { error: { code: 'PUBLIC_QUERY_REFUSED', message: 'That sort is not permitted here.' } }),
      '/api/v1/public/records/cakes': reply(200, { data: [{ id: 1, name: 'A secret row' }] }),
      '/api/v1/public/records/orders': reply(400, { error: { code: 'PUBLIC_WRITE_REFUSED', message: 'A value is missing.' } }),
      '/api/v1/data/main/orders?where=x': reply(400, { error: { code: 'VALIDATION_FAILED', message: '`where` does not match the filter grammar.' } }),
      'https://elsewhere.test/x': reply(400, { error: { code: 'PUBLIC_QUERY_REFUSED', message: 'x' } }),
    };
    const target = {
      fetch: (async (url: string) => (answers[url] as Response).clone()) as unknown as typeof fetch,
      parent: { postMessage: (message: unknown) => void posted.push(message) },
    };
    reportRefusalsToFrame(target, true);
    // The page's own call is answered as it was, body and all.
    const refused = await target.fetch('/api/v1/public/records/cakes?order=name.asc');
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('PUBLIC_QUERY_REFUSED');
    await target.fetch('/api/v1/public/records/cakes?order=name.asc');
    await target.fetch('/api/v1/public/records/cakes');
    // A person's own mistake in a form is theirs to see, not a fault of the screen.
    await target.fetch('/api/v1/public/records/orders', { method: 'POST' });
    await target.fetch('/api/v1/data/main/orders?where=x');
    await target.fetch('https://elsewhere.test/x');
    expect(posted).toEqual([
      { type: 'adminium:side-error', refused: true, app: '', side: 'staff', message: 'PUBLIC_QUERY_REFUSED on /api/v1/public/records/cakes: That sort is not permitted here.' },
      { type: 'adminium:side-error', refused: true, app: '', side: 'staff', message: 'VALIDATION_FAILED on /api/v1/data/main/orders: `where` does not match the filter grammar.' },
    ]);
    expect(JSON.stringify(posted)).not.toContain('A secret row');

    // A packed app never looks.
    const packed = { fetch: (async () => reply(400, {})) as unknown as typeof fetch, parent: { postMessage: () => void posted.push('x') } };
    const before = packed.fetch;
    reportRefusalsToFrame(packed, false);
    expect(packed.fetch).toBe(before);
  });
});

describe('what is measurably broken on a page as it shows', () => {
  /** A page of boxes: each element is its tag, its classes and where it is drawn. */
  const el = (tag: string, box: [number, number, number, number], extra: Record<string, unknown> = {}) => ({
    tagName: tag.toUpperCase(),
    className: '',
    children: [],
    contains: () => false,
    getBoundingClientRect: () => ({ left: box[0], top: box[1], right: box[0] + box[2], bottom: box[1] + box[3], width: box[2], height: box[3] }),
    getAttribute: (name: string) => (extra[name] as string | undefined) ?? null,
    ...extra,
  });
  const page = (parts: { all?: unknown[]; controls?: unknown[]; images?: unknown[]; h1?: unknown; text?: string; scrollWidth?: number }) =>
    ({
      documentElement: { clientWidth: 1280, scrollWidth: parts.scrollWidth ?? 1280 },
      images: parts.images ?? [],
      body: {
        innerText: parts.text ?? 'Crispy Bites',
        querySelectorAll: (selector: string) => (selector === '*' ? (parts.all ?? []) : selector.startsWith('input') ? (parts.controls ?? []) : []),
        querySelector: () => parts.h1 ?? null,
      },
    }) as unknown as Document;
  const view = { innerWidth: 1280, getComputedStyle: () => ({ textAlign: 'start' }) as CSSStyleDeclaration };

  it('says nothing of a page that is whole', () => {
    const fine = page({ controls: [el('input', [100, 100, 200, 40]), el('input', [320, 100, 200, 40])], images: [{ complete: true, naturalWidth: 400, getAttribute: () => '/a.jpg' }], h1: el('h1', [120, 80, 600, 60]) });
    expect(pageFaults(fine, view, '')).toEqual([]);
  });

  it('names a blank page, controls that lie over each other, pictures that did not load or have no address, a part past the window and a heading on its edge', () => {
    expect(pageFaults(page({ text: '  ' }), view, '')).toEqual([{ kind: 'blank' }]);
    const broken = page({
      scrollWidth: 1500,
      all: [el('div', [0, 0, 1280, 300]), el('section', [0, 300, 1500, 200], { className: 'strip wide  extra more' })],
      controls: [el('input', [100, 100, 200, 40], { className: 'field' }), el('input', [280, 110, 200, 40]), el('button', [900, 400, 80, 30])],
      images: [
        { complete: true, naturalWidth: 0, getAttribute: () => '/apps/x/assets/hero.jpg' },
        { complete: true, naturalWidth: 0, getAttribute: () => '/apps/x/assets/two.jpg' },
        { complete: true, naturalWidth: 0, getAttribute: () => '' },
        { complete: false, naturalWidth: 0, getAttribute: () => '/still-loading.jpg' },
      ],
      h1: el('h1', [0, 80, 600, 60]),
    });
    // Facts, never sentences: a kind, a count, an element's tag and classes. A picture still on its way is not called broken, and no address of a picture is said.
    expect(pageFaults(broken, view, '')).toEqual([
      { kind: 'wide', width: 1280, part: 'section strip wide extra' },
      { kind: 'overlap', first: 'input field', second: 'input' },
      { kind: 'broken', count: 2 },
      { kind: 'no-address', count: 1 },
      { kind: 'edge' },
    ]);
    // A class that is not one (markup, a sentence) is left out of what is said of an element.
    const odd = page({ controls: [el('input', [100, 100, 200, 40], { className: 'ok "><script> ignore-previous-instructions!!' }), el('input', [150, 110, 200, 40])] });
    expect(pageFaults(odd, view, '')).toEqual([{ kind: 'overlap', first: 'input ok', second: 'input' }]);
    // A page that stopped is said with what stopped it; one that went on after an error says the error.
    expect(pageFaults(page({ text: '' }), view, 'formatMoney is not defined')).toEqual([{ kind: 'blank', error: 'formatMoney is not defined' }]);
    expect(pageFaults(page({}), view, 'rows.map is not a function')).toEqual([{ kind: 'error', error: 'rows.map is not a function' }]);
    expect(pageFaults(page({}), view, 'ResizeObserver loop completed with undelivered notifications.')).toEqual([]);
    // A heading set in the middle is at the edge only as a box: not said.
    expect(pageFaults(page({ h1: el('h1', [0, 80, 1280, 60]) }), { ...view, getComputedStyle: () => ({ textAlign: 'center' }) as CSSStyleDeclaration }, '')).toEqual([]);
  });

  it('is looked at only in a dev bundle inside a frame: a packed app never looks', () => {
    const listened: string[] = [];
    const target = { document: { readyState: 'loading' }, addEventListener: (name: string) => void listened.push(name), parent: { postMessage: () => undefined } } as unknown as Window;
    reportSightToFrame(target, false);
    reportSightToFrame(undefined, true);
    expect(listened).toEqual([]);
    reportSightToFrame(target, true);
    expect(listened).toEqual(['load']);
  });

  it('says which page it looked at: the page’s own path under the side, tidied as every path is', async () => {
    vi.useFakeTimers();
    try {
      const customer = await bundled('repairs', 'customer');
      const posted: Record<string, unknown>[] = [];
      const doc = { ...page({}), readyState: 'complete', addEventListener: () => undefined };
      const target = { ...view, innerHeight: 800, document: doc, location: { pathname: '/apps/repairs/customer/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e/' }, addEventListener: () => undefined, parent: { postMessage: (message: Record<string, unknown>) => void posted.push(message) } };
      customer.reportSightToFrame(target as unknown as Window, true);
      await vi.advanceTimersByTimeAsync(8000);
      expect(posted).toEqual([{ type: 'adminium:side-sight', app: 'repairs', side: 'customer', path: '/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e', width: 1280, faults: [] }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('looks again when the screen stops after it was looked at, without a picture, and twice at most', async () => {
    vi.useFakeTimers();
    try {
      const customer = await bundled('repairs', 'customer');
      const posted: Record<string, unknown>[] = [];
      const heard = new Map<string, (event: unknown) => void>();
      const doc = { ...page({}), readyState: 'complete', addEventListener: () => undefined };
      const target = {
        ...view,
        innerHeight: 800,
        document: doc,
        location: { pathname: '/apps/repairs/customer/' },
        addEventListener: (name: string, run: (event: unknown) => void) => void heard.set(name, run),
        parent: { postMessage: (message: Record<string, unknown>) => void posted.push(message) },
      };
      customer.reportErrorsToFrame(target as unknown as Window, true, () => false, (run) => run());
      customer.reportSightToFrame(target as unknown as Window, true);
      // It shows that it loads and stands still: looked at, and nothing is wrong yet.
      await vi.advanceTimersByTimeAsync(8000);
      const sights = (): Record<string, unknown>[] => posted.filter((message) => message['type'] === 'adminium:side-sight');
      expect(sights().map((message) => message['faults'])).toEqual([[]]);
      // Then its load throws. The page is looked at again, and what stopped it is in that look.
      for (let n = 0; n < 4; n += 1) heard.get('error')?.({ error: new Error('The menu could not be read') });
      await vi.advanceTimersByTimeAsync(100);
      expect(sights().slice(1).map((message) => message['faults'])).toEqual([[{ kind: 'error', error: 'The menu could not be read' }], [{ kind: 'error', error: 'The menu could not be read' }]]);
      expect(sights().slice(1).every((message) => !('picture' in message))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a page of a side has an address', () => {
  it.each([
    // The app's own address, a second instance of it, and a domain mapped to it.
    ['/apps/repairs/staff/', 'staff', '/'],
    ['/apps/repairs/staff', 'staff', '/'],
    ['/apps/repairs/staff/done', 'staff', '/done'],
    ['/apps/repairs/staff/done/42/', 'staff', '/done/42'],
    ['/apps/repairs/north/staff/done', 'staff', '/done'],
    ['/apps/repairs/customer/menu/spicy-wings', 'customer', '/menu/spicy-wings'],
    ['/', 'customer', '/'],
    ['/track/42', 'customer', '/track/42'],
  ] as const)('%s (%s) is the page %s', (pathname, side, path) => {
    expect(pagePath(pathname, mountBase(pathname, 'repairs', side))).toBe(path);
  });

  it('is the first page for an address that is not under the side', () => {
    expect(pagePath('/apps/repairs/customer/menu', '/apps/repairs/staff/')).toBe('/');
    expect(pagePath('/apps/repairs/staffroom', '/apps/repairs/staff/')).toBe('/');
  });

  it('holds every path to one rule: decoded, then encoded part by part, with nothing that climbs', () => {
    const base = '/apps/repairs/customer/';
    // One slash in front, none behind; a query and a hash are not part of a page's path.
    expect(pageHref('menu/', base)).toBe('/apps/repairs/customer/menu');
    expect(pageHref('/menu?size=2#top', base)).toBe('/apps/repairs/customer/menu');
    expect(pageHref('/', base)).toBe(base);
    expect(pageHref('', base)).toBe(base);
    // Already encoded, or not: the same address, never encoded twice.
    expect(pageHref('/menu/crème brûlée', base)).toBe('/apps/repairs/customer/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e');
    expect(pageHref('/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e', base)).toBe('/apps/repairs/customer/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e');
    expect(pagePath('/apps/repairs/customer/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e', base)).toBe('/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e');
    // A part that would climb out of the side is dropped, however it is written.
    expect(pageHref('/../../staff/./x', base)).toBe('/apps/repairs/customer/staff/x');
    expect(pageHref('/%2e%2e/%2E/x', base)).toBe('/apps/repairs/customer/x');
    // A slash inside a part stays inside it; a stray percent sign is a character.
    expect(pageHref('/a%2Fb/100%', base)).toBe('/apps/repairs/customer/a%2Fb/100%25');
    // At most 160 characters, counted as a person reads them: a longer one is no page's path.
    expect(pageHref(`/${'a'.repeat(159)}`, base)).toBe(`${base}${'a'.repeat(159)}`);
    expect(pageHref(`/${'a'.repeat(160)}`, base)).toBe(base);
    expect(pageHref(`/${'é'.repeat(159)}`, base)).toBe(`${base}${'%C3%A9'.repeat(159)}`);
    expect(pagePath(`${base}${'a'.repeat(400)}`, base)).toBe('/');
  });

  it('reads the parts of a path a pattern names, and says null for another page', () => {
    expect(pathParams('/menu/:slug', '/menu/spicy-wings')).toEqual({ slug: 'spicy-wings' });
    expect(pathParams('/orders/:id/lines/:line', '/orders/42/lines/3')).toEqual({ id: '42', line: '3' });
    expect(pathParams('/', '/')).toEqual({});
    expect(pathParams('/menu', '/menu/')).toEqual({});
    // Values are decoded.
    expect(pathParams('/menu/:slug', '/menu/cr%C3%A8me%20br%C3%BBl%C3%A9e')).toEqual({ slug: 'crème brûlée' });
    // Another page: more parts, fewer, or other words.
    expect(pathParams('/menu/:slug', '/menu')).toBeNull();
    expect(pathParams('/menu/:slug', '/menu/')).toBeNull();
    expect(pathParams('/menu/:slug', '/menu/a/b')).toBeNull();
    expect(pathParams('/menu/:slug', '/drinks/a')).toBeNull();
    expect(pathParams('/', '/menu')).toBeNull();
    // An escape that is none.
    expect(pathParams('/menu/:slug', '/menu/%E0%A4%A')).toBeNull();
  });
});

/**
 * The module as one bundle has it: the side build writes the app's key and
 * the side into each bundle, and the module reads them once, when it loads.
 */
async function bundled(key: string, side: 'staff' | 'customer'): Promise<typeof import('../src/side/index.js')> {
  const defined = globalThis as Record<string, unknown>;
  defined['__ADMINIUM_APP_KEY__'] = key;
  defined['__ADMINIUM_SIDE__'] = side;
  vi.resetModules();
  try {
    return await import('../src/side/index.js');
  } finally {
    delete defined['__ADMINIUM_APP_KEY__'];
    delete defined['__ADMINIUM_SIDE__'];
  }
}

/** A window of a side, as much of one as the module asks for: an address, a history, a parent and listeners. */
function sideWindow(pathname: string, opts: { framed?: boolean; title?: string } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const posted: unknown[] = [];
  const moves: string[] = [];
  const parent = { postMessage: (message: unknown, origin: string) => void posted.push(origin === '*' ? message : { message, origin }) };
  const target = {
    location: { pathname },
    history: {
      pushState: (_data: unknown, _unused: string, url: string) => {
        target.location.pathname = url;
        moves.push(`push ${url}`);
      },
      replaceState: (_data: unknown, _unused: string, url: string) => {
        target.location.pathname = url;
        moves.push(`replace ${url}`);
      },
    },
    document: { title: opts.title ?? '' },
    addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, listener),
    scrollTo: () => undefined,
    parent: parent as unknown,
  };
  if (opts.framed !== true) target.parent = target;
  /** Back or Forward: the browser changes the address, then says so. */
  const browserWent = (to: string): void => {
    target.location.pathname = to;
    listeners.get('popstate')?.({});
  };
  /** A message as a browser hands it over; from the framing page unless another window is given. */
  const told = (data: unknown, source: unknown = parent): void => listeners.get('message')?.({ data, source });
  return { target: target as never, listeners, posted, moves, browserWent, told, parent };
}

describe('going from page to page', () => {
  /** Nothing waits in these tests: what is said later is said now. */
  const now = (run: () => void): void => run();
  let customer: Awaited<ReturnType<typeof bundled>>;
  let staff: Awaited<ReturnType<typeof bundled>>;
  beforeAll(async () => {
    customer = await bundled('repairs', 'customer');
    staff = await bundled('repairs', 'staff');
  });

  it('keeps the address’s query on a move: a staff screen opened with ?demo stays on the sample rows', () => {
    const page = sideWindow('/apps/repairs/staff/');
    (page.target as unknown as { location: { search?: string } }).location.search = '?demo';
    staff.go('/jobs', {}, page.target);
    expect(page.moves).toEqual(['push /apps/repairs/staff/jobs?demo']);
  });

  it('adds to the history as the top window, and is silent when already there', () => {
    const page = sideWindow('/apps/repairs/customer/');
    customer.go('/menu', {}, page.target);
    customer.go('/menu/', {}, page.target);
    customer.go('menu?x=1', {}, page.target);
    customer.go('/menu/7', { replace: true }, page.target);
    expect(page.moves).toEqual(['push /apps/repairs/customer/menu', 'replace /apps/repairs/customer/menu/7']);
    // A path that is none is no move.
    customer.go(`/${'a'.repeat(200)}`, {}, page.target);
    expect(page.moves).toHaveLength(2);
    // Nobody frames it: nothing is said to anyone.
    expect(page.posted).toEqual([]);
    // The page it is on, however the address writes it: no move.
    const slashed = sideWindow('/apps/repairs/customer/menu/');
    customer.go('/menu', {}, slashed.target);
    expect(slashed.moves).toEqual([]);
  });

  it('replaces its address inside a frame: Back is the framing page’s', () => {
    const page = sideWindow('/apps/repairs/customer/', { framed: true });
    customer.go('/menu', {}, page.target);
    customer.go('/menu/7', {}, page.target);
    expect(page.moves).toEqual(['replace /apps/repairs/customer/menu', 'replace /apps/repairs/customer/menu/7']);
  });

  it('gives a screen its path, and gives it again after a move, Back, or a word from the frame', () => {
    hooks.on = true;
    hooks.set = false;
    try {
      const page = sideWindow('/apps/repairs/staff/done', { framed: true });
      staff.watchAddress(page.target, false, now);
      expect(staff.usePath(page.target)).toBe('/done');
      staff.go('/', {}, page.target);
      expect(staff.usePath(page.target)).toBe('/');
      page.browserWent('/apps/repairs/staff/done/42');
      expect(staff.usePath(page.target)).toBe('/done/42');
      page.told({ type: 'adminium:host:set', path: 'done' });
      expect(staff.usePath(page.target)).toBe('/done');
      // A screen that is gone is told nothing more.
      for (const cleanup of hooks.cleanups.splice(0)) cleanup();
      staff.go('/', {}, page.target);
      expect(hooks.state).toBe('/done');
    } finally {
      hooks.on = false;
      for (const cleanup of hooks.cleanups.splice(0)) cleanup();
    }
  });

  it('is a real link that is followed without a reload on a plain click', () => {
    const page = sideWindow('/apps/repairs/customer/');
    // A part React calls has no second argument of ours: it reads the page's own window.
    vi.stubGlobal('window', page.target);
    const link = customer.Link({ to: '/menu/7', className: 'nav', children: 'Seven' }) as unknown as { type: string; props: Record<string, unknown> & { onClick(event: unknown): void } };
    expect(link.type).toBe('a');
    expect(link.props).toMatchObject({ href: '/apps/repairs/customer/menu/7', className: 'nav', children: 'Seven' });
    expect(link.props).not.toHaveProperty('to');
    const click = (over: Record<string, unknown> = {}) => {
      const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, prevented: false, preventDefault: () => void (event.prevented = true), ...over };
      link.props.onClick(event);
      return event.prevented;
    };
    // A new tab, a new window, the middle button: the browser's own.
    expect(click({ metaKey: true })).toBe(false);
    expect(click({ ctrlKey: true })).toBe(false);
    expect(click({ button: 1 })).toBe(false);
    expect(click({ defaultPrevented: true })).toBe(false);
    expect(page.moves).toEqual([]);
    expect(click()).toBe(true);
    expect(page.moves).toEqual(['push /apps/repairs/customer/menu/7']);

    // The screen's own handler runs first, and may keep the click.
    const seen: unknown[] = [];
    const own = customer.Link({ to: '/x', onClick: (event) => { seen.push(1); event.preventDefault(); } }) as unknown as { props: { onClick(event: unknown): void } };
    const kept = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => void (kept.defaultPrevented = true) };
    own.props.onClick(kept);
    expect(seen).toEqual([1]);
    expect(page.moves).toHaveLength(1);
    // A link that opens elsewhere is left to the browser.
    const blank = customer.Link({ to: '/y', target: '_blank' }) as unknown as { props: { onClick(event: unknown): void } };
    blank.props.onClick({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => undefined });
    expect(page.moves).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe('a side says where it is', () => {
  const now = (run: () => void): void => run();
  const location = (path: string, title = '') => ({ type: 'adminium:side-location', app: 'shop', side: 'customer', path, title, picks: true, shots: true });
  let shop: Awaited<ReturnType<typeof bundled>>;
  beforeAll(async () => {
    shop = await bundled('shop', 'customer');
  });

  it('tells the framing page its path and title, on load and on every change: a dev bundle in a frame, and no other', () => {
    const page = sideWindow('/apps/shop/customer/menu', { framed: true, title: 'Menu' });
    shop.watchAddress(page.target, true, now);
    expect(page.posted).toEqual([location('/menu', 'Menu')]);
    (page.target as { document: { title: string } }).document.title = '  Spicy\n wings\u0007 ' + 'x'.repeat(200);
    shop.go('/menu/spicy wings', {}, page.target);
    page.browserWent('/apps/shop/customer/');
    expect(page.posted.slice(1)).toEqual([location('/menu/spicy%20wings', `Spicy wings ${'x'.repeat(148)}`), location('/', `Spicy wings ${'x'.repeat(148)}`)]);

    // What is said waits a moment, so the screen has drawn the new page and named it; two moves in that moment are said once.
    const waiting: (() => void)[] = [];
    const slow = sideWindow('/apps/shop/customer/', { framed: true });
    shop.watchAddress(slow.target, true, (run) => void waiting.push(run));
    shop.go('/a', {}, slow.target);
    shop.go('/b', {}, slow.target);
    expect(slow.posted).toEqual([]);
    for (const run of waiting.splice(0)) run();
    expect(slow.posted).toEqual([location('/b')]);

    // A packed app says nothing; nor does a page nobody frames.
    const packed = sideWindow('/apps/shop/customer/', { framed: true });
    shop.watchAddress(packed.target, false, now);
    shop.go('/menu', {}, packed.target);
    expect(packed.posted).toEqual([]);
    const top = sideWindow('/apps/shop/customer/');
    shop.watchAddress(top.target, true, now);
    shop.go('/menu', {}, top.target);
    expect(top.posted).toEqual([]);
    expect(() => shop.watchAddress(undefined, true, now)).not.toThrow();
  });

  it('follows a typed address from the framing page in a dev bundle, and a packed customer side never listens', () => {
    const dev = sideWindow('/apps/shop/customer/', { framed: true });
    shop.watchAddress(dev.target, true, now);
    dev.told({ type: 'adminium:host:set', path: '/specials' });
    expect(dev.moves).toEqual(['replace /apps/shop/customer/specials']);
    // The dashboard's first word is for a staff side: a customer side does not act on it, and never speaks the dashboard's protocol.
    dev.told({ type: 'adminium:host:init', v: 1, path: 'menu' });
    expect(dev.moves).toHaveLength(1);
    expect(dev.posted).toEqual([location('/'), location('/specials')]);

    const packed = sideWindow('/apps/shop/customer/', { framed: true });
    shop.watchAddress(packed.target, false, now);
    expect([...packed.listeners.keys()]).toEqual(['popstate']);
    expect(packed.posted).toEqual([]);
  });
});

describe('a staff side inside the dashboard', () => {
  const now = (run: () => void): void => run();
  let staff: Awaited<ReturnType<typeof bundled>>;
  beforeAll(async () => {
    staff = await bundled('repairs', 'staff');
  });

  it('says hello once, says its own moves, and follows the dashboard without saying them back: in every build', () => {
    const page = sideWindow('/apps/repairs/staff/done', { framed: true });
    staff.watchAddress(page.target, false, now);
    // Paths in this protocol have no slash in front, as nav.json's have none.
    expect(page.posted).toEqual([{ type: 'adminium:surface:hello', v: 1, appKey: 'repairs', side: 'staff', path: 'done' }]);

    // The dashboard answers with where its own address says to be, then moves with its nav.
    page.told({ type: 'adminium:host:init', v: 1, path: '', theme: 'dark', locale: 'en-US' });
    page.told({ type: 'adminium:host:set', path: 'done' });
    // A change of theme alone, or a path that is no text, moves nothing.
    page.told({ type: 'adminium:host:set', theme: 'light' });
    page.told({ type: 'adminium:host:set', path: 7 });
    expect(page.moves).toEqual(['replace /apps/repairs/staff/', 'replace /apps/repairs/staff/done']);
    expect(page.posted).toHaveLength(1);

    // Its own moves are said: a link in the screen, and Back.
    staff.go('/', {}, page.target);
    page.browserWent('/apps/repairs/staff/done/42');
    expect(page.posted.slice(1)).toEqual([
      { type: 'adminium:surface:navigate', v: 1, path: '' },
      { type: 'adminium:surface:navigate', v: 1, path: 'done/42' },
    ]);
  });

  it('listens to the page that frames it and to no other window', () => {
    const page = sideWindow('/apps/repairs/staff/', { framed: true });
    staff.watchAddress(page.target, false, now);
    page.told({ type: 'adminium:host:set', path: 'done' }, { postMessage: () => undefined });
    page.told({ type: 'adminium:host:set', path: 'done' }, page.target);
    page.told(null);
    page.told('adminium:host:set');
    expect(page.moves).toEqual([]);
  });

  it('says both in a dev bundle: the dashboard’s protocol and where it is', () => {
    const page = sideWindow('/apps/repairs/staff/', { framed: true, title: 'Items' });
    staff.watchAddress(page.target, true, now);
    page.told({ type: 'adminium:host:set', path: 'done' });
    expect(page.posted).toEqual([
      { type: 'adminium:surface:hello', v: 1, appKey: 'repairs', side: 'staff', path: '' },
      { type: 'adminium:side-location', app: 'repairs', side: 'staff', path: '/', title: 'Items', picks: true, shots: true },
      // Followed, so not said back to the dashboard; the preview is still told where the side now is.
      { type: 'adminium:side-location', app: 'repairs', side: 'staff', path: '/done', title: 'Items', picks: true, shots: true },
    ]);
  });

  it('opened in its own tab it speaks to nobody', () => {
    const page = sideWindow('/apps/repairs/staff/');
    staff.watchAddress(page.target, true, now);
    staff.go('/done', {}, page.target);
    expect(page.posted).toEqual([]);
    expect(page.moves).toEqual(['push /apps/repairs/staff/done']);
  });
});

describe('pointing at a part of the page', () => {
  /** An element as the picker reads one: its tag, classes, words, box, and what it sits in. */
  const el = (tag: string, over: Record<string, unknown> = {}): Record<string, unknown> => {
    const made: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      className: '',
      id: '',
      innerText: '',
      parentElement: null,
      children: [],
      getAttribute: (name: string) => ((over['attrs'] as Record<string, string> | undefined) ?? {})[name] ?? null,
      getBoundingClientRect: () => ({ left: 40, top: 100, width: 120.4, height: 39.6 }),
      ...over,
    };
    for (const child of made['children'] as Record<string, unknown>[]) child['parentElement'] = made;
    return made;
  };

  it('says an element as facts: its tag and classes, its words on one line, what it sits in, which one it is, how large it is drawn', () => {
    const button = el('button', { className: 'btn primary  "><script> lg', innerText: '  Add\n to   cart ' });
    const card = el('div', { className: 'card', children: [el('h3'), el('button'), button] });
    const grid = el('section', { className: 'menu-grid', children: [card] });
    const root = el('div', { id: 'root', children: [grid] });
    el('body', { children: [root] });
    expect(pickedOf(button as unknown as Element)).toEqual({ part: 'button btn primary lg', text: 'Add to cart', label: '', within: ['div card', 'section menu-grid'], nth: 2, of: 2, width: 120, height: 40 });
    // A picture has no words: its name is its `alt`. Long words are cut.
    const img = el('img', { attrs: { alt: 'The house burger' } });
    expect(pickedOf(img as unknown as Element)).toMatchObject({ part: 'img', text: '', label: 'The house burger', within: [], nth: 1, of: 1 });
    expect(pickedOf(el('p', { innerText: 'x'.repeat(500) }) as unknown as Element).text).toHaveLength(160);
  });

  /** A page that can be pointed at: what listens on it, what was added to it, and what it said to its frame. */
  const page = () => {
    const heard = new Map<string, (event: unknown) => void>();
    const onWindow = new Map<string, (event: unknown) => void>();
    const added: { tag: string; removed: boolean }[] = [];
    const posted: Record<string, unknown>[] = [];
    const parent = { postMessage: (message: Record<string, unknown>) => void posted.push(message) };
    const doc = {
      documentElement: { clientWidth: 1280, appendChild: () => undefined },
      createElement: (tag: string) => {
        const made = { tag, removed: false, style: {} as Record<string, string>, textContent: '', setAttribute: () => undefined, appendChild: () => undefined, remove: () => void (made.removed = true) };
        added.push(made);
        return made;
      },
      addEventListener: (name: string, run: (event: unknown) => void) => void heard.set(name, run),
      removeEventListener: (name: string) => void heard.delete(name),
    };
    const target = { document: doc, parent, location: { pathname: '/apps/repairs/customer/menu' }, addEventListener: (name: string, run: (event: unknown) => void) => void onWindow.set(name, run) };
    const tell = (data: unknown, source: unknown = parent): void => onWindow.get('message')?.({ source, data });
    const event = (over: Record<string, unknown>) => ({ prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...over });
    return { heard, added, posted, target: target as unknown as Window, tell, event };
  };

  it('listens only in a dev bundle inside a frame: a packed app cannot be pointed at', () => {
    const packed = page();
    pickForFrame(packed.target, false);
    pickForFrame(undefined, true);
    packed.tell({ type: 'adminium:host:pick', on: true });
    expect(packed.heard.size).toBe(0);
  });

  it('starts only at the framing page’s word, takes the click for itself, and says what was clicked', async () => {
    const customer = await bundled('repairs', 'customer');
    const p = page();
    customer.pickForFrame(p.target, true);
    // Another window's word starts nothing.
    p.tell({ type: 'adminium:host:pick', on: true }, {});
    expect(p.heard.size).toBe(0);
    p.tell({ type: 'adminium:host:pick', on: true });
    expect([...p.heard.keys()].sort()).toEqual(['click', 'dblclick', 'keydown', 'mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointerup', 'scroll']);

    // The press is swallowed: no button of the screen sees it.
    const press = p.event({ type: 'mousedown', target: el('button') });
    p.heard.get('mousedown')?.(press);
    expect(press).toMatchObject({ prevented: true, stopped: true });
    // A click on the page's bare ground picks nothing, and pointing goes on.
    const ground = p.event({ type: 'click', target: el('body') });
    p.heard.get('click')?.(ground);
    expect(ground).toMatchObject({ prevented: true, stopped: true });
    expect(p.posted).toEqual([]);
    expect(p.heard.size).toBe(9);

    const click = p.event({ type: 'click', target: el('a', { className: 'cta', innerText: 'Order now' }) });
    p.heard.get('click')?.(click);
    // The link is not followed and no handler of the screen runs; the element is said, and pointing is over.
    expect(click).toMatchObject({ prevented: true, stopped: true });
    expect(p.posted).toEqual([
      { type: 'adminium:side-picked', app: 'repairs', side: 'customer', path: '/menu', page: 1280, element: { part: 'a cta', text: 'Order now', label: '', within: [], nth: 1, of: 1, width: 120, height: 40 } },
    ]);
    expect(p.heard.size).toBe(0);
    // The outline and the pointer's style are taken off the page (the outline's label goes with it).
    expect(p.added.map((made) => [made.tag, made.removed])).toEqual([['div', true], ['div', false], ['style', true]]);
  });

  it('takes a click inside a picture spot as the spot, and says which spot and where it is drawn', async () => {
    const customer = await bundled('repairs', 'customer');
    const p = page();
    customer.pickForFrame(p.target, true);
    p.tell({ type: 'adminium:host:pick', on: true });
    const spot = el('div', { className: 'hero-media', attrs: { 'data-picture-spot': 'hero' }, getBoundingClientRect: () => ({ left: 32.4, top: 120.6, width: 1376, height: 480 }) });
    // The cross inside the wireframe is what the pointer is over: the spot is what was meant.
    const cross = el('svg', { closest: (selector: string) => (selector === '[data-picture-spot]' ? spot : null) });
    p.heard.get('mousemove')?.(p.event({ type: 'mousemove', target: cross }));
    // The outline's tag names the spot, not the tag under the pointer.
    expect(p.added[1]?.textContent).toBe('hero');
    p.heard.get('click')?.(p.event({ type: 'click', target: cross }));
    expect(p.posted).toEqual([
      {
        type: 'adminium:side-picked',
        app: 'repairs',
        side: 'customer',
        path: '/menu',
        page: 1280,
        element: { part: 'div hero-media', text: '', label: '', within: [], nth: 1, of: 1, width: 1376, height: 480 },
        spot: 'hero',
        box: { x: 32, y: 121, width: 1376, height: 480 },
      },
    ]);
  });

  it('draws the part the framing page asks for, says it back under the asking’s number, and says so when it cannot', async () => {
    const customer = await bundled('repairs', 'customer');
    const p = page();
    const asked: unknown[] = [];
    let drawn: string | null = 'data:image/jpeg;base64,AAAA';
    customer.shootForFrame(p.target, true, async (_doc, _view, area) => {
      asked.push(area);
      return drawn;
    });
    const area = { left: 10, top: 20, width: 300, height: 200 };
    // Another window's word draws nothing, and neither does an asking with no number.
    p.tell({ type: 'adminium:host:shot', id: 1, area }, {});
    p.tell({ type: 'adminium:host:shot', area });
    expect(asked).toEqual([]);
    p.tell({ type: 'adminium:host:shot', id: 7, area });
    // One at a time: a second asking while the first is drawn is not heard.
    p.tell({ type: 'adminium:host:shot', id: 8, area });
    await vi.waitFor(() => expect(p.posted).toHaveLength(1));
    expect(asked).toEqual([area]);
    expect(p.posted).toEqual([{ type: 'adminium:side-shot', app: 'repairs', side: 'customer', id: 7, picture: 'data:image/jpeg;base64,AAAA' }]);
    drawn = null;
    p.tell({ type: 'adminium:host:shot', id: 9, area });
    await vi.waitFor(() => expect(p.posted).toHaveLength(2));
    expect(p.posted[1]).toEqual({ type: 'adminium:side-shot', app: 'repairs', side: 'customer', id: 9 });
  });

  it('listens for a picture only in a dev bundle inside a frame', () => {
    const packed = page();
    shootForFrame(packed.target, false);
    shootForFrame(undefined, true);
    packed.tell({ type: 'adminium:host:shot', id: 1, area: { left: 0, top: 0, width: 100, height: 100 } });
    expect(packed.posted).toEqual([]);
  });

  it('says a share of the window’s height in pixels in what a rule sets, and never in the name it goes by', () => {
    const style = (selectorText: string, body: string, cssRules: unknown[] = []) => ({ cssText: `${selectorText} { ${body} }`, selectorText, style: { cssText: body }, cssRules });
    // A class named for its height keeps its name: with another name nothing on the page carries it.
    expect(ruleText(style('.h-\\[85vh\\]', 'height: 85vh;') as never, 800)).toBe('.h-\\[85vh\\] { height: 680px;  }');
    expect(ruleText(style('.min-h-\\[calc\\(100vh-4rem\\)\\]', 'min-height: calc(100vh - 4rem);') as never, 800)).toContain('.min-h-\\[calc\\(100vh-4rem\\)\\] { min-height: calc(800px - 4rem);');
    // Inside a group, and inside a condition written in the class's own block.
    const nested = style('.md\\:h-\\[50dvh\\]', '', [{ cssText: '@media (width >= 48rem) { height: 50dvh; }', cssRules: [{ cssText: 'height: 50dvh;', style: { cssText: 'height: 50dvh;' } }] }]);
    const layer = { cssText: '@layer utilities { … }', cssRules: [nested] };
    expect(ruleText(layer as never, 800).replace(/\s+/g, ' ')).toBe('@layer utilities { .md\\:h-\\[50dvh\\] { @media (width >= 48rem) { height: 400px; } } }');
    // What has no height to say is left as it is written.
    expect(ruleText({ cssText: '@keyframes rise { 0% { top: 10vh; } }', cssRules: [] } as never, 800)).toBe('@keyframes rise { 0% { top: 10vh; } }');
    expect(ruleText({ cssText: '@layer theme, base;' } as never, 800)).toBe('@layer theme, base;');
  });

  it('holds the part asked for inside the window, and takes a slip of the hand for none', () => {
    expect(areaWithin({ left: 10.4, top: 20.6, width: 300, height: 200 }, 1280, 800)).toEqual({ left: 10, top: 21, width: 300, height: 200 });
    expect(areaWithin({ left: -50, top: 700, width: 2000, height: 500 }, 1280, 800)).toEqual({ left: 0, top: 700, width: 1280, height: 100 });
    expect(areaWithin({ left: 10, top: 10, width: 5, height: 300 }, 1280, 800)).toBeNull();
    expect(areaWithin({ left: 1400, top: 10, width: 100, height: 100 }, 1280, 800)).toBeNull();
    expect(areaWithin({ left: '0', top: 0, width: 100, height: 100 }, 1280, 800)).toBeNull();
    expect(areaWithin({ left: 0, top: 0, width: Number.NaN, height: 100 }, 1280, 800)).toBeNull();
    expect(areaWithin(null, 1280, 800)).toBeNull();
  });

  it('ends at the framing page’s word, and at Escape, which it says', async () => {
    const customer = await bundled('repairs', 'customer');
    const p = page();
    customer.pickForFrame(p.target, true);
    p.tell({ type: 'adminium:host:pick', on: true });
    p.tell({ type: 'adminium:host:pick', on: false });
    expect(p.heard.size).toBe(0);
    expect(p.posted).toEqual([]);

    p.tell({ type: 'adminium:host:pick', on: true });
    p.heard.get('keydown')?.(p.event({ type: 'keydown', key: 'a' }));
    expect(p.heard.size).toBe(9);
    p.heard.get('keydown')?.(p.event({ type: 'keydown', key: 'Escape' }));
    expect(p.heard.size).toBe(0);
    expect(p.posted).toEqual([{ type: 'adminium:side-pick-ended', app: 'repairs', side: 'customer' }]);
  });
});

describe('a picture in its spot', () => {
  const SPOTS = {
    hero: { label: 'Hero', shape: 'wide', src: '/apps/cafe/customer/assets/spot-hero-1.jpg', alt: 'A long table set for dinner', decorative: false, credit: { title: 'Board', creator: 'Maya Lind', creatorUrl: 'https://x.example/maya', licence: 'CC BY 2.0', licenceUrl: 'https://creativecommons.org/licenses/by/2.0/', page: 'https://x.example/board' } },
    team: { label: 'Team', shape: 'square', src: null, alt: '', decorative: false },
    plain: { label: 'Plain', shape: 'tall', src: '/a.jpg', alt: 'Words nobody hears', decorative: true },
    bad: { label: 'Bad', shape: 'wide', src: 'javascript:alert(1)', alt: '', decorative: false },
  };

  /** The module as a build with these spots made it; `preview` puts it in the Designer's frame. */
  async function built(preview: boolean) {
    const defined = globalThis as Record<string, unknown>;
    defined['__ADMINIUM_APP_KEY__'] = 'cafe';
    defined['__ADMINIUM_SIDE__'] = 'customer';
    defined['__ADMINIUM_DEV__'] = preview;
    defined['__ADMINIUM_SPOTS__'] = SPOTS;
    const posted: unknown[] = [];
    if (preview) defined['window'] = { parent: { postMessage: (message: unknown) => void posted.push(message) }, addEventListener: () => undefined, location: { pathname: '/apps/cafe/customer/' } };
    vi.resetModules();
    try {
      return { side: await import('../src/side/index.js'), posted };
    } finally {
      for (const name of ['__ADMINIUM_APP_KEY__', '__ADMINIUM_SIDE__', '__ADMINIUM_DEV__', '__ADMINIUM_SPOTS__']) delete defined[name];
    }
  }
  type Drawn = { type: string; props: Record<string, unknown> & { children?: unknown } };
  const kids = (el: Drawn): Drawn[] => (Array.isArray(el.props.children) ? el.props.children : [el.props.children]).filter((child): child is Drawn => child !== null && typeof child === 'object');
  const words = (el: Drawn): string[] => kids(el).flatMap((child) => (typeof child.props.children === 'string' ? [child.props.children] : words(child)));

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['window'];
    hooks.on = false;
    hooks.set = false;
    hooks.cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it('draws a filled spot as its picture, cut to the spot’s shape, with the person’s words as its alt', async () => {
    const { side } = await built(false);
    hooks.on = true;
    const hero = side.Picture({ spot: 'hero', className: 'hero-media' }) as unknown as Drawn;
    expect(hero.type).toBe('img');
    expect(hero.props).toMatchObject({ 'data-picture-spot': 'hero', src: '/apps/cafe/customer/assets/spot-hero-1.jpg', alt: 'A long table set for dinner', className: 'hero-media', style: { aspectRatio: '16 / 9', objectFit: 'cover', width: '100%' } });
    hooks.set = false;
    // Decorative: drawn, and said to nobody.
    expect((side.Picture({ spot: 'plain' }) as unknown as Drawn).props).toMatchObject({ alt: '', style: { aspectRatio: '3 / 4' } });
  });

  it('draws a spot with no picture, in a built app, as a box with a cross that says nothing and is hidden from screen readers', async () => {
    const { side } = await built(false);
    hooks.on = true;
    const team = side.Picture({ spot: 'team' }) as unknown as Drawn;
    expect(team.type).toBe('div');
    expect(team.props).toMatchObject({ 'data-picture-spot': 'team', 'aria-hidden': 'true', style: { aspectRatio: '1 / 1', background: 'var(--surface, #f4f4f4)' } });
    expect(kids(team).map((child) => child.type)).toEqual(['svg']);
    expect(kids(kids(team)[0] as Drawn).map((line) => line.props['stroke'])).toEqual(['var(--line, #d9d9d9)', 'var(--line, #d9d9d9)']);
    expect(words(team)).toEqual([]);
    // An address that is not this server's or an https one is no picture.
    hooks.set = false;
    expect((side.Picture({ spot: 'bad' }) as unknown as Drawn).type).toBe('div');
    // A spot the build does not know is a wireframe too, never an error on the page.
    hooks.set = false;
    expect((side.Picture({ spot: 'nowhere' }) as unknown as Drawn).props).toMatchObject({ 'data-picture-spot': 'nowhere', 'aria-hidden': 'true' });
  });

  it('falls back to the wireframe when its picture does not load', async () => {
    const { side } = await built(false);
    hooks.on = true;
    const hero = side.Picture({ spot: 'hero' }) as unknown as Drawn;
    (hero.props['onError'] as () => void)();
    const after = side.Picture({ spot: 'hero' }) as unknown as Drawn;
    expect(after.type).toBe('div');
    expect(after.props).toMatchObject({ 'data-picture-spot': 'hero', 'aria-hidden': 'true' });
  });

  it('in the Designer’s preview, says the spot’s name and shape and “Choose a picture”, which opens the dialog on it', async () => {
    const { side, posted } = await built(true);
    hooks.on = true;
    const team = side.Picture({ spot: 'team' }) as unknown as Drawn;
    expect(team.props['aria-hidden']).toBeUndefined();
    const button = kids(team).find((child) => child.type === 'button') as Drawn;
    expect(words(button)).toEqual(['Team · square', 'Choose a picture']);
    (button.props['onClick'] as () => void)();
    expect(posted).toContainEqual({ type: 'adminium:side-spot', app: 'cafe', side: 'customer', spot: 'team' });
  });

  it('gives the credits of the pictures it shows, by their links, and none once they are gone', async () => {
    const { side } = await built(false);
    hooks.on = true;
    side.Picture({ spot: 'hero' });
    expect(side.creditsLine()).toEqual([
      { text: 'Picture credits: ' },
      { text: 'Board', href: 'https://x.example/board' },
      { text: ' by ' },
      { text: 'Maya Lind', href: 'https://x.example/maya' },
      { text: ', ' },
      { text: 'CC BY 2.0', href: 'https://creativecommons.org/licenses/by/2.0/' },
      { text: '.' },
    ]);
    hooks.cleanups.splice(0).forEach((cleanup) => cleanup());
    expect(side.creditsLine()).toEqual([]);
    // A spot with no credit (the person's own picture) asks for none.
    hooks.set = false;
    side.Picture({ spot: 'plain' });
    expect(side.creditsLine()).toEqual([]);
  });
});
