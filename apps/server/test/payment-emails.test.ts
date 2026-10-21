// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay link email and the payment receipt: what they say (the shop's name,
 * never the software's; the amount in Latin digits), who they go to, that the
 * receipt goes once whatever re-runs, and the Payment panel's "Email pay
 * link" route with its refusals. The once-only hook is run on every engine.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_LOCALE_IDS } from '@adminium/i18n';
import {
  createSqliteMetaDb,
  firstRun,
  payableProfilesRepo,
  paymentAttemptsRepo,
  paymentSettingsRepo,
  settingsRepo,
  usersRepo,
  rolesRepo,
  type MetaDb,
  type PayableRef,
  type PaymentAttempt,
  type User,
} from '@adminium/meta';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { builtinEmailTemplates, seedBuiltinEmailTemplates, translatorForLocale } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { errorEnvelope } from '../src/errors.js';
import { dayText, moneyText, queuePaymentReceipt, receiptSentFor, sendPayLinkEmail, shopFace } from '../src/payments/emails.js';
import { PAY_ADDRESS_DOC, linkSealFromSecret, mintLink, payAddressSchema, payUrl } from '../src/payments/links.js';
import { createPayableSources, type PayableSources, type ResolvedPayable } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { LINK_EMAILS_PER_HOUR, paymentLinkEmailRoutes } from '../src/routes/payments/link-email.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, invoicingManifest, invoicingTables, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const PAY = 'https://pay.crumbandco.test';
const REF: PayableRef = { kind: 'profile', connectionId: 'con_1', tableName: 'invoices', rowKey: '42' };

function payable(over: Partial<ResolvedPayable> = {}): ResolvedPayable {
  return {
    ref: REF,
    label: 'INV-0042',
    dueDate: '2026-11-02',
    currency: 'EUR',
    total: '120.00',
    due: '120.00',
    refusal: null,
    manualOnly: false,
    customerEmail: 'lena@example.com',
    customerCountry: 'DE',
    status: null,
    recordInto: { kind: 'kept' },
    ...over,
  };
}

async function configureSmtp(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set(
    'email.smtp',
    { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('relay', emailSecretKey(TEST_SECRET)), from: 'Crumb <no-reply@crumb.test>', secure: false },
    { updatedBy: null },
  );
}

/** The sealed message a queued job carries, opened as the delivery handler opens it. */
async function opened(meta: MetaDb, jobId: string): Promise<{ to: string; subject: string; html: string; text: string; replyTo?: string }> {
  const row = await meta.db.selectFrom('adminium_jobs').selectAll().where('id', '=', jobId).executeTakeFirstOrThrow();
  const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string };
  return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as never;
}

async function jobCount(meta: MetaDb): Promise<number> {
  return (await meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').execute()).length;
}

async function shop(meta: MetaDb): Promise<void> {
  await paymentSettingsRepo(meta).set(PAY_PAGE_DOC, payPageSchema, {
    shopName: 'Crumb & Co.',
    logoFileId: null,
    contactEmail: 'hello@crumbandco.de',
    contactPhone: '+49 30 1234567',
    shopCountry: 'DE',
    showLines: false,
  });
  await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: PAY });
}

async function liveAttempt(meta: MetaDb, over: { mode?: 'test' | 'live'; provider?: string; nonce?: string } = {}): Promise<PaymentAttempt> {
  const attempts = paymentAttemptsRepo(meta);
  const attempt = await attempts.create({
    provider: over.provider ?? 'payments-stripe',
    mode: over.mode ?? 'live',
    accountId: 'acct_1',
    payable: { ...REF, rowKey: over.nonce ?? '42' },
    payableLabel: 'INV-0042',
    amount: '120.00',
    currency: 'EUR',
    linkId: null,
    nonce: `nonce-${over.nonce ?? '42'}-${over.mode ?? 'live'}`,
    createdBy: null,
  });
  await attempts.move(attempt!.id, 'open', { providerRef: `cs_${attempt!.id}` });
  await attempts.move(attempt!.id, 'succeeded', { takenAmount: '120.00', takenCurrency: 'EUR', paymentRef: `pi_${attempt!.id}`, paidWith: { method: 'card', label: 'Visa ·· 4242' } as never, settledAt: Date.UTC(2026, 9, 20) });
  return (await attempts.byId(attempt!.id))!;
}

