// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMTP write surface and the transport that consumes it.
 *
 * NOTHING HERE OPENS A SOCKET, and that is a property of the design rather than
 * of the test: `createSmtpTransport` is the only module that knows nodemailer
 * exists, and it takes a plain {@link SmtpConfig} in and hands an
 * {@link EmailTransport} out, so the options it would dial with can be read off
 * a mocked `createTransport` and everything upstream of it can be driven with a
 * recording fake.
 *
 * The password is what most of these assertions are about. It is the first
 * secret this settings surface has ever stored, so the tests pin the three ways
 * it could escape — the reply body, the audit row, a read-back — plus the two
 * ways it could be destroyed by accident: a port edit that omits it, and a
 * clear that was meant to be an update.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import {
  assertSmtpHostAllowed,
  createSmtpTransport,
  EmailSecretMismatchError,
  emailSecretKey,
  resolveSmtpConfig,
} from '../src/email/config.js';
import type { EmailTransport, OutboundEmail, SmtpConfig } from '../src/email/types.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { settingsRoutes } from '../src/routes/settings/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const KEY = emailSecretKey(TEST_SECRET);

/**
 * nodemailer, replaced wholesale. `createSmtpTransport` is the only module that
 * imports it, so one mock here is the whole "never opens a socket" guarantee —
 * and the options it was called with are the assertion surface for the TLS
 * decisions the transport makes.
 */
const mailer = vi.hoisted(() => {
  const sendMail = vi.fn<(msg: Record<string, unknown>) => Promise<{ messageId: string }>>(
    async () => Promise.resolve({ messageId: 'test' }),
  );
  const close = vi.fn();
  const createTransport = vi.fn<
    (options: Record<string, unknown>) => { sendMail: typeof sendMail; close: typeof close }
  >(() => ({ sendMail, close }));
  return { sendMail, close, createTransport };
});
vi.mock('nodemailer', () => ({ createTransport: mailer.createTransport }));

const SMTP_BODY = {
  host: 'smtp.acme.example',
  port: 587,
  user: 'postmaster@acme.example',
  pass: 'hunter2-but-longer',
  from: 'Acme Ops <ops@acme.example>',
  secure: false,
};

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdmin: User;
  admin: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

/** Mirrors the settings-workspace harness: header-stubbed user, rbac, routes. */
async function buildHarness(opts: { injectKey?: boolean } = {}): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const superAdmin = await makeUser('Ava', 'super-admin');
  const admin = await makeUser('Noah', 'admin');

  const app = await buildServer({ env: makeEnv(), logger: false });

  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });

  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      // `injectKey: false` exercises the ADMINIUM_SECRET fallback instead.
      await api.register(
        settingsRoutes(opts.injectKey === false ? { meta } : { meta, emailKey: KEY }),
      );
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, superAdmin, admin };
}

async function putEmail(t: Harness, payload: unknown, user: User = t.superAdmin) {
  return t.app.inject({
    method: 'PUT',
    url: '/api/v1/settings/email',
    headers: asUser(user),
    payload: payload as Record<string, unknown>,
  });
}

