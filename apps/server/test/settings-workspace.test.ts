/**
 * GET /api/v1/settings/workspace + PUT /settings/branding (M5-T05, 08 §2.16
 * sectioned puts): registry-backed defaults, a persisted write with audit
 * before/after images, Zod bounds → 422, and the super-admin guard. Mirrors
 * the settings-defaults suite's harness.
 *
 * The `auth.*` security controls are intentionally not exposed as a settings
 * surface (no auth flow enforces them yet), so there is no /settings/security
 * route to exercise here.
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
      branding: { appName: 'Adminium' },
    });
  });

  it('PUT /settings/branding persists the app name and audits before/after', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/branding',
      headers: asUser(t.superAdmin),
      payload: { appName: 'Acme Ops' },
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

  it('rejects out-of-bounds values with 422 (mirrors the registry bounds)', async () => {
    for (const payload of [
      { appName: '' },
      { appName: 'x'.repeat(61) },
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

  it('does not expose a /settings/security surface (auth.* not enforced yet)', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/security',
      headers: asUser(t.superAdmin),
      payload: { require2fa: true, allowSignup: true, sessionTtlHours: 24, passwordMinLength: 12 },
    });
    expect(res.statusCode).toBe(404);
    // The registry defaults stay untouched — nothing wrote inert security config.
    const settings = settingsRepo(t.meta);
    expect(await settings.get('auth.require2fa')).toBe(false);
    expect(await settings.get('auth.sessionTtlHours')).toBe(720);
    expect(await settings.get('auth.passwordMinLength')).toBe(10);
  });

  it('requires system:settings:manage — admin 403, anonymous 401, nothing persists', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/v1/settings/workspace', undefined],
      ['PUT', '/api/v1/settings/branding', { appName: 'Nope' }],
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
