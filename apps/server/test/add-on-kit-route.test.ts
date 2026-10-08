// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ADD-ON'S OWN PAGE MAY READ AND WRITE.
 *
 * A page built on the data kit asks once where its add-on's tables are and
 * what the signed-in reader may do there. The answer is theirs alone: the
 * grants they hold on each table, the columns their role does not read, the
 * moves their roles may make — never one only a posting makes — and the
 * actions they are offered. And the tables of the owner's own database that
 * hand rows to the add-on.
 */
import { overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DESK } from '../../../packages/manifest/test/desk-fixture.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely
type Kit = { connectionId: string; tables: Record<string, Doc>; hosts: Doc[]; has: Record<string, boolean>; currency: string | null };

/** The desk kit, with a move kept for its manager and that role declared. */
function deskKit(): Doc {
  const doc = structuredClone(DESK) as Doc;
  doc.requiredSchema.tables[0].states.moves = { draft: ['active'], active: [{ to: 'closed', roles: ['manager'] }, { to: 'spent', planned: true }] };
  doc.roles = [{ key: 'manager', name: 'Desk manager', permissions: [] }];
  return doc;
}

async function signIn(served: Served, meta: Harness['meta'], name: string, cookies: Map<string, string>): Promise<string> {
  const user = await usersRepo(meta).create({ email: `${name}@kit.dev`, name, passwordHash: await adminPasswordHash() });
  const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.2.0.${String(cookies.size + 1)}`, payload: { email: `${name}@kit.dev`, password: ADMIN_PASSWORD } });
  cookies.set(name, sessionCookie(login.headers['set-cookie']));
  return user.id;
}

describe.each(LEGS)('what an add-on page may read and write — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const kit = (as = 'boss', key = 'desk') => served.composed.app.inject({ method: 'GET', url: `/api/v1/add-ons/${key}/kit`, headers: as === '' ? {} : { cookie: cookies.get(as)! } });
  const read = async (as = 'boss') => {
    const res = await kit(as);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Kit;
  };

  async function person(name: string, grants: 'super-admin' | Record<string, Doc>, more: readonly string[] = []): Promise<void> {
    const id = await signIn(served, h.meta, name, cookies);
    const roles = rolesRepo(h.meta);
    if (grants === 'super-admin') {
      await roles.assignToUser(id, (await roles.findBySlug('super-admin'))!.id);
      return;
    }
    const role = await roles.create({ slug: `${name}-role`, name } as never);
    for (const [ref, actions] of Object.entries(grants)) {
      await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${ids.get(ref)!}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    }
    await roles.assignToUser(id, role.id);
    for (const slug of more) await roles.assignToUser(id, (await roles.findBySlug(slug))!.id);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(deskKit(), { bundled: true, files: { 'pages/look-up.js': 'export default function Page() { return null; }' } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'desk', version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).where('appKey', '=', 'desk').execute()) {
      ids.set(row.ref, model.tables.find((table) => table.name === row.tableName)!.id);
    }
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    await person('boss', 'super-admin');
    // A clerk reads cards without their balance, may change them, and may not make one; the keeper holds the manager's role too.
    const cards = { read: true, update: true, readLimit: { readable: ['id', 'status', 'kind', 'label', 'note', 'recipient_email', 'activated_at', 'resent_at', 'resends'] } };
    await person('clerk', { cards });
    await person('keeper', { cards: { read: true, update: true }, card_actions: { read: true, create: true } }, ['desk-manager']);
    await person('nobody', {});
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('names the add-on\'s tables by its own short names, each where it really is, for somebody who may do everything', async () => {
    const answer = await read();
    expect(answer.connectionId).toBe(h.connectionId);
    expect(Object.keys(answer.tables).sort()).toEqual(['card_actions', 'cards', 'words']);
    expect(answer.tables['cards']).toMatchObject({ id: ids.get('cards'), can: { read: true, create: true, update: true, delete: true } });
    // A code no desk hands out is read by nobody, Super Admin too.
    expect(answer.tables['cards']!['unreadable']).toEqual(['pin']);
    expect(answer.tables['words']).toEqual({ id: ids.get('words'), can: { read: true, create: true, update: true, delete: true }, unreadable: [] });
    expect(answer.has).toEqual({ 'system:schema:remap': true, 'page:desk-look-up:view': true });
    expect(answer.hosts).toEqual([]);
  });

  it.skipIf(!available)('the clerk\'s answer hides the balance and offers no create on cards', async () => {
    const answer = await read('clerk');
    expect(answer.tables['cards']!['can']).toEqual({ read: true, create: false, update: true, delete: false });
    expect([...(answer.tables['cards']!['unreadable'] as string[])].sort()).toEqual(['balance', 'code', 'owner_email', 'pin']);
    // A table they hold nothing on is still named — the page asks before it shows — with nothing granted.
    expect(answer.tables['words']!['can']).toEqual({ read: false, create: false, update: false, delete: false });
    expect(answer.has).toEqual({ 'system:schema:remap': false, 'page:desk-look-up:view': false });
  });

  it.skipIf(!available)('moves list only what this role may make, and never a move only a posting makes', async () => {
    const all = (await read()).tables['cards']!['states'];
    expect(all.column).toBe('status');
    // Spent is the ledger's own: not even Super Admin is offered it.
    expect(all.moves).toEqual({ draft: ['active'], active: ['closed'] });
    expect((await read('clerk')).tables['cards']!['states'].moves).toEqual({ draft: ['active'], active: [] });
    expect((await read('keeper')).tables['cards']!['states'].moves).toEqual({ draft: ['active'], active: ['closed'] });
    expect((await read()).tables['words']).not.toHaveProperty('states');
  });

  it.skipIf(!available)('lists the actions this caller may take, as the page reply does: an id, a kind and the states — never a target, never what one writes', async () => {
    const actions = (who: Kit) => who.tables['cards']!['states'].actions as { id: string; kind: string; from: string[] }[];
    const boss = actions(await read());
    expect(boss).toEqual([
      { id: 'activate', kind: 'move', from: ['draft'] },
      { id: 'send-again', kind: 'set', from: ['active'] },
      { id: 'find', kind: 'link', from: ['active', 'closed'] },
      { id: 'top-up', kind: 'child', from: ['active'] },
    ]);
    for (const action of boss) expect(Object.keys(action).sort()).toEqual(['from', 'id', 'kind']);
    // The clerk may not create an action row, nor open the add-on's page; the keeper may make the row.
    expect(actions(await read('clerk')).map((action) => action.id)).toEqual(['activate', 'send-again']);
    expect(actions(await read('keeper')).map((action) => action.id)).toEqual(['activate', 'send-again', 'top-up']);
    // One function, two readers: the generated page of the same table is told the same ids and states.
    const page = await h.meta.db.selectFrom('adminium_pages').select('id').where('slug', '=', 'desk-cards').executeTakeFirstOrThrow();
    const reply = await served.composed.app.inject({ method: 'GET', url: `/api/v1/pages/${page.id}`, headers: { cookie: cookies.get('boss')! } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect((reply.json() as { stateActions: { id: string; kind: string; from: string[] }[] }).stateActions.map(({ id, kind, from }) => ({ id, kind, from }))).toEqual(boss);
  });

  it.skipIf(!available)('somebody signed in who holds nothing is told where the tables are and that nothing is theirs; nobody is told nothing', async () => {
    const answer = await read('nobody');
    for (const table of Object.values(answer.tables)) expect(table['can']).toEqual({ read: false, create: false, update: false, delete: false });
    expect((await kit('')).statusCode).toBe(401);
  });

  it.skipIf(!available)('a disabled add-on answers 404, as one that is not here does', async () => {
    expect((await kit('boss', 'no-such')).statusCode).toBe(404);
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'disabled' } as never).where('manifestKey', '=', 'desk').execute();
    const off = await kit();
    expect(off.statusCode, off.body).toBe(404);
    const said = (res: { json: () => unknown }) => { const { code, message } = (res.json() as { error: { code: string; message: string } }).error; return { code, message }; };
    expect(said(off)).toEqual(said(await kit('boss', 'no-such')));
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'installed' } as never).where('manifestKey', '=', 'desk').execute();
    expect((await kit()).statusCode).toBe(200);
  });

  it.skipIf(!available)('the list of add-ons says which need the data kit', async () => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons', headers: { cookie: cookies.get('boss')! } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { addOns: { key: string; hostApi: number }[] }).addOns.find((entry) => entry.key === 'desk')).toMatchObject({ hostApi: 1 });
  });
});

describe('the tables that hand an add-on rows', () => {
  let w: LedgerWorld;
  let served: Served;
  const cookies = new Map<string, string>();
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const USE = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['done'] } } };

  beforeAll(async () => {
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';
    // A table that posts into some other add-on is that one's host, not this one's.
    const elsewhere = { ...USE, id: 'stray', into: { addOn: 'elsewhere', ledger: 'units', action: 'use' } };
    w = await ledgerWorld('sqlite', { asks: { columns, postings: [USE] }, plain: { columns, postings: [] }, strays: { columns, postings: [elsewhere] } }, undefined, async (h, idOf) => {
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.label', tableName: idOf('asks'), columnName: null, value: { label: 'Requests' }, origin: 'user' } as never);
    });
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const id = await signIn(served, w.h.meta, 'boss', cookies);
    await rolesRepo(w.h.meta).assignToUser(id, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    await w?.close();
  });

  it('are the tables carrying a posting into it, by the name another manifest would use and in the reader\'s words', async () => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons/ledger-kit/kit', headers: { cookie: cookies.get('boss')! } });
    expect(res.statusCode, res.body).toBe(200);
    const answer = res.json() as Kit;
    expect(answer.hosts).toEqual([{ tableRef: w.target('asks').table.id, id: w.target('asks').table.id, label: 'Requests', via: 'posting' }]);
    // The currency of the database its tables are in: none set, then the owner's.
    expect(answer.currency).toBeNull();
    await w.h.meta.db.updateTable('adminium_connections').set({ currency: 'EUR' }).where('id', '=', answer.connectionId).execute();
    const again = await served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons/ledger-kit/kit', headers: { cookie: cookies.get('boss')! } });
    expect((again.json() as Kit).currency).toBe('EUR');
    // The add-on's own tables are its tables, not its hosts.
    expect(Object.keys(answer.tables)).toContain('accounts');
    expect(answer.hosts.map((host) => host['id'])).not.toContain(w.target('plain').table.id);
    expect(w.target('strays').table.table?.postings?.[0]?.into.addOn).toBe('elsewhere');
    expect(answer.hosts.map((host) => host['id'])).not.toContain(w.target('strays').table.id);
  });
});
