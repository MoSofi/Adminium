// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marketing mail on the sending side, on SQLite, PostgreSQL and MySQL: the
 * one verdict every send path asks (the do-not-email list, the consent log,
 * the existing-customers basis, "Replied"), the sender refusals by code, a
 * permanent refusal at send time, and what a marketing mail carries when it
 * reaches a real (loopback) mail server: both list headers, covered by
 * Adminium's DKIM signature, and the locked footer in the reader's language.
 * Then a campaign run marked marketing, through its batches and the mail
 * queue.
 */
import { createHash, createPublicKey, createVerify } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emailRunsRepo,
  emailSendsRepo,
  jobsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { AddressKeysLockedError, createConsentService } from '../src/consent/index.js';
import { encryptSecret } from '../src/config/secrets.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { createMarketingMail, type MarketingMail } from '../src/email/marketing.js';
import { emailEnvelopeKey, enqueueEmail, resetEmailRuntime } from '../src/email/send.js';
import { createDkimKeys, createTxtLookup } from '../src/email/sender/index.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { mailLinkKeys } from '../src/email/link-keys.js';
import { permanentRefusal } from '../src/email/refused.js';
import { readUnsubscribeTokenWith } from '../src/email/unsubscribe-token.js';
import { campaignMarketingChecks } from '../src/jobs/email-campaign-checks.js';
import { registerEmailCampaignRunHandler, withCampaignGiveUp } from '../src/jobs/email-campaign-run.js';
import { PermanentlyRefusedError, registerEmailSendHandler } from '../src/jobs/email-send.js';
import { withMarketingChecks } from '../src/jobs/register.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import type { EmailDocumentDetailView, EmailRunView } from '../src/routes/email-templates/schema.js';
import { TEST_SECRET } from './helpers.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { decodedBody, headersOf, signedHeaders, startSmtpSink, type SmtpSink } from './smtp-sink.js';

const ORIGIN = 'https://crm.meridian.example';
const POSTAL = 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom';

/** A nodemailer-shaped refusal, as the transport throws it. */
function smtpError(responseCode: number, command: string, response: string): Error {
  return Object.assign(new Error(response), { code: 'EENVELOPE', responseCode, command, response });
}

