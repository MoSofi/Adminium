// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CRM THAT USES FORMS & SURVEYS, AS AN APP WOULD.
 *
 * The forms add-on as it is built in the add-ons repository (its manifest,
 * its page bundle, its sample), installed beside a small CRM that opens its
 * enquiries and its customer feedback to forms and declares its contacts as
 * people, on a real database per engine, served by the real server. Its
 * package is vouched for as a bundled one is (its bytes recorded as trusted),
 * so its forms are served.
 *
 * Everybody here is signed in as themselves: the add-on's manager and its
 * reader hold the roles the add-on ships; a clerk holds the CRM's enquiries
 * and nothing of Forms; a reader whose answers are limited to one form.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { paymentSettingsRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, usersRepo } from '@adminium/meta';

import { recordDeciderTrust } from '../../../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../../../src/compose.js';
import { decryptSecret, encryptSecret } from '../../../src/config/secrets.js';
import { emailSecretKey } from '../../../src/email/config.js';
import { emailEnvelopeKey } from '../../../src/email/send.js';
import { createApplyService } from '../../../src/llm/apply-service.js';
import { createRunService } from '../../../src/llm/run-service.js';
import { solveProof } from '../../../src/public-api/proof.js';
import { PAY_PAGE_DOC, payPageSchema } from '../../../src/routes/payments/ways.js';
import { addOnHarness, type Dialect, type Harness } from '../../app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from '../../auth-helpers.js';
import { makeEnv, TEST_SECRET } from '../../helpers.js';
import { builtAddOn } from '../harness.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

export const KEY = 'forms';
/** The add-on as built, or null where the checkout or its build is missing (the suites then skip by name). */
export const FORMS = builtAddOn(KEY);
export const HOST = 'forms.meridian.example';
export const ORIGIN = `https://${HOST}`;
export const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, ...more });

/** A small CRM: companies, contacts (its people), jobs done for them, enquiries and feedback opened to forms. */
export function crmApp(): Doc {
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
    compatibility: { minAdminiumVersion: '0.3.41', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'companies', label: 'Companies', columns: [pk, text('name', 80, { label: 'Name' })] },
        {
          ref: 'contacts',
          label: 'Contacts',
          columns: [pk, text('name', 80, { nullable: true, label: 'Name' }), text('email', 254, { nullable: true, label: 'E-mail', rules: { personal: true } }), { ref: 'company_id', type: 'fk', references: 'companies', nullable: true, label: 'Company' }],
        },
        {
          ref: 'jobs',
          label: 'Jobs',
          columns: [pk, text('title', 80, { label: 'Title' }), { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true, label: 'Main contact' }, { ref: 'status', type: 'enum', enum: ['open', 'done'], default: 'open', label: 'Status' }],
        },
        {
          ref: 'enquiries',
          label: 'Enquiries',
          columns: [
            pk,
            text('person', 80, { label: 'Person' }),
            text('email', 254, { nullable: true, label: 'E-mail' }),
            text('message', 1000, { nullable: true, label: 'Message' }),
            { ref: 'state', type: 'enum', enum: ['open', 'closed'], default: 'open', label: 'State' },
            text('source', 200, { nullable: true, label: 'From form' }),
          ],
        },
        {
          ref: 'feedback',
          label: 'Customer feedback',
          columns: [pk, { ref: 'job_id', type: 'fk', references: 'jobs', nullable: true, label: 'Job' }, { ref: 'score', type: 'int', nullable: true, label: 'Score' }, text('text', 1000, { nullable: true, label: 'Text' })],
        },
      ],
    },
    people: [{ table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id' }],
    publicAccess: [
      { table: 'enquiries', methods: ['POST'], key: 'forms', writable: ['person', 'email', 'message', 'source'], defaults: { state: 'open' }, source: 'source', anonymous: { perKeyHour: 100, plainText: ['person'] } },
      { table: 'feedback', methods: ['POST'], key: 'forms', writable: ['job_id', 'score', 'text'], anonymous: { perKeyHour: 100 } },
    ],
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['table:@enquiries:read', 'table:@contacts:read', 'table:@jobs:read', 'page:@crm-jobs:view', 'page:@crm-enquiries:view'] }],
    pages: [
      { ref: 'crm-enquiries', template: 'page-crud', title: { key: 'p.enq', fallback: 'Enquiries' }, nav: { group: 'crm', icon: 'list', order: 1 }, bindings: { rows: 'enquiries' } },
      { ref: 'crm-jobs', template: 'page-crud', title: { key: 'p.jobs', fallback: 'Jobs' }, nav: { group: 'crm', icon: 'list', order: 2 }, bindings: { rows: 'jobs' } },
      { ref: 'crm-feedback', template: 'page-crud', title: { key: 'p.fb', fallback: 'Customer feedback' }, nav: { group: 'crm', icon: 'list', order: 3 }, bindings: { rows: 'feedback' } },
    ],
    frontends: [{ side: 'staff', kind: 'none' }],
  };
}

