// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A whole composed server under a profile (trial, hosted or none), for the
 * sweeps that prove each switch on the routes themselves.
 *
 * Built as the boot builds it: the environment parsed and what the profile
 * implies enforced, the connection manager with the host list and the
 * operator's login, a dashboard build and one app's two sides. Every call
 * goes to the instance's own address, since a server with a public origin
 * answers any other Host with 421.
 *
 * The meta store is the caller's when it passes one (it outlives the server,
 * as a container recreated on the same store does); otherwise a fresh SQLite
 * one in memory, closed with the server.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { expect } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile, type Env } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { resetEmailRuntime } from '../src/email/send.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import type { HostLookup } from '../src/net/address-guard.js';
import { trialPolicy } from '../src/trial/policy.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

export const PASSWORD = 'a-long-enough-test-password-1!';
export const SETUP_TOKEN = 'a-long-enough-setup-token';
export const OWNER_EMAIL = 'owner@example.test';

/** The operator's address for the instance, and two of the user's own verified domains. */
export const ORIGIN_HOST = 'hollis.try.example.com';
export const OWN = 'shop.hollis.example';
export const OWN_TOO = 'www.hollis.example';

/** The operator's database server, and the one login it gave this installation. */
export const DATABASE_HOSTS = 'pg-trials:5432,*.pooler.supabase.com:6543';
export const SOURCE_URL = 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis';

export const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
  ADMINIUM_DATABASE_HOSTS: DATABASE_HOSTS,
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
  ADMINIUM_SOURCE_URL: SOURCE_URL,
};
export const HOSTED = {
  ADMINIUM_HOSTED_MODE: 'on',
  ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
  ADMINIUM_DATABASE_HOSTS: DATABASE_HOSTS,
  ADMINIUM_SOURCE_URL: SOURCE_URL,
};
/** An ordinary server with the same host list, so only the profile differs. */
export const ORDINARY = { ADMINIUM_DATABASE_HOSTS: DATABASE_HOSTS };

/** No name resolves: a DSN that gets past the profile ends at the lookup (502), never at a database. */
export const NOTHING_RESOLVES: HostLookup = async () => Promise.reject(new Error('ENOTFOUND'));

export const DASH_HTML = '<!doctype html><html><head><title>Adminium</title></head><body data-app="dashboard"></body></html>';
export const CUSTOMER_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title></head><body data-app="clients-customer"></body></html>';
export const SURFACE_ROBOTS = 'User-agent: *\nAllow: /\n';

/** A dashboard build and one app (`clients`) with a customer and a staff side, on disk. */
export interface Fixture {
  root: string;
  dist: string;
  surfaces: HostedSurface[];
  remove(): Promise<void>;
}

export async function makeFixture(prefix: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'index.html'), DASH_HTML);
  for (const side of ['customer', 'staff'] as const) {
    const dir = join(root, 'surfaces', 'clients', side);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), side === 'customer' ? CUSTOMER_HTML : CUSTOMER_HTML.replace('customer', 'staff'));
    await writeFile(join(dir, 'robots.txt'), SURFACE_ROBOTS);
  }
  return { root, dist, surfaces: discoverSurfaces(join(root, 'surfaces')), remove: async () => rm(root, { recursive: true, force: true }) };
}

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Answer {
  status: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => Record<string, unknown>;
}

/** An API answer, its body read as JSON. */
export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export interface CallOptions {
  host?: string;
  headers?: Record<string, string>;
  payload?: unknown;
  remoteAddress?: string;
  /** Without the signed-in Super Admin's session. */
  anonymous?: boolean;
}

