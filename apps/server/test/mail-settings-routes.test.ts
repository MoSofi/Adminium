// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketing mail settings' routes, on every engine's meta store, as the
 * people they are for: the owner (Super Admin), a marketer holding the
 * e-mail screens' grant (`settings.manage`), and a clerk without it.
 *
 *  - every route refuses the clerk;
 *  - the senders are listed with Adminium's DKIM key for each (the SMTP From
 *    first), a public mailbox flagged;
 *  - "Make a key" answers the DNS record and never the private key; only for
 *    a sender's own domain; once, unless the key no longer opens (the
 *    server's secret changed), when it is made again;
 *  - "Check again" asks DNS about a sender of this install only, and says
 *    what a marketing send from it meets;
 *  - the reply address is kept at its full width and carried as the
 *    Reply-To of marketing mail;
 *  - the bounce card's notice addresses: Postmark's credentials in the reply
 *    that makes them and never again; Mailgun's signing key saved and never
 *    read back; nothing secret in any reply or audit entry.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiKeysRepo, auditRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo, type User } from '@adminium/meta';

import { encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { createMarketingMail } from '../src/email/marketing.js';
import { createNoticeEndpoints } from '../src/email/notices/endpoints.js';
import { createDkimKeys, createTxtLookup } from '../src/email/sender/index.js';
import { errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { mailSettingsRoutes } from '../src/routes/mail-settings/index.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'a-mail-settings-test-secret-of-length';
const ORIGIN = 'https://crm.meridian.example';
const MAILGUN_KEY = 'made-up-mailgun-signing-secret-for-tests';

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`marketing mail settings routes [${engine.name}]`, () => {
    let handle: MetaHandle;
    let app: FastifyInstance;
    let owner: User;
    let marketer: User;
    let clerk: User;
    const dns = new Map<string, string[]>();
    const replies: string[] = [];

    /** The routes over a meta store, with `secret` as the server's secret. */
    async function serve(secret: string): Promise<FastifyInstance> {
      const server = Fastify({ logger: false });
      server.setValidatorCompiler(validatorCompiler);
      server.setSerializerCompiler(serializerCompiler);
      server.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
        void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
      });
      server.addHook('onRequest', async (request) => {
        const id = request.headers['x-test-user-id'];
        if (typeof id !== 'string') return;
        const user = await usersRepo(handle.meta).findById(id);
        if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
      });
      server.addHook('onSend', async (_request, _reply, payload) => {
        if (typeof payload === 'string') replies.push(payload);
        return payload;
      });
      await server.register(rbacPlugin, { meta: handle.meta });
      const lookup = createTxtLookup({ cacheMs: 0, resolve: async (name) => (dns.get(name) ?? []).map((record) => [record]) });
      await server.register(async (api) => api.register(mailSettingsRoutes({ meta: handle.meta, secret, reach: { networkFeatures: true, desktop: false, trustProxy: true }, lookup })), { prefix: '/api/v1' });
      await server.ready();
      return server;
    }

    beforeAll(async () => {
      handle = await engine.make();
      const users = usersRepo(handle.meta);
      const roles = rolesRepo(handle.meta);
      owner = await users.create({ email: `owner-${engine.name}@adminium.test`, name: 'Mara Lind', status: 'active' });
      await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
      const role = await roles.create({ slug: 'marketing', name: 'Marketing' });
      await permissionsRepo(handle.meta).grant(role.id, 'system', 'settings.manage', { allowed: true });
      marketer = await users.create({ email: `marketer-${engine.name}@adminium.test`, name: 'Mo Marketer', status: 'active' });
      await roles.assignToUser(marketer.id, role.id);
      clerk = await users.create({ email: `clerk-${engine.name}@adminium.test`, name: 'Tom Clerk', status: 'active' });
      await roles.assignToUser(clerk.id, (await roles.create({ slug: 'clerk', name: 'Clerk' })).id);

      const settings = settingsRepo(handle.meta);
      await settings.set('email.smtp', { host: 'smtp.postmarkapp.com', port: 587, user: 'pm', passEncrypted: encryptSecret('x', emailSecretKey(SECRET)), from: 'Meridian <news@meridian.example>', secure: false }, { updatedBy: null });
      await settings.set('email.senders', [{ name: 'Meridian Sales', address: 'sales@meridian.example' }, { name: 'Gmail', address: 'meridian.news@gmail.com' }], { updatedBy: null });
      app = await serve(SECRET);
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await handle?.destroy();
    });

    const call = (user: User, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, server = app) =>
      server.inject({ method, url: `/api/v1${url}`, headers: { 'x-test-user-id': user.id }, ...(payload === undefined ? {} : { payload: payload as object }) });

    it('refuses every route to a person without the e-mail screens\' grant', async () => {
      const answers = [
        await call(clerk, 'GET', '/email/marketing'),
        await call(clerk, 'POST', '/email/marketing/check', { address: 'news@meridian.example' }),
        await call(clerk, 'POST', '/email/marketing/dkim-keys', { domain: 'meridian.example' }),
        await call(clerk, 'PUT', '/email/marketing/reply-to', { replyTo: 'hello@meridian.example' }),
        await call(clerk, 'GET', '/email/notice-endpoints'),
        await call(clerk, 'POST', '/email/notice-endpoints/postmark'),
        await call(clerk, 'POST', '/email/notice-endpoints/postmark/credentials'),
        await call(clerk, 'PUT', '/email/notice-endpoints/mailgun/secret', { secret: MAILGUN_KEY }),
      ];
      expect(answers.map((answer) => answer.statusCode)).toEqual(Array(answers.length).fill(403));
      expect(await createDkimKeys({ meta: handle.meta, secret: SECRET }).list()).toEqual([]);
      expect(await settingsRepo(handle.meta).get('email.marketingReplyTo')).toBeNull();
    });

    it('lists the senders, the SMTP From first, a public mailbox flagged, and makes a key that answers its DNS record only', async () => {
      const before = await call(marketer, 'GET', '/email/marketing');
      expect(before.statusCode, before.body).toBe(200);
      expect((before.json() as { data: unknown }).data).toEqual({
        postalAddress: null,
        replyTo: null,
        publicOrigin: null,
        // The name the locked footer gives: nothing set here yet (no shop, business or workspace name, no public address).
        businessName: '',
        senders: [
          { address: 'news@meridian.example', name: 'Meridian', implicit: true, domain: 'meridian.example', freeMail: false, key: null },
          { address: 'sales@meridian.example', name: 'Meridian Sales', implicit: false, domain: 'meridian.example', freeMail: false, key: null },
          { address: 'meridian.news@gmail.com', name: 'Gmail', implicit: false, domain: 'gmail.com', freeMail: true, key: null },
        ],
      });

      // Only for a sender's own domain.
      expect((await call(marketer, 'POST', '/email/marketing/dkim-keys', { domain: 'gmail.com' })).statusCode).toBe(422);
      expect((await call(marketer, 'POST', '/email/marketing/dkim-keys', { domain: 'stranger.example' })).statusCode).toBe(422);

      const made = await call(marketer, 'POST', '/email/marketing/dkim-keys', { domain: 'Meridian.Example.' });
      expect(made.statusCode, made.body).toBe(200);
      const key = (made.json() as { data: { key: { domain: string; selector: string; record: { name: string; value: string; text: string }; usable: boolean } } }).data.key;
      expect(key).toMatchObject({ domain: 'meridian.example', selector: 'adminium', usable: true, record: { name: 'adminium._domainkey.meridian.example' } });
      expect(key.record.value).toMatch(/^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]{300,}$/);
      expect(key.record.text).toBe(`adminium._domainkey.meridian.example TXT "${key.record.value}"`);
      // Once: a second press is refused while the key opens.
      expect((await call(marketer, 'POST', '/email/marketing/dkim-keys', { domain: 'meridian.example' })).statusCode).toBe(409);

      const after = (await call(marketer, 'GET', '/email/marketing')).json() as { data: { senders: { key: unknown }[] } };
      expect(after.data.senders.map((sender) => sender.key === null)).toEqual([false, false, true]);
      // Never the private key, in any reply.
      expect(replies.join('\n')).not.toMatch(/PRIVATE KEY|privateKey/);
    });

    it('makes the key again when it no longer opens (the server\'s secret changed)', async () => {
      const other = await serve('another-secret-of-adequate-length-xyz');
      try {
        const listed = (await call(owner, 'GET', '/email/marketing', undefined, other)).json() as { data: { senders: { key: { usable: boolean } | null }[] } };
        expect(listed.data.senders[0]?.key?.usable).toBe(false);
        const again = await call(owner, 'POST', '/email/marketing/dkim-keys', { domain: 'meridian.example' }, other);
        expect(again.statusCode, again.body).toBe(200);
        expect((again.json() as { data: { key: { usable: boolean } } }).data.key.usable).toBe(true);
        expect((await createDkimKeys({ meta: handle.meta, secret: 'another-secret-of-adequate-length-xyz' }).list()).length).toBe(1);
      } finally {
        await other.close();
      }
      // Back under this server's secret, for the tests that follow.
      for (const key of await createDkimKeys({ meta: handle.meta, secret: SECRET }).list()) await createDkimKeys({ meta: handle.meta, secret: SECRET }).remove(key.id);
      expect((await call(owner, 'POST', '/email/marketing/dkim-keys', { domain: 'meridian.example' })).statusCode).toBe(200);
    });

    it('"Check again" asks DNS about the install\'s own senders only, and says what a send from one meets', async () => {
      const check = async (address: string) => {
        const res = await call(marketer, 'POST', '/email/marketing/check', { address });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: unknown }).data;
      };
      expect((await call(marketer, 'POST', '/email/marketing/check', { address: 'someone@stranger.example' })).statusCode).toBe(404);

      expect(await check('Meridian <NEWS@meridian.example>')).toEqual({
        dmarc: { policy: null, recordDomain: null },
        dkim: 'not-found',
        refusals: ['no-postal-address', 'no-dmarc', 'no-public-address'],
      });
      const key = (await createDkimKeys({ meta: handle.meta, secret: SECRET }).forDomain('meridian.example'))!;
      dns.set('_dmarc.meridian.example', ['v=DMARC1; p=quarantine']);
      dns.set(key.record.name, [key.record.value]);
      await settingsRepo(handle.meta).set('email.postalAddress', 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom', { updatedBy: null });
      await settingsRepo(handle.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      expect(await check('sales@meridian.example')).toEqual({ dmarc: { policy: 'quarantine', recordDomain: 'meridian.example' }, dkim: 'found', refusals: [] });
      expect(await check('meridian.news@gmail.com')).toEqual({ dmarc: null, dkim: null, refusals: ['free-mail-from'] });
    });

    it('keeps the reply address at its full width, refuses what is not one address, and carries it as the Reply-To of marketing mail', async () => {
      const wide = `${'r'.repeat(64)}@${'m'.repeat(63)}.${'e'.repeat(63)}.${'x'.repeat(57)}.example`.slice(0, 254);
      expect(wide.length).toBe(254);
      for (const bad of ['two@a.example, three@b.example', 'Name <a@b.example>', 'no-at-sign']) {
        expect((await call(marketer, 'PUT', '/email/marketing/reply-to', { replyTo: bad })).statusCode).toBe(422);
      }
      const saved = await call(marketer, 'PUT', '/email/marketing/reply-to', { replyTo: ` ${wide} ` });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json()).toEqual({ data: { replyTo: wide } });
      expect(await settingsRepo(handle.meta).get('email.marketingReplyTo')).toBe(wide);

      await settingsRepo(handle.meta).set('system.instanceId', 'install-1', { updatedBy: null });
      const marketing = createMarketingMail({ meta: handle.meta, secret: SECRET });
      const carried = await marketing.carry({ to: 'ana@harbour.dev', purpose: 'newsletter', locale: 'en_US' });
      expect(carried.replyTo).toBe(wide);
      expect(carried.headers['List-Unsubscribe']).toContain(`mailto:${wide}?subject=unsubscribe`);
      // A mail's own reply address wins over the setting.
      expect((await marketing.carry({ to: 'ana@harbour.dev', purpose: 'newsletter', locale: 'en_US', replyTo: 'rep@meridian.example' })).replyTo).toBe('rep@meridian.example');

      await call(marketer, 'PUT', '/email/marketing/reply-to', { replyTo: 'hello@meridian.example' });
      const cleared = await call(marketer, 'PUT', '/email/marketing/reply-to', { replyTo: '' });
      expect(cleared.json()).toEqual({ data: { replyTo: null } });
      expect((await marketing.carry({ to: 'ana@harbour.dev', purpose: 'newsletter', locale: 'en_US' })).replyTo).toBeNull();
      const audit = (await auditRepo(handle.meta).list({ limit: 100 })).filter((entry) => entry.action === 'email.marketing-reply-to.update');
      expect(audit.length).toBeGreaterThanOrEqual(3);
    });

    it('gives Postmark\'s made credentials once, keeps Mailgun\'s signing key without ever reading it back, and audits no secret', async () => {
      const listed = await call(marketer, 'GET', '/email/notice-endpoints');
      expect(listed.statusCode, listed.body).toBe(200);
      const before = (listed.json() as { data: { suggested: string; publicOrigin: string; services: { service: string; opened: boolean; secretRow: string }[] } }).data;
      expect(before.suggested).toBe('postmark');
      expect(before.services.map((one) => [one.service, one.opened, one.secretRow])).toEqual([
        ['ses', false, 'topic-arn'],
        ['postmark', false, 'copy-credentials'],
        ['mailgun', false, 'signing-key'],
        ['brevo', false, 'copy-credentials'],
        ['sendgrid', false, 'verification-key'],
        ['other', false, 'copy-credentials'],
      ]);

      const opened = await call(marketer, 'POST', '/email/notice-endpoints/postmark');
      expect(opened.statusCode, opened.body).toBe(200);
      const made = (opened.json() as { data: { endpoint: { address: string; ready: boolean; secretSetAt: number }; credentials: { user: string; pass: string } } }).data;
      expect(made.endpoint.address).toMatch(new RegExp(`^${ORIGIN}/api/v1/email/notices/postmark/[A-Za-z0-9_-]{43}$`));
      expect(made.endpoint.ready).toBe(true);
      expect(made.credentials.user).toBe('adminium-postmark');
      // Pressed again: the same address, and the credentials are not read back.
      const again = (await call(marketer, 'POST', '/email/notice-endpoints/postmark')).json() as { data: { endpoint: { address: string }; credentials: unknown } };
      expect(again.data).toEqual({ endpoint: expect.objectContaining({ address: made.endpoint.address }), credentials: null });
      const fresh = (await call(marketer, 'POST', '/email/notice-endpoints/postmark/credentials')).json() as { data: { credentials: { pass: string } } };
      expect(fresh.data.credentials.pass).not.toBe(made.credentials.pass);
      // Mailgun signs, so it takes no made credentials.
      expect((await call(marketer, 'POST', '/email/notice-endpoints/mailgun/credentials')).statusCode).toBe(422);

      // Mailgun: saved, set on, never read back.
      expect((await call(marketer, 'PUT', '/email/notice-endpoints/mailgun/secret', { secret: 'has spaces in it' })).statusCode).toBe(422);
      const saved = await call(marketer, 'PUT', '/email/notice-endpoints/mailgun/secret', { secret: MAILGUN_KEY });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((saved.json() as { data: { endpoint: { opened: boolean; ready: boolean; secretSetAt: number | null } } }).data.endpoint).toMatchObject({ opened: true, ready: true, secretSetAt: expect.any(Number) });
      // SendGrid's key must be one; SES takes a topic; Postmark takes nothing pasted.
      expect((await call(marketer, 'PUT', '/email/notice-endpoints/sendgrid/secret', { secret: 'not-a-key' })).statusCode).toBe(422);
      expect((await call(marketer, 'PUT', '/email/notice-endpoints/ses/secret', { secret: 'arn:aws:sns:eu-west-1:123456789012:bounces' })).statusCode).toBe(200);
      expect((await call(marketer, 'PUT', '/email/notice-endpoints/postmark/secret', { secret: 'anything' })).statusCode).toBe(422);

      const after = await call(marketer, 'GET', '/email/notice-endpoints');
      const body = after.body;
      expect(body).not.toContain(MAILGUN_KEY);
      expect(body).not.toContain(made.credentials.pass);
      expect(body).not.toContain(fresh.data.credentials.pass);
      // No later reply carries the key, nor a password after the reply that made it.
      const madeAt = replies.findIndex((reply) => reply.includes(fresh.data.credentials.pass));
      expect(replies.slice(madeAt + 1).join('\n')).not.toContain(fresh.data.credentials.pass);
      expect(replies.join('\n')).not.toContain(MAILGUN_KEY);
      const audit = JSON.stringify(await auditRepo(handle.meta).list({ limit: 200 }));
      expect(audit).toContain('email.notice-endpoint.secret');
      expect(audit).not.toContain(MAILGUN_KEY);
      expect(audit).not.toContain(made.credentials.pass);
      expect(audit).not.toContain(fresh.data.credentials.pass);
      expect(audit).not.toMatch(/PRIVATE KEY/);
    });

    it('gives a service a new notice address: the old one stops working, its credentials stay; never to an API key or without the grant', async () => {
      await settingsRepo(handle.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      const opened = await call(marketer, 'POST', '/email/notice-endpoints/other');
      expect(opened.statusCode, opened.body).toBe(200);
      const tokenOf = (address: string) => /\/email\/notices\/other\/([^/?#]+)$/.exec(address)![1]!;
      const before = tokenOf((await call(marketer, 'GET', '/email/notice-endpoints')).json().data.services.find((one: { service: string }) => one.service === 'other').address);
      const endpoints = createNoticeEndpoints({ meta: handle.meta, secret: SECRET });
      expect(await endpoints.configFor('other', before)).not.toBeNull();

      // Without the grant, and through an API key even with it: refused, and the address stands.
      expect((await call(clerk, 'POST', '/email/notice-endpoints/other/address')).statusCode).toBe(403);
      const role = (await rolesRepo(handle.meta).findBySlug('marketing'))!;
      const generated = generateApiKey();
      await apiKeysRepo(handle.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: role.id });
      const keyed = await app.inject({ method: 'POST', url: '/api/v1/email/notice-endpoints/other/address', headers: { authorization: `Bearer ${generated.key}` } });
      expect(keyed.statusCode, keyed.body).toBe(403);
      expect(await endpoints.configFor('other', before)).not.toBeNull();

      const made = await call(marketer, 'POST', '/email/notice-endpoints/other/address');
      expect(made.statusCode, made.body).toBe(200);
      const address = (made.json() as { data: { endpoint: { address: string; opened: boolean } } }).data.endpoint.address;
      const after = tokenOf(address);
      expect(after).not.toBe(before);
      expect(address.startsWith(`${ORIGIN}/api/v1/email/notices/other/`)).toBe(true);
      expect(await endpoints.configFor('other', before)).toBeNull();
      expect(await endpoints.configFor('other', after)).not.toBeNull();
      // The card reads the new one.
      expect(JSON.stringify((await call(marketer, 'GET', '/email/notice-endpoints')).json())).toContain(after);
      // Audited by service, never by address.
      const audit = JSON.stringify(await auditRepo(handle.meta).list({ limit: 200 }));
      expect(audit).toContain('email.notice-endpoint.address');
      expect(audit).not.toContain(after);
      expect(audit).not.toContain(before);
      // A service with no address yet has nothing to replace.
      expect((await call(marketer, 'POST', '/email/notice-endpoints/brevo/address')).statusCode).toBe(404);
    });
  });
}