export interface Reply {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => Doc;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  templateKey: string;
}

export interface FormsWorld {
  h: Harness;
  composed: ComposedServer;
  /** A table's id in the schema the routes speak, by its ref (the CRM's or the add-on's). */
  id: (ref: string) => string;
  /** A table's real name in the database, by its ref. */
  name: (ref: string) => string;
  /** The data route of a table, and of one row. */
  data: (ref: string, key?: string) => string;
  /** A signed-in person's request. */
  as: (who: string, method: string, url: string, payload?: unknown) => Promise<Reply>;
  /** A stranger's request, on the forms host. */
  stranger: (method: string, url: string, payload?: unknown, headers?: Record<string, string>, ip?: string) => Promise<Reply>;
  /** A stranger's answer: a fresh proof for the form, then the send. */
  send: (slug: string, values: Doc, opts?: { t?: string; website?: string; language?: string; ip?: string }) => Promise<Reply>;
  /** A file a stranger uploads for a question of the form, from their address; answers the file's id. */
  upload: (slug: string, question: string, name: string, ip: string, body?: Buffer) => Promise<string>;
  /** The mails queued since the last look, opened (and taken off the queue). */
  mails: () => Promise<Mail[]>;
  /** Runs every job but the mail's own, as the worker would. */
  runJobs: () => Promise<void>;
  rows: (ref: string, where?: string) => Promise<Doc[]>;
  /** A user's id, by the name they were made with. */
  user: (who: string) => string;
  /** Limits `lim`'s read of the answers to these forms' rows. */
  limit: (formIds: string[]) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * The CRM and the built add-on, attached to it, on one database; the people:
 * `mia` the add-on's manager, `rex` its reader, `lim` a reader of one form's
 * answers only, `cal` the CRM's clerk (nothing of Forms), `rox` a clerk who
 * reads Forms too, `boss` a Super Admin.
 */
export async function formsWorld(dialect: Dialect): Promise<FormsWorld> {
  if (FORMS === null) throw new Error('Forms is not built: set ADMINIUM_ADD_ONS_REPO and run `npm run build` in packages/forms');
  const h = await addOnHarness(dialect, { unbuiltWords: {} });
  await h.stageApp(crmApp());
  const app = await h.install('crm', '1.0.0');
  if (app.statusCode !== 200) throw new Error(`installing the CRM answered ${String(app.statusCode)}: ${app.body.slice(0, 1200)}`);
  await h.stageAddOn(FORMS.manifest, { bundled: true, files: FORMS.files });
  const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: KEY, version: FORMS.version, attachTo: ['crm'] } });
  if (added.statusCode !== 200) throw new Error(`installing forms answered ${String(added.statusCode)}: ${added.body.slice(0, 1200)}`);
  // Vouched for as a bundled package is: its bytes recorded as trusted (a package nobody vouches for serves no form).
  await recordDeciderTrust(h.meta, { key: KEY, version: FORMS.version, integrity: (await h.addOnStore.verifyTree(KEY, FORMS.version)).integrity });

  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
  for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).execute()) {
    names.set(row.ref, row.tableName);
    ids.set(row.ref, model.tables.find((table) => table.name === row.tableName)!.id);
  }

  const settings = settingsRepo(h.meta);
  await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
  await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
  await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
  await settings.set('email.smtp', { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Desk <no-reply@desk.test>', secure: false }, { updatedBy: null });
  await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

  const root = await mkdtemp(join(tmpdir(), 'forms-world-'));
  await mkdir(join(root, 'x'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body data-app="dashboard"></body></html>');
  await writeFile(join(root, 'x', 'index.html'), '<!doctype html><html><head><title>Form</title></head><body><div id="x-root"></div></body></html>');
  const runService = createRunService({ meta: h.meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
    metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: h.manager,
    runService,
    applyService: createApplyService({ meta: h.meta, runService }),
    allowed: null,
    staticRoot: root,
    logger: false,
    telemetry: false,
  });
  await composed.app.ready();
  await composed.addOnsLoaded;
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();

  const cookies = new Map<string, string>();
  const users = new Map<string, string>();
  const roles = rolesRepo(h.meta);
  const permissions = permissionsRepo(h.meta);
  const person = async (who: string, slugs: string[]): Promise<void> => {
    const user = await usersRepo(h.meta).create({ email: `${who}@meridian.example`, name: who, passwordHash: await adminPasswordHash() });
    users.set(who, user.id);
    for (const slug of slugs) await roles.assignToUser(user.id, (await roles.findBySlug(slug))!.id);
    const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.6.0.${String(cookies.size + 1)}`, headers: { host: HOST }, payload: { email: `${who}@meridian.example`, password: ADMIN_PASSWORD } });
    if (login.statusCode !== 200) throw new Error(`${who} could not sign in: ${login.body}`);
    cookies.set(who, sessionCookie(login.headers['set-cookie']));
  };
  // A reader of some forms' answers only: the reader's grants, its answers read limited by form (`limit`).
  const reader = (await roles.findBySlug('forms-reader'))!;
  const limited = await roles.create({ slug: 'forms-one-form', name: 'One form' } as never);
  const readerGrants = await permissions.listForRole(reader.id);
  const answersGrant = readerGrants.find((grant) => grant.resourceKind === 'table' && grant.resourceRef.endsWith(`/${ids.get('answers')!}`))!;
  const limit = async (formIds: string[]): Promise<void> => {
    await permissions.grant(limited.id, 'table', answersGrant.resourceRef, { ...answersGrant.actions, rowLimit: { read: { reach: 'all', while: { column: 'form_id', in: formIds } } } } as never);
  };
  for (const grant of readerGrants) if (grant !== answersGrant) await permissions.grant(limited.id, grant.resourceKind, grant.resourceRef, grant.actions as never);
  await limit(['none']);
  await person('mia', ['forms-manager']);
  await person('rex', ['forms-reader']);
  await person('lim', ['forms-one-form']);
  await person('cal', ['crm-clerk']);
  await person('rox', ['crm-clerk', 'forms-reader']);
  await person('boss', ['super-admin']);

  let seq = 0;
  const reply = (res: { statusCode: number; body: string; headers: Record<string, unknown>; json: () => unknown }): Reply => ({ statusCode: res.statusCode, body: res.body, headers: res.headers, json: () => res.json() as Doc });
  const stranger: FormsWorld['stranger'] = async (method, url, payload, headers = {}, ip) => {
    seq += 1;
    return reply(await composed.app.inject({ method: method as 'GET', url, remoteAddress: ip ?? `198.51.100.${String(seq % 250)}`, headers: { host: HOST, origin: ORIGIN, 'user-agent': 'Mozilla/5.0 test', ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }));
  };
  // A named survey's link carries its token on the challenge too.
  const proof = async (slug: string, token?: string): Promise<string> => {
    const challenge = (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge${token === undefined ? '' : `?t=${token}`}`, headers: { host: HOST } })).json() as Doc;
    return typeof challenge['salt'] === 'string' ? `${challenge['id'] as string}.${solveProof(challenge['salt'], challenge['difficulty'] as number)}` : 'none';
  };
  return {
    h,
    composed,
    id: (ref) => ids.get(ref)!,
    name: (ref) => names.get(ref)!,
    data: (ref, key) => `/api/v1/data/${h.connectionId}/${encodeURIComponent(ids.get(ref)!)}${key === undefined ? '' : `/${encodeURIComponent(key)}`}`,
    as: async (who, method, url, payload) => reply(await composed.app.inject({ method: method as 'GET', url, headers: { host: HOST, cookie: cookies.get(who)! }, ...(payload === undefined ? {} : { payload: payload as never }) })),
    stranger,
    send: async (slug, values, opts = {}) =>
      stranger('POST', `/x/forms/api/${slug}/answers`, { language: opts.language ?? 'en-US', values, query: {}, website: opts.website ?? '', ...(opts.t === undefined ? {} : { t: opts.t }) }, { 'x-adminium-proof': await proof(slug, opts.t) }, opts.ip),
    upload: async (slug, question, fileName, ip, body = PDF) => {
      const res = await composed.app.inject({
        method: 'POST',
        url: `/x/forms/api/${slug}/files?q=${question}&name=${encodeURIComponent(fileName)}`,
        remoteAddress: ip,
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/octet-stream', 'x-adminium-proof': await proof(slug) },
        payload: body,
      });
      if (res.statusCode !== 200) throw new Error(`the upload answered ${String(res.statusCode)}: ${res.body}`);
      return (res.json() as { id: string }).id;
    },
    mails: async () => {
      const rows = await h.meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('kind', '=', 'email.send').where('status', '=', 'pending').orderBy('createdAt', 'asc').execute();
      for (const row of rows) await h.meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
      return rows.map((row) => {
        const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string; templateKey: string };
        return { ...(JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Omit<Mail, 'templateKey'>), templateKey: payload.templateKey };
      });
    },
    runJobs: async () => {
      for (let round = 0; round < 30; round += 1) {
        await h.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).where('kind', '!=', 'email.send').execute();
        if ((await composed.jobs.worker.runOnce()) === 0) break;
      }
    },
    rows: (ref, where) => h.rows(`SELECT * FROM ${names.get(ref)!}${where === undefined ? '' : ` WHERE ${where}`}`) as Promise<Doc[]>,
    user: (who) => users.get(who)!,
    limit,
    close: async () => {
      await composed.app.close();
      await h.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Text in the eight languages, the same words (a test reads the English). */
export const en = (words: string): Record<string, string> => ({ 'en-US': words });

/** A form as the builder writes a new one: a draft with a definition and its settings. */
export async function draftForm(w: FormsWorld, who: string, row: { name: string; slug: string; kind: 'form' | 'survey'; definition: unknown; settings: unknown }): Promise<Reply> {
  // Its key made as the builder makes it: nothing on the server fills a text key on a staff create.
  return w.as(who, 'POST', w.data('forms'), { values: { id: randomUUID(), name: row.name, slug: row.slug, kind: row.kind, state: 'draft', definition: row.definition, settings: row.settings } });
}

/** Publish, as the builder's Publish does: the state move with the published copy and its time. */
export async function publishForm(w: FormsWorld, who: string, key: string, definition: unknown, settings: unknown, from: 'draft' | 'live' | 'closed' = 'draft'): Promise<Reply> {
  const values = { definition, settings, published: { definition, settings }, published_at: new Date().toISOString() };
  if (from === 'live') return w.as(who, 'PATCH', w.data('forms', key), { values });
  return w.as(who, 'PATCH', w.data('forms', key), { values: { ...values, state: 'live' }, from });
}
