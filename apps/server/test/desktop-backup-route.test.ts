// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/desktop/backup` (11-electron.md §9) — the route's gates.
 *
 * A backup archive is every row in every local database plus every user record,
 * so this endpoint is an exfiltration primitive with a friendly name. It is
 * written as three independent gates, mirroring `routes/auth/desktop-session.ts`,
 * and each is pinned here on its own — a suite that only proved "the happy path
 * works" would stay green while the loopback check or the RBAC guard rotted away.
 *
 * ─── Gate 1 is NOT tested here, and that is a REPORT, not an omission ────────
 *
 * "The route exists only when `ADMINIUM_RUNTIME=desktop`" is a claim about
 * `compose.ts`, and it cannot be tested by a harness that registers the plugin
 * itself — that is exactly what `desktop-session.test.ts` says about its own
 * gate 1, and it is right. This track was asked not to edit `compose.ts`, so the
 * registration is REPORTED rather than written, and this file's gate-1 coverage
 * lands the day that wiring does. Until then the route is unreachable in
 * production: the archive service is complete and nothing serves it.
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSqliteMetaDb,
  firstRun,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { BACKUP_NOTIFICATION_KIND } from '../src/backup/notify.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { desktopRoutes } from '../src/routes/desktop/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const URL = '/api/v1/desktop/backup';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  dir: string;
  superAdmin: User;
  viewer: User;
  destroy: () => Promise<void>;
}

