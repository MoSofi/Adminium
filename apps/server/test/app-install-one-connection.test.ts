// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP RUNS ON ONE CONNECTION, on every engine this run can reach.
 *
 * Installing an installed app again on a second connection used to replace
 * its row and leave the first database behind — its tables, and its customer
 * key still serving them. Now the plan for another connection says the app
 * is not installable there, naming the connection it is on, and the install
 * refuses with 409 before it writes anything. Updating it where it is still
 * works, by the update route and by installing a newer version on the same
 * connection.
 */
import { manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(version: string): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Front Desk',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: { prefixed: true, tables: [{ ref: 'visitors', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] }] },
    pages: [
      { ref: 'desk-visitors', template: 'page-crud', title: { key: 'v', fallback: 'Visitors' }, nav: { group: 'library', icon: 'users', order: 1 }, bindings: { rows: 'visitors' } },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an app installed on one connection — ${dialect}`, () => {
    it('is not installable on a second, and updates where it is', async () => {
      const h = (open = await installHarness(dialect));
      const first = await h.install(manifest('1.0.0'));
      expect(first.statusCode, first.body).toBe(200);
      const other = await h.otherConnection();

      // The plan for the second connection names the connection the app is on.
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'desk', version: '1.0.0', connectionId: other.id } });
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = (JSON.parse(planned.body) as { plan: { installable: boolean; problems: { code: string; message: string; connectionId?: string }[] } }).plan;
      expect(plan.installable).toBe(false);
      expect(plan.problems).toContainEqual({
        code: 'APP_INSTALLED_ELSEWHERE',
        table: 'desk',
        connectionId: h.connectionId,
        message: '"Front Desk" is already installed on the connection "Clinic". An app runs on one connection: update it there, or uninstall it there before installing it on another.',
      });

      // The install refuses before writing anything: no row moved, no table made there.
      const refused = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'desk', version: '1.0.0', connectionId: other.id } });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: { code: 'APP_INSTALLED_ELSEWHERE', details: { connectionId: h.connectionId, connection: 'Clinic' } } });
      expect(await other.tables()).toEqual([]);
      const rows = (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app')).filter((m) => m.row.manifestKey === 'desk');
      expect(rows.map((m) => [m.row.connectionId, m.row.version, m.row.status])).toEqual([[h.connectionId, '1.0.0', 'installed']]);

      // A newer version, on its own connection: planned installable and installed in place.
      await h.stage(manifest('1.0.1'));
      const same = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'desk', version: '1.0.1', connectionId: h.connectionId } });
      expect((JSON.parse(same.body) as { plan: { installable: boolean } }).plan.installable, same.body).toBe(true);
      const updated = await h.inject({ method: 'POST', url: '/apps/desk/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      await h.stage(manifest('1.0.2'));
      const reinstalled = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'desk', version: '1.0.2', connectionId: h.connectionId } });
      expect(reinstalled.statusCode, reinstalled.body).toBe(200);
      const after = (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app')).filter((m) => m.row.manifestKey === 'desk');
      expect(after.map((m) => [m.row.connectionId, m.row.version])).toEqual([[h.connectionId, '1.0.2']]);
    });
  });
}
