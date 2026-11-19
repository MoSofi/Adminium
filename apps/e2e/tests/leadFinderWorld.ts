// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LEAD FINDER ADD-ON ON A REAL SERVER: the built server and dashboard,
 * composed in this process (as `companyRecordWorld.ts` does), with:
 *
 *  - the REAL Lead finder package, read from the add-ons checkout
 *    (`ADMINIUM_ADD_ONS_REPO`, or `ADD_ONS_REPO`; built): its manifest, its
 *    pages, its fill sheet and its server half, vouched for as a developer's
 *    own (`ADMINIUM_ADD_ON_DEV_TRUST`);
 *  - the server's demo source seam (`ADMINIUM_LEAD_SOURCE_DEMO`): its
 *    sources are answered by the contract's demo, made-up companies and
 *    people only, so nothing reaches a register; refused in production;
 *  - a small CRM whose companies say where a found company's details go and
 *    whose contacts are people (with "may be e-mailed");
 *  - e-mail to an SMTP catcher on this machine, a public address for the
 *    links in mails, and the privacy notice's business and address, so People
 *    may be switched on;
 *  - one company kept with nothing filled in but its name and town.
 *
 * Its own ports (`E2E_PORT`, 4924 when unset; the catcher on the next one)
 * and its own data folder: nothing of the shared e2e server is touched.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { composeServer, loadCliEnv, openRuntime, type ComposedServer } from '@adminium/server';
import { createFirstSuperAdmin, firstRun, settingsRepo, userPrefsRepo, usersRepo, type UserPrefsPatch } from '@adminium/meta';

import { bundleOf } from './appBundle.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

/** The slice of the SQLite driver used here (it ships no types). */
interface SqliteDb {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
  close(): void;
}
const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as new (file: string) => SqliteDb;

/** The slices of the mail catcher's two packages used here (they ship no types), as `scripts/e2e-server.mjs` uses them. */
interface ParsedMail {
  subject?: string;
  to?: { value: { address?: string }[] } | { value: { address?: string }[] }[];
  html?: string | false;
  text?: string;
}
interface SmtpSink {
  listen(port: number, host: string, done: () => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  close(done: () => void): void;
}
const { SMTPServer } = require('smtp-server') as {
  SMTPServer: new (options: { authOptional: boolean; disabledCommands: string[]; disableReverseLookup: boolean; logger: boolean; onData(stream: unknown, session: unknown, callback: (error?: Error) => void): void }) => SmtpSink;
};
const { simpleParser } = require('mailparser') as { simpleParser: (stream: unknown) => Promise<ParsedMail> };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

export const PORT = Number(process.env['E2E_PORT'] ?? 4924);
const SMTP_PORT = PORT + 1;
export const SERVER = `http://127.0.0.1:${String(PORT)}`;
/** The address mails link to: a public one, as People needs. The spec follows its links on this server. */
export const PUBLIC_ORIGIN = 'https://crm.meridian.example';
export const KEY = 'lead-finder';
const OWNER = { email: 'e2e-lead-owner@adminium.local', password: 'adminium-e2e-lead-owner-pass', name: 'Dana Whitlock' };

/** The add-ons checkout, and the Lead finder package in it. */
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'] ?? process.env['ADD_ONS_REPO'] ?? '';
export const PACKAGE = REPO === '' ? '(no add-ons checkout named)' : join(REPO, 'packages', 'lead-finder');
/** Whether the package is here and built (its manifest names three bundles). */
export const PACKAGE_BUILT = REPO !== '' && ['manifest.json', 'package.json', 'dist/server.js', 'dist/client.js', 'dist/pages/lead-finder.js'].every((file) => existsSync(join(PACKAGE, file)));

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, label: string) => ({ ref, type: 'text', maxLength, nullable: true, label });
const CRM = {
  kind: 'app',
  manifestVersion: 1,
  key: 'crm',
  name: 'CRM',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A small CRM.' },
  categories: ['crm'],
  compatibility: { minAdminiumVersion: '0.3.66', engines: ['postgres', 'mysql', 'sqlite'] },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'companies',
        label: 'Companies',
        columns: [
          pk,
          { ref: 'name', type: 'text', maxLength: 120, label: 'Name' },
          text('company_number', 20, 'Company number'),
          text('website', 80, 'Website'),
          text('phone', 40, 'Phone'),
          text('address_lines', 200, 'Registered address'),
          text('town', 80, 'Town'),
          text('region', 80, 'Region'),
          text('postal_code', 20, 'Postcode'),
          text('country', 2, 'Country'),
          text('sector', 120, 'What they do'),
          text('about', 500, 'About'),
        ],
      },
      {
        ref: 'contacts',
        label: 'Contacts',
        columns: [
          pk,
          { ref: 'name', type: 'text', maxLength: 120, label: 'Name' },
          text('email', 254, 'E-mail'),
          { ref: 'company_id', type: 'fk', references: 'companies', nullable: true, label: 'Company' },
          { ref: 'may_email', type: 'bool', default: false, label: 'May be e-mailed' },
        ],
      },
    ],
  },
  people: [
    { table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id', consent: { column: 'may_email', purpose: 'newsletter' } },
    {
      table: 'companies',
      kind: 'companies',
      name: 'name',
      lead: {
        number: 'company_number',
        website: 'website',
        phone: 'phone',
        address: { lines: 'address_lines', town: 'town', region: 'region', postalCode: 'postal_code', country: 'country' },
        activity: 'sector',
        about: 'about',
      },
    },
  ],
  pages: [
    { ref: 'crm-companies', template: 'page-crud', title: { key: 't', fallback: 'Companies' }, nav: { group: 'crm', icon: 'building-2', order: 1 }, bindings: { rows: 'companies' } },
    { ref: 'crm-contacts', template: 'page-crud', title: { key: 'c', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'users', order: 2 }, bindings: { rows: 'contacts' } },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

/** Every file of the package an install reads: its manifest, its package.json and its built bundles. */
function packageFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of ['package.json', 'manifest.json']) files[file] = readFileSync(join(PACKAGE, file), 'utf8');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|css|json)$/.test(name)) files[relative(PACKAGE, path).split('\\').join('/')] = readFileSync(path, 'utf8');
    }
  };
  walk(join(PACKAGE, 'dist'));
  return files;
}

