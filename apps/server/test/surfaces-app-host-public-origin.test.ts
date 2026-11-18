// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PUBLIC ADDRESS'S HOST IS NEVER AN APP'S, on every engine.
 *
 * An app's side mapped to a host answers every path there but a reserved few
 * (`/api`, `/apps`, `/x/`, `/pay`, `/m`, and on a staff side the sign-in
 * pages and the dashboard's own files) with the app: the dashboard's pages
 * there, and the links its mail carries to them (a record's `/p/…`) would
 * open the app, and a customer side refuses the sign-in page and the
 * `/reset/…` an invitation or a reset links to outright. So the host of
 * `system.publicOrigin` is refused for an app's side as it is for the add-on
 * pages, with the same code and words, through both doors that map one: the
 * Surfaces screen's whole map and one app's own list. Another host is kept,
 * and with no public address set nothing extra is refused.
 *
 * And a pages host's home is never a door's own call: under each `/x/` door
 * only a page one name below it is a home.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFirstSuperAdmin, manifestsRepo, settingsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createInstalledApps } from '../src/apps/installed.js';
import { createAppStore } from '../src/apps/store.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { AppError, errorEnvelope, UnauthorizedError } from '../src/errors.js';
import { customerHostAllows, isHostReservedPath } from '../src/plugins/surfaces.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { surfacesAdminRoutes } from '../src/routes/surfaces-admin/index.js';
import { pagesHomeIssueFor, validateDomainEntries, X_DOORS } from '../src/surfaces/validate.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const PUBLIC = 'go.meridian.example';

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-public-app-host-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-public-app-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'clients', side), { recursive: true });
    await writeFile(join(surfacesDir, 'clients', side, 'index.html'), `<!doctype html><body data-app="clients-${side}"></body>`, 'utf8');
  }
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  await rm(surfacesDir, { recursive: true, force: true });
});

describe('an app’s side on the public address’s host', () => {
  it('would answer the dashboard’s pages and the links its mail carries, and leave the /x/ doors, the pay page and the mail door alone', () => {
    // What the surfaces plugin passes through on a mapped host: everything else is the app's.
    for (const side of ['staff', 'customer'] as const) {
      for (const path of ['/', '/p/invoices/r/42', '/settings/team']) expect(isHostReservedPath(path, side), `${side} ${path}`).toBe(false);
      for (const path of ['/x/forms/newsletter', '/x/chat/support', '/pay/abc', '/m/u/abc']) expect(isHostReservedPath(path, side), `${side} ${path}`).toBe(true);
    }
    // A customer side refuses the sign-in page and an invitation's or a reset's link outright.
    for (const path of ['/login', '/reset/abc']) expect(customerHostAllows(path, 'clients'), path).toBe(false);
  });

  it('is refused for either side, beside the request host’s own refusal, and another host is kept', () => {
    const settings = { apps: {}, domains: {}, statuses: {} };
    const { normalized, issues } = validateDomainEntries(
      {
        'Go.Meridian.Example:443': { appKey: 'clients', side: 'customer' },
        'admin.example.test': { appKey: 'clients', side: 'staff' },
        'shop.meridian.example': { appKey: 'clients', side: 'customer' },
      },
      { requestHost: 'admin.example.test', surfaces, settings, publicOriginHost: PUBLIC },
    );
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['Go.Meridian.Example:443', 'public_origin_host'],
      ['admin.example.test', 'request_host'],
    ]);
    expect(issues[0]?.message).toBe(
      `"Go.Meridian.Example:443" is the host of this server's public address — mapping it would take the dashboard away there, and with it the links in its mail.`,
    );
    expect(normalized).toEqual({ 'shop.meridian.example': { appKey: 'clients', side: 'customer' } });
    // A staff side the same way; with no public address, nothing extra.
    expect(validateDomainEntries({ [PUBLIC]: { appKey: 'clients', side: 'staff' } }, { requestHost: '', surfaces, settings, publicOriginHost: PUBLIC }).issues.map((issue) => issue.code)).toEqual(['public_origin_host']);
    expect(validateDomainEntries({ [PUBLIC]: { appKey: 'clients', side: 'staff' } }, { requestHost: '', surfaces, settings, publicOriginHost: null }).issues).toEqual([]);
  });
});

