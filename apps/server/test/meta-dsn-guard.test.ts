// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A meta-store DSN typed into a route (`meta/typed-dsn.ts`), over the three
 * routes that take one: `POST /setup/probe`, `POST /setup/adopt` and
 * `POST /meta/relocate`.
 *
 * Each refusal is checked two ways: the answer (422 naming what to change, or
 * the 400 a scheme no meta store speaks always got), and that the meta store's
 * driver was never opened. The second matters most: the probe turns any dial
 * failure into a polite `reachable: false`, so an answer alone would not show
 * whether the string was dialled first. The opener is wrapped below to count.
 *
 * The live legs run where the route really connects: a fresh database on the
 * local Postgres (`TEST_POSTGRES_URL`) and MySQL (`TEST_MYSQL_URL`), reached on
 * `localhost`/`127.0.0.1`, because a meta store on the same server is an
 * ordinary setup and loopback stays allowed here.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { metaRoutes } from '../src/routes/meta/index.js';
import { setupStoreRoutes } from '../src/routes/setup/store.js';
import { createSetupService } from '../src/setup/service.js';
import { hashPassword } from '../src/auth/passwords.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const dials = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/meta/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/meta/store.js')>();
  return {
    ...actual,
    connectMetaStore: (...args: Parameters<typeof actual.connectMetaStore>) => {
      dials.count += 1;
      return actual.connectMetaStore(...args);
    },
  };
});

// Names the tests make answer as they need; every other name is looked up for real.
const ANSWERS: Record<string, string[] | null> = {
  'meta-trap.p75.test': ['169.254.169.254'],
  'mixed-trap.p75.test': ['10.0.0.9', 'fd00:ec2::254'],
  'own-store.p75.test': ['127.0.0.1'],
  'gone.p75.test': null,
};

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  const lookup = (async (host: string, options?: unknown) => {
    if (!(host in ANSWERS)) return actual.lookup(host, options as never);
    const answer = ANSWERS[host];
    if (answer === null || answer === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return answer.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  }) as typeof actual.lookup;
  return { ...actual, default: { ...actual, lookup }, lookup };
});

const SECRET = 'a-sufficiently-long-test-secret';
// CI sets these empty on push runs: empty is unset.
const PG_URL = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL_URL = process.env['TEST_MYSQL_URL'] || undefined;

type Route = 'probe' | 'adopt' | 'relocate';
const ROUTES: readonly Route[] = ['probe', 'adopt', 'relocate'];

interface Answer {
  statusCode: number;
  body: string;
  json: () => { error?: { code?: string; message?: string }; data?: Record<string, unknown> };
}

let dir: string;
let outside: string;
let setupMeta: MetaDb;
let setupApp: AdminiumServer;
let auth: AuthTestApp;
let cookie: string;
/** Each setup call from its own address, so the login bucket never decides a test. */
let ip = 0;

async function send(route: Route, dsn: string): Promise<Answer> {
  if (route === 'relocate') {
    return auth.app.inject({ method: 'POST', url: '/api/v1/meta/relocate', headers: { cookie }, payload: { dsn } });
  }
  return setupApp.inject({
    method: 'POST',
    url: `/api/v1/setup/${route}`,
    payload: { dsn },
    remoteAddress: `10.75.7.${String(++ip % 250)}`,
  });
}

beforeEach(async () => {
  dials.count = 0;
  dir = await mkdtemp(join(tmpdir(), 'adminium-meta-dsn-guard-'));
  outside = await mkdtemp(join(tmpdir(), 'adminium-meta-dsn-outside-'));
  const env = makeEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_DATA_DIR: dir });

  // The setup pair: a fresh instance with no account, so setup is open.
  setupMeta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(setupMeta);
  setupApp = await buildServer({ env, metaDb: setupMeta, logger: false });
  await setupApp.register(
    setupStoreRoutes({ service: createSetupService({ meta: setupMeta, hashPassword }), env, onMetaRelocated: vi.fn() }),
    { prefix: '/api/v1' },
  );
  await setupApp.ready();

  // Relocation: a set-up instance, signed in as its super admin.
  auth = await buildAuthApp();
  const metaStore: MetaStoreHandle = {
    meta: auth.meta,
    url: `sqlite:${join(dir, 'meta.db')}`,
    engine: 'sqlite',
    source: 'embedded',
    close: async () => undefined,
  };
  await auth.app.register(rbacPlugin, { meta: auth.meta });
  await auth.app.register(
    async (api) => {
      await api.register(metaRoutes({ metaStore, env, onMetaRelocated: vi.fn() }));
    },
    { prefix: '/api/v1' },
  );
  await auth.app.ready();
  cookie = (await login(auth.app)).cookie ?? '';
  dials.count = 0;
});

