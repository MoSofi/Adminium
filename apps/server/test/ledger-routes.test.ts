// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN OWNER DRAWS A RULE ON A TABLE, AND THE SERVER KEEPS IT — through the
 * routes a rules page calls, on the server as it is composed: the rule is
 * stored, a save through the data routes then posts, the rule cannot be
 * changed or removed while rows hold something under it, it can be switched
 * off, and what a refusal says of the ledger's own rows is told only to
 * somebody who may read them.
 */
import { apiKeysRepo, overridesRepo, permissionsRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateApiKey } from '../src/rbac/api-keys.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const INTO = { addOn: 'ledger-kit', ledger: 'units', action: 'use' };
/** Held when a request is sent, taken when it is done, given back when it is cancelled. */
const ASK: Doc = {
  into: INTO,
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['sent'] } },
  post: { on: { column: 'status', in: ['done'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
  heldUntil: 'hold_until',
};
/** Taken when a row is counted, with no hold before it: what the kit lets through unasked where an account allows it. */
const TAKE: Doc = { into: INTO, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['counted'] } }, reverse: { on: { column: 'status', in: ['undone'] } } };
const TALLY: Doc = { into: { ...INTO, action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['counted'] } } };

describe.each(LEGS)('an owner\'s rule on a table, through the routes — %s', (dialect, available) => {
  let w: LedgerWorld;
  let served: Served;
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const cookies = new Map<string, string>();
  const id = (name: string) => w.target(name).table.id;
  const api = (method: string, url: string, payload?: unknown, as = 'desk') =>
    served.composed.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: as === '' ? {} : { cookie: cookies.get(as)! }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const rule = (table: string, posting: string) => `/connections/${w.h.connectionId}/tables/${encodeURIComponent(id(table))}/postings/${posting}`;
  const data = (table: string, more = '') => `/data/${w.h.connectionId}/${encodeURIComponent(id(table))}${more}`;
  const listed = async (as = 'desk') => (await api('GET', `/ledgers/ledger-kit/units/postings?connectionId=${w.h.connectionId}`, undefined, as)).json() as { postings: Doc[]; canChange: boolean };
  const one = async (table: string, posting: string) => (await listed()).postings.find((entry) => entry['table'] === id(table) && entry['id'] === posting);
  const balance = async (account: number) => Number((await w.h.rows(`SELECT balance FROM ledger_kit_accounts WHERE id = ${String(account)}`))[0]!['balance']);
  const errorOf = (res: { json: () => unknown }) => (res.json() as { error: { code: string; details?: Doc } }).error;

  async function person(name: string, grants: readonly string[] | 'super-admin' | 'ledger-kit-manager'): Promise<User> {
    const user = await usersRepo(w.h.meta).create({ email: `${name}@rules.dev`, name, passwordHash: await adminPasswordHash() });
    const roles = rolesRepo(w.h.meta);
    if (typeof grants === 'string') {
      await roles.assignToUser(user.id, (await roles.findBySlug(grants))!.id);
    } else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(w.h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions);
      await roles.assignToUser(user.id, role.id);
    }
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${name}@rules.dev`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
    return user;
  }

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL, hold_until VARCHAR(40) NULL';
    w = await ledgerWorld(
      dialect,
      { asks: { columns, postings: [] }, tallies: { columns, postings: [] }, goods: { columns: 'title VARCHAR(80) NULL, total DECIMAL(12,3) NULL, token VARCHAR(40) NULL', postings: [] }, app_rows: { columns, postings: [] }, strays: { columns, postings: [] } },
      undefined,
      // A column kept from readers: masked personal data.
      async (h, idOf) => void (await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.pii', tableName: idOf('goods'), columnName: 'token', value: { masked: true }, origin: 'user' } as never)),
    );
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2), (2, 'Sugar', 3, 0, 3, ${w.flag(false)}, 1), (3, 'Salt', 5, 0, 5, ${w.flag(true)}, 1)`);
    // A rule an app's manifest stored: the owner's routes leave it as it is.
    await overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.postings', tableName: id('app_rows'), columnName: null, value: { postings: [{ id: 'shipped', ...TALLY }] }, origin: 'app' } as never);
    // The composed server loads the kit's deciding file from the harness's own store, as a developer's server does.
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    await person('desk', 'super-admin');
    await person('keeper', 'ledger-kit-manager');
    await person('mapper', ['system:schema:remap']);
    await person('clerk', [`table:${w.h.connectionId}:${id('asks')}:read`, `table:${w.h.connectionId}:${id('asks')}:create`, `table:${w.h.connectionId}:${id('asks')}:update`]);
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!available) return;
    await served?.close();
    await w?.close();
  });

  it.skipIf(!available)('the reads need a session; every write needs the grant that changes what a table means — an add-on\'s own role is not it', async () => {
    expect((await api('GET', `/ledgers/ledger-kit/units/postings?connectionId=${w.h.connectionId}`, undefined, '')).statusCode).toBe(401);
    expect((await api('GET', `/ledgers/ledger-kit/units/sources?connectionId=${w.h.connectionId}`, undefined, '')).statusCode).toBe(401);
    const writes: [string, string, unknown][] = [
      ['PUT', rule('tallies', 'tally'), TALLY],
      ['DELETE', rule('tallies', 'tally'), undefined],
      ['PATCH', `${rule('tallies', 'tally')}/switch`, { enabled: false }],
      ['POST', '/ledgers/ledger-kit/units/make-items', { connectionId: w.h.connectionId, table: id('goods'), label: 'title' }],
      ['POST', '/ledgers/ledger-kit/units/catch-up', { connectionId: w.h.connectionId }],
    ];
    for (const [method, url, payload] of writes) {
      expect((await api(method, url, payload, 'keeper')).statusCode, `${method} ${url}`).toBe(403);
      expect((await api(method, url, payload, '')).statusCode, `${method} ${url}`).toBe(401);
    }
    // The keeper reads the rules, and is told the page may change nothing.
    const seen = await listed('keeper');
    expect(seen.canChange).toBe(false);
    expect((await listed()).canChange).toBe(true);
    expect(await w.count('ledger_kit_postings')).toBe(0);
  });

  it.skipIf(!available)('a rule is stored, listed, and the next save posts; while a row holds under it, it keeps its shape and its place', async () => {
    const stored = await api('PUT', rule('asks', 'ask'), ASK);
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.json()).toMatchObject({ id: 'ask', into: INTO });
    expect(await one('asks', 'ask')).toMatchObject({ action: 'use', owner: null, enabled: true, state: 'live', holding: 0, unplanned: 0, map: ASK['map'] });

    // A save through the data routes crosses the point: something is held, and nothing of it can be undone by a token.
    const made = await api('POST', data('asks'), { values: { account_id: 1, qty: '2', status: 'draft' } });
    expect(made.statusCode, made.body).toBe(201);
    const row = (made.json() as { data: Doc }).data['id'];
    const sent = await api('PATCH', data('asks', `/${String(row)}`), { values: { status: 'sent' } });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ undoToken: null, postings: [{ ledger: 'units', state: 'ok' }] });
    expect(await w.receiptsOf('ask', row)).toEqual(['reserve:1:planned:1']);
    expect(await one('asks', 'ask')).toMatchObject({ holding: 1 });
    // A rule of the same name on another table holds nothing of it.
    expect((await api('PUT', rule('tallies', 'ask'), TAKE)).statusCode).toBe(200);
    expect(await one('tallies', 'ask')).toMatchObject({ holding: 0 });
    expect((await api('DELETE', rule('tallies', 'ask'))).statusCode).toBe(204);
    // The posting left its own line in the audit log, by the one who saved.
    const audit = await w.h.meta.db.selectFrom('adminium_audit_log' as never).select(['action' as never]).where('action' as never, '=', 'ledger.posted' as never).execute();
    expect(audit).toHaveLength(1);

    // What it hands over cannot change while that row holds; the same rule again, or one that changes nothing of the kind, is taken.
    const changed = await api('PUT', rule('asks', 'ask'), { ...ASK, map: { account: 'account_id', quantity: 'qty', note: 'status' } });
    expect(changed.statusCode, changed.body).toBe(409);
    expect(errorOf(changed)).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'receipt-open', rows: 1, posting: 'ask' } });
    expect((await api('PUT', rule('asks', 'ask'), ASK)).statusCode).toBe(200);
    const gone = await api('DELETE', rule('asks', 'ask'));
    expect(gone.statusCode, gone.body).toBe(409);
    expect(errorOf(gone)).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'receipt-open', rows: 1 } });

    // Put back, nothing holds: the rule may change, and may go.
    expect((await api('PATCH', data('asks', `/${String(row)}`), { values: { status: 'cancelled' } })).statusCode).toBe(200);
    expect(await one('asks', 'ask')).toMatchObject({ holding: 0 });
    expect(await balance(1)).toBe(100);
    expect((await api('PUT', rule('asks', 'ask'), { ...ASK, map: { account: 'account_id', quantity: 'qty', note: 'status' } })).statusCode).toBe(200);
    expect((await api('DELETE', rule('asks', 'ask'))).statusCode).toBe(204);
    expect(await one('asks', 'ask')).toBeUndefined();
    expect((await api('DELETE', rule('asks', 'ask'))).statusCode).toBe(404);
    // With no rule, the same move posts nothing.
    const again = await api('POST', data('asks'), { values: { account_id: 1, qty: '2', status: 'sent' } });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).not.toHaveProperty('postings');
  });

  it.skipIf(!available)('an API key that holds the grant changes a rule too: the rule\'s record names no user, and nothing fails', async () => {
    const generated = generateApiKey();
    await apiKeysRepo(w.h.meta).create({ name: 'rules by script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: (await rolesRepo(w.h.meta).findBySlug('mapper-role'))!.id });
    const byKey = (method: string, url: string, payload?: unknown) =>
      served.composed.app.inject({ method: method as 'PUT', url: `/api/v1${url}`, headers: { authorization: `Bearer ${generated.key}` }, ...(payload === undefined ? {} : { payload: payload as never }) });
    const put = await byKey('PUT', rule('strays', 'by-key'), TALLY);
    expect(put.statusCode, put.body).toBe(200);
    const stored = (await overridesRepo(w.h.meta).listForConnection(w.h.connectionId, { status: 'active' })).find((row) => row.op === 'table.postings' && row.tableName === id('strays'));
    // A key's id is no user's: the record's author is left empty rather than written as a link to nobody.
    expect(stored?.createdBy ?? null).toBeNull();
    const off = await byKey('PATCH', `${rule('strays', 'by-key')}/switch`, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);
    const gone = await byKey('DELETE', rule('strays', 'by-key'));
    expect(gone.statusCode, gone.body).toBe(204);
  });

  it.skipIf(!available)('a rule that cannot be kept is refused with the reason, and nothing is stored', async () => {
    const bad: [string, Doc][] = [
      ['an add-on that is not installed', { ...TALLY, into: { addOn: 'nobody-here', ledger: 'units', action: 'count' } }],
      ['a ledger it does not keep', { ...TALLY, into: { ...INTO, ledger: 'gold' } }],
      ['an action the ledger has not', { ...TALLY, into: { ...INTO, action: 'juggle' } }],
      ['an input the action needs, left out', { ...TALLY, map: { account: 'account_id' } }],
      ['an input the action does not take', { ...TALLY, map: { account: 'account_id', quantity: 'qty', colour: 'status' } }],
      ['a column the table has not', { ...TALLY, map: { account: 'account_id', quantity: 'weight' } }],
      ['a state on a table that keeps none', { ...TALLY, post: { on: { to: ['counted'] } } }],
      ['a phase the action has not', { ...TALLY, reserve: { on: { column: 'status', in: ['asked'] } } }],
      ['neither a hold nor a taking', { into: TALLY['into'], map: TALLY['map'], reverse: { on: { column: 'status', in: ['undone'] } } }],
      ['a hold with no end', { ...ASK, heldUntil: undefined }],
      ['lines of another row, which an owner\'s rule does not draw', { ...TALLY, via: 'account_id' }],
      ['a hold that lasts until nothing a row keeps', { ...ASK, heldUntil: { value: '2026-01-01' } }],
      ['a setting the add-on does not keep', { ...TALLY, map: { account: 'account_id', quantity: { setting: 'no_such_setting' } } }],
      ['a feature, which is an app\'s word', { ...TALLY, needs: 'stock' }],
    ];
    for (const [name, body] of bad) {
      const res = await api('PUT', rule('tallies', 'tally'), body);
      expect(res.statusCode, `${name}: ${res.body}`).toBe(422);
    }
    expect(await one('tallies', 'tally')).toBeUndefined();
    expect((await api('PUT', `/connections/${w.h.connectionId}/tables/no_such_table/postings/tally`, TALLY)).statusCode).toBe(404);
    // The add-on's own tables post by its own manifest's rules, never by an owner's.
    const own = await api('PUT', rule('ledger_kit_requests', 'mine'), { ...TALLY, map: { account: 'account_id', quantity: 'quantity' } });
    expect(own.statusCode, own.body).toBe(422);
    expect(own.body).toContain("one of the add-on's own tables");
  });

  it.skipIf(!available)('switched off, a rule starts nothing and still gives back what it holds; switched on, it posts again', async () => {
    expect((await api('PUT', rule('asks', 'ask'), ASK)).statusCode).toBe(200);
    const made = (await api('POST', data('asks'), { values: { account_id: 1, qty: '4', status: 'sent' } })).json() as { data: Doc };
    const held = made.data['id'];
    expect(await w.receiptsOf('ask', held)).toEqual(['reserve:1:planned:1']);

    // A second rule may not read what the first one's hold is kept until: that column is the first rule's to fill.
    const second = await api('PUT', rule('asks', 'again'), { ...TALLY, map: { account: 'account_id', quantity: 'hold_until' } });
    expect(second.statusCode, second.body).toBe(422);
    expect(second.body).toContain('decided by another rule');

    const off = await api('PATCH', `${rule('asks', 'ask')}/switch`, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toEqual({ enabled: false });
    expect(await one('asks', 'ask')).toMatchObject({ enabled: false, state: 'off', holding: 1 });
    // Nothing new is held…
    const quiet = await api('POST', data('asks'), { values: { account_id: 1, qty: '1', status: 'sent' } });
    expect(quiet.statusCode, quiet.body).toBe(201);
    expect(await w.receiptsOf('ask', (quiet.json() as { data: Doc }).data['id'])).toEqual([]);
    // …and what was held is still given back.
    expect((await api('PATCH', data('asks', `/${String(held)}`), { values: { status: 'cancelled' } })).statusCode).toBe(200);
    expect(await w.receiptsOf('ask', held)).toEqual(['reserve:1:planned:1', 'reverse:1:planned:1']);

    expect((await api('PATCH', `${rule('asks', 'ask')}/switch`, { enabled: true })).json()).toEqual({ enabled: true });
    expect(await one('asks', 'ask')).toMatchObject({ enabled: true, state: 'live', holding: 0 });
    const loud = (await api('POST', data('asks'), { values: { account_id: 1, qty: '1', status: 'sent' } })).json() as { data: Doc };
    expect(await w.receiptsOf('ask', loud.data['id'])).toEqual(['reserve:1:planned:1']);
    expect((await api('PATCH', data('asks', `/${String(loud.data['id'])}`), { values: { status: 'cancelled' } })).statusCode).toBe(200);
    expect((await api('PATCH', `${rule('asks', 'nothing-here')}/switch`, { enabled: false })).statusCode).toBe(404);
    // A rule removed while it is off takes its switch with it: the next rule of that name starts on.
    expect((await api('PATCH', `${rule('asks', 'ask')}/switch`, { enabled: false })).statusCode).toBe(200);
    expect((await api('DELETE', rule('asks', 'ask'))).statusCode).toBe(204);
    expect((await api('PUT', rule('asks', 'ask'), ASK)).statusCode).toBe(200);
    expect(await one('asks', 'ask')).toMatchObject({ enabled: true, state: 'live' });
    expect((await api('DELETE', rule('asks', 'ask'))).statusCode).toBe(204);
  });

  it.skipIf(!available)('an app\'s rule is listed as the app\'s, cannot be changed or removed here, and can be switched off', async () => {
    expect(await one('app_rows', 'shipped')).toMatchObject({ action: 'count', enabled: true });
    expect((await one('app_rows', 'shipped'))!['owner']).not.toBeNull();
    for (const res of [await api('PUT', rule('app_rows', 'shipped'), TALLY), await api('DELETE', rule('app_rows', 'shipped'))]) {
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toMatchObject({ code: 'CONFLICT', details: { reason: 'managed' } });
    }
    expect((await api('PATCH', `${rule('app_rows', 'shipped')}/switch`, { enabled: false })).statusCode).toBe(200);
    expect(await one('app_rows', 'shipped')).toMatchObject({ enabled: false });
    // The app's own stored row is as it was.
    const rows = (await overridesRepo(w.h.meta).listForConnection(w.h.connectionId)).filter((row) => row.op === 'table.postings' && row.tableName === id('app_rows'));
    expect(rows).toMatchObject([{ origin: 'app', value: { postings: [{ id: 'shipped' }] } }]);
    expect((await api('PATCH', `${rule('app_rows', 'shipped')}/switch`, { enabled: true })).statusCode).toBe(200);
    // A rule of the owner's own beside it comes and goes without touching the app's.
    const beside = async () => (await overridesRepo(w.h.meta).listForConnection(w.h.connectionId)).filter((row) => row.op === 'table.postings' && row.tableName === id('app_rows')).map((row) => `${row.origin}:${(row.value as { postings: Doc[] }).postings.map((posting) => String(posting['id'])).join(',')}`).sort();
    expect((await api('PUT', rule('app_rows', 'mine'), TALLY)).statusCode).toBe(200);
    expect(await beside()).toEqual(['app:shipped', 'user:mine']);
    expect((await one('app_rows', 'mine'))!['owner']).toBeNull();
    expect((await api('DELETE', rule('app_rows', 'mine'))).statusCode).toBe(204);
    expect(await beside()).toEqual(['app:shipped']);
  });

  it.skipIf(!available)('what a rule may be drawn from: the owner\'s tables with their columns, the ledger\'s actions and its settings — never the add-on\'s own tables', async () => {
    const res = await api('GET', `/ledgers/ledger-kit/units/sources?connectionId=${w.h.connectionId}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { tables: { table: string; columns: { name: string; decided: boolean }[] }[]; actions: Record<string, { inputs: Doc }>; settings: string[] };
    const names = body.tables.map((table) => table.table);
    expect(names).toEqual(expect.arrayContaining([id('asks'), id('tallies'), id('goods')]));
    expect(names.some((name) => name.includes('ledger_kit_'))).toBe(false);
    expect(body.tables.find((table) => table.table === id('asks'))!.columns.map((column) => column.name)).toEqual(['id', 'account_id', 'qty', 'status', 'hold_until']);
    expect(body.actions['use']).toEqual({ inputs: { account: 'link', quantity: 'decimal', note: 'text?' } });
    expect(Object.keys(body.actions)).toEqual(expect.arrayContaining(['use', 'count', 'tidy', 'adopt']));
    expect(body.settings).toEqual(expect.arrayContaining(['misbehave', 'show_left_below']));
    expect((await api('GET', `/ledgers/ledger-kit/gold/sources?connectionId=${w.h.connectionId}`)).statusCode).toBe(404);
  });

  it.skipIf(!available)('items are made from a table\'s rows, each its own save, a call at a time — and a row the ledger has already is passed over', async () => {
    await w.h.rows(`INSERT INTO goods (title, token) VALUES ('Tote', 't-1'), ('Mug', 't-2'), ('Cap', 't-3')`);
    const before = await w.count('ledger_kit_things');
    const make = (more: Doc = {}) => api('POST', '/ledgers/ledger-kit/units/make-items', { connectionId: w.h.connectionId, table: id('goods'), label: 'title', ...more });
    const first = await make({ limit: 2 });
    expect(first.statusCode, first.body).toBe(200);
    const told = first.json() as { made: number; skipped: number; more: boolean; next?: string };
    expect(told).toMatchObject({ made: 2, skipped: 0, more: true });
    const rest = await make({ limit: 2, after: told.next });
    expect(rest.json()).toEqual({ made: 1, skipped: 0, refused: [], more: false });
    expect(await w.count('ledger_kit_things')).toBe(before + 3);
    expect((await w.h.rows(`SELECT name FROM ledger_kit_things ORDER BY name`)).map((row) => row['name'])).toEqual(['Cap', 'Mug', 'Tote']);
    // Asked again from the start: every row is the ledger's already.
    expect((await make()).json()).toEqual({ made: 0, skipped: 3, refused: [], more: false });
    expect(await w.count('ledger_kit_things')).toBe(before + 3);
    // The table keeps no rule of it afterwards, and the rules page lists none.
    expect(await one('goods', 'adopt')).toBeUndefined();
    expect((await make({ label: 'no_such_column' })).statusCode).toBe(422);
    expect((await make({ table: id('ledger_kit_requests'), label: 'status' })).statusCode).toBe(422);

    // A row with no name cannot be taken: it is told, and the row after it is made all the same.
    await w.h.rows(`INSERT INTO goods (title) VALUES (NULL), ('Pin')`);
    const mixed = (await make()).json() as { made: number; skipped: number; refused: { row: string; reason: string }[]; more: boolean };
    expect(mixed).toMatchObject({ made: 1, skipped: 3, more: false });
    expect(mixed.refused).toHaveLength(1);
    expect(mixed.refused[0]!.reason).toBe('VALIDATION_FAILED');
    expect(await w.count('ledger_kit_things', `name = 'Pin'`)).toBe(1);

    // A column kept from readers is handed to an add-on only by somebody who may show it anyway.
    const kept = await api('POST', '/ledgers/ledger-kit/units/make-items', { connectionId: w.h.connectionId, table: id('goods'), label: 'token' }, 'mapper');
    expect(kept.statusCode, kept.body).toBe(403);
    expect(await w.count('ledger_kit_things', `name LIKE 't-%'`)).toBe(0);
    const mapped = await api('PUT', rule('goods', 'weigh'), { ...TALLY, post: { on: { column: 'title', set: true } }, map: { account: 'token', quantity: 'total' } }, 'mapper');
    expect(mapped.statusCode, mapped.body).toBe(403);
    expect(await one('goods', 'weigh')).toBeUndefined();
    // The same rule over a column anybody reads is the mapper's to draw.
    const plain = await api('PUT', rule('goods', 'weigh'), { ...TALLY, post: { on: { column: 'title', set: true } }, map: { account: 'id', quantity: 'total' } }, 'mapper');
    expect(plain.statusCode, plain.body).toBe(200);
    expect((await api('DELETE', rule('goods', 'weigh'), undefined, 'mapper')).statusCode).toBe(204);
    expect((await api('POST', '/ledgers/ledger-kit/gold/make-items', { connectionId: w.h.connectionId, table: id('goods'), label: 'title' })).statusCode).toBe(404);
  });

  it.skipIf(!available)('saves let through unasked are counted on their rule, and recorded when the owner says so — oldest first, one that cannot be found told and left', async () => {
    expect((await api('PUT', rule('tallies', 'tally'), TAKE)).statusCode).toBe(200);
    // The add-on could not be asked; Salt allows going below unasked, so the save went through with nothing written.
    await w.reload();
    const deaf = w.service({ decider: () => null });
    const a = Number((await w.create('tallies', { account_id: 3, qty: '2', status: 'counted' }, undefined, deaf))['id']);
    const b = Number((await w.create('tallies', { account_id: 3, qty: '1', status: 'counted' }, undefined, deaf))['id']);
    expect(await w.receiptsOf('tally', a)).toEqual(['post:1:unplanned:0']);
    expect(await one('tallies', 'tally')).toMatchObject({ unplanned: 2 });
    expect(await balance(3)).toBe(5);

    const one_ = await api('POST', '/ledgers/ledger-kit/units/catch-up', { connectionId: w.h.connectionId, limit: 1 });
    expect(one_.statusCode, one_.body).toBe(200);
    const first = one_.json() as { planned: number; refused: Doc[]; left: number; next?: string };
    expect(first).toMatchObject({ planned: 1, refused: [], left: 1 });
    expect(first.next).toBeDefined();
    expect(await w.receiptsOf('tally', a)).toEqual(['post:1:planned:1']);
    expect(await w.receiptsOf('tally', b)).toEqual(['post:1:unplanned:0']);
    expect(await balance(3)).toBe(3);

    // A receipt whose table is not there any more waits on, and is said to — and does not stand in the way of the one after it.
    const c = Number((await w.create('tallies', { account_id: 3, qty: '1', status: 'counted' }, undefined, deaf))['id']);
    const tableRef = String((await w.h.rows(`SELECT source_table FROM ledger_kit_postings WHERE source_row = '${String(a)}' AND posting = 'tally'`))[0]!['source_table']);
    await w.h.rows(`UPDATE ledger_kit_postings SET source_table = 'gone:table' WHERE source_row = '${String(b)}' AND posting = 'tally'`);
    type CaughtUp = { planned: number; refused: Doc[]; left: number; next?: string };
    const stuck = (await api('POST', '/ledgers/ledger-kit/units/catch-up', { connectionId: w.h.connectionId, limit: 1 })).json() as CaughtUp;
    expect(stuck).toMatchObject({ planned: 0, left: 2, refused: [{ reason: 'source-gone' }] });
    expect(stuck.next).toBeDefined();
    const past = (await api('POST', '/ledgers/ledger-kit/units/catch-up', { connectionId: w.h.connectionId, limit: 1, after: stuck.next })).json() as CaughtUp;
    expect(past).toMatchObject({ planned: 1, refused: [], left: 1 });
    expect(past.next).toBeUndefined();
    expect(await w.receiptsOf('tally', c)).toEqual(['post:1:planned:1']);
    expect(await balance(3)).toBe(2);

    // Its table back, but the row it was for deleted: nothing can be worked out for it, and it is said so rather than passed over in silence.
    await w.h.rows(`UPDATE ledger_kit_postings SET source_table = '${tableRef}' WHERE source_row = '${String(b)}' AND posting = 'tally'`);
    await w.h.rows(`DELETE FROM tallies WHERE id = ${String(b)}`);
    const orphan = (await api('POST', '/ledgers/ledger-kit/units/catch-up', { connectionId: w.h.connectionId })).json() as CaughtUp;
    expect(orphan).toMatchObject({ planned: 0, left: 1, refused: [{ reason: 'nothing-to-plan' }] });
    expect(orphan.next).toBeUndefined();
    expect(await balance(3)).toBe(2);
    await w.h.rows(`DELETE FROM ledger_kit_postings WHERE source_row = '${String(b)}' AND posting = 'tally'`);
    expect(await one('tallies', 'tally')).toMatchObject({ unplanned: 0 });
  });

  it.skipIf(!available)('saving every rule of the connection at once leaves the rules that hand rows to a ledger exactly as stored', async () => {
    expect((await api('PUT', rule('app_rows', 'mine'), TALLY)).statusCode).toBe(200);
    expect((await api('PATCH', `${rule('app_rows', 'shipped')}/switch`, { enabled: false })).statusCode).toBe(200);
    const ledgerRows = async () =>
      (await overridesRepo(w.h.meta).listForConnection(w.h.connectionId))
        .filter((row) => row.tableName === id('app_rows') && row.op.startsWith('table.'))
        .map((row) => `${row.op}:${row.origin}:${row.status}:${JSON.stringify(row.value)}`)
        .sort();
    const before = await ledgerRows();
    expect(before).toHaveLength(3);
    // What Studio's editor sends: the stored rows, one a rule's name — so one of the table's two posting rows — and a label it changed.
    const stored = ((await api('GET', `/connections/${w.h.connectionId}/overrides`)).json() as { overrides: { op: string; tableName: string; columnName: string | null; value: Doc; status: string }[] }).overrides;
    const byName = new Map(stored.map((row) => [`${row.op}::${row.tableName}::${row.columnName ?? ''}`, row]));
    const document = [...byName.values()].map((row) => ({ op: row.op, tableName: row.tableName, ...(row.columnName === null ? {} : { columnName: row.columnName }), value: row.value }));
    const saved = await api('PUT', `/connections/${w.h.connectionId}/overrides`, { overrides: [...document, { op: 'column.label', tableName: id('app_rows'), columnName: 'qty', value: { label: 'Quantity' } }] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await ledgerRows()).toEqual(before);
    // Nor does a document that leaves them out, or spells one differently, take one away or change it.
    const without = await api('PUT', `/connections/${w.h.connectionId}/overrides`, { overrides: [...document.filter((row) => !row.op.startsWith('table.')), { op: 'table.postings', tableName: id('app_rows'), value: { postings: [{ id: 'sneaked', ...TALLY }] } }] });
    expect(without.statusCode, without.body).toBe(200);
    expect(await ledgerRows()).toEqual(before);
    expect(await one('app_rows', 'sneaked')).toBeUndefined();
    expect(await one('app_rows', 'shipped')).toMatchObject({ enabled: false });
    expect((await one('app_rows', 'shipped'))!['owner']).not.toBeNull();
    expect((await one('app_rows', 'mine'))!['owner']).toBeNull();
    expect((await api('PATCH', `${rule('app_rows', 'shipped')}/switch`, { enabled: true })).statusCode).toBe(200);
    expect((await api('DELETE', rule('app_rows', 'mine'))).statusCode).toBe(204);
  });

  it.skipIf(!available)('two changes of one table\'s rules made at the same moment: neither undoes the other — one may be asked to look again', async () => {
    expect((await api('PUT', rule('strays', 'first'), TALLY)).statusCode).toBe(200);
    // Changing what a stored rule reads asks the ledger first whether rows hold under it: while that is being read, a second rule is drawn.
    const wider = { ...TALLY, unlessSet: 'hold_until' };
    const [changed, added] = await Promise.all([api('PUT', rule('strays', 'first'), wider), api('PUT', rule('strays', 'second'), TALLY)]);
    for (const res of [changed, added]) {
      if (res.statusCode === 200) continue;
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toMatchObject({ code: 'CONFLICT', details: { retry: true } });
    }
    expect([changed.statusCode, added.statusCode]).toContain(200);
    // Whatever was answered "stored" is stored, as it was sent: the rule added is there, and the first is the one its own answer says.
    const there = (await listed()).postings.filter((entry) => entry['table'] === id('strays'));
    expect(there.map((entry) => String(entry['id'])).sort()).toEqual(added.statusCode === 200 ? ['first', 'second'] : ['first']);
    expect(there.find((entry) => entry['id'] === 'first')!['unlessSet']).toBe(changed.statusCode === 200 ? 'hold_until' : undefined);
    for (const entry of there) expect((await api('DELETE', rule('strays', String(entry['id'])))).statusCode).toBe(204);
  });

  it.skipIf(!available)('a rule that names what is not here cannot answer: it is listed so, a save that would fire it is refused, and nothing of it runs', async () => {
    // As a project's file brings one: stored without passing the sheet's own checks.
    const store = (postings: Doc[]) => overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.postings', tableName: id('strays'), columnName: null, value: { postings }, origin: 'user' } as never);
    const row = await store([{ id: 'odd', ...TALLY, map: { account: 'account_id', quantity: 'qty', colour: 'status' } }]);
    expect(await one('strays', 'odd')).toMatchObject({ state: 'unavailable', owner: null });
    const refused = await api('POST', data('strays'), { values: { account_id: 1, qty: '1', status: 'counted' } });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused)).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
    expect(await w.count('strays')).toBe(0);
    // A save that fires nothing of it goes through; and the rule put right runs.
    expect((await api('POST', data('strays'), { values: { account_id: 1, qty: '1', status: 'new' } })).statusCode).toBe(201);
    await overridesRepo(w.h.meta).delete(row.id);
    const right = await store([{ id: 'odd', ...TALLY }]);
    expect(await one('strays', 'odd')).toMatchObject({ state: 'live' });
    expect((await api('POST', data('strays'), { values: { account_id: 1, qty: '1', status: 'counted' } })).statusCode).toBe(201);
    await overridesRepo(w.h.meta).delete(right.id);
  });

  it.skipIf(!available)('a name an app\'s rule and the owner\'s share is the app\'s: one rule runs, and the owner\'s own is still theirs to take away', async () => {
    // As an update leaves it: the app's rule arrived under a name the owner had used.
    const twin = await overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.postings', tableName: id('app_rows'), columnName: null, value: { postings: [{ id: 'shipped', ...TALLY }] }, origin: 'user' } as never);
    const both = (await listed()).postings.filter((entry) => entry['table'] === id('app_rows') && entry['id'] === 'shipped');
    expect(both).toHaveLength(1);
    expect(both[0]!['owner']).not.toBeNull();
    const made = await api('POST', data('app_rows'), { values: { account_id: 1, qty: '1', status: 'counted' } });
    expect(made.statusCode, made.body).toBe(201);
    expect(await w.receiptsOf('shipped', (made.json() as { data: Doc }).data['id'])).toEqual(['post:1:planned:1']);
    expect((await api('DELETE', rule('app_rows', 'shipped'))).statusCode).toBe(204);
    expect((await overridesRepo(w.h.meta).findById(twin.id))).toBeNull();
    expect(await one('app_rows', 'shipped')).toMatchObject({ enabled: true });
    // With only the app's left, it is the app's again: not the owner's to remove.
    expect((await api('DELETE', rule('app_rows', 'shipped'))).statusCode).toBe(409);
  });

  it.skipIf(!available)('rows saved one by one each post in a save of their own: every row is answered, and one the ledger refuses does not stop the next', async () => {
    expect((await api('PUT', rule('strays', 'count'), TALLY)).statusCode).toBe(200);
    const made = async (account: number, qty: string) => ((await api('POST', data('strays'), { values: { account_id: account, qty, status: 'new' } })).json() as { data: Doc }).data['id'];
    const [a, b, c] = [await made(1, '1'), await made(2, '50'), await made(1, '2')];
    const before = await balance(1);
    const changed = await api('POST', data('strays', '/one-by-one'), { ids: [a, b, c], values: { status: 'counted' } });
    expect(changed.statusCode, changed.body).toBe(200);
    const told = changed.json() as { results: { id: unknown; ok: boolean; postings?: Doc[]; error?: { code: string; reason?: string; details?: Doc } }[]; done: number; notRun: number };
    expect(told.results.map((row) => [row.id, row.ok, row.error?.reason])).toEqual([[a, true, undefined], [b, false, 'out-of-stock'], [c, true, undefined]]);
    expect(told.results[0]!.postings).toMatchObject([{ ledger: 'units', state: 'ok' }]);
    expect(told.results[1]!.error).toMatchObject({ code: 'POSTING_REFUSED' });
    expect(told).toMatchObject({ done: 2, notRun: 0 });
    expect(changed.json()).not.toHaveProperty('undoToken');
    // Each row that went through has its own receipt and took its own amount; the refused one moved nothing.
    expect(await w.receiptsOf('count', a)).toEqual(['post:1:planned:1']);
    expect(await w.receiptsOf('count', b)).toEqual([]);
    expect(await w.receiptsOf('count', c)).toEqual(['post:1:planned:1']);
    expect(await balance(1)).toBe(before - 3);
    expect((await w.h.rows(`SELECT status FROM strays WHERE id = ${String(b)}`))[0]).toMatchObject({ status: 'new' });
    // New rows the same way: each its own save, answered with the row it made.
    const created = await api('POST', data('strays', '/one-by-one'), { creates: [{ account_id: 1, qty: '1', status: 'counted' }, { account_id: 2, qty: '50', status: 'counted' }, { account_id: 1, qty: '1', status: 'new' }] });
    expect(created.statusCode, created.body).toBe(200);
    const rows = (created.json() as typeof told).results as ({ index?: number; data?: Doc } & (typeof told)['results'][number])[];
    expect(rows.map((row) => [row.index, row.ok, row.error?.reason, row.postings?.length ?? 0])).toEqual([[0, true, undefined, 1], [1, false, 'out-of-stock', 0], [2, true, undefined, 0]]);
    expect(await balance(1)).toBe(before - 4);
    // The same change as a bulk edit is refused whole, by name: that is what sends a list page here.
    const bulk = await api('POST', data('strays', '/bulk'), { action: 'update', ids: [rows[2]!.data!['id']], values: { status: 'counted' } });
    expect(bulk.statusCode, bulk.body).toBe(409);
    expect(errorOf(bulk)).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'one-at-a-time' } });
  });

  it.skipIf(!available)('what is left, and of what, is told to somebody who may read the ledger\'s rows — and to nobody else, in a refusal or in a quote', async () => {
    expect((await api('PUT', rule('asks', 'ask'), ASK)).statusCode).toBe(200);
    const values = { account_id: 2, qty: '50', status: 'sent' };
    for (const [who, tells] of [['desk', true], ['clerk', false]] as const) {
      const refused = await api('POST', data('asks'), { values }, who);
      expect(refused.statusCode, refused.body).toBe(409);
      const error = errorOf(refused);
      expect(error, who).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', posting: 'ask' } });
      expect(error.details!['left'], who).toBe(tells ? '3.000' : undefined);
      expect(error.details!['item'], who).toBe(tells ? 'Sugar' : undefined);
      expect(refused.body.includes('Sugar'), who).toBe(tells);

      const quoted = await api('POST', data('asks', '/dry-run'), { values }, who);
      expect(quoted.statusCode, quoted.body).toBe(200);
      const [answer] = (quoted.json() as { postings: Doc[] }).postings;
      expect(answer, who).toMatchObject({ ledger: 'units', state: 'refused', reason: 'out-of-stock' });
      expect(answer!['left'], who).toBe(tells ? '3.000' : undefined);
      expect(answer!['item'], who).toBe(tells ? 'Sugar' : undefined);
    }
    expect((await api('DELETE', rule('asks', 'ask'))).statusCode).toBe(204);
  });
});
