// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LAN share, server side (11-electron.md §8.3): `GET /api/v1/desktop/lan-share`'s
 * gates and counts, `lanShareActive`'s bind reading, and §8.3's audit-log
 * promise.
 *
 * ─── The audit-log block is an ACCEPTANCE CRITERION, not a nice-to-have ──────
 *
 * §8.3: "the audit log (`adminium_audit_log`) records their LAN IPs." That is a
 * claim about a real login over a real socket, so it is tested as one — a
 * request from 192.168.1.24 through the actual `/auth/login` route, then a read
 * of the row it wrote. Asserting that `auditAuth` passes `request.ip` somewhere
 * would prove nothing about what Fastify puts in `request.ip`, which is the only
 * part that can actually be wrong.
 *
 * ─── Gate 1 IS covered here ─────────────────────────────────────────────────
 *
 * Unlike `desktop-backup-route.test.ts`, whose track could not touch
 * `compose.ts`: this one registers the route, so `composeServer` is exercised
 * directly and "the route exists only under the desktop runtime" is a real
 * assertion rather than a report.
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  sessionsRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { isWildcardBindHost, lanShareActive } from '../src/desktop/lan-share.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { desktopLanRoutes } from '../src/routes/desktop-lan/index.js';
import { makeEnv } from './helpers.js';

const URL = '/api/v1/desktop/lan-share';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdmin: User;
  viewer: User;
  destroy: () => Promise<void>;
}

