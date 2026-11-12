// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The hosted profile (`ADMINIUM_HOSTED_MODE=on`): a paid installation on the
 * operator's server, after the Upgrade. Its Super Admin is still a stranger
 * there, so what would let their code or their connections reach the operator
 * stays off, as in a trial; what only limits a free trial goes.
 *
 * One `describe` per row of the hosted column, each showing the hosted answer
 * beside a trial's and an ordinary server's wherever they differ, on a whole
 * composed server where a route is the door. The last one boots a trial and
 * then the hosted profile on the same meta store and data folder, as the
 * Upgrade recreates the container, on every meta-store engine.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, settingsRepo, type Automation, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ActionFailure, type ActionContext } from '../src/automations/actions/types.js';
import { runWebhookAction } from '../src/automations/actions/webhook.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { resolveRule } from '../src/automations/validate.js';
import { enforceProfile, profileIssues } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import type { HostLookup } from '../src/net/address-guard.js';
import { ownCodeAllows } from '../src/trial/own-code.js';
import { allowsIn, trialPolicy } from '../src/trial/policy.js';
import { AVAILABLE, makeStore, type EngineName } from './archive.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import {
  codeOf,
  HOSTED,
  makeFixture,
  offBy,
  OPERATOR,
  ORDINARY,
  ORIGIN_HOST,
  OWN,
  OWN_TOO,
  serveProfile,
  SOURCE_URL,
  TRIAL,
  type Fixture,
  type ProfileServer,
  type Reply,
  type ServeOptions,
} from './profile-server.helpers.js';

const NOINDEX = 'noindex, nofollow';
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const PAGE_LOAD = { accept: 'text/html', 'sec-fetch-mode': 'navigate' };

/** The three profiles, by name, with the reason each refusal carries. */
const PROFILES = [
  ['trial', TRIAL, 'trial-mode'],
  ['hosted', HOSTED, 'hosted-mode'],
  ['ordinary', ORDINARY, null],
] as const;

let fixture: Fixture;
beforeAll(async () => {
  fixture = await makeFixture('hosted-mode-');
});
afterAll(async () => {
  await fixture.remove();
});

/** Servers and stores a case made, closed after it in reverse. */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** One server at a time: their schedules share one name space, so each is closed before the next boots. */
let open: ProfileServer | null = null;
async function serve(env: Record<string, string>, opts: Omit<ServeOptions, 'fixture'> = {}): Promise<ProfileServer> {
  await open?.close();
  open = null;
  const s = await serveProfile(env, { fixture, ...opts });
  open = s;
  cleanups.push(async () => {
    if (open === s) {
      open = null;
      await s.close();
    }
  });
  return s;
}

// ── A1 connections: the host list, `strict`, local databases off, the meta store fixed ──

