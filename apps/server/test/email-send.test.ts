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
import { Readable } from 'node:stream';

import {
  createSqliteMetaDb,
  emailTemplatesRepo,
  filesRepo,
  firstRun,
  notificationPrefsRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
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
  resetEmailRuntime,
} from '../src/email/send.js';
import type { EmailTransport, OutboundEmail, SmtpConfig } from '../src/email/types.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { notify } from '../src/notifications/notify.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { linkOrigin } from '../src/security/public-origin.js';
import type { FileStore } from '../src/files/store.js';
import { buildAuthApp, ADMIN_EMAIL, type AuthTestApp } from './auth-helpers.js';
import { until } from './jobs-helpers.js';
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

  it('tells the row it was sent for when the message fails for good, and only then', async () => {
    await configureSmtp(meta);
    const report = { app: 'pos', connectionId: 'c1', table: 'public.pos_messages', pk: { id: 7 }, sentAt: 1_700_000_000_000 };
    const job = await enqueueEmail(
      { meta, secret: TEST_SECRET },
      { to: 'ava@hill.dev', templateKey: PASSWORD_RESET_TEMPLATE_KEY, locale: 'en_US', vars: { appName: 'A', name: 'Ava', email: 'x', resetUrl: 'u', expiresInMinutes: '30' }, report },
    );
    const told: unknown[] = [];
    const registry = createJobRegistry();
    registerEmailSendHandler(registry, {
      meta,
      secret: TEST_SECRET,
      createTransport: () => ({ send: async () => Promise.reject(new Error('550 mailbox unavailable')) }),
      onGiveUp: async (r, error) => {
        told.push({ r, message: (error as Error).message });
      },
    });
    const handler = registry.get(EMAIL_SEND_JOB_KIND)!;
    const payload = handler.schema.parse(job!.payload) as never;
    const ctx = (attempt: number) => ({ jobId: job!.id, kind: EMAIL_SEND_JOB_KIND, attempt, maxAttempts: 5, signal: new AbortController().signal, progress: () => undefined, log: () => undefined });
    // The report rides the stored payload, ids only.
    expect(JSON.stringify(job!.payload)).not.toContain('ava@hill.dev');
    await expect(handler.run(payload, ctx(1))).rejects.toThrow('550');
    expect(told).toEqual([]);
    await expect(handler.run(payload, ctx(5))).rejects.toThrow('550');
    expect(told).toEqual([{ r: report, message: '550 mailbox unavailable' }]);
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

  // This used to assert the opposite: that `Origin` wins because "a page
  // cannot forge it". Any non-browser caller can, and `POST /auth/password/forgot`
  // takes anyone's call. email-link-origin.test.ts has the end-to-end cases.
  it('builds links from the stored public origin, never from the Origin header', async () => {
    const forged = {
      protocol: 'https',
      host: 'admin.test:8443',
      hostname: 'admin.test',
      headers: { origin: 'https://evil.example' },
    };
    // Nothing stored yet: the request's own scheme and host.
    expect(await linkOrigin(meta, forged)).toBe('https://admin.test:8443');

    await settingsRepo(meta).set('system.publicOrigin', 'https://admin.example.com', { updatedBy: null });
    expect(await linkOrigin(meta, forged)).toBe('https://admin.example.com');
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

// --- attachments at delivery ---------------------------------------

describe('email.send delivers attachments and inline parts as bytes', () => {
  let meta: MetaDb;
  const PDF = Buffer.from('%PDF-1.4 bytes');
  const bytes = new Map<string, Buffer>();

  const storage = {
    async open(file: { storageKey: string }) {
      const content = bytes.get(file.storageKey);
      if (content === undefined) throw new Error(`no bytes for ${file.storageKey}`);
      return { stream: Readable.from([content]), sizeBytes: content.length };
    },
  } as unknown as FileStore;

  beforeEach(async () => {
    resetEmailRuntime();
    bytes.clear();
    meta = await freshMeta();
    await configureSmtp(meta);
  });

  afterEach(async () => {
    resetEmailRuntime();
    await meta.db.destroy();
  });

  async function attachPdf(): Promise<string> {
    const file = await filesRepo(meta).create({
      filename: 'receipt.pdf',
      mime: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: 'a'.repeat(64),
      kind: 'upload',
      attachedAt: 1,
    });
    bytes.set(file.storageKey, PDF);
    const row = await emailTemplatesRepo(meta).findByKeyLocale(PASSWORD_RESET_TEMPLATE_KEY, 'en_US');
    if (row === null) throw new Error('seed missing');
    await emailTemplatesRepo(meta).patch(row.id, {
      attachments: [
        { id: 'a1', kind: 'file', fileId: file.id },
        { id: 'a2', kind: 'generated', label: 'Statement', token: '{{statement_pdf}}' },
      ],
    });
    return file.id;
  }

  function runWorker(transport: ReturnType<typeof recordingTransport>, opts: { storage?: FileStore } = {}) {
    const registry = createJobRegistry();
    registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, createTransport: transport.make, ...opts });
    const hub = new RealtimeHub();
    const worker = new JobWorker({ meta, registry, hub, workerId: 'email-attach:1', backoffBaseMs: 1 });
    return { worker, hub };
  }

  const VARS = {
    appName: 'Adminium',
    name: 'Ava',
    email: 'ava@example.com',
    resetUrl: 'https://admin.test/reset/tok',
    expiresInMinutes: '30',
  };

  it('carries the file id at enqueue and hands the handler the bytes, the mark by cid, and no path or href', async () => {
    const fileId = await attachPdf();
    const job = await enqueueEmail(
      { meta, secret: TEST_SECRET },
      { to: 'ava@example.com', templateKey: PASSWORD_RESET_TEMPLATE_KEY, locale: 'en_US', vars: VARS },
    );
    expect(job).not.toBeNull();
    const payload = job?.payload as { v: number; attachments: unknown[]; inline: unknown[] };
    expect(payload.v).toBe(2);
    expect(payload.attachments).toEqual([{ fileId, filename: 'receipt.pdf' }]);
    expect(payload.inline).toEqual([{ cid: 'mark', kind: 'mark', mark: 'hexagon' }]);
    // The row never holds bytes.
    expect(String((await jobRows(meta))[0]?.payload)).not.toContain(PDF.toString('base64'));

    const transport = recordingTransport();
    const { worker, hub } = runWorker(transport, { storage });
    worker.start();
    try {
      await until(() => transport.sent.length === 1);
    } finally {
      await worker.stop();
      hub.close();
    }
    const msg = transport.sent[0];
    expect(msg?.html).toContain('src="cid:mark"');
    expect(msg?.attachments?.map((a) => ({ filename: a.filename, cid: a.cid, contentType: a.contentType }))).toEqual([
      { filename: 'hexagon.png', cid: 'mark', contentType: 'image/png' },
      { filename: 'receipt.pdf', cid: undefined, contentType: 'application/pdf' },
    ]);
    expect(msg?.attachments?.[1]?.content.equals(PDF)).toBe(true);
    expect(msg?.attachments?.[0]?.content.subarray(0, 4).toString('hex')).toBe('89504e47');
    for (const part of msg?.attachments ?? []) {
      expect(Buffer.isBuffer(part.content)).toBe(true);
      expect(part).not.toHaveProperty('path');
      expect(part).not.toHaveProperty('href');
    }
  });

  it('skips a generated token whose var is not a known file id, with one warning', async () => {
    await attachPdf();
    const warnings: string[] = [];
    const job = await enqueueEmail(
      {
        meta,
        secret: TEST_SECRET,
        logger: { info: () => {}, warn: (_obj, msg) => warnings.push(msg ?? '') },
      },
      { to: 'ava@example.com', templateKey: PASSWORD_RESET_TEMPLATE_KEY, locale: 'en_US', vars: { ...VARS, statement_pdf: 'file_NOPE' } },
    );
    expect((job?.payload as { attachments: unknown[] }).attachments).toHaveLength(1);
    expect(warnings.filter((w) => w.includes('generated attachment'))).toHaveLength(1);
  });

  it('a trashed file makes the handler throw with the filename (the dead-letter path)', async () => {
    const fileId = await attachPdf();
    await enqueueEmail(
      { meta, secret: TEST_SECRET },
      { to: 'ava@example.com', templateKey: PASSWORD_RESET_TEMPLATE_KEY, locale: 'en_US', vars: VARS },
    );
    await filesRepo(meta).markDeleted(fileId);

    const transport = recordingTransport();
    const { worker, hub } = runWorker(transport, { storage });
    worker.start();
    try {
      const deadline = Date.now() + 10_000;
      while (((await jobRows(meta))[0]?.lastError ?? null) === null) {
        if (Date.now() > deadline) throw new Error('the handler never failed the job');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await worker.stop();
      hub.close();
    }
    const row = (await jobRows(meta))[0];
    expect(row?.lastError).toContain('receipt.pdf');
    expect(row?.lastError).toContain('missing or in the trash');
    expect(transport.sent).toHaveLength(0);
  });
});
