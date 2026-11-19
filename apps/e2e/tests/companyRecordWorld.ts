// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COMPANY'S PAGE ON A REAL SERVER: the built server and dashboard, composed
 * in this process (as the live chat's staff spec does), with a small CRM whose
 * companies table is declared with where a found company's details go, and an
 * add-on that finds companies:
 *
 *  - its server half is the contract's demo source (made-up companies only),
 *    vouched for as a developer's own (`ADMINIUM_ADD_ON_DEV_TRUST`);
 *  - its `record.actions` fill names the companies table, so the record page
 *    shows "Fill in details" beside Edit; the fill's code is a small sheet of
 *    this spec's own (Look up, then Fill in all, through the engine's routes
 *    for companies), standing in for the add-on's real sheet, which lives in
 *    the add-ons repository;
 *  - one company, kept by the owner, with nothing filled in.
 *
 * Its own port (`E2E_PORT`, 4920 when unset) and its own data folder: nothing
 * of the shared e2e server is touched.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { composeServer, loadCliEnv, openRuntime, type ComposedServer } from '@adminium/server';
import { createFirstSuperAdmin, firstRun, settingsRepo, userPrefsRepo, usersRepo, type UserPrefsPatch } from '@adminium/meta';

import { bundleOf } from './appBundle.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

/** The slice of the SQLite driver used here (it ships no types). */
interface SqliteDb {
  prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
  close(): void;
}
const BetterSqlite3 = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => SqliteDb;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

export const PORT = Number(process.env['E2E_PORT'] ?? 4920);
export const SERVER = `http://127.0.0.1:${String(PORT)}`;
export const KEY = 'company-finder';
const VERSION = '1.0.0';
const OWNER = { email: 'e2e-company-owner@adminium.local', password: 'adminium-e2e-company-owner-pass', name: 'Dana Whitlock' };

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
  compatibility: { minAdminiumVersion: '0.3.65', engines: ['postgres', 'mysql', 'sqlite'] },
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
          text('address_lines', 200, 'Registered address'),
          text('town', 80, 'Town'),
          text('country', 2, 'Country'),
          text('sector', 120, 'What they do'),
          text('about', 500, 'About'),
        ],
      },
    ],
  },
  people: [
    {
      table: 'companies',
      kind: 'companies',
      name: 'name',
      lead: { number: 'company_number', website: 'website', address: { lines: 'address_lines', town: 'town', country: 'country' }, activity: 'sector', about: 'about' },
    },
  ],
  pages: [{ ref: 'crm-companies', template: 'page-crud', title: { key: 't', fallback: 'Companies' }, nav: { group: 'crm', icon: 'building-2', order: 1 }, bindings: { rows: 'companies' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

const nullable = { nullable: true };
const FINDER = {
  kind: 'add-on',
  manifestVersion: 1,
  key: KEY,
  name: 'Company finder',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'company-finder.description', fallback: 'Find companies and fill in their details.' },
  categories: ['marketing'],
  compatibility: { minAdminiumVersion: '0.3.65', requires: ['outbound-http'] },
  capabilities: ['outbound-http'],
  settings: [{ key: 'companies_house_key', type: 'string', secret: true }],
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'found_people',
        columns: [
          pk,
          { ref: 'person_table', type: 'text', maxLength: 64 },
          { ref: 'person_key', type: 'text', maxLength: 200 },
          { ref: 'company_table', type: 'text', maxLength: 64, ...nullable },
          { ref: 'company_key', type: 'text', maxLength: 200, ...nullable },
          { ref: 'source', type: 'text', maxLength: 32 },
          { ref: 'found_at', type: 'timestamptz' },
          { ref: 'purpose', type: 'text', maxLength: 500 },
          { ref: 'tell_by', type: 'date' },
          { ref: 'told_at', type: 'timestamptz', ...nullable },
          { ref: 'outbox_id', type: 'text', maxLength: 64, ...nullable },
          { ref: 'state', type: 'enum', enum: ['waiting', 'told', 'failed', 'objected'] },
          { ref: 'source_pages', type: 'text', ...nullable },
          { ref: 'email', type: 'text', maxLength: 320, nullable: true, rules: { personal: true } },
        ],
      },
      {
        ref: 'field_sources',
        columns: [
          pk,
          { ref: 'table_ref', type: 'text', maxLength: 64 },
          { ref: 'row_key', type: 'text', maxLength: 200 },
          { ref: 'column_name', type: 'text', maxLength: 64 },
          { ref: 'source', type: 'text', maxLength: 32 },
          { ref: 'found_at', type: 'timestamptz' },
          { ref: 'value_hash', type: 'text', maxLength: 64 },
        ],
        unique: [['table_ref', 'row_key', 'column_name']],
      },
      { ref: 'finder_settings', columns: [pk, { ref: 'people_on', type: 'bool', default: false }, { ref: 'purpose', type: 'json', ...nullable }, { ref: 'keep_years', type: 'int', default: 3 }] },
    ],
  },
  roles: [{ key: 'finder', name: 'Finder', permissions: ['table:@found_people:read', 'table:@field_sources:read', 'table:@finder_settings:read', 'table:@finder_settings:update'] }],
  addOn: {
    hostApi: 1,
    attaches: [{ app: '*', range: '*' }],
    connect: { kind: 'none' },
    provides: [{ contract: 'lead-source', version: 1, server: 'dist/server.js' }],
    network: { allow: ['api.company-information.service.gov.uk'] },
    sources: [
      {
        id: 'companies-house',
        hosts: ['api.company-information.service.gov.uk'],
        key: 'companies_house_key',
        gives: ['find', 'fill'],
        label: { key: 'company-finder.sources.companies-house', fallback: 'Companies House' },
        labels: { 'ar-EG': 'سجل الشركات البريطاني' },
      },
      { id: 'website', reads: 'website', gives: ['fill'], label: { key: 'company-finder.sources.website', fallback: 'the website' } },
    ],
    settingsTable: 'finder_settings',
    leads: { foundPeople: 'found_people', fieldSources: 'field_sources' },
    pages: [{ ref: 'company-finder-search', title: { key: 'company-finder.search', fallback: 'Find companies' }, icon: 'search', client: 'dist/search.js' }],
    slots: [
      {
        slot: 'record.actions',
        client: 'dist/client.js',
        order: 10,
        on: 'companies',
        label: { key: 'company-finder.fill', fallback: 'Fill in details' },
        labels: { 'ar-EG': 'املأ التفاصيل' },
        icon: 'scan-search',
      },
    ],
  },
};

