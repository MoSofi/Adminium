// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Password-reset poisoning: the host a link in an outbound email points at must
 * not be chosen by the caller (security/public-origin.ts).
 *
 * `POST /auth/password/forgot` is unauthenticated, and CSRF does not look at a
 * request with no session. So whatever the link builder reads off the request
 * is attacker-controlled: a non-browser client can send any `Origin` it likes.
 * A reset mail whose link points at the attacker's origin hands them the real
 * single-use token the moment the victim clicks, and the victim has every
 * reason to click: the mail is genuine.
 *
 * The first case runs the queued job through the real worker into a recording
 * transport, so it asserts on the message the victim would receive. The rest
 * open the sealed envelope straight off the queue, which is the same bytes
 * without the polling.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  apiKeysRepo,
  auditRepo,
  createSqliteMetaDb,
  destroyMetaDb,
  firstRun,
  initMetaDb,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { EMAIL_SEND_JOB_KIND, emailEnvelopeKey, resetEmailRuntime } from '../src/email/send.js';
import type { OutboundEmail } from '../src/email/types.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { CSRF_HEADER } from '../src/security/csrf.js';
import {
  capturePublicOrigin,
  isLoopbackHost,
  linkOrigin,
  normalizePublicOrigin,
  notePublicOrigin,
  requestHostOrigin,
} from '../src/security/public-origin.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { until } from './jobs-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const EVIL = 'https://evil.example';
const PUBLIC = 'https://admin.example.com';

/**
 * What a browser attaches to a same-origin `fetch` from the dashboard at
 * {@link PUBLIC}, behind a proxy that terminates TLS: `app.inject` speaks
 * plain HTTP, so only `Origin` knows the scheme is https.
 */
const BROWSER: Record<string, string> = {
  host: 'admin.example.com',
  origin: PUBLIC,
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
};

async function configureSmtp(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set(
    'email.smtp',
    {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('relay-password', emailSecretKey(TEST_SECRET)),
      from: 'Adminium <no-reply@adminium.test>',
      secure: false,
    },
    { updatedBy: null },
  );
}

/** Runs every queued `email.send` job and returns what the relay was handed. */
async function deliverQueued(meta: MetaDb, expected: number): Promise<OutboundEmail[]> {
  const sent: OutboundEmail[] = [];
  const registry = createJobRegistry();
  registerEmailSendHandler(registry, {
    meta,
    secret: TEST_SECRET,
    createTransport: () => ({
      send: async (msg) => {
        sent.push(msg);
      },
    }),
  });
  const hub = new RealtimeHub();
  const worker = new JobWorker({ meta, registry, hub, workerId: 'email-link-origin:1' });
  worker.start();
  try {
    await until(() => sent.length >= expected);
  } finally {
    await worker.stop();
    hub.close();
  }
  return sent;
}

interface Envelope {
  to: string;
  html: string;
  text: string;
}

/** Every queued message, opened the way the job handler opens it. */
async function queuedEmails(meta: MetaDb): Promise<Envelope[]> {
  const rows = await meta.db
    .selectFrom('adminium_jobs')
    .selectAll()
    .where('kind', '=', EMAIL_SEND_JOB_KIND)
    .execute();
  return rows.map((row) => {
    const payload = JSON.parse(String(row.payload)) as { envelope: string };
    return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Envelope;
  });
}

/**
 * The origins of the absolute links in a message that carry `token`. Asserting
 * there is at least one is what stops these tests passing by silence.
 */
