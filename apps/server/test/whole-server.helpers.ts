// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The whole server over a real database, with one app installed through its
 * routes and people who hold its roles signed in: what a test of a rule, a
 * notice or a role needs when it must be tried as the person it is about, on
 * SQLite, Postgres and MySQL.
 *
 * Nothing is faked below the HTTP route but the clock a test moves itself:
 * `jobs()` runs the worker dry of what is due (`all` makes every waiting job
 * due first: a wait that is over, a held summary), and `tick()` makes every
 * rule that runs by the clock due and scans once.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, rolesRepo, settingsRepo, snapshotsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { scanDueSchedules } from '../src/automations/schedule.js';
import { composeServer } from '../src/compose.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

export type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
/** Every engine, and whether this run can reach it. */
export const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `whole_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'source.db');
    new BetterSqlite3(file).close();
    return { dsn: `sqlite:${file}`, drop: async () => undefined };
  }
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    return {
      dsn: url.toString(),
      drop: async () => {
        const again = new Client({ connectionString: POSTGRES_URL });
        await again.connect();
        await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await again.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection(MYSQL_URL as string);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(MYSQL_URL as string);
  url.pathname = `/${name}`;
  return {
    dsn: url.toString(),
    drop: async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    },
  };
}

export type Reply = Awaited<ReturnType<AdminiumServer['inject']>>;

/** A queued email as it would be sent, and when it may go. */
export interface QueuedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  runAt: number;
  templateKey: string;
}

export interface WholeServer {
  dialect: Dialect;
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  /** The id of one of the app's tables, as the data routes name it. */
  t: (ref: string) => string;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** Each person's session, by name; `owner` is the Super Admin. */
  cookie: Record<string, string>;
  ids: Record<string, string>;
  get: (who: string, url: string) => Promise<Reply>;
  send: (who: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => Promise<Reply>;
  /** A row made through the data route, as that person. */
  make: (who: string, ref: string, values: Record<string, unknown>) => Promise<Reply>;
  change: (who: string, ref: string, key: unknown, values: Record<string, unknown>) => Promise<Reply>;
  /** Run every job that is waiting, as the worker would, each made due first. Jobs of `except` kinds are left where they are. */
  jobs: (opts?: { except?: readonly string[]; all?: boolean }) => Promise<void>;
  /** One pass of the clock over the rules that run by it, each made due first. Answers the runs started. */
  tick: () => Promise<number>;
  /** Every email queued and not yet looked at by this call, oldest first. */
  emails: () => Promise<QueuedEmail[]>;
  close: () => Promise<void>;
}

/** `ok`, or `<status> <code>`: what a try came back with. */
export const said = (res: Reply): string => {
  if (res.statusCode < 300) return 'ok';
  try {
    return `${String(res.statusCode)} ${(res.json() as { error?: { code?: string } }).error?.code ?? ''}`.trim();
  } catch {
    return String(res.statusCode);
  }
};

let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.13.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

export async function wholeServer(
  dialect: Dialect,
  manifest: Record<string, unknown>,
  opts: {
    /** People to make, each with the app's roles they hold (by role key). */
    people?: Record<string, readonly string[]>;
    /** More of the install's own body: the parts it starts with, say. */
    install?: Record<string, unknown>;
    /** Outgoing mail set up (never delivered: nothing listens), so an email is queued and can be read. */
    smtp?: boolean;
  } = {},
): Promise<WholeServer> {
  const key = String(manifest['key']);
  const dataDir = await mkdtemp(join(tmpdir(), 'whole-server-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: `owner@${key}.test`, name: 'Owner', passwordHash: hash });
  if (opts.smtp === true) {
    await settingsRepo(meta).set(
      'email.smtp',
      { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Desk <no-reply@desk.test>', secure: false },
      { updatedBy: null },
    );
  }
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Whole', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  const app = composed.app;
  await app.ready();
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  const owner = await signIn(app, `owner@${key}.test`);

  const sides = (manifest['frontends'] as { side: string }[]).map((frontend) => [`${frontend.side}/index.html`, '<!doctype html><html><body></body></html>'] as const);
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), ...Object.fromEntries(sides) });
  const staged = await app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
  expect(staged.statusCode, staged.body).toBe(200);
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key, version: manifest['version'], connectionId: connection.id, ...(opts.install ?? {}) } });
  expect(installed.statusCode, installed.body).toBe(200);

  const users = usersRepo(meta);
  const roles = rolesRepo(meta);
  const cookie: Record<string, string> = { owner };
  const ids: Record<string, string> = { owner: (await users.findByEmail(`owner@${key}.test`))!.id };
  for (const [name, held] of Object.entries(opts.people ?? {})) {
    const user = await users.create({ email: `${name}@${key}.test`, name: `${name[0]!.toUpperCase()}${name.slice(1)}`, passwordHash: hash });
    for (const role of held) await roles.assignToUser(user.id, (await roles.findBySlug(`${key}-${role}`))!.id);
    ids[name] = user.id;
    cookie[name] = await signIn(app, `${name}@${key}.test`);
  }

  const prefix = `${key.replace(/-/g, '_')}_`;
  const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const handle = await manager.data(connection.id);
  const t = (ref: string): string => model.tables.find((table) => table.name === `${prefix}${ref}`)!.id;
  const seen = new Set<string>();
  /*
   * An email is read where it is queued, never sent: nothing listens for it.
   * Each is taken off the worker's hands the moment it is seen, with the
   * start it was queued for (now, or the end of somebody's quiet hours).
   */
  const queuedFor = new Map<string, number>();
  const shelveEmails = async (): Promise<void> => {
    const waiting = await meta.db.selectFrom('adminium_jobs').select(['id', 'runAt']).where('kind', '=', 'email.send').where('status', '=', 'pending').execute();
    for (const row of waiting) {
      queuedFor.set(row.id, row.runAt);
      await meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
    }
  };
  const get: WholeServer['get'] = (who, url) => app.inject({ method: 'GET', url, headers: { cookie: cookie[who]! } });
  const send: WholeServer['send'] = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: cookie[who]! }, ...(payload === undefined ? {} : { payload: payload as never }) });
  return {
    dialect,
    app,
    meta,
    manager,
    connectionId: connection.id,
    t,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    cookie,
    ids,
    get,
    send,
    make: (who, ref, values) => send(who, 'POST', `/api/v1/data/${connection.id}/${t(ref)}`, { values }),
    change: (who, ref, pk, values) => send(who, 'PATCH', `/api/v1/data/${connection.id}/${t(ref)}/${String(pk)}`, { values }),
    jobs: async (jobOpts = {}) => {
      const except = jobOpts.except ?? [];
      // Kinds left alone are taken off the queue for the while (also those a job of this call queues), and put back as they were.
      const parked = new Set<string>();
      const park = async (): Promise<void> => {
        if (except.length === 0) return;
        for (const row of await meta.db.selectFrom('adminium_jobs').select(['id']).where('status', '=', 'pending').where('kind', 'in', [...except]).execute()) {
          parked.add(row.id);
          await meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
        }
      };
      for (let round = 0; round < 30; round += 1) {
        await shelveEmails();
        await park();
        // What is queued for the next moments is due (a write from the dashboard waits out its undo first); what waits longer (a wait step, a held summary) is due only when asked.
        let due = meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never);
        if (jobOpts.all !== true) due = due.where('runAt', '<=', Date.now() + 90_000);
        await due.execute();
        if ((await composed.jobs.worker.runOnce()) === 0) break;
      }
      await park();
      for (const id of parked) await meta.db.updateTable('adminium_jobs').set({ status: 'pending' } as never).where('id', '=', id).execute();
      await shelveEmails();
    },
    tick: async () => {
      await meta.db.updateTable('adminium_automations').set({ nextRunAt: 1 }).where('nextRunAt', 'is not', null).execute();
      return (await scanDueSchedules({ meta, manager, enqueue: (input) => composed.jobs.enqueue(input) })).runsStarted;
    },
    emails: async () => {
      await shelveEmails();
      const rows = await meta.db.selectFrom('adminium_jobs').select(['id', 'payload', 'createdAt']).where('kind', '=', 'email.send').orderBy('createdAt', 'asc').execute();
      const out: QueuedEmail[] = [];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string; templateKey: string };
        const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; html: string; text: string };
        out.push({ ...envelope, runAt: queuedFor.get(row.id) ?? 0, templateKey: payload.templateKey });
      }
      return out;
    },
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
