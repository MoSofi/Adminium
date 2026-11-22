// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A STOPPED ACCOUNT, OR A CORRECTED ADDRESS, LEAVES BEHIND. Links are
 * minted by one feature and honoured by another, so each is walked here across
 * the seam: an invitation or reset link after its address was corrected, what
 * a stopped person issued, a session that slipped past the stop, and an
 * activation that was under way while the account was suspended.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFirstSuperAdmin, passwordResetsRepo, rolesRepo, sessionsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createSession, hashToken } from '../src/auth/sessions.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { ADMIN_EMAIL, adminPasswordHash } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const hashing = vi.hoisted(() => ({ during: null as null | (() => Promise<void>) }));
vi.mock('../src/auth/passwords.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/auth/passwords.js')>();
  return {
    ...real,
    hashPassword: async (plain: string) => {
      const during = hashing.during;
      hashing.during = null;
      if (during !== null) await during();
      return real.hashPassword(plain);
    },
  };
});

const NEW_PASSWORD = 'a-brand-new-long-passphrase';

describe.each(META_ENGINES.map((engine) => [engine.name, engine] as const))('what a stopped account leaves behind — %s', (_name, engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  let admin: string;
  let seq = 0;

  const address = (who: string) => `${who}${String((seq += 1))}@example.com`;
  /** Who acts: the stub below signs a request in as this person. */
  const signIn = async (email: string): Promise<string> => (await usersRepo(meta).findByEmail(email))!.id;
  const superAdmin = async (): Promise<{ user: User; cookie: string }> => {
    const email = address('boss');
    const user = await usersRepo(meta).create({ email, name: 'Rae Boss', passwordHash: await adminPasswordHash() });
    await rolesRepo(meta).assignToUser(user.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    return { user, cookie: await signIn(email) };
  };
  const invite = async (cookie: string): Promise<{ id: string; token: string }> => {
    const roleId = (await rolesRepo(meta).findBySlug('admin'))!.id;
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: { 'x-test-user-id': cookie }, payload: { email: address('new'), name: 'Noa New', roleIds: [roleId] } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data?: { user: { id: string }; invite: { token: string } }; user?: { id: string }; invite?: { token: string } };
    const made = body.data ?? (body as { user: { id: string }; invite: { token: string } });
    return { id: made.user.id, token: made.invite.token };
  };
  const patch = (cookie: string, id: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/v1/users/${id}`, headers: { 'x-test-user-id': cookie }, payload });
  const redeem = (token: string) => app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', remoteAddress: `10.78.${String(Math.floor((seq += 1) / 200))}.${String(seq % 200)}`, payload: { token, newPassword: NEW_PASSWORD } });
  const resetLink = async (userId: string): Promise<string> => {
    const token = `rst_${String((seq += 1))}${'k'.repeat(40)}`;
    await passwordResetsRepo(meta).create({ userId, kind: 'reset', tokenHash: hashToken(token), expiresAt: Date.now() + 600_000 });
    return token;
  };
  const connectLink = async (createdBy: string): Promise<string> => {
    const id = `clk_${String((seq += 1))}`;
    await meta.db
      .insertInto('adminium_connect_links')
      .values({ id, connectionId: 'con_t', tableName: 'team', rowKey: id, providers: JSON.stringify(['calendar']), purpose: 'connect', tokenHash: id.padEnd(64, 'h'), createdBy, addressDigest: null, expiresAt: Date.now() + 600_000, createdAt: Date.now() } as never)
      .execute();
    return id;
  };
  const linkStands = async (id: string) => (await meta.db.selectFrom('adminium_connect_links').select('id').where('id', '=', id).executeTakeFirst()) !== undefined;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: 'Ava Reyes', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await usersRepo(meta).findById(id);
      if (user !== null) (request as unknown as { user: { id: string; name: string; email: string } }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(usersRoutes), { prefix: '/api/v1' });
    await app.ready();
    admin = await signIn(ADMIN_EMAIL);
  }, 120_000);

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  it.skipIf(!engine.available)('an invitation a suspended admin issued no longer activates', async () => {
    const issuer = await superAdmin();
    const made = await invite(issuer.cookie);
    expect((await patch(admin, issuer.user.id, { status: 'suspended' })).statusCode).toBe(200);
    expect((await redeem(made.token)).statusCode).toBe(401);
    expect((await usersRepo(meta).findById(made.id))!.status).toBe('invited');
  });

  it.skipIf(!engine.available)('an invitation a removed admin issued no longer activates', async () => {
    const issuer = await superAdmin();
    const made = await invite(issuer.cookie);
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/users/${issuer.user.id}?permanent=true`, headers: { 'x-test-user-id': admin } });
    expect(res.statusCode, res.body).toBe(200);
    expect((await redeem(made.token)).statusCode).toBe(401);
  });

  it.skipIf(!engine.available)("a colleague's invitation survives another admin's suspension", async () => {
    const issuer = await superAdmin();
    const kept = await invite(admin);
    expect((await patch(admin, issuer.user.id, { status: 'suspended' })).statusCode).toBe(200);
    expect((await redeem(kept.token)).statusCode).toBe(200);
  });

  it.skipIf(!engine.available)('the connect links a stopped person made end, and a colleague’s stay', async () => {
    const stopped = await superAdmin();
    const removed = await superAdmin();
    const theirs = await connectLink(stopped.user.id);
    const gone = await connectLink(removed.user.id);
    const other = await connectLink((await usersRepo(meta).findByEmail(ADMIN_EMAIL))!.id);
    expect((await patch(admin, stopped.user.id, { status: 'suspended' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/${removed.user.id}?permanent=true`, headers: { 'x-test-user-id': admin } })).statusCode).toBe(200);
    expect(await linkStands(theirs)).toBe(false);
    expect(await linkStands(gone)).toBe(false);
    expect(await linkStands(other)).toBe(true);
  });

  it.skipIf(!engine.available)('a reset link from before a suspension does not work after reinstating', async () => {
    const { user } = await superAdmin();
    const token = await resetLink(user.id);
    expect((await patch(admin, user.id, { status: 'suspended' })).statusCode).toBe(200);
    expect((await patch(admin, user.id, { status: 'active' })).statusCode).toBe(200);
    expect((await redeem(token)).statusCode).toBe(401);
  });

  it.skipIf(!engine.available)('a session that slipped past the stop does not come back with the account', async () => {
    const { user } = await superAdmin();
    expect((await patch(admin, user.id, { status: 'suspended' })).statusCode).toBe(200);
    // A sign-in that read `active` a moment before the stop, and wrote its session a moment after.
    const late = await createSession(meta, user.id);
    expect((await patch(admin, user.id, { status: 'active' })).statusCode).toBe(200);
    const row = await sessionsRepo(meta).findById(late.session.id);
    expect(row?.revokedAt ?? null).not.toBeNull();
  });

  it.skipIf(!engine.available)('an activation under way does not undo a suspension', async () => {
    const made = await invite(admin);
    hashing.during = async () => {
      expect((await patch(admin, made.id, { status: 'suspended' })).statusCode).toBe(200);
    };
    expect((await redeem(made.token)).statusCode).toBe(401);
    expect((await usersRepo(meta).findById(made.id))!.status).toBe('suspended');
  });
});
