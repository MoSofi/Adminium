// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mail door on every engine: the unsubscribe page, its two buttons, the
 * RFC 8058 one-click, the counted click link, the reserved `/m/c/`, and the
 * mail services' notice routes writing to the do-not-email list.
 *
 * The links are the ones a marketing mail really carries: made by the send
 * side's own kit (`createMarketingMail().carry`), so the door reads exactly
 * what the send side's `List-Unsubscribe` header names.
 *
 * Proved here:
 *  - a GET (a link scanner) writes nothing; "Unsubscribe" withdraws the
 *    purpose, "… all … marketing mail" puts the address on the list, a press
 *    twice says "already" and writes nothing more;
 *  - the one-click, form-encoded or multipart, withdraws the purpose;
 *  - a forged or changed token, or another install's, shows "This link
 *    doesn't work" and writes nothing; a link made before the server's
 *    secret was changed (and its keys carried over) still works;
 *  - the page in all eight languages, Arabic right to left, no script, its
 *    own content policy;
 *  - with the public address unset, every route says "not available" (or
 *    503 for a mail service) and writes nothing;
 *  - each mail service's fixture lands on the list; a forged one writes
 *    nothing; SES's handshake fetches once, only from SNS's own host; a
 *    write that fails lets the service's retry through.
 */