describe('the payment emails', () => {
  let meta: MetaDb;
  let resolved: ResolvedPayable | null;
  const deps = () => ({ meta, sources: fakeResolving(payable()), secret: TEST_SECRET });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await seedBuiltinEmailTemplates(meta, Date.now());
    await configureSmtp(meta);
    await shop(meta);
    resolved = payable();
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  it('is written in every language, in the shop’s name, never with a provider’s mark in the possessive', async () => {
    for (const locale of BUILTIN_LOCALE_IDS) {
      const { t } = await translatorForLocale(meta, locale);
      const keys = builtinEmailTemplates(t).map((one) => one.key);
      expect(keys).toEqual(expect.arrayContaining(['payment-link', 'payment-receipt']));
      for (const one of builtinEmailTemplates(t).filter((tpl) => tpl.key.startsWith('payment-'))) {
        const text = JSON.stringify(one);
        expect(text, `${one.key} ${locale}`).not.toMatch(/adminium/i);
        expect(text).not.toMatch(/(Stripe|PayPal)['’]s/);
        expect(text).toContain('{{shop}}');
      }
    }
  });

  it('writes amounts and days with Latin digits and the currency’s own decimals', () => {
    expect(moneyText('45.250', 'KWD', 'ar_EG')).toMatch(/45[.,٫]250/);
    expect(moneyText('45.250', 'KWD', 'ar_EG')).not.toMatch(/[٠-٩]/);
    expect(moneyText('12000', 'JPY', 'en_US')).toBe('¥12,000');
    expect(moneyText('120.00', 'EUR', 'de_DE')).toMatch(/^120,00\s€$/u);
    expect(dayText('2026-11-02', 'en_US')).toBe('November 2, 2026');
    expect(dayText('2026-11-02', 'ar_EG')).not.toMatch(/[٠-٩]/);
  });

  it('goes by the pay address when the shop has no name, never by the software’s', async () => {
    await paymentSettingsRepo(meta).remove(PAY_PAGE_DOC);
    await settingsRepo(meta).set('branding.appName', 'Adminium', { updatedBy: null });
    expect((await shopFace(meta)).name).toBe('pay.crumbandco.test');
  });

  it('sends the pay link to the record’s customer, in the shop’s name, with a reply to the shop', async () => {
    const seal = linkSealFromSecret(TEST_SECRET);
    const { link, token } = await mintLink(meta, seal, { payable: REF, mode: 'live', createdBy: null });
    const outcome = await sendPayLinkEmail(deps(), { link, url: payUrl(PAY, token), payable: resolved });
    expect(outcome).toMatchObject({ sent: true, to: 'lena@example.com' });
    const mail = await opened(meta, (outcome as { jobId: string }).jobId);
    expect(mail.to).toBe('lena@example.com');
    expect(mail.subject).toBe('Your pay link for INV-0042 from Crumb & Co.');
    expect(mail.html).toContain(`${PAY}/pay/${token}`);
    expect(mail.text).toContain('€120.00');
    expect(mail.text).toContain('It is due on November 2, 2026.');
    expect(mail.text).toContain('Questions? Write to hello@crumbandco.de · +49 30 1234567.');
    expect(mail.replyTo).toBe('hello@crumbandco.de');
    expect(`${mail.subject}${mail.text}`).not.toMatch(/adminium/i);
  });

  it('sends no pay link with no address to send it to, nothing due, or no mail set up', async () => {
    const seal = linkSealFromSecret(TEST_SECRET);
    const { link, token } = await mintLink(meta, seal, { payable: REF, mode: 'live', createdBy: null });
    const url = payUrl(PAY, token);
    expect(await sendPayLinkEmail(deps(), { link, url, payable: payable({ customerEmail: null }) })).toEqual({ sent: false, reason: 'no-customer-email' });
    expect(await sendPayLinkEmail(deps(), { link, url, payable: payable({ refusal: { code: 'NOTHING_DUE', message: 'paid' } }) })).toEqual({ sent: false, reason: 'not-payable' });
    await settingsRepo(meta).set('email.smtp', null, { updatedBy: null });
    expect(await sendPayLinkEmail(deps(), { link, url, payable: resolved })).toEqual({ sent: false, reason: 'email-off' });
    expect(await jobCount(meta)).toBe(0);
  });

  it('sends the receipt for a live payment once, and says so; never for a test payment', async () => {
    const live = await liveAttempt(meta);
    const one = await queuePaymentReceipt({ ...deps(), sources: fakeResolving(payable({ due: '0.00', refusal: { code: 'NOTHING_DUE', message: 'paid' } })) }, live);
    expect(one).toBe(true);
    expect(await receiptSentFor(meta, live)).toBe(true);
    expect(await queuePaymentReceipt({ ...deps(), sources: fakeResolving(payable()) }, live)).toBe(false);
    expect(await jobCount(meta)).toBe(1);

    const [job] = await meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').execute();
    const mail = await opened(meta, job!.id);
    expect(mail.subject).toBe('Receipt for INV-0042 from Crumb & Co.');
    expect(mail.text).toContain('Paid with: Visa ·· 4242');
    expect(mail.text).toContain('Paid on: October 20, 2026');
    expect(mail.text).not.toContain('still due');

    const test = await liveAttempt(meta, { mode: 'test', nonce: '43' });
    expect(await queuePaymentReceipt({ ...deps(), sources: fakeResolving(payable()) }, test)).toBe(false);
    expect(await receiptSentFor(meta, test)).toBe(false);
  });

  it('says what is still due after a part payment', async () => {
    const attempt = await liveAttempt(meta, { nonce: '44' });
    expect(await queuePaymentReceipt({ ...deps(), sources: fakeResolving(payable({ due: '30.00' })) }, attempt)).toBe(true);
    const [job] = await meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').execute();
    expect((await opened(meta, job!.id)).text).toContain('€30.00 is still due on INV-0042.');
  });
});

/** Sources whose profile resolves to exactly `answer` (the resolver is the real one). */
function fakeResolving(answer: ResolvedPayable): PayableSources {
  return {
    table: async () => ({ table: { id: 'invoices', columns: [] }, target: {} }) as never,
    readRow: async () => ({ id: 42, number: answer.label, total: answer.total, due: answer.due, currency: answer.currency, email: answer.customerEmail, status: answer.refusal === null ? 'open' : 'paid' }),
    shapeOf: async () => null,
    connectionCurrency: async () => answer.currency,
    profile: async () => ({
      id: 'pp_1',
      enabled: true,
      mapping: {
        label: 'number',
        amount: { column: 'total', unit: null },
        currency: { column: 'currency' },
        due: { column: 'due' },
        payments: { kind: 'kept' },
        status: null,
        customerEmail: 'email',
        customerCountry: null,
        pageFields: ['number'],
      } as never,
    }),
    keptPaid: async () => '0',
    document: async () => null,
  };
}

describe('POST /payments/links/:id/email', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let owner: User;
  let mayLink: boolean;
  const asked: PayableRef[] = [];

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await seedBuiltinEmailTemplates(meta, Date.now());
    await configureSmtp(meta);
    await shop(meta);
    mayLink = true;
    asked.length = 0;
    owner = await usersRepo(meta).create({ email: 'mara@crumb.test', name: 'Mara', status: 'active' });
    await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.addHook('onRequest', async (request) => {
      if (request.headers['x-test-user-id'] === owner.id) (request as unknown as { user: object }).user = { id: owner.id, name: owner.name, email: owner.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(
      async (api) =>
        api.register(
          paymentLinkEmailRoutes({
            meta,
            sources: fakeResolving(payable()),
            secret: TEST_SECRET,
            assertMayLink: async (_request, ref) => {
              asked.push(ref);
              if (!mayLink) throw Object.assign(new Error('You may not make a pay link for this record.'), { statusCode: 403, code: 'FORBIDDEN' });
            },
          }),
        ),
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const staff = () => ({ 'x-test-user-id': owner.id });
  const send = (id: string) => app.inject({ method: 'POST', url: `/api/v1/payments/links/${id}/email`, headers: staff() });

  it('queues the email, audits it, and answers who it went to', async () => {
    const { link } = await mintLink(meta, linkSealFromSecret(TEST_SECRET), { payable: REF, mode: 'live', createdBy: owner.id });
    const answer = await send(link.id);
    expect(answer.statusCode, answer.payload).toBe(200);
    expect(answer.json()).toEqual({ data: { queued: true, to: 'lena@example.com' } });
    expect(asked).toEqual([REF]);
    const audit = await meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'payments.link.emailed').execute();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain('lena@example.com');
  });

  it('refuses a test link, a revoked one, an unknown one, a person who may not, and a sixth email in the hour', async () => {
    const seal = linkSealFromSecret(TEST_SECRET);
    const test = await mintLink(meta, seal, { payable: { ...REF, rowKey: '7' }, mode: 'test', createdBy: null });
    expect((await send(test.link.id)).json().error.details).toEqual({ reason: 'test-link' });
    expect((await send('plk_nope')).statusCode).toBe(404);
    const { link } = await mintLink(meta, seal, { payable: REF, mode: 'live', createdBy: null });
    mayLink = false;
    expect((await send(link.id)).statusCode).toBe(403);
    mayLink = true;
    for (let i = 0; i < LINK_EMAILS_PER_HOUR; i += 1) expect((await send(link.id)).statusCode).toBe(200);
    expect((await send(link.id)).statusCode).toBe(429);
    const replaced = await mintLink(meta, seal, { payable: REF, mode: 'live', createdBy: null });
    expect(replaced.replaced).toBe(true);
    expect((await send(link.id)).json().error.details).toEqual({ reason: 'link-gone' });
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/links/${link.id}/email` })).statusCode).toBe(401);
  });
});

// ─── Once only, on every engine ─────────────────────────────────────────────

describe.each(LEGS)('what follows a recording runs once — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let sources: PayableSources;
  let depositsId: string;
  let w: Awaited<ReturnType<typeof writerFor>>;

  beforeAll(async () => {
    if (!available) return;
    const tables = invoicingTables();
    tables.push({
      ref: 'deposits',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'label', type: 'text', maxLength: 40, nullable: true },
        { ref: 'amount', type: 'decimal', scale: 2 },
        { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
        { ref: 'email', type: 'text', maxLength: 120, nullable: true },
      ],
    });
    h = await installInvoicing(dialect, invoicingManifest(tables));
    w = await writerFor(h);
    depositsId = w.targetOf('deposits').table.id;
    sources = createPayableSources({ meta: h.meta, manager: h.manager });
    await payableProfilesRepo(h.meta).create({
      connectionId: h.connectionId,
      tableName: depositsId,
      mapping: {
        label: 'label',
        amount: { column: 'amount', unit: null },
        currency: { column: 'currency' },
        due: null,
        payments: { kind: 'kept' },
        status: null,
        customerEmail: 'email',
        customerCountry: null,
        pageFields: ['label'],
      },
      ownerApp: null,
      createdBy: null,
    });
    await seedBuiltinEmailTemplates(h.meta, Date.now());
    await configureSmtp(h.meta);
    await shop(h.meta);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.runIf(available)('queues one receipt however often the record job runs', async () => {
    const deposit = await w.create('deposits', { label: 'D-9', amount: '45.50', currency: 'EUR', email: 'lena@example.com' });
    const ref: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) };
    const attempts = paymentAttemptsRepo(h.meta);
    const attempt = (await attempts.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct', payable: ref, payableLabel: 'D-9', amount: '45.50', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-once`, createdBy: null }))!;
    await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}` });
    await attempts.move(attempt.id, 'succeeded', { takenAmount: '45.50', takenCurrency: 'EUR', paymentRef: `pi_${dialect}` });
    let told = 0;
    const deps = {
      meta: h.meta,
      sources,
      onRecorded: async (recorded: PaymentAttempt) => {
        told += 1;
        await queuePaymentReceipt({ meta: h.meta, sources, secret: TEST_SECRET }, recorded);
      },
    };
    expect(await recordAttempt(deps, attempt.id)).toMatchObject({ state: 'recorded' });
    expect(await recordAttempt(deps, attempt.id)).toMatchObject({ state: 'recorded', already: true });
    expect(told).toBe(1);
    expect(await receiptSentFor(h.meta, attempt)).toBe(true);
    const jobs = await h.meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').execute();
    expect(jobs).toHaveLength(1);
    expect((await opened(h.meta, jobs[0]!.id)).to).toBe('lena@example.com');
  });
});
