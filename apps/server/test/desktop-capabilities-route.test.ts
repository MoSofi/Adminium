// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desktop capability grant table over REST (11-electron.md §12) — the route's
 * gates, its persistence, and its idempotency.
 *
 * The pipeline this route is half of — manifest → consent → grant → IPC →
 * provider — is only as trustworthy as the grant it writes, so each gate is
 * pinned on its own (a suite that only proved the happy path would stay green
 * while the loopback check or the RBAC guard rotted), and the grant is asserted
 * to actually land in `adminium_settings` under the key the main-process host
 * reads. Gate 1 (the route exists only under `ADMINIUM_RUNTIME=desktop`) is a
 * `compose.ts` claim; `m10-regressions.test.ts` owns it, and this file registers
 * the route directly like `desktop-backup-route.test.ts` does.
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { desktopCapabilityRoutes } from '../src/routes/desktop-capabilities/index.js';
import { makeEnv } from './helpers.js';

const URL = '/api/v1/desktop/capability-grants';
const NOW = 1_700_000_000_000;

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdmin: User;
  viewer: User;
  destroy: () => Promise<void>;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function harness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-caps-route-'));
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

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id !== 'string') return;
    const user = await users.findById(id);
    if (user !== null) request.user = user;
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(desktopCapabilityRoutes({ meta, now: () => NOW }));
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

function req(
  h: Harness,
  method: 'GET' | 'POST' | 'DELETE',
  opts: { user?: User; body?: unknown; remoteAddress?: string } = {},
) {
  return h.app.inject({
    method,
    url: URL,
    ...(opts.body === undefined ? {} : { payload: opts.body }),
    ...(opts.user === undefined ? {} : { headers: asUser(opts.user) }),
    ...(opts.remoteAddress === undefined ? {} : { remoteAddress: opts.remoteAddress }),
  });
}

function errorCode(res: { json: () => unknown }): string {
  return (res.json() as { error: { code: string } }).error.code;
}

const RECEIPT = { manifestId: 'com.adminium.pos', capabilityId: 'printer.escpos' } as const;

let t: Harness | null = null;
beforeEach(async () => {
  t = await harness();
});
afterEach(async () => {
  await t?.destroy();
  t = null;
});

// ─── Gate 2: the peer (§2.4) ─────────────────────────────────────────────────

describe('gate 2 — the peer', () => {
  it('refuses a LAN peer on every verb even with a super-admin session', async () => {
    const h = t as Harness;
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const res = await req(h, method, {
        user: h.superAdmin,
        remoteAddress: '192.168.1.24',
        body: RECEIPT,
      });
      expect(res.statusCode, method).toBe(403);
      expect(errorCode(res), method).toBe('FORBIDDEN');
    }
  });

  it('accepts the whole loopback range', async () => {
    const h = t as Harness;
    const res = await req(h, 'GET', { user: h.superAdmin, remoteAddress: '127.0.0.2' });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Gate 3: session + RBAC ──────────────────────────────────────────────────

describe('gate 3 — session and RBAC', () => {
  it('refuses an anonymous request', async () => {
    const res = await req(t as Harness, 'GET');
    expect(res.statusCode).toBe(401);
  });

  it('refuses a signed-in viewer on every verb — capability access is not theirs', async () => {
    const h = t as Harness;
    expect((await req(h, 'GET', { user: h.viewer })).statusCode).toBe(403);
    expect((await req(h, 'POST', { user: h.viewer, body: RECEIPT })).statusCode).toBe(403);
    expect((await req(h, 'DELETE', { user: h.viewer, body: RECEIPT })).statusCode).toBe(403);
  });

  it('allows a super admin', async () => {
    const res = await req(t as Harness, 'GET', { user: (t as Harness).superAdmin });
    expect(res.statusCode).toBe(200);
  });
});

// ─── The body ────────────────────────────────────────────────────────────────

describe('the request body', () => {
  it('rejects a capabilityId outside the closed host vocabulary', async () => {
    const h = t as Harness;
    const res = await req(h, 'POST', {
      user: h.superAdmin,
      body: { manifestId: 'com.evil.app', capabilityId: 'filesystem.root' },
    });
    // 422 VALIDATION_FAILED — an unknown capability is a bad request, never a
    // grant for a driver this build cannot honour.
    expect(res.statusCode).toBe(422);
  });

  it('rejects an extra key (strictObject)', async () => {
    const h = t as Harness;
    const res = await req(h, 'POST', {
      user: h.superAdmin,
      body: { ...RECEIPT, grantedAt: 0 },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ─── Persistence + idempotency (§12) ─────────────────────────────────────────

describe('grant persistence', () => {
  it('POST writes a grant that GET then returns, stamped with grantedAt', async () => {
    const h = t as Harness;
    const post = await req(h, 'POST', { user: h.superAdmin, body: RECEIPT });
    expect(post.statusCode).toBe(200);
    expect((post.json() as { data: { grant: unknown } }).data.grant).toEqual({
      ...RECEIPT,
      grantedAt: NOW,
    });

    const get = await req(h, 'GET', { user: h.superAdmin });
    expect((get.json() as { data: { grants: unknown[] } }).data.grants).toEqual([
      { ...RECEIPT, grantedAt: NOW },
    ]);
  });

  it('lands in adminium_settings under the key the host reads', async () => {
    const h = t as Harness;
    await req(h, 'POST', { user: h.superAdmin, body: RECEIPT });
    const stored = await settingsRepo(h.meta).get('desktop.capabilityGrants');
    expect(stored).toEqual([{ ...RECEIPT, grantedAt: NOW }]);
  });

  it('is idempotent — granting the same identity twice keeps one row', async () => {
    const h = t as Harness;
    await req(h, 'POST', { user: h.superAdmin, body: RECEIPT });
    await req(h, 'POST', { user: h.superAdmin, body: RECEIPT });
    const get = await req(h, 'GET', { user: h.superAdmin });
    expect((get.json() as { data: { grants: unknown[] } }).data.grants).toHaveLength(1);
  });

  it('DELETE removes the grant and reports it; a second DELETE is a no-op', async () => {
    const h = t as Harness;
    await req(h, 'POST', { user: h.superAdmin, body: RECEIPT });

    const first = await req(h, 'DELETE', { user: h.superAdmin, body: RECEIPT });
    expect((first.json() as { data: { removed: boolean } }).data.removed).toBe(true);

    const get = await req(h, 'GET', { user: h.superAdmin });
    expect((get.json() as { data: { grants: unknown[] } }).data.grants).toEqual([]);

    const second = await req(h, 'DELETE', { user: h.superAdmin, body: RECEIPT });
    expect((second.json() as { data: { removed: boolean } }).data.removed).toBe(false);
  });
});

// ─── Audit (§12 — a grant is a settings-category act) ────────────────────────

describe('audit', () => {
  it('audits a grant and a revoke under the settings category, but not a no-op revoke', async () => {
    const h = t as Harness;
    await req(h, 'POST', { user: h.superAdmin, body: RECEIPT });
    await req(h, 'DELETE', { user: h.superAdmin, body: RECEIPT });
    // Second DELETE removes nothing — must NOT audit.
    await req(h, 'DELETE', { user: h.superAdmin, body: RECEIPT });

    const rows = await h.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', 'in', ['desktop_capability_granted', 'desktop_capability_revoked'])
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.category === 'settings')).toBe(true);
    expect(rows.every((row) => row.actorId === h.superAdmin.id)).toBe(true);
    expect(rows.map((row) => row.action).sort()).toEqual([
      'desktop_capability_granted',
      'desktop_capability_revoked',
    ]);
  });
});
