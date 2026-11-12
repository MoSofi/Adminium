// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial past its end date: read-only with a short list of exceptions,
 * public pages hidden on every host, and user mail stopped while the server's
 * own mail goes on. Each both ways: an ended trial against a running one, a
 * hosted and an ordinary server.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { configureEmailRuntime, enqueueRenderedEmail, resetEmailRuntime, PASSWORD_RESET_TEMPLATE_KEY, NOTIFICATION_EMAIL_TEMPLATE_KEY } from '../src/email/send.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { createOutboxSender } from '../src/outbox/sender.js';
import { trialPolicy } from '../src/trial/policy.js';
import { writesWhenEnded } from '../src/trial/read-only.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PASSWORD = 'a-long-enough-test-password-1!';
const SETUP_TOKEN = 'a-long-enough-setup-token';
const ORIGIN_HOST = 'hollis.try.example.com';
const OWN = 'shop.hollis.example';

const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
  ADMINIUM_OPERATOR_DOMAINS: OWN,
  ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}`,
};
const ENDED = { ...TRIAL, ADMINIUM_TRIAL_ENDS_AT: '2020-01-01T00:00:00Z' };
const RUNNING = { ...TRIAL, ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z' };
const HOSTED = { ADMINIUM_HOSTED_MODE: 'on', ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`, ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432', ADMINIUM_OPERATOR_DOMAINS: OWN, ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}` };
const ORDINARY = { ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`, ADMINIUM_OPERATOR_DOMAINS: OWN, ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}` };

const DASH_HTML = '<!doctype html><html><head><title>Adminium</title></head><body data-app="dashboard"></body></html>';
const SIDE_HTML = '<!doctype html><html lang="en"><head><title>Shop</title></head><body data-app="clients"></body></html>';
const PAGE_LOAD = { accept: 'text/html', 'sec-fetch-mode': 'navigate' };

let root: string;
let surfaces: HostedSurface[];
let dist: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'trial-ended-'));
  dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'index.html'), DASH_HTML);
  for (const side of ['customer', 'staff'] as const) {
    const dir = join(root, 'surfaces', 'clients', side);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), SIDE_HTML);
  }
  surfaces = discoverSurfaces(join(root, 'surfaces'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
  resetEmailRuntime();
});

interface Answer {
  status: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => { error?: { code?: string; details?: { question?: string; reason?: string } } };
}

interface CallOptions {
  host?: string;
  headers?: Record<string, string>;
  payload?: unknown;
  anonymous?: boolean;
}

/** A composed server on `env` with one app's two sides, the user's domain mapped to its customer side, its first Super Admin signed in. */
async function serve(env: Record<string, string>) {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  await settingsRepo(store).set('surfaces.domains', { [OWN]: { appKey: 'clients', side: 'customer' } }, { updatedBy: null });
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager: new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null, blockLoopback: true, policy: trialPolicy(parsed) }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    staticRoot: dist,
    surfaces,
  });
  const { app } = composed;
  await app.ready();
  // The first-run setup is one of the writes an ended trial still takes.
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    headers: { host: ORIGIN_HOST, origin: `https://${ORIGIN_HOST}` },
    payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  let cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, opts: CallOptions = {}): Promise<Answer> => {
    const res = await app.inject({
      method,
      url,
      headers: { host: opts.host ?? ORIGIN_HOST, ...(opts.anonymous === true ? {} : { cookie }), ...opts.headers },
      ...(opts.payload === undefined ? {} : { payload: opts.payload as object }),
    });
    return { status: res.statusCode, body: res.body, headers: res.headers, json: () => res.json() };
  };
  return {
    call,
    /** Sign in again, as the ended trial's person would after their session ran out. */
    signIn: async (): Promise<Answer> => {
      const res = await call('POST', '/api/v1/auth/login', { anonymous: true, payload: { email: 'owner@example.test', password: PASSWORD } });
      if (res.status === 200) cookie = String(res.headers['set-cookie']).split(';')[0] ?? cookie;
      return res;
    },
  };
}

/** Writes a person makes on staff pages: each refused once a trial has ended. */
const WRITES: { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; payload?: unknown }[] = [
  { method: 'PATCH', url: '/api/v1/me', payload: { name: 'Dana P.' } },
  { method: 'POST', url: '/api/v1/option-lists', payload: { name: 'Sizes', options: [] } },
  { method: 'DELETE', url: '/api/v1/connections/00000000-0000-0000-0000-000000000000' },
  { method: 'PUT', url: '/api/v1/settings/branding.appName', payload: { value: 'Hollis' } },
];

