// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PLAIN ADDRESS WHOSE COPY IS GONE tells where the app went only to who may
 * open it, on every engine.
 *
 * Clients had its plain addresses on Fernhill; that copy is uninstalled, and
 * copies remain on Kiln (`clients~kiln`) and Barn (`clients~barn`). Then:
 *  - signed out, the 410 names no database and no address: "This address
 *    moved; sign in to see where", with a way to sign in on the staff side;
 *  - signed in, it lists only the copies the person reaches: Super Admin both,
 *    Kiln's clerk Kiln alone;
 *  - somebody who reaches neither is told it moved, and nothing more.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionsRepo, createFirstSuperAdmin, manifestsRepo, permissionsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, login } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const NAVIGATE = { 'sec-fetch-mode': 'navigate', accept: 'text/html', 'accept-language': 'en-US' };
const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-retired-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-retired-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'clients', side), { recursive: true });
    await writeFile(join(surfacesDir, 'clients', side, 'index.html'), `<body data-app="clients-${side}"></body>`, 'utf8');
  }
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  await rm(surfacesDir, { recursive: true, force: true });
});

describe.each(META_ENGINES)('a retired plain address — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  const cookies: Record<'admin' | 'clerk' | 'stranger', string> = { admin: '', clerk: '', stranger: '' };

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: 'Admin', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta, staticRoot: dist, surfaces });
    await app.register(rbacPlugin, { meta });
    await app.ready();

    const connections = connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET));
    const make = async (name: string) => (await connections.create({ name, engine: 'sqlite', introspectDsn: 'sqlite::memory:' })).id;
    const fernhill = await make('Fernhill');
    const kiln = await make('Kiln');
    const barn = await make('Barn');
    const repo = manifestsRepo(meta, IDENTITY);
    const plain = await repo.install({ manifestKey: 'clients', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: fernhill });
    await repo.install({ manifestKey: 'clients', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: kiln, instanceSlug: 'kiln' });
    await repo.install({ manifestKey: 'clients', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: barn, instanceSlug: 'barn' });
    await repo.uninstall(plain.row.id);
    app.surfaceSettings?.invalidate();

    const person = async (email: string, grant: string | null) => {
      const role = await rolesRepo(meta).create({ slug: `role-${email.split('@')[0]!}`, name: email });
      if (grant !== null) await permissionsRepo(meta).grant(role.id, 'app', grant, { staff: true });
      const user = await usersRepo(meta).create({ email, name: email, passwordHash: await adminPasswordHash() });
      await rolesRepo(meta).assignToUser(user.id, role.id);
      return (await login(app, email, ADMIN_PASSWORD)).cookie ?? '';
    };
    cookies.admin = (await login(app)).cookie ?? '';
    cookies.clerk = await person('clerk@kiln.test', 'clients~kiln');
    cookies.stranger = await person('stranger@kiln.test', null);
  }, 240_000);
  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });

  it.skipIf(!engine.available)('names nothing before sign-in, on either side, and offers to sign in on the staff side', async () => {
    for (const side of ['staff', 'customer'] as const) {
      const page = await get(`/apps/clients/${side}/`, NAVIGATE);
      expect(page.statusCode, side).toBe(410);
      expect(page.body, side).toContain('clients has moved.');
      for (const named of ['Kiln', 'Barn', '/apps/clients/kiln/', '/apps/clients/barn/']) expect(page.body, side).not.toContain(named);
    }
    const staff = await get('/apps/clients/staff/', NAVIGATE);
    expect(staff.body).toContain('This address moved; sign in to see where.');
    expect(staff.body).toContain('href="/login?next=%2Fapps%2Fclients%2Fstaff%2F"');
    expect((await get('/apps/clients/customer/', NAVIGATE)).body).toContain('This address has moved.');

    const fetched = await get('/apps/clients/customer/surface-config.json');
    expect(fetched.statusCode).toBe(410);
    expect(fetched.json().error).toEqual(expect.objectContaining({ code: 'APP_ADDRESS_RETIRED', message: 'This address moved; sign in to see where.', details: { appKey: 'clients' } }));
  });

  it.skipIf(!engine.available)('lists, signed in, only the copies the person reaches', async () => {
    const all = await get('/apps/clients/staff/', { ...NAVIGATE, cookie: cookies.admin });
    expect(all.statusCode).toBe(410);
    expect(all.body).toContain('href="/apps/clients/barn/staff/"');
    expect(all.body).toContain('href="/apps/clients/kiln/staff/"');

    const clerk = await get('/apps/clients/staff/', { ...NAVIGATE, cookie: cookies.clerk });
    expect(clerk.body).toContain('clients is installed on Kiln.');
    expect(clerk.body).toContain('href="/apps/clients/kiln/staff/"');
    expect(clerk.body).not.toContain('Barn');
    const fetched = await get('/apps/clients/staff/surface-config.json', { cookie: cookies.clerk });
    expect(fetched.statusCode).toBe(410);
    expect(fetched.json().error.details).toEqual({ appKey: 'clients', installs: [{ database: 'Kiln', slug: 'kiln', url: '/apps/clients/kiln/staff/' }] });
  });

  it.skipIf(!engine.available)('tells somebody who reaches neither copy only that it moved', async () => {
    const page = await get('/apps/clients/staff/', { ...NAVIGATE, cookie: cookies.stranger });
    expect(page.statusCode).toBe(410);
    expect(page.body).toContain('This address moved to a copy this account can’t open.');
    for (const named of ['Kiln', 'Barn', '/apps/clients/kiln/', 'sign in']) expect(page.body).not.toContain(named);
    const fetched = await get('/apps/clients/staff/surface-config.json', { cookie: cookies.stranger });
    expect(fetched.json().error.details).toEqual({ appKey: 'clients' });
  });
});
