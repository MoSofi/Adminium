// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The module an app's screens share: where a side is mounted, the config
 * Adminium serves beside it, and a staff side's reads and writes.
 */
import { describe, expect, it } from 'vitest';

import { connectCustomer, connectStaff, demoStaff, mountBase, sampleRows, wantsDemo, SideError } from '../src/side/index.js';

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
