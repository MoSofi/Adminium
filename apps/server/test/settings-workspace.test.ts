// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /api/v1/settings/workspace + PUT /settings/branding (M5-T05, 08 §2.16
 * sectioned puts): registry-backed defaults, a persisted write with audit
 * before/after images, Zod bounds → 422, and the super-admin guard. Mirrors
 * the settings-defaults suite's harness.
 *
 * `PUT /settings/security` joins them now that the three keys it writes are
 * enforced (auth/sessions.ts + routes/auth/handlers.ts, exercised end to end
 * in auth-sessions.test.ts). `auth.allowSignup` is still not exposed — no
 * signup path reads it — and must stay untouched by this surface.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { settingsRoutes } from '../src/routes/settings/index.js';
import { makeEnv } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdmin: User;
  admin: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const superAdmin = await makeUser('Ava', 'super-admin');
  const admin = await makeUser('Noah', 'admin');

  const app = await buildServer({ env: makeEnv(), logger: false });

  // Stub for plugins/auth.ts: x-test-user-id header → request.user.
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });

  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(settingsRoutes({ meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, superAdmin, admin };
}

describe('settings workspace routes', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('GET returns registry defaults on a fresh install', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/settings/workspace',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      // `logoUrl`, not `logoFileId`: how a file id becomes bytes is this
      // route's business, not the client's.
      branding: { appName: 'Adminium', logoUrl: null, showVersion: true },
    });
  });

  it('PUT /settings/branding persists the app name and audits before/after', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/branding',
      headers: asUser(t.superAdmin),
      payload: { appName: 'Acme Ops', showVersion: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.branding.appName).toBe('Acme Ops');
    expect(await settingsRepo(t.meta).get('branding.appName')).toBe('Acme Ops');

    const entry = (await auditRepo(t.meta).list({ category: 'settings' })).find(
      (e) => e.action === 'settings.branding.update',
    );
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(t.superAdmin.id);
    expect(entry?.changes?.before).toMatchObject({ appName: 'Adminium' });
    expect(entry?.changes?.after).toMatchObject({ appName: 'Acme Ops' });
  });

  it('PUT /settings/branding hides the sidebar version chip', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/branding',
      headers: asUser(t.superAdmin),
      payload: { appName: 'Adminium', showVersion: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.branding.showVersion).toBe(false);
    expect(await settingsRepo(t.meta).get('branding.showVersion')).toBe(false);
  });

  it('rejects out-of-bounds values with 422 (mirrors the registry bounds)', async () => {
    for (const payload of [
      { appName: '', showVersion: true },
      { appName: 'x'.repeat(61), showVersion: true },
      { appName: 'Acme Ops', showVersion: 'yes' },
    ]) {
      const res = await t.app.inject({
        method: 'PUT',
        url: '/api/v1/settings/branding',
        headers: asUser(t.superAdmin),
        payload,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(await settingsRepo(t.meta).get('branding.appName')).toBe('Adminium');
  });

  it('GET /settings/security returns the registry defaults', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/settings/security',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      sessionTtlHours: 720,
      require2fa: false,
      passwordMinLength: 10,
    });
  });

  it('PUT /settings/security persists the three enforced keys and audits them', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/security',
      headers: asUser(t.superAdmin),
      // `allowSignup` rides along: nothing enforces it, so the body drops it.
      payload: { require2fa: true, allowSignup: true, sessionTtlHours: 24, passwordMinLength: 12 },
    });
    expect(res.statusCode).toBe(200);

    const settings = settingsRepo(t.meta);
    expect(await settings.get('auth.require2fa')).toBe(true);
    expect(await settings.get('auth.sessionTtlHours')).toBe(24);
    expect(await settings.get('auth.passwordMinLength')).toBe(12);
    expect(await settings.get('auth.allowSignup')).toBe(false);

    const entry = (await auditRepo(t.meta).list({ category: 'settings' })).find(
      (e) => e.action === 'settings.security.update',
    );
    expect(entry?.actorId).toBe(t.superAdmin.id);
    expect(entry?.changes?.before).toMatchObject({ sessionTtlHours: 720, require2fa: false });
    expect(entry?.changes?.after).toMatchObject({ sessionTtlHours: 24, require2fa: true });
  });

  it('rejects security values outside the registry bounds with 422', async () => {
    for (const payload of [
      { require2fa: false, sessionTtlHours: 0, passwordMinLength: 12 },
      { require2fa: false, sessionTtlHours: 8_761, passwordMinLength: 12 },
      { require2fa: false, sessionTtlHours: 24, passwordMinLength: 7 },
      { require2fa: false, sessionTtlHours: 24, passwordMinLength: 129 },
    ]) {
      const res = await t.app.inject({
        method: 'PUT',
        url: '/api/v1/settings/security',
        headers: asUser(t.superAdmin),
        payload,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    const settings = settingsRepo(t.meta);
    expect(await settings.get('auth.sessionTtlHours')).toBe(720);
    expect(await settings.get('auth.passwordMinLength')).toBe(10);
  });

  it('requires system:settings:manage — admin 403, anonymous 401, nothing persists', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/v1/settings/workspace', undefined],
      ['PUT', '/api/v1/settings/branding', { appName: 'Nope', showVersion: false }],
      ['GET', '/api/v1/settings/security', undefined],
      [
        'PUT',
        '/api/v1/settings/security',
        { require2fa: true, sessionTtlHours: 1, passwordMinLength: 128 },
      ],
    ] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: asUser(t.admin),
        ...(payload === undefined ? {} : { payload }),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.details.permission).toBe('system:settings:manage');
    }
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/settings/workspace' });
    expect(anon.statusCode).toBe(401);
    expect(await settingsRepo(t.meta).get('branding.appName')).toBe('Adminium');
  });
});
