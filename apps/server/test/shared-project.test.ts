// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project the desktop app shares on the network (`ComposeServerOptions.shared`).
 *
 * Two rules, each against what it is there to stop:
 *
 *  - the server answers to this computer's own names and addresses on its
 *    port, and to nothing else (a page on another name whose DNS now points
 *    here still sends its own name);
 *  - the app's own window signs the owner the project was made for in, with
 *    this boot's token, from this computer only, whether or not that owner has
 *    a password. Nobody else is signed in by that door, and a project with no
 *    such owner has no one for it.
 *
 * Driven through the real composition root, as `desktop-session.test.ts` is.
 */
import BetterSqlite3 from 'better-sqlite3';
import { createFirstSuperAdmin, createLocalOwner, createSqliteMetaDb, firstRun, usersRepo, type MetaDb } from '@adminium/meta';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { buildServer } from '../src/app.js';
import { setLocalOwnerCredentials } from '../src/auth/local-owner.js';
import { hashPassword } from '../src/auth/passwords.js';
import { composeServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { localName, normalHost, registerSharedHosts, sharedHosts } from '../src/desktop/shared-hosts.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const BOOT_TOKEN = 'c'.repeat(64);
const PORT = 4712;
const DOOR = '/api/v1/auth/desktop-session';
const HERE = { host: `127.0.0.1:${String(PORT)}` };

interface Harness {
  app: Awaited<ReturnType<typeof buildServer>>;
  meta: MetaDb;
}

let t: Harness | null = null;

afterEach(async () => {
  if (t === null) return;
  await t.app.close();
  await t.meta.db.destroy();
  t = null;
});

async function harness(opts: { owner?: 'local' | 'with-password' | 'setup'; shared?: { ownerOnThisComputer?: boolean } | null } = {}): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  if (opts.owner === 'setup') {
    await createFirstSuperAdmin(meta, { email: 'ava@adminium.test', name: 'Ava', passwordHash: await hashPassword('correct-horse-battery') });
  } else {
    await createLocalOwner(meta);
    if (opts.owner === 'with-password') await setLocalOwnerCredentials(meta, { email: 'ava@example.test', password: 'a-long-enough-test-password-1!' });
  }
  const runService = createRunService({ meta });
  const { app } = await composeServer({
    env: makeEnv({ ADMINIUM_RUNTIME: 'desktop', ADMINIUM_BOOT_TOKEN: BOOT_TOKEN, PORT: String(PORT) }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
    ...(opts.shared === null ? {} : { shared: { port: PORT, ...(opts.shared ?? { ownerOnThisComputer: true }) } }),
  });
  await app.ready();
  t = { app, meta };
  return t;
}

const exchange = (h: Harness, opts: { remoteAddress?: string; token?: string; host?: string } = {}) =>
  h.app.inject({
    method: 'POST',
    url: DOOR,
    payload: { bootToken: opts.token ?? BOOT_TOKEN },
    headers: { host: opts.host ?? HERE.host },
    ...(opts.remoteAddress === undefined ? {} : { remoteAddress: opts.remoteAddress }),
  });

describe('the names a shared project answers to', () => {
  const interfaces = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }, { address: '::1', family: 'IPv6', internal: true }],
    en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'FE80::1C2%en0', family: 'IPv6', internal: false }],
  } as unknown as Parameters<typeof sharedHosts>[2];

  it('are the computer’s own: its .local name, each address it has, and loopback, on its port', () => {
    expect([...sharedHosts(4712, 'Office-Mac.lan', interfaces)].sort()).toEqual(
      ['127.0.0.1:4712', '192.168.1.20:4712', '[::1]:4712', '[fe80::1c2]:4712', 'localhost:4712', 'office-mac.local:4712'].sort(),
    );
    // A name that cannot be asked for on a network adds nothing.
    expect(sharedHosts(4712, 'localhost', {}).has('localhost.local:4712')).toBe(false);
    expect(localName('My_Mac')).toBeNull();
  });

  it('a Host is compared lower case, and a full name’s last dot is not part of it', () => {
    expect(normalHost('Office-Mac.LOCAL.:4712')).toBe('office-mac.local:4712');
    expect(normalHost(undefined)).toBe('');
    // Only the dot before the port: an address keeps its own.
    expect(normalHost('192.168.1.20:4712')).toBe('192.168.1.20:4712');
  });

  it('any other name is refused before a route is reached; the addresses are read again as they change', async () => {
    const app = Fastify();
    let clock = 0;
    let given = interfaces;
    registerSharedHosts(app, { port: 4712, hostname: () => 'office-mac', interfaces: () => given, now: () => clock });
    app.get('/x', async () => 'ok');
    const ask = async (host: string): Promise<number> => (await app.inject({ method: 'GET', url: '/x', headers: { host } })).statusCode;

    expect(await ask('office-mac.local:4712')).toBe(200);
    expect(await ask('OFFICE-MAC.local.:4712')).toBe(200);
    expect(await ask('192.168.1.20:4712')).toBe(200);
    expect(await ask('localhost:4712')).toBe(200);
    // The right name on another port, a made-up name, a name that only starts like ours, no port at all.
    expect(await ask('office-mac.local:4713')).toBe(421);
    expect(await ask('evil.example:4712')).toBe(421);
    expect(await ask('office-mac.local.evil.example:4712')).toBe(421);
    expect(await ask('office-mac.local')).toBe(421);
    const refused = await app.inject({ method: 'GET', url: '/x', headers: { host: 'evil.example:4712' } });
    expect(refused.body).toBe('This Adminium answers to its own addresses only.');
    expect(refused.headers['cache-control']).toBe('no-store');

    // The laptop joins another network: its new address is answered once the last read is a second old.
    given = { en0: [{ address: '10.0.0.7', family: 'IPv4', internal: false }] } as unknown as typeof interfaces;
    expect(await ask('10.0.0.7:4712')).toBe(421);
    clock += 1_000;
    expect(await ask('10.0.0.7:4712')).toBe(200);
    expect(await ask('192.168.1.20:4712')).toBe(421);
    await app.close();
  });

  it('a shared project refuses a made-up name on every route; one that is not shared answers as before', async () => {
    const shared = await harness();
    expect((await shared.app.inject({ method: 'GET', url: '/api/v1/healthz', headers: HERE })).statusCode).toBe(200);
    expect((await shared.app.inject({ method: 'GET', url: '/api/v1/healthz', headers: { host: `evil.example:${String(PORT)}` } })).statusCode).toBe(421);
    expect((await exchange(shared, { host: `evil.example:${String(PORT)}` })).statusCode).toBe(421);
    await shared.app.close();
    await shared.meta.db.destroy();

    const plain = await harness({ shared: null });
    expect((await plain.app.inject({ method: 'GET', url: '/api/v1/healthz', headers: { host: 'evil.example:4712' } })).statusCode).toBe(200);
  });
});