describe('a pages host’s home, by the /x/ doors', () => {
  it('names each door the engine serves', () => {
    expect(X_DOORS).toEqual(['forms', 'chat']);
  });

  it('is a page one name below a door, never the door, its api or a call below a page', () => {
    for (const home of ['/x/forms/newsletter', '/x/chat/support', '/x/chat/support-desk']) expect(pagesHomeIssueFor(home), home).toBeNull();
    for (const door of X_DOORS) {
      for (const home of [`/x/${door}`, `/x/${door}/api`, `/x/${door}/api/newsletter`, `/x/${door}/api/support/messages`, `/x/${door}/support/messages`, `/x/${door}/support/config`]) {
        expect(pagesHomeIssueFor(home), home).toBe('must be a page, not the pages’ own files or API');
      }
    }
    // The chat window's own calls, by name: never a home.
    for (const home of ['/x/chat', '/x/chat/support/config', '/x/chat/support/messages']) expect(pagesHomeIssueFor(home), home).not.toBeNull();
    // The pages' own files and API, as before.
    for (const home of ['/x/assets/x-abc', '/x/api/logo']) expect(pagesHomeIssueFor(home), home).toBe('must be a page, not the pages’ own files or API');
    expect(pagesHomeIssueFor('/login')).toBe('must be a page address under /x/, such as /x/forms/newsletter');
  });
});

