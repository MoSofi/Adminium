// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COMPANY'S PAGE AS DRAWN, ON THE REAL SERVER: an add-on's action beside
 * Edit on a declared companies table, and "From {source} · {date}" under the
 * fields a source filled, on SQLite, Postgres and MySQL, as the roles the
 * rules limit (a rep held to their own companies; a reader who may not
 * change companies), never only as an admin.
 *
 *  - "Fill in details" is offered on the CRM's companies records, and on no
 *    other table: not on its people table, not on a table nobody declares;
 *  - a reader without the right to change companies is offered no button,
 *    and still reads where the fields came from;
 *  - an add-on whose code did not load (not vouched for) offers nothing, nor
 *    one whose fill names no kind of table;
 *  - after a fill the notes show; an edit of one field hides its note and the
 *    others stay: a trimmed text, a number column and a date column, each
 *    hashed the same from the driver's value and from the record page's;
 *  - a fill over a field somebody changed since the sheet showed it says who
 *    changed it, by name.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { manifestsRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { recordActionsFor } from '../src/add-ons/record-actions.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import type { RecordWriteService } from '../src/crud/write-service.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { withSourceKey } from '../src/lead-sources/keys.js';
import { mutateSourceState, sourcesOf } from '../src/lead-sources/state.js';
import { leadsInstall } from '../src/leads/people.js';
import { noteFieldSources, shownKindOf, valueHash } from '../src/leads/write.js';
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
const CLIENT = 'dist/client.js';
const REGISTER_KEY = 'test-key-companies-1';
const DEMO = new URL('../../../packages/add-on-contracts/dist/testing/lead-source.js', import.meta.url).href;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });

const SERVER_JS = `import { createDemoLeadSource } from ${JSON.stringify(DEMO)};
export function createLeadSource(context) { return createDemoLeadSource(context); }
`;
const CLIENT_JS = 'export function register() { return { fills: [] }; }\n';