describe('A1 connections: kept', { timeout: 60_000 }, () => {
  const test = (s: ProfileServer, engine: string, dsn: string) => s.api('POST', '/api/v1/connections/test', { engine, dsn });

  for (const [profile, env, reason] of PROFILES) {
    it(`${profile}: ${reason === null ? 'every way open, as before' : `refused with ${reason}`}`, async () => {
      const s = await serve(env);
      // What the profile implies is enforced in the parsed environment itself.
      expect(s.env.ADMINIUM_NETWORK_POLICY).toBe(reason === null ? 'open' : 'strict');
      expect(s.env.ADMINIUM_LOCAL_DATABASES).toBe(reason === null ? undefined : 'off');
      expect((await s.api('GET', '/api/v1/settings/local-databases')).body).toMatchObject(reason === null ? { allowed: true } : { allowed: false, reason });

      const sqlite = await test(s, 'sqlite', 'sqlite:/tmp/p75-t33-anything.db');
      const unlisted = await test(s, 'postgres', 'postgres://me:pw@db.elsewhere.example:5432/shop');
      const otherLogin = await test(s, 'postgres', 'postgres://trial_other:pw@pg-trials:5432/trial_other');
      const info = (await s.api('GET', '/api/v1/system/info')).body;
      if (reason === null) {
        expect(codeOf(sqlite)).not.toBe('OFF_BY_OPERATOR');
        expect(codeOf(unlisted)).toBe('HOST_LOOKUP_FAILED');
        expect(codeOf(otherLogin)).toBe('HOST_LOOKUP_FAILED');
        expect(info).toMatchObject({ offByOperator: { sqliteSources: { allowed: true }, metaStore: { allowed: true } } });
        return;
      }
      expect(sqlite).toMatchObject({ status: 403, body: offBy('sqliteSources', reason) });
      expect(unlisted).toMatchObject({ status: 403, body: offBy('unlistedDatabaseHosts', reason) });
      expect(otherLogin).toMatchObject({ status: 403, body: offBy('anyDatabaseLogin', reason) });
      expect(info).toMatchObject({ offByOperator: { sqliteSources: { allowed: false, reason }, metaStore: { allowed: false, reason } } });
      // The meta store is the operator's: a move is refused.
      expect(await s.api('POST', '/api/v1/meta/relocate', { dsn: 'postgres://u:p@pg-trials:5432/other' })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes', reason) });
      // The operator's own login passes on to the lookup, within one budget of tests for the whole installation
      // (the refusals above spent from it too).
      let limited: Reply | null = null;
      for (let i = 0; i < 10 && limited === null; i += 1) {
        const res = await test(s, 'postgres', SOURCE_URL);
        if (res.status === 429) limited = res;
        else expect(codeOf(res)).toBe('HOST_LOOKUP_FAILED');
      }
      expect(limited).toMatchObject({ status: 429, body: { error: { code: 'RATE_LIMITED', details: { scope: 'instance', limit: 10 } } } });
    });
  }

  it('hosted: a meta store address the typed guard refuses stops the boot, as in a trial', () => {
    expect(allowsIn('hosted', 'metaStoreRoutes')).toEqual({ allowed: false, reason: 'hosted-mode' });
    expect(profileIssues({ ...HOSTED, ADMINIUM_NETWORK_POLICY: 'open' })).toEqual([expect.objectContaining({ variable: 'ADMINIUM_NETWORK_POLICY' })]);
    expect(profileIssues({ ...HOSTED, ADMINIUM_LOCAL_DATABASES: 'setting' })).toEqual([expect.objectContaining({ variable: 'ADMINIUM_LOCAL_DATABASES' })]);
    expect(profileIssues({ ...ORDINARY, ADMINIUM_NETWORK_POLICY: 'open', ADMINIUM_LOCAL_DATABASES: 'setting' })).toEqual([]);
  });
});

// ── A1b storage only under the data folder ──────────────────────────────────

describe('A1b storage only under the data folder: kept', { timeout: 60_000 }, () => {
  const s3 = { name: 'Bucket', driver: 's3', config: { bucket: 'b', region: 'eu-west-1', endpoint: 'https://s3.example.com', prefix: 'files', forcePathStyle: false }, secret: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'example-secret' } };

  for (const [profile, env, reason] of PROFILES) {
    it(`${profile}: another destination ${reason === null ? 'reaches the destination code' : 'is refused'}`, async () => {
      const s = await serve(env);
      const made = await s.api('POST', '/api/v1/storage/destinations', s3);
      const tested = await s.api('POST', '/api/v1/storage/destinations/dst_any/test');
      if (reason === null) {
        expect(codeOf(made)).not.toBe('OFF_BY_OPERATOR');
        expect(codeOf(tested)).toBe('NOT_FOUND');
      } else {
        expect(made).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
        expect(tested).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      }
      expect((await s.api('GET', '/api/v1/storage/destinations')).status).toBe(200);
    });
  }

  it('a destination seeded from the environment stops a hosted boot, not an ordinary one', () => {
    expect(profileIssues({ ...HOSTED, ADMINIUM_STORAGE_URL: 's3://bucket?endpoint=https://s3.example.com' })).toEqual([expect.objectContaining({ variable: 'ADMINIUM_STORAGE_URL' })]);
    expect(profileIssues({ ...ORDINARY, ADMINIUM_STORAGE_URL: 's3://bucket?endpoint=https://s3.example.com' })).toEqual([]);
  });
});

