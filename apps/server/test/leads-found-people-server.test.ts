// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FOUND PEOPLE, THE TELL MAIL AND THE OBJECT PAGE, ON THE REAL SERVER: an
 * add-on that finds companies and people, attached to a CRM whose contacts
 * are people (with a "may be e-mailed" column) and whose companies say
 * their country, on SQLite, Postgres and MySQL.
 *
 *  - the People switch: refused, saying why, while e-mail, the public
 *    address or the purpose is missing; on once all is set;
 *  - before storing: an address on the do-not-email list, one already in
 *    the contacts, a shared inbox, no name, no company → each refused by
 *    reason; nothing stored for them;
 *  - a kept person: a contact made as the staff member, a found person's
 *    row, and a tell mail sent at once, in French for a French company (the
 *    install's language and English otherwise), carrying the engine's
 *    sentences and the Object block whatever the add-on's text says, even
 *    switched off; `told_at` set when it goes;
 *  - until then, an app's mail, a campaign row, a rule's e-mail step and a
 *    chat reply to them are each refused;
 *  - a tell mail that failed, untold at the deadline: the sweep erases them,
 *    with its audit entry;
 *  - Object: a GET changes nothing; the POST stops and erases them (no row
 *    left in the found people, the fields' sources or the outbox; the contact
 *    gone), the address stays stopped, and keeping them again is refused;
 *    with a deal linked, the contact stays emptied and the page says what
 *    stays; a forged link is a dead link;
 *  - "may be e-mailed" on a found person: the tick refused; consent without
 *    a note refused; with one, a campaign takes them;
 *  - their download carries the source, the date, the told record and the
 *    pages; their erasure keeps only the day they were told;
 *  - the found people table refuses a person's own write; its widest values
 *    are kept whole.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditRepo, documentsRepo, emailTemplatesRepo, filesRepo, paymentSettingsRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo, type EmailRun, type EmailSend, type PaymentLink } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { runEmailAction } from '../src/automations/actions/email.js';
import type { ActionContext } from '../src/automations/actions/types.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { mailChatReply } from '../src/chat/reply-mail.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createConsentService } from '../src/consent/index.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { emailDocument } from '../src/documents/deliver.js';
import { emailSecretKey } from '../src/email/config.js';
import { createMarketingMail } from '../src/email/marketing.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import type { FileStore } from '../src/files/store.js';
import { campaignMarketingChecks, CAMPAIGN_SKIP_NOT_TOLD } from '../src/jobs/email-campaign-checks.js';
import { FOUND_TICK_REFUSED, PEOPLE_SWITCH_REFUSED } from '../src/leads/guard.js';
import { foundRowOf, insertFound, leadsWriteContext, tellByOf, untoldChanged } from '../src/leads/found-store.js';
import { OBJECT_PATH, readObjectLink } from '../src/leads/object-token.js';
import { keepFoundPeople, untoldAddress, UNTOLD_SENTENCE, type KeepFoundPeopleInput } from '../src/leads/people.js';
import { sweepFoundPeople, yearsAfter } from '../src/leads/sweep.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { sendPayLinkEmail } from '../src/payments/emails.js';
import type { ResolvedPayable } from '../src/payments/payables.js';
import { businessName } from '../src/privacy/business.js';
import { erasePerson } from '../src/privacy/erase.js';
import { findPerson } from '../src/privacy/sources.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const HOST = 'crm.meridian.example';
const ORIGIN = `https://${HOST}`;
const DAY = 86_400_000;
const NO_FILES = { remove: async () => undefined, driverFor: async () => ({ remove: async () => undefined }) } as unknown as FileStore;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
/** An address as wide as a found person's row keeps one: 320 characters. */
const WIDE_ADDRESS = `${'x'.repeat(303)}@kestrel-yard.dev`;
const FINDER_PAGE = 'company-finder-search';
const PURPOSE = { 'en-US': 'To offer your studio drawing boards and plan chests.', 'fr-FR': 'Pour proposer à votre agence des tables à dessin.' };

