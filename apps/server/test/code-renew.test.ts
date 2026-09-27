// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE MADE AGAIN WHEN ITS ROW CHANGES HANDS — on every engine this run can
 * reach, through an app installed by the real installer and the whole server.
 *
 * A pass sent to somebody else (its holder's address changed) gets a new code
 * in the same statement, so the old one finds nothing from the commit on; a
 * name corrected, or the same address sent again, keeps it. A ticket handed on
 * renews when the friend accepts it — the person it belongs to changes — and
 * never when an offer lapses back to the sender, and when the holder changes
 * by a stamp of the same write (the address copied in as an offer is taken).
 * History (an import) never renews; an undo of a hand-over puts the holder
 * back with a code neither person had; and the person who sent a row away is
 * not handed the new code in the reply.
 */
import { validateManifest } from '@adminium/manifest';
import { permissionsRepo, publicKeysRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../src/errors.js';
import { isUniqueViolation } from '../src/crud/decided-columns.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { ORIGIN, servePublic, type Served } from './public-lane.helpers.js';

// The next codes a renewal makes, when a test needs them to collide.
const forced = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock('../src/crud/decided-columns.js', async (original) => {
  const real = await original<typeof import('../src/crud/decided-columns.js')>();
  return { ...real, generateCode: (prefix: string, length: number) => forced.codes.shift() ?? real.generateCode(prefix, length) };
});

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'customers', columns: [id, text('name'), { ...text('email', 254), rules: { normalize: 'email' } }] },
      // A family's bundle of passes, changed in one form with its passes.
      { ref: 'bundles', columns: [id, text('name')] },
      {
        ref: 'passes',
        columns: [
          id,
          { ref: 'bundle_id', type: 'fk', references: 'bundles', nullable: true },
          text('holder_name'),
          { ...text('holder_email', 254), rules: { normalize: 'email' } },
          { ref: 'status', type: 'enum', enum: ['active', 'reissued', 'void'], default: 'active' },
          { ...text('code', 12), rules: { code: { length: 10, renew: { on: { column: 'holder_email', changed: true } } } } },
          { ...text('link_token', 16), rules: { code: { length: 16, renew: { on: { column: 'holder_email', changed: true } } } } },
          { ...text('ref', 8), rules: { code: { prefix: 'R-', length: 6, renew: { on: { column: 'status', values: ['reissued'] } } } } },
        ],
      },
      {
        // A badge handed on by its holder: the new holder's address is copied in when the offer is taken.
        ref: 'badges',
        columns: [
          id,
          { ref: 'offer', type: 'enum', enum: ['none', 'made', 'taken'], default: 'none' },
          { ...text('pending_email', 254), rules: { normalize: 'email' } },
          { ...text('holder_email', 254), rules: { stamp: { set: { copy: 'pending_email' }, on: { column: 'offer', values: ['taken'] } } } },
          { ...text('code', 12), rules: { code: { length: 10, renew: { on: { column: 'holder_email', changed: true } } } } },
        ],
      },
      {
        ref: 'tickets',
        columns: [
          id,
          { ref: 'status', type: 'enum', enum: ['valid', 'offered', 'checked_in'], default: 'valid' },
          { ...text('code', 12), rules: { code: { length: 12, renew: { on: { column: 'holder_customer_id', changed: true } } } } },
          { ...text('pending_email', 254), rules: { normalize: 'email' } },
          text('pending_name'),
          { ref: 'holder_customer_id', type: 'fk', references: 'customers', nullable: true },
          { ...text('holder_email', 254), rules: { stamp: { set: { copy: 'pending_email' }, on: { columns: ['holder_customer_id'] } } } },
          { ...text('holder_name'), rules: { stamp: { set: { copy: 'pending_name' }, on: { columns: ['holder_customer_id'] } } } },
        ],
        // Kept as it is once issued, but for handing it on: the new code is the rule's own, never a person's change.
        states: {
          column: 'status',
          initial: 'valid',
          strict: true,
          moves: { valid: ['offered', 'checked_in'], offered: ['valid', 'checked_in'] },
          lock: { when: ['valid', 'offered', 'checked_in'], except: ['pending_email', 'pending_name', 'holder_customer_id'] },
        },
      },
    ]),
    publicKeys: { holder: {} },
    publicAccess: [
      { table: 'passes', methods: ['GET'], select: ['id', 'holder_name', 'code'], claim: { by: 'token', column: 'link_token' }, key: 'holder' },
    ],
  };
}

it('is a manifest the validator takes', () => {
  const parsed = validateManifest(manifest());
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
});