// ── A2 outgoing traffic: public addresses and own SMTP allowed ──────────────

describe('A2 outgoing traffic: allowed to public addresses', { timeout: 60_000 }, () => {
  const webhook = (url: string) => ({ kind: 'webhook', url, method: 'POST', bodyKind: 'json', body: null, headerName: null, headerValueEncrypted: null }) as const;
  const graph = (url: string) => ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Tell', onError: false, action: webhook(url) }] }) as never;
  const trigger = { kind: 'schedule', connectionId: null, schedule: { kind: 'interval', everyMinutes: '15' } } as never;

  /** The webhook step's run, with the manager the boot builds for `env`, a name that resolves to `address`. */
  async function runHook(env: Record<string, string>, address: string): Promise<string[]> {
    const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    cleanups.push(async () => store.db.destroy());
    const parsed = enforceProfile(makeEnv(env));
    const lookup: HostLookup = async () => [address];
    const manager = new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null, blockLoopback: true, networkPolicy: parsed.ADMINIUM_NETWORK_POLICY, lookup, policy: trialPolicy(parsed) });
    const sent: string[] = [];
    const ctx = {
      meta: null,
      manager,
      app: { trialPolicy: trialPolicy(parsed) },
      rule: { id: 'rule_1', name: 'Tell the hook' } as Automation,
      runId: 'run_1',
      hops: 0,
      now: Date.now(),
      source: null,
      tokens: {},
      text: TRACE_EN,
      secret: 's'.repeat(32),
      fetch: async (url: string | URL) => {
        sent.push(String(url));
        return new Response('ok');
      },
    } as unknown as ActionContext;
    await runWebhookAction(webhook('https://hooks.example.com/in') as never, ctx);
    return sent;
  }

  it('the webhook step: saved and sent by the hosted profile to a public address, never to its own network; refused by a trial', async () => {
    const save = (env: Record<string, string>) => () =>
      resolveRule(trigger, graph('https://hooks.example.com/in'), { view: null, templateKeys: new Set<string>(), blockLoopback: true, policy: trialPolicy(enforceProfile(makeEnv(env))) });
    expect(save(TRIAL)).toThrow(expect.objectContaining({ code: 'OFF_BY_OPERATOR', details: { question: 'webhooks', reason: 'trial-mode' } }));
    expect(save(HOSTED)).not.toThrow();
    expect(save(ORDINARY)).not.toThrow();

    expect(await runHook(HOSTED, '203.0.113.7')).toEqual(['https://hooks.example.com/in']);
    // `strict`: a name that resolves to the operator's network is not called.
    await expect(runHook(HOSTED, '10.0.0.5')).rejects.toThrow(ActionFailure);
    await expect(runHook(TRIAL, '203.0.113.7')).rejects.toThrow(ActionFailure);
    // An ordinary server's own network is its operator's business.
    expect(await runHook(ORDINARY, '10.0.0.5')).toEqual(['https://hooks.example.com/in']);
  });

  for (const [profile, env] of [
    ['hosted', HOSTED],
    ['ordinary', ORDINARY],
  ] as const) {
    it(`${profile}: the Super Admin's own SMTP server is saved and used`, async () => {
      const s = await serve(env);
      const smtp = { host: 'smtp.example.com', port: 587, user: 'shop', pass: 'smtp-password-1', from: 'Shop <shop@example.com>', secure: false };
      const saved = await s.api('PUT', '/api/v1/settings/email', { smtp });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(await settingsRepo(s.meta).get('email.smtp')).toMatchObject({ host: 'smtp.example.com', port: 587, user: 'shop' });
      expect((await s.api('GET', '/api/v1/system/info')).body).toMatchObject({ smtpConfigured: true });
    });
  }

  it('trial: the relay only (the policy answers no; the relay holds the lock)', () => {
    expect(trialPolicy(makeEnv(TRIAL)).allows('ownSmtp')).toEqual({ allowed: false, reason: 'trial-mode' });
    expect(trialPolicy(makeEnv(HOSTED)).allows('ownSmtp')).toEqual({ allowed: true, reason: null });
    // The relay's variable belongs to a trial: a hosted boot with it left in fails and says so.
    expect(profileIssues({ ...HOSTED, ADMINIUM_TRIAL_SMTP_URL: 'smtp://u:p@relay.example.com:587' })).toEqual([expect.objectContaining({ variable: 'ADMINIUM_TRIAL_SMTP_URL' })]);
  });

  for (const [profile, env, reason] of PROFILES) {
    it(`${profile}: payments, add-on HTTP, the Designer's picture search, telemetry and the update check ${reason === 'trial-mode' ? 'off' : 'on'}`, async () => {
      const s = await serve(env);
      const policy = trialPolicy(s.env);
      const off = reason === 'trial-mode';
      for (const question of ['paymentProviders', 'addOnHttp', 'designerNetwork', 'geoServers', 'updateCheck', 'telemetry'] as const) {
        expect(policy.allows(question), question).toEqual(off ? { allowed: false, reason } : { allowed: true, reason: null });
      }
      expect((await s.api('GET', '/api/v1/payments/setup')).body).toMatchObject(off ? { data: { reachability: { state: 'operator-off' } } } : {});
      expect((await s.api('GET', '/api/v1/settings/telemetry')).body).toMatchObject({
        data: { locks: { telemetry: off ? { allowed: false, reason } : { allowed: true, reason: null }, updateCheck: off ? { allowed: false } : { allowed: true } } },
      });
      expect((await s.api('GET', '/api/v1/settings/maps')).body).toMatchObject({ data: { mapServerOff: off } });
    });
  }
});

