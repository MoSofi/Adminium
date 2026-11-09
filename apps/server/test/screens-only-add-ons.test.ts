// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SCREENS-ONLY ROLE IS TOLD WHICH ADD-ONS ITS APP HAS.
 *
 * A print works' counter opens only the app's own screens. Its dispatch screen
 * offers "Book a collection" once a carrier add-on is connected to the app, and
 * learns that from `GET /add-ons` — which the screens-only rule refused, so
 * the counter never saw the carrier. Now the counter is told of the add-ons
 * connected to its app, and only of those: not of an add-on of another app on
 * the same database, nor that its carrier is connected to that other app, nor
 * any setting's value.
 *
 * On every engine this run can reach.
 */
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { manifestsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';

import { addOnHarness, CRYPTO, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', description: { key: 'd', fallback: 'd' } };

const app = (key: string, roles: Doc[] = []): Doc => ({
  ...IDENTITY,
  kind: 'app',
  key,
  name: key === 'works' ? 'Works' : 'Other',
  version: '0.3.0',
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.28' },
  pages: [{ ref: `${key}-orders`, template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'carrier', range: '>=1.0.0', reason: { 'en-US': 'Collections.' } }, { key: 'extras', range: '>=1.0.0', reason: { 'en-US': 'Extras.' } }] },
  requiredSchema: { prefixed: true, tables: [{ ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] }] },
  ...(roles.length === 0 ? {} : { roles }),
});

const addOn = (key: string): Doc => ({
  ...IDENTITY,
  kind: 'add-on',
  key,
  name: key,
  version: '1.0.0',
  categories: ['data'],
  compatibility: { minAdminiumVersion: key === 'carrier' ? '0.3.49' : '0.3.18' },
  // The carrier is kept once for the whole server, and joins the first copy of each app it is attached to.
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, ...(key === 'carrier' ? { scope: 'server' } : {}) },
  // The carrier's account: a value the shop's owner sets, which a screen is never told.
  ...(key === 'carrier' ? { settings: [{ key: 'account', type: 'string' }] } : {}),
});

describe.each(LEGS)('a screens-only role and its app\'s add-ons — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let counter = '';
  let kiln = '';
  let kilnCounter = '';
  let owner = '';
  const list = (cookie: string) => served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons', headers: { cookie } });
  const signIn = async (email: string, remote: string): Promise<string> => {
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: remote, payload: { email, password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    return sessionCookie(login.headers['set-cookie']);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    // The counter's role may even change the carrier's settings: a screen of its is still not told their values.
    await h.stageApp(app('works', [{ key: 'counter', name: 'Counter', screensOnly: true, permissions: ['app:@:staff', 'table:@orders:read', 'addOn:carrier:settings'] }]));
    expect((await h.install('works', '0.3.0')).statusCode).toBe(200);
    // A second copy of the same app, on another database.
    const file = join(h.dataDir, 'kiln.db');
    new BetterSqlite3(file).close();
    kiln = (await h.manager.connections.create({ name: 'Kiln', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` })).id;
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: kiln });
    const second = await h.install('works', '0.3.0', { connectionId: kiln });
    expect(second.statusCode, second.body).toBe(200);
    await h.stageApp(app('other'));
    expect((await h.install('other', '0.3.0')).statusCode).toBe(200);
    await h.stageAddOn(addOn('carrier'), { bundled: true });
    await h.stageAddOn(addOn('extras'), { bundled: true });
    // The carrier is connected to both apps; the extras to the other app alone.
    const carrier = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'carrier', version: '1.0.0', attachTo: ['works', 'other'] } });
    expect(carrier.statusCode, carrier.body).toBe(200);
    const set = await h.inject({ method: 'PUT', url: '/add-ons/carrier/settings', payload: { values: { account: 'ACC-1234' } } });
    expect(set.statusCode, set.body).toBe(200);
    const extras = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'extras', version: '1.0.0', attachTo: ['other'], connectionId: h.connectionId } });
    expect(extras.statusCode, extras.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const users = usersRepo(h.meta);
    const roles = rolesRepo(h.meta);
    const cara = await users.create({ email: 'cara@works.dev', name: 'Cara', passwordHash: await adminPasswordHash() });
    await roles.assignToUser(cara.id, (await roles.findBySlug('works-counter'))!.id);
    counter = await signIn('cara@works.dev', '10.8.0.1');
    // The counter of the copy on the Kiln database.
    const kilnCopy = (await manifestsRepo(h.meta, CRYPTO).findInScope('works', kiln))!.row.id;
    const kilnRole = (await roles.listForInstall(kilnCopy)).find((role) => role.slug.endsWith('counter'))!;
    const kim = await users.create({ email: 'kim@works.dev', name: 'Kim', passwordHash: await adminPasswordHash() });
    await roles.assignToUser(kim.id, kilnRole.id);
    kilnCounter = await signIn('kim@works.dev', '10.8.0.3');
    const boss = await users.create({ email: 'boss@works.dev', name: 'Boss', passwordHash: await adminPasswordHash() });
    await roles.assignToUser(boss.id, (await roles.findBySlug('super-admin'))!.id);
    owner = await signIn('boss@works.dev', '10.8.0.2');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('tells the counter of its app\'s carrier, and of nothing of the other app', async () => {
    const res = await list(counter);
    expect(res.statusCode, res.body).toBe(200);
    const addOns = (res.json() as { addOns: { key: string; version: string; attachments: { attachedTo: string; enabled: boolean }[]; settingValues: Doc }[] }).addOns;
    expect(addOns.map((one) => one.key)).toEqual(['carrier']);
    expect(addOns[0]).toMatchObject({ key: 'carrier', version: '1.0.0', settingValues: {} });
    // Its own copy's attachment alone: not the other app's, nor the copy of its app on the Kiln database.
    const ownCopy = (await manifestsRepo(h.meta, CRYPTO).findInScope('works', h.connectionId))!.row.id;
    expect(addOns[0]!.attachments.map((one) => [one.attachedTo, (one as { hostInstall?: string }).hostInstall])).toEqual([['works', ownCopy]]);
    expect(res.body).not.toContain('ACC-1234');
    // The rest of the dashboard's API stays closed to it.
    expect((await served.composed.app.inject({ method: 'GET', url: '/api/v1/roles', headers: { cookie: counter } })).json().error?.code).toBe('APP_SCREENS_ONLY');
  });

  it.skipIf(!available)('tells the counter of the other copy of the app nothing of the copy the carrier joins', async () => {
    const res = await list(kilnCounter);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { addOns: unknown[] }).addOns).toEqual([]);
  });

  it.skipIf(!available)('still tells the owner of every add-on and every app it is connected to', async () => {
    const res = await list(owner);
    expect(res.statusCode, res.body).toBe(200);
    const addOns = (res.json() as { addOns: { key: string; attachments: { attachedTo: string }[] }[] }).addOns;
    expect(addOns.map((one) => one.key).sort()).toEqual(['carrier', 'extras']);
    expect(addOns.find((one) => one.key === 'carrier')!.attachments.map((one) => one.attachedTo).sort()).toEqual(['other', 'works']);
  });
});
