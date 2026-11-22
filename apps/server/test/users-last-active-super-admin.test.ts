// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WORKSPACE KEEPS A SUPER ADMIN WHO CAN ACT.
 *
 * Only somebody active can reinstate anybody, so the last-Super-Admin guard
 * counts active holders. A suspended one neither lets the last active one go
 * nor is protected as if they were the last. On every meta engine.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { rolesRepo, usersRepo, type MetaDb, type Role, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { rolesRoutes } from '../src/routes/roles/index.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaEngine, type MetaHandle } from './meta-dialects.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  role: Role;
  a: User;
  c: User;
}

let handle: MetaHandle | undefined;
let app: AdminiumServer | undefined;

afterEach(async () => {
  await app?.close();
  await handle?.destroy();
  app = undefined;
  handle = undefined;
});

async function build(engine: MetaEngine): Promise<Harness> {
  handle = await engine.make();
  const { meta } = handle;
  const role = (await rolesRepo(meta).findBySlug('super-admin'))!;
  const holder = async (name: string): Promise<User> => {
    const user = await usersRepo(meta).create({ email: `${name}@adminium.test`, name, passwordHash: 'test-hash', status: 'active' });
    await rolesRepo(meta).assignToUser(user.id, role.id);
    return user;
  };
  const a = await holder('a');
  const c = await holder('c');
  app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id !== 'string') return;
    const user = await usersRepo(meta).findById(id);
    if (user !== null) (request as unknown as { user: { id: string; name: string; email: string } }).user = { id: user.id, name: user.name, email: user.email };
  });
  await app.register(rbacPlugin, { meta });
  await app.register(async (api) => {
    await api.register(usersRoutes);
    await api.register(rolesRoutes);
  }, { prefix: '/api/v1' });
  await app.ready();
  return { app, meta, role, a, c };
}

const as = (user: User) => ({ 'x-test-user-id': user.id });

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the last active Super Admin (${engine.name})`, () => {
    it('cannot give up the role while the only other holder is suspended', async () => {
      const h = await build(engine);
      expect((await h.app.inject({ method: 'PATCH', url: `/api/v1/users/${h.c.id}`, headers: as(h.a), payload: { status: 'suspended' } })).statusCode).toBe(200);
      const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/users/${h.a.id}/roles/${h.role.id}`, headers: as(h.a) });
      expect(removed.statusCode, removed.body).toBe(409);
      const replaced = await h.app.inject({ method: 'PUT', url: `/api/v1/users/${h.a.id}/roles`, headers: as(h.a), payload: { roleIds: [] } });
      expect(replaced.statusCode, replaced.body).toBe(409);
      expect((await rolesRepo(h.meta).rolesForUser(h.a.id)).map((role) => role.id)).toEqual([h.role.id]);
    });

    it('cannot suspend or delete themselves as the last one who can act', async () => {
      const h = await build(engine);
      await usersRepo(h.meta).updateStatus(h.c.id, 'suspended');
      expect((await h.app.inject({ method: 'PATCH', url: `/api/v1/users/${h.a.id}`, headers: as(h.a), payload: { status: 'suspended' } })).statusCode).toBe(409);
      expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/users/${h.a.id}?permanent=true`, headers: as(h.a) })).statusCode).toBe(409);
      expect((await usersRepo(h.meta).findById(h.a.id))?.status).toBe('active');
    });

    it('may take the role from a suspended holder', async () => {
      const h = await build(engine);
      await usersRepo(h.meta).updateStatus(h.c.id, 'suspended');
      const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/users/${h.c.id}/roles/${h.role.id}`, headers: as(h.a) });
      expect(removed.statusCode, removed.body).toBe(200);
    });

    it('may step down while another active Super Admin remains', async () => {
      const h = await build(engine);
      const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/users/${h.a.id}/roles/${h.role.id}`, headers: as(h.a) });
      expect(removed.statusCode, removed.body).toBe(200);
    });
  });
}
