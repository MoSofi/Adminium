// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORMS ADD-ON AS AN OWNER MEETS IT, for the forms specs: a small CRM
 * (its enquiries and its feedback opened to forms, its contacts its people,
 * its jobs) installed from a bundle built here, the add-on packed from the
 * add-ons checkout as it would be published, uploaded and attached to the
 * CRM; a public address and a privacy notice set, so strangers can reach a
 * form; and the add-on's manager and reader invited and signed in ONCE each
 * (the login bucket allows five a minute).
 *
 * Everything this changes on the shared server is put back by `tearDown`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { BASE_URL } from './constants.js';
import { seededConnectionId, signIn } from './helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

export const KEY = 'forms';
export const CRM = 'e2e-forms-crm';
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'];
const PACKAGE = REPO === undefined || REPO === '' ? null : join(REPO, 'packages', KEY);
export const built = PACKAGE !== null && existsSync(join(PACKAGE, 'dist', 'pages', 'forms.js'));
export const trusted = (process.env['ADMINIUM_ADD_ON_DEV_TRUST'] ?? '').split(',').includes(KEY);
/** Skips the file, saying what is missing: it must never pass by walking nothing. */
export function needsForms(): void {
  test.skip(!built, 'the add-ons checkout is not built here: set ADMINIUM_ADD_ONS_REPO to it and run `npm run build` in packages/forms');
  test.skip(!trusted, "an uploaded package's forms are served only when vouched for: set ADMINIUM_ADD_ON_DEV_TRUST=forms");
}

/** A public https address: the forms door serves strangers only while the outside can reach the server. */
export const PUBLIC_ORIGIN = 'https://forms.e2e-meridian.dev';
export const MANAGER = { email: 'e2e-forms-manager@adminium.local', name: 'Mona Forms', password: 'adminium-e2e-forms-manager-pass', role: 'forms-manager' };
export const READER = { email: 'e2e-forms-reader@adminium.local', name: 'Rhys Reader', password: 'adminium-e2e-forms-reader-pass', role: 'forms-reader' };

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, ...more });
const CRM_MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: CRM,
  name: 'Forms CRM',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A small CRM for the forms specs.' },
  categories: ['crm'],
  compatibility: { minAdminiumVersion: '0.3.41', engines: ['postgres', 'mysql', 'sqlite'] },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'contacts', label: 'Contacts', columns: [pk, text('name', 80, { nullable: true, label: 'Name' }), text('email', 254, { nullable: true, label: 'E-mail', rules: { personal: true } })] },
      { ref: 'jobs', label: 'Jobs', columns: [pk, text('title', 80, { label: 'Title' }), { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true, label: 'Main contact' }] },
      {
        ref: 'enquiries',
        label: 'Enquiries',
        columns: [pk, text('person', 80, { label: 'Person' }), text('email', 254, { nullable: true, label: 'E-mail' }), text('message', 1000, { nullable: true, label: 'Message' }), { ref: 'state', type: 'enum', enum: ['open', 'closed'], default: 'open', label: 'State' }, text('source', 200, { nullable: true, label: 'From form' })],
      },
      { ref: 'feedback', label: 'Customer feedback', columns: [pk, { ref: 'job_id', type: 'fk', references: 'jobs', nullable: true, label: 'Job' }, { ref: 'score', type: 'int', nullable: true, label: 'Score' }, text('text', 1000, { nullable: true, label: 'Text' })] },
    ],
  },
  people: [{ table: 'contacts', kind: 'people', email: 'email', name: 'name' }],
  publicAccess: [
    { table: 'enquiries', methods: ['POST'], key: 'forms', writable: ['person', 'email', 'message', 'source'], defaults: { state: 'open' }, source: 'source', anonymous: { perKeyHour: 100, plainText: ['person'] } },
    { table: 'feedback', methods: ['POST'], key: 'forms', writable: ['job_id', 'score', 'text'], anonymous: { perKeyHour: 100 } },
  ],
  pages: [
    { ref: `${CRM}-jobs`, template: 'page-crud', title: { key: 'p.jobs', fallback: 'Jobs' }, nav: { group: 'crm', icon: 'list', order: 1 }, bindings: { rows: 'jobs' } },
    { ref: `${CRM}-enquiries`, template: 'page-crud', title: { key: 'p.enq', fallback: 'Enquiries' }, nav: { group: 'crm', icon: 'list', order: 2 }, bindings: { rows: 'enquiries' } },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { home: '/' } }],
};

