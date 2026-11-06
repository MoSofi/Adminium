// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A mail sender per workspace, on SQLite, PostgreSQL and MySQL.
 *
 * One server runs two businesses: Fernhill Coffee (`fernhill`) and Kiln
 * Street Pottery (`kiln`), each a workspace with a sender of its own, and a
 * `suppliers` database in both. Then:
 *
 *  - mail about a kiln record goes as Kiln Street Pottery, with its postal
 *    address in marketing mail (the automation step, the outbox's way
 *    through the queue, document delivery, the pay link and receipt, a
 *    campaign); mail about a fernhill record as Fernhill Coffee; mail about a
 *    supplier as the first workspace by position;
 *  - a database in no workspace, and mail about no record, go as the
 *    server, as before workspaces;
 *  - a template's "Send as" names the sender whatever the record: a
 *    workspace, or the server;
 *  - a From the server's settings no longer cover goes as the server;
 *  - the do-not-email list stays the server's: someone on it gets no
 *    marketing mail from either business;
 *  - the sender form's routes refuse a From the server cannot send for and
 *    say which domains it can, audit every change and publish it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditRepo,
  connectionsRepo,
  emailSendsRepo,
  emailTemplatesRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  workspacesRepo,
  type Automation,
  type EmailRun,
  type MetaDb,
  type User,
  type Workspace,
} from '@adminium/meta';

import { runEmailAction } from '../src/automations/actions/email.js';
import type { ActionContext } from '../src/automations/actions/types.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailDocument } from '../src/documents/deliver.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { createMarketingMail, type MarketingMail } from '../src/email/marketing.js';
import { configureEmailRuntime, emailEnvelopeKey, enqueueEmail, resetEmailRuntime } from '../src/email/send.js';
import { createDkimKeys, createTxtLookup } from '../src/email/sender/index.js';
import { maySendFrom, resolveMailSender, sendingDomains, SERVER_SENDER } from '../src/email/workspace-sender.js';
import { campaignMarketingChecks } from '../src/jobs/email-campaign-checks.js';
import { registerEmailCampaignRunHandler, withCampaignGiveUp } from '../src/jobs/email-campaign-run.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { withMarketingChecks } from '../src/jobs/register.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { sendConfirmMail } from '../src/forms/mail.js';
import { sendPayLinkEmail } from '../src/payments/emails.js';
import { sendConfirmation } from '../src/public-api/confirm.js';
import type { PayableSources, ResolvedPayable } from '../src/payments/payables.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import type { EmailDocumentDetailView, EmailRunView } from '../src/routes/email-templates/schema.js';
import { workspacesRoutes } from '../src/routes/workspaces/index.js';
import { TEST_SECRET } from './helpers.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { decodedBody, headersOf, startSmtpSink, type SmtpSink } from './smtp-sink.js';

const ORIGIN = 'https://mail.shared-host.example';
const SERVER_POSTAL = 'Shared Host Ltd, 1 Server Row, Leeds LS1 1AA';
const KILN_POSTAL = 'Kiln Street Pottery, 12 Kiln Street, Stoke-on-Trent ST1 1AA';
const COFFEE_POSTAL = 'Fernhill Coffee, 3 Roastery Lane, Bristol BS1 2AB';
const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

async function drain(worker: JobWorker, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((await worker.runOnce()) > 0) {
    if (Date.now() > deadline) throw new Error('drain(): jobs still due after the deadline');
  }
}

