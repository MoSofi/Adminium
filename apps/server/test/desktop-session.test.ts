// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/auth/desktop-session` (11-electron.md §5) — the desktop shell's
 * boot-token auto-login.
 *
 * This is the only route in the product that mints a super-admin session with no
 * password, so the suite is written against the ATTACK rather than the happy
 * path, and each of §5's four gates is pinned INDEPENDENTLY — a suite that only
 * proved "the right token works and a wrong one does not" would stay green while
 * the loopback check, the runtime gate, or the single-use claim rotted away.
 *
 * Everything drives the REAL composition root over `app.inject` on an in-memory
 * SQLite meta store, because "the route is not registered" is a claim about
 * `compose.ts` and cannot be tested by not registering it in a harness.
 */

import BetterSqlite3 from 'better-sqlite3';
import {
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { buildLogger, buildServer } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import {
  bootTokenMatches,
  createBootTokenGuard,
  isLoopbackAddress,
} from '../src/auth/desktop-session.js';
import { composeServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET, type InjectPayload } from './helpers.js';

/** This boot's token. 64 hex characters — §2.2 step 4's 32 bytes. */
const BOOT_TOKEN = 'a'.repeat(64);
/** A DIFFERENT boot's token: same shape, never issued by this process. */
const PREVIOUS_BOOT_TOKEN = 'b'.repeat(64);

const URL = '/api/v1/auth/desktop-session';
const SUPER_ADMIN = { email: 'ava@adminium.test', password: 'correct-horse-battery', name: 'Ava' };

interface Harness {
  app: Awaited<ReturnType<typeof buildServer>>;
  meta: MetaDb;
  superAdminId: string;
}

let t: Harness | null = null;

afterEach(async () => {
  if (t === null) return;
  await t.app.close();
  await t.meta.db.destroy();
  t = null;
});

function storeHandle(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

interface HarnessOptions {
  /** Extra env, e.g. a different `ADMINIUM_RUNTIME`. Merged over the desktop block. */
  env?: Record<string, string> | undefined;
  /** Skip the desktop env block entirely — i.e. compose a self-host server. */
  selfHost?: boolean | undefined;
  /** Skip creating the super admin (first-run boot). */
  noSuperAdmin?: boolean | undefined;
  /**
   * Omit `ADMINIUM_DESKTOP_SINGLE_USER` — the shell did not mirror `config.json`.
   * Otherwise the harness mirrors `on`, which is what a §2.3-default install
   * (`singleUser: true`) sends and therefore the normal desktop boot.
   */
  noMirror?: boolean | undefined;
}

/** A composed server on a bootstrapped in-memory meta store. */
async function harness(opts: HarnessOptions = {}): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  let superAdminId = '';
  if (opts.noSuperAdmin !== true) {
    const user = await createFirstSuperAdmin(meta, {
      email: SUPER_ADMIN.email,
      name: SUPER_ADMIN.name,
      passwordHash: await hashPassword(SUPER_ADMIN.password),
    });
    superAdminId = user.id;
  }

  const env = makeEnv({
    ...(opts.selfHost === true
      ? {}
      : { ADMINIUM_RUNTIME: 'desktop', ADMINIUM_BOOT_TOKEN: BOOT_TOKEN }),
    ...(opts.selfHost === true || opts.noMirror === true
      ? {}
      : { ADMINIUM_DESKTOP_SINGLE_USER: 'on' }),
    ...opts.env,
  });
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
  });
  const runService = createRunService({ meta });
  const { app } = await composeServer({
    env,
    metaStore: storeHandle(meta),
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    // The scheduler would otherwise hold the process open past the test.
    telemetry: false,
  });
  await app.ready();
  t = { app, meta, superAdminId };
  return t;
}

/** A loopback exchange, as the shell makes it. `remoteAddress` defaults to 127.0.0.1. */
function exchange(
  h: Harness,
  body: InjectPayload = { bootToken: BOOT_TOKEN },
  opts: { remoteAddress?: string; headers?: Record<string, string> } = {},
) {
  return h.app.inject({
    method: 'POST',
    url: URL,
    payload: body,
    ...(opts.remoteAddress === undefined ? {} : { remoteAddress: opts.remoteAddress }),
    ...(opts.headers === undefined ? {} : { headers: opts.headers }),
  });
}

function errorCode(res: { json: () => unknown }): string {
  return (res.json() as { error: { code: string } }).error.code;
}

// ─── Gate 1: the route EXISTS only in the desktop runtime ─────────────────────

