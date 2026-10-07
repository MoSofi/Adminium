// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE THAT CAME WITH AN ADD-ON IS SWITCHED OFF, NEVER DELETED.
 *
 * The rules list says what shipped a rule. Such a rule has the same switch
 * as any other, and may be changed — it is then the owner's, and said so.
 * It cannot be deleted (an update would bring it back): it is switched off,
 * or copied, and the copy is an ordinary rule.
 */
import { automationsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { servePublic, type Served } from './public-lane.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a reply read freely
type Doc = Record<string, any>;

const RULE = {
  key: 'evening',
  name: 'Evening tidy',
  enabled: false,
  trigger: { kind: 'schedule', schedule: { kind: 'daily', time: '17:00' }, forEach: { table: 'items', once: false, where: [{ left: { field: 'opening' }, op: 'gt', right: 0 }] } },
  graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'Every evening' }, { id: 'u', kind: 'action', title: 'Move it', action: { kind: 'record.update', values: { zone: 'cellar' } } }] },
};

describe('a rule that came with an add-on', () => {
  let h: Harness;
  let served: Served;
  let cookie = '';
  const api = (method: string, url: string, payload?: unknown) => served.composed.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const listed = async (): Promise<Doc[]> => {
    const res = await api('GET', `/automations?connectionId=${h.connectionId}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { rules: Doc[] }).rules;
  };

  beforeAll(async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    await h.stageAddOn({ ...stockKitManifest(), automations: [RULE] }, { files: { 'dist/client.js': 'export default function Count() { return null; }' } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const boss = await usersRepo(h.meta).create({ email: 'boss@rules.dev', name: 'Boss', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(boss.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'boss@rules.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  it('is listed with what shipped it; a rule somebody made here says nobody did', async () => {
    const [shipped] = await listed();
    expect(shipped).toMatchObject({ name: 'Evening tidy', enabled: false, managed: { key: 'stock-kit', name: 'Stock kit', kind: 'add-on', templateKey: 'evening', edited: false } });
    const one = await api('GET', `/automations/${String(shipped!['id'])}`);
    expect((one.json() as Doc)['managed']).toMatchObject({ key: 'stock-kit', edited: false });

    const own = await automationsRepo(h.meta).create({ connectionId: h.connectionId, name: 'Mine', trigger: shipped!['trigger'], graph: shipped!['graph'] });
    expect((await listed()).find((rule) => rule['id'] === own.id)!['managed']).toBeNull();
    await automationsRepo(h.meta).remove(own.id);
  });

  it('has the same switch as any rule, and the switch alone is no edit', async () => {
    const [shipped] = await listed();
    const on = await api('PATCH', `/automations/${String(shipped!['id'])}`, { enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toMatchObject({ enabled: true, managed: { edited: false } });
    expect((on.json() as Doc)['nextRunAt']).toEqual(expect.any(Number));
    const off = await api('PATCH', `/automations/${String(shipped!['id'])}`, { enabled: false });
    expect(off.json()).toMatchObject({ enabled: false, managed: { edited: false } });
  });

  it('cannot be deleted; a copy of it can, and is nobody\'s but the owner\'s', async () => {
    const [shipped] = await listed();
    const id = String(shipped!['id']);
    const refused = await api('DELETE', `/automations/${id}`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as Doc)['error']).toMatchObject({ code: 'AUTOMATION_MANAGED', details: { owner: 'Stock kit' } });
    expect(await automationsRepo(h.meta).findById(id)).not.toBeNull();

    const copied = await api('POST', `/automations/${id}/duplicate`);
    expect(copied.statusCode, copied.body).toBe(201);
    const copy = copied.json() as Doc;
    expect(copy).toMatchObject({ name: 'Evening tidy (copy)', enabled: false, managed: null });
    const gone = await api('DELETE', `/automations/${String(copy['id'])}`);
    expect(gone.statusCode, gone.body).toBe(200);
  });

  it('once changed it is the owner\'s, and says so — and still cannot be deleted', async () => {
    const [shipped] = await listed();
    const id = String(shipped!['id']);
    const renamed = await api('PATCH', `/automations/${id}`, { name: 'My evening tidy' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'My evening tidy', managed: { key: 'stock-kit', edited: true } });
    expect((await api('DELETE', `/automations/${id}`)).statusCode).toBe(409);
  });
});