async function harness(opts: { host?: string } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-lan-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(join(dir, 'meta.db')) });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const superAdminRole = await roles.findBySlug('super-admin');
  const viewerRole = await roles.findBySlug('viewer');
  if (superAdminRole === null || viewerRole === null) throw new Error('missing built-in roles');

  const make = async (name: string, roleId: string): Promise<User> => {
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, roleId);
    return user;
  };
  const superAdmin = await make('Ava', superAdminRole.id);
  const viewer = await make('Liam', viewerRole.id);

  const env = makeEnv({ ADMINIUM_RUNTIME: 'desktop', HOST: opts.host ?? '0.0.0.0' });
  const app = await buildServer({ env, logger: false, metaDb: meta });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id !== 'string') return;
    const user = await users.findById(id);
    if (user !== null) request.user = user;
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(desktopLanRoutes({ meta, env }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return {
    app,
    meta,
    superAdmin,
    viewer,
    destroy: async () => {
      await app.close();
      await meta.db.destroy();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function get(h: Harness, opts: { user?: User; remoteAddress?: string } = {}) {
  return h.app.inject({
    method: 'GET',
    url: URL,
    ...(opts.user === undefined ? {} : { headers: { 'x-test-user-id': opts.user.id } }),
    ...(opts.remoteAddress === undefined ? {} : { remoteAddress: opts.remoteAddress }),
  });
}

function body(res: { json: () => unknown }): {
  active: boolean;
  host: string;
  lanSessions: number;
  otherUsers: number;
} {
  return (res.json() as { data: ReturnType<typeof body> }).data;
}

let t: Harness | null = null;
afterEach(async () => {
  await t?.destroy();
  t = null;
});

describe('lanShareActive (§8.1, §8.3)', () => {
  it('is true only for a desktop process bound to every interface', () => {
    expect(lanShareActive({ ADMINIUM_RUNTIME: 'desktop', HOST: '0.0.0.0' })).toBe(true);
    expect(lanShareActive({ ADMINIUM_RUNTIME: 'desktop', HOST: '127.0.0.1' })).toBe(false);
  });

  it('is FALSE for a self-host server bound wide — that is a reverse proxy, not §8.3', () => {
    // Every Docker deployment binds 0.0.0.0. Reporting `true` for them would
    // make §8.1's chip meaningless on the one runtime that renders it.
    expect(lanShareActive({ ADMINIUM_RUNTIME: 'self-host', HOST: '0.0.0.0' })).toBe(false);
  });

  it('reads the IPv6 wildcard as wide too', () => {
    expect(isWildcardBindHost('::')).toBe(true);
    expect(isWildcardBindHost('[::]')).toBe(true);
    // A specific LAN address is reachable but is not a wildcard, and the shell
    // never produces one (§8.3 flips between loopback and 0.0.0.0, nothing else).
    expect(isWildcardBindHost('192.168.1.5')).toBe(false);
  });
});

describe('GET /desktop/lan-share', () => {
  it('reports the bind and the counts to a loopback super admin', async () => {
    t = await harness();
    const res = await get(t, { user: t.superAdmin, remoteAddress: '127.0.0.1' });

    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({ active: true, host: '0.0.0.0', lanSessions: 0, otherUsers: 1 });
  });

  it('REFUSES a LAN peer, even a super admin one (gate 2)', async () => {
    // The route exists only when the server is bound wide, so the LAN users §8.3
    // invited can reach it by construction. Without this gate, any of them with
    // a super-admin account could enumerate who else is on the network — a
    // surveillance surface nobody asked for. The panel is a LOCAL affordance.
    t = await harness();
    const res = await get(t, { user: t.superAdmin, remoteAddress: '192.168.1.24' });

    expect(res.statusCode).toBe(403);
  });

  it('refuses a non-super-admin (gate 3) and an anonymous caller', async () => {
    t = await harness();
    expect((await get(t, { user: t.viewer, remoteAddress: '127.0.0.1' })).statusCode).toBe(403);
    expect((await get(t, { remoteAddress: '127.0.0.1' })).statusCode).toBe(401);
  });

  it('reports active: false when the desktop server is on loopback', async () => {
    t = await harness({ host: '127.0.0.1' });
    const res = await get(t, { user: t.superAdmin, remoteAddress: '127.0.0.1' });

    expect(body(res)).toMatchObject({ active: false, host: '127.0.0.1' });
  });
});

describe('the §8.3 session count', () => {
  /** A live session, as `createSession` makes one. The token hash is opaque here. */
  let seq = 0;
  const open = (h: Harness, userId: string, ip: string | null) =>
    sessionsRepo(h.meta).create({
      userId,
      tokenHash: `hash-${String((seq += 1))}`,
      expiresAt: Date.now() + 60 * 60_000,
      ip,
      userAgent: 'test',
    });

  it('counts non-loopback sessions and ignores this machine', async () => {
    t = await harness();
    await open(t, t.viewer.id, '192.168.1.31');
    await open(t, t.superAdmin.id, '127.0.0.1');
    // `::ffff:127.0.0.1` is this machine however much it looks like it is not —
    // a dual-stack listener hands out that spelling.
    await open(t, t.superAdmin.id, '::ffff:127.0.0.1');
    // A null ip is "we were not told", which is not a LAN peer.
    await open(t, t.viewer.id, null);

    const res = await get(t, { user: t.superAdmin, remoteAddress: '127.0.0.1' });
    expect(body(res).lanSessions).toBe(1);
  });

  it('does not count a revoked session — the panel must match the front door', async () => {
    t = await harness();
    const live = await open(t, t.viewer.id, '192.168.1.31');
    await sessionsRepo(t.meta).revoke(live.id);

    const res = await get(t, { user: t.superAdmin, remoteAddress: '127.0.0.1' });
    expect(body(res).lanSessions).toBe(0);
  });

  it('does not count an expired session', async () => {
    t = await harness();
    await sessionsRepo(t.meta).create({
      userId: t.viewer.id,
      tokenHash: 'hash-expired',
      expiresAt: Date.now() - 1_000,
      ip: '192.168.1.31',
      userAgent: 'test',
    });

    const res = await get(t, { user: t.superAdmin, remoteAddress: '127.0.0.1' });
    expect(body(res).lanSessions).toBe(0);
  });
});

describe('the §8.3 precondition count (otherUsers)', () => {
  it('does not count a second super admin — another copy of you is not "somebody to invite"', async () => {
    t = await harness();
    const roles = rolesRepo(t.meta);
    const superAdminRole = await roles.findBySlug('super-admin');
    if (superAdminRole === null) throw new Error('missing role');
    const second = await usersRepo(t.meta).create({
      email: 'second-admin@adminium.test',
      name: 'Root',
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(second.id, superAdminRole.id);

    // Liam the viewer, and nobody else.
    const res = await get(t, { user: t.superAdmin, remoteAddress: '127.0.0.1' });
    expect(body(res).otherUsers).toBe(1);
  });

  it('does not count a suspended user — `active` is the set that can sign in', async () => {
    t = await harness();
    await usersRepo(t.meta).updateStatus(t.viewer.id, 'suspended');

    const res = await get(t, { user: t.superAdmin, remoteAddress: '127.0.0.1' });
    expect(body(res).otherUsers).toBe(0);
  });
});

describe('§8.3 acceptance: the audit log records LAN IPs', () => {
  it('stamps a LAN login with the peer address the kernel saw', async () => {
    t = await harness();
    // A real login through the real route, from a real non-loopback peer.
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@adminium.test', password: 'wrong-password' },
      remoteAddress: '192.168.1.24',
    });
    expect(res.statusCode).toBe(401);

    const entries = await auditRepo(t.meta).list({ category: 'auth', limit: 10 });
    const entry = entries.find((item) => item.action === 'login_failed');
    expect(entry).toBeDefined();
    // THE CRITERION. Not "an ip was recorded" — the LAN peer's ip.
    expect(entry?.ip).toBe('192.168.1.24');
  });

  it('does not let a LAN peer choose the IP it is logged as (§8.3 + trustProxy off)', async () => {
    // The desktop shell forces `ADMINIUM_TRUST_PROXY=off` (`apps/desktop/src/
    // server/env.ts`) precisely so this holds: nothing is ever in front of the
    // embedded server, so `X-Forwarded-For` is never a forwarding record — it is
    // only ever a peer's preferred spelling of itself. If it were honoured, the
    // audit trail §8.3 promises would record whatever the attacker typed.
    t = await harness();
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'spoofer@adminium.test', password: 'wrong-password' },
      remoteAddress: '192.168.1.24',
      headers: { 'x-forwarded-for': '10.0.0.1, 127.0.0.1' },
    });

    const entries = await auditRepo(t.meta).list({ category: 'auth', limit: 10 });
    const entry = entries.find((item) => item.action === 'login_failed');
    expect(entry?.ip).toBe('192.168.1.24');
  });
});