/** A CRM whose contacts are people (with "may be e-mailed"), whose companies say their country, with deals and a mail of its own. */
function crm(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.64', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'companies', columns: [pk, text('name', 120), text('country', 2, { nullable: true }), text('website', 200, { nullable: true })] },
        {
          ref: 'contacts',
          columns: [
            pk,
            text('name', 120),
            text('email', 254, { nullable: true }),
            { ref: 'company_id', type: 'fk', references: 'companies' },
            { ref: 'may_email', type: 'bool', default: false },
            { ref: 'is_customer', type: 'bool', default: false },
          ],
        },
        { ref: 'deals', columns: [pk, text('title', 120), { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true }] },
        {
          ref: 'mails',
          columns: [
            pk,
            { ref: 'kind', type: 'enum', enum: ['welcome'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 320, { nullable: true }),
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            text('error', 200, { nullable: true }),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    people: [
      { table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id', consent: { column: 'may_email', purpose: 'newsletter' }, customer: 'is_customer' },
      { table: 'companies', kind: 'companies', name: 'name' },
    ],
    outbox: {
      table: 'mails',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { contact: 'contact_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      kinds: { welcome: 'crm-welcome' },
      classes: { welcome: 'service' },
    },
    emailTemplates: [{ key: 'crm-welcome', name: 'Welcome', locales: { 'en-US': { subject: 'Welcome', blocks: [{ block: 'email.text', data: { text: 'Hello {{recipient.name}}.' } }] } } }],
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** The add-on, with its tell mail: an outbox of its own linked to the found people, and its text in English and French. */
function finder(): Doc {
  const doc = leadFinder() as Doc;
  doc['compatibility'] = { minAdminiumVersion: '0.3.66', requires: ['outbound-http'] };
  doc['requiredSchema'].tables.push({
    ref: 'tell_mails',
    columns: [
      pk,
      { ref: 'kind', type: 'enum', enum: ['tell'] },
      { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
      text('to_address', 320, { nullable: true }),
      { ref: 'found_person_id', type: 'fk', references: 'found_people', nullable: true },
      text('language', 10, { nullable: true }),
      text('error', 200, { nullable: true }),
      { ref: 'sent_at', type: 'timestamptz', nullable: true },
    ],
  });
  doc['outbox'] = {
    table: 'tell_mails',
    columns: { kind: 'kind', status: 'status', to: 'to_address', language: 'language', error: 'error', sentAt: 'sent_at' },
    links: { found_person: 'found_person_id' },
    // The address they were found with, on their found person's row.
    recipient: { via: 'found_person_id', table: 'found_people', email: 'email' },
    kinds: { tell: 'company-finder-tell' },
    classes: { tell: 'service' },
  };
  doc['emailTemplates'] = [
    {
      key: 'company-finder-tell',
      name: 'Why we have your details',
      locales: {
        // The opening only: the engine adds everything else, so nothing is said twice.
        'en-US': {
          subject: 'Why we have your details',
          blocks: [
            { block: 'email.heading', data: { text: 'Why we have your details' } },
            { block: 'email.text', data: { text: 'Hello {{first_name}},' } },
            { block: 'email.text', data: { text: 'We keep your name, your role and your work e-mail address, as someone at {{company}}.' } },
          ],
        },
        'fr-FR': {
          subject: 'Pourquoi nous avons vos coordonnées',
          blocks: [
            { block: 'email.text', data: { text: 'Bonjour {{first_name}},' } },
            { block: 'email.text', data: { text: 'Nous gardons votre nom, votre rôle et votre adresse e-mail de travail, en tant que membre de {{company}}.' } },
          ],
        },
      },
    },
  ];
  doc['roles'][0].permissions.push('table:@tell_mails:read');
  // A page of its own: whoever may open it may see the tell mail's preview.
  doc['addOn'].hostApi = 1;
  doc['addOn'].pages = [{ ref: FINDER_PAGE, title: { key: 'company-finder.search', fallback: 'Find companies' }, icon: 'search', client: 'pages/search.js' }];
  return doc;
}

describe.each(LEGS)('found people, the tell mail and the Object page — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  const tables: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let signIns = 0;
  let installId = '';
  let conn = '';

  const table = (app: string, ref: string) => tables[`${app}:${ref}`]!;
  const rows = (statement: string) => h.rows(statement) as Promise<Doc[]>;
  const settings = () => settingsRepo(h.meta);
  const consent = () => createConsentService({ meta: h.meta, secret: TEST_SECRET });
  const eraseDeps = () => ({ meta: h.meta, manager: h.manager, consent: consent(), storage: NO_FILES, secret: TEST_SECRET });
  const idOf = async (app: string, ref: string) => (await loadSnapshotView(h.meta, conn, { forOthers: true })).table(table(app, ref)).id;
  const as = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  /** A stranger's request to the mail door. */
  const stranger = (method: 'GET' | 'POST', url: string, form?: string) =>
    composed.app.inject({ method, url, remoteAddress: '203.0.113.9', headers: { host: HOST, ...(form === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }) }, ...(form === undefined ? {} : { payload: form }) });
  const smtp = () => ({ host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Meridian <hello@meridian.example>', secure: false });

  async function insert(ref: string, values: Doc, app = 'crm'): Promise<void> {
    const view = await loadSnapshotView(h.meta, conn, { forOthers: true });
    const at = view.table(table(app, ref));
    const { db } = await h.manager.data(conn);
    const bound = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(at.columns.get(column)!, value, dialect)]));
    await db.insertInto(at.id as never).values(bound as never).execute();
  }

  /** Someone with these grants (and a name), signed in. */
  async function person(key: string, name: string, grants: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    const role = await rolesRepo(h.meta).create({ slug: `leads-${key}`, name: `Leads ${key}` });
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  /** The staff member behind a hand-over, as the lead door hands it. */
  const staff = (who: string): KeepFoundPeopleInput['staff'] => ({ id: ids[who]!, label: who, request: { headers: { cookie: cookies[who]! }, ip: '10.9.0.1', host: 'localhost' } as unknown as FastifyRequest });
  const keep = (company: string, people: KeepFoundPeopleInput['people'], who = 'finn') =>
    composed.leads.keep({ installId, addOnKey: 'company-finder', staff: staff(who), company: { table: 'crm:companies', key: company }, source: 'hunter', people });
  const found = (name: string, email: string) => ({ name, role: 'Architect', email, sources: [`https://www.kestrel-yard.example/team`, 'http://not-https.example/x'] });

  /** The mails queued since the last look, opened. */
  async function mails(): Promise<{ to: string; subject: string; html: string; text: string }[]> {
    const queued = await h.meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('kind', '=', 'email.send').where('status', '=', 'pending').orderBy('createdAt', 'asc').execute();
    for (const row of queued) await h.meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
    return queued.map((row) => {
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; html: string; text: string };
    });
  }
  const send = () => composed.app.outboxSender.sendApp('company-finder');
  const foundRows = () => rows(`SELECT * FROM ${table('company-finder', 'found_people')} ORDER BY id`);
  const tellRows = () => rows(`SELECT * FROM ${table('company-finder', 'tell_mails')} ORDER BY id`);
  const contactOf = async (email: string) => (await rows(`SELECT * FROM ${table('crm', 'contacts')} WHERE email = '${email}'`))[0];
  /** The Object link a mail carries. */
  const objectLinkIn = (html: string) => {
    const match = new RegExp(`${ORIGIN.replaceAll('.', '\\.')}${OBJECT_PATH}([A-Za-z0-9_~-]+)`).exec(html);
    expect(match, 'the mail carries an Object link').not.toBeNull();
    return `${OBJECT_PATH}${match![1]!}`;
  };
  async function setPeople(values: Doc): Promise<void> {
    const { db } = await h.manager.data(conn);
    const bound: Doc = { ...values };
    if ('purpose' in bound && bound['purpose'] !== null) bound['purpose'] = JSON.stringify(bound['purpose']);
    if ('people_on' in bound && dialect === 'sqlite') bound['people_on'] = bound['people_on'] ? 1 : 0;
    await db.updateTable(table('company-finder', 'finder_settings') as never).set(bound as never).execute();
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    conn = h.connectionId;
    await h.stageApp(crm());
    const app = await h.install('crm', '1.0.0');
    expect(app.statusCode, app.body).toBe(200);
    // Where a company's country is (`people.lead`), written into the stored manifest after the install.
    const stored = await h.meta.db.selectFrom('adminium_manifests').select(['id', 'manifest']).where('manifestKey', '=', 'crm').executeTakeFirstOrThrow();
    const document = (typeof stored.manifest === 'string' ? JSON.parse(stored.manifest) : stored.manifest) as Doc;
    document['people'][1]['lead'] = { website: 'website', address: { country: 'country' } };
    await h.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify(document) } as never).where('id', '=', stored.id).execute();
    await h.stageAddOn(finder(), { bundled: true, files: { 'dist/server.js': 'export function createLeadSource() { return { checkKey: async () => ({ ok: true }) }; }\n', 'pages/search.js': 'export default {};\n' } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'company-finder', version: '1.0.0', attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    installId = (await h.meta.db.selectFrom('adminium_manifests').select(['id']).where('manifestKey', '=', 'company-finder').executeTakeFirstOrThrow()).id;
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;

    // The settings row, people off, why and for how long.
    const { db } = await h.manager.data(conn);
    const settingsTable = table('company-finder', 'finder_settings');
    if (Number((await rows(`SELECT COUNT(*) AS n FROM ${settingsTable}`))[0]!['n']) === 0) await db.insertInto(settingsTable as never).values({ keep_years: 3 } as never).execute();
    await setPeople({ purpose: PURPOSE, keep_years: 3 });

    await settings().set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings().set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings().set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await settings().set('privacy.dpoContact', 'privacy@meridian.example', { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

    root = await mkdtemp(join(tmpdir(), 'leads-people-'));
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    const t = async (app: string, ref: string, ...actions: string[]) => actions.map(async (action) => `table:${conn}:${await idOf(app, ref)}:${action}`);
    const grants = async (...parts: Promise<string>[][]) => Promise.all(parts.flat());
    // Finn keeps people and works the contacts; Seth keeps the add-on's settings.
    await person('finn', 'Finn Ashcombe', await grants(await t('crm', 'contacts', 'read', 'create', 'update'), await t('crm', 'companies', 'read'), await t('crm', 'deals', 'read'), await t('company-finder', 'found_people', 'read', 'create', 'update', 'delete')));
    await person('seth', 'Seth Admin', await grants(await t('company-finder', 'finder_settings', 'read', 'update')));
    // Pia may open the add-on's page and nothing else.
    await person('pia', 'Pia Lund', [`page:${FINDER_PAGE}:view`]);

    await insert('companies', { id: 1, name: 'Kestrel Yard Architects', country: 'GB', website: 'https://www.kestrel-yard.example' });
    await insert('companies', { id: 2, name: 'Atelier Saône Clair', country: 'FR', website: 'https://www.saone-clair.example' });
    await insert('companies', { id: 3, name: 'Fjordlys Arkitekter AS', country: 'NO', website: 'https://www.fjordlys.example' });
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  /** Switches people on through a person's save of the settings row; answers the reply. */
  async function switchOn(): Promise<{ statusCode: number; body: string }> {
    const settingsId = await idOf('company-finder', 'finder_settings');
    const row = (await rows(`SELECT id FROM ${table('company-finder', 'finder_settings')}`))[0]!;
    return as('seth', 'PATCH', `/api/v1/data/${conn}/${encodeURIComponent(settingsId)}/${String(row['id'])}`, { values: { people_on: true } });
  }

  it.skipIf(!available)('the People switch’s refusal names each thing missing by a stable code, as data, beside the English message', async () => {
    // A keeping time outside 1 to 10 years reads as none chosen.
    await setPeople({ purpose: {}, keep_years: 0 });
    await settings().set('system.publicOrigin', null, { updatedBy: null });
    await settings().set('privacy.businessName', null, { updatedBy: null });
    try {
      const reply = await switchOn();
      expect(reply.statusCode, reply.body).toBe(422);
      const error = (JSON.parse(reply.body) as Doc)['error'] as Doc;
      expect(error['message']).toContain(PEOPLE_SWITCH_REFUSED);
      expect(error['details']['hook']).toBe('leads.people-switch');
      expect(error['details']['problems']).toEqual([
        { code: 'purpose-missing', languages: ['en-US'], message: 'Write the English version of why you keep them.' },
        { code: 'keep-time', message: 'Choose how long found people are kept: 1 to 10 years.' },
        { code: 'smtp', message: 'E-mail isn’t set up: Settings → Email.' },
        { code: 'public-origin', message: 'Set the address in e-mail links: Settings → Senders.' },
        { code: 'privacy-notice', message: 'Set the business name and the privacy notice’s address: Studio → Privacy.' },
      ]);
      // Each code's message is in the English message too, in the same order.
      const said = (error['details']['problems'] as Doc[]).map((one) => one['message'] as string).join(' ');
      expect(error['message']).toBe(`${PEOPLE_SWITCH_REFUSED} ${said}`);
    } finally {
      await setPeople({ purpose: PURPOSE, keep_years: 3 });
      await settings().set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await settings().set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    }
  });

  it.skipIf(!available)('the People switch refuses, saying why, while e-mail, the public address or the purpose is missing; with all set it turns on', async () => {
    // No mail server.
    let reply = await switchOn();
    expect(reply.statusCode, reply.body).toBe(422);
    expect(reply.body).toContain(PEOPLE_SWITCH_REFUSED);
    expect(reply.body).toContain('E-mail isn’t set up: Settings → Email.');
    await settings().set('email.smtp', smtp(), { updatedBy: null });
    // No public address.
    await settings().set('system.publicOrigin', null, { updatedBy: null });
    reply = await switchOn();
    expect(reply.statusCode).toBe(422);
    expect(reply.body).toContain('Set the address in e-mail links: Settings → Senders.');
    expect(reply.body).not.toContain('E-mail isn’t set up');
    await settings().set('system.publicOrigin', ORIGIN, { updatedBy: null });
    // No English purpose.
    await setPeople({ purpose: { 'fr-FR': PURPOSE['fr-FR'] } });
    reply = await switchOn();
    expect(reply.statusCode).toBe(422);
    expect(reply.body).toContain('Write the English version of why you keep them.');
    await setPeople({ purpose: PURPOSE });
    // All set: on.
    reply = await switchOn();
    expect(reply.statusCode, reply.body).toBe(200);
    expect(Number((await rows(`SELECT people_on FROM ${table('company-finder', 'finder_settings')}`))[0]!['people_on'])).toBe(1);
  });

  it.skipIf(!available)('the tell mail’s preview draws the mail as it would go, with the real business details, for a made-up person; it sends nothing and its Object link opens nothing', async () => {
    await mails();
    const foundBefore = (await foundRows()).length;
    const tellsBefore = (await tellRows()).length;
    const reply = await as('pia', 'GET', '/api/v1/leads/company-finder/tell-preview?locale=fr-FR');
    expect(reply.statusCode, reply.body).toBe(200);
    const preview = JSON.parse(reply.body) as Doc;
    expect(preview['locale']).toBe('fr-FR');
    expect(preview['purposeWritten']).toBe(true);
    expect(preview['sample']).toEqual({ name: 'Robin Hale', company: 'Kestrel Yard Architects' });
    // The add-on's French opening, then the engine's sentences, with this install's business, contact and purpose.
    const html = preview['html'] as string;
    expect(html).toContain('Bonjour Robin');
    expect(html).toContain('Kestrel Yard Architects');
    expect(html).toContain(PURPOSE['fr-FR']);
    // The business as every mail of the install names it (the pay page's shop name wins over the privacy setting).
    const business = await businessName(h.meta);
    expect(business).toBe('Meridian');
    expect(html).toContain('privacy@meridian.example');
    expect(preview['subject']).toBe('Pourquoi nous avons vos coordonnées');
    expect(preview['text']).toMatch(/privacy@meridian\.example[^\n]*Meridian/);
    // The Object link: the Object page with a word that opens nothing, and no other link to it anywhere in the mail.
    expect(preview['objectLink']).toBe(`${ORIGIN}${OBJECT_PATH}preview`);
    const objectLinks = [...`${html}\n${preview['text'] as string}`.matchAll(new RegExp(`${OBJECT_PATH}([A-Za-z0-9_~.-]+)`, 'g'))].map((match) => match[1]);
    expect(objectLinks.length).toBeGreaterThan(0);
    expect(new Set(objectLinks)).toEqual(new Set(['preview']));
    const install = String(await settings().get('system.instanceId'));
    expect(await readObjectLink(h.meta, TEST_SECRET, install, 'preview')).toBeNull();
    // A stranger following it is shown a dead link, and nothing changes.
    const followed = await stranger('GET', `${OBJECT_PATH}preview`);
    expect(followed.body).not.toContain('Kestrel Yard Architects');
    // Nothing sent, queued or stored.
    expect(await mails()).toEqual([]);
    expect((await foundRows()).length).toBe(foundBefore);
    expect((await tellRows()).length).toBe(tellsBefore);

    // A language the purpose is not written in: shown in English, as the People card shows it.
    const german = JSON.parse((await as('pia', 'GET', '/api/v1/leads/company-finder/tell-preview?locale=de-DE')).body) as Doc;
    expect(german['locale']).toBe('en-US');
    expect(german['html']).toContain(PURPOSE['en-US']);
    expect(german['html']).toContain('Hello Robin');
    // Someone who may not open the add-on's pages is not answered.
    const finn = await as('finn', 'GET', '/api/v1/leads/company-finder/tell-preview');
    expect([403, 404]).toContain(finn.statusCode);
  });

  it.skipIf(!available)('before storing: stopped, already here, a shared inbox, no name and no company are each refused by reason, and nothing is stored for them', async () => {
    await consent().stop.add({ address: 'gone.ahead@kestrel-yard.dev', reason: 'hand', at: Date.now() });
    await insert('contacts', { id: 50, name: 'Wren Hollis', email: 'wren.hollis@kestrel-yard.dev', company_id: 1, may_email: dialect === 'sqlite' ? 0 : false });
    const before = (await foundRows()).length;
    const answer = await keep('1', [found('Gone Ahead', 'gone.ahead@kestrel-yard.dev'), found('Wren Hollis', 'Wren.Hollis@kestrel-yard.dev'), found('Front Desk', 'info@kestrel-yard.dev'), found('   ', 'quiet.one@kestrel-yard.dev')]);
    expect(answer.kept).toEqual([]);
    expect(answer.refused.map((one) => one.reason)).toEqual(['stopped', 'already-here', 'generic', 'no-name']);
    const nobody = await keep('999', [found('Ida Marsh', 'ida.marsh@kestrel-yard.dev')]);
    expect(nobody.refused).toEqual([{ email: 'ida.marsh@kestrel-yard.dev', reason: 'no-company' }]);
    expect((await foundRows()).length).toBe(before);
    expect(await contactOf('ida.marsh@kestrel-yard.dev')).toBeUndefined();
  });

  it.skipIf(!available)('a person kept at a French company is mailed at once in French, with the engine’s sentences and the Object block; told_at is set as it goes', async () => {
    // The add-on's tell text switched off: the mail is locked on while people are kept.
    for (const row of await emailTemplatesRepo(h.meta).siblings('company-finder-tell')) await h.meta.db.updateTable('adminium_email_templates').set({ enabled: 0 } as never).where('id', '=', row.id).execute();
    await mails();
    const answer = await keep('2', [found('Camille Roux', 'camille.roux@saone-clair.dev')]);
    expect(answer.kept).toHaveLength(1);
    const contact = await contactOf('camille.roux@saone-clair.dev');
    expect(contact).toMatchObject({ name: 'Camille Roux', company_id: 2 });
    expect([0, false, '0']).toContain(contact!['may_email']);
    const row = (await foundRows()).find((one) => String(one['person_key']) === String(contact!['id']))!;
    expect(row).toMatchObject({ person_table: 'crm:contacts', company_table: 'crm:companies', company_key: '2', source: 'hunter', state: 'waiting', email: 'camille.roux@saone-clair.dev' });
    expect(row['told_at']).toBeNull();
    // Only the https page is kept.
    expect(row['source_pages']).toBe('https://www.kestrel-yard.example/team');
    const queued = (await tellRows()).find((one) => String(one['found_person_id']) === String(row['id']))!;
    expect(queued).toMatchObject({ kind: 'tell', status: 'queued', to_address: 'camille.roux@saone-clair.dev', language: 'fr-FR' });
    expect(String(row['outbox_id'])).toBe(String(queued['id']));

    await send();
    const [mail] = await mails();
    expect(mail!.to).toBe('camille.roux@saone-clair.dev');
    expect(mail!.subject).toBe('Pourquoi nous avons vos coordonnées');
    expect(mail!.text).toContain('Bonjour Camille,');
    expect(mail!.text).toContain('en tant que membre de Atelier Saône Clair.');
    expect(mail!.text).toContain('Hunter (hunter.io) a trouvé votre adresse e-mail de travail le');
    expect(mail!.text).toContain(`Pourquoi nous les gardons : ${PURPOSE['fr-FR']}`);
    expect(mail!.text).toContain('RGPD, article 6, paragraphe 1, point f');
    expect(mail!.text).toContain('Nous gardons vos coordonnées 3 ans à partir du');
    expect(mail!.text).toContain('l’autorité chargée de la confidentialité des données');
    expect(mail!.text).toContain('https://www.meridian.example/privacy');
    expect(mail!.text).toContain('Vous ne voulez pas que nous gardions vos coordonnées ?');
    expect(mail!.text).toContain('Des questions ? Écrivez à privacy@meridian.example.');
    expect(mail!.text).not.toContain('Why we keep them');
    objectLinkIn(mail!.html);
    const told = (await foundRows()).find((one) => one['id'] === row['id'])!;
    expect(told['state']).toBe('told');
    expect(told['told_at']).not.toBeNull();
    expect((await tellRows()).find((one) => one['id'] === queued['id'])!['status']).toBe('sent');
  });

  it.skipIf(!available)('a person kept at a company of another country is told in the install’s language and in English', async () => {
    await settings().set('locale.default', 'de_DE', { updatedBy: null });
    await setPeople({ purpose: { ...PURPOSE, 'de-DE': 'Um Ihrem Büro Zeichentische anzubieten.' } });
    try {
      await mails();
      expect((await keep('3', [found('Sigrid Holm', 'sigrid.holm@fjordlys.dev')])).kept).toHaveLength(1);
      await send();
      const [mail] = await mails();
      expect(mail!.subject).toBe('Warum wir Ihre Daten haben / Why we have your details');
      expect(mail!.text).toContain('Warum wir sie aufbewahren: Um Ihrem Büro Zeichentische anzubieten.');
      expect(mail!.text).toContain(`Why we keep them: ${PURPOSE['en-US']}`);
      expect(mail!.text.indexOf('Warum wir sie aufbewahren')).toBeLessThan(mail!.text.indexOf('Why we keep them'));
    } finally {
      await settings().set('locale.default', 'en_US', { updatedBy: null });
      await setPeople({ purpose: PURPOSE });
    }
  });

  it.skipIf(!available)('until told, an app’s mail, a campaign row, a rule’s e-mail step and a chat reply to them are each refused', async () => {
    await mails();
    const address = 'otto.lark@kestrel-yard.dev';
    expect((await keep('1', [found('Otto Lark', address)])).kept).toHaveLength(1);
    const contact = await contactOf(address);
    expect(await untoldAddress(composed.leads.deps, address)).toBe(true);
    expect(await untoldAddress(composed.leads.deps, ' OTTO.Lark@kestrel-yard.dev ')).toBe(true);

    // The app's own mail.
    await insert('mails', { id: 900, kind: 'welcome', status: 'queued', to_address: address, contact_id: contact!['id'] });
    await composed.app.outboxSender.sendApp('crm');
    expect((await rows(`SELECT status, error FROM ${table('crm', 'mails')} WHERE id = 900`))[0]).toMatchObject({ status: 'skipped', error: UNTOLD_SENTENCE.slice(0, 120) });
    // A campaign's row.
    const checks = campaignMarketingChecks({ meta: h.meta, marketing: createMarketingMail({ meta: h.meta, secret: TEST_SECRET }), secret: TEST_SECRET, untold: (one) => untoldAddress(composed.leads.deps, one) });
    const run = { id: 'run_1', mailClass: 'marketing', audience: {}, basis: 'consent' } as unknown as EmailRun;
    const row = { id: 'snd_1', address, connectionId: conn, personTable: null, personKey: null } as unknown as EmailSend;
    expect(await checks.checkRow(row, run)).toEqual({ skip: 'skipped-consent', reason: CAMPAIGN_SKIP_NOT_TOLD });
    expect(await checks.checkRow(row, { ...run, mailClass: 'service' } as EmailRun)).toEqual({ skip: 'skipped-consent', reason: CAMPAIGN_SKIP_NOT_TOLD });
    // A rule's e-mail step.
    const ctx = { meta: h.meta, manager: h.manager, rule: { id: 'rul_1', name: 'Welcome', connectionId: null }, runId: 'run_1', hops: 0, now: Date.now(), source: null, tokens: {}, text: TRACE_EN, secret: TEST_SECRET } as unknown as ActionContext;
    const step = await runEmailAction({ kind: 'email', templateKey: 'crm-welcome', to: { kind: 'fixed', addresses: [address] }, vars: {} } as never, ctx);
    expect(step.log).toContain(UNTOLD_SENTENCE);
    // A chat reply.
    const reply = await mailChatReply({ meta: h.meta, secret: TEST_SECRET, caps: composed.chat.caps, chat: { addOn: 'live-chat', connectionId: conn, installId: 'x' }, conversation: { id: '1', email: address, language: 'en-US' }, reply: 'Hi', sample: false, at: Date.now(), untold: (one) => untoldAddress(composed.leads.deps, one) });
    expect(reply).toEqual({ mailed: false, reason: 'not-told' });

    // Told: the app's mail goes.
    await send();
    expect(await untoldAddress(composed.leads.deps, address)).toBe(false);
    await insert('mails', { id: 901, kind: 'welcome', status: 'queued', to_address: address, contact_id: contact!['id'] });
    await composed.app.outboxSender.sendApp('crm');
    expect((await rows(`SELECT status FROM ${table('crm', 'mails')} WHERE id = 901`))[0]!['status']).toBe('sent');
    await mails();
  });

  it.skipIf(!available)('a tell mail that failed, still untold at its deadline: the sweep erases the person, with its audit entry', async () => {
    await mails();
    const address = 'pia.vance@kestrel-yard.dev';
    expect((await keep('1', [found('Pia Vance', address)])).kept).toHaveLength(1);
    // No public address: the mail cannot carry its link, so it fails.
    await settings().set('system.publicOrigin', null, { updatedBy: null });
    try {
      await send();
    } finally {
      await settings().set('system.publicOrigin', ORIGIN, { updatedBy: null });
    }
    const contact = (await contactOf(address))!;
    const row = (await foundRows()).find((one) => String(one['person_key']) === String(contact['id']))!;
    expect(row['state']).toBe('failed');
    expect(row['told_at']).toBeNull();
    expect((await tellRows()).find((one) => String(one['found_person_id']) === String(row['id']))!['status']).toBe('failed');
    const erase = (one: string, scope?: Parameters<typeof erasePerson>[2]) => erasePerson(eraseDeps(), one, scope);
    // On the day itself nothing happens; the day after, they are erased.
    const tellBy = Date.parse(`${String(row['tell_by']).slice(0, 10)}T12:00:00Z`);
    expect(await sweepFoundPeople({ meta: h.meta, manager: h.manager, consent: consent(), erase, now: () => tellBy })).toEqual({ 'tell-by': 0, 'kept-for': 0 });
    const done = await sweepFoundPeople({ meta: h.meta, manager: h.manager, consent: consent(), erase, now: () => tellBy + DAY });
    expect(done['tell-by']).toBe(1);
    expect((await foundRows()).some((one) => one['id'] === row['id'])).toBe(false);
    expect(await contactOf(address)).toBeUndefined();
    expect(await consent().stop.has(address)).toBe(true);
    const audit = (await auditRepo(h.meta).list({ category: 'data', limit: 20 })).find((entry) => entry.action === 'privacy.erase' && (entry.changes?.after as Doc | undefined)?.['why'] === 'tell-by');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain(address);
  });

  it.skipIf(!available)('Object: a GET changes nothing; the POST stops and erases them, and they cannot be kept again; a forged link is dead', async () => {
    await mails();
    const address = 'jonas.reed@kestrel-yard.dev';
    expect((await keep('1', [found('Jonas Reed', address)])).kept).toHaveLength(1);
    await send();
    const [mail] = await mails();
    const link = objectLinkIn(mail!.html);
    const contact = (await contactOf(address))!;
    const foundRow = (await foundRows()).find((one) => String(one['person_key']) === String(contact['id']))!;
    // A field a source filled on their row, as the lead door records one.
    await insert('field_sources', { id: 700, table_ref: 'crm:contacts', row_key: String(contact['id']), column_name: 'name', source: 'hunter', found_at: new Date().toISOString(), value_hash: 'a'.repeat(64) }, 'company-finder');

    const page = await stranger('GET', link);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Object to Meridian keeping your details?');
    expect(page.body).toContain(address);
    expect(page.body).toContain('name="act" value="object"');
    expect(page.headers['cache-control']).toBe('no-store');
    // Nothing changed.
    expect((await foundRows()).some((one) => one['id'] === foundRow['id'])).toBe(true);
    expect(await consent().stop.has(address)).toBe(false);

    // A forged link: one character changed.
    const forged = link.slice(0, -2) + (link.at(-2) === 'A' ? 'B' : 'A') + link.at(-1)!;
    const dead = await stranger('GET', forged);
    expect(dead.statusCode).toBe(404);
    expect(dead.body).toContain('This link doesn’t work. Write to privacy@meridian.example.');

    const done = await stranger('POST', link, 'act=object');
    expect(done.statusCode, done.body).toBe(200);
    expect(done.body).toContain('Done. We have deleted your details and won’t write to you again.');
    expect((await foundRows()).some((one) => one['id'] === foundRow['id'])).toBe(false);
    expect((await tellRows()).some((one) => String(one['found_person_id']) === String(foundRow['id']) || one['to_address'] === address)).toBe(false);
    expect(await rows(`SELECT * FROM ${table('company-finder', 'field_sources')} WHERE id = 700`)).toEqual([]);
    expect(await contactOf(address)).toBeUndefined();
    expect(await rows(`SELECT * FROM ${table('crm', 'contacts')} WHERE id = ${String(contact['id'])}`)).toEqual([]);
    expect(await consent().stop.has(address)).toBe(true);
    const object = (await auditRepo(h.meta).list({ category: 'leads', limit: 20 })).find((entry) => entry.action === 'leads.object')!;
    expect((object.changes?.after as Doc)['told']).toHaveLength(1);
    expect(JSON.stringify(object)).not.toContain(address);

    // Again: already objected.
    expect((await stranger('GET', link)).body).toContain('You’ve already objected. Meridian doesn’t keep your details.');
    // Found again: not kept.
    expect((await keep('1', [found('Jonas Reed', address)])).refused).toEqual([{ email: address, reason: 'stopped' }]);
  });

  it.skipIf(!available)('Object with a deal linked: the contact stays, emptied, and the page says what stays', async () => {
    await mails();
    const address = 'mara.voss@kestrel-yard.dev';
    expect((await keep('1', [found('Mara Voss', address)])).kept).toHaveLength(1);
    await send();
    const [mail] = await mails();
    const contact = (await contactOf(address))!;
    await insert('deals', { id: 31, title: 'Plan chests for the new studio', contact_id: contact['id'] });
    const done = await stranger('POST', objectLinkIn(mail!.html), 'act=object');
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain('Meridian keeps its own records that named you, with your details taken out:');
    const deals = (await loadSnapshotView(h.meta, conn, { forOthers: true })).table(table('crm', 'deals'));
    expect(done.body).toContain(`${deals.table.label ?? deals.name}.`);
    const left = (await rows(`SELECT * FROM ${table('crm', 'contacts')} WHERE id = ${String(contact['id'])}`))[0]!;
    expect(left['name']).toBe('Erased person');
    expect(String(left['email'] ?? '')).not.toContain('mara.voss');
    expect((await rows(`SELECT contact_id FROM ${table('crm', 'deals')} WHERE id = 31`))[0]!['contact_id']).toEqual(contact['id']);
  });

  it.skipIf(!available)('"may be e-mailed" on a found person: the tick is refused, consent without a note is refused, and with one a campaign takes them', async () => {
    await mails();
    const address = 'noor.hale@kestrel-yard.dev';
    expect((await keep('1', [found('Noor Hale', address)])).kept).toHaveLength(1);
    await send();
    const contact = (await contactOf(address))!;
    const contactsId = await idOf('crm', 'contacts');
    const tick = await as('finn', 'PATCH', `/api/v1/data/${conn}/${encodeURIComponent(contactsId)}/${String(contact['id'])}`, { values: { may_email: true } });
    expect(tick.statusCode).toBe(422);
    expect(tick.body).toContain(FOUND_TICK_REFUSED);
    // Another contact's tick still saves.
    expect((await as('finn', 'PATCH', `/api/v1/data/${conn}/${encodeURIComponent(contactsId)}/50`, { values: { may_email: true } })).statusCode).toBe(200);

    const record = (note: string | null) => as('finn', 'POST', '/api/v1/consent/record-consent', { connectionId: conn, table: contactsId, recordId: String(contact['id']), purpose: 'newsletter', how: 'phone', note });
    const refused = await record(null);
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('HOW_THEY_AGREED');
    expect((await record('x'.repeat(201))).statusCode).toBe(422);
    const recorded = await record('Rang her on 30 Jul; she asked for the newsletter.');
    expect(recorded.statusCode, recorded.body).toBe(200);
    const checks = campaignMarketingChecks({ meta: h.meta, marketing: createMarketingMail({ meta: h.meta, secret: TEST_SECRET }), secret: TEST_SECRET, untold: (one) => untoldAddress(composed.leads.deps, one) });
    const run = { id: 'run_2', mailClass: 'marketing', audience: {}, basis: 'consent' } as unknown as EmailRun;
    expect(await checks.checkRow({ id: 'snd_2', address, connectionId: conn, personTable: contactsId, personKey: String(contact['id']) } as unknown as EmailSend, run)).toBe('send');
  });

  it.skipIf(!available)('their download carries the source, the date, the told record and the pages; their erasure keeps only the day they were told', async () => {
    await mails();
    const address = 'elif.stone@kestrel-yard.dev';
    expect((await keep('1', [found('Elif Stone', address)])).kept).toHaveLength(1);
    await send();
    const person = await findPerson(eraseDeps(), address);
    const of = (kind: string) => person.sources.find((one) => one.kind === kind);
    expect(of('found-people')).toMatchObject({ app: 'company-finder', group: 'held', count: 1 });
    const exported = of('found-people')!.rows[0]!;
    expect(exported).toMatchObject({ foundBy: 'hunter', state: 'told', sourcePages: ['https://www.kestrel-yard.example/team'], purpose: PURPOSE['en-US'] });
    expect(exported['foundAt']).toBeTruthy();
    expect(exported['toldAt']).toBeTruthy();
    expect((exported['fields'] as Doc[]).map((one) => one['column'])).toEqual(['name', 'email']);
    expect(of('found-people-mail')).toMatchObject({ count: 1 });

    // Found by the address they were found with, though their contact's address has changed since.
    const contact = (await contactOf(address))!;
    const { db } = await h.manager.data(conn);
    await db.updateTable(table('crm', 'contacts') as never).set({ email: 'elif.s@another-desk.dev' } as never).where('id' as never, '=', contact['id'] as never).execute();
    expect((await findPerson(eraseDeps(), address)).sources.find((one) => one.kind === 'found-people')).toMatchObject({ count: 1 });
    expect((await findPerson(eraseDeps(), address)).sources.find((one) => one.kind === 'found-people')!.rows[0]).toMatchObject({ email: address });
    await db.updateTable(table('crm', 'contacts') as never).set({ email: address } as never).where('id' as never, '=', contact['id'] as never).execute();

    const result = await erasePerson(eraseDeps(), address);
    expect(result.told).toHaveLength(1);
    expect(result.told[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.counts['found-people-company-finder']).toBe(1);
    expect(result.counts['found-people-mail-company-finder']).toBe(1);
    expect((await findPerson(eraseDeps(), address)).sources.filter((one) => one.kind.startsWith('found-people'))).toEqual([]);
  });

  it.skipIf(!available)('the privacy notice says what it must also name while people are kept, and takes an optional data privacy contact', async () => {
    if (cookies['priya'] === undefined) await person('priya', 'Priya Lane', ['system:privacy:manage']);
    const read = await as('priya', 'GET', '/api/v1/privacy/notice');
    expect(read.statusCode, read.body).toBe(200);
    const data = (read.json() as Doc).data as Doc;
    expect(data['dpoContact']).toBe('privacy@meridian.example');
    expect(data['peopleFound']).toHaveLength(1);
    expect(data['peopleFound'][0]).toMatchObject({ addOn: { key: 'company-finder' } });
    expect((data['peopleFound'][0].sources as Doc[]).find((one) => one['id'] === 'hunter')).toMatchObject({ name: 'Hunter (hunter.io)', hosts: ['api.hunter.io'], website: false });
    expect((data['peopleFound'][0].sources as Doc[]).find((one) => one['id'] === 'website')).toMatchObject({ website: true });
    expect(data['peopleFound'][0].recipients).toContain('api.hunter.io');
    const body = { businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy' };
    expect((await as('priya', 'PUT', '/api/v1/privacy/notice', { ...body, dpoContact: 'not an address' })).statusCode).toBe(422);
    const saved = await as('priya', 'PUT', '/api/v1/privacy/notice', { ...body, dpoContact: 'dpo@meridian.example' });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await settings().get('privacy.dpoContact')).toBe('dpo@meridian.example');
    // Left out: unchanged.
    expect((await as('priya', 'PUT', '/api/v1/privacy/notice', body)).statusCode).toBe(200);
    expect(await settings().get('privacy.dpoContact')).toBe('dpo@meridian.example');
    await settings().set('privacy.dpoContact', 'privacy@meridian.example', { updatedBy: null });
    // The keeping table has a row for them, in months.
    const keeping = (await as('priya', 'GET', '/api/v1/privacy/keeping')).json() as Doc;
    expect((keeping.data.rows as Doc[]).find((one) => one['key'] === 'found-people')).toMatchObject({ keptFor: 36, addOn: { key: 'company-finder' } });
  });

  // ── the gate's fixes ──────────────────────────────────────────────────────

  /** Keeps one person at a company, sends their tell mail, and answers their Object link, contact row and found row. */
  async function keptAndTold(company: string, name: string, address: string, extra: Partial<KeepFoundPeopleInput> = {}): Promise<{ link: string; contact: Doc; found: Doc; mail: { text: string } }> {
    await mails();
    const answer = await composed.leads.keep({ installId, addOnKey: 'company-finder', staff: staff('finn'), company: { table: 'crm:companies', key: company }, source: 'hunter', people: [found(name, address)], ...extra });
    expect(answer.kept, JSON.stringify(answer.refused)).toHaveLength(1);
    await send();
    const mail = (await mails()).find((one) => one.to === address)!;
    expect(mail, 'the tell mail went').toBeDefined();
    const contact = (await contactOf(address))!;
    const row = (await foundRows()).find((one) => String(one['person_key']) === String(contact['id']))!;
    return { link: objectLinkIn(mail.html), contact, found: row, mail };
  }
  const contactById = async (id: unknown) => (await rows(`SELECT * FROM ${table('crm', 'contacts')} WHERE id = ${String(id)}`))[0];
  const sweepAt = (at: number) => sweepFoundPeople({ meta: h.meta, manager: h.manager, consent: consent(), erase: (one, scope) => erasePerson(eraseDeps(), one, scope), now: () => at });
  const keptUntil = (row: Doc) => yearsAfter(foundRowOf({ primaryKey: ['id'] }, row)!.foundAt, 3);

  it.skipIf(!available)('Object on a contact row given to someone else since erases only the address the mail went to: the new contact keeps everything', async () => {
    const jane = await keptAndTold('1', 'Jane Fell', 'jane.fell@kestrel-yard.dev');
    // Jane left; Bob is the contact now, with a deal of his own.
    const { db } = await h.manager.data(conn);
    await db.updateTable(table('crm', 'contacts') as never).set({ name: 'Bob Marsh', email: 'bob.marsh@kestrel-yard.dev' } as never).where('id' as never, '=', jane.contact['id'] as never).execute();
    await insert('deals', { id: 41, title: 'Plan chests for Bob', contact_id: jane.contact['id'] });

    const done = await stranger('POST', jane.link, 'act=object');
    expect(done.statusCode, done.body).toBe(200);
    expect(done.body).toContain('Done. We have deleted your details');
    // Bob is untouched: his row, his address, his name, and he is not stopped.
    expect(await contactById(jane.contact['id'])).toMatchObject({ name: 'Bob Marsh', email: 'bob.marsh@kestrel-yard.dev' });
    expect(await consent().stop.has('bob.marsh@kestrel-yard.dev')).toBe(false);
    // Jane is stopped, and her found person's row is gone.
    expect(await consent().stop.has('jane.fell@kestrel-yard.dev')).toBe(true);
    expect((await foundRows()).some((one) => one['id'] === jane.found['id'])).toBe(false);
  });

  it.skipIf(!available)('a link whose found person was erased names nobody, even when their row id was given to someone else (SQLite)', async () => {
    const ada = await keptAndTold('1', 'Ada Reuse', 'ada.reuse@kestrel-yard.dev');
    // Ada erased (a privacy request); Ben found next.
    await erasePerson(eraseDeps(), 'ada.reuse@kestrel-yard.dev');
    const ben = await keptAndTold('1', 'Ben Reuse', 'ben.reuse@kestrel-yard.dev');
    // SQLite gives Ben Ada's old id: the link's id alone would name him.
    if (dialect === 'sqlite') expect(String(ben.found['id'])).toBe(String(ada.found['id']));

    const page = await stranger('GET', ada.link);
    expect(page.body).toContain('You’ve already objected.');
    expect(page.body).not.toContain('name="act" value="object"');
    const done = await stranger('POST', ada.link, 'act=object');
    expect(done.body).not.toContain('Done.');
    // Ben is untouched.
    expect(await contactById(ben.contact['id'])).toMatchObject({ name: 'Ben Reuse', email: 'ben.reuse@kestrel-yard.dev' });
    expect((await foundRows()).some((one) => one['id'] === ben.found['id'])).toBe(true);
    expect(await consent().stop.has('ben.reuse@kestrel-yard.dev')).toBe(false);
  });

  it.skipIf(!available)('a link names the moment its person was found: the same address found again later is someone the old link never named', async () => {
    const first = await keptAndTold('1', 'Rhea Stone', 'rhea.stone@kestrel-yard.dev');
    // Their rows removed without stopping the address (as an erasure narrowed to one app leaves it), then found again.
    const { db } = await h.manager.data(conn);
    await db.deleteFrom(table('company-finder', 'tell_mails') as never).where('found_person_id' as never, '=', first.found['id'] as never).execute();
    await db.deleteFrom(table('company-finder', 'found_people') as never).where('id' as never, '=', first.found['id'] as never).execute();
    await db.deleteFrom(table('crm', 'contacts') as never).where('id' as never, '=', first.contact['id'] as never).execute();
    const again = await keptAndTold('1', 'Rhea Stone', 'rhea.stone@kestrel-yard.dev');
    if (dialect === 'sqlite') expect(String(again.found['id'])).toBe(String(first.found['id']));
    const old = await stranger('GET', first.link);
    expect(old.statusCode).toBe(404);
    expect(old.body).toContain('This link doesn’t work.');
    expect((await stranger('POST', first.link, 'act=object')).body).not.toContain('Done.');
    expect((await foundRows()).some((one) => one['id'] === again.found['id'])).toBe(true);
    // The link of the mail that told them now works.
    expect((await stranger('GET', again.link)).body).toContain('name="act" value="object"');
  });

  it.skipIf(!available)('a sole trader is one unit: told that staff typed their address; Object, the deadline and a privacy erasure each empty their company row too; their download carries it', async () => {
    const soleTrader = async (id: number, name: string, address: string) => {
      await insert('companies', { id, name, country: 'FR', website: `https://www.${name.toLowerCase().replace(/\W+/g, '-')}.example` });
      // A field the register filled on the company row, as the door notes it.
      await insert('field_sources', { id: 800 + id, table_ref: 'crm:companies', row_key: String(id), column_name: 'name', source: 'france', found_at: new Date().toISOString(), value_hash: 'b'.repeat(64) }, 'company-finder');
      return keptAndTold(String(id), name, address, { source: 'france', soleTrader: true });
    };
    const emptied = async (id: number) => {
      const row = (await rows(`SELECT * FROM ${table('crm', 'companies')} WHERE id = ${String(id)}`))[0]!;
      expect(row['name']).toBe('Erased person');
      expect(row['website'] ?? null).toBeNull();
      expect(row['country'] ?? null).toBeNull();
      expect(await rows(`SELECT * FROM ${table('company-finder', 'field_sources')} WHERE table_ref = 'crm:companies' AND row_key = '${String(id)}'`)).toEqual([]);
    };

    // 1. Told in their language that a member of staff typed their address; Object empties the row.
    const claire = await soleTrader(61, 'Claire Vernet', 'claire.vernet@vernet-atelier.dev');
    expect(claire.mail.text).toContain('a fourni les informations enregistrées de votre entreprise');
    expect(claire.mail.text).toContain('Un membre de notre équipe a ajouté votre adresse e-mail.');
    const person = await findPerson(eraseDeps(), 'claire.vernet@vernet-atelier.dev');
    const exported = person.sources.find((one) => one.kind === 'found-people')!.rows[0]!;
    expect((exported['fields'] as Doc[]).find((one) => one['column'] === 'email')).toMatchObject({ source: 'staff' });
    expect(exported['soleTrader']).toMatchObject({ table: 'crm:companies', row: '61', values: { name: 'Claire Vernet', country: 'FR' }, fields: [expect.objectContaining({ column: 'name', source: 'france' })] });
    expect((await stranger('POST', claire.link, 'act=object')).statusCode).toBe(200);
    await emptied(61);

    // 2. Never told by their day: the sweep empties it.
    const lucie = await soleTrader(62, 'Lucie Morel', 'lucie.morel@morel-plans.dev');
    const { db } = await h.manager.data(conn);
    await db.updateTable(table('company-finder', 'found_people') as never).set({ told_at: null, state: 'failed' } as never).where('id' as never, '=', lucie.found['id'] as never).execute();
    const tellBy = Date.parse(`${String(lucie.found['tell_by']).slice(0, 10)}T12:00:00Z`);
    await sweepAt(tellBy + DAY);
    await emptied(62);

    // 3. A privacy erasure by the address.
    await soleTrader(63, 'Anne Brisac', 'anne.brisac@brisac-dessin.dev');
    await erasePerson(eraseDeps(), 'anne.brisac@brisac-dessin.dev');
    await emptied(63);
  });

  it.skipIf(!available)('the keeping sweep erases only what the finding stored, by the address they were found with, and never a person who agreed or became a customer', async () => {
    const { db } = await h.manager.data(conn);
    // One whose contact row was given to someone else since.
    const kim = await keptAndTold('1', 'Kim Rowe', 'kim.rowe@kestrel-yard.dev');
    await db.updateTable(table('crm', 'contacts') as never).set({ name: 'Lee Dunn', email: 'lee.dunn@kestrel-yard.dev' } as never).where('id' as never, '=', kim.contact['id'] as never).execute();
    // One who later wrote to the business through a form, so is kept elsewhere too.
    const max = await keptAndTold('1', 'Max Hale', 'max.hale@kestrel-yard.dev');
    await insert('contacts', { id: 7001, name: 'Max Hale', email: 'max.hale@kestrel-yard.dev', company_id: 1, may_email: dialect === 'sqlite' ? 0 : false });
    // One who agreed to be written to; one who became a customer.
    const ivy = await keptAndTold('1', 'Ivy Lane', 'ivy.lane@kestrel-yard.dev');
    const contactsId = await idOf('crm', 'contacts');
    expect((await as('finn', 'POST', '/api/v1/consent/record-consent', { connectionId: conn, table: contactsId, recordId: String(ivy.contact['id']), purpose: 'newsletter', how: 'phone', note: 'Rang her; she asked for the newsletter.' })).statusCode).toBe(200);
    const ray = await keptAndTold('1', 'Ray Cole', 'ray.cole@kestrel-yard.dev');
    await db.updateTable(table('crm', 'contacts') as never).set({ is_customer: dialect === 'sqlite' ? 1 : true } as never).where('id' as never, '=', ray.contact['id'] as never).execute();

    await sweepAt(Math.max(...[kim, max, ivy, ray].map((one) => keptUntil(one.found))) + DAY);

    // Lee, now on Kim's row, keeps everything; Kim is stopped and her found row gone.
    expect(await contactById(kim.contact['id'])).toMatchObject({ name: 'Lee Dunn', email: 'lee.dunn@kestrel-yard.dev' });
    expect(await consent().stop.has('lee.dunn@kestrel-yard.dev')).toBe(false);
    expect(await consent().stop.has('kim.rowe@kestrel-yard.dev')).toBe(true);
    expect((await foundRows()).some((one) => one['id'] === kim.found['id'])).toBe(false);
    // Max's found contact is emptied; the contact he made himself is not the finding's, and stays.
    expect(String((await contactById(max.contact['id']))!['email'] ?? '')).not.toContain('max.hale');
    expect(await contactById(7001)).toMatchObject({ name: 'Max Hale', email: 'max.hale@kestrel-yard.dev' });
    // Ivy (agreed) and Ray (a customer) are ordinary contacts: nothing of them goes.
    expect(await contactById(ivy.contact['id'])).toMatchObject({ name: 'Ivy Lane', email: 'ivy.lane@kestrel-yard.dev' });
    expect(await contactById(ray.contact['id'])).toMatchObject({ name: 'Ray Cole', email: 'ray.cole@kestrel-yard.dev' });
    expect((await foundRows()).some((one) => one['id'] === ivy.found['id'])).toBe(true);
    expect((await foundRows()).some((one) => one['id'] === ray.found['id'])).toBe(true);
  });

  it.skipIf(!available)('the keeping time restarts on the person’s own later word (a form’s answer)', async () => {
    const zoe = await keptAndTold('1', 'Zoe Brandt', 'zoe.brandt@kestrel-yard.dev');
    const until = keptUntil(zoe.found);
    const later = until - 30 * DAY;
    await consent().record({ person: null, address: 'zoe.brandt@kestrel-yard.dev', purpose: 'surveys', state: 'no', source: 'form', at: later });
    await sweepAt(until + DAY);
    expect(await contactById(zoe.contact['id'])).toMatchObject({ email: 'zoe.brandt@kestrel-yard.dev' });
    await sweepAt(yearsAfter(later, 3) + DAY);
    expect(String((await contactById(zoe.contact['id']))!['email'] ?? '')).not.toContain('zoe.brandt');
  });

  it.skipIf(!available)('a person whose found row cannot be written is not kept at all: their contact goes again, and they are not held back from mail', async () => {
    const before = (await foundRows()).length;
    const failing = (writes: Doc) => keepFoundPeople({ ...composed.leads.deps, writes: { ...composed.leads.deps.writes, ...writes } as never }, { installId, addOnKey: 'company-finder', staff: staff('finn'), company: { table: 'crm:companies', key: '1' }, source: 'hunter', people: [found('Nell Price', 'nell.price@kestrel-yard.dev')] });
    await expect(failing({ check: async () => { throw new Error('a dropped connection'); } })).rejects.toThrow('a dropped connection');
    expect(await contactOf('nell.price@kestrel-yard.dev')).toBeUndefined();
    // The tell mail could not be queued: the found row goes with the contact.
    await expect(failing({ create: async () => { throw new Error('the outbox refused'); } })).rejects.toThrow('the outbox refused');
    expect(await contactOf('nell.price@kestrel-yard.dev')).toBeUndefined();
    expect((await foundRows()).length).toBe(before);
    expect(await untoldAddress(composed.leads.deps, 'nell.price@kestrel-yard.dev')).toBe(false);
  });

  it.skipIf(!available)('a drawn document and a pay link are not e-mailed to a person not told yet', async () => {
    await mails();
    const address = 'otis.grey@kestrel-yard.dev';
    // Kept, the tell mail not sent yet.
    expect((await keep('1', [found('Otis Grey', address)])).kept).toHaveLength(1);
    const untold = (one: string) => untoldAddress(composed.leads.deps, one);
    const file = await filesRepo(h.meta).create({ id: 'file_g1_doc', filename: 'Q-7.pdf', mime: 'application/pdf', sizeBytes: 12, sha256: 'x'.repeat(64), kind: 'document', uploadedBy: null, storageKey: 'documents/file_g1_doc.pdf', destinationId: null, storage: 'local' });
    const drawn = await documentsRepo(h.meta).create({ profileId: null, addOnKey: 'invoices', kind: 'quote', connectionId: null, entity: null, subject: { fields: {}, business: { name: 'Meridian', lines: [] } }, locale: 'en-US', format: 'pdf', requestedBy: null, actorKind: 'system', jobId: null });
    const document = (await documentsRepo(h.meta).markRendered(drawn.id, { number: 'Q-7', fileId: file.id, htmlFileId: null, format: 'pdf' }, Date.now()))!;
    expect(await emailDocument({ meta: h.meta, secret: TEST_SECRET, untold }, { document, profile: null, to: address })).toBe('not-sent:not-told');
    expect((await documentsRepo(h.meta).findById(document.id))?.delivery).toBe('not-sent:not-told');
    const payable = { ref: { kind: 'profile', connectionId: conn, tableName: 'invoices', rowKey: '1' }, label: 'INV-7', currency: 'GBP', total: '10.00', due: '10.00', dueDate: null, refusal: null, customerEmail: address } as unknown as ResolvedPayable;
    const link = { id: 'pl_g1', expiresAt: Date.now() + DAY } as unknown as PaymentLink;
    expect(await sendPayLinkEmail({ meta: h.meta, secret: TEST_SECRET, sources: {} as never, untold }, { link, url: 'https://crm.meridian.example/pay/x', payable })).toEqual({ sent: false, reason: 'not-told' });
    expect(await mails()).toEqual([]);
    // Told: both go.
    await send();
    await mails();
    expect(await emailDocument({ meta: h.meta, secret: TEST_SECRET, untold }, { document, profile: null, to: address })).toBe('sent');
    expect(await sendPayLinkEmail({ meta: h.meta, secret: TEST_SECRET, sources: {} as never, untold }, { link, url: 'https://crm.meridian.example/pay/x', payable })).toMatchObject({ sent: true, to: address });
    await mails();
  });

  it.skipIf(!available)('a tell mail goes only to the address its person was found with', async () => {
    await mails();
    const address = 'cara.wynn@kestrel-yard.dev';
    // Kept, then their queued tell mail is pointed elsewhere.
    expect((await keep('1', [found('Cara Wynn', address)])).kept).toHaveLength(1);
    const contact = (await contactOf(address))!;
    const row = (await foundRows()).find((one) => String(one['person_key']) === String(contact['id']))!;
    const { db } = await h.manager.data(conn);
    await db.updateTable(table('company-finder', 'tell_mails') as never).set({ to_address: 'someone.else@kestrel-yard.dev' } as never).where('found_person_id' as never, '=', row['id'] as never).execute();
    await send();
    expect((await mails()).map((one) => one.to)).not.toContain('someone.else@kestrel-yard.dev');
    const after = (await foundRows()).find((one) => one['id'] === row['id'])!;
    expect(after['told_at']).toBeNull();
    expect(after['state']).not.toBe('told');
  });

  it.skipIf(!available)('who is not told yet is read once for a batch, and read again at once when someone is kept', async () => {
    // Whatever an earlier test left held: read again from here.
    untoldChanged(h.meta);
    let reads = 0;
    const counted = { ...composed.leads.deps, manager: { data: async (id: string) => ((reads += 1), h.manager.data(id)) } };
    expect(await untoldAddress(counted, 'nobody.yet@kestrel-yard.dev')).toBe(false);
    const first = reads;
    expect(first).toBeGreaterThan(0);
    for (let n = 0; n < 50; n += 1) await untoldAddress(counted, `row.${String(n)}@kestrel-yard.dev`);
    expect(reads).toBe(first);
    // Kept now: held back at once, though the set was read a moment ago.
    expect((await keep('1', [found('Pip Ford', 'pip.ford@kestrel-yard.dev')])).kept).toHaveLength(1);
    expect(await untoldAddress(counted, 'pip.ford@kestrel-yard.dev')).toBe(true);
    await send();
    expect(await untoldAddress(counted, 'pip.ford@kestrel-yard.dev')).toBe(false);
    await mails();
  });

  it.skipIf(!available)('the found people table refuses a person’s own write, and keeps its widest values whole', async () => {
    const foundId = await idOf('company-finder', 'found_people');
    const write = await as('finn', 'POST', `/api/v1/data/${conn}/${encodeURIComponent(foundId)}`, { values: { person_table: 'crm:contacts', person_key: '1', source: 'hunter', found_at: new Date().toISOString(), purpose: 'x', tell_by: '2026-12-01', state: 'waiting' } });
    expect(write.statusCode).toBeGreaterThanOrEqual(400);
    expect(write.statusCode).toBeLessThan(500);

    const view = await loadSnapshotView(h.meta, conn, { forOthers: true });
    const { db, dialect: engine } = await h.manager.data(conn);
    const at = Date.UTC(2026, 0, 31, 10);
    const page = `https://www.kestrel-yard.example/${'p'.repeat(60)}`;
    const pages = Array.from({ length: 80 }, (_, n) => `${page}${String(n).padStart(2, '0')}`);
    const id = await insertFound(
      { target: { connectionId: conn, view, table: view.table(table('company-finder', 'found_people')), db, dialect: engine }, writes: composed.leads.deps.writes, context: leadsWriteContext('Company finder') },
      { personTable: 'c'.repeat(64), personKey: 'k'.repeat(200), companyTable: 'd'.repeat(64), companyKey: 'e'.repeat(200), source: 's'.repeat(32), foundAt: at, purpose: 'ü'.repeat(500), tellBy: tellByOf(at, 'UTC'), pages, email: WIDE_ADDRESS },
    );
    const row = (await rows(`SELECT * FROM ${table('company-finder', 'found_people')} WHERE id = ${id}`))[0]!;
    expect(row['person_table']).toBe('c'.repeat(64));
    expect(row['person_key']).toBe('k'.repeat(200));
    expect(row['company_key']).toBe('e'.repeat(200));
    expect(row['source']).toBe('s'.repeat(32));
    expect(row['purpose']).toBe('ü'.repeat(500));
    expect(row['email']).toBe(WIDE_ADDRESS);
    // Found on 31 January: told by 27 February (one month on, clamped to the 28th, less a day).
    expect(String(row['tell_by']).slice(0, 10) === '2026-02-27' || (row['tell_by'] instanceof Date && (row['tell_by'] as Date).getDate() === 27)).toBe(true);
    const kept = String(row['source_pages']);
    expect(kept.length).toBeLessThanOrEqual(4000);
    expect(kept.split('\n').every((line) => pages.includes(line))).toBe(true);
    expect(kept.length).toBeGreaterThan(3900);
    await db.deleteFrom(table('company-finder', 'found_people') as never).where('id' as never, '=', Number(id) as never).execute();
  });
});