afterEach(async () => {
  await setupApp.close();
  await setupMeta.db.destroy();
  await auth.destroy();
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

/** Strings no route may dial, whatever it is: [what, dsn, status, code, message]. */
const REFUSED: readonly [string, string, number, string, RegExp][] = [
  ['a ?host= parameter', 'postgres://ava@db.example.com:5432/adminium?host=127.0.0.1', 422, 'VALIDATION_FAILED', /"host" parameter is not allowed\. Remove it/],
  ['a unix socket in ?host=', 'postgres://ava@db.example.com:5432/adminium?host=/var/run/postgresql', 422, 'VALIDATION_FAILED', /"host" parameter/],
  ['a ?hostaddr= parameter', 'postgres://ava@db.example.com:5432/adminium?hostaddr=169.254.169.254', 422, 'VALIDATION_FAILED', /"hostaddr" parameter/],
  ['a ?sslrootcert= parameter', 'postgres://ava@db.example.com:5432/adminium?sslrootcert=/etc/passwd', 422, 'VALIDATION_FAILED', /"sslrootcert" parameter/],
  ['a ?socketPath= parameter', 'mysql://root@db.example.com:3306/adminium?socketPath=/var/run/mysqld/mysqld.sock', 422, 'VALIDATION_FAILED', /"socketPath" parameter/],
  ['the cloud metadata address', 'postgres://ava@169.254.169.254:5432/adminium', 422, 'VALIDATION_FAILED', /blocked address/],
  ['Google\'s metadata name', 'mysql://root@metadata.google.internal:3306/adminium', 422, 'VALIDATION_FAILED', /blocked address/],
  ['AWS\'s IPv6 metadata address', 'postgres://ava@[fd00:ec2::254]:5432/adminium', 422, 'VALIDATION_FAILED', /blocked address/],
  ['the metadata address spelled as one number', 'postgres://ava@2852039166:5432/adminium', 422, 'VALIDATION_FAILED', /blocked address/],
  ['a percent-encoded host', 'mysql://root@%31%36%39.254.169.254:3306/adminium', 422, 'VALIDATION_FAILED', /percent-encoded/],
  ['a scheme no meta store speaks', 'http://169.254.169.254/latest/meta-data/', 400, 'META_DSN_INVALID', /postgres:\/\/…, mysql:\/\/…, or sqlite:<path>/],
];

describe.each(ROUTES)('POST %s with a typed meta-store DSN', (route) => {
  it.each(REFUSED)('refuses %s before dialling it', async (_what, dsn, status, code, message) => {
    const res = await send(route, dsn);
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json().error?.code).toBe(code);
    expect(res.json().error?.message).toMatch(message);
    expect(dials.count).toBe(0);
  });

  describe('a SQLite path', () => {
    /** Refused with a 422, nothing opened, and nothing created outside the data dir. */
    const refused = async (dsn: string, message: RegExp): Promise<void> => {
      const before = await readdir(outside);
      const res = await send(route, dsn);
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().error?.code).toBe('VALIDATION_FAILED');
      expect(res.json().error?.message).toMatch(message);
      expect(dials.count).toBe(0);
      expect(await readdir(outside)).toEqual(before);
    };
    const OUT = /inside the data folder \(ADMINIUM_DATA_DIR\)/;

    it('outside the data dir is refused', async () => {
      await refused(`sqlite:${join(outside, 'meta.db')}`, OUT);
    });

    it('relative to the working directory, outside the data dir, is refused', async () => {
      await refused('sqlite:./adminium-meta-dsn-guard.db', OUT);
      expect(existsSync('./adminium-meta-dsn-guard.db')).toBe(false);
    });

    it('with ".." is refused, whether it climbs out or not', async () => {
      await refused(`sqlite:${dir}/../${basename(outside)}/meta.db`, /may not contain "\.\."/);
      await refused(`sqlite:${dir}/sub/../meta2.db`, /may not contain "\.\."/);
    });

    it('through a folder link that leads out is refused', async () => {
      await symlink(outside, join(dir, 'elsewhere'));
      await refused(`sqlite:${join(dir, 'elsewhere', 'meta.db')}`, OUT);
    });

    it('through a file link that leads out is refused', async () => {
      await writeFile(join(outside, 'victim.db'), '');
      await symlink(join(outside, 'victim.db'), join(dir, 'victim.db'));
      await refused(`sqlite:${join(dir, 'victim.db')}`, OUT);
    });

    it('through a link whose target does not exist yet is refused', async () => {
      // Opening it would create the target, wherever the link points.
      await symlink(join(outside, 'created.db'), join(dir, 'created.db'));
      await refused(`sqlite:${join(dir, 'created.db')}`, OUT);
      expect(existsSync(join(outside, 'created.db'))).toBe(false);
    });

    it('with a SQLite URI filename after the scheme is refused', async () => {
      await refused(`sqlite:file:${join(outside, 'meta.db')}?mode=rwc`, /second "file:"/);
    });
  });
});