/** The sealed message a queued job carries, opened as the delivery handler opens it. */
async function opened(meta: MetaDb, jobId: string): Promise<{ to: string; from?: string; replyTo?: string; html: string }> {
  const row = await meta.db.selectFrom('adminium_jobs').selectAll().where('id', '=', jobId).executeTakeFirstOrThrow();
  const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string };
  return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as never;
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`a mail sender per workspace [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let sink: SmtpSink;
    let kit: MarketingMail;
    let conn: { fernhill: string; kiln: string; suppliers: string; loose: string };
    let coffee: Workspace;
    let kiln: Workspace;

    beforeEach(async () => {
      resetEmailRuntime();
      handle = await engine.make();
      meta = handle.meta;
      sink = await startSmtpSink();
      const settings = settingsRepo(meta);
      await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await settings.set('system.instanceId', 'install-1', { updatedBy: null });
      await settings.set('branding.appName', 'Shared Host', { updatedBy: null });
      // The server sends as Shared Host by its relay; its senders list adds Kiln's studio address and a public mailbox.
      await settings.set(
        'email.smtp',
        { host: '127.0.0.1', port: sink.port, user: 'postmaster', passEncrypted: encryptSecret('relay', emailSecretKey(TEST_SECRET)), from: 'Shared Host <news@shared-host.example>', secure: false },
        { updatedBy: null },
      );
      await settings.set(
        'email.senders',
        [
          { name: 'Kiln studio', address: 'studio@kilnstreet.example' },
          { name: 'Ana', address: 'ana.potter@gmail.com' },
        ],
        { updatedBy: null },
      );
      // Fernhill's domain is one the server signs for (a DKIM key), not one of its senders.
      const keys = createDkimKeys({ meta, secret: TEST_SECRET });
      const dns = new Map<string, string[]>();
      for (const domain of ['shared-host.example', 'kilnstreet.example', 'fernhill.example']) {
        const key = await keys.make(domain);
        dns.set(key.record.name, [key.record.value]);
        dns.set(`_dmarc.${domain}`, ['v=DMARC1; p=quarantine']);
      }
      kit = createMarketingMail({
        meta,
        secret: TEST_SECRET,
        lookup: createTxtLookup({ cacheMs: 0, resolve: async (name) => (dns.get(name) ?? []).map((record) => [record]) }),
        postalAddress: async () => SERVER_POSTAL,
      });
      await seedBuiltinEmailTemplates(meta, 1_000);

      const connections = connectionsRepo(meta, PLAIN);
      const make = async (name: string) => (await connections.create({ name, engine: 'postgres', introspectDsn: `postgres://ro@db.internal:5432/${name}` })).id;
      conn = { fernhill: await make('fernhill'), kiln: await make('kiln'), suppliers: await make('suppliers'), loose: await make('loose') };
      const workspaces = workspacesRepo(meta);
      coffee = await workspaces.create({ name: 'Fernhill Coffee', connectionIds: [conn.fernhill, conn.suppliers] });
      kiln = await workspaces.create({ name: 'Kiln Street Pottery', connectionIds: [conn.kiln, conn.suppliers] });
      coffee = (await workspaces.setSender(coffee.id, { name: 'Fernhill Coffee', from: 'orders@fernhill.example', replyTo: null, postal: COFFEE_POSTAL }))!;
      kiln = (await workspaces.setSender(kiln.id, { name: 'Kiln Street Pottery', from: 'studio@kilnstreet.example', replyTo: 'hello@kilnstreet.example', postal: KILN_POSTAL }))!;
      // A template every send below renders.
      await emailTemplatesRepo(meta).upsert('firing-done', 'en_US', {
        name: 'Firing done',
        subject: 'Your firing is done',
        blocks: [{ id: 'b1', block: 'email.text', data: { text: 'Hello, your pots are ready.' } }],
        enabled: true,
      });
    });

    afterEach(async () => {
      resetEmailRuntime();
      await sink.close();
      await handle.destroy();
    });

    describe('which sender a mail goes as', () => {
      it('the workspace of the record’s database; the first by position for a database in both; the server for one in none', async () => {
        const as = async (connectionId: string | null) => (await resolveMailSender(meta, { connectionId, templateKey: 'firing-done' })).from;
        expect(await as(conn.kiln)).toBe('"Kiln Street Pottery" <studio@kilnstreet.example>');
        expect(await as(conn.fernhill)).toBe('"Fernhill Coffee" <orders@fernhill.example>');
        expect(await as(conn.suppliers)).toBe('"Fernhill Coffee" <orders@fernhill.example>');
        expect(await as(conn.loose)).toBeNull();
        expect(await as(null)).toBeNull();
        // Kiln first: the shared database now goes as Kiln.
        await workspacesRepo(meta).reorder([kiln.id, coffee.id]);
        expect(await as(conn.suppliers)).toBe('"Kiln Street Pottery" <studio@kilnstreet.example>');
        expect(await resolveMailSender(meta, { connectionId: conn.kiln })).toEqual({
          workspace: { id: kiln.id, name: 'Kiln Street Pottery' },
          from: '"Kiln Street Pottery" <studio@kilnstreet.example>',
          name: 'Kiln Street Pottery',
          replyTo: 'hello@kilnstreet.example',
          postal: KILN_POSTAL,
        });
      });

      it('a template’s "Send as" names it whatever the record; a workspace with no sender, or one gone, does not', async () => {
        const templates = emailTemplatesRepo(meta);
        const as = async (connectionId: string | null) => (await resolveMailSender(meta, { connectionId, templateKey: 'firing-done' })).workspace?.name ?? 'server';
        await templates.setSendAs('firing-done', kiln.id);
        expect(await as(conn.fernhill)).toBe('Kiln Street Pottery');
        expect(await as(conn.loose)).toBe('Kiln Street Pottery');
        expect(await as(null)).toBe('Kiln Street Pottery');
        await templates.setSendAs('firing-done', 'server');
        expect(await as(conn.kiln)).toBe('server');
        // A workspace with no sender of its own goes as the server.
        const bare = await workspacesRepo(meta).create({ name: 'Archive', connectionIds: [conn.loose] });
        await templates.setSendAs('firing-done', bare.id);
        expect(await as(conn.kiln)).toBe('server');
        // A workspace that is gone: by the record again.
        await templates.setSendAs('firing-done', kiln.id);
        await workspacesRepo(meta).remove(kiln.id);
        expect(await templates.sendAsOf('firing-done')).toBeNull();
        expect(await as(conn.suppliers)).toBe('Fernhill Coffee');
        expect(await as(conn.kiln)).toBe('server');
      });

      it('a From the server’s mail settings no longer cover goes as the server', async () => {
        await settingsRepo(meta).set('email.senders', [], { updatedBy: null });
        await meta.db.deleteFrom('adminium_email_dkim_keys').where('domain', '=', 'kilnstreet.example').execute();
        expect(await resolveMailSender(meta, { connectionId: conn.kiln })).toEqual(SERVER_SENDER);
        expect((await resolveMailSender(meta, { connectionId: conn.fernhill })).workspace?.name).toBe('Fernhill Coffee');
      });

      it('the server can send from its senders’ own domains, the domains it signs for, and a public mailbox only as itself', async () => {
        const sending = await sendingDomains(meta);
        expect(sending).toEqual({
          domains: ['fernhill.example', 'kilnstreet.example', 'shared-host.example'],
          addresses: ['ana.potter@gmail.com', 'news@shared-host.example', 'studio@kilnstreet.example'],
        });
        expect(maySendFrom('anyone@kilnstreet.example', sending)).toBe(true);
        expect(maySendFrom('Orders@Fernhill.example', sending)).toBe(true);
        expect(maySendFrom('ana.potter@gmail.com', sending)).toBe(true);
        expect(maySendFrom('someone.else@gmail.com', sending)).toBe(false);
        expect(maySendFrom('x@mail.kilnstreet.example', sending)).toBe(false);
        expect(maySendFrom('x@elsewhere.example', sending)).toBe(false);
        expect(maySendFrom('Kiln <x@kilnstreet.example>', sending)).toBe(false);
      });
    });

    describe('mail about a kiln record is sent as Kiln Street Pottery, with its postal address', () => {
      let registry: ReturnType<typeof createJobRegistry>;
      let hub: RealtimeHub;
      let worker: JobWorker;

      beforeEach(() => {
        registry = createJobRegistry();
        hub = new RealtimeHub();
        registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, marketing: kit });
        worker = new JobWorker({ meta, registry, hub, workerId: 'senders-test', backoffBaseMs: 1, concurrency: 1 });
      });
      afterEach(async () => {
        await worker.stop({ drainTimeoutMs: 50 });
        hub.close();
      });

      /** An automation's e-mail step about one record of `connectionId`, to the record's own address. */
      function stepOn(connectionId: string | null, address: string): { ctx: ActionContext; run: (mailClass?: 'marketing' | 'service') => Promise<string | null> } {
        const columns = new Map([['email', { name: 'email', logicalType: 'text', secret: false, masked: false }]]);
        const table = { id: 'public.contacts', schema: 'public', name: 'contacts', primaryKey: ['id'], columns, readOnly: false, table: { columns: [] } };
        const rule = { id: 'rul_1', name: 'Firing done', connectionId } as unknown as Automation;
        const ctx = {
          meta,
          manager: null,
          rule,
          runId: 'run_1',
          hops: 0,
          now: Date.now(),
          source: connectionId === null ? null : { connectionId, table, record: { pk: { id: 7 }, label: '7' }, row: { id: 7, email: address } },
          tokens: {},
          text: TRACE_EN,
          secret: TEST_SECRET,
          marketing: kit,
        } as unknown as ActionContext;
        const run = async (mailClass?: 'marketing' | 'service') =>
          (
            await runEmailAction(
              { kind: 'email', templateKey: 'firing-done', to: connectionId === null ? { kind: 'fixed', addresses: [address] } : { kind: 'field', column: 'email' }, vars: {}, ...(mailClass === undefined ? {} : { class: mailClass, purpose: 'newsletter' }) } as never,
              ctx,
            )
          ).log;
        return { ctx, run };
      }

      it('an automation’s marketing mail: Kiln’s From, reply-to, postal address and footer, signed for its domain', async () => {
        await kit.consent.record({ address: 'mo@clayclub.example', purpose: 'newsletter', source: 'import', state: 'yes' });
        await stepOn(conn.kiln, 'mo@clayclub.example').run('marketing');
        expect(sink.messages).toHaveLength(1);
        const raw = sink.messages[0]!.raw;
        const headers = headersOf(raw);
        expect(headers.get('from')).toBe('Kiln Street Pottery <studio@kilnstreet.example>');
        expect(sink.messages[0]!.from).toBe('studio@kilnstreet.example');
        expect(headers.get('reply-to')).toBe('hello@kilnstreet.example');
        expect(headers.get('list-unsubscribe')).toContain('<mailto:hello@kilnstreet.example?subject=unsubscribe>');
        expect((headers.get('dkim-signature') ?? '').replace(/\s+/g, '')).toMatch(/(^|;)d=kilnstreet\.example;/);
        const body = decodedBody(raw);
        expect(body).toContain(KILN_POSTAL);
        expect(body).not.toContain(SERVER_POSTAL);
        expect(body).toContain('Unsubscribe from Kiln Street Pottery’s newsletter');
      });

      it('the same step about a fernhill record goes as Fernhill Coffee; a database in none, and a rule on none, as the server', async () => {
        await kit.consent.record({ address: 'mo@clayclub.example', purpose: 'newsletter', source: 'import', state: 'yes' });
        await stepOn(conn.fernhill, 'mo@clayclub.example').run('marketing');
        await stepOn(conn.loose, 'mo@clayclub.example').run('marketing');
        await stepOn(null, 'team@clayclub.example').run();
        const [fern, loose, none] = sink.messages;
        expect(headersOf(fern!.raw).get('from')).toBe('Fernhill Coffee <orders@fernhill.example>');
        expect(decodedBody(fern!.raw)).toContain(COFFEE_POSTAL);
        // Fernhill names no reply-to: the marketing mail settings' (none here), so no Reply-To.
        expect(headersOf(fern!.raw).has('reply-to')).toBe(false);
        expect(headersOf(loose!.raw).get('from')).toBe('Shared Host <news@shared-host.example>');
        expect(decodedBody(loose!.raw)).toContain(SERVER_POSTAL);
        expect(decodedBody(loose!.raw)).toContain('Unsubscribe from Shared Host’s newsletter');
        expect(headersOf(none!.raw).get('from')).toBe('Shared Host <news@shared-host.example>');
      });

      it('"Send as" the server sends a kiln record’s mail as the server; "Send as" Kiln sends a fernhill record’s as Kiln', async () => {
        await stepOn(conn.kiln, 'mo@clayclub.example').run('service');
        await emailTemplatesRepo(meta).setSendAs('firing-done', 'server');
        await stepOn(conn.kiln, 'mo@clayclub.example').run('service');
        await emailTemplatesRepo(meta).setSendAs('firing-done', kiln.id);
        await stepOn(conn.fernhill, 'mo@clayclub.example').run('service');
        expect(sink.messages.map((one) => headersOf(one.raw).get('from'))).toEqual([
          'Kiln Street Pottery <studio@kilnstreet.example>',
          'Shared Host <news@shared-host.example>',
          'Kiln Street Pottery <studio@kilnstreet.example>',
        ]);
      });

      it('through the queue: mail about a record goes as its workspace; mail about none (a sign-in) as the server, whatever the template names', async () => {
        const send = (about: { connectionId: string | null } | undefined) =>
          enqueueEmail({ meta, secret: TEST_SECRET }, { to: 'mo@clayclub.example', templateKey: 'firing-done', vars: {}, ...(about === undefined ? {} : { about }) });
        const kilnJob = await send({ connectionId: conn.kiln });
        const supplierJob = await send({ connectionId: conn.suppliers });
        await emailTemplatesRepo(meta).setSendAs('firing-done', kiln.id);
        const systemJob = await send(undefined);
        expect(await opened(meta, kilnJob!.id)).toMatchObject({ from: '"Kiln Street Pottery" <studio@kilnstreet.example>', replyTo: 'hello@kilnstreet.example' });
        expect(await opened(meta, supplierJob!.id)).toMatchObject({ from: '"Fernhill Coffee" <orders@fernhill.example>' });
        const system = await opened(meta, systemJob!.id);
        expect(system.from).toBeUndefined();
        expect(system.replyTo).toBeUndefined();
        await drain(worker);
        expect(sink.messages.map((one) => headersOf(one.raw).get('from'))).toEqual([
          'Kiln Street Pottery <studio@kilnstreet.example>',
          'Fernhill Coffee <orders@fernhill.example>',
          'Shared Host <news@shared-host.example>',
        ]);
      });

      it('a drawn invoice of kiln is delivered as Kiln; one of no database as the server', async () => {
        const { documentsRepo, filesRepo } = await import('@adminium/meta');
        const file = await filesRepo(meta).create({ id: 'file_inv', filename: 'K-1.pdf', mime: 'application/pdf', sizeBytes: 12, sha256: 'x'.repeat(64), kind: 'document', uploadedBy: null, storageKey: 'documents/file_inv.pdf', destinationId: null, storage: 'local' });
        const draw = async (connectionId: string | null, number: string) => {
          const made = await documentsRepo(meta).create({
            profileId: null,
            addOnKey: 'invoices',
            kind: 'invoice',
            connectionId,
            entity: null,
            subject: { fields: { customerEmail: 'mo@clayclub.example' }, business: { name: 'Kiln Street Pottery', lines: [] } },
            locale: 'en-US',
            format: 'pdf',
            requestedBy: null,
            actorKind: 'system',
            jobId: null,
          });
          return (await documentsRepo(meta).markRendered(made.id, { number, fileId: file.id, htmlFileId: null, format: 'pdf' }, Date.now()))!;
        };
        const deliver = async (connectionId: string | null, number: string) => {
          expect(await emailDocument({ meta, secret: TEST_SECRET }, { document: await draw(connectionId, number), profile: null, to: 'mo@clayclub.example' })).toBe('sent');
          const [job] = await meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(1).execute();
          return opened(meta, job!.id);
        };
        expect(await deliver(conn.kiln, 'K-1')).toMatchObject({ from: '"Kiln Street Pottery" <studio@kilnstreet.example>', replyTo: 'hello@kilnstreet.example' });
        expect((await deliver(null, 'S-1')).from).toBeUndefined();
      });

      it('the pay link and the receipt for a kiln invoice speak as Kiln: its name, its From, its reply-to', async () => {
        const ref = { kind: 'profile' as const, connectionId: conn.kiln, tableName: 'invoices', rowKey: '42' };
        const payable: ResolvedPayable = { ref, label: 'K-0042', dueDate: null, currency: 'EUR', total: '80.00', due: '80.00', refusal: null, manualOnly: false, customerEmail: 'mo@clayclub.example', customerCountry: null, status: null, recordInto: { kind: 'kept' } } as ResolvedPayable;
        const sources = { document: async () => null } as unknown as PayableSources;
        const link = { id: 'pl_1', expiresAt: Date.now() + 86_400_000, payable: ref } as never;
        const sent = await sendPayLinkEmail({ meta, secret: TEST_SECRET, sources }, { link, url: 'https://pay.shared-host.example/p/x', payable });
        expect(sent).toMatchObject({ sent: true });
        const mail = await opened(meta, (sent as { jobId: string }).jobId);
        expect(mail).toMatchObject({ from: '"Kiln Street Pottery" <studio@kilnstreet.example>', replyTo: 'hello@kilnstreet.example' });
        expect(mail.html).toContain('Kiln Street Pottery');
        expect(mail.html).not.toContain('Shared Host');
      });

      it('a form’s sign-up confirmation goes as the workspace of the form’s database, with its name and postal address; a form of none as the server', async () => {
        const latest = async () => {
          const [job] = await meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(1).execute();
          return opened(meta, job!.id);
        };
        const confirm = (to: string, connectionId: string | null) =>
          sendConfirmMail({ meta, secret: TEST_SECRET, caps: { once: async () => true } as never, capKey: Buffer.alloc(32), to, language: 'en-US', name: 'Mo', purpose: 'newsletter', token: 'tok', at: Date.now(), connectionId });
        expect(await confirm('mo@clayclub.example', conn.kiln)).toBe('sent');
        const kilnMail = await latest();
        expect(kilnMail).toMatchObject({ from: '"Kiln Street Pottery" <studio@kilnstreet.example>', replyTo: 'hello@kilnstreet.example' });
        expect(kilnMail.html).toContain(KILN_POSTAL);
        expect(kilnMail.html).toContain('Kiln Street Pottery');
        expect(await confirm('bo@clayclub.example', conn.loose)).toBe('sent');
        const looseMail = await latest();
        expect(looseMail.from).toBeUndefined();
        // The server's own postal address and business name.
        expect(looseMail.html).not.toContain(KILN_POSTAL);
      });

      it('a booking’s confirmation goes as the workspace of the booking’s database; one with no database as the server', async () => {
        const book = (connectionId: string | undefined) =>
          sendConfirmation({
            meta,
            request: { headers: {}, server: {}, log: { warn: (obj: unknown) => console.warn(obj), info: () => undefined }, protocol: 'https', host: 'book.kilnstreet.example', hostname: 'book.kilnstreet.example' } as never,
            confirm: { template: 'booking-confirmation', to: 'email' },
            row: { email: 'mo@clayclub.example' },
            db: null as never,
            table: { table: { capacityRules: undefined } } as never,
            timezone: 'UTC',
            appKey: null,
            ...(connectionId === undefined ? {} : { connectionId }),
          });
        const latest = async () => {
          const [job] = await meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(1).execute();
          return opened(meta, job!.id);
        };
        // The booking path reads the secret the composition root hands the mail layer.
        configureEmailRuntime({ secret: TEST_SECRET });
        expect(await book(conn.kiln)).toBe(true);
        expect(await latest()).toMatchObject({ from: '"Kiln Street Pottery" <studio@kilnstreet.example>', replyTo: 'hello@kilnstreet.example' });
        expect(await book(undefined)).toBe(true);
        expect((await latest()).from).toBeUndefined();
      });

      it('a campaign to kiln’s people goes as Kiln, with its postal address; one sent as Kiln to the server’s own people too', async () => {
        const checks = campaignMarketingChecks({ meta, marketing: kit, secret: TEST_SECRET });
        const run = { id: 'erun_k', audience: { kind: 'table', connectionId: conn.kiln, table: 'public.contacts', purpose: 'newsletter' }, mailClass: 'marketing', basis: 'consent' } as unknown as EmailRun;
        expect(await checks.checkBatch(run)).toBe('send');
        const carry = await checks.carryFor({ id: 'snd_1', address: 'mo@clayclub.example', connectionId: conn.kiln, personTable: null, personKey: null } as never, run, 'en_US');
        expect(carry?.locked.lines).toEqual([KILN_POSTAL]);
        expect(carry?.locked.link.text).toBe('Unsubscribe from Kiln Street Pottery’s newsletter');
        expect(carry?.replyTo).toBe('hello@kilnstreet.example');
      });
    });

    describe('a whole campaign run, through its batches and the queue', () => {
      let app: BareApp;
      let registry: ReturnType<typeof createJobRegistry>;
      let hub: RealtimeHub;
      let worker: JobWorker;
      let manager: User;

      beforeEach(async () => {
        const users = usersRepo(meta);
        manager = await users.create({ email: 'ava@shared-host.example', name: 'Ava', status: 'active' });
        await rolesRepo(meta).assignToUser(manager.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
        await users.create({ email: 'stopped@clayclub.example', name: 'Stopped', status: 'active' });
        await users.create({ email: 'agreed@clayclub.example', name: 'Agreed', status: 'active' });
        await kit.consent.record({ address: 'agreed@clayclub.example', purpose: 'newsletter', source: 'import', state: 'yes' });
        await kit.consent.record({ address: 'stopped@clayclub.example', purpose: 'newsletter', source: 'import', state: 'yes' });
        registry = createJobRegistry();
        hub = new RealtimeHub();
        registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, marketing: kit, onGiveUp: withCampaignGiveUp(meta) });
        registerEmailCampaignRunHandler(registry, { meta, secret: TEST_SECRET, hub, seams: withMarketingChecks(campaignMarketingChecks({ meta, marketing: kit, secret: TEST_SECRET }), undefined) });
        worker = new JobWorker({ meta, registry, hub, workerId: 'senders-campaign', backoffBaseMs: 1, concurrency: 1 });
        app = buildBareApp();
        app.addHook('onRequest', async (request) => {
          (request as unknown as { user: { id: string; name: string } }).user = { id: manager.id, name: manager.name };
        });
        await app.register(rbacPlugin, { meta });
        await app.register(emailTemplatesRoutes({ meta, secret: TEST_SECRET, marketing: kit }));
        await app.ready();
      });
      afterEach(async () => {
        await worker.stop({ drainTimeoutMs: 50 });
        hub.close();
        await app.close();
      });

      /** A marketing campaign, sent as `sendAs`, to the server's own people. */
      async function campaignAs(sendAs: string | null): Promise<string> {
        const made = await app.inject({ method: 'POST', url: '/email-templates', payload: { kind: 'campaign', name: 'Autumn kilns', starter: 'digest' } });
        const doc = made.json() as EmailDocumentDetailView;
        expect(doc.sendAs).toBeNull();
        const set = await app.inject({ method: 'PUT', url: `/email-templates/${doc.id}/send-as`, payload: { sendAs } });
        expect(set.statusCode, set.body).toBe(200);
        const sent = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/send`, payload: { audience: { kind: 'users' } } });
        expect(sent.statusCode, sent.body).toBe(202);
        const run = (sent.json() as { run: EmailRunView }).run;
        await meta.db.updateTable('adminium_email_runs').set({ mailClass: 'marketing', basis: 'consent' }).where('id', '=', run.id).execute();
        return run.id;
      }

      it('goes as the workspace it is sent as, with that workspace’s postal address', async () => {
        await campaignAs(kiln.id);
        await drain(worker);
        expect(sink.messages.flatMap((one) => one.to).sort()).toEqual(['agreed@clayclub.example', 'stopped@clayclub.example']);
        for (const one of sink.messages) {
          expect(headersOf(one.raw).get('from')).toBe('Kiln Street Pottery <studio@kilnstreet.example>');
          expect(decodedBody(one.raw)).toContain(KILN_POSTAL);
        }
      });

      it('the do-not-email list stays the server’s: an address stopped by either business gets marketing mail from neither', async () => {
        // Stopped by Kiln's unsubscribe link: it is one list for the whole server.
        await kit.consent.stop.add({ address: 'stopped@clayclub.example', reason: 'link', origin: 'Kiln Street Pottery' });
        const asKiln = await campaignAs(kiln.id);
        const asCoffee = await campaignAs(coffee.id);
        await drain(worker);
        for (const runId of [asKiln, asCoffee]) {
          const rows = await emailSendsRepo(meta).list(runId, { limit: 50 });
          expect(rows.find((row) => row.address === 'stopped@clayclub.example')).toMatchObject({ state: 'skipped-stop', reason: 'do-not-email' });
          expect(rows.find((row) => row.address === 'agreed@clayclub.example')).toMatchObject({ state: 'sent' });
        }
        expect(sink.messages.flatMap((one) => one.to)).not.toContain('stopped@clayclub.example');
        expect(sink.messages.map((one) => headersOf(one.raw).get('from')).sort()).toEqual(['Fernhill Coffee <orders@fernhill.example>', 'Kiln Street Pottery <studio@kilnstreet.example>']);

        // And an automation's marketing mail about a record of either: skipped by the same list.
        for (const connectionId of [conn.kiln, conn.fernhill]) {
          const columns = new Map([['email', { name: 'email', logicalType: 'text', secret: false, masked: false }]]);
          const table = { id: 'public.contacts', schema: 'public', name: 'contacts', primaryKey: ['id'], columns, readOnly: false, table: { columns: [] } };
          const log = await runEmailAction(
            { kind: 'email', templateKey: 'firing-done', to: { kind: 'field', column: 'email' }, vars: {}, class: 'marketing', purpose: 'newsletter' } as never,
            {
              meta,
              rule: { id: 'rul_1', name: 'News', connectionId } as unknown as Automation,
              runId: 'run_1',
              hops: 0,
              now: Date.now(),
              source: { connectionId, table, record: { pk: { id: 1 }, label: '1' }, row: { id: 1, email: 'stopped@clayclub.example' } },
              tokens: {},
              text: TRACE_EN,
              secret: TEST_SECRET,
              marketing: kit,
            } as unknown as ActionContext,
          );
          expect(log.log).toContain('do-not-email');
        }
        expect(sink.messages).toHaveLength(2);
      });
    });

    describe('the sender form’s routes', () => {
      let app: BareApp;
      let owner: User;
      let reader: User;
      let publish: ReturnType<typeof vi.fn>;

      beforeEach(async () => {
        const users = usersRepo(meta);
        owner = await users.create({ email: 'owner@shared-host.example', name: 'Owner', status: 'active' });
        await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
        reader = await users.create({ email: 'reader@shared-host.example', name: 'Reader', status: 'active' });
        publish = vi.fn();
        app = buildBareApp();
        app.decorate('realtime', { publish } as never);
        app.addHook('onRequest', async (request) => {
          const id = request.headers['x-test-user-id'];
          const user = typeof id === 'string' ? await users.findById(id) : null;
          if (user !== null) Object.assign(request, { user: { id: user.id, name: user.name, email: user.email } });
        });
        await app.register(rbacPlugin, { meta });
        await app.register(workspacesRoutes);
        await app.register(emailTemplatesRoutes({ meta, secret: TEST_SECRET, marketing: kit }));
        await app.ready();
      });
      afterEach(async () => {
        await app.close();
      });

      const call = (method: 'GET' | 'PUT' | 'DELETE', url: string, user: User, payload?: unknown) =>
        app.inject({ method, url, headers: { 'x-test-user-id': user.id }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

      it('says where the server can send from, and refuses a From it cannot send for by naming where it can', async () => {
        expect((await call('GET', '/workspaces/sender-domains', owner)).json()).toEqual({
          domains: ['fernhill.example', 'kilnstreet.example', 'shared-host.example'],
          addresses: ['ana.potter@gmail.com', 'news@shared-host.example', 'studio@kilnstreet.example'],
        });
        const refused = await call('PUT', `/workspaces/${kiln.id}/sender`, owner, { from: 'hello@kiln-pottery.example' });
        expect(refused.statusCode).toBe(422);
        expect(refused.json().error.message).toBe('This server can only send from fernhill.example, kilnstreet.example, shared-host.example, ana.potter@gmail.com. Use an address there.');
        expect(refused.json().error.details).toMatchObject({ field: 'from', code: 'not-a-sending-domain' });
        // A public mailbox is never a whole domain.
        expect((await call('PUT', `/workspaces/${kiln.id}/sender`, owner, { from: 'kiln.street@gmail.com' })).statusCode).toBe(422);
        const badReply = await call('PUT', `/workspaces/${kiln.id}/sender`, owner, { from: 'studio@kilnstreet.example', replyTo: 'Kiln <hello@kilnstreet.example>' });
        expect(badReply.statusCode).toBe(422);
        expect(badReply.json().error.details).toMatchObject({ field: 'replyTo' });
        expect(publish).not.toHaveBeenCalled();
        // With no mail set up at all, it says so.
        await meta.db.deleteFrom('adminium_settings').where('key', 'in', ['email.smtp', 'email.senders']).execute();
        await meta.db.deleteFrom('adminium_email_dkim_keys').execute();
        const none = await call('PUT', `/workspaces/${kiln.id}/sender`, owner, { from: 'studio@kilnstreet.example' });
        expect(none.json().error).toMatchObject({ message: 'This server has no sender yet. Set up e-mail in Settings first.', details: { code: 'no-mail' } });
      });

      it('sets and clears a sender for whoever manages connections, audited and published; nobody else may', async () => {
        expect((await call('GET', '/workspaces/sender-domains', reader)).statusCode).toBe(403);
        expect((await call('PUT', `/workspaces/${coffee.id}/sender`, reader, { from: 'orders@fernhill.example' })).statusCode).toBe(403);
        expect((await call('DELETE', `/workspaces/${coffee.id}/sender`, reader)).statusCode).toBe(403);

        const set = await call('PUT', `/workspaces/${coffee.id}/sender`, owner, { name: ' Fernhill Roastery ', from: 'Roastery@Fernhill.example', replyTo: 'hi@fernhill.example', postal: '  ' });
        expect(set.statusCode, set.body).toBe(200);
        expect(set.json()).toMatchObject({ id: coffee.id, name: 'Fernhill Coffee', sender: { name: 'Fernhill Roastery', from: 'roastery@fernhill.example', replyTo: 'hi@fernhill.example', postal: null } });
        expect(publish).toHaveBeenCalledWith('config-changed', 'workspaces.changed', {}, expect.any(Number));
        expect((await resolveMailSender(meta, { connectionId: conn.fernhill })).from).toBe('"Fernhill Roastery" <roastery@fernhill.example>');

        const cleared = await call('DELETE', `/workspaces/${coffee.id}/sender`, owner);
        expect(cleared.json().sender).toEqual({ name: null, from: null, replyTo: null, postal: null });
        expect(await resolveMailSender(meta, { connectionId: conn.fernhill })).toEqual(SERVER_SENDER);
        expect((await call('PUT', '/workspaces/wsp_absent/sender', owner, { from: 'a@fernhill.example' })).statusCode).toBe(404);

        const actions = (await auditRepo(meta).list({ category: 'connection', limit: 50 })).map((entry) => entry.action);
        expect(actions).toEqual(expect.arrayContaining(['workspace.sender', 'workspace.sender.clear']));
        expect(publish).toHaveBeenCalledTimes(2);
      });

      it('offers "Send as": the server’s From and each workspace with its own From, to whoever edits templates', async () => {
        await workspacesRepo(meta).create({ name: 'Archive' });
        expect((await call('GET', '/email-templates/send-as-options', reader)).statusCode).toBe(403);
        expect((await call('GET', '/email-templates/send-as-options', owner)).json()).toEqual({
          server: 'Shared Host <news@shared-host.example>',
          workspaces: [
            { id: coffee.id, name: 'Fernhill Coffee', from: 'orders@fernhill.example' },
            { id: kiln.id, name: 'Kiln Street Pottery', from: 'studio@kilnstreet.example' },
            { id: expect.any(String), name: 'Archive', from: null },
          ],
        });
      });

      it('names a template’s sender: a workspace, the server, or by the record; a workspace that is not there is not found', async () => {
        const template = (await emailTemplatesRepo(meta).findByKeyLocale('firing-done', 'en_US'))!;
        await emailTemplatesRepo(meta).upsert('firing-done', 'de_DE', { name: 'Brand fertig', subject: 'Fertig', blocks: [], enabled: true });
        expect((await call('PUT', `/email-templates/${template.id}/send-as`, owner, { sendAs: 'wsp_absent' })).statusCode).toBe(404);
        const set = await call('PUT', `/email-templates/${template.id}/send-as`, owner, { sendAs: kiln.id });
        expect(set.json()).toEqual({ key: 'firing-done', sendAs: kiln.id });
        expect((await call('GET', `/email-templates/${template.id}`, owner)).json().sendAs).toBe(kiln.id);
        // Every language of it.
        expect((await emailTemplatesRepo(meta).siblings('firing-done')).map((row) => row.sendAs)).toEqual([kiln.id, kiln.id]);
        expect((await call('PUT', `/email-templates/${template.id}/send-as`, owner, { sendAs: 'server' })).json().sendAs).toBe('server');
        expect((await call('PUT', `/email-templates/${template.id}/send-as`, owner, { sendAs: null })).json().sendAs).toBeNull();
        const actions = (await auditRepo(meta).list({ category: 'settings', limit: 50 })).map((entry) => entry.action);
        expect(actions.filter((action) => action === 'email-template.send-as')).toHaveLength(3);
      });
    });
  });
}
