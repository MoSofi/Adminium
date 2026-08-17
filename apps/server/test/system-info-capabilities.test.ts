// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/system/info` — the 11-electron.md §8.2 capability flags the SPA
 * gates local-mode UX on (§8.1 runtime chip, SMTP-gated email actions,
 * network-dependent features).
 *
 * The point of this suite is that NONE of the three flags is a constant: each
 * one is asserted to move when the fact underneath it moves. `app.test.ts`
 * covers the no-meta shape; this one drives the flags against a real meta store,
 * because `smtpConfigured` is a settings read and a meta-less server can only
 * ever answer `false`.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { makeEnv } from './helpers.js';

let app: AdminiumServer | undefined;
let meta: MetaDb | undefined;

afterEach(async () => {
  await app?.close();
  await meta?.db.destroy();
  app = undefined;
  meta = undefined;
});

interface SystemInfoBody {
  version: string;
  node: string;
  dialect: string | null;
  runtime: string;
  smtpConfigured: boolean;
  networkFeaturesAllowed: boolean;
}

async function build(overrides: Record<string, string> = {}): Promise<{
  server: AdminiumServer;
  store: MetaDb;
}> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(store);
  meta = store;
  app = await buildServer({ env: makeEnv(overrides), metaDb: store, logger: false });
  return { server: app, store };
}

async function read(server: AdminiumServer): Promise<SystemInfoBody> {
  const res = await server.inject({ method: 'GET', url: '/api/v1/system/info' });
  expect(res.statusCode).toBe(200);
  return res.json<SystemInfoBody>();
}

/** A minimally valid `email.smtp` payload (settings-registry `smtpSchema`). */
const SMTP = {
  host: 'smtp.acme.io',
  port: 587,
  user: 'ava',
  passEncrypted: 'v1:not-a-real-secret',
  from: 'adminium@acme.io',
  secure: true,
};

describe('GET /api/v1/system/info — §8.2 capability flags', () => {
  it('reports smtpConfigured:false while `email.smtp` is unset (the registry default)', async () => {
    const { server } = await build();
    expect((await read(server)).smtpConfigured).toBe(false);
  });

  it('reports smtpConfigured:true once `email.smtp` is set', async () => {
    const { server, store } = await build();
    await settingsRepo(store).set('email.smtp', SMTP);
    expect((await read(server)).smtpConfigured).toBe(true);
  });

  /**
   * The reason the handler reads the setting per request instead of caching an
   * answer at compose time: SMTP is editable from Settings, and a cached `false`
   * would leave "Configure SMTP to send email" showing on a page whose Send
   * button now works.
   */
  it('follows `email.smtp` changes without a restart', async () => {
    const { server, store } = await build();
    const settings = settingsRepo(store);

    await settings.set('email.smtp', SMTP);
    expect((await read(server)).smtpConfigured).toBe(true);

    await settings.set('email.smtp', null);
    expect((await read(server)).smtpConfigured).toBe(false);
  });

  /**
   * REGRESSION. Adding a settings read to a route that used to be a pure
   * function means a meta-store blip can now throw. An unhandled throw costs the
   * caller the WHOLE reply — including `runtime` and `networkFeaturesAllowed`,
   * which come off the environment and were never in doubt — and this route is
   * what `/forgot` asks before deciding whether password reset works. `readyz`
   * one function up catches exactly this; so does `smtpConfigured` now.
   */
  it('survives a meta store that has gone away, and still answers from env', async () => {
    const { server, store } = await build({ ADMINIUM_RUNTIME: 'desktop' });
    await store.db.destroy(); // every subsequent query throws
    meta = undefined; // afterEach must not re-destroy it

    const res = await server.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json<SystemInfoBody>();
    expect(body.runtime).toBe('desktop');
    expect(body.networkFeaturesAllowed).toBe(true);
    expect(body.smtpConfigured).toBe(false);
  });

  it('reports the meta dialect alongside the flags', async () => {
    const { server } = await build();
    expect((await read(server)).dialect).toBe('sqlite');
  });

  it('reports runtime + networkFeaturesAllowed from the boot environment', async () => {
    const { server } = await build({
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_NETWORK_FEATURES: 'off',
    });
    const body = await read(server);
    expect(body.runtime).toBe('desktop');
    expect(body.networkFeaturesAllowed).toBe(false);
  });

  /**
   * Pre-auth surfaces (`/login`, `/forgot`, `/setup`) are exactly the ones that
   * need these answers earliest, so the route must stay reachable without a
   * session — and must keep saying nothing a stranger should not hear. The
   * assertion is the second half: no host, no user, no credential.
   */
  it('answers anonymously and names no SMTP host, user, or credential', async () => {
    const { server, store } = await build();
    await settingsRepo(store).set('email.smtp', SMTP);

    const res = await server.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(res.statusCode).toBe(200);
    const raw = res.payload;
    for (const secret of [SMTP.host, SMTP.user, SMTP.passEncrypted, SMTP.from]) {
      expect(raw).not.toContain(secret);
    }
  });
});
