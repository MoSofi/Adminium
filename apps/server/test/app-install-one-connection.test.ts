// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP RUNS ONCE PER DATABASE, AND ONE VERSION OF IT PER SERVER, on every
 * engine this run can reach.
 *
 * Installing an installed app again on a second connection used to replace
 * its row and leave the first database behind; then it was refused. Now
 * (plan 76, W7/W12) the second database gets a copy of its own, beside the
 * first, under an address of its own. Every copy runs one version: a copy on
 * another version is refused at plan and install, and an update names the
 * copy it moves when there are several.
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
    it('installs a copy of its own on a second, and updates the copy it is asked to', async () => {
      const h = (open = await installHarness(dialect));
      const first = await h.install(manifest('1.0.0'));
      expect(first.statusCode, first.body).toBe(200);
      const other = await h.otherConnection();
      const copies = async () =>
        (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).listByKey('desk')).map((m) => [m.row.scopeKey === h.connectionId ? 'first' : 'second', m.row.version, m.row.instanceSlug === '' ? 'bare' : 'slug']).sort();

      // The plan for the second connection is an install of its own there.
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'desk', version: '1.0.0', connectionId: other.id } });
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = (JSON.parse(planned.body) as { plan: { installable: boolean; problems: { code: string }[] } }).plan;
      expect(plan.installable, planned.body).toBe(true);
      expect(plan.problems.map((problem) => problem.code)).not.toContain('APP_INSTALLED_ELSEWHERE');
      const second = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'desk', version: '1.0.0', connectionId: other.id } });
      expect(second.statusCode, second.body).toBe(200);
      expect(await copies()).toEqual([['first', '1.0.0', 'bare'], ['second', '1.0.0', 'slug']]);
      // The catalogue shows the app once, with a status row per copy.
      const catalog = JSON.parse((await h.inject({ method: 'GET', url: '/apps/catalog' })).body) as { apps: { key: string; installs: { connectionName: string; slug: string; status: string }[] }[] };
      expect(catalog.apps.filter((app) => app.key === 'desk')).toHaveLength(1);
      expect(catalog.apps.find((app) => app.key === 'desk')!.installs.map((copy) => [copy.connectionName, copy.slug, copy.status]).sort()).toEqual([
        ['Clinic', '', 'installed'],
        ['Second', 'second', 'installed'],
      ]);

      // A newer version: an update with two copies names the one it moves.
      await h.stage(manifest('1.0.1'));
      // The check of the first copy's update: the other copy runs the version before meanwhile, and is no problem of it.
      const check = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'desk', version: '1.0.1', connectionId: h.connectionId } });
      expect((JSON.parse(check.body) as { plan: { installable: boolean } }).plan.installable, check.body).toBe(true);
      const unnamed = await h.inject({ method: 'POST', url: '/apps/desk/update', payload: {} });
      expect(unnamed.statusCode, unnamed.body).toBe(409);
      expect(JSON.parse(unnamed.body)).toMatchObject({ error: { code: 'APP_INSTALL_AMBIGUOUS' } });
      const updated = await h.inject({ method: 'POST', url: `/apps/desk/update?connectionId=${h.connectionId}`, payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await copies()).toEqual([['first', '1.0.1', 'bare'], ['second', '1.0.0', 'slug']]);

      // One version per server: a third database is not given a copy on another version than the others run.
      const third = await h.otherConnection('Third');
      const mixed = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'desk', version: '1.0.1', connectionId: third.id } });
      const mixedPlan = (JSON.parse(mixed.body) as { plan: { installable: boolean; problems: { code: string }[] } }).plan;
      expect(mixedPlan.installable).toBe(false);
      expect(mixedPlan.problems.map((problem) => problem.code)).toContain('ONE_VERSION_PER_APP');
    });
  });
}