async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${String(res.status())} ${(await res.text()).slice(0, 600)}`).toBe(true);
  return (await res.json().catch(() => ({}))) as T;
}

export interface FormsWorld {
  connectionId: string;
  /** A table's id by its short name in the CRM or the add-on. */
  tables: Record<string, string>;
  people: Record<'manager' | 'reader', { id: string; cookies: Awaited<ReturnType<BrowserContext['cookies']>> }>;
  prior: { publicOrigin: unknown; notice: { businessName: string | null; noticeUrl: string | null } };
}

async function cleanUp(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/v1/add-ons/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
  await request.delete(`/api/v1/apps/${CRM}`, { data: { dropTables: true, confirmKey: CRM } }).catch(() => undefined);
}

/** Installs the CRM and the add-on, opens the forms door, and signs the two roles in. */
export async function setUp(browser: Browser): Promise<FormsWorld> {
  const page = await browser.newPage();
  await signIn(page);
  const staff = page.request;
  const connectionId = await seededConnectionId(page);
  await cleanUp(staff);

  const bundle = bundleOf({ 'package.json': JSON.stringify({ name: `@adminium-apps/${CRM}`, version: '1.0.0' }), 'manifest.json': JSON.stringify(CRM_MANIFEST), 'staff/index.html': '<!doctype html><html><head><title>CRM</title></head><body><main>CRM</main></body></html>' });
  await ok(await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(bundle.integrity)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bundle.buffer }));
  const install = { key: CRM, version: '1.0.0', connectionId };
  const { plan } = await ok<{ plan: { installable: boolean; checksum: string } }>(await staff.post('/api/v1/apps/plan', { data: install }));
  expect(plan.installable).toBe(true);
  await ok(await staff.post('/api/v1/apps/install', { data: { ...install, planChecksum: plan.checksum } }));

  const out = mkdtempSync(join(tmpdir(), 'adminium-forms-'));
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: PACKAGE!, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { filename: string; version: string }[];
  const bytes = readFileSync(join(out, packed!.filename));
  await ok(await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(`sha512-${createHash('sha512').update(bytes).digest('base64')}`)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bytes }));
  await ok(await staff.post('/api/v1/add-ons', { data: { key: KEY, version: packed!.version, attachTo: [CRM] } }));

  const schema = await ok<Doc>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
  const listed = (schema['tables'] ?? schema['model']?.tables ?? schema['data']?.tables ?? []) as { id: string; name: string }[];
  const tables: Record<string, string> = {};
  for (const table of listed) {
    const crm = /^e2e_forms_crm_(.+)$/.exec(table.name);
    const own = /^forms_(.+)$/.exec(table.name);
    if (crm !== null) tables[crm[1]!] = table.id;
    else if (own !== null) tables[own[1]!] = table.id;
  }
  // A contact and a job for the survey's rule.
  const data = (ref: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tables[ref]!)}`;
  const contact = await ok<{ data: Doc }>(await staff.post(data('contacts'), { data: { values: { name: 'Ann Lee', email: 'ann@linden-studio.dev' } } }));
  await ok(await staff.post(data('jobs'), { data: { values: { title: 'Kitchen fit-out', contact_id: contact.data['id'] } } }));

  const email = await ok<{ data: { publicOrigin: unknown } }>(await staff.get('/api/v1/settings/email'));
  const notice = await ok<{ data: { businessName: string | null; noticeUrl: string | null } }>(await staff.get('/api/v1/privacy/notice'));
  await ok(await staff.put('/api/v1/settings/email', { data: { publicOrigin: PUBLIC_ORIGIN } }));
  await ok(await staff.put('/api/v1/privacy/notice', { data: { businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy' } }));

  const roles = (await ok<{ roles: { id: string; slug: string }[] }>(await staff.get('/api/v1/roles'))).roles;
  const people = {} as FormsWorld['people'];
  for (const [who, person] of [['manager', MANAGER], ['reader', READER]] as const) {
    const users = await ok<{ users?: { id: string; email: string }[] }>(await staff.get(`/api/v1/users?q=${encodeURIComponent(person.email)}`));
    for (const user of users.users ?? []) if (user.email === person.email) await staff.delete(`/api/v1/users/${user.id}?permanent=true`);
    const invited = await staff.post('/api/v1/users', { data: { email: person.email, name: person.name, roleIds: [roles.find((one) => one.slug === person.role)!.id] } });
    expect(invited.status(), await invited.text()).toBe(201);
    const { invite, user } = (await invited.json()) as { invite: { token: string }; user: { id: string } };
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const own = await context.newPage();
    // The reset and the login share the sign-in bucket (five a minute): a refusal is sat out once.
    const reset = () => own.request.post('/api/v1/auth/password/reset', { data: { token: invite.token, newPassword: person.password } });
    let made = await reset();
    if (made.status() === 429) {
      await own.waitForTimeout(61_000);
      made = await reset();
    }
    expect(made.ok(), `${String(made.status())} ${await made.text()}`).toBe(true);
    await own.goto('/login');
    const login = (): Promise<number> =>
      own.evaluate(async ([address, password]) => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: address, password }) })).status, [person.email, person.password] as const);
    let status = await login();
    if (status === 429) {
      await own.waitForTimeout(61_000);
      status = await login();
    }
    expect(status, `${who} signs in`).toBe(200);
    people[who] = { id: user.id, cookies: await context.cookies() };
    await context.close();
  }
  await page.close();
  return { connectionId, tables, people, prior: { publicOrigin: email.data.publicOrigin, notice: notice.data } };
}

