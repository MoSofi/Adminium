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

import { auditRepo, emailTemplatesRepo, paymentSettingsRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo, type EmailRun, type EmailSend } from '@adminium/meta';
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
import { emailSecretKey } from '../src/email/config.js';
import { createMarketingMail } from '../src/email/marketing.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import type { FileStore } from '../src/files/store.js';
import { campaignMarketingChecks, CAMPAIGN_SKIP_NOT_TOLD } from '../src/jobs/email-campaign-checks.js';
import { FOUND_TICK_REFUSED, PEOPLE_SWITCH_REFUSED } from '../src/leads/guard.js';
import { insertFound, leadsWriteContext, tellByOf } from '../src/leads/found-store.js';
import { OBJECT_PATH } from '../src/leads/object-token.js';
import { untoldAddress, UNTOLD_SENTENCE, type KeepFoundPeopleInput } from '../src/leads/people.js';
import { sweepFoundPeople } from '../src/leads/sweep.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
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
          columns: [pk, text('name', 120), text('email', 254, { nullable: true }), { ref: 'company_id', type: 'fk', references: 'companies' }, { ref: 'may_email', type: 'bool', default: false }],
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
      { table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id', consent: { column: 'may_email', purpose: 'newsletter' } },
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
  doc['compatibility'] = { minAdminiumVersion: '0.3.65', requires: ['outbound-http'] };
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
    // The engine writes each tell mail's address itself: the recipient is never read for it.
    recipient: { via: 'found_person_id', table: 'found_people', email: 'person_key' },
    kinds: { tell: 'company-finder-tell' },
    classes: { tell: 'service' },
  };
  doc['emailTemplates'] = [
    {
      key: 'company-finder-tell',
      name: 'Why we have your details',
      locales: {
        'en-US': { subject: 'Why we have your details', blocks: [{ block: 'email.heading', data: { text: 'Why we have your details' } }, { block: 'email.text', data: { text: 'Hello {{first_name}}, we are {{business}}.' } }] },
        'fr-FR': { subject: 'Pourquoi nous avons vos coordonnées', blocks: [{ block: 'email.text', data: { text: 'Bonjour {{first_name}}, nous sommes {{business}}.' } }] },
      },
    },
  ];
  doc['roles'][0].permissions.push('table:@tell_mails:read');
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
    // Where a company's country is (`people.lead`): kept as a server that runs the word keeps it, until this one does.
    const stored = await h.meta.db.selectFrom('adminium_manifests').select(['id', 'manifest']).where('manifestKey', '=', 'crm').executeTakeFirstOrThrow();
    const document = (typeof stored.manifest === 'string' ? JSON.parse(stored.manifest) : stored.manifest) as Doc;
    document['people'][1]['lead'] = { website: 'website', address: { country: 'country' } };
    await h.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify(document) } as never).where('id', '=', stored.id).execute();
    await h.stageAddOn(finder(), { bundled: true, files: { 'dist/server.js': 'export function createLeadSource() { return { checkKey: async () => ({ ok: true }) }; }\n' } });
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

  it.skipIf(!available)('the People switch refuses, saying why, while e-mail, the public address or the purpose is missing; with all set it turns on', async () => {
    // No mail server.
    let reply = await switchOn();
    expect(reply.statusCode, reply.body).toBe(422);
    expect(reply.body).toContain(PEOPLE_SWITCH_REFUSED);
    expect(reply.body).toContain('E-mail isn’t set up: Workspace settings → Email.');
    await settings().set('email.smtp', smtp(), { updatedBy: null });
    // No public address.
    await settings().set('system.publicOrigin', null, { updatedBy: null });
    reply = await switchOn();
    expect(reply.statusCode).toBe(422);
    expect(reply.body).toContain('Set the address in e-mail links: Workspace settings → Senders.');
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
    expect(row).toMatchObject({ person_table: 'crm:contacts', company_table: 'crm:companies', company_key: '2', source: 'hunter', state: 'waiting' });
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
    expect(mail!.text).toContain('Bonjour Camille, nous sommes Meridian');
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
    const erase = (one: string) => erasePerson(eraseDeps(), one);
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
      { personTable: 'c'.repeat(64), personKey: 'k'.repeat(200), companyTable: 'd'.repeat(64), companyKey: 'e'.repeat(200), source: 's'.repeat(32), foundAt: at, purpose: 'ü'.repeat(500), tellBy: tellByOf(at, 'UTC'), pages },
    );
    const row = (await rows(`SELECT * FROM ${table('company-finder', 'found_people')} WHERE id = ${id}`))[0]!;
    expect(row['person_table']).toBe('c'.repeat(64));
    expect(row['person_key']).toBe('k'.repeat(200));
    expect(row['company_key']).toBe('e'.repeat(200));
    expect(row['source']).toBe('s'.repeat(32));
    expect(row['purpose']).toBe('ü'.repeat(500));
    // Found on 31 January: told by 27 February (one month on, clamped to the 28th, less a day).
    expect(String(row['tell_by']).slice(0, 10) === '2026-02-27' || (row['tell_by'] instanceof Date && (row['tell_by'] as Date).getDate() === 27)).toBe(true);
    const kept = String(row['source_pages']);
    expect(kept.length).toBeLessThanOrEqual(4000);
    expect(kept.split('\n').every((line) => pages.includes(line))).toBe(true);
    expect(kept.length).toBeGreaterThan(3900);
    await db.deleteFrom(table('company-finder', 'found_people') as never).where('id' as never, '=', Number(id) as never).execute();
  });
});
