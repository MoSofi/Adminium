// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `DELETE /api/v1/public-scopes/:id` against the keys under the scope.
 *
 * A key is `restrict` on its scope, and a revoked key keeps its row — nothing
 * in the product removes one. The route used to refuse while ANY key row
 * pointed at the scope, so a scope that ever had a key could never be deleted,
 * and its refusal told the operator to revoke, which did not help. Now only a
 * LIVE key refuses (a typed 409 naming it); revoked and expired keys go with
 * the scope, and the delete's audit row names them.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  publicKeysRepo,
  publicScopesRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { publicAdminRoutes } from '../src/routes/public-admin/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  admin: User;
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const users = usersRepo(meta);
  const roles = rolesRepo(meta);
  const admin = await users.create({
    email: 'ava@adminium.test',
    name: 'Ava',
    passwordHash: 'test-hash',
    status: 'active',
  });
  const role = await roles.findBySlug('super-admin');
  if (role === null) throw new Error('missing built-in role super-admin');
  await roles.assignToUser(admin.id, role.id);

  const crypto = dsnCryptoFromSecret(TEST_SECRET);
  const app = await buildServer({ env: makeEnv(), logger: false });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id !== 'string') return;
    const user = await users.findById(id);
    if (user === null) return;
    (request as unknown as { user: { id: string; name: string; email: string } }).user = {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(publicAdminRoutes({ meta, env: makeEnv(), crypto }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, meta, admin };
}

describe('DELETE /public-scopes/:id', () => {
  let t: Harness;
  let scopeId: string;

  beforeEach(async () => {
    t = await buildHarness();
    const connection = await connectionsRepo(t.meta, dsnCryptoFromSecret(TEST_SECRET)).create({
      name: 'Shop',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/shop',
    });
    const scope = await publicScopesRepo(t.meta).create({
      connectionId: connection.id,
      side: 'customer',
      name: 'storefront',
      timezone: 'Europe/London',
      document: '{}',
    });
    scopeId = scope.id;
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const seedKey = (prefix: string) =>
    publicKeysRepo(t.meta).create({
      name: 'web',
      prefix,
      tokenHash: 'h'.repeat(64),
      tokenEncrypted: 'sealed',
      scopeId,
      side: 'customer',
    });

  const remove = () =>
    t.app.inject({
      method: 'DELETE',
      url: `/api/v1/public-scopes/${scopeId}`,
      headers: { 'x-test-user-id': t.admin.id },
    });

  it('refuses with PUBLIC_KEYS_LIVE while a key is live, then clears it once revoked', async () => {
    const key = await seedKey('adm_pub_storewb1');

    const refused = await remove();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'PUBLIC_KEYS_LIVE',
      details: { keys: [{ id: key.id, name: 'web', prefix: 'adm_pub_storewb1', scopeId }] },
    });
    expect(await publicScopesRepo(t.meta).findById(scopeId)).not.toBeNull();

    // Revoking is now enough. It used to leave the scope undeletable forever.
    await publicKeysRepo(t.meta).revoke(key.id);
    const ok = await remove();
    expect(ok.statusCode).toBe(200);
    expect(await publicScopesRepo(t.meta).findById(scopeId)).toBeNull();
    expect(await publicKeysRepo(t.meta).findById(key.id)).toBeNull();

    const [audit] = await auditRepo(t.meta).list({ category: 'system', limit: 1 });
    expect(audit?.action).toBe('public-scope.delete');
    expect(audit?.changes).toMatchObject({
      before: { scopeId, name: 'storefront', publicKeys: [{ keyId: key.id, prefix: 'adm_pub_storewb1' }] },
    });
  });

  it('deletes a scope with no keys and names none in the audit row', async () => {
    const ok = await remove();
    expect(ok.statusCode).toBe(200);
    const [audit] = await auditRepo(t.meta).list({ category: 'system', limit: 1 });
    expect(audit?.changes).toEqual({ before: { scopeId, name: 'storefront' } });
  });
});
