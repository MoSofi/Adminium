// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `sms.manage` on the whole server, on SQLite, Postgres and MySQL: as a role
 * that holds it, one that does not, the built-in Admin, the Super Admin and an
 * API key. No provider is connected and `fetch` is a trap, so no call can leave.
 */
import { apiKeysRepo, permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateApiKey } from '../src/rbac/api-keys.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.38' }));

function app(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Desk',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.desk.desc', fallback: 'A desk.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.38', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'desk', label: { 'en-US': 'Desk' }, order: 1 }],
    requiredSchema: { prefixed: true, tables: [{ ref: 'notes', keyField: 'title', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', maxLength: 80 }] }] },
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['table:@notes:read', 'page:@desk-notes:view'] }],
    pages: [{ ref: 'desk-notes', template: 'page-crud', title: { key: 't.notes', fallback: 'Notes' }, nav: { group: 'desk', icon: 'list', order: 1 }, bindings: { rows: 'notes' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

/** Each refused before anything is read, and none able to reach a provider with no account connected. */
const ROUTES: ['PUT' | 'POST' | 'DELETE', string, unknown][] = [
  ['PUT', '/api/v1/sms/account', { provider: 'twilio', accountSid: 'not-a-sid', authToken: 'not-a-token' }],
  ['PUT', '/api/v1/sms/sending', { sender: { kind: 'number', value: '+14155552671' }, defaultCountry: 'US' }],
  ['POST', '/api/v1/sms/check', undefined],
  ['POST', '/api/v1/sms/test', { to: '+14155552671' }],
  ['DELETE', '/api/v1/sms/account', undefined],
];

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`sms.manage on the whole server, on ${dialect}`, () => {
    let s: WholeServer;
    let bearer: Record<string, string> = {};
    const trap = vi.fn(async () => {
      throw new Error('no provider may be called here');
    });

    beforeAll(async () => {
      vi.stubGlobal('fetch', trap);
      s = await wholeServer(dialect, app(), { people: { gia: [], tom: ['clerk'], ann: [] } });
      const roles = rolesRepo(s.meta);
      const texts = await roles.create({ slug: 'texts', name: 'Texts' });
      await permissionsRepo(s.meta).grant(texts.id, 'system', 'sms.manage', { allowed: true });
      await roles.assignToUser(s.ids['gia']!, texts.id);
      await roles.assignToUser(s.ids['ann']!, (await roles.findBySlug('admin'))!.id);
      const generated = generateApiKey();
      await apiKeysRepo(s.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: texts.id });
      bearer = { authorization: `Bearer ${generated.key}` };
    }, 180_000);

    afterAll(async () => {
      await s?.close();
      vi.unstubAllGlobals();
    });

    it.each(['tom', 'ann'])('%s, who does not hold it, is refused every route', async (who) => {
      expect(said(await s.get(who, '/api/v1/sms/setup'))).toBe('403 FORBIDDEN');
      for (const [method, url, body] of ROUTES) expect(said(await s.send(who, method, url, body)), url).toBe('403 FORBIDDEN');
    });

    it.each(['gia', 'owner'])('%s, who holds it, reaches every route', async (who) => {
      const setup = await s.get(who, '/api/v1/sms/setup');
      expect(setup.statusCode, setup.body).toBe(200);
      expect((setup.json() as { data: { account: unknown } }).data.account).toBeNull();
      for (const [method, url, body] of ROUTES) expect(said(await s.send(who, method, url, body)), url).not.toMatch(/^40[13]/);
    });

    it('an API key holding the grant may read, and changes nothing', async () => {
      expect((await s.app.inject({ method: 'GET', url: '/api/v1/sms/setup', headers: bearer })).statusCode).toBe(200);
      for (const [method, url, body] of ROUTES) {
        const res = await s.app.inject({ method, url, headers: bearer, ...(body === undefined ? {} : { payload: body as never }) });
        expect(res.statusCode, url).toBe(403);
      }
    });

    it('called no provider', () => {
      expect(trap).not.toHaveBeenCalled();
    });
  });
}