describe.each(META_ENGINES)('PUT /api/v1/surfaces/domains, an app’s side and the public address — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  let admin: User;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    admin = await createFirstSuperAdmin(meta, { email: 'admin@example.test', name: 'Admin', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta, staticRoot: dist, surfaces });
    // A test user by header, as the other surfaces suites do: every route here is under `/api/`.
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await usersRepo(meta).findById(id);
      if (user === null) return;
      const req = request as unknown as { user: unknown; session: unknown };
      req.user = user;
      req.session = { id: 'test-session', userId: user.id };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(surfacesAdminRoutes({ meta })), { prefix: '/api/v1' });
    await app.ready();
  }, 240_000);

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  const put = (domains: unknown) =>
    app.inject({ method: 'PUT', url: '/api/v1/surfaces/domains', headers: { 'x-test-user-id': admin.id, host: 'admin.example.test' }, payload: { domains } });

  it.runIf(engine.available)('keeps the host while no public address is set', async () => {
    await settingsRepo(meta).set('system.publicOrigin', null, { updatedBy: null });
    const res = await put({ [PUBLIC]: { appKey: 'clients', side: 'customer' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({ [PUBLIC]: { appKey: 'clients', side: 'customer' } });
    await put({});
  });

  it.runIf(engine.available)('refuses it for either side, however it is written, and keeps another', async () => {
    await settingsRepo(meta).set('system.publicOrigin', `https://${PUBLIC}`, { updatedBy: null });
    for (const side of ['customer', 'staff']) {
      const refused = await put({ 'Go.Meridian.Example:443': { appKey: 'clients', side }, 'shop.meridian.example': { appKey: 'clients', side: 'customer' } });
      expect(refused.statusCode, side).toBe(422);
      const issues = (refused.json().error.details?.issues ?? []) as { path: string; code: string; message: string }[];
      expect(issues.map((issue) => [issue.path, issue.code]), side).toEqual([['Go.Meridian.Example:443', 'public_origin_host']]);
      expect(issues[0]?.message).toContain('public address');
      // A refused save changes nothing.
      expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({});
    }
    const kept = await put({ 'shop.meridian.example': { appKey: 'clients', side: 'customer' } });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({ 'shop.meridian.example': { appKey: 'clients', side: 'customer' } });
  });
});

/** An app with a staff and a customer side, staged in the store as an install leaves it. */
const DESK = {
  kind: 'app',
  manifestVersion: 1,
  key: 'desk',
  name: 'Desk',
  version: '0.2.0',
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'mft.desk.desc', fallback: 'A desk.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0', engines: ['postgres', 'mysql', 'sqlite'] },
  requiredSchema: { tables: [{ ref: 'jobs', columns: [{ ref: 'id', type: 'int', role: 'pk' }] }] },
  frontends: [
    { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
    { side: 'customer', kind: 'spa', entry: 'index.html', routes: { book: '/' } },
  ],
};

describe.each(META_ENGINES)('PUT /apps/:key/domains and the public address — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let dataDir: string;
  let app: Awaited<ReturnType<typeof routesFor>>;

  async function routesFor(db: MetaDb, dir: string) {
    const Fastify = (await import('fastify')).default;
    const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
    const server = Fastify();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    server.decorate('rbac', { require: () => async () => {} } as never);
    server.decorate('requireAuth', (async (request: { user?: unknown }) => {
      if (request.user === null || request.user === undefined) throw new UnauthorizedError('UNAUTHENTICATED');
    }) as never);
    server.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, 'req_test', error.details));
      return reply.status(500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
    });
    const owner = await usersRepo(db).create({ email: 'owner@test', name: 'Owner' });
    server.decorateRequest('user', null);
    server.addHook('onRequest', async (request) => {
      (request as { user?: unknown }).user = { id: owner.id, email: owner.email };
    });
    const store = createAppStore({ dataDir: dir });
    const tarball = packageTarball({
      'manifest.json': JSON.stringify(DESK),
      'staff/index.html': '<!doctype html><body data-app="desk-staff"></body>',
      'customer/index.html': '<!doctype html><body data-app="desk-customer"></body>',
    });
    await store.stage({ key: 'desk', version: '0.2.0', tarball, expectedIntegrity: sha512Integrity(tarball) });
    await manifestsRepo(db, CRYPTO).install({ manifestKey: 'desk', version: '0.2.0', kind: 'app', source: 'file', document: DESK });
    const installed = createInstalledApps({
      store,
      list: async () => (await manifestsRepo(db, CRYPTO).list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version, status: m.row.status })),
    });
    await server.register(appRoutes({ meta: db, store, installed, credentialCrypto: CRYPTO, directoryKeys: () => [], serverVersion: '0.3.64' }));
    await server.ready();
    return server;
  }

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    dataDir = await mkdtemp(join(tmpdir(), 'adminium-public-app-domains-'));
    app = await routesFor(meta, dataDir);
  }, 240_000);

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  const put = (domains: unknown) => app.inject({ method: 'PUT', url: '/apps/desk/domains', headers: { host: 'admin.example.test' }, payload: { domains } });

  it.runIf(engine.available)('keeps the host while no public address is set', async () => {
    await settingsRepo(meta).set('system.publicOrigin', null, { updatedBy: null });
    const res = await put({ [PUBLIC]: { side: 'customer' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({ [PUBLIC]: { appKey: 'desk', side: 'customer' } });
    await put({});
  });

  it.runIf(engine.available)('refuses it for either side, however it is written, and keeps another', async () => {
    await settingsRepo(meta).set('system.publicOrigin', `https://${PUBLIC}`, { updatedBy: null });
    for (const side of ['customer', 'staff']) {
      const refused = await put({ 'GO.meridian.example': { side }, 'shop.meridian.example': { side: 'customer' } });
      expect(refused.statusCode, side).toBe(422);
      const issues = (refused.json().error.details?.issues ?? []) as { path: string; code: string; message: string }[];
      expect(issues.map((issue) => [issue.path, issue.code]), side).toEqual([['GO.meridian.example', 'public_origin_host']]);
      expect(issues[0]?.message).toContain('public address');
      expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({});
    }
    const kept = await put({ 'shop.meridian.example': { side: 'customer' } });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({ 'shop.meridian.example': { appKey: 'desk', side: 'customer' } });
  });
});
