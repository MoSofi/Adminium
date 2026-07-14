/**
 * Onboarding-state (M5-T06): the pure reactive derivation plus the route —
 * each fact flips exactly one step, the surface is admin-guarded, and dismissal
 * persists per user.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { onboardingRoutes } from '../src/routes/onboarding/index.js';
import { deriveChecklist } from '../src/routes/onboarding/derive.js';
import { makeEnv } from './helpers.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdmin: User;
  admin: User;
  viewer: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

function stepMap(steps: Array<{ key: string; done: boolean }>): Record<string, boolean> {
  return Object.fromEntries(steps.map((s) => [s.key, s.done]));
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
  await app.register(async (api) => api.register(onboardingRoutes({ meta })), { prefix: '/api/v1' });
  await app.ready();

  return { app, meta, superAdmin, admin, viewer };
}

describe('deriveChecklist (pure)', () => {
  it('is all-incomplete with a bare workspace', () => {
    const result = deriveChecklist({
      connectionCount: 0,
      hasIncludedTables: false,
      userCount: 1,
      hasWorkspaceDefaults: false,
      canManageWorkspaceDefaults: true,
    });
    expect(result.doneCount).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.totalCount).toBe(4);
  });

  it('completes when every fact is satisfied', () => {
    const result = deriveChecklist({
      connectionCount: 2,
      hasIncludedTables: true,
      userCount: 4,
      hasWorkspaceDefaults: true,
      canManageWorkspaceDefaults: true,
    });
    expect(stepMap(result.steps)).toEqual({
      'connect-database': true,
      'choose-tables': true,
      'invite-teammates': true,
      'workspace-defaults': true,
    });
    expect(result.complete).toBe(true);
  });

  it('omits the super-admin-only workspace-defaults step for a plain admin', () => {
    const result = deriveChecklist({
      connectionCount: 2,
      hasIncludedTables: true,
      userCount: 4,
      hasWorkspaceDefaults: false,
      canManageWorkspaceDefaults: false,
    });
    // Only 3 steps — the /settings/defaults CTA (forbidden for plain admins) is
    // never surfaced, and it doesn't count against completion.
    expect(result.totalCount).toBe(3);
    expect(Object.keys(stepMap(result.steps))).not.toContain('workspace-defaults');
    expect(result.complete).toBe(true);
  });
});

describe('onboarding routes', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  async function getChecklist(user: User): Promise<Record<string, boolean>> {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(user) });
    expect(res.statusCode).toBe(200);
    return stepMap(res.json().data.checklist.steps);
  }

  it('reacts to real workspace state, one fact per step', async () => {
    // Baseline: 3 seeded users (> 1 ⇒ invite done); nothing else configured.
    expect(await getChecklist(t.superAdmin)).toEqual({
      'connect-database': false,
      'choose-tables': false,
      'invite-teammates': true,
      'workspace-defaults': false,
    });

    // A connection ticks "connect a database" (but not "choose your tables").
    const connections = connectionsRepo(t.meta, testCrypto);
    const connection = await connections.create({
      name: 'northwind',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@localhost/northwind',
    });
    expect(await getChecklist(t.superAdmin)).toMatchObject({
      'connect-database': true,
      'choose-tables': false,
    });

    // Persisting an inclusion ticks "choose your tables".
    await connections.update(connection.id, { settings: { includedTables: ['public.customers'] } });
    expect((await getChecklist(t.superAdmin))['choose-tables']).toBe(true);

    // Saving a workspace default ticks the last step ⇒ complete.
    await settingsRepo(t.meta).set('appearance.theme', 'dark');
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(t.superAdmin) });
    expect(res.json().data.checklist.complete).toBe(true);
  });

  it('is reachable by admins and denied to viewers', async () => {
    const adminRes = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(t.admin) });
    expect(adminRes.statusCode).toBe(200);
    const viewerRes = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(t.viewer) });
    expect(viewerRes.statusCode).toBe(403);
  });

  it('scopes the workspace-defaults step to super admins', async () => {
    // Super admin can manage /settings/defaults → the step is present.
    expect(await getChecklist(t.superAdmin)).toHaveProperty('workspace-defaults');
    // A plain admin cannot reach that super-admin-only surface → no dead-end step.
    const adminSteps = await getChecklist(t.admin);
    expect(adminSteps).not.toHaveProperty('workspace-defaults');
    const adminRes = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(t.admin) });
    expect(adminRes.json().data.checklist.totalCount).toBe(3);
  });

  it('persists per-user dismissal', async () => {
    const before = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(t.admin) });
    expect(before.json().data.dismissed).toBe(false);

    const dismiss = await t.app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/dismiss',
      headers: asUser(t.admin),
      payload: { dismissed: true },
    });
    expect(dismiss.statusCode).toBe(200);
    expect(dismiss.json().data.dismissed).toBe(true);

    // Sticky for that user; a different admin is unaffected.
    const after = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(t.admin) });
    expect(after.json().data.dismissed).toBe(true);
    const other = await t.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: asUser(t.superAdmin) });
    expect(other.json().data.dismissed).toBe(false);
  });
});
