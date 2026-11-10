// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A SHOP'S OWNER KEEPS AN ADD-ON'S SETTINGS.
 *
 * The owner's role (an app's role) carries `addOn:<key>:settings` for an
 * add-on the app names, and does not manage add-ons, so the add-ons page is
 * not theirs. The bootstrap names the add-ons whose settings they keep
 * (`addOnSettings`), which the rail links to their own settings screen; the
 * add-on's own settings control (its `settings.add-on.panel` file) is served
 * to them, and their save goes through. A clerk of the same app with no such
 * grant is told of none and refused the save; whoever manages add-ons is
 * told of none either (Super Admin, or a role that manages add-ons as well:
 * the add-ons page is theirs); and switched off for the
 * app, the grant names nothing.
 *
 * On every engine this run can reach, through the real installer and the
 * whole server, people signing in with a password.
 */
import { manifestsRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { matrixRowsFromGrants, PERMISSIONS } from '../src/rbac/permissions.js';
import { addOnHarness, addOnManifest, appManifest, CRYPTO, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const KEY = 'holidays';
const CLIENT = 'export function register() { return { key: "holidays", fills: [] }; }\n';
const holidays = addOnManifest(KEY, {
  version: '1.0.0',
  name: 'Holiday Calendars',
  settings: [{ key: 'days', type: 'json', default: [] }],
  addOn: { attaches: [{ app: '*' }], slots: [{ slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 }] },
});
const shop = appManifest('studio', {
  addOns: { suggests: [{ key: KEY, range: '^1.0.0', reason: { 'en-US': 'The days the studio is closed.' } }] },
  roles: [
    { key: 'owner', name: 'Owner', permissions: ['table:@jobs:read', `addOn:${KEY}:settings`] },
    { key: 'clerk', name: 'Clerk', permissions: ['table:@jobs:read'] },
  ],
});

describe.each(LEGS)("the settings an app's owner keeps of an add-on — %s", (dialect, available) => {
  let h: Harness;
  let served: Served;
  let signIns = 0;
  const people: Record<'admin' | 'owner' | 'clerk' | 'manager', { cookie: string }> = {} as never;

  const person = async (email: string, ...slugs: string[]) => {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    for (const slug of slugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    signIns += 1;
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.10.${String(signIns >> 8)}.${String(signIns & 255)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: sessionCookie(res.headers['set-cookie']) };
  };
  const send = (who: { cookie: string }, method: 'GET' | 'PUT', url: string, payload?: unknown) =>
    served.composed.app.inject({ method, url: `/api/v1${url}`, headers: { cookie: who.cookie }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const kept = async (who: { cookie: string }) => {
    const res = await send(who, 'GET', '/bootstrap');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { addOnSettings?: { key: string; name: string }[] } }).data.addOnSettings;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(holidays, { files: { 'dist/client.js': CLIENT } });
    await h.stageApp(shop);
    const installed = await h.install('studio', '0.2.0', { addOns: [{ key: KEY, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    people.admin = await person('admin@studio.test', 'super-admin');
    people.owner = await person('owner@studio.test', 'studio-owner');
    people.clerk = await person('clerk@studio.test', 'studio-clerk');
    // Somebody who manages add-ons (not Super Admin) and is the shop's owner too: the add-ons page is where they keep it.
    const manages = await rolesRepo(h.meta).create({ slug: 'add-on-keeper', name: 'Add-on keeper' });
    for (const row of matrixRowsFromGrants([PERMISSIONS.manifestsManage]).rows) await permissionsRepo(h.meta).grant(manages.id, row.resourceKind, row.resourceRef, row.actions as never);
    people.manager = await person('manager@studio.test', 'studio-owner', 'add-on-keeper');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('names the add-on to the owner who keeps its settings, and to nobody else', async () => {
    expect(await kept(people.owner)).toEqual([{ key: KEY, name: 'Holiday Calendars', connectionName: 'Studio' }]);
    expect(await kept(people.clerk)).toBeUndefined();
    expect(await kept(people.admin)).toBeUndefined();
    expect(await kept(people.manager)).toBeUndefined();
  });

  it.skipIf(!available)("serves the owner the add-on's own settings control, and lists it with the stored values", async () => {
    const list = await send(people.owner, 'GET', '/add-ons');
    expect(list.statusCode, list.body).toBe(200);
    const listed = (list.json() as { addOns: { key: string; slots: { slot: string; client: string }[]; bundles: { path: string; url: string }[]; settingValues: Record<string, unknown> }[] }).addOns.find((one) => one.key === KEY)!;
    expect(listed.slots).toEqual([expect.objectContaining({ slot: 'settings.add-on.panel', client: 'dist/client.js' })]);
    expect(listed.bundles.map((bundle) => bundle.url.replace(/\?v=[0-9a-f]{16}$/, ''))).toEqual([`/api/v1/add-ons/${KEY}/bundle/dist/client.js`]);
    const file = await send(people.owner, 'GET', `/add-ons/${KEY}/bundle/dist/client.js`);
    expect(file.statusCode, file.body).toBe(200);
    expect(file.body).toBe(CLIENT);
  });

  it.skipIf(!available)("takes the owner's save, and refuses the clerk's", async () => {
    const saved = await send(people.owner, 'PUT', `/add-ons/${KEY}/settings`, { values: { days: [{ date: '2026-12-25', name: 'Christmas Day' }] } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as { values: Record<string, unknown> }).values['days']).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }]);
    expect((await send(people.clerk, 'PUT', `/add-ons/${KEY}/settings`, { values: { days: [] } })).statusCode).toBe(403);
  });

  it.skipIf(!available)('names nothing while the add-on is switched off for the app', async () => {
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${KEY}`, payload: { attachedTo: 'studio', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    try {
      expect(await kept(people.owner)).toBeUndefined();
    } finally {
      const on = await h.inject({ method: 'PATCH', url: `/add-ons/${KEY}`, payload: { attachedTo: 'studio', enabled: true } });
      expect(on.statusCode, on.body).toBe(200);
    }
    expect(await kept(people.owner)).toEqual([{ key: KEY, name: 'Holiday Calendars', connectionName: 'Studio' }]);
  });

  // Last: from here the add-on has two copies, and a request that names neither must say which.
  it.skipIf(!available)('asks the owner which copy, naming only the one they keep; the clerk is refused with no list', async () => {
    // A second copy of the add-on, on a database of its own (a server engine's second connection is the same database, so the row is written as an install writes it).
    const kiln = await h.addConnection('Kiln');
    const manifests = manifestsRepo(h.meta, CRYPTO);
    const first = (await manifests.listByKey(KEY))[0]!;
    await manifests.install({ manifestKey: KEY, version: '1.0.0', kind: 'add-on', source: 'file', document: first.document, connectionId: kiln, scopeKey: kiln, instanceSlug: 'kiln' });
    const save = (who: { cookie: string }) => send(who, 'PUT', `/add-ons/${KEY}/settings`, { values: { days: [] } });

    const owner = await save(people.owner);
    expect(owner.statusCode, owner.body).toBe(409);
    const asked = (owner.json() as { error: { code: string; details: { installs: { connectionId: string | null }[] } } }).error;
    expect(asked.code).toBe('APP_INSTALL_AMBIGUOUS');
    expect(asked.details.installs.map((one) => one.connectionId)).toEqual([h.connectionId]);
    expect(owner.body).not.toContain(kiln);

    const clerk = await save(people.clerk);
    expect(clerk.statusCode, clerk.body).toBe(403);
    expect(clerk.body).not.toContain('APP_INSTALL_AMBIGUOUS');
    expect(clerk.body).not.toContain(kiln);

    const admin = await save(people.admin);
    expect(admin.statusCode, admin.body).toBe(409);
    expect((admin.json() as { error: { details: { installs: unknown[] } } }).error.details.installs).toHaveLength(2);
  });
});
