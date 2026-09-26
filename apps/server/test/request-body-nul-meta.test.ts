// SPDX-License-Identifier: AGPL-3.0-only
/**
 * U+0000 in a request body bound for Adminium's own store, on a SQLite,
 * Postgres and MySQL meta store.
 *
 * A person's name, a role's description, the workspace's name, a page's
 * title: on a Postgres store each was a 500 (`invalid byte sequence for
 * encoding "UTF8": 0x00`), and kept as sent on the other two. Now each is
 * refused 400 `VALIDATION_FAILED` naming the field, as a schema refusal of it
 * is, before anything is written — whichever store answers.
 */
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFirstSuperAdmin,
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  firstRun,
  initMetaDb,
  postgresInt8AsNumber,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { INSTALL_SECRET } from './project-fixtures.js';

const PG = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL = process.env['TEST_MYSQL_URL'] || undefined;

const withDatabase = (base: string, database: string) => {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
};

/** A fresh meta store on one engine. */
async function metaOn(engine: 'sqlite' | 'postgres' | 'mysql'): Promise<{ meta: MetaDb; drop: () => Promise<void> }> {
  if (engine === 'sqlite') {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    return { meta, drop: async () => meta.db.destroy() };
  }
  const database = `adminium_nulmeta_${randomBytes(4).toString('hex')}`;
  if (engine === 'postgres') {
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: PG! });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();
    const meta = createPostgresMetaDb({ pool: new pg.Pool({ connectionString: withDatabase(PG!, database), max: 4, types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>) }) });
    return {
      meta,
      drop: async () => {
        await meta.db.destroy();
        const c = new pg.Client({ connectionString: PG! });
        await c.connect();
        await c.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await c.end();
      },
    };
  }
  const mysqlP = await import('mysql2/promise');
  const admin = await mysqlP.createConnection({ uri: MYSQL! });
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.end();
  const { createPool } = await import('mysql2');
  const meta = createMysqlMetaDb({ pool: createPool({ uri: withDatabase(MYSQL!, database), connectionLimit: 4 }) });
  return {
    meta,
    drop: async () => {
      await meta.db.destroy();
      const c = await mysqlP.createConnection({ uri: MYSQL! });
      await c.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await c.end();
    },
  };
}

const LEGS: ['sqlite' | 'postgres' | 'mysql', boolean][] = [
  ['sqlite', true],
  ['postgres', PG !== undefined],
  ['mysql', MYSQL !== undefined],
];

let open: { composed: ComposedServer; manager: ConnectionManager; drop: () => Promise<void> } | null = null;
afterEach(async () => {
  if (open === null) return;
  await open.composed.app.close();
  await open.manager.disposeAll().catch(() => undefined);
  await open.drop();
  open = null;
});

interface Refusal {
  error: { code: string; details?: { in?: string; issues?: { path: string; code: string }[] } };
}