const refusedAsEnded = (res: Answer): boolean => res.status === 403 && res.json().error?.code === 'OFF_BY_OPERATOR' && res.json().error?.details?.question === 'writes';

describe('a trial past its end date is read-only', { timeout: 60_000 }, () => {
  it('refuses every write with OFF_BY_OPERATOR and the trial-ended reason', async () => {
    const s = await serve(ENDED);
    for (const write of WRITES) {
      const res = await s.call(write.method, write.url, write.payload === undefined ? {} : { payload: write.payload });
      expect(res.status, `${write.method} ${write.url}: ${res.body}`).toBe(403);
      expect(res.json().error?.code).toBe('OFF_BY_OPERATOR');
      expect(res.json().error?.details).toEqual({ question: 'writes', reason: 'trial-ended' });
    }
    // Reading goes on.
    expect((await s.call('GET', '/api/v1/system/info')).status).toBe(200);
    expect((await s.call('GET', '/api/v1/bootstrap')).status).toBe(200);
  });

  it('lets signing in and out, the export and the person’s display choices through', async () => {
    const s = await serve(ENDED);
    expect((await s.call('PATCH', '/api/v1/me/prefs', { payload: { theme: 'dark' } })).status).toBe(200);
    const exporting = await s.call('POST', '/api/v1/export/zip', { payload: {} });
    expect(refusedAsEnded(exporting), exporting.body).toBe(false);
    expect(exporting.status, exporting.body).toBeLessThan(300);
    expect((await s.call('POST', '/api/v1/widget-data/batch', { payload: { requests: [] } })).status).not.toBe(403);
    const out = await s.call('POST', '/api/v1/auth/logout');
    expect(refusedAsEnded(out), out.body).toBe(false);
    expect((await s.signIn()).status).toBe(200);
    // The setup token flow: already done here, so a conflict, not the read-only refusal.
    expect(refusedAsEnded(await s.call('POST', '/api/v1/setup/token', { anonymous: true, payload: { token: SETUP_TOKEN } }))).toBe(false);
  });

  for (const [name, env] of [
    ['a running trial', RUNNING],
    ['a hosted server', HOSTED],
    ['an ordinary server', ORDINARY],
  ] as const) {
    it(`takes the same writes on ${name}`, async () => {
      const s = await serve(env);
      for (const write of WRITES) {
        const res = await s.call(write.method, write.url, write.payload === undefined ? {} : { payload: write.payload });
        expect(refusedAsEnded(res), `${write.method} ${write.url}: ${res.body}`).toBe(false);
      }
      expect((await s.call('PATCH', '/api/v1/me', { payload: { name: 'Dana P.' } })).status).toBe(200);
    });
  }

  it('lists exactly the writes it keeps', () => {
    expect(writesWhenEnded('POST', '/api/v1/auth/login')).toBe(true);
    expect(writesWhenEnded('POST', '/api/v1/export/zip')).toBe(true);
    expect(writesWhenEnded('POST', '/api/v1/apps/crm/documents/render')).toBe(true);
    expect(writesWhenEnded('POST', '/api/v1/apps//documents/render')).toBe(false);
    expect(writesWhenEnded('GET', '/api/v1/auth/login')).toBe(false);
    expect(writesWhenEnded('POST', '/api/v1/auth/login/more')).toBe(false);
    expect(writesWhenEnded('PATCH', '/api/v1/me')).toBe(false);
    expect(writesWhenEnded('POST', '/api/v1/setup/adopt')).toBe(false);
  });
});

/** Doors strangers reach that answer on a running trial. */
const PUBLIC_DOORS: { name: string; url: string; host?: string }[] = [
  { name: 'a customer side', url: '/apps/clients/customer/' },
  { name: 'a customer side on its own domain', url: '/', host: OWN },
];