async function drain(worker: JobWorker, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((await worker.runOnce()) > 0) {
    if (Date.now() > deadline) throw new Error('drain(): jobs still due after the deadline');
  }
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`marketing mail on the sending side [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let sink: SmtpSink;
    let dns: Map<string, string[]>;
    let postal: string | null;
    let kit: MarketingMail;
    let dkimRecord: string;

    const lookup = () =>
      createTxtLookup({
        cacheMs: 0,
        resolve: async (name) => {
          if (name.includes('down.')) throw Object.assign(new Error('SERVFAIL'), { code: 'ESERVFAIL' });
          return (dns.get(name) ?? []).map((record) => [record]);
        },
      });

    const smtp = async (host: string, port: number, from = 'Meridian <news@meridian.example>') =>
      settingsRepo(meta).set('email.smtp', { host, port, user: 'postmaster', passEncrypted: encryptSecret('relay-password', emailSecretKey(TEST_SECRET)), from, secure: false }, { updatedBy: null });

    beforeEach(async () => {
      resetEmailRuntime();
      handle = await engine.make();
      meta = handle.meta;
      sink = await startSmtpSink();
      postal = POSTAL;
      await settingsRepo(meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await settingsRepo(meta).set('system.instanceId', 'install-1', { updatedBy: null });
      await settingsRepo(meta).set('branding.appName', 'Meridian', { updatedBy: null });
      await smtp('127.0.0.1', sink.port);
      const key = await createDkimKeys({ meta, secret: TEST_SECRET }).make('meridian.example');
      dkimRecord = key.record.value;
      dns = new Map([
        ['_dmarc.meridian.example', ['v=DMARC1; p=quarantine']],
        [key.record.name, [key.record.value]],
      ]);
      kit = createMarketingMail({ meta, secret: TEST_SECRET, lookup: lookup(), postalAddress: async () => postal });
    });

    afterEach(async () => {
      resetEmailRuntime();
      await sink.close();
      await handle.destroy();
    });

    describe('who a marketing mail skips', () => {
      const person = { connectionId: 'conn_1', table: 'public.contacts', key: '7' };

      it('a stop-listed address is skipped even with a yes; a yes sends on consent; nothing is "not agreed"', async () => {
        await kit.consent.record({ address: 'ana@cobaltlegal.dev', purpose: 'newsletter', source: 'import', state: 'yes' });
        expect(await kit.verdict({ address: 'ana@cobaltlegal.dev', purpose: 'newsletter' })).toEqual({ send: 'consent' });
        await kit.consent.stop.add({ address: 'ANA@cobaltlegal.dev ', reason: 'link' });
        expect(await kit.verdict({ address: 'ana@cobaltlegal.dev', purpose: 'newsletter' })).toEqual({ skip: 'do-not-email' });
        expect(await kit.verdict({ address: 'bo@cobaltlegal.dev', purpose: 'newsletter' })).toEqual({ skip: 'not-agreed' });
        // A yes for the newsletter is no yes for surveys.
        await kit.consent.record({ person, purpose: 'newsletter', source: 'import', state: 'yes' });
        expect(await kit.verdict({ address: 'cy@cobaltlegal.dev', person, purpose: 'newsletter' })).toEqual({ send: 'consent' });
        expect(await kit.verdict({ address: 'cy@cobaltlegal.dev', person, purpose: 'surveys' })).toEqual({ skip: 'not-agreed' });
      });

      it('the existing-customers basis carries a person who never said no, and nobody who did', async () => {
        expect(await kit.verdict({ address: 'dee@cobaltlegal.dev', purpose: 'newsletter', existingCustomer: true })).toEqual({ send: 'existing-customers' });
        await kit.consent.withdraw({ address: 'dee@cobaltlegal.dev', purpose: 'newsletter', source: 'unsubscribe' });
        expect(await kit.verdict({ address: 'dee@cobaltlegal.dev', purpose: 'newsletter', existingCustomer: true })).toEqual({ skip: 'not-agreed' });
      });

      it('"Replied" after the run began stops a sequence step; one before it does not', async () => {
        await kit.consent.record({ person, purpose: 'newsletter', source: 'import', state: 'yes' });
        await kit.consent.markReplied({ person, staff: { id: 'usr_1', label: 'Dana' }, at: 5_000 });
        expect(await kit.verdict({ address: 'cy@cobaltlegal.dev', person, purpose: 'newsletter', repliedSince: 4_000 })).toEqual({ skip: 'replied' });
        expect(await kit.verdict({ address: 'cy@cobaltlegal.dev', person, purpose: 'newsletter', repliedSince: 6_000 })).toEqual({ send: 'consent' });
      });

      it('fails closed: with the list’s keys unreadable, the verdict throws rather than say "not stopped"', async () => {
        await kit.consent.stop.add({ address: 'ana@cobaltlegal.dev', reason: 'link' });
        const other = createMarketingMail({ meta, secret: `${TEST_SECRET}-changed`, lookup: lookup(), postalAddress: async () => postal });
        await expect(other.verdict({ address: 'ana@cobaltlegal.dev', purpose: 'newsletter' })).rejects.toBeInstanceOf(AddressKeysLockedError);
      });
    });

    describe('the sender refusals', () => {
      it('none when the sender is ready', async () => {
        expect(await kit.refusal('Meridian <news@meridian.example>')).toBeNull();
      });

      it('refuses by code: postal address, free mail, DNS, DMARC, alignment, public address', async () => {
        postal = null;
        expect(await kit.refusal('news@meridian.example')).toBe('no-postal-address');
        postal = POSTAL;
        expect(await kit.refusal('Meridian <meridian.news@gmail.com>')).toBe('free-mail-from');
        expect(await kit.refusal('news@down.meridian.example')).toBe('dns-unchecked');
        dns.delete('_dmarc.meridian.example');
        expect(await kit.refusal('news@meridian.example')).toBe('no-dmarc');
        dns.set('_dmarc.meridian.example', ['v=DMARC1; p=reject']);
        dns.delete('adminium._domainkey.meridian.example');
        expect(await kit.refusal('news@meridian.example')).toBe('not-aligned');
        dns.set('adminium._domainkey.meridian.example', [dkimRecord]);
        await settingsRepo(meta).set('system.publicOrigin', null, { updatedBy: null });
        expect(await kit.refusal('news@meridian.example')).toBe('no-public-address');
        await settingsRepo(meta).set('system.publicOrigin', 'http://192.168.1.20:4600', { updatedBy: null });
        expect(await kit.refusal('news@meridian.example')).toBe('no-public-address');
      });
    });

    describe('a refusal at send time', () => {
      it('a permanent 5xx to the recipient from a direct relay stop-lists the address; a 4xx, a refused login or sender, and a relay’s 5xx do not', async () => {
        const at = (address: string) => kit.consent.stop.has(address);
        expect(await kit.bounced({ error: smtpError(451, 'RCPT TO', '451 4.2.0 try later'), smtpHost: 'mx.meridian.example', address: 'a@cobaltlegal.dev' })).toBeNull();
        expect(await kit.bounced({ error: smtpError(535, 'AUTH PLAIN', '535 5.7.8 bad login'), smtpHost: 'mx.meridian.example', address: 'b@cobaltlegal.dev' })).toBeNull();
        expect(await kit.bounced({ error: smtpError(553, 'MAIL FROM', '553 5.7.1 sender refused'), smtpHost: 'mx.meridian.example', address: 'c@cobaltlegal.dev' })).toBeNull();
        expect(await kit.bounced({ error: smtpError(554, 'DATA', '554 5.7.1 message refused'), smtpHost: 'mx.meridian.example', address: 'd@cobaltlegal.dev' })).toBeNull();
        expect(await kit.bounced({ error: smtpError(550, 'RCPT TO', '550 5.1.1 no such user'), smtpHost: 'smtp.postmarkapp.com', address: 'e@cobaltlegal.dev' })).toBeNull();
        expect(await kit.bounced({ error: new Error('550 no such user'), smtpHost: 'mx.meridian.example', address: 'f@cobaltlegal.dev' })).toBeNull();
        for (const one of ['a', 'b', 'c', 'd', 'e', 'f']) expect(await at(`${one}@cobaltlegal.dev`)).toBe(false);

        expect(await kit.bounced({ error: smtpError(550, 'RCPT TO', '550 5.1.1 no such user'), smtpHost: 'mx.meridian.example', address: 'g@cobaltlegal.dev', origin: 'crm' })).toMatchObject({ code: 550 });
        expect(await kit.bounced({ error: smtpError(550, 'DATA', '550 5.1.10 mailbox gone'), smtpHost: 'mx.meridian.example', address: 'h@cobaltlegal.dev' })).toMatchObject({ code: 550 });
        expect(await at('g@cobaltlegal.dev')).toBe(true);
        expect(await at('h@cobaltlegal.dev')).toBe(true);
        expect(await kit.consent.stop.entryFor('g@cobaltlegal.dev')).toMatchObject({ reason: 'bounce', origin: 'crm' });
      });

      it('a relay that refuses to relay, or a policy at RCPT TO, stops nobody; only the mailbox codes do', async () => {
        const mx = 'mx.meridian.example';
        // Not the address: relaying, SPF, DMARC, a blocked sender, a full mailbox, the system, the network, plain "mailbox unavailable".
        const notTheAddress: [number, string, string][] = [
          [554, 'RCPT TO', '554 5.7.1 <i@cobaltlegal.dev>: Relay access denied'],
          [550, 'RCPT TO', '550 5.7.23 SPF validation failed for the sender'],
          [550, 'RCPT TO', '550-5.7.26 Unauthenticated email is not accepted from this domain'],
          [550, 'RCPT TO', '550 5.1.8 <news@meridian.example>: Sender address rejected: Domain not found'],
          [550, 'RCPT TO', '550 5.1.7 Invalid sender mailbox syntax'],
          [552, 'RCPT TO', '552 5.2.2 Mailbox full'],
          [554, 'RCPT TO', '554 5.4.6 Routing loop detected'],
          [550, 'RCPT TO', '550 Requested action not taken: mailbox unavailable'],
          [553, 'RCPT TO', "553 sorry, that domain isn't in my list of allowed rcpthosts (#5.7.1)"],
          [554, 'RCPT TO', '554 no such user'],
          [550, 'DATA', '550 User unknown'],
          [550, 'MAIL FROM', '550 5.1.1 sender unknown'],
        ];
        for (const [code, step, line] of notTheAddress) {
          expect(permanentRefusal(smtpError(code, step, line)), line).toBeNull();
          expect(await kit.bounced({ error: smtpError(code, step, line), smtpHost: mx, address: 'i@cobaltlegal.dev' }), line).toBeNull();
        }
        expect(await kit.consent.stop.has('i@cobaltlegal.dev')).toBe(false);

        // The mailbox: an address status (5.1.x), a disabled mailbox (5.2.1), or an old server's "user unknown" with no code.
        const theAddress: [number, string, string][] = [
          [550, 'RCPT TO', '550-5.1.1 The email account that you tried to reach does not exist.'],
          [550, 'RCPT TO', '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup'],
          [550, 'RCPT TO', '550 5.1.2 Bad destination system address'],
          [550, 'RCPT TO', '550 5.2.1 The email account that you tried to reach is disabled'],
          [550, 'RCPT TO', '550 <j@cobaltlegal.dev>... User unknown'],
          [550, 'RCPT TO', '550 No such user here'],
          [553, 'RCPT TO', '553 sorry, no mailbox here by that name; user does not exist'],
          [551, 'RCPT TO', '551 Recipient address unknown'],
          [554, 'DATA', '554 5.1.1 Recipient address rejected at the end of data'],
        ];
        for (const [code, step, line] of theAddress) expect(permanentRefusal(smtpError(code, step, line)), line).toMatchObject({ code });
        expect(await kit.bounced({ error: smtpError(550, 'RCPT TO', '550 <j@cobaltlegal.dev>... User unknown'), smtpHost: mx, address: 'j@cobaltlegal.dev' })).toMatchObject({ code: 550 });
        expect(await kit.consent.stop.entryFor('j@cobaltlegal.dev')).toMatchObject({ reason: 'bounce' });
      });
    });

    describe('what a marketing mail carries, as it leaves', () => {
      let registry: ReturnType<typeof createJobRegistry>;
      let hub: RealtimeHub;
      let worker: JobWorker;
      let gaveUp: { report: unknown; error: unknown }[];

      const message = { subject: 'Autumn news', preheader: '', blocks: [{ id: 'b1', block: 'email.text', data: { text: 'Hello {{name}}.' } }], footer: '', brand: null, attachments: [] };

      beforeEach(() => {
        gaveUp = [];
        registry = createJobRegistry();
        hub = new RealtimeHub();
        registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, marketing: kit, onGiveUp: async (report, error) => void gaveUp.push({ report, error }) });
        worker = new JobWorker({ meta, registry, hub, workerId: 'marketing-test', backoffBaseMs: 1, concurrency: 1 });
      });
      afterEach(async () => {
        await worker.stop({ drainTimeoutMs: 50 });
        hub.close();
      });

      async function queue(to: string, mailClass: 'marketing' | 'service' | undefined, locale = 'en_US') {
        const carry = mailClass === 'marketing' ? await kit.carry({ to, purpose: 'newsletter', locale, replyTo: 'hello@meridian.example' }) : undefined;
        const job = await enqueueEmail(
          { meta, secret: TEST_SECRET },
          {
            to,
            templateKey: 'autumn-news',
            locale,
            vars: { name: 'Ana' },
            template: message,
            replyTo: 'hello@meridian.example',
            report: { app: 'crm', connectionId: 'conn_1', table: 'public.messages', pk: { id: 1 } },
            ...(mailClass === undefined ? {} : { mailClass }),
            ...(carry === undefined ? {} : { marketing: carry }),
          },
        );
        expect(job).not.toBeNull();
        return job!;
      }

      it('both list headers, covered by Adminium’s DKIM signature, and the locked footer in the reader’s language', async () => {
        const job = await queue('ana@cobaltlegal.dev', 'marketing', 'de_DE');
        expect(job.payload['v']).toBe(4);
        await drain(worker);
        expect(sink.messages).toHaveLength(1);
        const raw = sink.messages[0]!.raw;
        const headers = headersOf(raw);
        const list = headers.get('list-unsubscribe') ?? '';
        expect(list).toMatch(/^<https:\/\/crm\.meridian\.example\/m\/u\/[A-Za-z0-9_-]+~[A-Za-z0-9_-]{43}>, <mailto:hello@meridian\.example\?subject=unsubscribe>$/);
        expect(headers.get('list-unsubscribe-post')).toBe('List-Unsubscribe=One-Click');
        // The token reads back as this address and the newsletter, on this install only.
        const token = /\/m\/u\/([^>]+)>/.exec(list)![1]!;
        const linkKeys = await mailLinkKeys(meta, TEST_SECRET).unsubscribeAll();
        expect(readUnsubscribeTokenWith(linkKeys, 'install-1', token)).toEqual({ address: 'ana@cobaltlegal.dev', purpose: 'newsletter', send: null, language: 'de_DE' });
        expect(readUnsubscribeTokenWith(linkKeys, 'install-2', token)).toBeNull();
        expect(raw).not.toContain('ana%40cobaltlegal');

        const signed = signedHeaders(raw);
        expect(signed).toEqual(expect.arrayContaining(['from', 'subject', 'list-unsubscribe', 'list-unsubscribe-post']));
        expect(signed).not.toContain('message-id');
        expect(signed).not.toContain('date');
        const signature = headersOf(raw).get('dkim-signature') ?? '';
        expect(signature.replace(/\s+/g, '')).toMatch(/(^|;)d=meridian\.example;/);
        expect(signature.replace(/\s+/g, '')).toMatch(/(^|;)s=adminium;/);
        // The signature holds against the published key.
        expect(dkimVerifies(raw, dkimRecord)).toBe(true);

        const body = decodedBody(raw);
        expect(body).toContain(POSTAL);
        expect(body).toContain('Newsletter von Meridian abbestellen');
        expect(body).toContain(`${ORIGIN}/m/u/${token}`);
      });

      it('a service mail carries none of it', async () => {
        await queue('bo@cobaltlegal.dev', 'service');
        await drain(worker);
        const raw = sink.messages[0]!.raw;
        expect(headersOf(raw).has('list-unsubscribe')).toBe(false);
        expect(headersOf(raw).has('list-unsubscribe-post')).toBe(false);
        expect(headersOf(raw).has('dkim-signature')).toBe(false);
        expect(decodedBody(raw)).not.toContain(POSTAL);
        expect(decodedBody(raw)).not.toContain('Unsubscribe');
      });

      it('a marketing mail through a named relay switches its tracking off', async () => {
        const sent: OutboundEmail[] = [];
        const recorder: EmailTransport = { send: async (msg) => void sent.push(msg) };
        const relayed = createJobRegistry();
        registerEmailSendHandler(relayed, { meta, secret: TEST_SECRET, marketing: kit, createTransport: () => recorder });
        const relayWorker = new JobWorker({ meta, registry: relayed, hub, workerId: 'relay-test', backoffBaseMs: 1, concurrency: 1 });
        await smtp('smtp.mailgun.org', 587);
        await queue('ana@cobaltlegal.dev', 'marketing');
        await queue('bo@cobaltlegal.dev', 'service');
        await drain(relayWorker);
        await relayWorker.stop({ drainTimeoutMs: 50 });
        const marketing = sent.find((one) => one.to === 'ana@cobaltlegal.dev')!;
        expect(marketing.headers).toMatchObject({ 'X-Mailgun-Track': 'no', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
        expect(marketing.dkim?.domainName).toBe('meridian.example');
        const service = sent.find((one) => one.to === 'bo@cobaltlegal.dev')!;
        expect(service.headers).toBeUndefined();
        expect(service.dkim).toBeUndefined();
      });

      it('a permanent 550 puts the address on the do-not-email list and tells the row at once; a 451 is tried again and does not', async () => {
        sink.refuse.set('gone@cobaltlegal.dev', '550 5.1.1 <gone@cobaltlegal.dev>: Recipient address rejected: User unknown');
        sink.refuse.set('busy@cobaltlegal.dev', '451 4.2.0 <busy@cobaltlegal.dev>: try again later');
        const gone = await queue('gone@cobaltlegal.dev', 'service');
        const busy = await queue('busy@cobaltlegal.dev', 'marketing');
        await worker.runOnce();
        await worker.runOnce();
        expect(await kit.consent.stop.has('gone@cobaltlegal.dev')).toBe(true);
        expect(await kit.consent.stop.entryFor('gone@cobaltlegal.dev')).toMatchObject({ reason: 'bounce', origin: 'crm' });
        expect(await kit.consent.stop.has('busy@cobaltlegal.dev')).toBe(false);
        const jobs = jobsRepo(meta);
        expect((await jobs.findById(gone.id))?.status).toBe('succeeded');
        expect((await jobs.findById(busy.id))?.status).toBe('pending');
        expect(gaveUp).toHaveLength(1);
        expect(gaveUp[0]!.error).toBeInstanceOf(PermanentlyRefusedError);
      });

      it('asks the do-not-email list again right before it hands a marketing mail over: a stopped address gets nothing, a service mail still goes', async () => {
        await queue('late@cobaltlegal.dev', 'marketing');
        await queue('late@cobaltlegal.dev', 'service');
        // Stopped after the mail was queued (an unsubscribe, a bounce notice, an erasure while a batch was out).
        await kit.consent.stop.add({ address: 'late@cobaltlegal.dev', reason: 'link' });
        await drain(worker);
        expect(sink.messages).toHaveLength(1);
        expect(headersOf(sink.messages[0]!.raw).has('list-unsubscribe')).toBe(false);
        // The row it was for is told: not sent, and why (never the address).
        expect(gaveUp).toHaveLength(1);
        expect(String((gaveUp[0]!.error as Error).message)).toBe('Not sent: on the do-not-email list (marketing mail)');
        const done = await meta.db.selectFrom('adminium_jobs').select(['status', 'lastError']).where('kind', '=', 'email.send').execute();
        expect(done.map((job) => job.status)).toEqual(['succeeded', 'succeeded']);
      });

      it('fails closed at delivery: with the list’s keys unreadable, a marketing mail is not handed over', async () => {
        await kit.consent.stop.add({ address: 'ana@cobaltlegal.dev', reason: 'link' });
        const locked = createJobRegistry();
        const other = createMarketingMail({ meta, secret: `${TEST_SECRET}-changed`, lookup: lookup(), postalAddress: async () => postal });
        registerEmailSendHandler(locked, { meta, secret: TEST_SECRET, marketing: other });
        const lockedWorker = new JobWorker({ meta, registry: locked, hub, workerId: 'locked-test', backoffBaseMs: 1, concurrency: 1 });
        const job = await queue('bo@cobaltlegal.dev', 'marketing');
        await lockedWorker.runOnce();
        await lockedWorker.stop({ drainTimeoutMs: 50 });
        expect(sink.messages).toHaveLength(0);
        expect((await jobsRepo(meta).findById(job.id))?.status).not.toBe('succeeded');
      });

      it('never hands over a marketing mail to a value that is not one plain address', async () => {
        // Queued by the mail layer: refused there.
        for (const to of ['<ana@cobaltlegal.dev>', 'Ana <ana@cobaltlegal.dev>', 'ana@cobaltlegal.dev, bo@cobaltlegal.dev']) {
          const carry = await kit.carry({ to: 'ana@cobaltlegal.dev', purpose: 'newsletter', locale: 'en_US' });
          expect(await enqueueEmail({ meta, secret: TEST_SECRET }, { to, templateKey: 'autumn-news', locale: 'en_US', vars: {}, template: message, mailClass: 'marketing', marketing: carry }), to).toBeNull();
        }
        // One sealed by hand (an older queue): refused at delivery, the row told.
        const envelope = { to: '<ana@cobaltlegal.dev>', subject: 'x', html: '<p>x</p>', text: 'x', mailClass: 'marketing' };
        await jobsRepo(meta).enqueue({
          kind: 'email.send',
          payload: { v: 4, templateKey: 'autumn-news', locale: 'en_US', envelope: encryptSecret(JSON.stringify(envelope), emailEnvelopeKey(TEST_SECRET)), report: { app: 'crm', connectionId: 'conn_1', table: 'public.messages', pk: { id: 2 } } },
        });
        await drain(worker);
        expect(sink.messages).toHaveLength(0);
        expect(String((gaveUp[0]!.error as Error).message)).toBe('Not sent: the recipient is not one plain e-mail address');
      });

      it('mail to staff (no class) refused for good stop-lists nobody', async () => {
        sink.refuse.set('dana@meridian.example', '550 5.1.1 User unknown');
        await queue('dana@meridian.example', undefined);
        await worker.runOnce();
        expect(await kit.consent.stop.has('dana@meridian.example')).toBe(false);
      });
    });

    describe('a campaign run marked marketing', () => {
      let app: BareApp;
      let registry: ReturnType<typeof createJobRegistry>;
      let hub: RealtimeHub;
      let worker: JobWorker;
      let manager: User;

      beforeEach(async () => {
        await seedBuiltinEmailTemplates(meta, 1_000);
        const users = usersRepo(meta);
        manager = await users.create({ email: 'ava@meridian.example', name: 'Ava Reyes', status: 'active' });
        await rolesRepo(meta).assignToUser(manager.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
        for (const [email, name] of [
          ['stopped@cobaltlegal.dev', 'Stopped'],
          ['agreed@cobaltlegal.dev', 'Agreed'],
          ['silent@cobaltlegal.dev', 'Silent'],
        ] as const) {
          await users.create({ email, name, status: 'active' });
        }
        await kit.consent.record({ address: 'agreed@cobaltlegal.dev', purpose: 'newsletter', source: 'import', state: 'yes' });
        await kit.consent.record({ address: 'stopped@cobaltlegal.dev', purpose: 'newsletter', source: 'import', state: 'yes' });
        await kit.consent.stop.add({ address: 'stopped@cobaltlegal.dev', reason: 'link' });

        registry = createJobRegistry();
        hub = new RealtimeHub();
        registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, marketing: kit, onGiveUp: withCampaignGiveUp(meta) });
        registerEmailCampaignRunHandler(registry, { meta, secret: TEST_SECRET, hub, seams: withMarketingChecks(campaignMarketingChecks({ meta, marketing: kit, secret: TEST_SECRET }), undefined) });
        worker = new JobWorker({ meta, registry, hub, workerId: 'campaign-marketing', backoffBaseMs: 1, concurrency: 1 });

        app = buildBareApp();
        app.addHook('onRequest', async (request) => {
          (request as unknown as { user: { id: string; name: string } }).user = { id: manager.id, name: manager.name };
        });
        await app.register(rbacPlugin, { meta });
        await app.register(emailTemplatesRoutes({ meta, secret: TEST_SECRET }));
        await app.ready();
      });
      afterEach(async () => {
        await worker.stop({ drainTimeoutMs: 50 });
        hub.close();
        await app.close();
      });

      async function marketingRun(): Promise<string> {
        const made = await app.inject({ method: 'POST', url: '/email-templates', payload: { kind: 'campaign', name: 'Autumn news', starter: 'digest' } });
        expect(made.statusCode, made.body).toBe(201);
        const doc = made.json() as EmailDocumentDetailView;
        const sent = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/send`, payload: { audience: { kind: 'users' } } });
        expect(sent.statusCode, sent.body).toBe(202);
        const run = (sent.json() as { run: EmailRunView }).run;
        await meta.db.updateTable('adminium_email_runs').set({ mailClass: 'marketing', basis: 'consent' }).where('id', '=', run.id).execute();
        return run.id;
      }

      async function stateOf(runId: string, address: string) {
        const rows = await emailSendsRepo(meta).list(runId, { limit: 50 });
        return rows.find((row) => row.address === address);
      }

      it('skips the do-not-email list and those who have not agreed; the rest carry the headers and the footer', async () => {
        const runId = await marketingRun();
        await drain(worker);
        expect(await stateOf(runId, 'stopped@cobaltlegal.dev')).toMatchObject({ state: 'skipped-stop', reason: 'do-not-email' });
        expect(await stateOf(runId, 'silent@cobaltlegal.dev')).toMatchObject({ state: 'skipped-consent', reason: 'not-agreed' });
        expect(await stateOf(runId, 'ava@meridian.example')).toMatchObject({ state: 'skipped-consent', reason: 'not-agreed' });
        const agreed = await stateOf(runId, 'agreed@cobaltlegal.dev');
        expect(agreed).toMatchObject({ state: 'sent' });
        expect(sink.messages.map((one) => one.to)).toEqual([['agreed@cobaltlegal.dev']]);
        const raw = sink.messages[0]!.raw;
        const token = /\/m\/u\/([^>]+)>/.exec(headersOf(raw).get('list-unsubscribe') ?? '')![1]!;
        expect(readUnsubscribeTokenWith(await mailLinkKeys(meta, TEST_SECRET).unsubscribeAll(), 'install-1', token)).toMatchObject({ address: 'agreed@cobaltlegal.dev', purpose: 'newsletter', send: agreed!.id });
        expect(signedHeaders(raw)).toEqual(expect.arrayContaining(['list-unsubscribe', 'list-unsubscribe-post']));
        expect(decodedBody(raw)).toContain(POSTAL);
        expect(decodedBody(raw)).toContain('Unsubscribe from Meridian’s newsletter');
      });

      it('a run whose sender is refused stops before a single message, with the refusal’s code', async () => {
        postal = null;
        const runId = await marketingRun();
        await drain(worker);
        const run = await emailRunsRepo(meta).findById(runId);
        expect(run).toMatchObject({ status: 'failed', state: 'stopped' });
        expect(run!.failures.map((one) => one.error)).toContain('no-postal-address');
        expect(sink.messages).toHaveLength(0);
        expect((await emailSendsRepo(meta).counts(runId)).sent ?? 0).toBe(0);
      });

      it('a permanent 550 for one recipient: their row reads bounced and the address is stop-listed', async () => {
        sink.refuse.set('agreed@cobaltlegal.dev', '550 5.1.1 User unknown');
        const runId = await marketingRun();
        await drain(worker);
        expect(await stateOf(runId, 'agreed@cobaltlegal.dev')).toMatchObject({ state: 'bounced' });
        expect(await kit.consent.stop.has('agreed@cobaltlegal.dev')).toBe(true);
        expect(await emailRunsRepo(meta).findById(runId)).toMatchObject({ sent: 0, failed: 1 });
      });

      it('an address stopped after its row was handed over is skipped at delivery: the row reads skipped-stop, the run counts it', async () => {
        const runId = await marketingRun();
        // The run's batch hands the rows over (one job), then the address is stopped before the mail job runs.
        await worker.runOnce();
        expect(await stateOf(runId, 'agreed@cobaltlegal.dev')).toMatchObject({ state: 'sent' });
        await kit.consent.stop.add({ address: 'agreed@cobaltlegal.dev', reason: 'link' });
        await drain(worker);
        expect(sink.messages).toHaveLength(0);
        expect(await stateOf(runId, 'agreed@cobaltlegal.dev')).toMatchObject({ state: 'skipped-stop', reason: 'do-not-email' });
        expect(await emailRunsRepo(meta).findById(runId)).toMatchObject({ sent: 0, failed: 0, skipped: 4 });
      });

      it('a run to the workspace’s own people (no class) is neither skipped nor carries an unsubscribe', async () => {
        const made = await app.inject({ method: 'POST', url: '/email-templates', payload: { kind: 'campaign', name: 'Team news', starter: 'digest' } });
        const doc = made.json() as EmailDocumentDetailView;
        const sent = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/send`, payload: { audience: { kind: 'users' } } });
        const runId = (sent.json() as { run: EmailRunView }).run.id;
        await drain(worker);
        expect(await emailSendsRepo(meta).counts(runId)).toEqual({ sent: 4 });
        expect(sink.messages).toHaveLength(4);
        for (const one of sink.messages) expect(headersOf(one.raw).has('list-unsubscribe')).toBe(false);
        // A staff member on the do-not-email list still gets the workspace's own mail.
        expect(sink.messages.flatMap((one) => one.to)).toContain('stopped@cobaltlegal.dev');
      });
    });
  });
}

/** Whether a message's DKIM signature verifies against the published record: body hash and signature (relaxed/relaxed, rsa-sha256). */
function dkimVerifies(raw: string, record: string): boolean {
  const split = raw.indexOf('\r\n\r\n');
  const headers: { name: string; line: string }[] = [];
  for (const line of raw.slice(0, split).split('\r\n')) {
    if (/^[ \t]/.test(line) && headers.length > 0) headers[headers.length - 1]!.line += `\r\n${line}`;
    else headers.push({ name: line.slice(0, line.indexOf(':')).trim().toLowerCase(), line });
  }
  const relaxed = (header: { name: string; line: string }) => `${header.name}:${header.line.slice(header.line.indexOf(':') + 1).replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').trim()}`;
  const lines = raw.slice(split + 4).split('\r\n').map((line) => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const body = lines.length === 0 ? '' : `${lines.join('\r\n')}\r\n`;
  const signature = headers.find((h) => h.name === 'dkim-signature')!;
  const value = signature.line.slice(signature.line.indexOf(':') + 1).replace(/\r\n[ \t]*/g, '');
  const tags = new Map(value.split(';').map((part) => [part.slice(0, part.indexOf('=')).trim(), part.slice(part.indexOf('=') + 1).trim().replace(/\s+/g, '')] as [string, string]));
  if (createHash('sha256').update(body).digest('base64') !== tags.get('bh')) return false;
  const used = new Set<{ name: string; line: string }>();
  const signed: string[] = [];
  for (const name of (tags.get('h') ?? '').split(':')) {
    const header = [...headers].reverse().find((h) => h.name === name && !used.has(h) && h !== signature);
    if (header === undefined) continue;
    used.add(header);
    signed.push(`${relaxed(header)}\r\n`);
  }
  const data = signed.join('') + relaxed({ name: 'dkim-signature', line: signature.line.replace(/(\bb=)[^;]*$/, '$1') });
  const key = createPublicKey({ key: Buffer.from(/p=([^;]+)/.exec(record)![1]!.trim(), 'base64'), format: 'der', type: 'spki' });
  return createVerify('RSA-SHA256').update(data).verify(key, tags.get('b') ?? '', 'base64');
}
