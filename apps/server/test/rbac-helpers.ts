// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared RBAC/audit/api-keys test harness (not collected — no .test suffix).
 *
 * Builds the real server (buildServer) on an in-memory better-sqlite3 meta
 * store bootstrapped with `firstRun`, registers a stub session-auth hook
 * (`x-test-user-id` header → `request.user`, standing in for plugins/auth.ts),
 * the rbac plugin, and this wave's route plugins under /api/v1 — plus two
 * tiny guarded probe routes for permission-matrix assertions.
 */
import BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import {
  createSqliteMetaDb,
  firstRun,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { apiKeysRoutes } from '../src/routes/api-keys/index.js';
import { auditRoutes } from '../src/routes/audit/index.js';
import { rolesRoutes } from '../src/routes/roles/index.js';
import { makeEnv } from './helpers.js';

export interface RbacTestContext {
  app: AdminiumServer;
  meta: MetaDb;
  users: { superAdmin: User; admin: User; editor: User; viewer: User };
  roles: { superAdmin: Role; admin: Role; editor: Role; viewer: Role };
}

export interface BuildRbacTestAppOptions {
  /** Injectable clock forwarded to the rbac plugin. */
  now?: () => number;
}

/** Header identifying the acting session user to the stub auth hook. */
export function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

export function asApiKey(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

const probeReply = z.object({ ok: z.literal(true) });

export async function buildRbacTestApp(opts: BuildRbacTestAppOptions = {}): Promise<RbacTestContext> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const permissions = permissionsRepo(meta);

  async function builtin(slug: string): Promise<Role> {
    const role = await roles.findBySlug(slug);
    if (role === null) throw new Error(`missing built-in role ${slug}`);
    return role;
  }
  const roleSet = {
    superAdmin: await builtin('super-admin'),
    admin: await builtin('admin'),
    editor: await builtin('editor'),
    viewer: await builtin('viewer'),
  };

  // 08 §5.1: admin manages users; the meta seed is narrower, so grant it here.
  await permissions.grant(roleSet.admin.id, 'system', 'users.manage', { allowed: true });

  async function makeUser(name: string, role: Role): Promise<User> {
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const userSet = {
    superAdmin: await makeUser('Ava', roleSet.superAdmin),
    admin: await makeUser('Noah', roleSet.admin),
    editor: await makeUser('Mia', roleSet.editor),
    viewer: await makeUser('Liam', roleSet.viewer),
  };

  const app = await buildServer({ env: makeEnv(), logger: false });

  // Stub for plugins/auth.ts: x-test-user-id → request.user.
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

  await app.register(rbacPlugin, { meta, ...(opts.now !== undefined ? { now: opts.now } : {}) });

  await app.register(
    async (api) => {
      await api.register(rolesRoutes);
      await api.register(auditRoutes);
      await api.register(apiKeysRoutes);

      // Guarded probes for matrix tests.
      api.get(
        '/probe/users-manage',
        {
          preHandler: api.rbac.require('system:users:manage'),
          schema: { response: { 200: probeReply } },
        },
        async () => ({ ok: true as const }),
      );
      api.get(
        '/probe/orders-read',
        {
          preHandler: api.rbac.require('table:conn_1:public.orders:read'),
          schema: { response: { 200: probeReply } },
        },
        async () => ({ ok: true as const }),
      );
    },
    { prefix: '/api/v1' },
  );

  await app.ready();
  return { app, meta, users: userSet, roles: roleSet };
}