describe('a trial past its end date hides its public pages', { timeout: 60_000 }, () => {
  it('answers 404 at every public door, on every host, and keeps the staff pages', async () => {
    const s = await serve(ENDED);
    for (const door of PUBLIC_DOORS) {
      const res = await s.call('GET', door.url, { anonymous: true, ...(door.host === undefined ? {} : { host: door.host }) });
      expect(res.status, `${door.name}: ${res.body.slice(0, 200)}`).toBe(404);
    }
    // A browser gets the bare unavailable page, which says nothing of why, and no search engine keeps it.
    const page = await s.call('GET', '/apps/clients/customer/', { anonymous: true, headers: PAGE_LOAD });
    expect(page.status).toBe(404);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.body).toContain('This page is unavailable.');
    expect(page.body).not.toMatch(/trial/i);
    expect(String(page.headers['x-robots-tag'])).toMatch(/noindex/);
    // Staff pages answer.
    expect((await s.call('GET', '/', { headers: PAGE_LOAD })).status).toBe(200);
    expect((await s.call('GET', '/api/v1/system/info', { anonymous: true })).status).toBe(200);
  });

  it('shows them on a running trial', async () => {
    const s = await serve(RUNNING);
    for (const door of PUBLIC_DOORS) {
      const res = await s.call('GET', door.url, { anonymous: true, ...(door.host === undefined ? {} : { host: door.host }) });
      expect(res.status, `${door.name}: ${res.body.slice(0, 200)}`).toBe(200);
    }
  });

  it('hides a stranger’s door by its route’s tag, and no staff door', async () => {
    const s = await serve(ENDED);
    const hidden = (res: Answer): boolean =>
      res.status === 404 && (res.body.includes('This page is unavailable.') || res.body.includes('Nothing is served at this address.'));
    for (const path of ['/x/forms/a', '/x/embed.js', '/m/u/token', '/pay/abc', '/api/v1/public/config', '/api/v1/api-docs', '/apps/crm/customer/', '/apps/clients/customer/x']) {
      const res = await s.call('GET', path, { anonymous: true, headers: PAGE_LOAD });
      expect(hidden(res), `${path}: ${res.status} ${res.body.slice(0, 160)}`).toBe(true);
    }
    for (const path of ['/', '/me', '/payments', '/login', '/apps/clients/staff/', '/api/v1/system/info', '/api/v1/branding']) {
      const res = await s.call('GET', path, { anonymous: true, headers: PAGE_LOAD });
      expect(hidden(res), `${path}: ${res.status} ${res.body.slice(0, 160)}`).toBe(false);
    }
  });
});

describe('a trial past its end date stops user mail', () => {
  const rendered = { subject: 'Hello', html: '<p>Hello</p>', text: 'Hello', inline: [] };

  it('queues the server’s own mail and nothing else', async () => {
    const queued: string[] = [];
    const enqueue = vi.fn(async (job: { payload: Record<string, unknown> }) => {
      queued.push(String(job.payload['templateKey']));
      return { id: String(queued.length) } as never;
    });
    configureEmailRuntime({ secret: TEST_SECRET, userMail: () => false });
    const deps = { meta: undefined as never, enqueue };
    expect(await enqueueRenderedEmail(deps, { to: 'dana@example.test', templateKey: PASSWORD_RESET_TEMPLATE_KEY, locale: 'en_US', rendered })).not.toBeNull();
    expect(await enqueueRenderedEmail(deps, { to: 'dana@example.test', templateKey: NOTIFICATION_EMAIL_TEMPLATE_KEY, locale: 'en_US', rendered })).toBeNull();
    expect(await enqueueRenderedEmail(deps, { to: 'guest@example.test', templateKey: 'booking-confirmation', locale: 'en_US', rendered })).toBeNull();
    expect(queued).toEqual([PASSWORD_RESET_TEMPLATE_KEY]);

    configureEmailRuntime({ secret: TEST_SECRET, userMail: () => true });
    expect(await enqueueRenderedEmail(deps, { to: 'dana@example.test', templateKey: NOTIFICATION_EMAIL_TEMPLATE_KEY, locale: 'en_US', rendered })).not.toBeNull();
    expect(queued).toEqual([PASSWORD_RESET_TEMPLATE_KEY, NOTIFICATION_EMAIL_TEMPLATE_KEY]);
  });

  it('leaves an app’s queued rows queued while user mail is stopped', async () => {
    let open = false;
    const live = vi.fn(async () => Promise.resolve([]));
    const sender = createOutboxSender({ meta: undefined as never, manager: undefined as never, viewFor: async () => null, writes: undefined as never, live, userMail: () => open });
    expect(await sender.sweep()).toBe(0);
    expect(await sender.sendApp('crm')).toBe(0);
    expect(live).not.toHaveBeenCalled();
    open = true;
    await sender.sweep();
    expect(live).toHaveBeenCalled();
  });

  it('wires the policy’s answer into the mail layer on a composed server', async () => {
    await serve(ENDED);
    const enqueue = vi.fn(async () => ({ id: '1' }) as never);
    expect(await enqueueRenderedEmail({ meta: undefined as never, enqueue }, { to: 'a@example.test', templateKey: NOTIFICATION_EMAIL_TEMPLATE_KEY, locale: 'en_US', rendered })).toBeNull();
    expect(await enqueueRenderedEmail({ meta: undefined as never, enqueue }, { to: 'a@example.test', templateKey: PASSWORD_RESET_TEMPLATE_KEY, locale: 'en_US', rendered })).not.toBeNull();
  });
});
