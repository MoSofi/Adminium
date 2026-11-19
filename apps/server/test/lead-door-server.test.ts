// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LEAD DOOR ON THE REAL SERVER: a company finder add-on (the contract's
 * demo source behind it) attached to a CRM whose companies declare where a
 * found company's details go, on SQLite, Postgres and MySQL, as a sales rep
 * held to their own companies (never only as an admin).
 *
 *  - "Already here" is decided as the install: a colleague's company shows
 *    "kept by a colleague" (no key, no values) and "Add" makes no duplicate;
 *    "ACME LTD" and "Acme Limited" in one town are one company;
 *  - a partial add says what was refused; a retried add adds once;
 *  - a fill over a field somebody changed since the sheet showed it is
 *    refused; a fill notes each field's source by the value's hash;
 *  - a French unit that objected to sales contact is never added, and its
 *    facts still fill a record already kept; a sole trader with people off is
 *    refused by name;
 *  - an answer with a 10 kB name or an `http:` address is refused, a long
 *    name is cut to its column, and a formula is stored as text and
 *    neutralised in the CSV export;
 *  - Stop ends a look-up (the source sees its signal) and nothing is written;
 *  - a source's key never reaches another source's host;
 *  - the rule step "fill in the company" asks only the free registers (never
 *    the website, never a paid source), fills only empty fields, and its 51st
 *    call of the day on one source is refused.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditRepo, manifestsRepo, permissionsRepo, rolesRepo, sourceDayOf, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { runCompanyFillAction } from '../src/automations/actions/company-fill.js';
import type { ActionContext } from '../src/automations/actions/types.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import type { RecordWriteService } from '../src/crud/write-service.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { createRowWriter } from '../src/export/writer.js';
import { withSourceKey } from '../src/lead-sources/keys.js';
import { mutateSourceState, sourcesOf } from '../src/lead-sources/state.js';
import { valueHash } from '../src/leads/write.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const KEY = 'company-finder';
const PAGE = 'company-finder-search';
const REGISTER_KEY = 'test-key-companies-1';
const PEOPLE_KEY = 'test-key-people-2';
const REGISTER_HOST = 'api.company-information.service.gov.uk';
const PEOPLE_HOST = 'api.hunter.io';
const DEMO = new URL('../../../packages/add-on-contracts/dist/testing/lead-source.js', import.meta.url).href;
const PORT = 4916;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });

/** What each made source was handed, and what a test makes a call do instead of the demo's answer. */
interface Hooks {
  made?: (context: Doc) => void;
  findCompanies?: (context: Doc, query: Doc) => Promise<unknown>;
  fillCompany?: (context: Doc, query: Doc) => Promise<unknown>;
}
const hooks = (globalThis as unknown as { __leadDoor: Hooks }).__leadDoor ?? ((globalThis as unknown as { __leadDoor: Hooks }).__leadDoor = {});

/** The add-on's server half: the contract's demo, with a test's hooks in front of each question. */
const SERVER_JS = `import { createDemoLeadSource } from ${JSON.stringify(DEMO)};
export function createLeadSource(context) {
  const demo = createDemoLeadSource(context);
  const hooks = globalThis.__leadDoor ?? {};
  hooks.made?.(context);
  const ask = (name) => async (...args) => {
    const hook = (globalThis.__leadDoor ?? {})[name];
    if (hook !== undefined) { const answer = await hook(context, ...args); if (answer !== undefined) return answer; }
    return demo[name](...args);
  };
  return { checkKey: ask('checkKey'), findCompanies: ask('findCompanies'), fillCompany: ask('fillCompany'), findPeople: ask('findPeople') };
}
`;