function linkOriginsCarrying(msg: { html?: string; text?: string } | undefined, token: string): string[] {
  const body = `${msg?.html ?? ''}\n${msg?.text ?? ''}`;
  const links = (body.match(/https?:\/\/[^\s"'<>]+/g) ?? []).filter((link) => link.includes(token));
  expect(links.length, 'no link carries the token').toBeGreaterThan(0);
  return [...new Set(links.map((link) => new URL(link).origin))];
}

async function publicOrigin(meta: MetaDb): Promise<string | null> {
  return settingsRepo(meta).get('system.publicOrigin');
}

// --- the link builder ------------------------------------------------------------------

describe('normalizePublicOrigin', () => {
  it('accepts an http(s) origin and writes it the way URL does', () => {
    expect(normalizePublicOrigin('https://admin.example.com')).toBe(PUBLIC);
    expect(normalizePublicOrigin('  HTTPS://Admin.Example.COM:443/ ')).toBe(PUBLIC);
    expect(normalizePublicOrigin('http://10.0.0.5:4600')).toBe('http://10.0.0.5:4600');
    expect(normalizePublicOrigin('http://[::1]:4600')).toBe('http://[::1]:4600');
    expect(normalizePublicOrigin('https://bücher.example')).toBe('https://xn--bcher-kva.example');
    expect(normalizePublicOrigin('http://adminium_app:4600')).toBe('http://adminium_app:4600');
  });

  it('refuses anything that is more, or less, than an origin', () => {
    for (const value of [
      '',
      'admin.example.com',
      '//admin.example.com',
      'https://admin.example.com/admin',
      'https://admin.example.com/?next=/',
      'https://admin.example.com#x',
      'https://user:pw@admin.example.com',
      'https://admin.example.com@evil.example',
      // `URL` reads the backslash as a path separator: this is evil.example.
      'http://evil.example\\@admin.example.com',
      'https://admin example.com',
      'https://admin.example.com\r\nX-Injected: 1',
      'https://.',
      'https://-admin.example.com',
      'https://admin..example.com',
      'https://admin.example.com:99999',
      'javascript:alert(1)',
      'ftp://admin.example.com',
      `https://${'a'.repeat(250)}.example`,
    ]) {
      expect(normalizePublicOrigin(value), value).toBeNull();
    }
  });
});

describe('isLoopbackHost', () => {
  it('knows every spelling URL leaves a loopback host in', () => {
    const loopback = [
      'http://localhost:4600',
      'http://app.localhost',
      'http://localhost.:4600',
      'http://127.0.0.1',
      'http://127.1',
      'http://2130706433',
      'http://0.0.0.0:4600',
      'http://[::1]',
      'http://[::]',
      'http://[0:0:0:0:0:ffff:127.0.0.1]',
      'http://[::ffff:0.0.0.0]',
    ];
    for (const value of loopback) {
      expect(isLoopbackHost(new URL(normalizePublicOrigin(value) ?? 'http://x.invalid').hostname), value).toBe(true);
    }
    for (const value of ['https://admin.example.com', 'http://10.0.0.5', 'http://192.168.1.20:4600', 'http://[fd00::1]', 'http://localhost-admin.example']) {
      expect(isLoopbackHost(new URL(value).hostname), value).toBe(false);
    }
  });
});

describe('linkOrigin', () => {
  let meta: MetaDb;

  afterEach(async () => {
    await meta.db.destroy();
  });

  it('uses the stored origin when there is one, else the request scheme and host, never more', async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);

    const request = { protocol: 'https', host: 'Admin.Example.com:443', hostname: 'admin.example.com' };
    expect(await linkOrigin(meta, request)).toBe(PUBLIC);
    expect(requestHostOrigin({ protocol: 'http', hostname: 'admin.example.com' })).toBe('http://admin.example.com');
    // A Host that is not a host never becomes part of a link.
    for (const host of ['evil.example/phish?', 'evil.example\\@admin.example.com', 'a b', '"><img src=x>']) {
      expect(() => requestHostOrigin({ protocol: 'http', host, hostname: host }), host).toThrow(/not a host/);
    }

    await settingsRepo(meta).set('system.publicOrigin', 'https://links.example.com', { updatedBy: null });
    expect(await linkOrigin(meta, { protocol: 'http', host: 'evil.example', hostname: 'evil.example' })).toBe(
      'https://links.example.com',
    );
    // Even a Host the fallback would refuse: the stored origin never reads it.
    expect(await linkOrigin(meta, { protocol: 'http', host: 'evil/x', hostname: 'evil/x' })).toBe(
      'https://links.example.com',
    );
  });
});

// --- POST /auth/password/forgot --------------------------------------------------------

describe('POST /auth/password/forgot: the reset link host', () => {
  let fixture: AuthTestApp | undefined;

  afterEach(async () => {
    resetEmailRuntime();
    await fixture?.destroy();
    fixture = undefined;
  });

  async function setUp(env: Record<string, string> = {}): Promise<{ app: AdminiumServer; meta: MetaDb; tokens: string[] }> {
    const tokens: string[] = [];
    fixture = await buildAuthApp({ env: makeEnv(env), onPasswordResetToken: (d) => tokens.push(d.token) });
    await seedBuiltinEmailTemplates(fixture.meta, Date.now());
    await configureSmtp(fixture.meta);
    return { app: fixture.app, meta: fixture.meta, tokens };
  }

  async function forgot(app: AdminiumServer, headers: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      headers,
      payload: { email: ADMIN_EMAIL },
    });
  }

  it('ignores a forged Origin header from a non-browser caller', async () => {
    const { app, meta, tokens } = await setUp();

    const res = await forgot(app, { origin: EVIL, host: 'admin.example.com' });
    expect(res.statusCode).toBe(200);
    expect(tokens).toHaveLength(1);
    const token = tokens[0] ?? 'missing-token';

    const [msg] = await deliverQueued(meta, 1);
    expect(msg?.to).toBe(ADMIN_EMAIL);
    // Nothing stored yet, so the link names the host the request was sent to.
    expect(linkOriginsCarrying(msg, token)).toEqual(['http://admin.example.com']);
    expect(`${msg?.html ?? ''}${msg?.text ?? ''}`).not.toContain('evil.example');
    // …and the forged request taught the server nothing.
    expect(await publicOrigin(meta)).toBeNull();
  });

  it('points at the stored origin whatever Host, Origin and X-Forwarded-Host say', async () => {
    // Trust on, and `app.inject` connects from 127.0.0.1, a trusted proxy: the
    // forwarded headers ARE believed, which is the strongest case to beat.
    const { app, meta, tokens } = await setUp({ ADMINIUM_TRUST_PROXY: 'on' });
    await settingsRepo(meta).set('system.publicOrigin', PUBLIC, { updatedBy: null });

    const res = await forgot(app, {
      host: 'evil.example',
      origin: EVIL,
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    });
    expect(res.statusCode).toBe(200);

    const [msg] = await queuedEmails(meta);
    expect(linkOriginsCarrying(msg, tokens[0] ?? 'missing-token')).toEqual([PUBLIC]);
    expect(`${msg?.html ?? ''}${msg?.text ?? ''}`).not.toContain('evil.example');
  });

  it('believes X-Forwarded-Host only from a trusted proxy while nothing is stored', async () => {
    const { app, meta, tokens } = await setUp();

    await forgot(app, { host: 'admin.example.com', 'x-forwarded-host': 'evil.example' });

    const [msg] = await queuedEmails(meta);
    expect(linkOriginsCarrying(msg, tokens[0] ?? 'missing-token')).toEqual(['http://admin.example.com']);
  });

  it('uses the proxy-forwarded host and scheme when the proxy is trusted and nothing is stored', async () => {
    const { app, meta, tokens } = await setUp({ ADMINIUM_TRUST_PROXY: 'on' });

    await forgot(app, {
      host: '127.0.0.1:4600',
      'x-forwarded-host': 'admin.example.com',
      'x-forwarded-proto': 'https',
    });

    const [msg] = await queuedEmails(meta);
    expect(linkOriginsCarrying(msg, tokens[0] ?? 'missing-token')).toEqual([PUBLIC]);
  });

  it('mails nothing, and answers the same, when the Host is not a host', async () => {
    const { app, meta, tokens } = await setUp();

    const res = await forgot(app, { host: 'evil.example/phish?x=' });
    // The reply never changes, whatever happened behind it.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { ok: true } });
    expect(tokens).toHaveLength(1);
    expect(await queuedEmails(meta)).toHaveLength(0);
  });
});

