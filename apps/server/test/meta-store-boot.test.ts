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
 *   - GET /bootstrap → epoch timestamps survive the engine's int8 decoding as
 *     JS numbers, which is the whole reply schema's premise
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
  postgresInt8AsNumber,
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
      const database = freshDbName();
      const admin = new pg.Client({ connectionString: base });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${database}"`);
      await admin.end();
      const meta = createPostgresMetaDb({
        // The SAME per-pool int8 parser production uses, rather than the global
        // `pg.types.setTypeParser(20, …)` this used to call. That global was the
        // only thing in the codebase satisfying `createPostgresMetaDb`'s stated
        // requirement, and setting it process-wide made the production pool's
        // omission invisible: every timestamp came back a string in the product
        // and a number here, for years, in the one suite built to catch exactly
        // that class of difference.
        pool: new pg.Pool({
          connectionString: withDatabase(base, database),
          max: 4,
          types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>),
        }),
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

    it('serves GET /bootstrap — timestamps as numbers, not strings', async () => {
      // THE REGRESSION. `bootstrapReply` types `user.createdAt`, `user.updatedAt`
      // and `configVersion` as `z.number()`; on Postgres they arrived as
      // strings and the route died in response serialization with a 500:
      //
      //   ResponseSerializationError: Response doesn't match the schema
      //   path ["data","user","createdAt"]: expected number, received string
      //
      // `ts` columns are `bigint` on Postgres (`columns.ts`), and node-postgres
      // decodes int8 as a string unless told otherwise. This is the FIRST call
      // the dashboard makes after login, so the product was unusable on a
      // Postgres meta store while every SQLite install was fine.
      const cookie = await loginCookie();
      const res = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
      expect(res.statusCode, res.body).toBe(200);

      const { data } = res.json() as {
        data: { user: { createdAt: unknown; updatedAt: unknown }; configVersion: unknown };
      };
      expect(typeof data.user.createdAt).toBe('number');
      expect(typeof data.user.updatedAt).toBe('number');
      // Derived by max() over page updatedAt, so it inherits whatever those are.
      expect(typeof data.configVersion).toBe('number');
    });

    it('reads epoch timestamps off the store as numbers', async () => {
      // One layer below the route, so a failure says whether the driver or the
      // serializer is at fault.
      const row = await handle.meta.db
        .selectFrom('adminium_users')
        .select(['createdAt', 'updatedAt'])
        .where('id', '=', admin.id)
        .executeTakeFirstOrThrow();
      expect(typeof row.createdAt).toBe('number');
      expect(typeof row.updatedAt).toBe('number');
      expect(row.createdAt).toBeGreaterThan(0);
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