for (const [engine, available] of LEGS) {
  describe.skipIf(!available)(`U+0000 in a body bound for a ${engine} meta store`, () => {
    it('refuses a name, a description, a setting and a page title, naming the field, and writes nothing', async () => {
      const { meta, drop } = await metaOn(engine);
      await initMetaDb(meta);
      await firstRun(meta);
      await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
      const registry = new AdapterRegistry<AdapterProvider>();
      await registerAdapters(registry);
      const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(INSTALL_SECRET), registry, metaDsn: null, blockLoopback: false });
      const runService = createRunService({ meta });
      const composed = await composeServer({
        env: makeEnv({ ADMINIUM_SECRET: INSTALL_SECRET }),
        metaStore: { meta, url: `${engine}:test`, engine, source: 'embedded', close: async () => Promise.resolve() } as never,
        manager,
        runService,
        applyService: createApplyService({ meta, runService }),
        allowed: null,
        logger: false,
        telemetry: false,
      });
      await composed.app.ready();
      open = { composed, manager, drop };
      const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      const call = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: Record<string, unknown>) =>
        composed.app.inject({ method, url: `/api/v1${url}`, headers: { cookie: cookie ?? '' }, payload });
      const refused = async (reply: Promise<{ statusCode: number; body: string; json: () => unknown }>, path: string) => {
        const r = await reply;
        expect(r.statusCode, r.body).toBe(400);
        const error = (r.json() as Refusal).error;
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.details).toEqual({ in: 'body', issues: [{ path, code: 'invalid-character', message: expect.any(String) }] });
      };

      await refused(call('PATCH', '/me', { name: 'Ada\u0000' }), 'name');
      await refused(call('POST', '/roles', { name: 'Desk', description: 'front \u0000 desk' }), 'description');
      await refused(call('PUT', '/settings/branding', { appName: 'Studio\u0000', showVersion: true }), 'appName');
      await refused(call('POST', '/pages', { slug: 'ops', title: 'Ops\u0000', template: 'page-dashboard', navGroup: 'workspace' }), 'title');

      // The same route spelled another way on the request line: `/%61pi/…`, and the absolute form.
      const other = await composed.app.inject({ method: 'PATCH', url: '/%61pi/v1/me', headers: { cookie: cookie ?? '' }, payload: { name: 'Ada\u0000' } });
      await refused(Promise.resolve(other), 'name');
      const address = await composed.app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = new URL(address);
      const body = JSON.stringify({ name: 'Ada\u0000' });
      const absolute = await new Promise<string>((resolve, reject) => {
        const socket = connect(Number(port), '127.0.0.1', () => {
          socket.write(
            `PATCH http://127.0.0.1:${port}/api/v1/me HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookie ?? ''}\r\n` +
              `Content-Type: application/json\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\nConnection: close\r\n\r\n${body}`,
          );
        });
        let reply = '';
        socket.on('data', (chunk) => (reply += String(chunk)));
        socket.on('end', () => resolve(reply));
        socket.on('error', reject);
      });
      expect(absolute.split('\r\n')[0]).toContain(' 400 ');
      expect(absolute).toContain('"invalid-character"');

      // A cursor carrying it, on the store's own lists: the lists' own "malformed cursor", never a 500.
      const cursor = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
      for (const url of [`/users?cursor=${cursor('1:usr_\u0000')}`, `/audit?cursor=${cursor('1:aud_\u0000')}`, `/jobs?cursor=${cursor('1.job_\u0000')}`]) {
        const r = await composed.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: cookie ?? '' } });
        expect(r.statusCode, `${url} ${r.body}`).toBe(422);
        expect((r.json() as Refusal).error.code).toBe('VALIDATION_FAILED');
      }

      // Nothing was written; the same writes without it go through.
      expect((await usersRepo(meta).findByEmail(ADMIN_EMAIL))?.name).toBe(ADMIN_NAME);
      expect((await rolesRepo(meta).list()).some((role) => role.name === 'Desk')).toBe(false);
      expect(await settingsRepo(meta).get('branding.appName')).not.toContain('\u0000');
      expect((await call('PATCH', '/me', { name: 'Ada' })).statusCode).toBe(200);
      for (const reply of [
        call('POST', '/roles', { name: 'Desk', description: 'front desk' }),
        call('PUT', '/settings/branding', { appName: 'Studio', showVersion: true }),
        call('POST', '/pages', { slug: 'ops', title: 'Ops', template: 'page-dashboard', navGroup: 'workspace' }),
      ]) {
        const r = await reply;
        expect(r.statusCode, r.body).toBeLessThan(300);
      }
      expect((await rolesRepo(meta).list()).some((role) => role.name === 'Desk')).toBe(true);
    }, 120_000);
  });
}

describe('a body nested very deep', () => {
  it('is refused unread, in far less than a second, before anyone has signed in', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await firstRun(meta);
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(INSTALL_SECRET), registry, metaDsn: null, blockLoopback: false });
    const runService = createRunService({ meta });
    const composed = await composeServer({
      env: makeEnv({ ADMINIUM_SECRET: INSTALL_SECRET }),
      metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() } as never,
      manager,
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    open = { composed, manager, drop: async () => meta.db.destroy() };
    const deep = '['.repeat(200_000) + ']'.repeat(200_000);
    const started = performance.now();
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: deep });
    const took = performance.now() - started;
    expect(res.statusCode, res.body.slice(0, 200)).toBe(400);
    expect((res.json() as Refusal).error.details?.issues?.[0]?.code).toBe('too-deep');
    expect(took).toBeLessThan(1000);
    // Wide is not deep: a long list is read to its end, once.
    const wide = JSON.stringify({ email: 'a@b.c', password: 'x', extra: [...Array.from({ length: 100_000 }, (_, i) => `v${String(i)}`), 'z\u0000'] });
    const startedWide = performance.now();
    const found = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: wide });
    expect(performance.now() - startedWide).toBeLessThan(1000);
    expect((found.json() as Refusal).error.details?.issues?.[0]).toMatchObject({ path: 'extra.100000', code: 'invalid-character' });
  }, 60_000);
});