import { createHmac, createSign, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emailNoticeEndpointsRepo, emailRunsRepo, emailSendsRepo, emailTemplatesRepo, paymentSettingsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { createConsentService, resealUnderNewSecret, type ConsentService } from '../src/consent/index.js';
import { signClickLink } from '../src/email/click-link.js';
import { mailLinkKeys } from '../src/email/link-keys.js';
import { createMarketingMail } from '../src/email/marketing.js';
import { createNoticeEndpoints } from '../src/email/notices/endpoints.js';
import { snsStringToSign } from '../src/email/notices/ses.js';
import { SENDGRID_SIGNATURE_HEADER, SENDGRID_TIMESTAMP_HEADER } from '../src/email/notices/sendgrid.js';
import { makeUnsubscribeToken } from '../src/email/unsubscribe-token.js';
import { corePlugin, RATE_BUCKETS } from '../src/plugins/core.js';
import { asksOneClick, mailDoorRoutes } from '../src/routes/mail-door/index.js';
import { mailNoticeRoutes } from '../src/routes/mail-door/notices.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { basicHeader, fixture, fixtureText, selfSignedCertificate } from './relay-notice-helpers.js';

const SECRET = 'a-mail-door-test-secret-of-some-length';
const ORIGIN = 'https://news.meridian.example';
const POSTAL = 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR';
const LOCALES = ['en-US', 'de-DE', 'fr-FR', 'cs-CZ', 'da-DK', 'zh-CN', 'zh-TW', 'ar-EG'] as const;
const LOCALE_DIR = fileURLToPath(new URL('../../../packages/i18n/locales/', import.meta.url));

/** A locale's own words for the door, from its bundle. */
function wordsOf(tag: string): { unsubscribe: Record<string, string>; unavailable: Record<string, string>; why: string; privacyNotice: string } {
  return JSON.parse(readFileSync(`${LOCALE_DIR}${tag}/mailDoor.json`, 'utf8')) as never;
}

const TOPIC = 'arn:aws:sns:us-west-2:123456789012:MyTopic';
const CERT_URL = 'https://sns.us-west-2.amazonaws.com/SimpleNotificationService-f3ecfb7224c7233fe7bb5f59f96de52f.pem';
const DAY = 86_400_000;
const sns = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERT = selfSignedCertificate({ ...sns, commonName: 'sns.amazonaws.com', notBefore: Date.now() - 30 * DAY, notAfter: Date.now() + 300 * DAY });

function signedSns(message: Record<string, unknown>): Record<string, unknown> {
  const text = snsStringToSign(message);
  if (text === null) throw new Error('not signable');
  return { ...message, Signature: createSign('RSA-SHA1').update(text, 'utf8').sign(sns.privateKey, 'base64') };
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the mail door [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let consent: ConsentService;
    let app: FastifyInstance;
    let snsCalls: string[];

    async function start(over: { secret?: string; consent?: ConsentService; limited?: boolean } = {}): Promise<void> {
      await app?.close();
      app = Fastify({ logger: false });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      // The server's own rate limits, as the composed server registers them first.
      if (over.limited === true) await app.register(corePlugin, { env: makeEnv() });
      const secret = over.secret ?? SECRET;
      const reach = { networkFeatures: true, desktop: false, trustProxy: false };
      const used = over.consent ?? createConsentService({ meta, secret });
      await app.register(mailDoorRoutes({ meta, secret, consent: used, ...reach }));
      await app.register(
        async (api) => {
          await api.register(
            mailNoticeRoutes({
              meta,
              secret,
              consent: used,
              ...reach,
              snsFetch: async (url) => {
                snsCalls.push(url);
                if (url === CERT_URL) return Buffer.from(CERT, 'utf8');
                if (url.startsWith('https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription')) return Buffer.from('<ConfirmSubscriptionResponse/>');
                throw new Error(`unexpected fetch ${url}`);
              },
            }),
          );
        },
        { prefix: '/api/v1' },
      );
      await app.ready();
    }

    /** The link a marketing mail to `to` carries, as the send side makes it. */
    async function linkFor(to: string, purpose: 'newsletter' | 'surveys' | null, extra: { send?: string; locale?: string } = {}): Promise<string> {
      const kit = createMarketingMail({ meta, secret: SECRET, postalAddress: async () => POSTAL });
      const carry = await kit.carry({ to, purpose, locale: extra.locale ?? 'en_US', ...(extra.send === undefined ? {} : { send: extra.send }) });
      const header = carry.headers['List-Unsubscribe'] ?? '';
      const url = /^<([^>]+)>/.exec(header)![1]!;
      expect(url.startsWith(`${ORIGIN}/m/u/`)).toBe(true);
      return new URL(url).pathname;
    }

    /** A campaign send (ledger row) to `to`, handed over: its state is `sent`. */
    async function sentRow(to: string): Promise<string> {
      const doc = await emailTemplatesRepo(meta).create({ kind: 'campaign', key: `spring-${String(Math.random()).slice(2, 8)}`, locale: 'en_US', name: 'Spring news', subject: 'Hello', blocks: [{ id: 'b1', block: 'email.text', data: { paras: ['Hi'] } }] }, 1_000);
      const run = await emailRunsRepo(meta).create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 1 }, 1);
      await emailRunsRepo(meta).freeze(run.id, { name: 'Spring news', templateKey: doc.key, variants: [{ templateId: doc.id, locale: 'en_US', name: doc.name, subject: doc.subject, preheader: '', blocks: doc.blocks, footer: '', brand: null, attachments: [] }] }, 2);
      const sends = emailSendsRepo(meta);
      await sends.write(run.id, [{ address: to, name: 'Marta', connectionId: null, personTable: null, personKey: null }], 0, 3);
      const [row] = await sends.claim(run.id, 1, 'tok-1', 4);
      expect(await sends.markHanded(row!.id, 'tok-1', 'job_1', 5)).toBe(true);
      return row!.id;
    }

    const standing = async (address: string, purpose: 'newsletter' | 'surveys' = 'newsletter') => (await consent.stateFor({ address }, purpose)).state;
    const history = async (address: string) => consent.history({ address });

    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
      snsCalls = [];
      await settingsRepo(meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await settingsRepo(meta).set('system.instanceId', 'install-1', { updatedBy: null });
      await settingsRepo(meta).set('branding.appName', 'Meridian', { updatedBy: null });
      consent = createConsentService({ meta, secret: SECRET });
      await start();
    });

    afterEach(async () => {
      await app.close();
      await handle.destroy();
    });

    describe('the unsubscribe page', () => {
      it('a GET draws two buttons and changes nothing, with no script and a policy that allows none', async () => {
        const send = await sentRow('marta@cobaltlegal.example');
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter', { send });
        for (const method of ['GET', 'HEAD', 'GET'] as const) {
          const page = await app.inject({ method, url: path });
          expect(page.statusCode).toBe(200);
          expect(page.headers['cache-control']).toBe('no-store');
          expect(page.headers['referrer-policy']).toBe('no-referrer');
          const policy = String(page.headers['content-security-policy']);
          expect(policy).toContain("default-src 'none'");
          expect(policy).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
          expect(policy).toContain("form-action 'self'");
          expect(policy).toContain("frame-ancestors 'none'");
          expect(policy).not.toContain('script-src');
        }
        const page = await app.inject({ method: 'GET', url: path });
        expect(page.body).not.toMatch(/<script/i);
        expect(page.body).not.toMatch(/adminium/i);
        expect(page.body).toContain('marta@cobaltlegal.example');
        expect(page.body).toContain('Meridian’s newsletter?');
        expect(page.body).toContain('name="act" value="one"');
        expect(page.body).toContain('name="act" value="all"');
        expect(page.body).toContain('Unsubscribe from all Meridian marketing mail');
        expect(page.body).toContain('name="why" value="too-many"');
        expect(page.body).toContain(`action="${path}"`);
        // The style block is exactly the one the policy allows.
        const style = /<style>([\s\S]*?)<\/style>/.exec(page.body)![1]!;
        const { createHash } = await import('node:crypto');
        expect(String(page.headers['content-security-policy'])).toContain(`'sha256-${createHash('sha256').update(style).digest('base64')}'`);
        // Nothing written: no consent row, no entry, the send still "sent".
        expect(await history('marta@cobaltlegal.example')).toEqual([]);
        expect(await consent.stop.count()).toBe(0);
        expect((await emailSendsRepo(meta).findById(send))?.state).toBe('sent');
      });

      it('"Unsubscribe" withdraws the purpose with the reason, marks the send, and a second press says already', async () => {
        const send = await sentRow('marta@cobaltlegal.example');
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter', { send });
        await consent.record({ address: 'marta@cobaltlegal.example', purpose: 'newsletter', state: 'yes', source: 'form', detail: 'Book a showroom visit' });
        const done = await app.inject({ method: 'POST', url: path, ...asForm({ act: 'one', why: 'too-many' }) });
        expect(done.statusCode).toBe(200);
        expect(done.body).toContain('You’re unsubscribed.');
        expect(done.body).toContain('You won’t get Meridian’s newsletter again.');
        expect(done.body).toContain('Mails about your own orders and visits still reach you.');
        expect(await standing('marta@cobaltlegal.example')).toBe('no');
        const [latest] = await history('marta@cobaltlegal.example');
        expect(latest).toMatchObject({ state: 'no', purpose: 'newsletter', source: 'unsubscribe', detail: 'link:too-many', staffId: null });
        // The other purpose is the person's own: untouched. The list too.
        expect(await standing('marta@cobaltlegal.example', 'surveys')).toBe('not-asked');
        expect(await consent.stop.has('marta@cobaltlegal.example')).toBe(false);
        expect((await emailSendsRepo(meta).findById(send))?.state).toBe('unsubscribed');

        const again = await app.inject({ method: 'POST', url: path, ...asForm({ act: 'one' }) });
        expect(again.body).toContain('You’re already unsubscribed.');
        expect(await history('marta@cobaltlegal.example')).toHaveLength(2);
      });

      it('"… all … marketing mail" puts the address on the list, names the campaign, and withdraws the purpose too', async () => {
        const send = await sentRow('ben@okafor.example');
        const path = await linkFor('ben@okafor.example', 'surveys', { send });
        const done = await app.inject({ method: 'POST', url: path, ...asForm({ act: 'all', why: 'never-signed-up' }) });
        expect(done.body).toContain('You won’t get Meridian’s marketing mail again.');
        const entry = await consent.stop.entryFor('ben@okafor.example');
        expect(entry).toMatchObject({ address: 'ben@okafor.example', reason: 'link', origin: 'Spring news', addedBy: null });
        expect((await history('ben@okafor.example'))[0]).toMatchObject({ state: 'no', purpose: 'surveys', source: 'unsubscribe', detail: 'link-all:never-signed-up' });
        expect((await emailSendsRepo(meta).findById(send))?.state).toBe('unsubscribed');
        // Once on the list, the page itself says so, and a press writes nothing more.
        expect((await app.inject({ method: 'GET', url: path })).body).toContain('You’re already unsubscribed.');
        expect((await app.inject({ method: 'POST', url: path, ...asForm({ act: 'all' }) })).body).toContain('You’re already unsubscribed.');
        expect(await consent.stop.count()).toBe(1);
        expect(await history('ben@okafor.example')).toHaveLength(1);
      });

      it('a mail on the existing-customers basis has one button, no "Why?", and it puts the address on the list', async () => {
        const path = await linkFor('cy@cobaltlegal.example', null);
        const page = await app.inject({ method: 'GET', url: path });
        expect(page.body).toContain('Unsubscribe <bdi dir="ltr" class="mono addr">cy@cobaltlegal.example</bdi> from all Meridian marketing mail?');
        expect(page.body).not.toContain('value="one"');
        expect(page.body).not.toContain('name="why"');
        const done = await app.inject({ method: 'POST', url: path, ...asForm({ act: 'all' }) });
        expect(done.body).toContain('You won’t get Meridian’s marketing mail again.');
        expect(await consent.stop.entryFor('cy@cobaltlegal.example')).toMatchObject({ reason: 'link', origin: null });
        // No purpose to withdraw: the log has nothing.
        expect(await history('cy@cobaltlegal.example')).toEqual([]);
      });

      it('a post with neither button does nothing and shows the page again', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        const res = await app.inject({ method: 'POST', url: path, ...asForm({ act: 'stay' }) });
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('name="act" value="one"');
        expect(await history('marta@cobaltlegal.example')).toEqual([]);
        expect(await consent.stop.count()).toBe(0);
      });
    });

    describe('the one-click (RFC 8058)', () => {
      it('Gmail’s form-encoded post withdraws the purpose, to the very link the header names', async () => {
        const send = await sentRow('marta@cobaltlegal.example');
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter', { send });
        const res = await app.inject({ method: 'POST', url: path, ...asForm({ 'List-Unsubscribe': 'One-Click' }) });
        expect(res.statusCode).toBe(200);
        expect(await standing('marta@cobaltlegal.example')).toBe('no');
        expect((await history('marta@cobaltlegal.example'))[0]).toMatchObject({ source: 'unsubscribe', detail: 'one-click' });
        expect(await consent.stop.has('marta@cobaltlegal.example')).toBe(false);
        expect((await emailSendsRepo(meta).findById(send))?.state).toBe('unsubscribed');
        // Again: nothing more is written.
        expect((await app.inject({ method: 'POST', url: path, ...asForm({ 'List-Unsubscribe': 'One-Click' }) })).statusCode).toBe(200);
        expect(await history('marta@cobaltlegal.example')).toHaveLength(1);
      });

      it('takes the multipart encoding RFC 8058 suggests, and a mail with no purpose goes on the list', async () => {
        const path = await linkFor('cy@cobaltlegal.example', null);
        const boundary = '----door1234';
        const payload = `--${boundary}\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--${boundary}--\r\n`;
        const res = await app.inject({ method: 'POST', url: path, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
        expect(res.statusCode).toBe(200);
        expect(await consent.stop.entryFor('cy@cobaltlegal.example')).toMatchObject({ reason: 'link' });
        expect((await history('cy@cobaltlegal.example'))).toEqual([]);
      });

      it('reads the marker only where RFC 8058 puts it', () => {
        expect(asksOneClick({ 'List-Unsubscribe': 'One-Click' })).toBe(true);
        expect(asksOneClick('List-Unsubscribe=One-Click\r\n')).toBe(true);
        expect(asksOneClick({ 'List-Unsubscribe': 'one-click' })).toBe(false);
        expect(asksOneClick({ act: 'one' })).toBe(false);
        expect(asksOneClick('x=List-Unsubscribe=One-Click')).toBe(false);
        expect(asksOneClick(undefined)).toBe(false);
      });
    });

    describe('tokens', () => {
      it('a forged, changed or foreign token shows "This link doesn’t work", answers no differently on a post, and writes nothing', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        const token = path.slice('/m/u/'.length);
        const changed = `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`;
        const foreign = makeUnsubscribeToken(await mailLinkKeys(meta, SECRET).unsubscribe(), 'install-2', { address: 'marta@cobaltlegal.example', purpose: 'newsletter' });
        const other = makeUnsubscribeToken(SECRET, 'install-1', { address: 'marta@cobaltlegal.example', purpose: 'newsletter' });
        for (const bad of [changed, foreign, other, 'nonsense', 'x'.repeat(4000)]) {
          for (const method of ['GET', 'POST'] as const) {
            const res = await app.inject({ method, url: `/m/u/${bad}`, ...(method === 'POST' ? asForm({ act: 'all' }) : {}) });
            expect(res.statusCode, `${method} ${bad.slice(0, 12)}`).toBe(404);
            expect(res.body).toContain('This link doesn’t work.');
            expect(res.body).toContain('Write to Meridian and they’ll take you off the list.');
          }
          expect((await app.inject({ method: 'POST', url: `/m/u/${bad}`, ...asForm({ 'List-Unsubscribe': 'One-Click' }) })).statusCode).toBe(404);
        }
        expect(await history('marta@cobaltlegal.example')).toEqual([]);
        expect(await consent.stop.count()).toBe(0);
      });

      it('a link made before the server’s secret changed still works once its keys are carried over', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        const NEW = `${SECRET}-rotated`;
        await resealUnderNewSecret(meta, { from: SECRET, to: NEW });
        consent = createConsentService({ meta, secret: NEW });
        await start({ secret: NEW, consent });
        expect((await app.inject({ method: 'GET', url: path })).body).toContain('name="act" value="one"');
        const done = await app.inject({ method: 'POST', url: path, ...asForm({ act: 'all' }) });
        expect(done.body).toContain('You won’t get Meridian’s marketing mail again.');
        expect(await consent.stop.has('marta@cobaltlegal.example')).toBe(true);
      });

      it('with the keys not carried over, it says "not available" (503) rather than guess, and writes nothing', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        await start({ secret: `${SECRET}-changed-by-hand` });
        const res = await app.inject({ method: 'POST', url: path, ...asForm({ act: 'all' }) });
        expect(res.statusCode).toBe(503);
        expect(res.body).toContain('This page isn’t available.');
        expect(await consent.stop.count()).toBe(0);
      });
    });

    describe('the rate limits', () => {
      it('a flood of made-up links from one address spends that address\'s budget, never a genuine link\'s', async () => {
        await start({ limited: true });
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        // Everybody behind a reverse proxy that is not trusted comes from the proxy's one address.
        const proxy = { remoteAddress: '203.0.113.9' };
        const oneClick = asForm({ 'List-Unsubscribe': 'One-Click' });
        const flood = async (method: 'GET' | 'POST', times: number) => {
          let last = 0;
          for (let i = 0; i < times; i += 1) last = (await app.inject({ method, url: `/m/u/made-up-${String(i)}`, ...(method === 'POST' ? oneClick : {}), ...proxy })).statusCode;
          return last;
        };
        // The page: the junk spends the address's budget to the last request, and the next is refused.
        expect(await flood('GET', RATE_BUCKETS['mail-door-unsubscribe'].max)).toBe(404);
        expect(await flood('GET', 1)).toBe(429);
        // The genuine link from that same address still opens.
        const page = await app.inject({ method: 'GET', url: path, ...proxy });
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain('name="act" value="one"');
        // The one-click: the same.
        expect(await flood('POST', RATE_BUCKETS['mail-door-act'].max)).toBe(404);
        expect(await flood('POST', 1)).toBe(429);
        const done = await app.inject({ method: 'POST', url: path, ...oneClick, ...proxy });
        expect(done.statusCode, done.body).toBe(200);
        expect(await standing('marta@cobaltlegal.example')).toBe('no');
        // A changed link is no genuine one: counted by the address, and refused with the junk.
        const changed = `${path.slice(0, 30)}${path[30] === 'A' ? 'B' : 'A'}${path.slice(31)}`;
        expect((await app.inject({ method: 'POST', url: changed, ...oneClick, ...proxy })).statusCode).toBe(429);
      });
    });

    describe('languages', () => {
      it('draws the page in each of the eight languages, Arabic right to left', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        for (const tag of LOCALES) {
          const res = await app.inject({ method: 'GET', url: `${path}?lang=${tag}` });
          const words = wordsOf(tag);
          expect(res.body, tag).toContain(`<html lang="${tag}" dir="${tag === 'ar-EG' ? 'rtl' : 'ltr'}">`);
          expect(res.body, tag).toContain(`>${words.why}<`);
          expect(res.body, tag).toContain(`value="one" class="primary">${words.unsubscribe['one']!}<`);
          // The address sits in the sentence as one left-to-right run.
          expect(res.body, tag).toContain('<bdi dir="ltr" class="mono addr">marta@cobaltlegal.example</bdi>');
          // The form posts back in the same language.
          expect(res.body, tag).toContain(`action="${path}?lang=${tag}"`);
          expect(res.body, tag).not.toMatch(/<script/i);
          const done = await app.inject({ method: 'GET', url: `/m/c/anything?lang=${tag}` });
          expect(done.body, tag).toContain(words.unavailable['title']!.replaceAll('’', '’'));
        }
      });

      it('opens in the mail’s language, else the browser’s; a pick in the menu wins', async () => {
        const german = await linkFor('marta@cobaltlegal.example', 'newsletter', { locale: 'de_DE' });
        expect((await app.inject({ method: 'GET', url: german, headers: { 'accept-language': 'fr-FR' } })).body).toContain('<html lang="de-DE"');
        expect((await app.inject({ method: 'GET', url: `${german}?lang=da-DK` })).body).toContain('<html lang="da-DK"');
        const plain = makeUnsubscribeToken(await mailLinkKeys(meta, SECRET).unsubscribe(), 'install-1', { address: 'marta@cobaltlegal.example', purpose: 'newsletter' });
        expect((await app.inject({ method: 'GET', url: `/m/u/${plain}`, headers: { 'accept-language': 'zh-TW,zh;q=0.8' } })).body).toContain('<html lang="zh-TW"');
        expect((await app.inject({ method: 'GET', url: `/m/u/${plain}` })).body).toContain('<html lang="en-US"');
        // The menu: eight links, each in its own language, the current one marked.
        const menu = (await app.inject({ method: 'GET', url: german })).body;
        for (const tag of LOCALES) expect(menu).toContain(`href="${german}?lang=${tag}" hreflang="${tag}" lang="${tag}"`);
        expect(menu).toContain('lang="de-DE" dir="ltr" aria-current="true"');
      });
    });

    describe('the door is shut while the outside cannot reach this server', () => {
      it('with no public address, every page says "not available" and nothing is written', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        const send = await sentRow('marta@cobaltlegal.example');
        const click = signClickLink(await mailLinkKeys(meta, SECRET).click(), { target: 'https://meridian.example/autumn', send })!;
        const endpoints = createNoticeEndpoints({ meta, secret: SECRET });
        const opened = (await endpoints.open('other'))!;
        await settingsRepo(meta).unset('system.publicOrigin');
        for (const req of [
          { method: 'GET' as const, url: path },
          { method: 'POST' as const, url: path, ...asForm({ act: 'all' }) },
          { method: 'POST' as const, url: path, ...asForm({ 'List-Unsubscribe': 'One-Click' }) },
          { method: 'GET' as const, url: `/m/l/${click}` },
        ]) {
          const res = await app.inject(req);
          expect(res.statusCode, req.url).toBe(404);
          expect(res.body).toContain('This page isn’t available.');
          expect(res.headers['location']).toBeUndefined();
        }
        const notice = await app.inject({ method: 'POST', url: `/api/v1/email/notices/other/${opened.token}`, headers: { 'content-type': 'application/json' }, payload: fixtureText('other-events.json') });
        expect(notice.statusCode).toBe(503);
        expect(await history('marta@cobaltlegal.example')).toEqual([]);
        expect(await consent.stop.count()).toBe(0);
        expect((await emailSendsRepo(meta).findById(send))?.clicks).toBe(0);
        expect((await emailNoticeEndpointsRepo(meta, { encrypt: (x) => x, decrypt: (x) => x }).byService('other'))?.noticeCount).toBe(0);
      });

      it('behind a reverse proxy with trust off, the page opens, the one-click and both buttons write, and a notice lands', async () => {
        // What every request through a proxy carries; the app does not trust them (`trustProxy: false`).
        const viaProxy = { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https', forwarded: 'for=203.0.113.9;proto=https' };
        const kit = createMarketingMail({ meta, secret: SECRET, reach: { networkFeatures: true, desktop: false, trustProxy: false }, postalAddress: async () => POSTAL, lookup: async () => [] });
        // The send side lets the mail go...
        expect(await kit.refusals('news@meridian.example')).not.toContain('no-public-address');
        const path = await linkFor('ana@reader.example', 'newsletter');
        // ...so its link must work.
        const page = await app.inject({ method: 'GET', url: path, headers: viaProxy });
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain('name="act" value="one"');
        const oneClick = await app.inject({ method: 'POST', url: path, headers: { ...viaProxy, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
        expect(oneClick.statusCode).toBe(200);
        expect(await standing('ana@reader.example')).toBe('no');
        const all = await app.inject({ method: 'POST', url: await linkFor('cy@cobaltlegal.example', null), headers: { ...viaProxy, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'act=all' });
        expect(all.body).toContain('You won’t get Meridian’s marketing mail again.');
        expect(await consent.stop.has('cy@cobaltlegal.example')).toBe(true);
        const other = (await createNoticeEndpoints({ meta, secret: SECRET }).open('other'))!;
        const notice = await app.inject({ method: 'POST', url: `/api/v1/email/notices/other/${other.token}`, headers: { ...viaProxy, 'content-type': 'application/json' }, payload: fixtureText('other-events.json') });
        expect(notice.statusCode).toBe(200);
        expect((await consent.stop.entryFor('bye@example.com'))?.reason).toBe('relay-unsubscribe');
      });

      it('the door is open exactly when the send side lets marketing mail go, whatever the request carries', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        const kit = createMarketingMail({ meta, secret: SECRET, reach: { networkFeatures: true, desktop: false, trustProxy: false }, postalAddress: async () => POSTAL, lookup: async () => [] });
        for (const origin of [ORIGIN, 'http://news.meridian.example', 'https://192.168.1.20', 'https://localhost:4600', 'https://meridian.local', null]) {
          if (origin === null) await settingsRepo(meta).unset('system.publicOrigin');
          else await settingsRepo(meta).set('system.publicOrigin', origin, { updatedBy: null });
          const sends = !(await kit.refusals('news@meridian.example')).includes('no-public-address');
          for (const headers of [{}, { 'x-forwarded-for': '203.0.113.9' }, { 'x-forwarded-proto': 'https' }, { forwarded: 'for=203.0.113.9' }]) {
            const res = await app.inject({ method: 'GET', url: path, headers });
            expect(res.statusCode === 200, `${String(origin)} ${JSON.stringify(headers)}`).toBe(sends);
          }
        }
      });

      it('a plain-http or private address is not reachable either', async () => {
        const path = await linkFor('marta@cobaltlegal.example', 'newsletter');
        for (const origin of ['http://news.meridian.example', 'https://192.168.1.20', 'https://localhost:4600']) {
          await settingsRepo(meta).set('system.publicOrigin', origin, { updatedBy: null });
          expect((await app.inject({ method: 'GET', url: path })).body, origin).toContain('This page isn’t available.');
        }
      });
    });

    describe('click links and the reserved paths', () => {
      it('goes only where the link signs, counts the click once per GET, and refuses anything else', async () => {
        const send = await sentRow('marta@cobaltlegal.example');
        const click = signClickLink(await mailLinkKeys(meta, SECRET).click(), { target: 'https://meridian.example/autumn?x=1', send })!;
        const res = await app.inject({ method: 'GET', url: `/m/l/${click}` });
        expect(res.statusCode).toBe(302);
        expect(res.headers['location']).toBe('https://meridian.example/autumn?x=1');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect((await app.inject({ method: 'HEAD', url: `/m/l/${click}` })).statusCode).toBe(302);
        expect((await emailSendsRepo(meta).findById(send))?.clicks).toBe(1);
        // Signed with anything but this install's click key (the secret itself, the unsubscribe key), or changed: no redirect.
        const unsigned = signClickLink(SECRET, { target: 'https://evil.example/', send })!;
        const wrongKey = signClickLink(await mailLinkKeys(meta, SECRET).unsubscribe(), { target: 'https://evil.example/', send })!;
        for (const bad of [unsigned, wrongKey, `${click.slice(0, -2)}AA`, 'https%3A%2F%2Fevil.example']) {
          const refused = await app.inject({ method: 'GET', url: `/m/l/${bad}` });
          expect(refused.statusCode).toBe(404);
          expect(refused.headers['location']).toBeUndefined();
        }
        expect((await emailSendsRepo(meta).findById(send))?.clicks).toBe(1);
      });

      it('/m/c/ (the sign-up confirm page, later) and anything else under /m/ say "not available"', async () => {
        for (const url of ['/m/c/abc', '/m/c/', '/m/x/y', '/m/']) {
          const res = await app.inject({ method: 'GET', url });
          expect(res.statusCode, url).toBe(404);
          expect(res.body, url).toContain('This page isn’t available.');
          expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
        }
      });

      it('names the business from the pay page when it is set, with its contact address', async () => {
        await settingsRepo(meta).set('branding.appName', 'Adminium', { updatedBy: null });
        await paymentSettingsRepo(meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian Workplace', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });
        const res = await app.inject({ method: 'GET', url: '/m/c/abc' });
        expect(res.body).toContain('<title>Meridian Workplace</title>');
        expect(res.body).toContain('href="mailto:hello@meridian.example"');
        expect(res.body).not.toMatch(/adminium/i);
        const dead = await app.inject({ method: 'GET', url: '/m/u/forged' });
        expect(dead.body).toContain('Write to <a href="mailto:hello@meridian.example"><bdi dir="ltr">hello@meridian.example</bdi></a> and we’ll take you off the list.');
      });

      it('links the privacy notice in the footer once its address is set, and not before', async () => {
        const link = '<a href="https://www.meridian.example/privacy?from=mail&amp;x=1" rel="noopener noreferrer">Privacy notice</a>';
        const url = await linkFor('marta.kovac@cobaltlegal.example', 'newsletter');
        const footer = (body: string) => /<footer class="foot">([\s\S]*?)<\/footer>/.exec(body)?.[1] ?? '';
        const unset = await app.inject({ method: 'GET', url });
        expect(unset.statusCode).toBe(200);
        expect(footer(unset.body)).not.toContain('Privacy notice');
        expect(footer(unset.body)).not.toContain('<a href="https://');

        await settingsRepo(meta).set('privacy.noticeUrl', 'https://www.meridian.example/privacy?from=mail&x=1', { updatedBy: null });
        for (const path of [url, '/m/c/abc', '/m/u/forged']) {
          const res = await app.inject({ method: 'GET', url: path });
          expect(footer(res.body), path).toContain(link);
        }
        // In the page's own language, and the policy still allows no script.
        const german = await app.inject({ method: 'GET', url: `${url}?lang=de-DE` });
        expect(footer(german.body)).toContain(`rel="noopener noreferrer">${wordsOf('de-DE').privacyNotice}</a>`);
        expect(String(german.headers['content-security-policy'])).toContain("default-src 'none'");

        await settingsRepo(meta).set('privacy.noticeUrl', null, { updatedBy: null });
        const cleared = await app.inject({ method: 'GET', url });
        expect(footer(cleared.body)).not.toContain('Privacy notice');
      });
    });

    describe('the mail services’ notices', () => {
      const post = (service: string, token: string, payload: string, headers: Record<string, string> = {}) =>
        app.inject({ method: 'POST', url: `/api/v1/email/notices/${service}/${token}`, headers: { 'content-type': 'application/json', ...headers }, payload });

      it('each service’s fixture lands on the list with its reason; soft bounces do not', async () => {
        const endpoints = createNoticeEndpoints({ meta, secret: SECRET });
        const postmark = (await endpoints.open('postmark'))!;
        expect((await post('postmark', postmark.token, fixtureText('postmark-bounce.json'), basicHeader(postmark.basic!.user, postmark.basic!.pass))).statusCode).toBe(200);
        expect((await post('postmark', postmark.token, fixtureText('postmark-soft-bounce.json'), basicHeader(postmark.basic!.user, postmark.basic!.pass))).statusCode).toBe(200);
        expect((await post('postmark', postmark.token, fixtureText('postmark-spam-complaint.json').replace('john@example.com', 'jane@example.com'), basicHeader(postmark.basic!.user, postmark.basic!.pass))).statusCode).toBe(200);

        const brevo = (await endpoints.open('brevo'))!;
        expect((await post('brevo', brevo.token, fixtureText('brevo-batch.json'), basicHeader(brevo.basic!.user, brevo.basic!.pass))).statusCode).toBe(200);

        const mailgun = (await endpoints.open('mailgun'))!;
        const KEY = 'key-3ax6xnjp29jd6fds4gc373sgvjxteol0';
        await endpoints.setSigningKey('mailgun', KEY);
        const body = fixture<{ signature: Record<string, string> }>('mailgun-unsubscribed.json');
        const ts = String(Math.floor(Date.now() / 1000) - 5);
        body.signature = { timestamp: ts, token: 'mg-token-1', signature: createHmac('sha256', KEY).update(`${ts}mg-token-1`).digest('hex') };
        expect((await post('mailgun', mailgun.token, JSON.stringify(body))).statusCode).toBe(200);

        const sendgrid = (await endpoints.open('sendgrid'))!;
        const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        await endpoints.setVerificationKey('sendgrid', ec.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
        const events = fixtureText('sendgrid-events.json');
        const at = String(Math.floor(Date.now() / 1000) - 5);
        const sg = { [SENDGRID_TIMESTAMP_HEADER]: at, [SENDGRID_SIGNATURE_HEADER]: sign('sha256', Buffer.from(at + events), ec.privateKey).toString('base64') };
        expect((await post('sendgrid', sendgrid.token, events, sg)).statusCode).toBe(200);

        const other = (await endpoints.open('other'))!;
        expect((await post('other', other.token, fixtureText('other-events.json'))).statusCode).toBe(200);

        const reasons = async (address: string) => (await consent.stop.entryFor(address))?.reason ?? null;
        expect(await reasons('john@example.com')).toBe('bounce');
        expect(await reasons('full-mailbox@example.com')).toBeNull();
        expect(await reasons('jane@example.com')).toBe('spam');
        expect(await consent.stop.entryFor('gone@example.com')).toMatchObject({ reason: 'bounce', origin: 'Brevo' });
        expect(await reasons('full@example.com')).toBeNull();
        expect(await reasons('angry@example.com')).toBe('spam');
        expect(await reasons('bye@example.com')).toBe('relay-unsubscribe');
        expect(await reasons('alice@example.com')).toBe('relay-unsubscribe');
        expect(await reasons('hard@example.com')).toBe('bounce');
        expect(await reasons('soft@example.com')).toBeNull();
        expect(await reasons('spam@example.com')).toBe('spam');
        expect(await reasons('group@example.com')).toBe('relay-unsubscribe');
        expect((await endpoints.status('postmark'))?.noticeCount).toBe(3);
        expect((await endpoints.status('sendgrid'))?.noticeCount).toBe(1);
      });

      it('a forged call is refused as its reader says, and nothing is written', async () => {
        const endpoints = createNoticeEndpoints({ meta, secret: SECRET });
        const postmark = (await endpoints.open('postmark'))!;
        expect((await post('postmark', postmark.token, fixtureText('postmark-bounce.json'), basicHeader(postmark.basic!.user, 'guessed'))).statusCode).toBe(401);
        expect((await post('postmark', 'not-the-token-at-all', fixtureText('postmark-bounce.json'), basicHeader(postmark.basic!.user, postmark.basic!.pass))).statusCode).toBe(401);
        expect((await post('mailgun', postmark.token, fixtureText('postmark-bounce.json'))).statusCode).toBe(401);
        expect((await post('nosuch', postmark.token, fixtureText('postmark-bounce.json'))).statusCode).toBe(401);
        const sendgrid = (await endpoints.open('sendgrid'))!;
        const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        await endpoints.setVerificationKey('sendgrid', ec.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
        const events = fixtureText('sendgrid-events.json');
        const at = String(Math.floor(Date.now() / 1000) - 5);
        const signature = sign('sha256', Buffer.from(at + events), ec.privateKey).toString('base64');
        expect((await post('sendgrid', sendgrid.token, events.replace('hard@', 'victim@'), { [SENDGRID_TIMESTAMP_HEADER]: at, [SENDGRID_SIGNATURE_HEADER]: signature })).statusCode).toBe(403);
        expect(await consent.stop.count()).toBe(0);
        expect((await endpoints.status('postmark'))?.noticeCount).toBe(0);
      });

      it('SES: the handshake is fetched once, only from the topic’s own SNS host, then a bounce lands', async () => {
        const endpoints = createNoticeEndpoints({ meta, secret: SECRET });
        const ses = (await endpoints.open('ses'))!;
        await endpoints.setTopicArn('ses', TOPIC);
        const now = new Date(Date.now() - 60_000).toISOString();
        const sesPost = (message: Record<string, unknown>) => post('ses', ses.token, JSON.stringify(message), { 'content-type': 'text/plain; charset=UTF-8', 'x-amz-sns-message-type': String(message['Type']) });

        // A confirmation pointing anywhere but SNS's own host is refused before anything is fetched.
        const elsewhere = signedSns({ ...fixture('sns-subscription-confirmation.json'), Timestamp: now, SubscribeURL: 'https://attacker.example/?Action=ConfirmSubscription' });
        expect((await sesPost(elsewhere)).statusCode).toBe(403);
        expect(snsCalls.filter((url) => !url.endsWith('.pem'))).toEqual([]);

        const confirmation = signedSns({ ...fixture('sns-subscription-confirmation.json'), Timestamp: now });
        expect((await sesPost(confirmation)).statusCode).toBe(200);
        expect((await sesPost(confirmation)).statusCode).toBe(200);
        expect(snsCalls.filter((url) => url.includes('Action=ConfirmSubscription'))).toHaveLength(1);
        expect(snsCalls.every((url) => url.startsWith('https://sns.us-west-2.amazonaws.com/'))).toBe(true);
        expect((await endpoints.status('ses'))?.confirmedAt).not.toBeNull();

        const bounce = signedSns({ ...fixture('sns-notification.json'), Message: JSON.stringify(fixture('ses-bounce.json')), Timestamp: now });
        expect((await sesPost(bounce)).statusCode).toBe(200);
        expect(await consent.stop.entryFor('jane@example.com')).toMatchObject({ reason: 'bounce', origin: 'Amazon SES' });
        expect(await consent.stop.has('richard@example.com')).toBe(true);
      });

      it('a write that fails answers 503, and the service’s retry is taken rather than refused as a replay', async () => {
        const endpoints = createNoticeEndpoints({ meta, secret: SECRET });
        const mailgun = (await endpoints.open('mailgun'))!;
        const KEY = 'key-mailgun-retry';
        await endpoints.setSigningKey('mailgun', KEY);
        const body = fixture<{ signature: Record<string, string> }>('mailgun-permanent-fail.json');
        const ts = String(Math.floor(Date.now() / 1000) - 5);
        body.signature = { timestamp: ts, token: 'mg-retry', signature: createHmac('sha256', KEY).update(`${ts}mg-retry`).digest('hex') };
        let fail = true;
        const real = createConsentService({ meta, secret: SECRET });
        const flaky: ConsentService = {
          ...real,
          stop: {
            ...real.stop,
            add: async (input) => {
              if (fail) throw new Error('the meta store went away');
              return real.stop.add(input);
            },
          },
        };
        await start({ consent: flaky });
        expect((await post('mailgun', mailgun.token, JSON.stringify(body))).statusCode).toBe(503);
        expect(await consent.stop.count()).toBe(0);
        fail = false;
        expect((await post('mailgun', mailgun.token, JSON.stringify(body))).statusCode).toBe(200);
        expect(await consent.stop.has('alice@example.com')).toBe(true);
        // Taken now: the same call again is a replay, answered 200 and written once.
        expect((await post('mailgun', mailgun.token, JSON.stringify(body))).statusCode).toBe(200);
        expect(await consent.stop.count()).toBe(1);
      });
    });
  });
}

/** A form-encoded body, as an inject option. */
function asForm(fields: Record<string, string>): { headers: Record<string, string>; payload: string } {
  return { headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() };
}