// ── A3 own code: catalogue packages only, the Designer declarative ─────────

describe('A3 own add-on and app uploads off, the Designer declarative only: kept', { timeout: 60_000 }, () => {
  const SHA = 'sha512-' + 'A'.repeat(86) + '==';
  const OCTET = { 'content-type': 'application/octet-stream' };

  for (const [profile, env, reason] of PROFILES) {
    it(`${profile}: ${reason === null ? 'uploads reach the package check' : `uploads refused with ${reason}`}, and the Designer ${reason === null ? 'writes code' : 'builds with the manifest only'}`, async () => {
      const s = await serve(env);
      for (const url of [`/api/v1/add-ons/upload?expectedSha512=${SHA}`, `/api/v1/apps/upload?expectedSha512=${SHA}`]) {
        const res = await s.call('POST', url, { payload: Buffer.from('not a package'), headers: OCTET });
        if (reason === null) expect(res.json()['error'], url).not.toMatchObject({ code: 'PACKAGE_UPLOADS_OFF' });
        else expect(res.json()['error'], url).toMatchObject({ code: 'PACKAGE_UPLOADS_OFF', details: { question: 'packageUploads', reason } });
      }
      const answer = reason === null ? { allowed: true, reason: null } : { allowed: false, reason };
      expect((await s.api('GET', '/api/v1/system/info')).body['ownCode']).toEqual({ packageUploads: answer, designerUploads: answer, ownBuilds: answer });
      // The guards where the effect happens read the policy this server was built with.
      for (const question of ['designerCode', 'ownBuilds', 'requestPackage', 'designerUploads'] as const) {
        expect(ownCodeAllows(question), question).toEqual(answer);
      }
      // A project's `.env` is not read under either profile.
      expect(trialPolicy(s.env).allows('projectDotEnv')).toEqual(answer);
    });
  }
});

// ── A4 the operator's addresses and the origin lock; `noindex` dropped ─────