describe('gate 1 — registration (§5: "registered only when ADMINIUM_RUNTIME=desktop")', () => {
  it('a self-host instance does not expose the route AT ALL', async () => {
    const h = await harness({ selfHost: true });

    const res = await exchange(h);

    // 404, not 401/403: the strongest form of the gate. A self-host or Docker
    // operator has no boot-token door to misconfigure, and no handler whose
    // guards could be bypassed by a bug — there is no route.
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
  });

  it('an explicit non-desktop runtime is refused the same way', async () => {
    const h = await harness({ env: { ADMINIUM_RUNTIME: 'self-host' } });

    // Even WITH a boot token AND the mirror in the environment: the runtime is
    // what decides, and a self-host operator who set either by accident gets no
    // route to attack.
    expect((await exchange(h)).statusCode).toBe(404);
  });

  it('a desktop boot with no boot token has nothing to exchange — no route', async () => {
    const h = await harness({ selfHost: true, env: { ADMINIUM_RUNTIME: 'desktop' } });

    // §2.2 always mints one; its absence means the shell could not, and the app
    // must land on the normal login screen rather than on a route that 401s.
    expect((await exchange(h)).statusCode).toBe(404);
  });

  it('the rest of the auth resource is untouched by the desktop gate', async () => {
    const h = await harness({ selfHost: true });

    // The registration is additive: a self-host server still has its login.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: SUPER_ADMIN.email, password: SUPER_ADMIN.password },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Gate 2: the peer must be loopback ────────────────────────────────────────

describe('gate 2 — the peer (§2.4: "rejects non-loopback peers unconditionally")', () => {
  it('a LAN peer is refused', async () => {
    const h = await harness();

    // §8.3 binds 0.0.0.0 when LAN share is on, so this is a request the server
    // really can receive — from someone with the app's URL and no account.
    const res = await exchange(h, { bootToken: BOOT_TOKEN }, { remoteAddress: '192.168.1.24' });

    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('X-Forwarded-For cannot make a LAN peer local — even with trustProxy on', async () => {
    const h = await harness({ env: { ADMINIUM_TRUST_PROXY: 'on' } });

    // THE bypass this route exists to not have. With `trustProxy` on, Fastify's
    // `request.ip` IS this header — so a handler that checked `request.ip` would
    // hand a super-admin session to anyone who can spell 127.0.0.1. The check
    // reads the socket, which no header can move.
    const res = await exchange(
      h,
      { bootToken: BOOT_TOKEN },
      { remoteAddress: '203.0.113.7', headers: { 'x-forwarded-for': '127.0.0.1' } },
    );

    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('a refused peer does not burn the token — the real user can still log in', async () => {
    const h = await harness();

    await exchange(h, { bootToken: BOOT_TOKEN }, { remoteAddress: '10.0.0.9' });
    const res = await exchange(h);

    // Otherwise a LAN peer who guessed nothing at all could deny the local user
    // their auto-login by spending the token before the window opened.
    expect(res.statusCode).toBe(200);
  });

  it('accepts the loopback shapes Node actually hands out', async () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.2']) {
      const h = await harness();
      const res = await exchange(h, { bootToken: BOOT_TOKEN }, { remoteAddress: address });
      expect(res.statusCode, `${address} must be loopback`).toBe(200);
      await h.app.close();
      await h.meta.db.destroy();
      t = null;
    }
  });
});

// ─── Gate 3: the singleUser policy ────────────────────────────────────────────

describe('gate 3 — "Require login on this device" (§5)', () => {
  it('refuses while singleUser is off, and issues no session', async () => {
    const h = await harness({ env: { ADMINIUM_DESKTOP_SINGLE_USER: 'off' } });

    const res = await exchange(h);

    expect(res.statusCode).toBe(403);
    // A distinct code: the SPA renders this as "go to the login screen", not as
    // "something went wrong" (it is the user's own setting answering).
    expect(errorCode(res)).toBe('DESKTOP_AUTOLOGIN_DISABLED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('the boot mirrors config.json\'s singleUser into the setting the route reads', async () => {
    const h = await harness({ env: { ADMINIUM_DESKTOP_SINGLE_USER: 'off' } });

    // §5: "mirrored into adminium_settings … by the server at boot". The route
    // reads the SETTING, so the mirror is what makes the toggle mean anything.
    expect(await settingsRepo(h.meta).get('desktop.singleUser')).toBe(false);
  });

  it('an unset mirror never overwrites the stored answer', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await settingsRepo(meta).set('desktop.singleUser', false);

    const manager = new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    });
    const runService = createRunService({ meta });
    const { app } = await composeServer({
      env: makeEnv({ ADMINIUM_RUNTIME: 'desktop', ADMINIUM_BOOT_TOKEN: BOOT_TOKEN }),
      metaStore: storeHandle(meta),
      manager,
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
    });
    await app.ready();

    // A wrapper that has not wired the mirror must not silently flip the user's
    // answer back to the default — "absent" is not "false", and not "true".
    expect(await settingsRepo(meta).get('desktop.singleUser')).toBe(false);

    await app.close();
    await meta.db.destroy();
  });

  it('a mirrored `on` allows the exchange — the ordinary §2.3-default boot', async () => {
    const h = await harness();

    expect(await settingsRepo(h.meta).get('desktop.singleUser')).toBe(true);
    expect((await exchange(h)).statusCode).toBe(200);
  });

  it('an unmirrored instance requires a login — the unwired case fails CLOSED', async () => {
    // No `ADMINIUM_DESKTOP_SINGLE_USER` ⇒ nothing told the server what the user
    // chose. The registry default answers, and it answers "ask for the password":
    // a wrapper that forgets to pass the mirror must not silently auto-login a
    // user who turned that off. See the registry entry for the full argument.
    const h = await harness({ noMirror: true });

    expect(await settingsRepo(h.meta).get('desktop.singleUser')).toBe(false);
    const res = await exchange(h);
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('DESKTOP_AUTOLOGIN_DISABLED');
  });
});

// ─── Gate 4: the token itself ─────────────────────────────────────────────────

describe('gate 4 — the boot token (§5: one success per boot)', () => {
  it('exchanges the boot token for a real super-admin session', async () => {
    const h = await harness();

    const res = await exchange(h);
    expect(res.statusCode, res.body).toBe(200);

    const body = res.json() as { data: { user: { id: string; email: string } } };
    expect(body.data.user.email).toBe(SUPER_ADMIN.email);
    expect(body.data.user.id).toBe(h.superAdminId);
    // Never echo the credential back out.
    expect(res.body).not.toContain(BOOT_TOKEN);

    // A REAL session, not a token-shaped reply: the cookie authenticates.
    const cookie = res.headers['set-cookie'];
    expect(String(cookie)).toContain('adminium_session=');
    // §2.4: loopback http is the sanctioned exception to the secure-cookie rule.
    expect(String(cookie)).not.toContain('Secure');

    const session = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: String(cookie).split(';')[0] ?? '' },
    });
    expect(session.statusCode, session.body).toBe(200);
    const who = session.json() as { data: { user: { email: string }; roles: string[] } };
    expect(who.data.user.email).toBe(SUPER_ADMIN.email);
    expect(who.data.roles).toEqual(['super-admin']);
  });

  it('records the login, so the account does not look dormant', async () => {
    const h = await harness();

    await exchange(h);

    const user = await usersRepo(h.meta).findById(h.superAdminId);
    expect(user?.lastLoginAt).not.toBeNull();
  });

  it('a REPLAY of the used token is refused', async () => {
    const h = await harness();

    expect((await exchange(h)).statusCode).toBe(200);
    const replay = await exchange(h);

    // §5: "One success per boot token". The token is not a password — it is a
    // one-shot hand-off, and its second use is by definition not the shell.
    expect(replay.statusCode).toBe(401);
    expect(errorCode(replay)).toBe('INVALID_CREDENTIALS');
    expect(replay.headers['set-cookie']).toBeUndefined();
  });

  it('a token from a PREVIOUS boot is refused', async () => {
    const h = await harness();

    const res = await exchange(h, { bootToken: PREVIOUS_BOOT_TOKEN });

    // The guard is memory in THIS process; a restarted server never heard of the
    // old token. Same answer as any other wrong token — a stale token must not
    // be distinguishable from a bogus one.
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
  });

  it('a spent boot answers the SAME for a right token and a wrong one', async () => {
    const h = await harness();
    await exchange(h);

    const rightAgain = await exchange(h);
    const wrong = await exchange(h, { bootToken: PREVIOUS_BOOT_TOKEN });

    // Once spent, the route stops being an oracle that would confirm a guessed
    // token by answering it differently.
    expect(rightAgain.statusCode).toBe(wrong.statusCode);
    expect(errorCode(rightAgain)).toBe(errorCode(wrong));
  });

  it('a malformed token is rejected by the schema, before any comparison', async () => {
    const h = await harness();

    for (const body of [{}, { bootToken: '' }, { bootToken: 'nope' }, { bootToken: 42 }]) {
      const res = await exchange(h, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
    }
    // And none of that spent the token.
    expect((await exchange(h)).statusCode).toBe(200);
  });

  it('refuses before first-run setup rather than inventing a principal', async () => {
    const h = await harness({ noSuperAdmin: true });

    const res = await exchange(h);

    // The token was RIGHT; there is simply nobody to be yet (§6 owns this boot).
    expect(res.statusCode).toBe(409);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

// ─── The primitives ───────────────────────────────────────────────────────────

describe('isLoopbackAddress', () => {
  it('accepts every loopback shape', () => {
    for (const address of [
      '127.0.0.1',
      '127.0.0.2',
      '127.255.255.254',
      '::1',
      '0:0:0:0:0:0:0:1',
      '::ffff:127.0.0.1',
      '::FFFF:127.0.0.1',
      '::1%lo0',
    ]) {
      expect(isLoopbackAddress(address), address).toBe(true);
    }
  });

  it('rejects everything else — including the near-misses', () => {
    for (const address of [
      '192.168.1.1',
      '10.0.0.1',
      '0.0.0.0',
      '::',
      '::ffff:192.168.1.1',
      // The classic bypass strings: a prefix/suffix match would take these.
      '127.0.0.1.evil.com',
      'x127.0.0.1',
      '1127.0.0.1',
      '::2',
      'fe80::1',
    ]) {
      expect(isLoopbackAddress(address), address).toBe(false);
    }
  });

  it('an unknown peer is not the local user', () => {
    // A socket with no remoteAddress is a socket that is gone. "Cannot tell" has
    // to land on the deny side.
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });
});

describe('bootTokenMatches', () => {
  it('matches only the exact token, and never throws on a length mismatch', () => {
    expect(bootTokenMatches(BOOT_TOKEN, BOOT_TOKEN)).toBe(true);
    expect(bootTokenMatches(PREVIOUS_BOOT_TOKEN, BOOT_TOKEN)).toBe(false);
    // `timingSafeEqual` throws on unequal lengths; hashing first is what makes
    // a short guess a `false` instead of a 500.
    expect(bootTokenMatches('', BOOT_TOKEN)).toBe(false);
    expect(bootTokenMatches('a'.repeat(63), BOOT_TOKEN)).toBe(false);
    expect(bootTokenMatches('a'.repeat(65), BOOT_TOKEN)).toBe(false);
    // Hex case is not folded: the token is a byte string, not a number.
    expect(bootTokenMatches('A'.repeat(64), BOOT_TOKEN)).toBe(false);
  });
});

describe('createBootTokenGuard', () => {
  it('claims exactly once, then reports `used` for every candidate', () => {
    const guard = createBootTokenGuard(BOOT_TOKEN);

    expect(guard.claim('c'.repeat(64))).toBe('invalid');
    expect(guard.consumed).toBe(false);
    expect(guard.claim(BOOT_TOKEN)).toBe('ok');
    expect(guard.consumed).toBe(true);
    expect(guard.claim(BOOT_TOKEN)).toBe('used');
    expect(guard.claim('c'.repeat(64))).toBe('used');
  });
});

// ─── The log (§1.3, and 11-electron.md §9's log files) ────────────────────────

describe('the boot token never reaches the log', () => {
  /** Captures every line the server logs, as pino would write it to the file. */
  function capture(): { lines: string[]; stream: { write(line: string): void } } {
    const lines: string[] = [];
    return { lines, stream: { write: (line: string) => void lines.push(line) } };
  }

  it('scrubs `?bootToken=` out of the request log', async () => {
    const { lines, stream } = capture();
    const env = makeEnv();
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const app = await buildServer({
      env,
      metaDb: meta,
      logger: buildLogger(env, { pretty: false, stream }),
    });
    await app.ready();

    // §2.2 step 8: the window opens on `/?bootToken=<token>`. The SPA strips it
    // from history — but this request already happened, and §9 pipes the log to a
    // file on disk that outlives the boot by days.
    await app.inject({ method: 'GET', url: `/?bootToken=${BOOT_TOKEN}&returnTo=/p/orders` });

    const log = lines.join('\n');
    expect(log).not.toContain(BOOT_TOKEN);
    expect(log).toContain('bootToken=[REDACTED]');
    // The rest of the URL survives — a request log that dropped the URL would be
    // no leak and no log.
    expect(log).toContain('returnTo=/p/orders');

    await app.close();
    await meta.db.destroy();
  });

  it('redacts a bootToken field anyone logs by hand', async () => {
    const { lines, stream } = capture();
    const env = makeEnv();
    const app = await buildServer({ env, logger: buildLogger(env, { pretty: false, stream }) });
    await app.ready();

    app.log.info({ body: { bootToken: BOOT_TOKEN } }, 'exchange');

    expect(lines.join('\n')).not.toContain(BOOT_TOKEN);
    expect(lines.join('\n')).toContain('[REDACTED]');

    await app.close();
  });

  it('leaves ordinary URLs byte-for-byte alone', async () => {
    const { lines, stream } = capture();
    const env = makeEnv();
    const app = await buildServer({ env, logger: buildLogger(env, { pretty: false, stream }) });
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/v1/healthz?verbose=1&q=a+b' });

    expect(lines.join('\n')).toContain('/api/v1/healthz?verbose=1&q=a+b');

    await app.close();
  });
});
