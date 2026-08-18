// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `email.send` pipeline, end to end without a socket: enqueue seals a
 * rendered body into `adminium_jobs`, the handler opens it and hands it to a
 * transport, and every degradation path stays quiet.
 *
 * The load-bearing assertion is `does not store the plaintext token`. A
 * rendered reset mail CONTAINS the single-use token, and `adminium_jobs.payload`
 * is readable through `GET /jobs/:id` — so if that ever regresses, the "only a
 * SHA-256 is stored" guarantee of `adminium_password_resets` is gone and the
 * queue becomes an account-takeover primitive.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  firstRun,
  notificationPrefsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { encryptSecret } from '../src/config/secrets.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import {
  EMAIL_SEND_JOB_KIND,
  PASSWORD_RESET_TEMPLATE_KEY,
  configureEmailRuntime,
  enqueueEmail,
  isEmailConfigured,
  requestOrigin,
  resetEmailRuntime,
} from '../src/email/send.js';
import type { EmailTransport, OutboundEmail, SmtpConfig } from '../src/email/types.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { notify } from '../src/notifications/notify.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import { buildAuthApp, ADMIN_EMAIL, type AuthTestApp } from './auth-helpers.js';
import { buildBareApp, until, type BareApp } from './jobs-helpers.js';
import { TEST_SECRET } from './helpers.js';

const SMTP_PASSWORD = 'relay-password';

/** A recording transport — the suite never opens a socket. */
function recordingTransport(): { sent: OutboundEmail[]; make: (cfg: SmtpConfig) => EmailTransport } {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    make: (cfg) => ({
      send: async (msg) => {
        expect(cfg.host).toBe('localhost');
        sent.push(msg);
      },
    }),
  };
}

async function configureSmtp(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set(
    'email.smtp',
    {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret(SMTP_PASSWORD, emailSecretKey(TEST_SECRET)),
      from: 'Adminium <no-reply@adminium.test>',
      secure: false,
    },
    { updatedBy: null },
  );
}

/** Every queued job row, straight off the table (jobsRepo has no list). */
async function jobRows(meta: MetaDb) {
  return await meta.db.selectFrom('adminium_jobs').selectAll().execute();
}

async function freshMeta(): Promise<MetaDb> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await seedBuiltinEmailTemplates(meta, Date.now());
  return meta;
}

// --- enqueue / handler ---------------------------------------------------------------