describe('A4 the operator’s domains and the origin lock: kept; noindex: dropped', { timeout: 60_000 }, () => {
  const mapOwnDomain = async (store: MetaDb) => {
    await settingsRepo(store).set('surfaces.domains', { [OWN_TOO]: { appKey: 'clients', side: 'customer' } }, { updatedBy: null });
  };

  for (const [profile, env, reason] of PROFILES.slice(0, 2)) {
    it(`${profile}: another Host is a 421, the origin is the operator's, a domain off the list is refused`, async () => {
      const s = await serve({ ...env, ADMINIUM_OPERATOR_DOMAINS: `${OWN},${OWN_TOO}` }, { before: mapOwnDomain });
      expect((await s.call('GET', '/api/v1/system/info', { host: 'evil.example' })).status).toBe(421);
      expect((await s.call('GET', '/api/v1/system/info', { host: OWN })).status).toBe(200);
      expect((await s.api('GET', '/api/v1/settings/email')).body).toMatchObject({ data: { publicOrigin: `https://${OWN}`, locks: { publicOrigin: { allowed: false, reason } } } });
      expect(await s.api('PUT', '/api/v1/settings/email', { publicOrigin: 'https://evil.example' })).toMatchObject({ status: 409, body: { error: { code: 'SET_BY_OPERATOR', details: { reason } } } });
      const mapped = await s.api('PUT', '/api/v1/surfaces/domains', { domains: { 'evil.example': { appKey: 'clients', side: 'customer' } } });
      expect(mapped).toMatchObject({ status: 403, body: { error: { details: { reason } } } });

      // Search engines: a trial hides its public pages from them, the hosted profile does not.
      const page = await s.call('GET', '/', { host: OWN_TOO, anonymous: true, headers: PAGE_LOAD });
      expect(page.status, page.body.slice(0, 200)).toBe(200);
      const robots = await s.call('GET', '/robots.txt', { host: OWN_TOO, anonymous: true });
      if (profile === 'trial') {
        expect(page.headers['x-robots-tag']).toBe(NOINDEX);
        expect(page.body).toContain(ROBOTS_META);
        expect(robots.body).toBe('User-agent: *\nDisallow: /\n');
      } else {
        expect(page.headers['x-robots-tag']).toBeUndefined();
        expect(page.body).not.toContain(ROBOTS_META);
        // The app's own robots.txt.
        expect(robots.body).toBe('User-agent: *\nAllow: /\n');
      }
      // Pay pages and payment webhooks: off with a trial's payments, back with the hosted profile's.
      const pay = await s.call('GET', '/pay/not-a-real-token', { anonymous: true });
      expect(pay.status === 403 && JSON.stringify(pay.json()).includes(reason)).toBe(profile === 'trial');
    });
  }

  it('ordinary: any Host, the Super Admin sets the origin, any domain maps, nothing hidden from search engines', async () => {
    const s = await serve(ORDINARY);
    expect((await s.call('GET', '/api/v1/system/info', { host: 'evil.example' })).status).toBe(200);
    expect((await s.api('PUT', '/api/v1/settings/email', { publicOrigin: 'https://admin.hollis.example' })).status).toBe(200);
    expect((await s.api('PUT', '/api/v1/surfaces/domains', { domains: { 'shop.anywhere.example': { appKey: 'clients', side: 'customer' } } })).status).toBe(200);
    expect((await s.call('GET', '/', { anonymous: true })).headers['x-robots-tag']).toBeUndefined();
  });
});

// ── A5 the clock, the banners, read-only after the end date: dropped ───────