/** A CRM: companies declared with where a found company's details go, its people, and a table nobody declares. */
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
            { ref: 'employees', type: 'decimal', precision: 10, scale: 2, nullable: true },
            { ref: 'founded', type: 'date', nullable: true },
            { ref: 'checked_at', type: 'timestamptz', nullable: true },
          ],
          belongs: [{ column: 'account_owner_id', set: 'team' }],
        },
        { ref: 'contacts', columns: [pk, { ref: 'name', type: 'text', maxLength: 120 }, text('email', 254), { ref: 'company_id', type: 'fk', references: 'companies', nullable: true }] },
        { ref: 'deals', columns: [pk, { ref: 'name', type: 'text', maxLength: 120 }, text('stage', 40)] },
      ],
    },
    people: [
      { table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id' },
      {
        table: 'companies',
        kind: 'companies',
        name: 'name',
        lead: { number: 'company_number', website: 'website', phone: 'phone', address: { lines: 'address_lines', town: 'town', country: 'country' }, activity: 'sector', about: 'about', owner: 'account_owner_id' },
      },
    ],
    roles: [
      {
        key: 'rep',
        name: 'Sales rep',
        permissions: [
          'table:@companies:read',
          'table:@companies:update',
          'table:@contacts:read',
          'table:@contacts:update',
          'table:@deals:read',
          'table:@deals:update',
          'page:@crm-companies:view',
          'page:@crm-contacts:view',
          'page:@crm-deals:view',
        ],
        // Their own companies: a colleague's they neither see nor change.
        limits: { companies: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } },
      },
      // May read companies, not change them.
      { key: 'viewer', name: 'Reader', permissions: ['table:@companies:read', 'page:@crm-companies:view'] },
    ],
    pages: [
      { ref: 'crm-companies', template: 'page-crud', title: { key: 't', fallback: 'Companies' }, nav: { group: 'crm', icon: 'building-2', order: 1 }, bindings: { rows: 'companies' } },
      { ref: 'crm-contacts', template: 'page-crud', title: { key: 'c', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'users', order: 2 }, bindings: { rows: 'contacts' } },
      { ref: 'crm-deals', template: 'page-crud', title: { key: 'dl', fallback: 'Deals' }, nav: { group: 'crm', icon: 'handshake', order: 3 }, bindings: { rows: 'deals' } },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** The add-on: a page a rep may open, its sources named in its own words, and its action on a companies record. */
function finder(): Doc {
  const doc = leadFinder() as Doc;
  doc['addOn'].hostApi = 1;
  doc['addOn'].pages = [{ ref: PAGE, title: { key: 'company-finder.search', fallback: 'Find companies' }, icon: 'search', client: 'pages/search.js' }];
  for (const source of doc['addOn'].sources as Doc[]) {
    if (source['id'] === 'companies-house') {
      source['label'] = { key: 'company-finder.sources.companies-house', fallback: 'Companies House' };
      source['labels'] = { 'de-DE': 'Companies House (Vereinigtes Königreich)' };
    }
    if (source['id'] === 'website') source['label'] = { key: 'company-finder.sources.website', fallback: 'the website' };
  }
  doc['addOn'].slots = [
    // A fill for apps' own screens (a document for the record): it names no kind of table, and is never drawn here.
    { slot: 'record.actions', client: 'dist/apps.js', order: 5 },
    {
      slot: 'record.actions',
      client: CLIENT,
      order: 10,
      on: 'companies',
      label: { key: 'company-finder.fill', fallback: 'Fill in details' },
      labels: { 'de-DE': 'Details ausfüllen' },
      icon: 'scan-search',
    },
  ];
  return doc;
}

describe.each(LEGS)('a company’s page — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let conn = '';
  let installId = '';
  const tables: Record<string, string> = {};
  const pages: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let signIns = 0;
  let trusted: string | undefined;

  const table = (app: string, ref: string) => tables[`${app}:${ref}`]!;
  const as = (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const door = (who: string, path: string, payload: unknown) => as(who, 'POST', `/api/v1/leads/${KEY}/${path}`, payload);
  const pageOf = async (who: string, ref: string) => {
    const res = await as(who, 'GET', `/api/v1/pages/${pages[ref]!}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Doc;
  };
  const notesOf = async (who: string, row: number) => {
    const res = await as(who, 'GET', `/api/v1/leads/${KEY}/notes?table=crm:companies&row=${String(row)}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as Doc)['notes'] as Doc[];
  };
  const edit = (who: string, row: number, values: Doc) => as(who, 'PATCH', `/api/v1/data/${conn}/${encodeURIComponent(table('crm', 'companies'))}/${String(row)}`, { values });

  async function insert(ref: string, values: Doc): Promise<void> {
    const view = await loadSnapshotView(h.meta, conn, { forOthers: true });
    const at = view.table(table('crm', ref));
    const { db } = await h.manager.data(conn);
    const bound = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(at.columns.get(column)!, value, dialect)]));
    await db.insertInto(at.id as never).values(bound as never).execute();
  }

  /** Someone with these roles and grants, named, signed in. */
  async function person(key: string, name: string, roleSlugs: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    for (const slug of roleSlugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
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
    await h.stageAddOn(finder(), { bundled: true, files: { 'dist/server.js': SERVER_JS, 'pages/search.js': 'export default {};\n', [CLIENT]: CLIENT_JS, 'dist/apps.js': CLIENT_JS } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: KEY, version: '1.0.0', attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    installId = (await h.meta.db.selectFrom('adminium_manifests').select(['id']).where('manifestKey', '=', KEY).executeTakeFirstOrThrow()).id;
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;
    for (const page of await h.meta.db.selectFrom('adminium_pages').select(['id', 'slug']).execute()) pages[page.slug] = page.id;

    const repo = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    await repo.setCredential(installId, { kind: 'api-key', secret: withSourceKey(await repo.getCredential(installId), 'companies-house', REGISTER_KEY) });
    await mutateSourceState(h.meta, installId, sourcesOf(finder() as never).find((one) => one.id === 'companies-house')!, (state) => ({ ...state, on: true }));

    // The add-on is vouched for as a developer's own: its server half loads.
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = KEY;
    root = await mkdtemp(join(tmpdir(), 'lead-record-'));
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
      // A website read would ask this first: none reaches the network.
      pictureSeams: { resolve: async () => Promise.reject(new Error('no network in this test')) },
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    // Dana: a rep held to her own companies, who may open the add-on's page. Leo: may read companies, not change them.
    await person('dana', 'Dana Whitlock', ['crm-rep']);
    await person('leo', 'Leo Vance', ['crm-viewer']);
    await person('wren', 'Wren Holt', ['super-admin']);
    for (const who of ['dana', 'leo']) {
      const role = await rolesRepo(h.meta).create({ slug: `finder-${who}`, name: `Finder ${who}` });
      for (const row of matrixRowsFromGrants([`page:${PAGE}:view`]).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
      await rolesRepo(h.meta).assignToUser(ids[who]!, role.id);
    }
    await insert('companies', { id: 920, name: 'Ouseburn Studio', town: 'Newcastle upon Tyne', account_owner_id: ids['dana'] });
    await insert('companies', { id: 921, name: 'Tannery Row Design', town: 'Leeds', account_owner_id: ids['dana'] });
    await insert('contacts', { id: 930, name: 'Petra Lindqvist', email: 'petra@ouseburn.example', company_id: 920 });
    await insert('deals', { id: 940, name: 'New studio fit-out', stage: 'open' });
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('"Fill in details" shows on a companies record and on no other table: not its people, not an undeclared one', async () => {
    const companies = await pageOf('dana', 'crm-companies');
    expect(companies['recordActions']).toEqual([
      { addOn: KEY, installId, kind: 'companies', table: 'crm:companies', label: 'Fill in details', labelKey: 'company-finder.fill', icon: 'scan-search', client: CLIENT, order: 10 },
    ]);
    expect(companies['fieldNotes']).toEqual([{ addOn: KEY, installId, table: 'crm:companies' }]);
    // The people table, and a table nobody declares: neither the button nor notes.
    for (const ref of ['crm-contacts', 'crm-deals']) {
      const page = await pageOf('dana', ref);
      expect(page['recordActions'], ref).toBeUndefined();
      expect(page['fieldNotes'], ref).toBeUndefined();
    }
    // The fill's file is listed to her, to be loaded by its fingerprint.
    const list = await as('dana', 'GET', '/api/v1/add-ons');
    const listed = ((list.json() as Doc)['addOns'] as Doc[]).find((one) => one['key'] === KEY)!;
    expect((listed['bundles'] as Doc[]).some((bundle) => bundle['path'] === CLIENT && String(bundle['integrity']).startsWith('sha256-'))).toBe(true);
  });

  it.skipIf(!available)('a reader who may not change companies sees no button, and still reads where the fields came from', async () => {
    const page = await pageOf('leo', 'crm-companies');
    expect(page['canUpdate']).toBe(false);
    expect(page['recordActions']).toBeUndefined();
    expect(page['fieldNotes']).toEqual([{ addOn: KEY, installId, table: 'crm:companies' }]);
    expect((await as('leo', 'GET', `/api/v1/leads/${KEY}/notes?table=crm:companies&row=920`)).statusCode).toBe(200);
  });

  it.skipIf(!available)('an add-on whose code did not load offers nothing, nor a fill that names no kind of table', async () => {
    const view = await loadSnapshotView(h.meta, conn, { forOthers: true });
    const companiesId = view.table(table('crm', 'companies')).id;
    const manifests = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    // As a manager of add-ons, so only the add-on's state decides.
    const warned: unknown[] = [];
    const request = { can: async () => true, log: { warn: (details: unknown) => warned.push(details) } } as unknown as FastifyRequest;
    const runtime = (problems: AddOnRuntimeState['problems'], fills = [{ addOnKey: KEY, slot: 'record.actions', client: 'dist/apps.js', order: 5 }, { addOnKey: KEY, slot: 'record.actions', client: CLIENT, order: 10 }]): AddOnRuntimeState => ({
      providers: new Map(),
      slots: new Map([['record.actions', fills]]),
      conflicts: [],
      problems,
      deciders: new Map(),
    });
    const facts = (state: AddOnRuntimeState | null) => recordActionsFor({ meta: h.meta, manifests, runtime: () => state }, { request }, view, companiesId);
    expect((await facts(runtime([])))['actions']?.map((one) => one.addOn), JSON.stringify(warned)).toEqual([KEY]);
    // Its package is not one Adminium vouches for: its server half was left out, and so is its action.
    const untrusted = await facts(runtime([{ addOnKey: KEY, reason: 'UNTRUSTED_PROVIDER', message: 'not vouched', contract: 'lead-source@1' }]));
    expect(untrusted['actions']).toBeUndefined();
    // The notes are the engine's own record: still read.
    expect(untrusted['notes']?.map((one) => one.addOn)).toEqual([KEY]);
    // Nothing loaded yet, or the fill not among what loaded.
    expect((await facts(null))['actions']).toBeUndefined();
    expect((await facts(runtime([], [])))['actions']).toBeUndefined();
    // On the people table: nothing.
    expect(await recordActionsFor({ meta: h.meta, manifests, runtime: () => runtime([]) }, { request }, view, view.table(table('crm', 'contacts')).id)).toEqual({});
  });

  it.skipIf(!available)('after a fill the notes show; an edit of one field hides its note and the others stay: text trimmed, a number, a day and an instant', async () => {
    const look = await door('dana', 'lookup', { record: '920', sources: ['companies-house'] });
    expect(look.statusCode, look.body).toBe(200);
    const fill = await door('dana', 'fill', {
      record: '920',
      fields: [
        { field: 'number', source: 'companies-house', now: null },
        { field: 'activity', source: 'companies-house', now: null },
        { field: 'website', source: 'companies-house', now: null },
      ],
    });
    expect(fill.statusCode, fill.body).toBe(200);

    // A number, a day and an instant, noted from the row as the driver hands it back (a Date, a decimal's text, or SQLite's).
    const { db } = await h.manager.data(conn);
    const companiesId = table('crm', 'companies');
    await edit('dana', 920, { employees: '12.50', founded: '2016-03-01', checked_at: '2026-07-28T09:30:00.000Z' });
    const raw = (await db.selectFrom(companiesId as never).selectAll().where('id' as never, '=', 920 as never).executeTakeFirstOrThrow()) as Doc;
    const view = await loadSnapshotView(h.meta, conn, { forOthers: true });
    const found = (await leadsInstall({ meta: h.meta, manager: h.manager, viewFor: async () => view }, installId))!;
    const at = Date.UTC(2026, 6, 28, 9, 0);
    await noteFieldSources(
      { manager: h.manager, writes: composed.leads.deps.writes as unknown as RecordWriteService },
      { addOn: found.addOn, view, tableRef: 'crm:companies', rowKey: '920', columns: ['employees', 'founded', 'checked_at'].map((column) => ({ column, source: 'companies-house' })), stored: raw, table: view.table(companiesId), at },
    );
    // The driver's value and the record page's hash the same, on every engine.
    const companies = view.table(companiesId);
    const read = (await as('dana', 'GET', `/api/v1/data/${conn}/${encodeURIComponent(companiesId)}/920`).then((res) => res.json())) as Doc;
    for (const column of ['employees', 'founded', 'checked_at']) {
      const kind = shownKindOf(companies.columns.get(column)!.logicalType);
      expect(valueHash(read['data'][column], kind), `${column}: ${JSON.stringify(raw[column])} / ${JSON.stringify(read['data'][column])}`).toBe(valueHash(raw[column], kind));
    }

    const columns = (notes: Doc[]) => notes.map((note) => note['column']).sort();
    const notes = await notesOf('dana', 920);
    expect(columns(notes)).toEqual(['checked_at', 'company_number', 'employees', 'founded', 'sector', 'website']);
    expect(notes.find((note) => note['column'] === 'company_number')).toMatchObject({ source: 'companies-house', label: 'Companies House', labelKey: 'company-finder.sources.companies-house' });
    expect(notes.find((note) => note['column'] === 'employees')!['foundAt']).toBe(at);

    // Spaces around the same words: the same value as the page reads it, so the note stays.
    const sector = String(read['data']['sector']);
    expect((await edit('dana', 920, { sector: `  ${sector}  ` })).statusCode).toBe(200);
    expect(columns(await notesOf('dana', 920))).toContain('sector');
    // One field edited at a time: its note goes, the others stay.
    expect((await edit('dana', 920, { company_number: '98009999' })).statusCode).toBe(200);
    expect(columns(await notesOf('dana', 920))).toEqual(['checked_at', 'employees', 'founded', 'sector', 'website']);
    expect((await edit('dana', 920, { employees: '13' })).statusCode).toBe(200);
    expect(columns(await notesOf('dana', 920))).toEqual(['checked_at', 'founded', 'sector', 'website']);
    // The same number written another way (12.5 is 12.50): not an edit of it.
    expect((await edit('dana', 920, { employees: '12.5', founded: '2016-03-02' })).statusCode).toBe(200);
    expect(columns(await notesOf('dana', 920))).toEqual(['checked_at', 'employees', 'sector', 'website']);
    expect((await edit('dana', 920, { checked_at: '2026-07-29T09:30:00.000Z' })).statusCode).toBe(200);
    expect(columns(await notesOf('dana', 920))).toEqual(['employees', 'sector', 'website']);

    // Leo reads them too; a record out of Dana's reach is not one she gets notes of.
    expect(columns(await notesOf('leo', 920))).toEqual(['employees', 'sector', 'website']);
    await insert('companies', { id: 922, name: 'Millbeck Drawing Office', town: 'Leeds' });
    expect((await as('dana', 'GET', `/api/v1/leads/${KEY}/notes?table=crm:companies&row=922`)).statusCode).toBe(404);
    // Only a companies table has notes.
    expect((await as('dana', 'GET', `/api/v1/leads/${KEY}/notes?table=crm:contacts&row=930`)).statusCode).toBe(422);
  });

  it.skipIf(!available)('a fill over a field changed since the sheet showed it says who changed it, by name', async () => {
    const look = await door('dana', 'lookup', { record: '921', sources: ['companies-house'] });
    expect(look.statusCode, look.body).toBe(200);
    // Wren says what the company does while Dana's sheet is open.
    expect((await edit('wren', 921, { sector: 'Interior design' })).statusCode).toBe(200);
    const refused = await door('dana', 'fill', { record: '921', fields: [{ field: 'activity', source: 'companies-house', now: null }] });
    expect(refused.statusCode, refused.body).toBe(409);
    const error = (refused.json() as Doc)['error'] as Doc;
    expect(error['code']).toBe('FIELD_CHANGED');
    expect(error['details']).toMatchObject({ field: 'activity', column: 'sector', by: 'Wren Holt' });
    expect(error['message']).toBe('sector was changed by Wren Holt after you looked. Look up again.');
    // Named as they are called now: a name changed since is the one said.
    await usersRepo(h.meta).updateProfile(ids['wren']!, { name: 'Wren Holt-Achebe' });
    const renamed = await door('dana', 'fill', { record: '921', fields: [{ field: 'activity', source: 'companies-house', now: null }] });
    expect(((renamed.json() as Doc)['error'] as Doc)['details']).toMatchObject({ by: 'Wren Holt-Achebe' });
    // A field the log names nobody for (written in the database itself): the refusal says so without a name.
    const { db } = await h.manager.data(conn);
    await db.updateTable(table('crm', 'companies') as never).set({ website: 'https://typed.example' } as never).where('id' as never, '=', 921 as never).execute();
    const unnamed = await door('dana', 'fill', { record: '921', fields: [{ field: 'website', source: 'companies-house', now: null }] });
    expect(unnamed.statusCode, unnamed.body).toBe(409);
    expect(((unnamed.json() as Doc)['error'] as Doc)['details']).toMatchObject({ field: 'website', by: null });
  });
});