export async function tearDown(browser: Browser, world: FormsWorld | undefined): Promise<void> {
  const page = await browser.newPage();
  await signIn(page);
  const staff = page.request;
  if (world !== undefined) {
    await staff.put('/api/v1/settings/email', { data: { publicOrigin: world.prior.publicOrigin } }).catch(() => undefined);
    await staff.put('/api/v1/privacy/notice', { data: world.prior.notice }).catch(() => undefined);
    for (const person of Object.values(world.people)) await staff.delete(`/api/v1/users/${person.id}?permanent=true`).catch(() => undefined);
  }
  await cleanUp(staff);
  await page.close();
}

/** A page on one person's own session, at a width and in a theme. */
export async function as(browser: Browser, world: FormsWorld, who: 'manager' | 'reader', options: { width?: number; colorScheme?: 'light' | 'dark' } = {}): Promise<{ page: Page; context: BrowserContext; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: world.people[who].cookies, origins: [] }, viewport: { width: options.width ?? 1440, height: 900 }, colorScheme: options.colorScheme ?? 'light' });
  const page = await context.newPage();
  return { page, context, close: () => context.close() };
}

/** The address a stranger opens a form on: this server, whatever public address its links name. */
export const strangerPath = (link: string): string => {
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
};

/**
 * The add-on's own words in a language, by key, read from its strings files
 * in the add-ons checkout: a sweep in Arabic finds a button by its Arabic
 * name. A key a language has not got reads in English.
 */
export function words(locale: 'en_US' | 'ar_EG'): (key: string) => string {
  const read = (tag: string): Record<string, string> => {
    const text = readFileSync(join(PACKAGE!, 'src', 'pages', 'strings', `${tag}.ts`), 'utf8');
    return Object.fromEntries([...text.matchAll(/^\s*"([^"]+)": "((?:[^"\\]|\\.)*)",?$/gm)].map((hit) => [hit[1]!, JSON.parse(`"${hit[2]!}"`) as string]));
  };
  const english = read('en-US');
  const own = locale === 'en_US' ? english : read('ar-EG');
  return (key) => {
    const found = own[key] ?? english[key];
    if (found === undefined) throw new Error(`the add-on has no words "${key}"`);
    return found;
  };
}