// --- POST /users (invitations) ---------------------------------------------------------

describe('POST /users: the invitation link host', () => {
  let app: AdminiumServer;
  let meta: MetaDb;
  let key: string;

  afterEach(async () => {
    resetEmailRuntime();
    await app.close();
    await destroyMetaDb(meta);
  });

  async function setUp(): Promise<void> {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await firstRun(meta);
    await seedBuiltinEmailTemplates(meta, Date.now());
    await configureSmtp(meta);
    const role = await rolesRepo(meta).findBySlug('super-admin');
    if (role === null) throw new Error('missing built-in role super-admin');
    const generated = generateApiKey();
    await apiKeysRepo(meta).create({
      name: 'provisioning script',
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
      roleId: role.id,
    });
    key = generated.key;

    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(usersRoutes), { prefix: '/api/v1' });
    await app.ready();
  }

  async function inviteWith(headers: Record<string, string>): Promise<{ token: string; emailSent: boolean }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${key}`, ...headers },
      payload: { email: `noah+${String(Math.random()).slice(2)}@example.com`, name: 'Noah' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{ invite: { token: string }; emailSent: boolean }>();
    return { token: body.invite.token, emailSent: body.emailSent };
  }

  it('ignores a forged Origin from an API-key caller', async () => {
    await setUp();

    const { token, emailSent } = await inviteWith({ origin: EVIL, host: 'admin.example.com' });
    expect(emailSent).toBe(true);

    const [msg] = await queuedEmails(meta);
    expect(linkOriginsCarrying(msg, token)).toEqual(['http://admin.example.com']);
    expect(msg?.html).not.toContain('evil.example');
    // An API key is a script: it never teaches the server its origin.
    expect(await publicOrigin(meta)).toBeNull();
  });

  it('uses the stored origin, on the first invite and on a resend', async () => {
    await setUp();
    await settingsRepo(meta).set('system.publicOrigin', PUBLIC, { updatedBy: null });

    const first = await inviteWith({ origin: EVIL, host: 'evil.example' });
    const invited = (await usersRepo(meta).findByEmail((await queuedEmails(meta))[0]?.to ?? ''))?.id ?? '';
    const resent = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${invited}/invite/resend`,
      headers: { authorization: `Bearer ${key}`, origin: EVIL, host: 'evil.example' },
    });
    expect(resent.statusCode, resent.body).toBe(200);
    const second = resent.json<{ invite: { token: string } }>().invite.token;

    const messages = await queuedEmails(meta);
    expect(messages).toHaveLength(2);
    expect(linkOriginsCarrying(messages[0], first.token)).toEqual([PUBLIC]);
    expect(linkOriginsCarrying(messages[1], second)).toEqual([PUBLIC]);
  });
});

