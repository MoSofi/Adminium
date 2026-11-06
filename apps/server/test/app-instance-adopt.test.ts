// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LEGACY INSTANCE MADE AN INSTALL OF ITS OWN, in one reviewed step.
 *
 * Before installs were per database, an app served a second database through
 * an instance of its first install: one row, one set of settings and roles
 * for both. Kept as it is, it still opens as the first install. Made an
 * install, it is one on its own database: the app's tables there are used as
 * they are, the instance's address is the install's, the first copy's
 * settings are copied (never its secrets), and every role that opens the
 * first copy's staff screens opens this one's. Said before it is done, and
 * done once.
 */
import { addOnSettingsRepo, manifestsRepo, permissionsRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

function desk(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Front Desk',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: { tables: [{ ref: 'tickets', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', maxLength: 80 }] }] },
    settings: [{ key: 'greeting', type: 'string', default: 'Hello' }, { key: 'token', type: 'string', secret: true }],
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['app:@:staff'] }],
    pages: [{ ref: 'desk-tickets', template: 'page-crud', title: { key: 't', fallback: 'Tickets' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'tickets' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a legacy instance made an install of its own [${dialect}]`, () => {
  it('says what it would do, then takes the instance’s database and address, its settings and its people', async () => {
    const h = (open = await installHarness(dialect));
    expect((await h.install(desk())).statusCode).toBe(200);
    const manifests = manifestsRepo(h.meta, PLAIN);
    const first = (await manifests.findBySlug('desk', ''))!;
    await addOnSettingsRepo(h.meta).patch({ manifestId: first.row.id, addOnKey: 'desk' }, { greeting: 'Hi there' }, [{ key: 'greeting', secret: false }, { key: 'token', secret: true }]);
    // A role of the operator's own that opens the desk's staff screens.
    const reception = await rolesRepo(h.meta).create({ slug: 'reception', name: 'Reception' });
    await permissionsRepo(h.meta).grant(reception.id, 'app', 'desk', { staff: true });

    // The second database, used through an instance: the desk's table is there, with a row.
    const east = await h.otherConnection('East');
    await east.run("CREATE TABLE tickets (id INTEGER PRIMARY KEY, title VARCHAR(80) NOT NULL); INSERT INTO tickets (title) VALUES ('Broken lamp');");
    await settingsRepo(h.meta).set('surfaces.apps', { desk: { instances: [{ slug: 'east', connectionId: east.id }] } }, { updatedBy: null });

    const before = await h.inject({ method: 'GET', url: '/apps/desk/instances/east/adopt' });
    expect(before.statusCode, before.body).toBe(200);
    const said = JSON.parse(before.body) as { connectionName: string; version: string; settings: string[]; secretsLeft: string[]; roles: { name: string }[] };
    expect(said).toMatchObject({ connectionName: 'East', version: '1.0.0', settings: ['greeting'], secretsLeft: ['token'] });
    expect(said.roles.map((role) => role.name).sort()).toEqual(['Clerk', 'Reception']);
    // Its plan: the table there, used as it is.
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'desk', version: '1.0.0', connectionId: east.id, existing: 'use' } });
    const planned = (JSON.parse(plan.body) as { plan: { installable: boolean; problems: unknown[] } }).plan;
    expect(planned.problems).toEqual([]);
    expect(planned.installable).toBe(true);

    const adopted = await h.inject({ method: 'POST', url: '/apps/desk/instances/east/adopt', payload: {} });
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect(JSON.parse(adopted.body)).toMatchObject({ settingsCopied: ['greeting'], secretsLeft: ['token'] });

    const install = (await manifests.findBySlug('desk', 'east'))!;
    expect(install.row).toMatchObject({ scopeKey: east.id, instanceSlug: 'east', status: 'installed' });
    expect((await addOnSettingsRepo(h.meta).valuesForInstall(install.row.id))['greeting']).toBe('Hi there');
    // Whoever opened the first copy's staff screens opens this one's.
    expect((await permissionsRepo(h.meta).listForRole(reception.id)).map((grant) => [grant.resourceKind, grant.resourceRef]).sort()).toEqual([
      ['app', 'desk'],
      ['app', 'desk~east'],
    ]);
    // The row there is the business's, untouched; the instance is the install's now.
    expect(await east.tables()).toEqual(['tickets']);
    expect((await settingsRepo(h.meta).get('surfaces.apps'))['desk']?.instances).toEqual([{ slug: 'east', connectionId: east.id }]);

    // Done once.
    const again = await h.inject({ method: 'POST', url: '/apps/desk/instances/east/adopt', payload: {} });
    expect(again.statusCode, again.body).toBe(409);
    expect(again.body).toContain('INSTANCE_IS_AN_INSTALL');
    expect((await h.inject({ method: 'GET', url: '/apps/desk/instances/west/adopt' })).statusCode).toBe(404);
  });
});
}