describe('email.send: sealed payload, transport, and the quiet paths', () => {
  let meta: MetaDb;

  beforeEach(async () => {
    resetEmailRuntime();
    meta = await freshMeta();
  });

  afterEach(async () => {
    resetEmailRuntime();
    await meta.db.destroy();
  });

  it('seeds the built-in templates so a fresh install has bodies to render', async () => {
    const rows = await meta.db
      .selectFrom('adminium_email_templates')
      .selectAll()
      .where('key', '=', PASSWORD_RESET_TEMPLATE_KEY)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.locale.length > 0)).toBe(true);
  });

  it('queues one job whose stored payload never contains the plaintext token', async () => {
    await configureSmtp(meta);
    const token = 'admr_super-secret-plaintext-token';

    const job = await enqueueEmail(
      { meta, secret: TEST_SECRET },
      {
        to: 'ava@example.com',
        templateKey: PASSWORD_RESET_TEMPLATE_KEY,
        locale: 'en_US',
        vars: {
          appName: 'Adminium',
          name: 'Ava',
          email: 'ava@example.com',
          resetUrl: `https://admin.test/reset/${token}`,
          expiresInMinutes: '30',
        },
      },
    );
    expect(job).not.toBeNull();
    expect(job?.kind).toBe(EMAIL_SEND_JOB_KIND);
    expect(job?.maxAttempts).toBeGreaterThan(1);

    // The row as an operator (or `GET /jobs/:id`) sees it.
    const rows = await jobRows(meta);
    expect(rows).toHaveLength(1);
    const stored = String(rows[0]?.payload ?? '');
    expect(stored).not.toContain(token);
    expect(stored).not.toContain('ava@example.com');
    expect(stored).toContain(PASSWORD_RESET_TEMPLATE_KEY);
    // Whatever else changes, the body must stay an `enc:v1:` token.
    expect(stored).toContain('enc:v1:');
  });

  it('runs the queued job through the worker into the transport', async () => {
    await configureSmtp(meta);
    const transport = recordingTransport();
    const registry = createJobRegistry();
    registerEmailSendHandler(registry, {
      meta,
      secret: TEST_SECRET,
      createTransport: transport.make,
    });
    const hub = new RealtimeHub();
    const worker = new JobWorker({ meta, registry, hub, workerId: 'email-test:1' });

    await enqueueEmail(
      { meta, secret: TEST_SECRET },
      {
        to: 'ava@example.com',
        templateKey: PASSWORD_RESET_TEMPLATE_KEY,
        locale: 'en_US',
        vars: {
          appName: 'Adminium',
          name: 'Ava',
          email: 'ava@example.com',
          resetUrl: 'https://admin.test/reset/tok',
          expiresInMinutes: '30',
        },
      },
    );

    worker.start();
    try {
      await until(() => transport.sent.length === 1);
    } finally {
      await worker.stop();
      hub.close();
    }

    const msg = transport.sent[0];
    expect(msg?.to).toBe('ava@example.com');
    expect(msg?.subject.length).toBeGreaterThan(0);
    expect(msg?.html).toContain('https://admin.test/reset/tok');
    // Both parts are always present — a body with no text alternative is spam bait.
    expect(msg?.text).toContain('https://admin.test/reset/tok');

    expect((await jobRows(meta))[0]?.status).toBe('succeeded');
  });

  it('enqueues nothing and throws nothing when SMTP is unconfigured', async () => {
    expect(await isEmailConfigured(meta, TEST_SECRET)).toBe(false);

    const queued = await enqueueEmail(
      { meta, secret: TEST_SECRET },
      {
        to: 'ava@example.com',
        templateKey: PASSWORD_RESET_TEMPLATE_KEY,
        locale: 'en_US',
        vars: {
          appName: 'Adminium',
          name: 'Ava',
          email: 'ava@example.com',
          resetUrl: 'https://admin.test/reset/tok',
          expiresInMinutes: '30',
        },
      },
    );
    expect(queued).toBeNull();
    expect(await jobRows(meta)).toHaveLength(0);
  });

  it('enqueues nothing for an unknown template key rather than throwing', async () => {
    await configureSmtp(meta);
    const queued = await enqueueEmail(
      { meta, secret: TEST_SECRET },
      { to: 'ava@example.com', templateKey: 'no-such-template', locale: 'en_US', vars: {} },
    );
    expect(queued).toBeNull();
  });

  it('falls back to the composition-root secret when the caller has none', async () => {
    await configureSmtp(meta);
    // No runtime secret configured yet: nothing can be sealed, so nothing queues.
    expect(
      await enqueueEmail(
        { meta },
        {
          to: 'ava@example.com',
          templateKey: PASSWORD_RESET_TEMPLATE_KEY,
          locale: 'en_US',
          vars: {
            appName: 'Adminium',
            name: 'Ava',
            email: 'ava@example.com',
            resetUrl: 'https://admin.test/reset/tok',
            expiresInMinutes: '30',
          },
        },
      ),
    ).toBeNull();

    configureEmailRuntime({ secret: TEST_SECRET });
    expect(
      await enqueueEmail(
        { meta },
        {
          to: 'ava@example.com',
          templateKey: PASSWORD_RESET_TEMPLATE_KEY,
          locale: 'en_US',
          vars: {
            appName: 'Adminium',
            name: 'Ava',
            email: 'ava@example.com',
            resetUrl: 'https://admin.test/reset/tok',
            expiresInMinutes: '30',
          },
        },
      ),
    ).not.toBeNull();
  });

  it('prefers the Origin header over a forgeable Host', () => {
    expect(
      requestOrigin({
        protocol: 'http',
        host: 'evil.example',
        hostname: 'evil.example',
        headers: { origin: 'https://admin.example.com/' },
      }),
    ).toBe('https://admin.example.com');
    expect(
      requestOrigin({ protocol: 'https', host: 'admin.test:8443', hostname: 'admin.test', headers: {} }),
    ).toBe('https://admin.test:8443');
  });
});

// --- the notification email channel ---------------------------------------------------

describe('notify() honours the email channel', () => {
  let meta: MetaDb;
  let user: User;

  beforeEach(async () => {
    resetEmailRuntime();
    meta = await freshMeta();
    await configureSmtp(meta);
    configureEmailRuntime({ secret: TEST_SECRET });
    user = await usersRepo(meta).create({
      email: 'ava@adminium.test',
      name: 'Ava',
      status: 'active',
    });
  });

  afterEach(async () => {
    resetEmailRuntime();
    await meta.db.destroy();
  });

  const input = {
    kind: 'report.ready',
    title: 'Your report is ready',
    body: 'Weekly revenue finished.',
    actionUrl: '/reports/42',
  };

  it('queues nothing once the user opts the channel out', async () => {
    await notificationPrefsRepo(meta).upsert(user.id, input.kind, {
      inApp: true,
      email: false,
      push: false,
    });
    const row = await notify(meta, { userId: user.id, ...input });
    expect(row).not.toBeNull();
    expect(await jobRows(meta)).toHaveLength(0);
  });

  it('queues a message on the registry default (DEFAULT_NOTIFICATION_CHANNELS.email is true)', async () => {
    const row = await notify(meta, { userId: user.id, ...input }, { origin: 'https://admin.test' });
    expect(row).not.toBeNull();

    const jobs = await jobRows(meta);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe(EMAIL_SEND_JOB_KIND);
    expect(String(jobs[0]?.payload)).toContain('notification');
  });

  it('still mails when only the IN-APP half is switched off', async () => {
    await notificationPrefsRepo(meta).upsert(user.id, input.kind, {
      inApp: false,
      email: true,
      push: false,
    });
    // `null` means "no bell row", not "nothing happened".
    expect(await notify(meta, { userId: user.id, ...input })).toBeNull();
    expect(await jobRows(meta)).toHaveLength(1);
  });
});