describe.each(LEGS)('a code renewed when its row changes hands — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let w: Awaited<ReturnType<typeof writerFor>>;
  let served: Served;
  let cookie: string;
  let ip = 0;
  const from = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const row = async (ref: string, key: number) => (await h.rows(`select * from ${h.real(ref)} where id = ${key}`))[0]!;
  const tableId = (ref: string) => w.targetOf(ref).table.id;
  const url = (ref: string, rest = '') => `/api/v1/data/${h.connectionId}/${encodeURIComponent(tableId(ref))}${rest}`;
  const staff = (method: 'PATCH' | 'POST' | 'GET' | 'PUT', path: string, payload?: unknown, as = cookie) =>
    served.composed.app.inject({ method, url: path, headers: { cookie: as }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const login = async (email: string) =>
    sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: ADMIN_PASSWORD } })).headers['set-cookie']);
  let next = 0;
  const pass = async (email = 'mia@example.com') => {
    next += 1;
    const made = await w.create('passes', { holder_name: `Holder ${next}`, holder_email: email });
    return Number(made['id']);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    w = await writerFor(h);
    const keys = await publicKeysRepo(h.meta).listManagedBy('studio');
    served = await servePublic(h, keys.find((key) => key.purpose === 'holder')?.id ?? JSON.stringify(keys.map((key) => key.purpose)));
    const desk = await usersRepo(h.meta).create({ email: 'desk@studio.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    cookie = await login('desk@studio.dev');
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('writes a new code with the change of holder, and the old code finds nothing', async () => {
    const key = await pass();
    const was = await row('passes', key);
    expect(String(was['code'])).toMatch(/^[0-9A-Z]{10}$/);
    const out = await w.update('passes', key, { holder_email: 'kai@example.com', holder_name: 'Kai Renner' });
    expect(out.count).toBe(1);
    const now = await row('passes', key);
    expect(now['holder_email']).toBe('kai@example.com');
    expect(String(now['code'])).toMatch(/^[0-9A-Z]{10}$/);
    expect(now['code']).not.toBe(was['code']);
    // Every code the change renews, and none it does not.
    expect(now['link_token']).not.toBe(was['link_token']);
    expect(now['ref']).toBe(was['ref']);
    // The reply's values carry the new code (written by the one statement).
    expect(out.values['code']).toBe(now['code']);
    expect(await h.rows(`select id from ${h.real('passes')} where code = '${String(was['code'])}'`)).toEqual([]);
  });

  it.skipIf(!available)('keeps the code when only the name changes, or the same address is sent again in another spelling', async () => {
    const key = await pass('mia@example.com');
    const was = await row('passes', key);
    await w.update('passes', key, { holder_name: 'Mia Okada-Reyes' });
    await w.update('passes', key, { holder_email: '  MIA@Example.com ' });
    const now = await row('passes', key);
    expect(now['holder_name']).toBe('Mia Okada-Reyes');
    expect(now['code']).toBe(was['code']);
    expect(now['link_token']).toBe(was['link_token']);
  });

  it.skipIf(!available)('renews on a move to a listed value, keeping the prefix, and not on any other move', async () => {
    const key = await pass();
    const was = await row('passes', key);
    expect(String(was['ref'])).toMatch(/^R-[0-9A-Z]{6}$/);
    await w.update('passes', key, { status: 'void' });
    expect((await row('passes', key))['ref']).toBe(was['ref']);
    await w.update('passes', key, { status: 'reissued' });
    const reissued = await row('passes', key);
    expect(String(reissued['ref'])).toMatch(/^R-[0-9A-Z]{6}$/);
    expect(reissued['ref']).not.toBe(was['ref']);
    expect(reissued['code']).toBe(was['code']);
    // Sent again as it is: no move, no new code.
    await w.update('passes', key, { status: 'reissued' });
    expect((await row('passes', key))['ref']).toBe(reissued['ref']);
  });

  it.skipIf(!available)('never renews over history: an import keeps its own code, or the stored one', async () => {
    const key = await pass();
    const was = await row('passes', key);
    const importing = { ...w.desk, origin: 'import' as const };
    await w.update('passes', key, { holder_email: 'ivo@example.com' }, importing);
    expect((await row('passes', key))['code']).toBe(was['code']);
    await w.update('passes', key, { holder_email: 'ana@example.com', code: 'IMPORTED01' }, importing);
    expect((await row('passes', key))['code']).toBe('IMPORTED01');
    // An undo puts back what was, and makes nothing.
    await w.update('passes', key, { holder_email: 'mia@example.com' }, { ...w.desk, origin: 'undo' });
    expect((await row('passes', key))['code']).toBe('IMPORTED01');
    // A writer whose code is taken (the server's own new link) says what it is: one new code, not two.
    await w.update('passes', key, { holder_email: 'ola@example.com', code: 'ACTIONCODE' }, { ...w.desk, origin: 'action' });
    const acted = await row('passes', key);
    expect(acted['code']).toBe('ACTIONCODE');
    expect(acted['link_token']).not.toBe(was['link_token']);
  });

  it.skipIf(!available)('renews a handed-on ticket when the friend accepts it, and never when the offer lapses', async () => {
    const mia = Number((await w.create('customers', { name: 'Mia', email: 'mia@example.com' }))['id']);
    const kai = Number((await w.create('customers', { name: 'Kai', email: 'kai@example.com' }))['id']);
    const ticket = Number((await w.create('tickets', { holder_customer_id: mia, holder_email: 'mia@example.com' }))['id']);
    const first = String((await row('tickets', ticket))['code']);
    // Offered: the old code still works while the friend has not said yes.
    await w.update('tickets', ticket, { status: 'offered', pending_email: 'kai@example.com', pending_name: 'Kai Renner' });
    expect((await row('tickets', ticket))['code']).toBe(first);
    // Accepted: the friend's, with a code the sender never saw.
    await w.update('tickets', ticket, { status: 'valid', holder_customer_id: kai });
    const accepted = await row('tickets', ticket);
    expect(Number(accepted['holder_customer_id'])).toBe(kai);
    expect(accepted['holder_email']).toBe('kai@example.com');
    expect(accepted['holder_name']).toBe('Kai Renner');
    expect(String(accepted['code'])).toMatch(/^[0-9A-Z]{12}$/);
    expect(accepted['code']).not.toBe(first);

    // Offered again, and lapsed back (the same move, no new holder): the code stays.
    const other = Number((await w.create('tickets', { holder_customer_id: mia }))['id']);
    const kept = String((await row('tickets', other))['code']);
    await w.update('tickets', other, { status: 'offered', pending_email: 'kai@example.com' });
    await w.update('tickets', other, { status: 'valid' }, { ...w.desk, origin: 'automation' });
    const lapsed = await row('tickets', other);
    expect(lapsed['status']).toBe('valid');
    expect(Number(lapsed['holder_customer_id'])).toBe(mia);
    expect(lapsed['code']).toBe(kept);
  });

  it.skipIf(!available)('makes the code again when the new one is taken, also inside a transaction', async () => {
    const taken = String((await row('passes', await pass()))['code']);
    const key = await pass();
    const was = await row('passes', key);
    // Twice the code another pass holds, then a fresh one.
    forced.codes.push(taken, taken);
    await w.update('passes', key, { holder_email: 'col@example.com' });
    expect(forced.codes).toEqual([]);
    const now = await row('passes', key);
    expect(now['code']).not.toBe(taken);
    expect(now['code']).not.toBe(was['code']);
    // Inside the write's own transaction (a check run inside it): a savepoint on Postgres keeps it usable.
    forced.codes.push(taken, taken);
    const out = await w.writes.update({
      target: w.targetOf('passes'),
      pk: { id: key },
      values: { holder_email: 'dee@example.com' },
      context: w.desk,
      inside: async () => {},
      announce: async () => {},
    });
    expect(out.count).toBe(1);
    expect(forced.codes).toEqual([]);
    expect((await row('passes', key))['code']).not.toBe(taken);
    // Taken every time: refused as the unique index refuses it, nothing written.
    forced.codes.push(...Array.from({ length: 12 }, () => taken));
    const refused = await w.update('passes', key, { holder_email: 'eve@example.com' }).catch((error: unknown) => error);
    forced.codes.length = 0;
    expect(isUniqueViolation(refused)).toBe(true);
    expect((await row('passes', key))['holder_email']).toBe('dee@example.com');
  });

  it.skipIf(!available)('refuses the change, naming the code, when the role may not write it', async () => {
    const key = await pass();
    const was = await row('passes', key);
    const rights = { insert: true, update: true, delete: true, columns: { code: { insert: true, update: false } } };
    const refused = await w.writes
      .update({ target: { ...w.targetOf('passes'), rights }, pk: { id: key }, values: { holder_email: 'fay@example.com' }, context: w.desk, announce: async () => {} })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ForbiddenError);
    expect(refused).toMatchObject({ code: 'READ_ONLY_MODE', details: { columns: ['code'] } });
    expect(await row('passes', key)).toEqual(was);
    // A change that renews nothing is not held to it.
    await w.writes.update({ target: { ...w.targetOf('passes'), rights }, pk: { id: key }, values: { holder_name: 'Fay' }, context: w.desk, announce: async () => {} });
    expect((await row('passes', key))['holder_name']).toBe('Fay');
  });

  it.skipIf(!available)('renews when the change of holder is a stamp of the same write: the address copied in as the offer is taken', async () => {
    const badge = Number((await w.create('badges', { holder_email: 'mia@example.com' }))['id']);
    const first = String((await row('badges', badge))['code']);
    await w.update('badges', badge, { offer: 'made', pending_email: 'kai@example.com' });
    expect((await row('badges', badge))['code']).toBe(first);
    // Taken: only the offer is sent; the stamp copies the address in, and that change renews the code.
    await w.update('badges', badge, { offer: 'taken' });
    const taken = await row('badges', badge);
    expect(taken['holder_email']).toBe('kai@example.com');
    expect(String(taken['code'])).toMatch(/^[0-9A-Z]{10}$/);
    expect(taken['code']).not.toBe(first);
  });

  it.skipIf(!available)('is shown to the desk that changed it, and an undo puts the holder back with a code neither of them had', async () => {
    const key = await pass();
    const was = await row('passes', key);
    const patched = await staff('PATCH', url('passes', `/${key}`), { values: { holder_email: 'gus@example.com' } });
    expect(patched.statusCode, patched.body).toBe(200);
    const body = patched.json() as { data: Record<string, unknown>; undoToken: string | null };
    const now = await row('passes', key);
    expect(now['code']).not.toBe(was['code']);
    expect(body.data['code']).toBe(now['code']);
    expect(body.undoToken).not.toBeNull();
    const undone = await staff('POST', `/api/v1/data/undo/${body.undoToken!}`);
    expect(undone.statusCode, undone.body).toBe(200);
    const back = await row('passes', key);
    expect(back['holder_email']).toBe('mia@example.com');
    // Neither the old code (dead since the change) nor the one handed on (no longer that person's) works after it.
    for (const column of ['code', 'link_token']) {
      expect(back[column], column).not.toBe(now[column]);
      expect(back[column], column).not.toBe(was[column]);
      expect(String(back[column])).toMatch(/^[0-9A-Z]+$/);
    }
    // The code handed on finds nothing now.
    expect(await h.rows(`select id from ${h.real('passes')} where code = '${String(now['code'])}'`)).toEqual([]);
  });

  it.skipIf(!available)('renews a pass handed on in its bundle’s form, and an undo of the form gives it a code neither holder had', async () => {
    const bundle = Number((await w.create('bundles', { name: 'Okada family' }))['id']);
    const key = Number((await w.create('passes', { bundle_id: bundle, holder_name: 'Mia', holder_email: 'mia@example.com' }))['id']);
    const was = await row('passes', key);
    const relation = w.view.model.relations.find((r) => r.from.tableId === tableId('passes') && r.from.columns[0] === 'bundle_id')!;
    const saved = await staff('PATCH', url('bundles', `/${bundle}`), { values: { name: 'Okada family' }, children: { [relation.id]: [{ key: { id: key }, values: { holder_email: 'zed@example.com' } }] } });
    expect(saved.statusCode, saved.body).toBe(200);
    const now = await row('passes', key);
    expect(now['code']).not.toBe(was['code']);
    const token = (saved.json() as { undoToken: string | null }).undoToken;
    expect(token).not.toBeNull();
    const undone = await staff('POST', `/api/v1/data/undo/${token!}`);
    expect(undone.statusCode, undone.body).toBe(200);
    const back = await row('passes', key);
    expect(back['holder_email']).toBe('mia@example.com');
    for (const column of ['code', 'link_token']) {
      expect(back[column], column).not.toBe(now[column]);
      expect(back[column], column).not.toBe(was[column]);
    }
  });

  it.skipIf(!available)('gives a document with states no undo, and says in the audit log only that a new code was made', async () => {
    const customer = Number((await w.create('customers', { name: 'Hal' }))['id']);
    const ticket = Number((await w.create('tickets', {}))['id']);
    const was = String((await row('tickets', ticket))['code']);
    const patched = await staff('PATCH', url('tickets', `/${ticket}`), { values: { holder_customer_id: customer } });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as { undoToken: string | null }).undoToken).toBeNull();
    const code = String((await row('tickets', ticket))['code']);
    expect(code).not.toBe(was);
    const audit = await staff('GET', `/api/v1/audit?entityTable=${encodeURIComponent(tableId('tickets'))}&limit=20`);
    expect(audit.statusCode, audit.body).toBe(200);
    expect(audit.body).not.toContain(code);
    expect(audit.body).not.toContain(was);
    const entries = (audit.json() as { entries: { changes: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } | null }[] }).entries;
    expect(entries[0]!.changes).toMatchObject({ before: { code: '[code]' }, after: { code: '[new code]' } });
  });

  it.skipIf(!available)('is not handed to a caller who may change the table but not read it', async () => {
    const changer = await rolesRepo(h.meta).create({ slug: 'changer', name: 'Changer' });
    await permissionsRepo(h.meta).grant(changer.id, 'table', `${h.connectionId}/${tableId('passes')}`, { read: false, create: false, update: true, delete: false, export: false, import: false, read_pii: false } as never);
    const person = await usersRepo(h.meta).create({ email: 'changer@studio.dev', name: 'Changer', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(person.id, changer.id);
    const theirs = await login('changer@studio.dev');
    const key = await pass();
    const patched = await staff('PATCH', url('passes', `/${key}`), { values: { holder_email: 'ida@example.com' } }, theirs);
    expect(patched.statusCode, patched.body).toBe(200);
    const now = await row('passes', key);
    expect(patched.body).not.toContain(String(now['code']));
    expect(patched.body).not.toContain(String(now['link_token']));
  });

  it.skipIf(!available)('gives each row of a bulk change its own new code', async () => {
    const keys = [await pass(), await pass(), await pass()];
    const before = await Promise.all(keys.map((key) => row('passes', key)));
    const bulk = await staff('POST', url('passes', '/bulk'), { action: 'update', ids: keys.map(String), values: { holder_email: 'box@example.com' } });
    expect(bulk.statusCode, bulk.body).toBe(200);
    const after = await Promise.all(keys.map((key) => row('passes', key)));
    const codes = after.map((r) => r['code']);
    expect(new Set(codes).size).toBe(3);
    for (const [i, r] of after.entries()) expect(r['code']).not.toBe(before[i]!['code']);
  });

  it.skipIf(!available)('keeps the new code from the guest who handed the row on, and their open link stops working', async () => {
    const key = await pass();
    const token = String((await row('passes', key))['link_token']);
    const opened = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', remoteAddress: from(), headers: served.headers(), payload: { token } });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    const claimed = `${h.real('passes')}_claimed`;
    const read = await served.get(`/records/${claimed}`, session);
    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as { data: { id: number }[] }).data.map((r) => Number(r.id))).toEqual([key]);

    // A page that changes a pass's holder, showing its code.
    const saved = await staff('PUT', `/api/v1/public-endpoints/${h.connectionId}/passes_sent`, {
      definition: JSON.stringify({
        path: '/passes_sent',
        source: tableId('passes'),
        methods: ['PATCH'],
        select: ['id', 'holder_name', 'code'],
        writable: ['holder_name', 'holder_email'],
        pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 120, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
      }),
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const made = await staff('POST', '/api/v1/public-keys', { name: 'Sender', connectionId: h.connectionId, access: [{ ref: 'passes_sent', methods: ['PATCH'] }] });
    expect(made.statusCode, made.body).toBe(201);
    const sent = await served.composed.app.inject({
      method: 'PATCH',
      url: `/api/v1/public/records/passes_sent/${key}`,
      remoteAddress: from(),
      headers: { authorization: `Bearer ${(made.json() as { token: string }).token}`, origin: ORIGIN },
      payload: { values: { holder_email: 'jo@example.com', holder_name: 'Jo' } },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const now = await row('passes', key);
    expect(now['holder_email']).toBe('jo@example.com');
    expect(now['link_token']).not.toBe(token);
    const data = (sent.json() as { data: Record<string, unknown> }).data;
    expect(data['holder_name']).toBe('Jo');
    expect(data).not.toHaveProperty('code');
    expect(sent.body).not.toContain(String(now['code']));
    // A change that renews nothing still shows the code the page names.
    const named = await served.composed.app.inject({
      method: 'PATCH',
      url: `/api/v1/public/records/passes_sent/${key}`,
      remoteAddress: from(),
      headers: { authorization: `Bearer ${(made.json() as { token: string }).token}`, origin: ORIGIN },
      payload: { values: { holder_name: 'Jo Park' } },
    });
    expect((named.json() as { data: Record<string, unknown> }).data['code']).toBe(now['code']);
    // The link the old holder's page was opened by is no longer the row's: its session opens nothing.
    const again = await served.get(`/records/${claimed}`, session);
    expect(again.statusCode === 200 ? (again.json() as { data: unknown[] }).data : []).toEqual([]);
    expect(again.body).not.toContain(String(now['code']));
  });
});