export interface ProfileServer {
  composed: ComposedServer;
  meta: MetaDb;
  env: Env;
  /** Any request, on the instance's own address and as the Super Admin unless `opts` says otherwise. */
  call(method: Method, url: string, opts?: CallOptions): Promise<Answer>;
  /** An API call as the Super Admin. */
  api(method: Method, url: string, payload?: unknown): Promise<Reply>;
  /** A call on the operator's own listener, with its token. */
  operator(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<Reply>;
  /** Close the server, and the meta store when it made one. */
  close(): Promise<void>;
}

export interface ServeOptions {
  fixture: Fixture;
  /** The meta store to boot on, kept open after the server closes. Default: a new SQLite one in memory. */
  store?: MetaDb;
  /** Run on the meta store before the server boots. */
  before?: (store: MetaDb) => Promise<void>;
  /**
   * `create`: the first Super Admin through setup (the default). `sign-in`: the
   * one an earlier boot on this store created signs in. `none`: every call is anonymous.
   */
  account?: 'create' | 'sign-in' | 'none';
  lookup?: HostLookup;
}

/** The operator's token, for a server whose env names the operator listener ({@link OPERATOR}). */
export const OPERATOR_TOKEN = 'a1'.repeat(32);
export const OPERATOR = { ADMINIUM_OPERATOR_TOKEN: OPERATOR_TOKEN, ADMINIUM_OPERATOR_LISTEN: '127.0.0.1:4805' };

/** A composed server on `env`; its Super Admin signed in as `opts.account` says. */
export async function serveProfile(env: Record<string, string>, opts: ServeOptions): Promise<ProfileServer> {
  const owned = opts.store === undefined;
  const store = opts.store ?? createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  if (owned) await firstRun(store);
  await opts.before?.(store);
  // As the boot reads it: what the profile implies is enforced.
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  // The name a browser reaches it by: the operator's address, else the first listed domain.
  const home = env['ADMINIUM_PUBLIC_ORIGIN'] === undefined ? (env['ADMINIUM_OPERATOR_DOMAINS']?.split(',')[0] ?? ORIGIN_HOST) : new URL(env['ADMINIUM_PUBLIC_ORIGIN']).host;
  const composed = await composeServer({
    env: parsed,
    metaStore,
    // As `openRuntime` builds it: the profile, the host list and the operator's login.
    manager: new ConnectionManager({
      meta: store,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
      blockLoopback: true,
      databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS,
      networkPolicy: parsed.ADMINIUM_NETWORK_POLICY,
      lookup: opts.lookup ?? NOTHING_RESOLVES,
      policy: trialPolicy(parsed),
      operatorSourceUrl: parsed.ADMINIUM_SOURCE_URL,
    }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    staticRoot: opts.fixture.dist,
    surfaces: opts.fixture.surfaces,
  });
  const { app } = composed;
  await app.ready();
  const close = async (): Promise<void> => {
    await app.close();
    resetEmailRuntime();
    if (owned) await store.db.destroy();
  };

  let cookie = '';
  const inject = async (method: Method, url: string, callOpts: CallOptions = {}): Promise<Answer> => {
    const res = await app.inject({
      method,
      url,
      headers: { host: callOpts.host ?? home, ...(callOpts.anonymous === true || cookie === '' ? {} : { cookie }), ...callOpts.headers },
      ...(callOpts.remoteAddress === undefined ? {} : { remoteAddress: callOpts.remoteAddress }),
      ...(callOpts.payload === undefined ? {} : { payload: callOpts.payload as object }),
    });
    return { status: res.statusCode, body: res.body, headers: res.headers, json: () => res.json() };
  };
  try {
    const account = opts.account ?? 'create';
    if (account === 'create') {
      const setup = await inject('POST', '/api/v1/setup/super-admin', {
        // A browser on the instance's own address.
        headers: { origin: `https://${home}` },
        payload: { email: OWNER_EMAIL, password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
      });
      expect(setup.status, setup.body).toBe(201);
      cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
    } else if (account === 'sign-in') {
      const login = await inject('POST', '/api/v1/auth/login', { payload: { email: OWNER_EMAIL, password: PASSWORD } });
      expect(login.status, login.body).toBe(200);
      cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
    }
  } catch (error) {
    await close();
    throw error;
  }

  return {
    composed,
    meta: store,
    env: parsed,
    call: inject,
    api: async (method, url, payload) => {
      const res = await inject(method, url, payload === undefined ? {} : { payload });
      return { status: res.status, body: res.json() };
    },
    operator: async (method, url, payload) => {
      const endpoint = app.operatorEndpoint;
      expect(endpoint, 'the operator listener: set OPERATOR in the env').not.toBeNull();
      const res = await endpoint!.server.inject({
        method,
        url,
        headers: { host: '10.0.0.2:4601', authorization: `Bearer ${OPERATOR_TOKEN}` },
        remoteAddress: '10.0.0.9',
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { status: res.statusCode, body: res.json() };
    },
    close,
  };
}

/** The refusal body of an operator's switch. */
export const offBy = (question: string, reason = 'trial-mode') => ({ error: { code: 'OFF_BY_OPERATOR', details: { question, reason } } });

/** The error code of an API reply, if any. */
export const codeOf = (reply: Reply): unknown => (reply.body['error'] as { code?: unknown } | undefined)?.code;