describe('A5 the clock, banners and read-only after the end date: dropped', { timeout: 60_000 }, () => {
  it('trial: the clock and the Upgrade address in /system/info; read-only once ended', async () => {
    const running = await serve({ ...TRIAL, ADMINIUM_TRIAL_UPGRADE_URL: 'https://example.com/upgrade' });
    expect((await running.api('GET', '/api/v1/system/info')).body['trial']).toMatchObject({ on: true, endsAt: '2099-12-01T00:00:00.000Z', daysLeft: expect.any(Number), upgradeUrl: `https://example.com/upgrade?instance=https%3A%2F%2F${ORIGIN_HOST}` });
    const ended = await serve({ ...TRIAL, ADMINIUM_TRIAL_ENDS_AT: '2020-01-01T00:00:00Z' });
    expect(await ended.api('PATCH', '/api/v1/me', { name: 'Dana P.' })).toMatchObject({ status: 403, body: offBy('writes', 'trial-ended') });
  });

  for (const [profile, env] of [
    ['hosted', HOSTED],
    ['ordinary', ORDINARY],
  ] as const) {
    it(`${profile}: no trial, no banner, no Upgrade, and every write as ever`, async () => {
      const s = await serve(env);
      expect((await s.api('GET', '/api/v1/system/info')).body['trial']).toEqual({ on: false, endsAt: null, daysLeft: null, upgradeUrl: null });
      expect((await s.api('PATCH', '/api/v1/me', { name: 'Dana P.' })).status).toBe(200);
      expect(trialPolicy(s.env).allows('writes', Date.parse('2200-01-01T00:00:00Z'))).toEqual({ allowed: true, reason: null });
      expect(trialPolicy(s.env).allows('publicPages', Date.parse('2200-01-01T00:00:00Z'))).toEqual({ allowed: true, reason: null });
      expect(trialPolicy(s.env).allows('userMail', Date.parse('2200-01-01T00:00:00Z'))).toEqual({ allowed: true, reason: null });
    });
  }

  it('hosted: a trial variable left in fails the boot and names it, so no stale clock or Upgrade address carries over', () => {
    for (const [name, value] of [
      ['ADMINIUM_TRIAL_ENDS_AT', '2099-12-01T00:00:00Z'],
      ['ADMINIUM_TRIAL_UPGRADE_URL', 'https://example.com/upgrade'],
      ['ADMINIUM_TRIAL_DATA_MAX_MB', '500'],
    ] as const) {
      expect(profileIssues({ ...HOSTED, [name]: value }), name).toEqual([expect.objectContaining({ variable: name, problem: expect.stringContaining('ADMINIUM_TRIAL_MODE is off') })]);
    }
  });
});

// ── A6 the trial's size caps: dropped ───────────────────────────────────────

describe('A6 the trial’s size caps: dropped', { timeout: 60_000 }, () => {
  for (const [profile, env, reason] of PROFILES) {
    it(`${profile}: ${profile === 'trial' ? 'measured and capped, small pools' : 'no cap, no watch, its own pools'}`, async () => {
      const s = await serve(env);
      const trial = profile === 'trial';
      expect(s.composed.app.sizeCap === null).toBe(!trial);
      expect(s.composed.app.trialPolicy.limits === null).toBe(!trial);
      expect(s.env.ADMINIUM_SOURCE_POOL_MAX).toBe(trial ? 3 : undefined);
      expect(s.env.ADMINIUM_META_POOL_MAX).toBe(trial ? 3 : undefined);
      for (const question of ['dataOverCap', 'storageOverCap', 'extraSourceConnections'] as const) {
        expect(s.composed.app.trialPolicy.allows(question), question).toEqual(trial ? { allowed: false, reason: 'size-cap' } : { allowed: true, reason: null });
      }
      void reason;
      expect((await s.api('GET', '/api/v1/system/size-caps')).body).toMatchObject(trial ? { storage: expect.anything() } : { storage: null });
    });
  }

  it('hosted: larger pools than a trial’s boot', () => {
    expect(profileIssues({ ...HOSTED, ADMINIUM_SOURCE_POOL_MAX: '10' })).toEqual([]);
    expect(enforceProfile(makeEnv({ ...HOSTED, ADMINIUM_SOURCE_POOL_MAX: '10' })).ADMINIUM_SOURCE_POOL_MAX).toBe(10);
    expect(() => makeEnv({ ...TRIAL, ADMINIUM_SOURCE_POOL_MAX: '10' })).toThrow(/ADMINIUM_SOURCE_POOL_MAX/);
  });
});

// ── the operator endpoint and the hide switch: kept ────────────────────────

