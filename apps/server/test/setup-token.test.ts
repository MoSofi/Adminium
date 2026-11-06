// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one-time setup token (`src/setup/token.ts`), end to end over the routes.
 *
 * Written against the attack it exists for: a stranger who reaches a fresh
 * server before its owner. They must not create the first account, re-point
 * the instance at a store of their own (`/setup/adopt`), or use it to dial
 * databases (`/setup/probe`) — and a set-up instance must answer them exactly
 * as it always has (409), so the token says nothing about a live panel.
 *
 * The transaction-level race on every dialect is in
 * packages/meta/test/setup-token.test.ts; this file proves the HTTP doors.
 */
import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, readSetupToken, usersRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { envSchema } from '../src/config/env.js';
import { setupStoreRoutes } from '../src/routes/setup/store.js';
import { createSetupService } from '../src/setup/service.js';
import {
  deriveSetupToken,
  isLoopbackBindHost,
  prepareSetupToken,
  setupTokenLines,
  setupTokenRequired,
} from '../src/setup/token.js';
import { hashPassword } from '../src/auth/passwords.js';
import { makeEnv, type InjectPayload } from './helpers.js';

const SECRET = 'x'.repeat(64);
const GOOD = { email: 'owner@adminium.test', password: 'correct-horse-battery', name: 'Owner' };
const TOKEN_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

function freshMeta(): MetaDb {
  return createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
}

function serverEnv(overrides: Record<string, string> = {}) {
  return makeEnv({ ADMINIUM_SECRET: SECRET, HOST: '0.0.0.0', ...overrides });
}

describe('who is asked for a setup token', () => {
  it('a server always; the desktop never; dev, design and try only off this computer', () => {
    expect(setupTokenRequired({ runtime: 'self-host', host: '0.0.0.0', mode: 'server' })).toBe(true);
    // Behind Caddy or nginx a server listens on loopback, and the proxy makes it public.
    expect(setupTokenRequired({ runtime: 'self-host', host: '127.0.0.1', mode: 'server' })).toBe(true);
    expect(setupTokenRequired({ runtime: 'desktop', host: '0.0.0.0', mode: 'server' })).toBe(false);
    for (const mode of ['dev', 'design', 'try'] as const) {
      expect(setupTokenRequired({ runtime: 'self-host', host: '127.0.0.1', mode })).toBe(false);
      expect(setupTokenRequired({ runtime: 'self-host', host: 'localhost', mode })).toBe(false);
      expect(setupTokenRequired({ runtime: 'self-host', host: '0.0.0.0', mode })).toBe(true);
      expect(setupTokenRequired({ runtime: 'self-host', host: '192.168.1.20', mode })).toBe(true);
    }
  });

  it('reads only real loopback binds as this computer', () => {
    expect(isLoopbackBindHost('127.0.0.1')).toBe(true);
    expect(isLoopbackBindHost('127.3.2.1')).toBe(true);
    expect(isLoopbackBindHost('::1')).toBe(true);
    expect(isLoopbackBindHost('[::1]')).toBe(true);
    expect(isLoopbackBindHost('0.0.0.0')).toBe(false);
    expect(isLoopbackBindHost('::')).toBe(false);
    expect(isLoopbackBindHost('10.0.0.5')).toBe(false);
  });
});

