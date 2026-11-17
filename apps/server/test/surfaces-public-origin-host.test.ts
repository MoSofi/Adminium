// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host of this server's public address (`system.publicOrigin`) is never
 * given to the add-on pages, on every engine: the mail links, the pay page and
 * staff's own pages on it need the dashboard there. Another host is kept, and
 * with no public address set nothing extra is refused.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFirstSuperAdmin, settingsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { surfacesAdminRoutes } from '../src/routes/surfaces-admin/index.js';
import { publicOriginHostOf, validatePageHostEntries } from '../src/surfaces/validate.js';
import { adminPasswordHash } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const HOME = { kind: 'pages', home: '/x/forms/newsletter' } as const;

let dist: string;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-public-host-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
});

describe('the public address’s host, as a mapped host', () => {
  it('is the origin’s host with a port only when it is not the default', () => {
    expect(publicOriginHostOf('https://Go.Meridian.Example')).toBe('go.meridian.example');
    expect(publicOriginHostOf('https://go.meridian.example:443/')).toBe('go.meridian.example');
    expect(publicOriginHostOf('http://go.meridian.example:8080')).toBe('go.meridian.example:8080');
    expect(publicOriginHostOf(null)).toBeNull();
    expect(publicOriginHostOf(undefined)).toBeNull();
    expect(publicOriginHostOf('not an origin')).toBeNull();
  });

  it('refuses only that host, beside the request host’s own refusal', () => {
    const { normalized, issues } = validatePageHostEntries(
      { 'go.meridian.example:8080': { home: '/x/forms/a' }, 'go.meridian.example': { home: '/x/forms/a' }, 'admin.example.test': { home: '/x/forms/a' } },
      { requestHost: 'admin.example.test', taken: new Set(), publicOriginHost: 'go.meridian.example:8080' },
    );
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['go.meridian.example:8080', 'public_origin_host'],
      ['admin.example.test', 'request_host'],
    ]);
    expect(normalized).toEqual({ 'go.meridian.example': { home: '/x/forms/a' } });
  });
});

describe.each(META_ENGINES)('PUT /api/v1/surfaces/domains and the public address — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  let admin: User;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    admin = await createFirstSuperAdmin(meta, { email: 'admin@example.test', name: 'Admin', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta, staticRoot: dist });
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

  it.runIf(engine.available)('keeps every host while no public address is set', async () => {
    await settingsRepo(meta).set('system.publicOrigin', null, { updatedBy: null });
    const res = await put({ 'go.meridian.example': HOME });
    expect(res.statusCode, res.body).toBe(200);
    expect(await settingsRepo(meta).get('surfaces.pageHosts')).toEqual({ 'go.meridian.example': { home: '/x/forms/newsletter' } });
  });

  it.runIf(engine.available)('refuses the public address’s host, however it is written, and keeps another', async () => {
    await settingsRepo(meta).set('system.publicOrigin', 'https://go.meridian.example', { updatedBy: null });
    await put({});
    const refused = await put({ 'Go.Meridian.Example:443': HOME, 'pages.meridian.example': HOME });
    expect(refused.statusCode).toBe(422);
    const issues = (refused.json().error.details?.issues ?? []) as { path: string; code: string; message: string }[];
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([['Go.Meridian.Example:443', 'public_origin_host']]);
    expect(issues[0]?.message).toContain('public address');
    // A refused save changes nothing.
    expect(await settingsRepo(meta).get('surfaces.pageHosts')).toEqual({});

    const kept = await put({ 'pages.meridian.example': HOME });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(await settingsRepo(meta).get('surfaces.pageHosts')).toEqual({ 'pages.meridian.example': { home: '/x/forms/newsletter' } });
  });
});