describe('the operator endpoint and hiding the public pages: kept', { timeout: 60_000 }, () => {
  for (const [profile, env] of PROFILES) {
    it(`${profile}: the operator reads its totals and hides every public page; staff pages stay`, async () => {
      const s = await serve({ ...env, ...OPERATOR });
      expect((await s.operator('GET', '/api/v1/operator/status')).status).toBe(200);
      expect((await s.call('GET', '/apps/clients/customer/', { anonymous: true })).status).toBe(200);
      expect((await s.operator('POST', '/api/v1/operator/public-pages', { hidden: true, reason: 'A word with the owner.' })).status).toBe(200);
      const hidden = await s.call('GET', '/apps/clients/customer/', { anonymous: true, headers: PAGE_LOAD });
      expect(hidden.status).toBe(404);
      expect(hidden.body).toContain('This page is unavailable.');
      expect((await s.call('GET', '/', { headers: PAGE_LOAD })).status).toBe(200);
    });
  }
});

// ── the operator's AI: dropped as a rule; its variables still work ──────────

describe('operator-only AI: dropped by the profile, kept by its own variable', { timeout: 60_000 }, () => {
  const ownAddress = { provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1', model: 'm' };

  it('trial: no AI address of the person’s own', async () => {
    const s = await serve(TRIAL);
    expect(await s.api('PUT', '/api/v1/llm/config', ownAddress)).toMatchObject({ status: 403, body: offBy('customAiProviders', 'trial-mode') });
  });

  it('hosted: an AI address of the person’s own is saved, as on an ordinary server', async () => {
    const s = await serve(HOSTED);
    const saved = await s.api('PUT', '/api/v1/llm/config', ownAddress);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ baseUrl: 'https://models.example.com/v1', locks: { baseUrl: { allowed: true }, customProviders: { allowed: true } } });
  });

  it('hosted with ADMINIUM_AI_OPERATOR_ONLY=on: the operator’s rule holds', async () => {
    const s = await serve({ ...HOSTED, ADMINIUM_AI_OPERATOR_ONLY: 'on' });
    expect(await s.api('PUT', '/api/v1/llm/config', ownAddress)).toMatchObject({ status: 403, body: offBy('customAiProviders', 'operator-ai-only') });
    expect(profileIssues({ ...HOSTED, ADMINIUM_AI_OPERATOR_ONLY: 'on' })).toEqual([]);
  });
});

// ── ADMINIUM_DEPLOY_LINK=off: kept ──────────────────────────────────────────

describe('ADMINIUM_DEPLOY_LINK=off: kept', { timeout: 60_000 }, () => {
  for (const [profile, env] of PROFILES) {
    it(`${profile}: the operator's word hides the link; unset, it shows`, async () => {
      expect((await (await serve({ ...env, ADMINIUM_DEPLOY_LINK: 'off' })).api('GET', '/api/v1/system/info')).body).toMatchObject({ deployLink: false });
      expect((await (await serve(env)).api('GET', '/api/v1/system/info')).body).toMatchObject({ deployLink: true });
    });
  }
});

// ── the Upgrade: a trial's container recreated with the hosted profile ─────

