// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The notice endpoints' encrypted store, on every engine: an endpoint opened
 * per service with its token (and, for Postmark and Brevo, the credentials
 * Adminium made); each service's key or topic saved and checked; a call's
 * token leading to what its reader needs; no secret ever in the clear in the
 * row; and a secret kept under another `ADMINIUM_SECRET` read as "not set".
 * Then a call end to end: the store, the reader, the count.
 */
import { createHmac, generateKeyPairSync } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createNoticeEndpoints, NoticeEndpointError } from '../src/email/notices/endpoints.js';
import { createNoticeReader } from '../src/email/notices/index.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { basicHeader, fixture, fixtureText, requestOf } from './relay-notice-helpers.js';

const SECRET = 'a-test-secret-of-adequate-length-0123456789';
const T0 = Date.parse('2026-10-26T10:00:00.000Z');

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`notice endpoints [${engine.name}]`, () => {
    let handle: MetaHandle;
    beforeAll(async () => {
      handle = await engine.make();
    });
    afterAll(async () => {
      await handle.destroy();
    });
    const store = (secret = SECRET) => createNoticeEndpoints({ meta: handle.meta, secret, now: () => T0 });
    const dump = async () => JSON.stringify(await handle.meta.db.selectFrom('adminium_email_notice_endpoints').selectAll().execute());

    it('opens Postmark with a token and made credentials, shown once, never in the clear in the row', async () => {
      const opened = await store().open('postmark', { createdBy: null });
      expect(opened).not.toBeNull();
      const { token, basic, status } = opened!;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(basic).toMatchObject({ user: 'adminium-postmark' });
      expect(basic!.pass.length).toBeGreaterThanOrEqual(32);
      expect(status).toEqual({ service: 'postmark', secretRow: 'copy-credentials', ready: true, secretSetAt: T0, topicArn: null, confirmedAt: null, lastNoticeAt: null, noticeCount: 0 });

      const raw = await dump();
      expect(raw).not.toContain(token);
      expect(raw).not.toContain(basic!.pass);
      expect(await store().credentialsOf('postmark')).toEqual(basic);
      expect(await store().addressOf('postmark', 'https://crm.meridian.example')).toBe(`https://crm.meridian.example/api/v1/email/notices/postmark/${token}`);
      // One per service.
      expect(await store().open('postmark')).toBeNull();

      // A new address and new credentials: the old ones stop.
      const next = await store().replaceToken('postmark');
      expect(await store().configFor('postmark', token)).toBeNull();
      expect(await store().configFor('postmark', next)).toMatchObject({ service: 'postmark', basic });
      const fresh = await store().replaceCredentials('postmark');
      expect(fresh.pass).not.toBe(basic!.pass);
      expect((await store().configFor('postmark', next))?.basic).toEqual(fresh);
    });

    it('keeps Mailgun’s signing key encrypted, and refuses what is not one', async () => {
      const opened = (await store().open('mailgun'))!;
      expect(opened.basic).toBeNull();
      expect(opened.status).toMatchObject({ secretRow: 'signing-key', ready: false, secretSetAt: null });
      await expect(store().setSigningKey('mailgun', '  ')).rejects.toMatchObject({ code: 'invalid-signing-key' });
      await expect(store().setSigningKey('mailgun', 'two words')).rejects.toMatchObject({ code: 'invalid-signing-key' });
      await expect(store().setSigningKey('postmark', 'key-x')).rejects.toMatchObject({ code: 'wrong-service' });
      await store().setSigningKey('mailgun', ' key-3ax6xnjp29jd6fds4gc373sgvjxteol0 ');
      expect(await store().status('mailgun')).toMatchObject({ ready: true, secretSetAt: T0 });
      expect(await dump()).not.toContain('key-3ax6xnjp29jd6fds4gc373sgvjxteol0');
      expect((await store().configFor('mailgun', opened.token))?.signingKey).toBe('key-3ax6xnjp29jd6fds4gc373sgvjxteol0');
      // A call for another service with this token finds nothing.
      expect(await store().configFor('sendgrid', opened.token)).toBeNull();
      expect(await store().configFor('nonsense', opened.token)).toBeNull();
    });

    it('keeps SendGrid’s public key as it is, and only a P-256 one', async () => {
      const opened = (await store().open('sendgrid'))!;
      const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      await expect(store().setVerificationKey('sendgrid', 'MFkw-not-a-key')).rejects.toMatchObject({ code: 'invalid-verification-key' });
      await store().setVerificationKey('sendgrid', key);
      expect(await store().status('sendgrid')).toMatchObject({ secretRow: 'verification-key', ready: true });
      expect((await store().configFor('sendgrid', opened.token))?.verificationKey).toBe(key);
    });

    it('pins an SNS topic, and records the handshake and the notices', async () => {
      const opened = (await store().open('ses'))!;
      expect(opened.status).toMatchObject({ secretRow: 'topic-arn', ready: false });
      await expect(store().setTopicArn('ses', 'arn:aws:sqs:us-east-1:123456789012:q')).rejects.toBeInstanceOf(NoticeEndpointError);
      await store().setTopicArn('ses', 'arn:aws:sns:eu-west-1:123456789012:ses-bounces');
      const config = (await store().configFor('ses', opened.token))!;
      expect(config).toMatchObject({ topicArn: 'arn:aws:sns:eu-west-1:123456789012:ses-bounces', basic: null });
      await store().confirmed(config.id);
      await store().noticed(config.id);
      await store().noticed(config.id);
      expect(await store().status('ses')).toMatchObject({ ready: true, confirmedAt: T0, lastNoticeAt: T0, noticeCount: 2 });
      expect(await store().remove('ses')).toBe(true);
      expect(await store().status('ses')).toBeNull();
      await expect(store().setTopicArn('ses', 'arn:aws:sns:eu-west-1:123456789012:x')).rejects.toMatchObject({ code: 'no-endpoint' });
    });

    it('reads a secret kept under another ADMINIUM_SECRET as not set, so the card asks again', async () => {
      const opened = (await store().open('brevo'))!;
      const moved = store('another-secret-of-adequate-length-987654321');
      expect(await moved.credentialsOf('brevo')).toBeNull();
      expect(await moved.addressOf('brevo', 'https://x.example')).toBeNull();
      expect(await moved.status('brevo')).toMatchObject({ ready: false });
      // The token is still found by its hash; its reader then says "not set up" (503: Brevo keeps the call).
      expect(await moved.configFor('brevo', opened.token)).toMatchObject({ service: 'brevo', basic: null });
    });

    it('takes a real call end to end: a token finds the endpoint, the reader checks it, the notice is counted', async () => {
      const opened = (await store().open('other', { basic: true }))!;
      expect(opened.basic).toMatchObject({ user: 'adminium-other' });
      const reader = createNoticeReader({ now: () => T0 });
      const config = (await store().configFor('other', opened.token))!;
      const verdict = await reader.read(requestOf(fixtureText('other-events.json'), basicHeader(opened.basic!.user, opened.basic!.pass), opened.token), config);
      expect(verdict.genuine && verdict.events.filter((e) => e.permanent).map((e) => e.address)).toEqual(['gone@example.com', 'angry@example.com', 'bye@example.com']);
      await store().noticed(config.id);
      expect((await store().status('other'))?.noticeCount).toBe(1);

      // Mailgun's key saved earlier proves its own calls.
      const mailgunToken = await tokenOf('mailgun');
      const mailgun = (await store().configFor('mailgun', mailgunToken))!;
      const body = fixture('mailgun-complained.json') as { signature: Record<string, string> };
      const timestamp = String(Math.floor(T0 / 1000));
      body.signature = { timestamp, token: 'tok-1', signature: createHmac('sha256', 'key-3ax6xnjp29jd6fds4gc373sgvjxteol0').update(`${timestamp}tok-1`).digest('hex') };
      expect(await reader.read(requestOf(JSON.stringify(body), {}, mailgunToken), mailgun)).toMatchObject({ genuine: true, events: [{ kind: 'complaint' }] });
    });

    /** The path token of a service's endpoint, read back as the card would. */
    async function tokenOf(service: 'mailgun'): Promise<string> {
      const address = await store().addressOf(service, 'https://x.example');
      return address!.split('/').at(-1)!;
    }
  });
}