/** One mail the catcher took. */
export interface CaughtMail {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface LeadWorld {
  composed: ComposedServer;
  /** The owner's session cookie, as `name=value`. */
  cookie: string;
  /** The add-on's page, and its Sources and People settings. */
  findUrl: string;
  sourcesUrl: string;
  peopleUrl: string;
  /** A company's record page by its key. */
  recordUrl(key: string | number): string;
  /** The companies and the contacts, as the database holds them. */
  companies(): Doc[];
  contacts(): Doc[];
  /** The add-on's found people, as the database holds them. */
  foundPeople(): Doc[];
  /** The mails the catcher took, oldest first. */
  mails: CaughtMail[];
  /** The owner's own preferences (language, theme). */
  prefs(patch: UserPrefsPatch): Promise<void>;
  /** An engine route, as the owner. */
  api(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown): Promise<Doc>;
  close(): Promise<void>;
}

const distUrl = (rel: string): string => pathToFileURL(join(repoRoot, 'apps', 'server', 'dist', rel)).href;

export async function startLeadWorld(): Promise<LeadWorld> {
  // The add-on's code is a developer's own here, and its sources are the demo's: neither is allowed in production.
  process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = KEY;
  process.env['ADMINIUM_LEAD_SOURCE_DEMO'] = KEY;
  const dir = mkdtempSync(join(tmpdir(), 'adminium-lead-e2e-'));
  const sourceFile = join(dir, 'source.db');
  new BetterSqlite3(sourceFile).close();

  // The catcher: up before the server, so no send can race it.
  const mails: CaughtMail[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    disableReverseLookup: true,
    logger: false,
    onData(stream, _session, callback) {
      simpleParser(stream).then(
        (parsed) => {
          const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to === undefined ? [] : [parsed.to]).flatMap((one) => one.value.map((address) => address.address ?? ''));
          mails.push({ to, subject: parsed.subject ?? '', html: typeof parsed.html === 'string' ? parsed.html : '', text: parsed.text ?? '' });
          callback();
        },
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    },
  });
  await new Promise<void>((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(SMTP_PORT, '127.0.0.1', () => resolve());
  });

