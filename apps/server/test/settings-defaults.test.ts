// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET/PUT /api/v1/settings/defaults (10-i18n-theming.md §7.2, M8-T04):
 * defaults + adoption counts, full-object write with audit (category
 * `settings`) and the `settings.defaults.updated` broadcast on the
 * `config-changed` channel, RBAC denial for non-super-admins.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  settingsRepo,
  userPrefsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { RealtimeHub, type RealtimeEvent } from '../src/realtime/hub.js';
import { settingsRoutes, SETTINGS_DEFAULTS_UPDATED } from '../src/routes/settings/index.js';
import { makeEnv } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  hub: RealtimeHub;
  events: RealtimeEvent[];
  superAdmin: User;
  admin: User;
  viewer: User;
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
  const viewer = await makeUser('Liam', 'viewer');

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

  const hub = new RealtimeHub();
  const events: RealtimeEvent[] = [];
  hub.subscribe('config-changed', (event) => events.push(event));
  app.decorate('realtime', hub);

  await app.register(
    async (api) => {
      await api.register(settingsRoutes({ meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, hub, events, superAdmin, admin, viewer };
}

describe('settings defaults routes', () => {
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
      url: '/api/v1/settings/defaults',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.theme).toBe('system');
    expect(data.accent).toBe('indigo');
    expect(data.density).toBe('comfortable');
    expect(data.locale).toBe('en_US');
    expect(data.adoption.totalUsers).toBe(3);
    // Nobody has overrides yet — everyone follows every axis.
    expect(data.adoption.following).toEqual({ theme: 3, accent: 3, density: 3, locale: 3 });
  });

  it('adoption counts NULL-per-axis overrides (users following the default)', async () => {
    const prefs = userPrefsRepo(t.meta);
    // Viewer overrides theme+accent; admin overrides locale; super-admin inherits all.
    await prefs.set(t.viewer.id, { theme: 'dark', accent: 'teal' });
    await prefs.set(t.admin.id, { locale: 'de_DE' });
    // A cleared (NULL) axis counts as following again.
    await prefs.set(t.admin.id, { theme: 'light' });
    await prefs.set(t.admin.id, { theme: null });

    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/settings/defaults',
      headers: asUser(t.superAdmin),
    });
    expect(res.json().data.adoption).toEqual({
      totalUsers: 3,
      following: { theme: 2, accent: 2, density: 3, locale: 2 },
    });
  });

  it('PUT persists the full object, audits, and broadcasts settings.defaults.updated', async () => {
    const body = { theme: 'dark', accent: 'teal', density: 'compact', locale: 'de_DE' };
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/defaults',
      headers: asUser(t.superAdmin),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject(body);

    // Persisted through the settings registry.
    const settings = settingsRepo(t.meta);
    expect(await settings.get('appearance.theme')).toBe('dark');
    expect(await settings.get('appearance.accent')).toBe('teal');
    expect(await settings.get('appearance.density')).toBe('compact');
    expect(await settings.get('locale.default')).toBe('de_DE');

    // Audit entry: category settings, before/after images.
    const audit = await auditRepo(t.meta).list({ category: 'settings' });
    const entry = audit.find((e) => e.action === 'settings.defaults.update');
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(t.superAdmin.id);
    expect(entry?.changes?.before).toMatchObject({ theme: 'system', locale: 'en_US' });
    expect(entry?.changes?.after).toMatchObject(body);

    // Realtime broadcast on the config-changed channel (§7.2).
    const event = t.events.find((e) => e.type === SETTINGS_DEFAULTS_UPDATED);
    expect(event).toBeDefined();
    expect(event?.channel).toBe('config-changed');
    expect(event?.data).toEqual(body);

    // A subsequent GET reflects the new defaults (server-resolved, §7.2).
    const after = await t.app.inject({
      method: 'GET',
      url: '/api/v1/settings/defaults',
      headers: asUser(t.superAdmin),
    });
    expect(after.json().data).toMatchObject(body);
  });

  it('PUT changes resolution for users following the default, not for overriders', async () => {
    const prefs = userPrefsRepo(t.meta);
    await prefs.set(t.viewer.id, { theme: 'light' });

    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/defaults',
      headers: asUser(t.superAdmin),
      payload: { theme: 'dark', accent: 'indigo', density: 'comfortable', locale: 'en_US' },
    });

    expect((await prefs.resolve(t.admin.id)).theme).toBe('dark'); // follows default
    expect((await prefs.resolve(t.viewer.id)).theme).toBe('light'); // override wins
  });

  it('rejects invalid axis values with 422', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/defaults',
      headers: asUser(t.superAdmin),
      payload: { theme: 'dark', accent: 'chartreuse', density: 'compact', locale: 'de_DE' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('requires system:settings:manage — admin and viewer get 403, anonymous 401', async () => {
    for (const user of [t.admin, t.viewer]) {
      for (const method of ['GET', 'PUT'] as const) {
        const res = await t.app.inject({
          method,
          url: '/api/v1/settings/defaults',
          headers: asUser(user),
          ...(method === 'PUT'
            ? { payload: { theme: 'dark', accent: 'teal', density: 'compact', locale: 'de_DE' } }
            : {}),
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.details.permission).toBe('system:settings:manage');
      }
    }
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/settings/defaults' });
    expect(anon.statusCode).toBe(401);
    // Denied writes never persist or broadcast.
    expect(await settingsRepo(t.meta).get('appearance.theme')).toBe('system');
    expect(t.events.filter((e) => e.type === SETTINGS_DEFAULTS_UPDATED)).toHaveLength(0);
  });
});