/** A CRM whose companies say where a found company's details go, owned by a staff member, and keep a retry key. */
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
    compatibility: { minAdminiumVersion: '0.3.65', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'companies',
          columns: [
            pk,
            { ref: 'name', type: 'text', maxLength: 120 },
            text('company_number', 20),
            text('website', 60),
            text('phone', 40),
            text('address_lines', 200),
            text('town', 80),
            text('country', 2),
            text('sector', 80),
            text('about', 500),
            text('account_owner_id', 36, { rules: { staff: true } }),
            text('retry_key', 64, { unique: true, rules: { retryKey: true } }),
          ],
          belongs: [{ column: 'account_owner_id', set: 'team' }],
        },
        { ref: 'contacts', columns: [pk, { ref: 'name', type: 'text', maxLength: 120 }, text('email', 254), { ref: 'company_id', type: 'fk', references: 'companies', nullable: true }] },
      ],
    },
    people: [
      { table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id' },
      {
        table: 'companies',
        kind: 'companies',
        name: 'name',
        lead: {
          number: 'company_number',
          website: 'website',
          phone: 'phone',
          address: { lines: 'address_lines', town: 'town', country: 'country' },
          activity: 'sector',
          about: 'about',
          owner: 'account_owner_id',
        },
      },
    ],
    roles: [
      {
        key: 'rep',
        name: 'Sales rep',
        permissions: ['table:@companies:read', 'table:@companies:create', 'table:@companies:update', 'table:@contacts:read', 'page:@crm-companies:view'],
        // Their own companies: a colleague's they neither see nor change.
        limits: { companies: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } },
      },
    ],
    pages: [{ ref: 'crm-companies', template: 'page-crud', title: { key: 't', fallback: 'Companies' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'companies' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** The add-on, with a page a rep may open. */
function finder(): Doc {
  const doc = leadFinder() as Doc;
  doc['addOn'].hostApi = 1;
  doc['addOn'].pages = [{ ref: PAGE, title: { key: 'company-finder.search', fallback: 'Find companies' }, icon: 'search', client: 'pages/search.js' }];
  return doc;
}

describe.each(LEGS)('the lead door — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let conn = '';
  let installId = '';
  const tables: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const websiteResolves: string[] = [];
  let signIns = 0;
  let trusted: string | undefined;

  const table = (app: string, ref: string) => tables[`${app}:${ref}`]!;
  const rows = (statement: string) => h.rows(statement) as Promise<Doc[]>;
  const companies = () => rows(`SELECT * FROM ${table('crm', 'companies')} ORDER BY id`);
  const company = async (id: number) => (await rows(`SELECT * FROM ${table('crm', 'companies')} WHERE id = ${String(id)}`))[0];
  const fieldSources = () => rows(`SELECT * FROM ${table(KEY, 'field_sources')} ORDER BY id`);
  const door = (who: string, path: string, payload: unknown) =>
    composed.app.inject({ method: 'POST', url: `/api/v1/leads/${KEY}/${path}`, headers: { cookie: cookies[who]! }, payload: payload as Doc });
  const retry = (seed: string) => `${seed}-${'r'.repeat(30)}`.slice(0, 40);

  async function insert(ref: string, values: Doc): Promise<void> {
    const view = await loadSnapshotView(h.meta, conn, { forOthers: true });
    const at = view.table(table('crm', ref));
    const { db } = await h.manager.data(conn);
    const bound = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(at.columns.get(column)!, value, dialect)]));
    await db.insertInto(at.id as never).values(bound as never).execute();
  }

  /** Someone with these roles and grants, signed in. */
  async function person(key: string, roleSlugs: string[], grants: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name: key, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    for (const slug of roleSlugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    if (grants.length > 0) {
      const role = await rolesRepo(h.meta).create({ slug: `door-${key}`, name: `Door ${key}` });
      for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
      await rolesRepo(h.meta).assignToUser(user.id, role.id);
    }
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    conn = h.connectionId;
    await h.stageApp(crm());
    const app = await h.install('crm', '1.0.0');
    expect(app.statusCode, app.body).toBe(200);
    await h.stageAddOn(finder(), { bundled: true, files: { 'dist/server.js': SERVER_JS, 'pages/search.js': 'export default {};\n' } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: KEY, version: '1.0.0', attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    installId = (await h.meta.db.selectFrom('adminium_manifests').select(['id']).where('manifestKey', '=', KEY).executeTakeFirstOrThrow()).id;
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;

    // Two keys, one per source, in the one credential row; both switched on.
    const repo = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    for (const [source, value] of [['companies-house', REGISTER_KEY], ['hunter', PEOPLE_KEY]] as const) {
      await repo.setCredential(installId, { kind: 'api-key', secret: withSourceKey(await repo.getCredential(installId), source, value) });
    }
    const entries = sourcesOf(finder() as never);
    for (const id of ['companies-house', 'hunter']) await mutateSourceState(h.meta, installId, entries.find((one) => one.id === id)!, (state) => ({ ...state, on: true }));

    // The composed server reads the bundled packages from its own directory: the add-on is vouched for as a developer's own.
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = KEY;
    root = await mkdtemp(join(tmpdir(), 'lead-door-'));
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
      // Any website read would ask this first: a test sees every one, and none reaches the network.
      pictureSeams: {
        resolve: async (host: string) => {
          websiteResolves.push(host);
          throw new Error('no network in this test');
        },
      },
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    // Dana and Omar are reps held to their own companies; both may open the add-on's page.
    await person('dana', ['crm-rep'], [`page:${PAGE}:view`]);
    await person('omar', ['crm-rep'], [`page:${PAGE}:view`]);
    // Omar's company, which Dana cannot open; one of Dana's own; a company spelled its own way, Omar's.
    await insert('companies', { id: 901, name: 'Kestrel Yard Architects', company_number: '98000412', town: 'Leeds', account_owner_id: ids['omar'] });
    await insert('companies', { id: 902, name: 'Millbeck Drawing Office', website: 'https://www.millbeck.example/', town: 'Leeds', account_owner_id: ids['dana'] });
    await insert('companies', { id: 903, name: 'Acme Limited', town: 'Leeds', account_owner_id: ids['omar'] });
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  const search = (who: string, body: Doc = {}) => door(who, 'search', { source: 'companies-house', activity: '71111', place: { text: 'Leeds', country: 'GB' }, size: 20, ...body });

  it.skipIf(!available)('as a rep held to their own companies, a colleague’s company is "kept by a colleague" and Add makes no duplicate; ACME LTD is Acme Limited', async () => {
    hooks.findCompanies = async (_context, query) =>
      query['activity'] === 'acme'
        ? { ok: true, companies: [{ ref: 'gb-acme', name: 'ACME LTD', address: { town: 'LEEDS', country: 'GB' }, natural: false, noMarketing: false }], next: null }
        : undefined;
    try {
      const res = await search('dana');
      expect(res.statusCode, res.body).toBe(200);
      const found = (res.json() as Doc)['companies'] as Doc[];
      const byName = (name: string) => found.find((one) => one['name'] === name)!;
      // Omar's, matched by number: here, kept by a colleague, no key, and nothing of its row.
      expect(byName('Kestrel Yard Architects')['here']).toEqual({ key: null, keptByColleague: true, by: 'number' });
      // Dana's own, matched by the website's domain: here, with its key.
      expect(byName('Millbeck Drawing Office')['here']).toEqual({ key: '902', keptByColleague: false, by: 'domain' });
      expect(byName('Tannery Row Design')['here']).toBeNull();
      // Officers are never handed on while people are off.
      expect(byName('Kestrel Yard Architects')['officers']).toBeUndefined();

      // Adding the colleague's company anyway: refused, and no second row.
      const before = (await companies()).length;
      const add = await door('dana', 'add', { source: 'companies-house', companies: [{ ref: 'gb-98000412', retryKey: retry('kestrel') }] });
      expect(add.statusCode, add.body).toBe(200);
      expect(add.json()).toMatchObject({ added: 0, refused: 1, results: [{ ref: 'gb-98000412', outcome: 'refused', reason: 'already-here' }] });
      expect((await companies()).length).toBe(before);

      // "ACME LTD" in LEEDS is Omar's "Acme Limited" in Leeds, on every engine.
      const acme = await search('dana', { activity: 'acme' });
      expect(acme.statusCode, acme.body).toBe(200);
      expect(((acme.json() as Doc)['companies'] as Doc[])[0]!['here']).toEqual({ key: null, keptByColleague: true, by: 'name' });
      const again = await door('dana', 'add', { source: 'companies-house', companies: [{ ref: 'gb-acme', retryKey: retry('acme') }] });
      expect(again.json()).toMatchObject({ added: 0, results: [{ reason: 'already-here' }] });
      expect((await companies()).length).toBe(before);
    } finally {
      delete hooks.findCompanies;
    }
  });

  it.skipIf(!available)('a partial add says what was refused; a retried add adds once, owned by the rep, its fields noted', async () => {
    await search('dana');
    const key = retry('tannery');
    const add = await door('dana', 'add', {
      source: 'companies-house',
      companies: [
        { ref: 'gb-98003391', retryKey: key },
        { ref: 'gb-98000412', retryKey: retry('kestrel-2') },
        { ref: 'gb-nobody', retryKey: retry('nobody') },
      ],
    });
    expect(add.statusCode, add.body).toBe(200);
    const body = add.json() as Doc;
    expect(body['message']).toBe('1 added, 2 refused');
    expect(body['results'].map((one: Doc) => [one.outcome, one.reason])).toEqual([['added', null], ['refused', 'already-here'], ['refused', 'not-found']]);
    const made = (await companies()).filter((row) => row['name'] === 'Tannery Row Design');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ company_number: '98003391', website: 'https://tanneryrow.example', town: 'Leeds', country: 'GB', sector: 'Architectural activities · 71111', account_owner_id: ids['dana'] });
    // The same add sent again after a lost reply: what it did, and no second row.
    const retried = await door('dana', 'add', { source: 'companies-house', companies: [{ ref: 'gb-98003391', retryKey: key }] });
    expect(retried.json()).toMatchObject({ added: 1, results: [{ outcome: 'added', key: body['results'][0].key }] });
    expect((await companies()).filter((row) => row['name'] === 'Tannery Row Design')).toHaveLength(1);
    // Each written field says where it came from, by the hash of its value as the record page reads it.
    const notes = (await fieldSources()).filter((row) => String(row['row_key']) === String(body['results'][0].key));
    expect(notes.find((row) => row['column_name'] === 'company_number')).toMatchObject({ table_ref: 'crm:companies', source: 'companies-house', value_hash: valueHash('98003391') });
    // Audited by source and counts.
    const audit = (await auditRepo(h.meta).list({ category: 'leads' })).filter((entry) => entry.action === 'leads.added');
    expect(audit.length).toBeGreaterThan(0);
  });

  it.skipIf(!available)('a fill over a field a colleague changed since the sheet showed it is refused; an untouched one fills and is noted', async () => {
    await insert('companies', { id: 910, name: 'Ouseburn Studio', town: 'Newcastle upon Tyne', account_owner_id: ids['dana'] });
    const look = await door('dana', 'lookup', { record: '910', sources: ['companies-house'] });
    expect(look.statusCode, look.body).toBe(200);
    const fields = (look.json() as Doc)['fields'] as Doc[];
    expect(fields.find((one) => one['field'] === 'number')).toMatchObject({ now: null, found: [{ source: 'companies-house', value: '98002264' }] });
    // Somebody types a website while Dana's sheet is open.
    const { db } = await h.manager.data(conn);
    await db.updateTable(table('crm', 'companies') as never).set({ website: 'https://typed.example' } as never).where('id' as never, '=', 910 as never).execute();
    const refused = await door('dana', 'fill', { record: '910', fields: [{ field: 'website', source: 'companies-house', now: null }, { field: 'number', source: 'companies-house', now: null }] });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('FIELD_CHANGED');
    expect(await company(910)).toMatchObject({ website: 'https://typed.example', company_number: null });
    // The field as it is now: filled, and noted.
    const filled = await door('dana', 'fill', { record: '910', fields: [{ field: 'number', source: 'companies-house', now: null }] });
    expect(filled.statusCode, filled.body).toBe(200);
    expect((await company(910))!['company_number']).toBe('98002264');
    expect((await fieldSources()).find((row) => String(row['row_key']) === '910' && row['column_name'] === 'company_number')).toMatchObject({ value_hash: valueHash('98002264') });
  });

  it.skipIf(!available)('a French unit that objected to sales contact is never added, its facts fill a record already kept; a sole trader with people off is refused by name', async () => {
    const res = await door('dana', 'search', { source: 'france', activity: '71.11Z', place: { text: 'Lyon', country: 'FR', codes: ['69381', '69384'] } });
    expect(res.statusCode, res.body).toBe(200);
    const found = (res.json() as Doc)['companies'] as Doc[];
    expect(found.find((one) => one['ref'] === 'fr-512378901')!['blocked']).toEqual({ reason: 'no-marketing', message: 'This business asked not to be contacted for sales.' });
    expect(found.find((one) => one['ref'] === 'fr-412345678')!['blocked']).toEqual({ reason: 'sole-trader', message: 'A sole trader is a person: turn on People to keep one.' });
    const before = (await companies()).length;
    const add = await door('dana', 'add', { source: 'france', companies: [{ ref: 'fr-512378901', retryKey: retry('plans') }, { ref: 'fr-412345678', retryKey: retry('saone') }] });
    expect(add.json()).toMatchObject({ added: 0, refused: 2, results: [{ reason: 'no-marketing' }, { reason: 'sole-trader', message: 'A sole trader is a person: turn on People to keep one.' }] });
    expect((await companies()).length).toBe(before);

    // A record somebody already keeps: the register's facts may still fill it.
    await insert('companies', { id: 911, name: 'Plans Croix-Rousse', company_number: '512 378 901', account_owner_id: ids['dana'] });
    const look = await door('dana', 'lookup', { record: '911', sources: ['france'] });
    expect(look.statusCode, look.body).toBe(200);
    const fill = await door('dana', 'fill', { record: '911', fields: [{ field: 'website', source: 'france', now: null }, { field: 'town', source: 'france', now: null }] });
    expect(fill.statusCode, fill.body).toBe(200);
    expect(await company(911)).toMatchObject({ website: 'https://plans-croix-rousse.example', town: 'Lyon' });
  });

  it.skipIf(!available)('an answer with a 10 kB name or an http: address is refused; a long name is cut; a formula is kept as text and neutralised in the CSV export', async () => {
    const one = (company: Doc) => async () => ({ ok: true, companies: [{ ref: 'gb-odd', address: { town: 'Leeds', country: 'GB' }, natural: false, noMarketing: false, ...company }], next: null });
    try {
      hooks.findCompanies = one({ name: 'x'.repeat(10_000) });
      const huge = await search('dana');
      expect(huge.statusCode).toBe(502);
      expect(huge.json().error.code).toBe('UNAVAILABLE');
      hooks.findCompanies = one({ name: 'Plain Http Ltd', website: 'http://plain.example' });
      expect((await search('dana')).statusCode).toBe(502);

      // 300 letters into a 120-wide name, and a formula, through Add.
      hooks.findCompanies = one({ ref: 'gb-long', name: `Wharf ${'Long '.repeat(58)}`.trim(), number: '98007771' });
      expect((await search('dana')).statusCode).toBe(200);
      const long = await door('dana', 'add', { source: 'companies-house', companies: [{ ref: 'gb-long', retryKey: retry('long') }] });
      expect(long.json(), long.body).toMatchObject({ added: 1 });
      const cut = (await companies()).find((row) => row['company_number'] === '98007771')!;
      expect([...String(cut['name'])].length).toBe(120);
      expect(String(cut['name']).endsWith('…')).toBe(true);

      hooks.findCompanies = one({ ref: 'gb-formula', name: '=HYPERLINK("https://evil.example","Kestrel")', number: '98007772' });
      expect((await search('dana')).statusCode).toBe(200);
      await door('dana', 'add', { source: 'companies-house', companies: [{ ref: 'gb-formula', retryKey: retry('formula') }] });
      const stored = (await companies()).find((row) => row['company_number'] === '98007772')!;
      expect(stored['name']).toBe('=HYPERLINK("https://evil.example","Kestrel")');
      const line = createRowWriter('csv', [{ key: 'name', header: 'Name', numeric: false }]).line({ name: stored['name'] });
      expect(line.startsWith(`"'=HYPERLINK`)).toBe(true);
    } finally {
      delete hooks.findCompanies;
    }
  });

  it.skipIf(!available)('Stop ends a look-up: the source sees its signal, and nothing is written', async () => {
    await insert('companies', { id: 950, name: 'Fennel Row Works', company_number: '98009991', account_owner_id: ids['dana'] });
    let entered = false;
    let stopped = false;
    hooks.fillCompany = (context) =>
      new Promise((resolve) => {
        entered = true;
        (context['signal'] as AbortSignal).addEventListener('abort', () => {
          stopped = true;
          resolve({ ok: false, code: 'UNAVAILABLE', message: 'stopped' });
        });
      });
    const notesBefore = (await fieldSources()).length;
    await composed.app.listen({ port: PORT, host: '127.0.0.1' });
    try {
      // A plain client (no browser headers), whose connection is dropped as a closed tab or the page's Stop drops it.
      let answered = '';
      const body = JSON.stringify({ record: '950', sources: ['companies-house'] });
      const asked = request({ host: '127.0.0.1', port: PORT, method: 'POST', path: `/api/v1/leads/${KEY}/lookup`, headers: { cookie: cookies['dana']!, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } }, (res) => {
        res.on('data', (chunk: Buffer) => (answered += chunk.toString('utf8')));
      });
      asked.on('error', () => undefined);
      asked.end(body);
      const deadline = Date.now() + 10_000;
      while (!entered && answered === '' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      // Not asked at all: say what the door answered instead.
      expect(entered, answered).toBe(true);
      asked.destroy();
      while (!stopped && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(stopped).toBe(true);
    } finally {
      // The server keeps listening until the suite closes it.
      delete hooks.fillCompany;
    }
    expect((await fieldSources()).length).toBe(notesBefore);
    expect(await company(950)).toMatchObject({ website: null, town: null });
  });

  it.skipIf(!available)('a source’s key never reaches another source’s host, end to end through the door', async () => {
    const seen: Doc[] = [];
    hooks.made = (context) => seen.push({ source: context['source'], key: context['key'] });
    hooks.findCompanies = async (context) => {
      // The register's code, with its own key, tries the people service's host: refused before anything goes out.
      await expect((context['http'] as (url: string, init?: Doc) => Promise<unknown>)(`https://${PEOPLE_HOST}/v2/domain-search`, { headers: { 'x-api-key': String(context['key']) } })).rejects.toMatchObject({ reason: 'HOST_NOT_ALLOWED' });
      return undefined;
    };
    try {
      expect((await search('dana')).statusCode).toBe(200);
    } finally {
      delete hooks.made;
      delete hooks.findCompanies;
    }
    expect(seen.at(-1)).toEqual({ source: 'companies-house', key: REGISTER_KEY });
    expect(JSON.stringify(seen)).not.toContain(PEOPLE_KEY);
    const refused = (await auditRepo(h.meta).list({ category: 'add-on' })).filter((entry) => entry.action === 'add-on.egress-refused');
    expect(JSON.stringify(refused)).toContain(PEOPLE_HOST);
    expect(JSON.stringify(refused)).toContain(`"declared":["${REGISTER_HOST}"]`);
    expect(JSON.stringify(refused)).not.toContain(REGISTER_KEY);
  });

  it.skipIf(!available)('the rule step asks only the free registers, never a website or a paid source, fills only empty fields; its 51st call of the day is refused', async () => {
    // A row a stranger's form could have made: a name, a town and a website of their choosing; a phone a person typed.
    await insert('companies', { id: 960, name: 'Kestrel Yard Architects', town: 'Leeds', website: 'https://stranger.example', phone: '0113 000 0000' });
    const seen: string[] = [];
    hooks.made = (context) => seen.push(String(context['source']));
    const view = await loadSnapshotView(h.meta, conn, { forOthers: true });
    const companiesTable = view.table(table('crm', 'companies'));
    const { db } = await h.manager.data(conn);
    const ctx = async (): Promise<ActionContext> =>
      ({
        meta: h.meta,
        manager: h.manager,
        app: composed.app,
        writes: composed.leads.deps.writes as unknown as RecordWriteService,
        rule: { id: 'rul_fill', name: 'Fill in new companies', connectionId: conn, createdBy: null },
        runId: 'run_fill',
        hops: 0,
        now: Date.now(),
        source: { connectionId: conn, view, db, dialect, table: companiesTable, record: { connectionId: conn, table: companiesTable.id, pk: { id: 960 }, label: 'Kestrel Yard Architects' }, row: (await company(960))! },
        tokens: {},
        text: TRACE_EN,
        secret: TEST_SECRET,
        leadSources: composed.leads.step,
      }) as unknown as ActionContext;
    const step = { kind: 'company.fill' as const, addOn: KEY, sources: ['hunter', 'website', 'companies-house'], addOnName: 'Company finder' };
    try {
      const done = await runCompanyFillAction(step, await ctx());
      expect(done.log).toMatch(/details filled in from companies-house/);
      // Only the free register was built: never the people service, never the website.
      expect(seen).toEqual(['companies-house']);
      expect(websiteResolves).toEqual([]);
      // Empty fields only: the typed phone and the stranger's website stay.
      expect(await company(960)).toMatchObject({ company_number: '98000412', phone: '0113 000 0000', website: 'https://stranger.example', sector: 'Architectural activities · 71111' });

      // The step's 50 calls of the day on one source are spent: the 51st is refused, and nothing is asked.
      const day = sourceDayOf(Date.now());
      await h.meta.db.updateTable('adminium_source_days').set({ calls: 50, held: 0 }).where('installId', '=', installId).where('source', '=', 'companies-house').where('day', '=', day).where('spender', '=', 'step').execute();
      await db.updateTable(table('crm', 'companies') as never).set({ about: null } as never).where('id' as never, '=', 960 as never).execute();
      seen.length = 0;
      const skipped = await runCompanyFillAction(step, await ctx());
      expect(skipped.log).toContain('skipped: today\'s 50 look-ups for rules on companies-house are used');
      expect(seen).toEqual([]);
    } finally {
      delete hooks.made;
    }
  });
});