const DEMO = pathToFileURL(join(repoRoot, 'packages', 'add-on-contracts', 'dist', 'testing', 'lead-source.js')).href;
const SERVER_JS = `import { createDemoLeadSource } from ${JSON.stringify(DEMO)};
export function createLeadSource(context) { return createDemoLeadSource(context); }
`;

/**
 * The stand-in sheet: the fill's code as the browser loads it (plain ES, the
 * host's React from the runtime the dashboard publishes). Look up asks the
 * register; Fill in all writes every empty field it found, through the
 * engine's route, as the person; then the sheet closes.
 */
const CLIENT_JS = `const runtime = globalThis.__ADMINIUM_ADD_ON_RUNTIME__;
const React = runtime.react;
const h = React.createElement;
const api = runtime.host.app.api;
const base = '/api/v1/leads/${KEY}';

function Sheet({ props }) {
  const [found, setFound] = React.useState(null);
  const [said, setSaid] = React.useState('');
  const ticked = found === null ? [] : found.fields.filter((one) => one.now === null && one.found.length > 0);
  const look = async () => {
    setSaid('Asking Companies House…');
    try {
      const reply = await api.post(base + '/lookup', { table: props.table, record: props.rowKey, sources: ['companies-house'] });
      setFound(reply);
      setSaid('');
    } catch (error) {
      setSaid(String(error && error.message));
    }
  };
  const fill = async () => {
    try {
      await api.post(base + '/fill', { table: props.table, record: props.rowKey, fields: ticked.map((one) => ({ field: one.field, source: one.found[0].source, now: one.now })) });
      props.close();
    } catch (error) {
      setSaid(String(error && error.message));
    }
  };
  return h('div', { className: 'flex min-h-0 flex-1 flex-col' },
    h('div', { className: 'flex-1 overflow-y-auto p-5 text-sm' },
      h('p', null, props.row.name + '. Nothing changes until you press Fill in.'),
      h('button', { type: 'button', className: 'mt-3 rounded-md border border-border-strong px-3 py-2 font-semibold', onClick: look }, 'Look up'),
      found === null ? null : h('p', { className: 'mt-3' }, ticked.length + ' details found'),
    ),
    h('p', { role: 'status', 'aria-live': 'polite', className: 'px-5 text-sm' }, said),
    h('div', { className: 'sticky bottom-0 flex justify-end border-t border-border bg-surface-2 px-5 py-4' },
      h('button', { type: 'button', disabled: ticked.length === 0, className: 'min-h-11 rounded-md bg-accent px-4 font-bold text-accent-fg disabled:opacity-40', onClick: fill }, 'Fill in all'),
    ),
  );
}

export function register() {
  return { fills: [{ slot: 'record.actions', on: 'companies', render: (props) => h(Sheet, { props }) }] };
}
`;