// --- POST /auth/password/forgot ------------------------------------------------------

describe('POST /auth/password/forgot still 202s and now also mails', () => {
  let fixture: AuthTestApp | undefined;

  afterEach(async () => {
    resetEmailRuntime();
    await fixture?.destroy();
    fixture = undefined;
  });

  async function forgot(app: AuthTestApp['app'], email: string) {
    return await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email },
    });
  }

  it('answers the same with SMTP off, and queues nothing', async () => {
    fixture = await buildAuthApp();
    const res = await forgot(fixture.app, ADMIN_EMAIL);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { ok: true } });
    expect(await jobRows(fixture.meta)).toHaveLength(0);
  });

  it('queues a reset mail with SMTP on — and keeps the test hook working', async () => {
    const tokens: string[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => tokens.push(d.token) });
    await seedBuiltinEmailTemplates(fixture.meta, Date.now());
    await configureSmtp(fixture.meta);

    const res = await forgot(fixture.app, ADMIN_EMAIL);
    expect(res.statusCode).toBe(200);
    expect(tokens).toHaveLength(1);

    const pending = await jobRows(fixture.meta);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe(EMAIL_SEND_JOB_KIND);
    // The token is in the mail but never in the row.
    expect(JSON.stringify(pending[0]?.payload)).not.toContain(tokens[0] ?? 'nope');
  });

  it('reveals nothing for an unknown address', async () => {
    fixture = await buildAuthApp();
    await seedBuiltinEmailTemplates(fixture.meta, Date.now());
    await configureSmtp(fixture.meta);

    const res = await forgot(fixture.app, 'nobody@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { ok: true } });
    expect(await jobRows(fixture.meta)).toHaveLength(0);
  });
});

// --- POST /email-templates/:key/test-send --------------------------------------------

describe('POST /email-templates/:key/test-send', () => {
  let meta: MetaDb;
  let app: BareApp;
  let manager: User;
  let viewer: User;

  async function role(slug: string): Promise<Role> {
    const found = await rolesRepo(meta).findBySlug(slug);
    if (found === null) throw new Error(`missing built-in role ${slug}`);
    return found;
  }

  beforeEach(async () => {
    resetEmailRuntime();
    meta = await freshMeta();
    const users = usersRepo(meta);
    manager = await users.create({ email: 'ava@adminium.test', name: 'Ava', status: 'active' });
    viewer = await users.create({ email: 'liam@adminium.test', name: 'Liam', status: 'active' });
    // `settings.manage` is a super-admin power — the built-in `admin` role does
    // NOT hold it (packages/meta bootstrap.ts BUILTIN_ROLES).
    await rolesRepo(meta).assignToUser(manager.id, (await role('super-admin')).id);
    await rolesRepo(meta).assignToUser(viewer.id, (await role('viewer')).id);

    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string' && id.length > 0) {
        (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
      }
    });
    await app.register(rbacPlugin, { meta });
    await app.register(emailTemplatesRoutes({ meta, secret: TEST_SECRET }));
    await app.ready();
  });

  afterEach(async () => {
    resetEmailRuntime();
    await app.close();
    await meta.db.destroy();
  });

  function testSend(user: User, key = PASSWORD_RESET_TEMPLATE_KEY) {
    return app.inject({
      method: 'POST',
      url: `/email-templates/${key}/test-send`,
      headers: { 'x-test-user-id': user.id },
      payload: { to: 'ops@adminium.test' },
    });
  }

  it('409s with a "not configured" detail when SMTP is unset', async () => {
    const res = await testSend(manager);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; details?: { reason?: string } } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.reason).toBe('not configured');
    expect(await jobRows(meta)).toHaveLength(0);
  });

  it('202s and queues one message once SMTP is configured', async () => {
    await configureSmtp(meta);
    const res = await testSend(manager);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ queued: true });

    const pending = await jobRows(meta);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe(EMAIL_SEND_JOB_KIND);
  });

  it('404s for a template key that does not exist', async () => {
    await configureSmtp(meta);
    const res = await testSend(manager, 'no-such-template');
    expect(res.statusCode).toBe(404);
  });

  it('403s a viewer — test-send is a settings:manage power', async () => {
    await configureSmtp(meta);
    const res = await testSend(viewer);
    expect(res.statusCode).toBe(403);
    expect(await jobRows(meta)).toHaveLength(0);
  });
});