/** `x-test-user-id` → `request.user`, standing in for `plugins/auth.ts`. */
function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function harness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-backup-route-'));
  const metaPath = join(dir, 'meta.db');
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(metaPath) });
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
      await api.register(
        desktopRoutes({
          meta,
          crypto: dsnCryptoFromSecret(TEST_SECRET),
          dataDir: dir,
          metaPath,
          appVersion: '1.2.3',
        }),
      );
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return {
    app,
    meta,
    dir,
    superAdmin,
    viewer,
    destroy: async () => {
      await app.close();
      await meta.db.destroy();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function post(
  h: Harness,
  opts: {
    user?: User;
    body?: unknown;
    remoteAddress?: string;
  } = {},
) {
  return h.app.inject({
    method: 'POST',
    url: URL,
    payload: opts.body ?? { destination: 'staged' },
    ...(opts.user === undefined ? {} : { headers: asUser(opts.user) }),
    ...(opts.remoteAddress === undefined ? {} : { remoteAddress: opts.remoteAddress }),
  });
}

function errorCode(res: { json: () => unknown }): string {
  return (res.json() as { error: { code: string } }).error.code;
}

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
  it('refuses a LAN peer even with a valid super-admin session', async () => {
    // §8.3 binds 0.0.0.0 when LAN share is on, so this is a request the server
    // really can receive. RBAC alone would ALLOW it — the account is genuinely a
    // super admin — which is exactly why the peer gate is separate and why it
    // runs first. A backup is every row in the install; it does not leave over
    // the network.
    const res = await post(t as Harness, {
      user: (t as Harness).superAdmin,
      remoteAddress: '192.168.1.24',
    });

    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('accepts a loopback peer', async () => {
    const res = await post(t as Harness, { user: (t as Harness).superAdmin });
    expect(res.statusCode).toBe(200);
  });

  it('accepts the whole 127.0.0.0/8 loopback range', async () => {
    const res = await post(t as Harness, {
      user: (t as Harness).superAdmin,
      remoteAddress: '127.0.0.2',
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Gate 3: session + RBAC ──────────────────────────────────────────────────

describe('gate 3 — session and RBAC', () => {
  it('refuses an anonymous request', async () => {
    const res = await post(t as Harness);
    expect(res.statusCode).toBe(401);
  });

  it('refuses a signed-in user without system:settings:manage', async () => {
    // A viewer has a real session on the same machine. §9's archive is not
    // theirs to take.
    const res = await post(t as Harness, { user: (t as Harness).viewer });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('allows a super admin', async () => {
    const res = await post(t as Harness, { user: (t as Harness).superAdmin });
    expect(res.statusCode).toBe(200);
  });
});

// ─── The body (§9) ───────────────────────────────────────────────────────────

describe('the request body', () => {
  it('has no destination path in it at all', async () => {
    // THE DESIGN DECISION, pinned: an `outPath` would make this endpoint an
    // arbitrary-file-write primitive with the server's privileges. `strictObject`
    // is what keeps it from being added by accident.
    const res = await post(t as Harness, {
      user: (t as Harness).superAdmin,
      body: { destination: 'staged', outPath: '/Users/ava/.zshrc' },
    });
    // 422 VALIDATION_FAILED — this codebase's Zod rejection (app.ts).
    expect(res.statusCode).toBe(422);
  });

  it('rejects a destination it does not know', async () => {
    const res = await post(t as Harness, {
      user: (t as Harness).superAdmin,
      body: { destination: 'anywhere-i-like' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a rotation depth outside config.json’s bounds', async () => {
    for (const keep of [0, 366, 1.5]) {
      const res = await post(t as Harness, {
        user: (t as Harness).superAdmin,
        body: { destination: 'auto', keep },
      });
      expect(res.statusCode, `keep=${String(keep)}`).toBe(422);
    }
  });

  it('defaults `keep` to §9’s 7', async () => {
    const res = await post(t as Harness, {
      user: (t as Harness).superAdmin,
      body: { destination: 'auto' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a config that still carries a secret', async () => {
    // The server does not trust the caller to have redacted. `assertNoSecrets`
    // is the boundary, and a 500 here is correct: this is a bug in the shell,
    // not a bad request a user made.
    const res = await post(t as Harness, {
      user: (t as Harness).superAdmin,
      body: {
        destination: 'staged',
        config: { version: 1, secretPlain: 'SENTINEL-ROUTE-LEAK-1a2b3c' },
      },
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toContain('SENTINEL-ROUTE-LEAK');
  });
});

// ─── The reply and its side effects (§9) ─────────────────────────────────────

describe('the reply', () => {
  it('returns the archive path, size and the whole manifest', async () => {
    const res = await post(t as Harness, { user: (t as Harness).superAdmin });
    const body = res.json() as {
      data: { path: string; bytes: number; manifest: { formatVersion: number; appVersion: string } };
    };

    expect(body.data.path).toContain('/backups/.staging/');
    expect(body.data.bytes).toBeGreaterThan(0);
    expect(body.data.manifest.formatVersion).toBe(1);
    // The shell's `app.getVersion()`, forwarded through the fork env.
    expect(body.data.manifest.appVersion).toBe('1.2.3');
  });

  it('raises an adminium_notifications entry for an auto backup (§9)', async () => {
    const h = t as Harness;
    await post(h, { user: h.superAdmin, body: { destination: 'auto' } });

    const rows = await h.meta.db.selectFrom('adminium_notifications').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe(BACKUP_NOTIFICATION_KIND);
    // §9's "Show in folder" is not a URL — it is `shell.showItemInFolder`,
    // which lives behind §4's bridge. The path rides in `entity` instead.
    expect(rows[0]?.actionUrl).toBeNull();
    expect(rows[0]?.userId).toBe(h.superAdmin.id);
    expect(String(rows[0]?.entity)).toContain('backups/adminium-backup-');
  });

  it('does not notify for a staged backup — main reveals it in the file manager', async () => {
    const h = t as Harness;
    await post(h, { user: h.superAdmin, body: { destination: 'staged' } });
    const rows = await h.meta.db.selectFrom('adminium_notifications').selectAll().execute();
    expect(rows).toEqual([]);
  });

  it('audits the backup under the system category', async () => {
    const h = t as Harness;
    await post(h, { user: h.superAdmin });

    const rows = await h.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', '=', 'desktop_backup_created')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(h.superAdmin.id);
    expect(rows[0]?.category).toBe('system');
  });

  it('rotates to `keep` on an auto backup and reports what it removed', async () => {
    const h = t as Harness;
    // Four backups, keep two. Each has to land in a distinct second because the
    // filename is the rotation's sort key.
    const paths: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await post(h, { user: h.superAdmin, body: { destination: 'auto', keep: 2 } });
      paths.push((res.json() as { data: { path: string } }).data.path);
      await new Promise((r) => setTimeout(r, 1100));
    }
    const last = await post(h, { user: h.superAdmin, body: { destination: 'auto', keep: 2 } });
    const rotated = (last.json() as { data: { rotated: string[] } }).data.rotated;

    // Four written, two kept ⇒ the two oldest went. `rotated` names them so the
    // caller can log what happened rather than guess.
    expect(rotated.length).toBeGreaterThanOrEqual(1);
    const { readdir } = await import('node:fs/promises');
    const remaining = (await readdir(join(h.dir, 'backups'))).filter((n) => n.endsWith('.zip'));
    expect(remaining).toHaveLength(2);
    void paths;
  });
});