describe('the owner, signed in on this computer while the project is shared', () => {
  it('the app’s window signs the owner in with this boot’s token, password or not, once', async () => {
    const h = await harness({ owner: 'with-password' });
    const res = await exchange(h);
    expect(res.statusCode).toBe(200);
    const user = (res.json() as { data: { user: { email: string } } }).data.user;
    expect(user.email).toBe('ava@example.test');
    expect(String(res.headers['set-cookie'])).toContain('adminium_session');
    // Spent: the same token is not a second sign-in.
    expect((await exchange(h)).statusCode).toBe(401);
  });

  it('it is the owner the project was made for, not whoever is the oldest super admin', async () => {
    const h = await harness({ owner: 'with-password' });
    const owner = (await usersRepo(h.meta).findByEmail('ava@example.test'))?.id;
    const res = await exchange(h);
    expect((res.json() as { data: { user: { id: string } } }).data.user.id).toBe(owner);
  });

  it('another device is refused before the token is looked at, and does not spend it', async () => {
    const h = await harness({ owner: 'with-password' });
    const far = await exchange(h, { remoteAddress: '192.168.1.44' });
    expect(far.statusCode).toBe(403);
    // A claimed address is not a real one.
    const claimed = await h.app.inject({ method: 'POST', url: DOOR, payload: { bootToken: BOOT_TOKEN }, headers: { ...HERE, 'x-forwarded-for': '127.0.0.1' }, remoteAddress: '192.168.1.44' });
    expect(claimed.statusCode).toBe(403);
    expect((await exchange(h, { token: 'd'.repeat(64) })).statusCode).toBe(401);
    expect((await exchange(h)).statusCode).toBe(200);
  });

  it('a project whose first account was made at /setup has no one for this door, and its token is not spent on asking', async () => {
    const h = await harness({ owner: 'setup' });
    const res = await exchange(h);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('DESKTOP_AUTOLOGIN_DISABLED');
  });

  it('an owner who was suspended is not signed in', async () => {
    const h = await harness({ owner: 'with-password' });
    const owner = await usersRepo(h.meta).findByEmail('ava@example.test');
    await h.meta.db.updateTable('adminium_users').set({ status: 'suspended' }).where('id', '=', owner?.id ?? '').execute();
    expect((await exchange(h)).statusCode).toBe(403);
  });

  it('shared without that word: the door keeps the classic rule, which a project never meets', async () => {
    const h = await harness({ owner: 'with-password', shared: {} });
    const res = await exchange(h);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('DESKTOP_AUTOLOGIN_DISABLED');
  });
});
