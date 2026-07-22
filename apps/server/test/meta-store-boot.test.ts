/**
 * The composed server booted against a real POSTGRES and MYSQL meta store
 * (M15-T05 topology cell: "a MySQL meta store never boots a server").
 *
 * The repos suites in packages/meta already exercise every meta table against
 * all three engines, but only at the repo layer. This suite closes the gap the
 * milestone named: it runs `buildServer` — the actual composed API — against a
 * meta store on each server engine and drives real, authenticated,
 * meta-backed traffic through it:
 *   - initMetaDb + firstRun + createFirstSuperAdmin   (migrations, seeds, a
 *     claim transaction — the "mysql onion" DDL/transaction semantics)
 *   - login → session row written, read back on the next request
 *   - GET /me → session + user read through the store
 *   - PATCH /me/prefs then GET /me/prefs → a settings write and read-after-write
 *   - unauthenticated GET /me → 401 (the auth gate resolves against the store)
 *   - a second createFirstSuperAdmin → FirstUserExistsError (once-only, proven
 *     against the engine's real transaction, not sqlite's)
 *
 * Each engine leg gates on TEST_POSTGRES_URL / TEST_MYSQL_URL exactly like the
 * other live suites and skips green when the engine is absent. In CI both
 * services are present (ci.yml verify job), so both legs run.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createFirstSuperAdmin,
  createMysqlMetaDb,
  createPostgresMetaDb,
  firstRun,
  initMetaDb,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { sessionCookie } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const ADMIN_EMAIL = 'boot-admin@example.com';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

interface MetaHandle {
  meta: MetaDb;
  destroy: () => Promise<void>;
}

interface Engine {
  name: string;
  url: string | undefined;
  make: (base: string) => Promise<MetaHandle>;
}

function freshDbName(): string {
  return `adminium_boot_${randomBytes(4).toString('hex')}`;
}

/** Same base URL, a different database in the path — credentials preserved. */
function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const ENGINES: Engine[] = [
  {
    name: 'postgres',
    url: process.env.TEST_POSTGRES_URL,
    async make(base) {
      const { default: pg } = await import('pg');
      // int8 columns (counts, timestamps) parse to JS number (< 2^53).
      pg.types.setTypeParser(20, (v: string) => Number(v));
      const database = freshDbName();
      const admin = new pg.Client({ connectionString: base });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${database}"`);
      await admin.end();
      const meta = createPostgresMetaDb({
        pool: new pg.Pool({ connectionString: withDatabase(base, database), max: 4 }),
      });
      return {
        meta,
        destroy: async () => {
          await meta.db.destroy();
          const drop = new pg.Client({ connectionString: base });
          await drop.connect();
          await drop.query(`DROP DATABASE IF EXISTS "${database}"`);
          await drop.end();
        },
      };
    },
  },
  {
    name: 'mysql',
    url: process.env.TEST_MYSQL_URL,
    async make(base) {
      const mysqlP = await import('mysql2/promise');
      const database = freshDbName();
      const admin = await mysqlP.createConnection({ uri: base });
      await admin.query(`CREATE DATABASE \`${database}\``);
      await admin.end();
      const { createPool } = await import('mysql2');
      const meta = createMysqlMetaDb({
        pool: createPool({ uri: withDatabase(base, database), connectionLimit: 4 }),
      });
      return {
        meta,
        destroy: async () => {
          await meta.db.destroy();
          const drop = await mysqlP.createConnection({ uri: base });
          await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
          await drop.end();
        },
      };
    },
  },
];

for (const engine of ENGINES) {
  describe.skipIf(engine.url === undefined)(`composed server on a ${engine.name} meta store`, () => {
    let handle: MetaHandle;
    let app: AdminiumServer;
    let admin: User;

    beforeAll(async () => {
      handle = await engine.make(engine.url as string);
      await initMetaDb(handle.meta);
      await firstRun(handle.meta);
      admin = await createFirstSuperAdmin(handle.meta, {
        email: ADMIN_EMAIL,
        name: 'Boot Admin',
        passwordHash: await hashPassword(ADMIN_PASSWORD),
      });
      app = await buildServer({ env: makeEnv(), logger: false, metaDb: handle.meta });
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
      await handle?.destroy();
    });

    async function loginCookie(): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(res.statusCode, res.body).toBe(200);
      return sessionCookie(res.headers['set-cookie']);
    }

    it('rejects an unauthenticated /me against this store', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
      expect(res.statusCode).toBe(401);
    });

    it('logs in and reads the identity back through the store', async () => {
      const cookie = await loginCookie();
      const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
      expect(me.statusCode).toBe(200);
      expect((me.json() as { data: { user: { email: string; id: string } } }).data.user).toMatchObject({
        email: ADMIN_EMAIL,
        id: admin.id,
      });
    });

    it('persists a preference write and reads it back (round-trip through the store)', async () => {
      const cookie = await loginCookie();
      const patch = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/prefs',
        headers: { cookie },
        payload: { theme: 'dark' },
      });
      expect(patch.statusCode, patch.body).toBe(200);
      const get = await app.inject({ method: 'GET', url: '/api/v1/me/prefs', headers: { cookie } });
      expect((get.json() as { data: { prefs: { theme: string | null } } }).data.prefs.theme).toBe('dark');
    });

    it('refuses a second super-admin claim (once-only on the engine transaction)', async () => {
      await expect(
        createFirstSuperAdmin(handle.meta, {
          email: 'second@example.com',
          name: 'Second',
          passwordHash: await hashPassword('another-strong-password'),
        }),
      ).rejects.toThrow();
    });
  });
}