describe.each(ROUTES)('POST %s with a meta-store host NAME', (route) => {
  it.each([
    ['answers with the metadata address', 'postgres://ava@meta-trap.p75.test:5432/adminium'],
    ['answers with metadata among other addresses', 'mysql://root@mixed-trap.p75.test:3306/adminium'],
  ])('refuses a name that %s, before dialling it', async (_what, dsn) => {
    const res = await send(route, dsn);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error?.code).toBe('VALIDATION_FAILED');
    expect(res.json().error?.message).toMatch(/blocked address/);
    expect(dials.count).toBe(0);
  });

  it('answers HOST_LOOKUP_FAILED for a name that does not resolve, and dials nothing', async () => {
    const res = await send(route, 'postgres://ava@gone.p75.test:5432/adminium');
    expect(res.statusCode, res.body).toBe(502);
    expect(res.json().error?.code).toBe('HOST_LOOKUP_FAILED');
    expect(dials.count).toBe(0);
  });
});

describe('a typed meta-store DSN that passes still works', () => {
  it('SQLite inside the data dir: relocate, then probe and adopt the store it made', async () => {
    await mkdir(join(dir, 'stores'));
    const target = `sqlite:${join(dir, 'stores', 'moved.db')}`;

    const moved = await send('relocate', target);
    expect(moved.statusCode, moved.body).toBe(200);

    const probed = await send('probe', target);
    expect(probed.statusCode, probed.body).toBe(200);
    expect(probed.json().data).toMatchObject({ reachable: true });
    expect(probed.json().data?.['occupied']).toContain('adminium_users');

    const adopted = await send('adopt', target);
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect(adopted.json().data).toMatchObject({ engine: 'sqlite', restarting: true });
    expect(dials.count).toBeGreaterThanOrEqual(3);
  });

  it('SQLite through a link that stays inside the data dir', async () => {
    await mkdir(join(dir, 'real'));
    await symlink(join(dir, 'real'), join(dir, 'alias'));
    const probed = await send('probe', `sqlite:${join(dir, 'alias', 'new.db')}`);
    expect(probed.statusCode, probed.body).toBe(200);
    expect(probed.json().data).toMatchObject({ reachable: true, occupied: [] });
  });

  it('the in-memory SQLite store the setup probe has always taken', async () => {
    const probed = await send('probe', 'sqlite::memory:');
    expect(probed.statusCode, probed.body).toBe(200);
    expect(probed.json().data).toMatchObject({ reachable: true });
  });

  it('a host that answers nothing is still dialled and reported, not refused', async () => {
    // Loopback is not refused for the meta store; the probe says "unreachable".
    const probed = await send('probe', 'postgres://ava@127.0.0.1:1/adminium?connect_timeout=2');
    expect(probed.statusCode, probed.body).toBe(200);
    expect(probed.json().data).toMatchObject({ reachable: false });
    expect(dials.count).toBe(1);
  });

  it('a name that answers with this server is still dialled: the operator\'s own store', async () => {
    const probed = await send('probe', 'postgres://ava@own-store.p75.test:1/adminium?connect_timeout=2');
    expect(probed.statusCode, probed.body).toBe(200);
    expect(probed.json().data).toMatchObject({ reachable: false });
    expect(dials.count).toBe(1);
  });

  /** Relocate into a fresh database, see the probe find it, adopt it. */
  const liveLeg = async (dsn: string, engine: 'postgres' | 'mysql'): Promise<void> => {
    const empty = await send('probe', dsn);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json().data).toMatchObject({ reachable: true, occupied: [] });

    const moved = await send('relocate', dsn);
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().data).toMatchObject({ engine, restarting: true });

    const full = await send('probe', dsn);
    expect(full.statusCode, full.body).toBe(200);
    expect(full.json().data?.['occupied']).toContain('adminium_users');

    const adopted = await send('adopt', dsn);
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect(adopted.json().data).toMatchObject({ engine, restarting: true });
  };

  it.skipIf(PG_URL === undefined)('Postgres on localhost', async () => {
    const pg = await import('pg');
    const database = `p75t07b_${randomBytes(4).toString('hex')}`;
    const admin = new pg.default.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    try {
      const url = new URL(PG_URL as string);
      url.pathname = `/${database}`;
      await liveLeg(url.toString(), 'postgres');
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  it.skipIf(MYSQL_URL === undefined)('MySQL on 127.0.0.1', async () => {
    const mysql = await import('mysql2/promise');
    const database = `p75t07b_${randomBytes(4).toString('hex')}`;
    const admin = await mysql.createConnection({ uri: MYSQL_URL as string });
    await admin.query(`CREATE DATABASE \`${database}\``);
    try {
      const url = new URL(MYSQL_URL as string);
      url.pathname = `/${database}`;
      await liveLeg(url.toString(), 'mysql');
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.end();
    }
  }, 60_000);
});