describe('PUT /settings/email', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('GET reports "not configured" on a fresh install, with no invented values', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/settings/email',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      configured: false,
      host: null,
      port: null,
      user: null,
      from: null,
      secure: null,
    });
  });

  it('stores the password encrypted and never reads it back', async () => {
    const res = await putEmail(t, { smtp: SMTP_BODY });
    expect(res.statusCode).toBe(200);

    // The reply: presence, and the five non-secret fields. Nothing else.
    expect(res.json().data).toEqual({
      configured: true,
      host: SMTP_BODY.host,
      port: 587,
      user: SMTP_BODY.user,
      from: SMTP_BODY.from,
      secure: false,
    });
    // Not the value, not a masked copy, not a last-4 — the serialized body must
    // not contain the password in ANY form.
    expect(res.body).not.toContain('hunter2');
    expect(JSON.stringify(res.json())).not.toMatch(/pass/i);

    // The row holds an AES-256-GCM token, not the plaintext.
    const stored = await settingsRepo(t.meta).get('email.smtp');
    expect(stored?.passEncrypted.startsWith('enc:v1:')).toBe(true);
    expect(stored?.passEncrypted).not.toContain('hunter2');
    expect(decryptSecret(stored?.passEncrypted ?? '', KEY)).toBe(SMTP_BODY.pass);
  });

  it('keeps the stored password when a later PUT omits `pass`', async () => {
    await putEmail(t, { smtp: SMTP_BODY });
    const before = await settingsRepo(t.meta).get('email.smtp');

    // The port edit an admin would otherwise have to retype the password for.
    const res = await putEmail(t, {
      smtp: {
        host: SMTP_BODY.host,
        port: 2525,
        user: SMTP_BODY.user,
        from: SMTP_BODY.from,
        secure: SMTP_BODY.secure,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.port).toBe(2525);

    const after = await settingsRepo(t.meta).get('email.smtp');
    expect(after?.passEncrypted).toBe(before?.passEncrypted);
    // And it is still the password, not a re-encryption of the empty string.
    expect(decryptSecret(after?.passEncrypted ?? '', KEY)).toBe(SMTP_BODY.pass);
  });

  it('clears the whole configuration on {"smtp": null}', async () => {
    await putEmail(t, { smtp: SMTP_BODY });
    const res = await putEmail(t, { smtp: null });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.configured).toBe(false);
    expect(await settingsRepo(t.meta).get('email.smtp')).toBeNull();
    expect(await resolveSmtpConfig(t.meta, KEY)).toBeNull();
  });

  it('accepts an unauthenticated relay (empty user, no pass)', async () => {
    const res = await putEmail(t, {
      smtp: { host: '127.0.0.1', port: 1025, user: '', from: 'ops@acme.example', secure: false },
    });
    expect(res.statusCode).toBe(200);

    const cfg = await resolveSmtpConfig(t.meta, KEY);
    expect(cfg).toMatchObject({ host: '127.0.0.1', port: 1025, user: '', pass: '' });
  });

  it('refuses a username with no password rather than storing a half-configured relay', async () => {
    const res = await putEmail(t, {
      smtp: { host: 'smtp.acme.example', port: 587, user: 'ops', from: 'ops@acme.example', secure: false },
    });
    expect(res.statusCode).toBe(422);
    expect(await settingsRepo(t.meta).get('email.smtp')).toBeNull();
  });

  it('rejects a host that is a pasted URL, a credentialed string, or a metadata address', async () => {
    for (const host of [
      'smtps://user:secret@smtp.acme.example',
      'user@smtp.acme.example',
      'smtp.acme.example/relay',
      '169.254.169.254',
      'metadata.google.internal',
    ]) {
      const res = await putEmail(t, { smtp: { ...SMTP_BODY, host } });
      expect(res.statusCode, host).toBe(422);
    }
    expect(await settingsRepo(t.meta).get('email.smtp')).toBeNull();
  });

  it('rejects a CRLF in a configured value (SMTP is line-oriented)', async () => {
    const res = await putEmail(t, {
      smtp: { ...SMTP_BODY, from: 'ops@acme.example\r\nBcc: leak@evil.example' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('audits the change with before/after images that carry no password', async () => {
    await putEmail(t, { smtp: SMTP_BODY });

    const entry = (await auditRepo(t.meta).list({ category: 'settings' })).find(
      (e) => e.action === 'settings.email.update',
    );
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(t.superAdmin.id);
    expect(entry?.changes?.before).toMatchObject({ configured: false });
    expect(entry?.changes?.after).toMatchObject({ configured: true, host: SMTP_BODY.host });
    expect(JSON.stringify(entry?.changes)).not.toContain('hunter2');
  });

  it('is closed to a non-super-admin', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const res = await t.app.inject({
        method,
        url: '/api/v1/settings/email',
        headers: asUser(t.admin),
        ...(method === 'PUT' ? { payload: { smtp: SMTP_BODY } } : {}),
      });
      expect(res.statusCode).toBe(403);
    }
    expect(await settingsRepo(t.meta).get('email.smtp')).toBeNull();
  });
});

describe('settings/email without an injected key', () => {
  it('derives the same key from ADMINIUM_SECRET, so the job side can still read it', async () => {
    const previous = process.env.ADMINIUM_SECRET;
    process.env.ADMINIUM_SECRET = TEST_SECRET;
    const t = await buildHarness({ injectKey: false });
    try {
      const res = await putEmail(t, { smtp: SMTP_BODY });
      expect(res.statusCode).toBe(200);
      // Written by the fallback derivation, read by the injected one.
      const cfg = await resolveSmtpConfig(t.meta, KEY);
      expect(cfg?.pass).toBe(SMTP_BODY.pass);
    } finally {
      await t.app.close();
      await t.meta.db.destroy();
      if (previous === undefined) delete process.env.ADMINIUM_SECRET;
      else process.env.ADMINIUM_SECRET = previous;
    }
  });
});

describe('resolveSmtpConfig', () => {
  let meta: MetaDb;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  it('returns null when mail is not configured', async () => {
    expect(await resolveSmtpConfig(meta, KEY)).toBeNull();
  });

  it('round-trips a stored config through encrypt/decrypt', async () => {
    const settings = settingsRepo(meta);
    await settings.set('email.smtp', {
      host: 'smtp.acme.example',
      port: 465,
      user: 'ops',
      passEncrypted: encryptSecret('s3cret', KEY),
      from: 'ops@acme.example',
      secure: true,
    });

    expect(await resolveSmtpConfig(meta, KEY)).toEqual({
      host: 'smtp.acme.example',
      port: 465,
      user: 'ops',
      pass: 's3cret',
      from: 'ops@acme.example',
      secure: true,
    });
  });

  it('explains a wrong ADMINIUM_SECRET instead of surfacing a bare GCM failure', async () => {
    const settings = settingsRepo(meta);
    await settings.set('email.smtp', {
      host: 'smtp.acme.example',
      port: 587,
      user: 'ops',
      passEncrypted: encryptSecret('s3cret', KEY),
      from: 'ops@acme.example',
      secure: false,
    });

    const otherKey = emailSecretKey('a-completely-different-master-secret');
    await expect(resolveSmtpConfig(meta, otherKey)).rejects.toBeInstanceOf(EmailSecretMismatchError);
  });
});

describe('assertSmtpHostAllowed', () => {
  it('allows a loopback relay — a local postfix/MailHog is a normal self-host setup', () => {
    expect(() => assertSmtpHostAllowed('127.0.0.1')).not.toThrow();
    expect(() => assertSmtpHostAllowed('localhost')).not.toThrow();
    expect(() => assertSmtpHostAllowed('mail.internal')).not.toThrow();
    expect(() => assertSmtpHostAllowed('[::1]')).not.toThrow();
  });

  it('blocks the cloud-metadata endpoints and non-host strings', () => {
    for (const host of ['169.254.169.254', 'metadata.google.internal', '', 'a b', 'http://x']) {
      expect(() => assertSmtpHostAllowed(host), host).toThrow();
    }
  });
});

describe('createSmtpTransport', () => {
  beforeEach(() => {
    mailer.sendMail.mockClear();
    mailer.close.mockClear();
    mailer.createTransport.mockClear();
  });

  const cfg: SmtpConfig = {
    host: 'smtp.acme.example',
    port: 587,
    user: 'ops',
    pass: 's3cret',
    from: 'Acme Ops <ops@acme.example>',
    secure: false,
  };

  const msg: OutboundEmail = {
    to: 'ada@example.com',
    subject: 'Reset your password',
    html: '<p>hi</p>',
    text: 'hi',
    headers: { 'Auto-Submitted': 'auto-generated' },
  };

  /** Sends one message and hands back the options the transport would dial with. */
  async function sendWith(config: SmtpConfig): Promise<Record<string, unknown>> {
    const transport: EmailTransport = createSmtpTransport(config);
    await transport.send(msg);
    return mailer.createTransport.mock.calls[0]?.[0] ?? {};
  }

  it('demands STARTTLS on a cleartext port and never lowers certificate verification', async () => {
    const options = await sendWith(cfg);

    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
    // The one option that would silently accept a forged certificate.
    expect(JSON.stringify(options)).not.toContain('rejectUnauthorized');
    expect(options.connectionTimeout).toBeGreaterThan(0);
    expect(options.socketTimeout).toBeGreaterThan(0);
    expect(options.disableFileAccess).toBe(true);
    expect(options.disableUrlAccess).toBe(true);
    expect(options.auth).toEqual({ user: 'ops', pass: 's3cret' });
  });

  it('uses implicit TLS without STARTTLS when `secure` is set', async () => {
    const options = await sendWith({ ...cfg, port: 465, secure: true });
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it('does not require STARTTLS for a loopback relay', async () => {
    const options = await sendWith({ ...cfg, host: '127.0.0.1', port: 1025, user: '', pass: '' });
    expect(options.requireTLS).toBe(false);
    // An empty user means no AUTH attempt at all, rather than AUTH with blanks.
    expect(options.auth).toBeUndefined();
  });

  it('sends the rendered message with the configured From and closes the connection', async () => {
    await sendWith(cfg);

    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail.mock.calls[0]?.[0]).toEqual({
      from: cfg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.headers,
    });
    expect(mailer.close).toHaveBeenCalledTimes(1);
  });

  it('lets a send failure escape — retry belongs to the job worker, not in here', async () => {
    mailer.sendMail.mockRejectedValueOnce(new Error('550 relay denied'));
    await expect(createSmtpTransport(cfg).send(msg)).rejects.toThrow('550 relay denied');
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    // Still torn down on the failure path.
    expect(mailer.close).toHaveBeenCalledTimes(1);
  });
});