export interface CompanyWorld {
  composed: ComposedServer;
  /** The owner's session cookie, as `name=value`. */
  cookie: string;
  /** The record page of the one company. */
  recordUrl: string;
  /** The company's row, as the database holds it. */
  company(): Doc;
  /** The owner's own preferences (language, theme), as their settings page saves them. */
  prefs(patch: UserPrefsPatch): Promise<void>;
  close(): Promise<void>;
}

const distUrl = (rel: string): string => pathToFileURL(join(repoRoot, 'apps', 'server', 'dist', rel)).href;

export async function startCompanyWorld(): Promise<CompanyWorld> {
  process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = KEY;
  const dir = mkdtempSync(join(tmpdir(), 'adminium-company-e2e-'));
  const sourceFile = join(dir, 'source.db');
  new BetterSqlite3(sourceFile).close();
  const env = loadCliEnv({ ADMINIUM_SECRET: randomBytes(32).toString('hex') }, { port: PORT, host: '127.0.0.1', dataDir: dir });
  const runtime = await openRuntime(env, { blockLoopback: false });
  const meta = runtime.metaStore.meta;
  const { hashPassword } = (await import(distUrl('auth/passwords.js'))) as { hashPassword: (password: string) => Promise<string> };
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: OWNER.email, name: OWNER.name, passwordHash: await hashPassword(OWNER.password) });
  for (const name of ['addOns.catalogEnabled', 'apps.catalogEnabled'] as const) await settingsRepo(meta).set(name, false, { updatedBy: null, at: Date.now() });

  // Both packages go in the stores as a verified download would put them: they use the next release's words.
  type Store = { stage(pkg: { key: string; version: string; tarball: Uint8Array; expectedIntegrity: string }): Promise<unknown> };
  const { createAddOnStore } = (await import(distUrl('add-ons/store.js'))) as { createAddOnStore: (opts: { dataDir: string }) => Store };
  const { createAppStore } = (await import(distUrl('apps/store.js'))) as { createAppStore: (opts: { dataDir: string }) => Store };
  const finder = bundleOf({
    'package.json': JSON.stringify({ name: `@adminium-add-ons/${KEY}`, version: VERSION, type: 'module' }),
    'manifest.json': JSON.stringify(FINDER),
    'dist/server.js': SERVER_JS,
    'dist/client.js': CLIENT_JS,
    'dist/search.js': 'export default function Search() { return null; }\n',
  });
  await createAddOnStore({ dataDir: env.ADMINIUM_DATA_DIR }).stage({ key: KEY, version: VERSION, tarball: finder.buffer, expectedIntegrity: finder.integrity });
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
  // The add-on's server half is loaded before anyone opens a page.
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

  const connection = await inject('POST', '/api/v1/connections', cookie, { name: 'Meridian', engine: 'sqlite', dsn: `sqlite:${sourceFile}` });
  const connectionId = String(connection['id']);
  const plan = (await inject('POST', '/api/v1/apps/plan', cookie, { key: 'crm', version: '1.0.0', connectionId }))['plan'] as Doc;
  await inject('POST', '/api/v1/apps/install', cookie, { key: 'crm', version: '1.0.0', connectionId, planChecksum: plan['checksum'] });
  await inject('POST', '/api/v1/add-ons', cookie, { key: KEY, version: VERSION, attachTo: ['crm'], connectionId });
  // The register's key, saved and checked through the add-on's Sources route; then the register is switched on.
  await inject('PUT', `/api/v1/add-ons/${KEY}/sources/companies-house/key`, cookie, { value: 'test-key-companies-1' });
  await inject('PUT', `/api/v1/add-ons/${KEY}/sources/companies-house`, cookie, { on: true });

  const tables: Record<string, string> = {};
  for (const row of await meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${row.appKey}:${row.ref}`] = row.tableName;
  const companies = tables['crm:companies']!;
  const db = new BetterSqlite3(sourceFile);
  // A made-up company the register knows by name (the contract's demo), with nothing filled in.
  db.prepare(`INSERT INTO ${companies} (id, name, town) VALUES (7, 'Ouseburn Studio', 'Newcastle upon Tyne')`).run();
  const page = await meta.db.selectFrom('adminium_pages').select(['slug']).where('slug', 'like', '%companies%').executeTakeFirstOrThrow();

  await composed.app.listen({ port: PORT, host: '127.0.0.1' });
  return {
    composed,
    cookie,
    recordUrl: `${SERVER}/p/${page.slug}/r/7`,
    company: () => db.prepare(`SELECT * FROM ${companies} WHERE id = 7`).get() as Doc,
    async prefs(patch) {
      const owner = await usersRepo(meta).findByEmail(OWNER.email);
      await userPrefsRepo(meta).set(owner!.id, patch);
    },
    async close() {
      db.close();
      await composed.app.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