// --- learning system.publicOrigin ------------------------------------------------------

describe('learning system.publicOrigin', () => {
  let fixture: AuthTestApp | undefined;
  let bare: { app: AdminiumServer; meta: MetaDb } | undefined;

  afterEach(async () => {
    await fixture?.destroy();
    fixture = undefined;
    if (bare !== undefined) {
      await bare.app.close();
      await bare.meta.db.destroy();
      bare = undefined;
    }
  });

  async function freshInstance(env: Record<string, string> = {}): Promise<{ app: AdminiumServer; meta: MetaDb }> {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await firstRun(meta);
    const app = await buildServer({ env: makeEnv(env), logger: false, metaDb: meta });
    bare = { app, meta };
    return bare;
  }

  async function setUpSuperAdmin(app: AdminiumServer, headers: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      headers,
      payload: { email: 'owner@example.com', password: 'a-long-enough-password', name: 'Owner' },
    });
  }

  async function signIn(app: AdminiumServer, headers: Record<string, string>, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
    return app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email, password } });
  }

  it('records the origin the first super admin is created from', async () => {
    const { app, meta } = await freshInstance();

    const res = await setUpSuperAdmin(app, BROWSER);
    expect(res.statusCode, res.body).toBe(201);
    expect(await publicOrigin(meta)).toBe(PUBLIC);

    // Nobody pressed Save, so the audit log is where this shows up.
    const rows = await auditRepo(meta).list({ category: 'settings' });
    const captured = rows.find((row) => row.action === 'settings.public-origin.captured');
    expect(captured?.actorId).toBe(res.json<{ data: { user: { id: string } } }>().data.user.id);
    expect(captured?.changes).toEqual({ before: { publicOrigin: null }, after: { publicOrigin: PUBLIC } });
  });

  it('never records a loopback origin', async () => {
    const { app, meta } = await freshInstance();

    const res = await setUpSuperAdmin(app, {
      ...BROWSER,
      host: 'localhost:4600',
      origin: 'http://localhost:4600',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(await publicOrigin(meta)).toBeNull();
  });

  it('records it once, at a settings admin sign-in, and keeps it', async () => {
    fixture = await buildAuthApp();
    const { app, meta } = fixture;

    expect((await signIn(app, BROWSER)).statusCode).toBe(200);
    expect(await publicOrigin(meta)).toBe(PUBLIC);

    // A later sign-in under another name does not move it, whether or not the
    // process still remembers that it is set.
    notePublicOrigin(meta, null);
    const other = { ...BROWSER, host: 'other.example.com', origin: 'https://other.example.com' };
    expect((await signIn(app, other)).statusCode).toBe(200);
    expect(await publicOrigin(meta)).toBe(PUBLIC);
  });

  it('ignores a sign-in whose Origin does not match its Host', async () => {
    fixture = await buildAuthApp();

    // A sign-in carries no session, so CSRF does not stop it: the capture has
    // to refuse on its own.
    const res = await signIn(fixture.app, { ...BROWSER, origin: EVIL, 'sec-fetch-site': 'cross-site' });
    expect(res.statusCode).toBe(200);
    expect(await publicOrigin(fixture.meta)).toBeNull();

    // Same host, but fetch metadata says another site sent it.
    await signIn(fixture.app, { ...BROWSER, 'sec-fetch-site': 'same-site' });
    expect(await publicOrigin(fixture.meta)).toBeNull();
  });

  it('ignores a sign-in by someone who cannot manage settings', async () => {
    fixture = await buildAuthApp();
    const { app, meta } = fixture;
    const viewerRole = await rolesRepo(meta).findBySlug('viewer');
    if (viewerRole === null) throw new Error('missing built-in role viewer');
    const viewer = await usersRepo(meta).create({
      email: 'liam@example.com',
      name: 'Liam',
      passwordHash: await hashPassword('liams-own-password'),
      status: 'active',
    });
    await rolesRepo(meta).assignToUser(viewer.id, viewerRole.id);

    expect((await signIn(app, BROWSER, 'liam@example.com', 'liams-own-password')).statusCode).toBe(200);
    expect(await publicOrigin(meta)).toBeNull();
  });

  it("learns it from a signed-in admin's same-origin write, not from a read", async () => {
    fixture = await buildAuthApp();
    const { app, meta } = fixture;
    // Signed in WITHOUT an Origin (a script, or a session from before the
    // upgrade), so the sign-in itself taught nothing.
    const { cookie } = await login(app);
    expect(cookie).not.toBeNull();
    expect(await publicOrigin(meta)).toBeNull();
    const boot = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie ?? '' } });
    const token = boot.json<{ data: { csrfToken: string } }>().data.csrfToken;

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { ...BROWSER, cookie: cookie ?? '' },
    });
    expect(read.statusCode).toBe(200);
    expect(await publicOrigin(meta)).toBeNull();

    const write = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enroll',
      headers: { ...BROWSER, cookie: cookie ?? '', [CSRF_HEADER]: token },
    });
    expect(write.statusCode, write.body).toBe(200);
    expect(await publicOrigin(meta)).toBe(PUBLIC);
  });

  it('learns nothing from a write the CSRF check refuses', async () => {
    fixture = await buildAuthApp();
    const { app, meta } = fixture;
    const { cookie } = await login(app);

    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enroll',
      headers: { ...BROWSER, origin: EVIL, 'sec-fetch-site': 'cross-site', cookie: cookie ?? '' },
    });
    expect(forged.statusCode).toBe(403);
    expect(await publicOrigin(meta)).toBeNull();
  });

  it('refuses a read, even one a browser sent with an Origin', async () => {
    fixture = await buildAuthApp();
    const { meta, admin } = fixture;
    const ctx = { meta, allowedOrigins: new Set<string>(), user: admin };

    // A cross-origin GET carries `Origin` too; a read still teaches nothing.
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(await capturePublicOrigin(ctx, { method, headers: BROWSER }), method).toBeNull();
    }
    expect(await publicOrigin(meta)).toBeNull();
    expect(await capturePublicOrigin(ctx, { method: 'PATCH', headers: BROWSER })).toBe(PUBLIC);
  });

  it('records a CORS-listed dashboard origin, for a split deployment', async () => {
    fixture = await buildAuthApp({ env: makeEnv({ ADMINIUM_CORS_ORIGINS: 'https://dash.example.com' }) });

    const res = await signIn(fixture.app, {
      host: 'api.example.com',
      origin: 'https://dash.example.com',
      'sec-fetch-site': 'same-site',
    });
    expect(res.statusCode).toBe(200);
    expect(await publicOrigin(fixture.meta)).toBe('https://dash.example.com');
  });
});