  const env = loadCliEnv({ ADMINIUM_SECRET: randomBytes(32).toString('hex'), ADMINIUM_LEAD_SOURCE_DEMO: KEY, ADMINIUM_ADD_ON_DEV_TRUST: KEY }, { port: PORT, host: '127.0.0.1', dataDir: dir });
  const runtime = await openRuntime(env, { blockLoopback: false });
  const meta = runtime.metaStore.meta;
  const { hashPassword } = (await import(distUrl('auth/passwords.js'))) as { hashPassword: (password: string) => Promise<string> };
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: OWNER.email, name: OWNER.name, passwordHash: await hashPassword(OWNER.password) });
  const settings = settingsRepo(meta);
  const set = (name: string, value: unknown) => settings.set(name as never, value as never, { updatedBy: null, at: Date.now() });
  for (const name of ['addOns.catalogEnabled', 'apps.catalogEnabled']) await set(name, false);
  // What the People switch needs, besides e-mail: the address in mails' links, and whose privacy notice it is.
  await set('system.publicOrigin', PUBLIC_ORIGIN);
  await set('privacy.businessName', 'Meridian Workplace Ltd');
  await set('privacy.noticeUrl', 'https://www.meridian.example/privacy');
  await set('privacy.dpoContact', 'privacy@meridian.example');

  // Both packages go in the stores as a verified download would put them.
  type Store = { stage(pkg: { key: string; version: string; tarball: Uint8Array; expectedIntegrity: string }): Promise<unknown> };
  const { createAddOnStore } = (await import(distUrl('add-ons/store.js'))) as { createAddOnStore: (opts: { dataDir: string }) => Store };
  const { createAppStore } = (await import(distUrl('apps/store.js'))) as { createAppStore: (opts: { dataDir: string }) => Store };
  const files = packageFiles();
  const version = String((JSON.parse(files['manifest.json']!) as Doc)['version']);
  const finder = bundleOf(files);
  await createAddOnStore({ dataDir: env.ADMINIUM_DATA_DIR }).stage({ key: KEY, version, tarball: finder.buffer, expectedIntegrity: finder.integrity });
  const crm = bundleOf({ 'package.json': JSON.stringify({ name: '@adminium-apps/crm', version: '1.0.0' }), 'manifest.json': JSON.stringify(CRM), 'staff/index.html': '<!doctype html><html><head><title>CRM</title></head><body><main>CRM</main></body></html>' });
  await createAppStore({ dataDir: env.ADMINIUM_DATA_DIR }).stage({ key: 'crm', version: '1.0.0', tarball: crm.buffer, expectedIntegrity: crm.integrity });

  const composed = await composeServer({
    env,
    metaStore: runtime.metaStore,
    manager: runtime.manager,
    runService: runtime.runService,
    applyService: runtime.applyService,
    allowed: runtime.allowed,
    collectStats: runtime.collectStats,
    staticRoot: join(repoRoot, 'apps', 'dashboard', 'dist'),
    logger: false,
    telemetry: false,
    // A website read would ask this first: nothing reaches the network.
    pictureSeams: { resolve: async () => Promise.reject(new Error('no network in this spec')) },
  });
  await composed.app.ready();
  await composed.addOnsLoaded;

  const inject = async (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string | undefined, payload?: unknown): Promise<Doc> => {
    const res = await composed.app.inject({ method, url, headers: cookie === undefined ? {} : { cookie }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${String(res.statusCode)} ${res.body}`);
    return res.body === '' ? {} : (res.json() as Doc);
  };
  const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: OWNER.email, password: OWNER.password } });
  if (login.statusCode !== 200) throw new Error(`login → ${String(login.statusCode)} ${login.body}`);
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;

  // E-mail to the catcher: no AUTH, plain on loopback.
  await inject('PUT', '/api/v1/settings/email', cookie, { smtp: { host: '127.0.0.1', port: SMTP_PORT, user: '', from: `Meridian <hello@meridian.example>`, secure: false } });
  const connection = await inject('POST', '/api/v1/connections', cookie, { name: 'Meridian', engine: 'sqlite', dsn: `sqlite:${sourceFile}` });
  const connectionId = String(connection['id']);
  const plan = (await inject('POST', '/api/v1/apps/plan', cookie, { key: 'crm', version: '1.0.0', connectionId }))['plan'] as Doc;
  await inject('POST', '/api/v1/apps/install', cookie, { key: 'crm', version: '1.0.0', connectionId, planChecksum: plan['checksum'] });
  await inject('POST', '/api/v1/add-ons', cookie, { key: KEY, version, attachTo: ['crm'], connectionId });
  // Only the British register and Hunter are used here: the keyless registers of France and Norway are switched off,
  // so why people are kept is needed in English alone. Hunter's key is saved here; the register's through its card.
  for (const id of ['france', 'norway']) await inject('PUT', `/api/v1/add-ons/${KEY}/sources/${id}`, cookie, { on: false });
  await inject('PUT', `/api/v1/add-ons/${KEY}/sources/hunter/key`, cookie, { value: 'test-key-people-2' });
  await inject('PUT', `/api/v1/add-ons/${KEY}/sources/hunter`, cookie, { on: true });

  const tables: Record<string, string> = {};
  for (const row of await meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${row.appKey}:${row.ref}`] = row.tableName;
  const db = new BetterSqlite3(sourceFile);
  // A made-up company the register knows by name and town (the contract's demo), with nothing else filled in.
  db.prepare(`INSERT INTO ${tables['crm:companies']!} (id, name, town) VALUES (7, 'Ouseburn Studio', 'Newcastle upon Tyne')`).run();
  const page = await meta.db.selectFrom('adminium_pages').select(['slug']).where('slug', 'like', '%companies%').executeTakeFirstOrThrow();

  await composed.app.listen({ port: PORT, host: '127.0.0.1' });
  const all = (table: string) => () => db.prepare(`SELECT * FROM ${tables[table]!} ORDER BY id`).all() as Doc[];
  return {
    composed,
    cookie,
    findUrl: `${SERVER}/add-ons/${KEY}/${KEY}`,
    sourcesUrl: `${SERVER}/add-ons/${KEY}/${KEY}/settings/sources`,
    peopleUrl: `${SERVER}/add-ons/${KEY}/${KEY}/settings/people`,
    recordUrl: (key) => `${SERVER}/p/${page.slug}/r/${String(key)}`,
    companies: all('crm:companies'),
    contacts: all('crm:contacts'),
    foundPeople: all(`${KEY}:found_people`),
    mails,
    async prefs(patch) {
      const owner = await usersRepo(meta).findByEmail(OWNER.email);
      await userPrefsRepo(meta).set(owner!.id, patch);
    },
    api: (method, url, payload) => inject(method, url, cookie, payload),
    async close() {
      db.close();
      await composed.app.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
      delete process.env['ADMINIUM_LEAD_SOURCE_DEMO'];
    },
  };
}