for (const engine of ['sqlite', 'postgres', 'mysql'] as const satisfies readonly EngineName[]) {
  describe.skipIf(!AVAILABLE[engine])(`the Upgrade on the same meta store and data folder [${engine}]`, { timeout: 180_000 }, () => {
    it('a running trial, then the same trial past its end, then the hosted profile: nothing a trial left behind holds the paid installation', async () => {
      const made = await makeStore(engine, true);
      cleanups.push(made.destroy);
      const dataDir = await mkdtemp(join(tmpdir(), 'hosted-upgrade-'));
      cleanups.push(async () => rm(dataDir, { recursive: true, force: true }));
      const store = made.meta;
      const DOMAINS = { ADMINIUM_OPERATOR_DOMAINS: `${OWN},${OWN_TOO}`, ADMINIUM_DATA_DIR: dataDir, ...OPERATOR };
      const mapped = { [OWN_TOO]: { appKey: 'clients', side: 'customer' } };

      // 1. The trial, running: set up, a name given, a domain mapped; the operator hides the public pages.
      const trial = await serve({ ...TRIAL, ...DOMAINS }, { store });
      expect((await trial.api('GET', '/api/v1/system/info')).body['trial']).toMatchObject({ on: true });
      expect(trial.composed.app.sizeCap).not.toBeNull();
      expect((await trial.api('PUT', '/api/v1/settings/email', { maxAttachmentBytes: 5_000_000 })).status).toBe(200);
      expect((await trial.api('PUT', '/api/v1/surfaces/domains', { domains: mapped })).status).toBe(200);
      expect((await trial.operator('POST', '/api/v1/operator/public-pages', { hidden: true, reason: 'Moving to a paid plan.' })).status).toBe(200);

      // 2. The same container outlives its end date: read-only, public pages hidden.
      const ended = await serve({ ...TRIAL, ...DOMAINS, ADMINIUM_TRIAL_ENDS_AT: '2020-01-01T00:00:00Z' }, { store, account: 'sign-in' });
      expect(await ended.api('PATCH', '/api/v1/me', { name: 'Dana P.' })).toMatchObject({ status: 403, body: offBy('writes', 'trial-ended') });

      // 3. The Upgrade: the same store and data folder, the hosted profile, no trial variable.
      const hosted = await serve({ ...HOSTED, ...DOMAINS }, { store, account: 'sign-in' });
      const info = (await hosted.api('GET', '/api/v1/system/info')).body;
      expect(info['trial']).toEqual({ on: false, endsAt: null, daysLeft: null, upgradeUrl: null });
      expect(hosted.composed.app.sizeCap).toBeNull();
      // Writes go again, and what the trial made is all there.
      expect((await hosted.api('PATCH', '/api/v1/me', { name: 'Dana P.' })).status).toBe(200);
      expect(await settingsRepo(hosted.meta).get('email.maxAttachmentBytes')).toBe(5_000_000);
      expect(await settingsRepo(hosted.meta).get('surfaces.domains')).toMatchObject(mapped);
      // The calls home a trial locked off are the Super Admin's to switch on now.
      expect((await hosted.api('GET', '/api/v1/settings/telemetry')).body).toMatchObject({ data: { telemetry: false, locks: { telemetry: { allowed: true } } } });
      expect((await hosted.api('PUT', '/api/v1/settings/telemetry', { telemetry: true, updateCheck: true })).status).toBe(200);
      // Their own mail server, now that the relay is gone.
      expect((await hosted.api('PUT', '/api/v1/settings/email', { smtp: { host: 'smtp.example.com', port: 587, user: '', from: 'shop@example.com', secure: false } })).status).toBe(200);

      // The operator's hold is the operator's: it outlives the Upgrade until the operator lifts it.
      expect((await hosted.call('GET', '/', { host: OWN_TOO, anonymous: true, headers: PAGE_LOAD })).status).toBe(404);
      expect((await hosted.operator('GET', '/api/v1/operator/status')).body).toMatchObject({ data: { publicPages: { hidden: true, reason: 'Moving to a paid plan.' } } });
      expect((await hosted.operator('POST', '/api/v1/operator/public-pages', { hidden: false })).status).toBe(200);
      const shown = await hosted.call('GET', '/', { host: OWN_TOO, anonymous: true, headers: PAGE_LOAD });
      expect(shown.status).toBe(200);
      // Shown to search engines too, now.
      expect(shown.headers['x-robots-tag']).toBeUndefined();

      // What stays shut stays shut, with the hosted reason.
      expect((await hosted.api('GET', '/api/v1/settings/email')).body).toMatchObject({ data: { publicOrigin: `https://${OWN}`, locks: { publicOrigin: { allowed: false, reason: 'hosted-mode' } } } });
      expect(await hosted.api('POST', '/api/v1/connections/test', { engine: 'sqlite', dsn: 'sqlite:/tmp/p75-t33.db' })).toMatchObject({ status: 403, body: offBy('sqliteSources', 'hosted-mode') });
      expect((await hosted.call('GET', '/api/v1/system/info', { host: 'evil.example' })).status).toBe(421);
    });
  });
}
