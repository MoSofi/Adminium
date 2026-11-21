// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When a key's hourly limit refuses a public create, the desk can see that it
 * happened: one mark a minute per table, none for one visitor's own limit, read
 * behind the table's read grant, and nothing for a reader held to their own rows.
 */
import { publicEndpointsRepo, publicKeysRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const START = Date.parse('2030-01-07T09:00:00.000Z');

const table = (ref: string) => ({
  ref,
  belongs: [{ column: 'user_id' }],
  indexes: [['user_id']],
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'name', type: 'text', maxLength: 40 },
    { ref: 'user_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
  ],
});

function manifest(): Record<string, unknown> {
  const open = (name: string, anonymous: Record<string, unknown>) => ({ table: name, methods: ['POST'], writable: ['name'], anonymous: { plainText: ['name'], ...anonymous } });
  return {
    // A private table puts a row context on every reader: the count must still reach one this table does not limit.
    ...invoicingManifest([table('requests'), table('notes'), table('visits'), { ...table('diary'), private: true }]),
    compatibility: { minAdminiumVersion: '0.3.71' },
    pages: [{ ref: 'studio-requests', template: 'page-crud', title: { key: 't', fallback: 'Requests' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'requests' } }],
    publicAccess: [open('requests', { perKeyHour: 1 }), open('notes', { perKeyHour: 1 }), open('visits', { perKeyHour: 1000, perIpHour: 1 })],
    roles: [
      { key: 'desk', name: 'Desk', permissions: ['app:@:staff', 'table:@requests:read', 'table:@notes:read', 'table:@visits:read'] },
      { key: 'own', name: 'Own', permissions: ['app:@:staff', 'table:@requests:read'], limits: { requests: { rows: { read: { reach: 'own' } } } } },
      { key: 'other', name: 'Other', permissions: ['app:@:staff', 'table:@notes:read'] },
    ],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the hourly limit's mark on ${dialect}`, () => {
    let h: InvoicingHarness;
    let served: Awaited<ReturnType<typeof servePublic>>;
    const tableId: Record<string, string> = {};
    const endpoint: Record<string, string> = {};
    const cookies: Record<string, string> = {};

    const create = (name: string, ip: string) =>
      served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${endpoint[name]!}`, headers: served.headers(), payload: { values: { name: 'Ada' } }, remoteAddress: ip });
    const read = (who: string, name: string) =>
      served.composed.app.inject({ method: 'GET', url: `/api/v1/data/${h.connectionId}/${tableId[name]!}/public-cap-reached`, headers: { cookie: cookies[who]! } });
    const lastHour = async (who: string, name: string) => {
      const reply = await read(who, name);
      expect(reply.statusCode, reply.body).toBe(200);
      return (reply.json() as { data: { lastHour: number } }).data.lastHour;
    };

    beforeAll(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(START);
      h = await installInvoicing(dialect, manifest());
      const [key] = await publicKeysRepo(h.meta).listManagedBy('studio');
      served = await servePublic(h, key!.id);
      const view = await loadSnapshotView(h.meta, h.connectionId);
      const refs = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((one) => one.ref);
      for (const name of ['requests', 'notes', 'visits']) {
        tableId[name] = view.model.tables.find((one) => one.name === h.real(name))!.id;
        endpoint[name] = refs.find((ref) => ref.endsWith(`_${name}`))!;
      }
      const hash = await adminPasswordHash();
      for (const [i, who] of ['desk', 'own', 'other'].entries()) {
        const user = await usersRepo(h.meta).create({ email: `${who}-${dialect}@studio.dev`, name: who, passwordHash: hash, status: 'active' });
        await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(`studio-${who}`))!.id);
        const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: ADMIN_PASSWORD }, remoteAddress: `198.51.100.${String(i + 1)}` });
        expect(login.statusCode, login.body).toBe(200);
        cookies[who] = sessionCookie(login.headers['set-cookie']);
      }
    });

    afterAll(async () => {
      vi.useRealTimers();
      await served?.close();
      await h?.close();
    });

    it('leaves no mark for one visitor over their own limit', async () => {
      expect((await create('visits', '203.0.113.7')).statusCode).toBeLessThan(300);
      expect((await create('visits', '203.0.113.7')).statusCode).toBe(409);
      expect(await lastHour('desk', 'visits')).toBe(0);
    });

    it('marks a full hour once a minute, for each table on its own', async () => {
      // The visit above took this key's one create of the hour for the capped tables.
      expect((await create('requests', '203.0.113.10')).statusCode).toBe(409);
      expect(await lastHour('desk', 'requests')).toBe(1);
      expect(await lastHour('desk', 'notes')).toBe(0);

      // A flood within the minute adds nothing.
      for (const n of [11, 12, 13]) expect((await create('requests', `203.0.113.${String(n)}`)).statusCode).toBe(409);
      expect(await lastHour('desk', 'requests')).toBe(1);

      // The other table keeps its own count.
      expect((await create('notes', '203.0.113.14')).statusCode).toBe(409);
      expect(await lastHour('desk', 'notes')).toBe(1);

      vi.setSystemTime(Date.now() + 61_000);
      expect((await create('requests', '203.0.113.15')).statusCode).toBe(409);
      expect(await lastHour('desk', 'requests')).toBe(2);
    });

    it('is behind the table read grant, and says nothing to a reader held to their own rows', async () => {
      expect(await lastHour('desk', 'requests')).toBeGreaterThan(0);
      expect((await read('other', 'requests')).statusCode).toBe(403);
      expect(await lastHour('own', 'requests')).toBe(0);
    });

    it('forgets a mark once the hour has passed', async () => {
      vi.setSystemTime(Date.now() + 3_600_001);
      expect(await lastHour('desk', 'requests')).toBe(0);
    });
  });
}