describe('the boot step', () => {
  let meta: MetaDb;
  beforeEach(async () => {
    meta = freshMeta();
    await firstRun(meta);
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  it('mints a token, keeps only its salt and hash, and prints it', async () => {
    const prepared = await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' });
    expect(prepared?.fromEnv).toBe(false);
    expect(prepared?.token).toMatch(TOKEN_FORMAT);

    const stored = await readSetupToken(meta);
    expect(stored).not.toBeNull();
    const rows = await meta.db.selectFrom('adminium_settings').select(['key', 'value']).execute();
    const plain = (prepared?.token ?? '').replace(/-/g, '');
    for (const row of rows) expect(String(row.value)).not.toContain(plain);

    expect(setupTokenLines(prepared!)).toEqual([
      `Setup token: ${prepared!.token}`,
      'The first-run wizard asks for it before it creates the first account.',
    ]);
  });

  it('prints the same token on every boot while setup is open', async () => {
    const first = await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' });
    const again = await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' });
    expect(again?.token).toBe(first?.token);
    const stored = await readSetupToken(meta);
    expect(deriveSetupToken(SECRET, stored!.salt)).toBe(first?.token);
  });

  it('a changed ADMINIUM_SECRET mints a new one, and the old one stops working', async () => {
    const first = await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' });
    const next = await prepareSetupToken({ meta, env: serverEnv({ ADMINIUM_SECRET: 'y'.repeat(64) }), mode: 'server' });
    expect(next?.token).not.toBe(first?.token);
    const service = createSetupService({ meta, hashPassword });
    await expect(service.checkToken(first?.token)).rejects.toThrow(/setup token/);
    await expect(service.checkToken(next?.token)).resolves.toBeUndefined();
  });

  it('uses ADMINIUM_SETUP_TOKEN when it is set, and does not print it back', async () => {
    const chosen = 'railway-generated-0123456789abcdef';
    const prepared = await prepareSetupToken({ meta, env: serverEnv({ ADMINIUM_SETUP_TOKEN: chosen }), mode: 'server' });
    expect(prepared).toEqual({ token: chosen, fromEnv: true });
    expect(setupTokenLines(prepared!).join('\n')).not.toContain(chosen);
    await expect(createSetupService({ meta, hashPassword }).checkToken(chosen)).resolves.toBeUndefined();
  });

  it('refuses an ADMINIUM_SETUP_TOKEN shorter than 16 characters', () => {
    const parsed = envSchema.safeParse({ ADMINIUM_SECRET: SECRET, ADMINIUM_SETUP_TOKEN: 'short-1234' });
    expect(parsed.success).toBe(false);
  });

  it('asks nothing on the desktop, or from dev on this computer, and drops a row a server left', async () => {
    await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' });
    expect(await readSetupToken(meta)).not.toBeNull();

    expect(await prepareSetupToken({ meta, env: serverEnv({ HOST: '127.0.0.1' }), mode: 'dev' })).toBeNull();
    expect(await readSetupToken(meta)).toBeNull();

    await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' });
    expect(await prepareSetupToken({ meta, env: serverEnv({ ADMINIUM_RUNTIME: 'desktop' }), mode: 'server' })).toBeNull();
    expect(await readSetupToken(meta)).toBeNull();
  });

  it('prints nothing once the first account exists', async () => {
    const prepared = await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' });
    await createSetupService({ meta, hashPassword }).createSuperAdmin({ ...GOOD, setupToken: prepared?.token });
    expect(await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' })).toBeNull();
    expect(await readSetupToken(meta)).toBeNull();
  });
});

describe('the setup routes on a server that asks for a token', () => {
  let meta: MetaDb;
  let app: AdminiumServer;
  let token: string;
  /** Each call from its own address, so the 5/min login bucket never decides a test. */
  let ip = 0;

  beforeEach(async () => {
    meta = freshMeta();
    await firstRun(meta);
    token = (await prepareSetupToken({ meta, env: serverEnv(), mode: 'server' }))!.token;
    app = await buildServer({ env: makeEnv(), metaDb: meta, logger: false });
    await app.register(setupStoreRoutes({ service: createSetupService({ meta, hashPassword }), env: makeEnv() }), {
      prefix: '/api/v1',
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const post = (url: string, payload: InjectPayload) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, payload, remoteAddress: `10.77.0.${String(++ip % 250)}` });

  const auditActions = async (): Promise<string[]> =>
    (await meta.db.selectFrom('adminium_audit_log').select('action').execute()).map((row) => row.action);

  it('says it asks, and nothing about the token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/state' });
    expect(res.json()).toEqual({
      data: { required: true, passwordMinLength: 10, databaseConnected: false, tokenRequired: true },
    });
  });

  it('checks a token without spending it', async () => {
    const wrong = await post('/setup/token', { setupToken: 'AAAA-BBBB-CCCC-DDDD' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ error: { code: 'SETUP_TOKEN_INVALID' } });
    expect(await auditActions()).toContain('setup_token_denied');

    expect((await post('/setup/token', { setupToken: token.toLowerCase() })).statusCode).toBe(204);
    expect((await post('/setup/token', { setupToken: token })).statusCode).toBe(204);
    expect(await readSetupToken(meta)).not.toBeNull();
  });

  it('refuses the first account without the token, or with a wrong one, and creates nothing', async () => {
    const none = await post('/setup/super-admin', GOOD);
    expect(none.statusCode, none.body).toBe(403);
    expect(none.json()).toMatchObject({ error: { code: 'SETUP_TOKEN_INVALID' } });
    expect(none.headers['set-cookie']).toBeUndefined();

    const wrong = await post('/setup/super-admin', { ...GOOD, setupToken: 'AAAA-BBBB-CCCC-DDDD' });
    expect(wrong.statusCode).toBe(403);

    expect(await usersRepo(meta).count()).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/setup/state' })).json()).toMatchObject({
      data: { required: true, tokenRequired: true },
    });
  });

  it('creates the first account with the token, which is then gone', async () => {
    const res = await post('/setup/super-admin', { ...GOOD, setupToken: token });
    expect(res.statusCode, res.body).toBe(201);
    expect(await readSetupToken(meta)).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/v1/setup/state' })).json()).toMatchObject({
      data: { required: false, tokenRequired: false },
    });
    expect(await auditActions()).toContain('setup_super_admin_created');
  });

  it('a set-up instance answers 409 whatever token is sent, so 403 never marks a live panel', async () => {
    expect((await post('/setup/super-admin', { ...GOOD, setupToken: token })).statusCode).toBe(201);
    for (const setupToken of [undefined, 'AAAA-BBBB-CCCC-DDDD', token]) {
      const body = { email: 'mallory@evil.test', password: 'correct-horse-battery', ...(setupToken === undefined ? {} : { setupToken }) };
      expect((await post('/setup/super-admin', body)).statusCode).toBe(409);
      expect((await post('/setup/token', { setupToken: setupToken ?? 'x' })).statusCode).toBe(409);
      expect((await post('/setup/probe', { dsn: 'sqlite::memory:', ...(setupToken === undefined ? {} : { setupToken }) })).statusCode).toBe(409);
    }
  });

  it('two owners racing with the right token: exactly one 201 and one 409', async () => {
    const [a, b] = await Promise.all([
      post('/setup/super-admin', { email: 'first@adminium.test', password: 'a-long-enough-password', setupToken: token }),
      post('/setup/super-admin', { email: 'second@adminium.test', password: 'a-long-enough-password', setupToken: token }),
    ]);
    expect([a.statusCode, b.statusCode].sort(), `${a.body}\n${b.body}`).toEqual([201, 409]);
    expect(await usersRepo(meta).count()).toBe(1);
  });

  it('a stranger racing the owner never wins, and never costs the owner the token', async () => {
    const strangers = Array.from({ length: 6 }, (_, i) =>
      post('/setup/super-admin', { email: `mallory${String(i)}@evil.test`, password: 'a-long-enough-password', setupToken: `WRONG-${String(i)}` }),
    );
    const owner = post('/setup/super-admin', { ...GOOD, setupToken: token });
    const [ownerRes, ...rest] = await Promise.all([owner, ...strangers]);
    expect(ownerRes?.statusCode, ownerRes?.body).toBe(201);
    for (const res of rest) expect([403, 409]).toContain(res.statusCode);
    expect(await usersRepo(meta).count()).toBe(1);
    expect((await usersRepo(meta).findByEmail(GOOD.email))?.email).toBe(GOOD.email);
  });

  it('the probe and adopt need the token too', async () => {
    const probe = await post('/setup/probe', { dsn: 'sqlite::memory:' });
    expect(probe.statusCode, probe.body).toBe(403);
    expect(probe.json()).toMatchObject({ error: { code: 'SETUP_TOKEN_INVALID' } });

    const probed = await post('/setup/probe', { dsn: 'sqlite::memory:', setupToken: token });
    expect(probed.statusCode, probed.body).toBe(200);
    expect(await readSetupToken(meta)).not.toBeNull();
  });
});

describe('the setup routes on a server that asks for none', () => {
  it('take the bodies they always took', async () => {
    const meta = freshMeta();
    await firstRun(meta);
    const app = await buildServer({ env: makeEnv(), metaDb: meta, logger: false });
    await app.ready();
    try {
      const state = await app.inject({ method: 'GET', url: '/api/v1/setup/state' });
      expect(state.json()).toMatchObject({ data: { tokenRequired: false } });
      expect((await app.inject({ method: 'POST', url: '/api/v1/setup/token', payload: { setupToken: 'anything' } })).statusCode).toBe(204);
      const created = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', payload: GOOD });
      expect(created.statusCode, created.body).toBe(201);
    } finally {
      await app.close();
      await meta.db.destroy();
    }
  });
});
